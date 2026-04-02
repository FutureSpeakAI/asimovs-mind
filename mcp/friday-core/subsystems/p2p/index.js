/**
 * P2P Subsystem — Peer-to-peer encrypted communication tools
 *
 * Tools: peer_listen, peer_connect, peer_list, peer_send,
 *        peer_send_file, peer_disconnect, peer_pairing_code
 */

import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Subsystem } from '../../core/subsystem.js';
import { PeerManager } from './protocol.js';
import { P2PTransport } from './transport.js';
import { getCanonicalLaws } from '../identity/index.js';
import { generateExchangeKeyPair } from '../../core/crypto.js';

export class P2PSubsystem extends Subsystem {
  #peerManager;
  #transport;

  constructor(deps) {
    super('p2p', deps);
    this.#peerManager = new PeerManager(deps.vault);
    this.#transport = new P2PTransport();
  }

  get peerManager() { return this.#peerManager; }
  get transport() { return this.#transport; }

  registerTools(server) {
    const vault = this.vault;
    const peerManager = this.#peerManager;
    const transport = this.#transport;

    server.tool('peer_listen',
      'Start listening for incoming P2P connections. Returns the WebSocket port.',
      {},
      async () => {
        try {
          const port = await transport.start(0);
          // Wire up incoming handshakes
          transport.onIncomingHandshake(async (peerId, msg, respond) => {
            const channel = peerManager.createChannel({
              peerId,
              peerName: msg.peerName || 'unknown',
              sendFn: (data) => respond(data)
            });
            // Auto-complete the handshake if we have an unlocked identity
            const idResult = await vault.getIdentity();
            if (idResult.success && idResult.data) {
              try {
                const lawsText = await getCanonicalLaws();
                const attestResult = await vault.generateAttestation(lawsText);
                const exchangeKP = generateExchangeKeyPair();
                const signingKeyResult = await vault.getSigningPrivateKey();
                if (!signingKeyResult.success) {
                  process.stderr.write(`[friday:p2p] Cannot complete handshake — signing key unavailable\n`);
                  return;
                }
                await channel.handleHandshake(
                  msg,
                  exchangeKP.privateKey,
                  exchangeKP.publicKey,
                  signingKeyResult.privateKey,
                  attestResult.success ? attestResult.attestation : null,
                  null // attestation verify fn — optional for incoming
                );
                signingKeyResult.privateKey.destroy();
                exchangeKP.privateKey.destroy();
              } catch (err) {
                process.stderr.write(`[friday:p2p] Handshake completion error: ${err.message}\n`);
              }
            }
          });
          transport.onIncomingMessage(async (peerId, msg) => {
            try {
              const channel = peerManager.getChannel(peerId);
              if (channel) await channel.handleIncomingMessage(msg);
            } catch (err) {
              process.stderr.write(`[friday:p2p] Incoming message error: ${err.message}\n`);
            }
          });
          return { content: [{ type: 'text', text: JSON.stringify({
            success: true, port,
            address: `ws://localhost:${port}`
          }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
        }
      }
    );

    server.tool('peer_connect',
      'Connect to a remote Asimov Agent. Initiates encrypted handshake with cLaw attestation verification.',
      {
        address: z.string().describe('WebSocket address (ws://host:port)'),
        peer_name: z.string().optional().describe('Human-readable name for the peer')
      },
      async ({ address, peer_name }) => {
        try {
          const idResult = await vault.getIdentity();
          if (!idResult.success || !idResult.data) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'No identity. Run identity_generate first.' }) }] };
          }

          const peerId = crypto.randomUUID().slice(0, 8);
          const _ws = await transport.connect(address, peerId);

          const channel = peerManager.createChannel({
            peerId,
            peerName: peer_name || address,
            sendFn: (data) => transport.send(peerId, data)
          });

          // Generate attestation
          const lawsText = await getCanonicalLaws();
          const attestResult = await vault.generateAttestation(lawsText);

          // Generate a fresh ephemeral X25519 exchange keypair for this session
          const exchangeKP = generateExchangeKeyPair();
          const signingKeyResult = await vault.getSigningPrivateKey();
          if (!signingKeyResult.success) {
            return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Cannot retrieve signing key for handshake' }) }] };
          }

          // Initiate handshake (exchange public key + attestation)
          await channel.initiateHandshake(
            exchangeKP.privateKey,
            exchangeKP.publicKey,
            signingKeyResult.privateKey,
            attestResult.success ? attestResult.attestation : null
          );
          signingKeyResult.privateKey.destroy();
          // Note: exchangeKP.privateKey is retained on the channel (_myExchangePrivateKey)
          // and will be destroyed after handleHandshakeAck derives session keys.

          return { content: [{ type: 'text', text: JSON.stringify({
            success: true, peerId, peerName: peer_name || address,
            state: channel.state,
            attestation_sent: attestResult.success,
            note: 'Handshake initiated. Channel will open once peer responds with attestation.'
          }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
        }
      }
    );

    server.tool('peer_list',
      'List all connected peers and their channel status.',
      {},
      async () => {
        return { content: [{ type: 'text', text: JSON.stringify({
          channels: peerManager.channels,
          transport: transport.connectedPeers
        }, null, 2) }] };
      }
    );

    server.tool('peer_send',
      'Send an encrypted message to a connected peer.',
      {
        peer_id: z.string().describe('Peer ID to send to'),
        message: z.string().describe('Message text'),
        type: z.enum(['text', 'transaction', 'trust', 'attestation']).optional().default('text')
      },
      async ({ peer_id, message, type }) => {
        const channel = peerManager.getChannel(peer_id);
        if (!channel) return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Unknown peer' }) }] };
        if (channel.state !== 'open') return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: `Channel not open: ${channel.state}` }) }] };
        try {
          let result;
          if (type === 'text') result = await channel.sendText(message);
          else if (type === 'transaction') result = await channel.sendTransaction(JSON.parse(message));
          else if (type === 'trust') result = await channel.sendTrustScores(JSON.parse(message));
          else if (type === 'attestation') {
            const attest = await vault.generateAttestation(await getCanonicalLaws());
            result = await channel.sendAttestation(attest.attestation);
          }
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
        }
      }
    );

    server.tool('peer_send_file',
      'Send an encrypted file to a connected peer.',
      {
        peer_id: z.string().describe('Peer ID'),
        file_path: z.string().describe('Path to file to send'),
        file_name: z.string().optional().describe('Name to give the file on the other side')
      },
      async ({ peer_id, file_path: filePath, file_name }) => {
        const channel = peerManager.getChannel(peer_id);
        if (!channel || channel.state !== 'open') {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Channel not open' }) }] };
        }
        try {
          const data = await fs.readFile(filePath);
          const name = file_name || path.basename(filePath);
          const result = await channel.sendFile(name, data);
          return { content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }, null, 2) }] };
        } catch (err) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: err.message }) }] };
        }
      }
    );

    server.tool('peer_disconnect',
      'Close the encrypted channel to a peer and destroy session keys.',
      { peer_id: z.string() },
      async ({ peer_id }) => {
        peerManager.removeChannel(peer_id);
        transport.disconnect(peer_id);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true }) }] };
      }
    );

    server.tool('peer_pairing_code',
      'Generate an 8-character pairing code for a peer to connect. Expires in 5 minutes.',
      {},
      async () => {
        const code = peerManager.generatePairingCode();
        const _listenPort = transport.port || 'not listening';
        return { content: [{ type: 'text', text: JSON.stringify({
          code,
          expires_in: '5 minutes',
          connect_address: transport.port ? `ws://YOUR_IP:${transport.port}` : 'Call peer_listen first',
          instructions: 'Share this code with the peer. They use it to verify the connection after connecting.'
        }, null, 2) }] };
      }
    );
  }

  async stop() {
    await this.#peerManager.closeAll().catch(() => {});
    await this.#transport.stop().catch(() => {});
    await super.stop();
  }
}
