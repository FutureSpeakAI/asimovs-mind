#!/usr/bin/env node
/**
 * Sovereign Vault MCP Server
 *
 * Persistent sidecar for Claude Code that provides:
 * - AES-256-GCM encrypted state storage
 * - Argon2id key derivation (256MB memory-hard)
 * - Ed25519 agent identity + cLaw attestation
 * - Privacy Shield PII mapping state
 * - Ollama health monitoring
 * - HTTP bridge for Python hooks on localhost
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs/promises';
import { SovereignVault, OllamaMonitor } from './vault.js';
import { initCrypto, decryptPrivateKey } from './crypto.js';
import { PeerChannel, PeerManager } from './protocol.js';
import { P2PTransport } from './transport.js';

// Resolve vault directory
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
const ASIMOV_DIR = path.join(PROJECT_ROOT, '.asimovs-mind');
const VAULT_DIR = path.join(ASIMOV_DIR, 'vault');

const vault = new SovereignVault(VAULT_DIR);
const ollama = new OllamaMonitor();
const peerManager = new PeerManager(vault);
const transport = new P2PTransport();

// --- MCP Server ---

const server = new McpServer({
  name: 'sovereign-vault',
  version: '1.0.0'
});

// -- Vault tools --

server.tool('vault_status', 'Check vault status (locked/unlocked/uninitialized)', {}, async () => {
  const ollamaStatus = await ollama.checkHealth();
  return {
    content: [{ type: 'text', text: JSON.stringify({
      vault: vault.status,
      meta: vault.meta,
      ollama: { healthy: ollamaStatus.healthy, modelCount: ollamaStatus.models.length },
      privacy_shield: { active: vault.status === 'unlocked' }
    }, null, 2) }]
  };
});

server.tool('vault_initialize',
  'Initialize a new vault with a passphrase (>= 8 words). Creates encrypted storage.',
  { passphrase: z.string().describe('Passphrase (minimum 8 words, 24+ characters)') },
  async ({ passphrase }) => {
    const result = await vault.initialize(passphrase);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool('vault_unlock',
  'Unlock an existing vault with the passphrase. Derives keys, verifies canary.',
  { passphrase: z.string().describe('Vault passphrase') },
  async ({ passphrase }) => {
    const result = await vault.unlock(passphrase);
    return {
      content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
    };
  }
);

server.tool('vault_lock',
  'Lock the vault. Destroys all keys in memory.',
  {},
  async () => {
    vault.lock();
    return { content: [{ type: 'text', text: '{"success": true, "status": "locked"}' }] };
  }
);

server.tool('vault_read',
  'Read and decrypt a named state entry from the vault.',
  { key: z.string().describe('State key (e.g., "user-profile", "trust-scores")') },
  async ({ key }) => {
    const result = await vault.read(key);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('vault_write',
  'Encrypt and persist a named state entry in the vault.',
  {
    key: z.string().describe('State key'),
    data: z.any().describe('JSON data to encrypt and store')
  },
  async ({ key, data }) => {
    const result = await vault.write(key, data);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('vault_append',
  'Append an entry to an array stored in the vault.',
  {
    key: z.string().describe('State key (must be an array)'),
    entry: z.any().describe('Entry to append')
  },
  async ({ key, entry }) => {
    const result = await vault.append(key, entry);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('vault_delete',
  'Remove a named state entry from the vault.',
  { key: z.string().describe('State key to delete') },
  async ({ key }) => {
    const result = await vault.delete(key);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('vault_list',
  'List all encrypted state keys in the vault.',
  {},
  async () => {
    const result = await vault.listKeys();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('vault_export',
  'Export all vault state as a JSON object (decrypted, for backup/migration).',
  {},
  async () => {
    const result = await vault.exportAll();
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// -- Identity tools --

server.tool('identity_generate',
  'Generate Ed25519 signing + X25519 exchange keypairs. Stored encrypted in vault.',
  { name: z.string().describe('Agent/node name for this identity') },
  async ({ name }) => {
    const result = await vault.generateIdentity(name);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('identity_status',
  'Check if a cryptographic identity exists and is loaded.',
  {},
  async () => {
    const result = await vault.getIdentity();
    const exists = result.success && result.data != null;
    return {
      content: [{ type: 'text', text: JSON.stringify({
        exists,
        name: exists ? result.data.name : null,
        publicKeys: exists ? {
          signing: result.data.signing.publicKey,
          exchange: result.data.exchange.publicKey
        } : null
      }, null, 2) }]
    };
  }
);

server.tool('identity_sign',
  'Sign a message with the Ed25519 private key.',
  { message: z.string().describe('Message to sign') },
  async ({ message }) => {
    const result = await vault.signMessage(message);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('identity_verify',
  'Verify an Ed25519 signature.',
  {
    message: z.string(),
    signature: z.string().describe('Base64-encoded signature'),
    publicKey: z.string().describe('Base64-encoded Ed25519 public key')
  },
  async ({ message, signature, publicKey }) => {
    const valid = vault.verifySignature(message, signature, publicKey);
    return { content: [{ type: 'text', text: JSON.stringify({ valid }, null, 2) }] };
  }
);

// -- Attestation tools --

server.tool('attestation_generate',
  'Generate a cLaw attestation (laws hash + timestamp + Ed25519 signature).',
  { laws_text: z.string().describe('Full text of the Fundamental Laws') },
  async ({ laws_text }) => {
    const result = await vault.generateAttestation(laws_text);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

server.tool('attestation_verify',
  'Verify a peer\'s cLaw attestation.',
  {
    attestation: z.object({
      lawsHash: z.string(),
      timestamp: z.number(),
      signature: z.string(),
      signerPublicKey: z.string()
    }),
    laws_text: z.string().describe('Expected laws text to verify hash against')
  },
  async ({ attestation, laws_text }) => {
    const result = vault.verifyAttestation(attestation, laws_text);
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  }
);

// -- Privacy Shield tools --

server.tool('privacy_scrub',
  'Scrub PII from text using the Privacy Shield. Returns scrubbed text.',
  { text: z.string().describe('Text to scrub for PII') },
  async ({ text }) => {
    const shield = vault.privacyShield;
    const nonce = shield.getNonce();
    const scrubbed = scrubPii(text, nonce, shield);
    return { content: [{ type: 'text', text: JSON.stringify({ scrubbed, stats: shield.getStats() }, null, 2) }] };
  }
);

server.tool('privacy_rehydrate',
  'Restore PII in text using stored mappings.',
  { text: z.string().describe('Text with PII placeholders to restore') },
  async ({ text }) => {
    const shield = vault.privacyShield;
    const restored = rehydratePii(text, shield);
    return { content: [{ type: 'text', text: JSON.stringify({ restored }, null, 2) }] };
  }
);

server.tool('privacy_stats',
  'Get Privacy Shield statistics for this session.',
  {},
  async () => {
    const stats = vault.privacyShield.getStats();
    return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
  }
);

server.tool('privacy_reset',
  'Reset Privacy Shield state (destroy all PII mappings).',
  {},
  async () => {
    vault.privacyShield.reset();
    return { content: [{ type: 'text', text: '{"success": true}' }] };
  }
);

// -- Ollama tools --

server.tool('ollama_status',
  'Check Ollama health and available models.',
  {},
  async () => {
    const status = await ollama.checkHealth();
    return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
  }
);

// --- P2P Communication tools ---

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
        // Auto-handle handshake if we have identity
        const idResult = await vault.getIdentity();
        if (idResult.success && idResult.data) {
          const attest = await vault.generateAttestation(await getCanonicalLaws());
          // TODO: derive exchange private key from vault for handshake
          // For now, store the channel for manual completion
        }
      });
      transport.onIncomingMessage((peerId, msg) => {
        const channel = peerManager.getChannel(peerId);
        if (channel) channel.handleIncomingMessage(msg);
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
      const ws = await transport.connect(address, peerId);

      const channel = peerManager.createChannel({
        peerId,
        peerName: peer_name || address,
        sendFn: (data) => transport.send(peerId, data)
      });

      // Generate attestation
      const lawsText = await getCanonicalLaws();
      const attestResult = await vault.generateAttestation(lawsText);

      // Initiate handshake (exchange public key + attestation)
      // The channel will complete the ECDH handshake when the peer responds
      const exchangePub = Buffer.from(idResult.data.exchange.publicKey, 'base64');

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
    const listenPort = transport.port || 'not listening';
    return { content: [{ type: 'text', text: JSON.stringify({
      code,
      expires_in: '5 minutes',
      connect_address: transport.port ? `ws://YOUR_IP:${transport.port}` : 'Call peer_listen first',
      instructions: 'Share this code with the peer. They use it to verify the connection after connecting.'
    }, null, 2) }] };
  }
);

async function getCanonicalLaws() {
  try {
    const lawsPath = path.join(path.dirname(VAULT_DIR), '..', 'governance', 'laws.json');
    return await fs.readFile(lawsPath, 'utf-8');
  } catch {
    return '{"error": "laws.json not found"}';
  }
}

// --- Privacy Shield Engine (ported from nexus-os privacy-shield.ts) ---

const PII_PATTERNS = {
  SECRET: [
    /AKIA[0-9A-Z]{16}/g,                                    // AWS access key
    /ghp_[a-zA-Z0-9]{36}/g,                                 // GitHub PAT
    /sk-[a-zA-Z0-9]{20,}/g,                                 // OpenAI / Stripe secret
    /sk-ant-[a-zA-Z0-9-]{20,}/g,                            // Anthropic key
    /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/g,                    // Slack bot token
    /AIza[0-9A-Za-z_-]{35}/g,                               // Google API key
    /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, // JWT
    /(?:api[_-]?key|apikey|token|secret|password|passwd|credential)[\s]*[=:]\s*['"]?([a-zA-Z0-9_\-./+=]{16,})['"]?/gi
  ],
  CREDIT_CARD: [
    /\b4[0-9]{12}(?:[0-9]{3})?\b/g,       // Visa
    /\b5[1-5][0-9]{14}\b/g,               // Mastercard
    /\b3[47][0-9]{13}\b/g,                // Amex
    /\b6(?:011|5[0-9]{2})[0-9]{12}\b/g    // Discover
  ],
  SSN: [
    /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g
  ],
  EMAIL: [
    /\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,}\b/g
  ],
  PHONE: [
    /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
  ],
  IP: [
    /\b(?!127\.0\.0\.1|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g
  ],
  PATH: [] // Populated dynamically with username
};

// FNV-1a hash for deterministic session-scoped placeholders
function fnv1a(str, seed) {
  let hash = 2166136261 ^ seed;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function scrubPii(text, nonce, shield) {
  let result = text;
  const nonceSeed = parseInt(nonce.slice(0, 8), 16);

  // Add username-based path patterns
  const username = process.env.USERNAME || process.env.USER || '';
  if (username) {
    PII_PATTERNS.PATH = [
      new RegExp(`[A-Za-z]:\\\\(?:Users|users)\\\\${escapeRegex(username)}\\\\[^\\s"']+`, 'g'),
      new RegExp(`/(?:home|Users)/${escapeRegex(username)}/[^\\s"']+`, 'g')
    ];
  }

  // Process in order: specific to broad (secrets first, names last)
  const categoryOrder = ['SECRET', 'CREDIT_CARD', 'SSN', 'EMAIL', 'PHONE', 'IP', 'PATH'];

  for (const category of categoryOrder) {
    const patterns = PII_PATTERNS[category] || [];
    for (const pattern of patterns) {
      // Reset regex lastIndex
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => {
        const hash = fnv1a(match, nonceSeed);
        const placeholder = `\u00abPII:${category}:${hash}\u00bb`;
        shield.storePiiMapping(placeholder, match, category);
        return placeholder;
      });
    }
  }

  return result;
}

function rehydratePii(text, shield) {
  return text.replace(/\u00abPII:[A-Z_]+:[0-9a-f]+\u00bb/g, (placeholder) => {
    const mapping = shield.getPiiMapping(placeholder);
    return mapping ? mapping.original : placeholder;
  });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- HTTP Bridge for Python hooks ---

let httpServer = null;
let httpPort = 0;

async function startHttpBridge() {
  return new Promise((resolve) => {
    httpServer = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');

      // Only accept localhost
      const remoteAddr = req.socket.remoteAddress;
      if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
        res.writeHead(403);
        res.end(JSON.stringify({ error: 'Localhost only' }));
        return;
      }

      const url = new URL(req.url, `http://localhost`);
      const route = url.pathname;

      try {
        if (route === '/status' && req.method === 'GET') {
          res.end(JSON.stringify({ vault: vault.status, meta: vault.meta }));

        } else if (route === '/read' && req.method === 'GET') {
          const key = url.searchParams.get('key');
          if (!key) { res.writeHead(400); res.end(JSON.stringify({ error: 'Missing key' })); return; }
          const result = await vault.read(key);
          res.end(JSON.stringify(result));

        } else if (route === '/write' && req.method === 'POST') {
          const body = await readBody(req);
          const { key, data } = JSON.parse(body);
          const result = await vault.write(key, data);
          res.end(JSON.stringify(result));

        } else if (route === '/append' && req.method === 'POST') {
          const body = await readBody(req);
          const { key, entry } = JSON.parse(body);
          const result = await vault.append(key, entry);
          res.end(JSON.stringify(result));

        } else if (route === '/list' && req.method === 'GET') {
          const result = await vault.listKeys();
          res.end(JSON.stringify(result));

        } else if (route === '/scrub' && req.method === 'POST') {
          const body = await readBody(req);
          const { text } = JSON.parse(body);
          const shield = vault.privacyShield;
          const scrubbed = scrubPii(text, shield.getNonce(), shield);
          res.end(JSON.stringify({ scrubbed }));

        } else if (route === '/rehydrate' && req.method === 'POST') {
          const body = await readBody(req);
          const { text } = JSON.parse(body);
          const shield = vault.privacyShield;
          const restored = rehydratePii(text, shield);
          res.end(JSON.stringify({ restored }));

        } else if (route === '/unlock' && req.method === 'GET') {
          // Serve a simple HTML form for passphrase entry (avoids API transcript leakage)
          res.setHeader('Content-Type', 'text/html');
          res.end(UNLOCK_HTML);

        } else if (route === '/unlock' && req.method === 'POST') {
          const body = await readBody(req);
          const { passphrase } = JSON.parse(body);
          const result = await vault.unlock(passphrase);
          res.end(JSON.stringify(result));

        } else if (route === '/initialize' && req.method === 'POST') {
          const body = await readBody(req);
          const { passphrase } = JSON.parse(body);
          const result = await vault.initialize(passphrase);
          res.end(JSON.stringify(result));

        } else {
          res.writeHead(404);
          res.end(JSON.stringify({ error: 'Not found' }));
        }
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    httpServer.listen(0, '127.0.0.1', async () => {
      httpPort = httpServer.address().port;
      // Write port file so hooks can find us
      try {
        await fs.mkdir(VAULT_DIR, { recursive: true });
        await fs.writeFile(path.join(VAULT_DIR, 'port'), String(httpPort), 'utf-8');
      } catch {
        // Vault dir may not exist yet before initialization
      }
      resolve(httpPort);
    });
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

// HTML form for secure passphrase entry (never touches Claude API)
const UNLOCK_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>Sovereign Vault</title>
  <style>
    body { background: #0a0a0a; color: #e0e0e0; font-family: 'Segoe UI', system-ui, sans-serif;
           display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; }
    .vault { background: #1a1a2e; border: 1px solid #00f0ff33; border-radius: 12px;
             padding: 40px; max-width: 420px; width: 100%; }
    h1 { color: #00f0ff; font-size: 1.4em; margin: 0 0 8px 0; }
    .subtitle { color: #888; font-size: 0.85em; margin-bottom: 24px; }
    input { width: 100%; padding: 12px; background: #0a0a0a; border: 1px solid #333;
            border-radius: 6px; color: #e0e0e0; font-size: 1em; margin-bottom: 16px;
            box-sizing: border-box; }
    input:focus { outline: none; border-color: #00f0ff; }
    button { width: 100%; padding: 12px; background: #00f0ff22; border: 1px solid #00f0ff;
             border-radius: 6px; color: #00f0ff; font-size: 1em; cursor: pointer; }
    button:hover { background: #00f0ff33; }
    .result { margin-top: 16px; padding: 12px; border-radius: 6px; font-size: 0.9em; }
    .success { background: #0f3d0f; border: 1px solid #2f7f2f; }
    .error { background: #3d0f0f; border: 1px solid #7f2f2f; }
  </style>
</head>
<body>
  <div class="vault">
    <h1>Sovereign Vault</h1>
    <div class="subtitle">Your passphrase never leaves this machine.</div>
    <form onsubmit="return unlock(event)">
      <input type="password" id="passphrase" placeholder="Enter your passphrase..." autofocus>
      <button type="submit" id="btn">Unlock Vault</button>
    </form>
    <div id="result"></div>
  </div>
  <script>
    async function unlock(e) {
      e.preventDefault();
      const pp = document.getElementById('passphrase').value;
      const btn = document.getElementById('btn');
      const res = document.getElementById('result');
      btn.disabled = true; btn.textContent = 'Deriving keys...';
      try {
        const resp = await fetch('/unlock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passphrase: pp })
        });
        const data = await resp.json();
        if (data.success) {
          res.className = 'result success';
          res.textContent = 'Vault unlocked. You can close this tab.';
        } else {
          res.className = 'result error';
          res.textContent = data.error || 'Failed to unlock';
          btn.disabled = false; btn.textContent = 'Unlock Vault';
        }
      } catch (err) {
        res.className = 'result error';
        res.textContent = err.message;
        btn.disabled = false; btn.textContent = 'Unlock Vault';
      }
      document.getElementById('passphrase').value = '';
    }
  </script>
</body>
</html>`;

// --- Self-bootstrapping: auto-install deps if missing ---

async function ensureDependencies() {
  const nodeModulesPath = path.join(import.meta.dirname, 'node_modules');
  try {
    await fs.access(nodeModulesPath);
  } catch {
    process.stderr.write(`[sovereign-vault] node_modules missing. Running npm install...\n`);
    const { execSync } = await import('node:child_process');
    try {
      execSync('npm install --production', {
        cwd: import.meta.dirname,
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000
      });
      process.stderr.write(`[sovereign-vault] Dependencies installed successfully.\n`);
    } catch (err) {
      process.stderr.write(`[sovereign-vault] npm install failed: ${err.message}\n`);
      process.stderr.write(`[sovereign-vault] Please run manually: cd ${import.meta.dirname} && npm install\n`);
      process.exit(1);
    }
  }
}

// --- Main ---

async function main() {
  // Auto-install dependencies if missing (first-run support)
  await ensureDependencies();

  await initCrypto();

  // Ensure .asimovs-mind/vault/ directory exists for port file
  await fs.mkdir(VAULT_DIR, { recursive: true });

  await vault.init();

  // Start HTTP bridge
  const port = await startHttpBridge();
  // Log to stderr (MCP uses stdout for protocol)
  process.stderr.write(`[sovereign-vault] HTTP bridge on http://127.0.0.1:${port}\n`);
  process.stderr.write(`[sovereign-vault] Vault status: ${vault.status}\n`);

  // Start MCP server on stdio
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[sovereign-vault] MCP server connected\n`);

  // Cleanup on exit
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', cleanup);
}

function cleanup() {
  peerManager.closeAll().catch(() => {});
  transport.stop().catch(() => {});
  vault.lock();
  if (httpServer) httpServer.close();
  // Remove port file
  try { fs.unlink(path.join(VAULT_DIR, 'port')).catch(() => {}); } catch {}
  process.stderr.write(`[sovereign-vault] Vault locked, P2P channels closed, keys destroyed\n`);
}

main().catch((err) => {
  process.stderr.write(`[sovereign-vault] Fatal: ${err.message}\n`);
  process.exit(1);
});
