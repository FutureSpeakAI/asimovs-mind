/**
 * Asimov P2P Protocol — Encrypted agent-to-agent communication
 *
 * Protocol flow:
 *   1. Agent A sends HANDSHAKE: own exchange public key + cLaw attestation
 *   2. Agent B verifies attestation (are A's laws intact?)
 *   3. Agent B responds: own exchange public key + attestation
 *   4. Both derive shared secret via X25519 ECDH
 *   5. Session keys derived via HKDF (separate encrypt/decrypt keys)
 *   6. All messages: AES-256-GCM encrypted + Ed25519 signed
 *   7. Sequence numbers prevent reordering/replay
 *
 * Message types:
 *   - text: Chat messages between agents
 *   - file: Encrypted file transfer (chunked)
 *   - transaction: Structured data with dual signatures
 *   - attestation: cLaw governance proof
 *   - trust: Trust score exchange
 *   - ping/pong: Keepalive
 */

import crypto from 'node:crypto';
import {
  deriveSharedSecret,
  deriveSessionKeys,
  encryptMessage,
  decryptMessage,
  sign,
  verify
} from '../../core/crypto.js';

// Protocol constants
const PROTOCOL_VERSION = '1.0.0';
const MAX_MESSAGE_SIZE = 16 * 1024 * 1024; // 16 MB
const MAX_CHUNK_SIZE = 64 * 1024;           // 64 KB for file chunks
/**
 * Represents a secure channel between two Asimov Agents.
 */
export class PeerChannel {
  #peerId;
  #peerName;
  #peerSigningPubKey;
  #peerExchangePubKey;
  #encryptKey = null;
  #decryptKey = null;
  #sendSequence = 0n;
  #recvSequence = 0n;
  #state = 'new'; // new -> handshaking -> open -> closed
  #safetyNumber = null;
  #attestationVerified = false;
  #createdAt = Date.now();
  #lastActivity = Date.now();
  #messageLog = [];
  static #MAX_MESSAGE_LOG = 1000;
  #fileTransfers = new Map();

  // Callbacks
  #onMessage = null;
  #onClose = null;
  #sendFn = null;

  constructor({ peerId, peerName, peerSigningPubKey, peerExchangePubKey, sendFn }) {
    this.#peerId = peerId;
    this.#peerName = peerName || 'unknown';
    this.#peerSigningPubKey = peerSigningPubKey ? Buffer.from(peerSigningPubKey, 'base64') : null;
    this.#peerExchangePubKey = peerExchangePubKey ? Buffer.from(peerExchangePubKey, 'base64') : null;
    this.#sendFn = sendFn;
  }

  get peerId() { return this.#peerId; }
  get peerName() { return this.#peerName; }
  get state() { return this.#state; }
  get safetyNumber() { return this.#safetyNumber; }
  get attestationVerified() { return this.#attestationVerified; }
  get stats() {
    return {
      peerId: this.#peerId,
      peerName: this.#peerName,
      state: this.#state,
      safetyNumber: this.#safetyNumber,
      attestationVerified: this.#attestationVerified,
      messagesSent: Number(this.#sendSequence),
      messagesReceived: Number(this.#recvSequence),
      createdAt: this.#createdAt,
      lastActivity: this.#lastActivity,
      activeFileTransfers: this.#fileTransfers.size
    };
  }

  onMessage(fn) { this.#onMessage = fn; }
  onClose(fn) { this.#onClose = fn; }

  // --- Handshake (initiator side) ---

  async initiateHandshake(myExchangePrivateKey, myExchangePublicKey, mySigningPrivateKey, attestation) {
    this.#state = 'handshaking';
    const handshake = {
      type: 'handshake',
      version: PROTOCOL_VERSION,
      exchangePublicKey: myExchangePublicKey.toString('base64'),
      attestation,
      timestamp: Date.now()
    };
    // Sign the handshake
    const payload = JSON.stringify(handshake);
    const signature = sign(Buffer.from(payload), mySigningPrivateKey);
    await this.#rawSend({ ...handshake, signature: signature.toString('base64') });

    // Store our private key for when we get the ack
    this._myExchangePrivateKey = myExchangePrivateKey;
    this._myExchangePublicKey = myExchangePublicKey;
  }

  // --- Handshake (responder side) ---

  async handleHandshake(msg, myExchangePrivateKey, myExchangePublicKey, mySigningPrivateKey, myAttestation, verifyAttestationFn) {
    // Verify Ed25519 signature on the inbound handshake message
    if (msg.signature && msg.attestation?.signerPublicKey) {
      const { signature: _sig, ...payloadFields } = msg;
      const payloadStr = JSON.stringify(payloadFields);
      const signerKey = Buffer.from(msg.attestation.signerPublicKey, 'base64');
      const valid = verify(Buffer.from(payloadStr), Buffer.from(msg.signature, 'base64'), signerKey);
      if (!valid) {
        await this.#rawSend({ type: 'error', code: 'SIGNATURE_FAILED', reason: 'Handshake signature verification failed' });
        this.#state = 'closed';
        return { success: false, error: 'Handshake signature verification failed' };
      }
      // Pin the peer's signing key for future message verification
      this.#peerSigningPubKey = signerKey;
    }

    // Verify peer's attestation
    if (msg.attestation && verifyAttestationFn) {
      const result = verifyAttestationFn(msg.attestation);
      this.#attestationVerified = result.valid;
      if (!result.valid) {
        await this.#rawSend({ type: 'error', code: 'ATTESTATION_FAILED', reason: result.reason });
        this.#state = 'closed';
        return { success: false, error: `Peer attestation failed: ${result.reason}` };
      }
    }

    // Set peer's exchange public key from handshake
    this.#peerExchangePubKey = Buffer.from(msg.exchangePublicKey, 'base64');

    // Derive session keys
    const sharedSecret = deriveSharedSecret(myExchangePrivateKey, this.#peerExchangePubKey);
    const session = deriveSessionKeys(sharedSecret, myExchangePublicKey, this.#peerExchangePubKey);
    this.#encryptKey = session.encryptKey;
    this.#decryptKey = session.decryptKey;
    this.#safetyNumber = session.safetyNumber;

    // Wipe shared secret
    sharedSecret.fill(0);

    // Send handshake ack
    const ack = {
      type: 'handshake_ack',
      version: PROTOCOL_VERSION,
      exchangePublicKey: myExchangePublicKey.toString('base64'),
      attestation: myAttestation,
      timestamp: Date.now()
    };
    const ackPayload = JSON.stringify(ack);
    const signature = sign(Buffer.from(ackPayload), mySigningPrivateKey);
    await this.#rawSend({ ...ack, signature: signature.toString('base64') });

    this.#state = 'open';
    return { success: true, safetyNumber: this.#safetyNumber };
  }

  // --- Handle handshake ack (initiator receives response) ---

  handleHandshakeAck(msg, verifyAttestationFn) {
    // SEC-007: Verify Ed25519 signature on the ack before processing
    if (this.#peerSigningPubKey) {
      if (!msg.signature) {
        this.#state = 'closed';
        return { success: false, error: 'Handshake ack missing required signature' };
      }
      // The signature covers the ack payload without the signature field itself
      const { signature: _sig, ...ackPayload } = msg;
      const payloadStr = JSON.stringify(ackPayload);
      const valid = verify(Buffer.from(payloadStr), Buffer.from(msg.signature, 'base64'), this.#peerSigningPubKey);
      if (!valid) {
        this.#state = 'closed';
        return { success: false, error: 'Handshake ack signature verification failed' };
      }
    }

    if (msg.attestation && verifyAttestationFn) {
      const result = verifyAttestationFn(msg.attestation);
      this.#attestationVerified = result.valid;
      if (!result.valid) {
        this.#state = 'closed';
        return { success: false, error: `Peer attestation failed: ${result.reason}` };
      }
    }

    // Set peer's exchange public key
    this.#peerExchangePubKey = Buffer.from(msg.exchangePublicKey, 'base64');

    // Derive session keys
    const sharedSecret = deriveSharedSecret(this._myExchangePrivateKey, this.#peerExchangePubKey);
    const session = deriveSessionKeys(sharedSecret, this._myExchangePublicKey, this.#peerExchangePubKey);
    this.#encryptKey = session.encryptKey;
    this.#decryptKey = session.decryptKey;
    this.#safetyNumber = session.safetyNumber;

    sharedSecret.fill(0);
    // Clean up temporary keys
    this._myExchangePrivateKey = null;
    this._myExchangePublicKey = null;

    this.#state = 'open';
    return { success: true, safetyNumber: this.#safetyNumber };
  }

  // --- Sending encrypted messages ---

  async sendText(text) {
    return this.#sendEncrypted({ type: 'text', content: text, timestamp: Date.now() });
  }

  async sendTransaction(transaction) {
    // Transactions carry structured data with type and payload
    return this.#sendEncrypted({
      type: 'transaction',
      transactionId: crypto.randomUUID(),
      data: transaction,
      timestamp: Date.now()
    });
  }

  async sendTrustScores(scores) {
    return this.#sendEncrypted({ type: 'trust', scores, timestamp: Date.now() });
  }

  async sendAttestation(attestation) {
    return this.#sendEncrypted({ type: 'attestation', attestation, timestamp: Date.now() });
  }

  async sendFileStart(fileId, fileName, totalSize, totalChunks) {
    this.#fileTransfers.set(fileId, { fileName, totalSize, totalChunks, sent: 0 });
    return this.#sendEncrypted({
      type: 'file_start', fileId, fileName, totalSize, totalChunks, timestamp: Date.now()
    });
  }

  async sendFileChunk(fileId, chunkIndex, data) {
    const transfer = this.#fileTransfers.get(fileId);
    if (!transfer) throw new Error(`Unknown file transfer: ${fileId}`);
    const result = await this.#sendEncrypted({
      type: 'file_chunk', fileId, chunkIndex,
      data: data.toString('base64'),
      timestamp: Date.now()
    });
    transfer.sent++;
    return result;
  }

  async sendFileEnd(fileId, checksum) {
    this.#fileTransfers.delete(fileId);
    return this.#sendEncrypted({
      type: 'file_end', fileId, checksum, timestamp: Date.now()
    });
  }

  async sendFile(fileName, fileData) {
    const fileId = crypto.randomUUID();
    const totalSize = fileData.length;
    const totalChunks = Math.ceil(totalSize / MAX_CHUNK_SIZE);

    await this.sendFileStart(fileId, fileName, totalSize, totalChunks);

    for (let i = 0; i < totalChunks; i++) {
      const start = i * MAX_CHUNK_SIZE;
      const end = Math.min(start + MAX_CHUNK_SIZE, totalSize);
      await this.sendFileChunk(fileId, i, fileData.subarray(start, end));
    }

    const checksum = crypto.createHash('sha256').update(fileData).digest('hex');
    await this.sendFileEnd(fileId, checksum);
    return { fileId, checksum, totalChunks };
  }

  // --- Receiving ---

  async handleIncomingMessage(raw) {
    this.#lastActivity = Date.now();

    // If not yet open, handle protocol messages
    if (this.#state === 'handshaking' || this.#state === 'new') {
      // These are unencrypted protocol messages
      if (raw.type === 'handshake_ack') {
        return { protocol: true, ...this.handleHandshakeAck(raw, this._attestationVerifyFn || null) };
      }
      return { protocol: true, error: 'Unexpected message in handshake state' };
    }

    if (raw.type === 'ping') {
      await this.#rawSend({ type: 'pong', timestamp: Date.now() });
      return { protocol: true };
    }
    if (raw.type === 'pong') {
      return { protocol: true };
    }
    if (raw.type === 'close') {
      this.close();
      return { protocol: true, closed: true };
    }

    // Encrypted message: raw.encrypted is base64 AES-256-GCM ciphertext, raw.sig is Ed25519 signature
    if (!raw.encrypted) {
      return { error: 'Expected encrypted message' };
    }

    if (!this.#decryptKey) {
      return { error: 'Decryption key not available' };
    }

    try {
      const ciphertext = Buffer.from(raw.encrypted, 'base64');

      // Verify Ed25519 signature BEFORE decrypting or advancing the sequence counter.
      // When a peer signing key is configured, a missing signature is a hard reject.
      if (this.#peerSigningPubKey) {
        if (!raw.sig) {
          return { error: 'Message signature required but missing' };
        }
        const valid = verify(ciphertext, Buffer.from(raw.sig, 'base64'), this.#peerSigningPubKey);
        if (!valid) return { error: 'Signature verification failed' };
      }

      const { plaintext, sequence: _sequence } = decryptMessage(ciphertext, this.#decryptKey, Number(this.#recvSequence));
      this.#recvSequence++;

      const msg = JSON.parse(plaintext.toString('utf-8'));
      this.#messageLog.push({ direction: 'recv', type: msg.type, timestamp: msg.timestamp });
      if (this.#messageLog.length > PeerChannel.#MAX_MESSAGE_LOG) this.#messageLog.shift();

      if (this.#onMessage) this.#onMessage(msg);
      return { success: true, message: msg };

    } catch (err) {
      return { error: `Decrypt failed: ${err.message}` };
    }
  }

  // --- Close ---

  async close() {
    if (this.#state === 'closed') return;
    try { await this.#rawSend({ type: 'close', timestamp: Date.now() }); } catch {}
    if (this.#encryptKey) this.#encryptKey.destroy();
    if (this.#decryptKey) this.#decryptKey.destroy();
    if (this._mySigningPrivateKey && typeof this._mySigningPrivateKey.destroy === 'function') {
      this._mySigningPrivateKey.destroy();
    }
    this.#encryptKey = null;
    this.#decryptKey = null;
    this._mySigningPrivateKey = null;
    this._attestationVerifyFn = null;
    this.#state = 'closed';
    this.#fileTransfers.clear();
    if (this.#onClose) this.#onClose();
  }

  // --- Internal ---

  async #sendEncrypted(msg) {
    if (this.#state !== 'open') throw new Error(`Channel not open (state: ${this.#state})`);
    if (!this.#encryptKey) return { success: false, error: 'Encryption key not available' };
    const plaintext = Buffer.from(JSON.stringify(msg), 'utf-8');
    if (plaintext.length > MAX_MESSAGE_SIZE) throw new Error('Message too large');

    const ciphertext = encryptMessage(plaintext, this.#encryptKey, Number(this.#sendSequence));
    this.#sendSequence++;

    // Sign the ciphertext (not the plaintext -- ensures integrity of what's transmitted)
    let sig = null;
    if (this._mySigningPrivateKey) {
      sig = sign(ciphertext, this._mySigningPrivateKey).toString('base64');
    }

    this.#messageLog.push({ direction: 'send', type: msg.type, timestamp: msg.timestamp });
    if (this.#messageLog.length > PeerChannel.#MAX_MESSAGE_LOG) this.#messageLog.shift();
    await this.#rawSend({ encrypted: ciphertext.toString('base64'), sig });
    return { success: true, sequence: Number(this.#sendSequence - 1n) };
  }

  async #rawSend(data) {
    if (this.#sendFn) await this.#sendFn(data);
  }

  // Store signing key for message authentication
  setSigningKey(privateKey) {
    this._mySigningPrivateKey = privateKey;
  }

  // Store attestation verifier for incoming handshake acks
  setAttestationVerifier(fn) {
    this._attestationVerifyFn = fn;
  }
}

/**
 * Manages all peer connections for a vault instance.
 */
export class PeerManager {
  #channels = new Map();  // peerId -> PeerChannel
  #pairingCodes = new Map(); // code -> { peerId, expires }
  #vault;

  constructor(vault) {
    this.#vault = vault;
  }

  get channels() {
    const result = {};
    for (const [id, ch] of this.#channels) {
      result[id] = ch.stats;
    }
    return result;
  }

  getChannel(peerId) {
    return this.#channels.get(peerId);
  }

  createChannel(opts) {
    const channel = new PeerChannel(opts);
    this.#channels.set(opts.peerId, channel);
    return channel;
  }

  removeChannel(peerId) {
    const ch = this.#channels.get(peerId);
    if (ch) {
      ch.close();
      this.#channels.delete(peerId);
    }
  }

  // --- Pairing ---

  generatePairingCode() {
    // Prune expired codes before generating new ones (prevents unbounded growth)
    const now = Date.now();
    for (const [k, v] of this.#pairingCodes) {
      if (now > v.expires) this.#pairingCodes.delete(k);
    }
    // Hard cap at 100 active codes
    if (this.#pairingCodes.size >= 100) {
      return null; // caller should handle this
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No I,O,0,1 for readability
    let code = '';
    const bytes = crypto.randomBytes(8);
    for (let i = 0; i < 8; i++) {
      code += chars[bytes[i] % chars.length];
    }
    this.#pairingCodes.set(code, {
      expires: Date.now() + 5 * 60 * 1000 // 5 minutes
    });
    return code;
  }

  validatePairingCode(code) {
    const entry = this.#pairingCodes.get(code);
    if (!entry) return false;
    if (Date.now() > entry.expires) {
      this.#pairingCodes.delete(code);
      return false;
    }
    this.#pairingCodes.delete(code); // One-time use
    return true;
  }

  // --- Shutdown ---

  async closeAll() {
    for (const [, ch] of this.#channels) {
      await ch.close();
    }
    this.#channels.clear();
    this.#pairingCodes.clear();
  }
}
