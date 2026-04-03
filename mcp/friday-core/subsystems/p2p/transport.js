/**
 * WebSocket Transport — P2P channels between Asimov Agents
 *
 * Each vault server listens for incoming peer connections and can
 * initiate outgoing connections. All data on the wire is JSON frames.
 * The PeerChannel handles encryption/decryption; this layer just moves bytes.
 */

// --- TUNABLE: ws is lazy-loaded on first use (start/connect) to avoid
// paying its parse cost at startup when P2P is never used.
// WebSocketServer and WebSocket are resolved the first time start() or
// connect() is called, then cached in module-level variables.
let WebSocketServer = null;
let WebSocket = null;
async function loadWs() {
  if (!WebSocketServer) {
    const ws = await import('ws');
    WebSocketServer = ws.WebSocketServer;
    WebSocket = ws.WebSocket;
  }
}

import crypto from 'node:crypto';

const WS_PROTOCOL = 'asimov-p2p-v1';
const CONNECT_TIMEOUT_MS = 10000;
const PING_INTERVAL_MS = 30000;

/**
 * Manages WebSocket server + client connections.
 */
export class P2PTransport {
  #wss = null;
  #port = 0;
  #connections = new Map(); // peerId -> WebSocket
  #onIncomingHandshake = null;
  #onIncomingMessage = null;
  #pingIntervals = new Map();

  get port() { return this.#port; }

  onIncomingHandshake(fn) { this.#onIncomingHandshake = fn; }
  onIncomingMessage(fn) { this.#onIncomingMessage = fn; }

  async start(preferredPort = 0) {
    await loadWs();
    return new Promise((resolve, reject) => {
      this.#wss = new WebSocketServer({
        port: preferredPort,
        host: '127.0.0.1', // Loopback only — P2P tunnels through the relay, not direct network exposure
        handleProtocols: (protocols) => {
          if (protocols.has(WS_PROTOCOL)) return WS_PROTOCOL;
          return false;
        }
      });

      this.#wss.on('listening', () => {
        this.#port = this.#wss.address().port;
        resolve(this.#port);
      });

      this.#wss.on('error', reject);

      this.#wss.on('connection', (ws, _req) => {
        const connId = crypto.randomUUID();
        this.#setupConnection(ws, connId, 'inbound');
      });
    });
  }

  async connect(address, peerId) {
    await loadWs();
    // address: "ws://hostname:port" or "wss://hostname:port"
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Connection timeout to ${address}`));
      }, CONNECT_TIMEOUT_MS);

      const ws = new WebSocket(address, WS_PROTOCOL);

      ws.on('open', () => {
        clearTimeout(timeout);
        this.#connections.set(peerId, ws);
        this.#setupConnection(ws, peerId, 'outbound');
        resolve(ws);
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  send(peerId, data) {
    const ws = this.#connections.get(peerId);
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error(`No open connection to peer ${peerId}`);
    }
    ws.send(JSON.stringify(data));
  }

  disconnect(peerId) {
    const ws = this.#connections.get(peerId);
    if (ws) {
      ws.close(1000, 'Normal closure');
      this.#connections.delete(peerId);
    }
    const interval = this.#pingIntervals.get(peerId);
    if (interval) {
      clearInterval(interval);
      this.#pingIntervals.delete(peerId);
    }
  }

  async stop() {
    for (const [peerId] of this.#connections) {
      this.disconnect(peerId);
    }
    if (this.#wss) {
      return new Promise((resolve) => {
        this.#wss.close(() => resolve());
      });
    }
  }

  get connectedPeers() {
    const peers = [];
    for (const [peerId, ws] of this.#connections) {
      peers.push({
        peerId,
        state: ws.readyState === WebSocket.OPEN ? 'open' : 'closed',
        remoteAddress: ws._socket?.remoteAddress
      });
    }
    return peers;
  }

  // --- Internal ---

  #setupConnection(ws, connId, direction) {
    // Start keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);
    this.#pingIntervals.set(connId, pingInterval);

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'handshake' && direction === 'inbound') {
          // Use the random connId as peerId — never derive from unverified message data
          const peerId = connId;
          this.#connections.set(peerId, ws);
          if (this.#onIncomingHandshake) {
            this.#onIncomingHandshake(peerId, msg, (response) => {
              ws.send(JSON.stringify(response));
            });
          }
        } else {
          // Route to appropriate channel handler
          if (this.#onIncomingMessage) {
            this.#onIncomingMessage(connId, msg);
          }
        }
      } catch {
        // Malformed message, ignore
      }
    });

    ws.on('close', () => {
      this.#connections.delete(connId);
      clearInterval(pingInterval);
      this.#pingIntervals.delete(connId);
    });

    ws.on('error', () => {
      this.#connections.delete(connId);
      clearInterval(pingInterval);
      this.#pingIntervals.delete(connId);
    });
  }
}
