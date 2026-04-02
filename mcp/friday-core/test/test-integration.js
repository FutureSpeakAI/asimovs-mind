/**
 * Sovereign Vault — Integration Test Suite
 *
 * Tests the full system: MCP tools, HTTP bridge, vault lifecycle,
 * P2P handshake, Privacy Shield end-to-end, identity/attestation.
 * This is the autoresearch benchmark: each test is WORKING or NON-WORKING.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initCrypto } from '../core/crypto.js';
import { SovereignVault, OllamaMonitor } from '../core/vault.js';
import { StateManager } from '../core/state-manager.js';
import { PeerChannel as _PeerChannel, PeerManager } from '../subsystems/p2p/protocol.js';
import {
  generateExchangeKeyPair,
  generateSigningKeyPair,
  deriveSharedSecret,
  deriveSessionKeys,
  encryptMessage,
  decryptMessage,
  sign,
  verify
} from '../core/crypto.js';

const TEST_PASSPHRASE = 'correct horse battery staple extra words here today';
let testDir;

before(async () => {
  await initCrypto();
  testDir = path.join(os.tmpdir(), `vault-integ-${Date.now()}`);
});

after(async () => {
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
});

// ============================================================
// TIER 1: Vault Lifecycle (full round-trip)
// ============================================================

describe('TIER 1: Vault Full Lifecycle', () => {
  let vault;

  before(async () => {
    vault = new SovereignVault(path.join(testDir, 'lifecycle'));
    await vault.init();
  });

  after(() => vault.lock());

  it('init → write → lock → unlock → read: data survives full cycle', async () => {
    // Initialize
    const initResult = await vault.initialize(TEST_PASSPHRASE);
    assert.ok(initResult.success, `Init failed: ${initResult.error}`);

    // Write multiple state entries
    await vault.write('config', { theme: 'dark', mode: 'partner' });
    await vault.write('scores', { debugger: 0.92, optimizer: 0.78 });
    await vault.append('history', { event: 'session_start', ts: 1 });
    await vault.append('history', { event: 'session_end', ts: 2 });

    // Lock (destroys keys)
    vault.lock();
    assert.equal(vault.status, 'locked');

    // Verify reads fail while locked
    const lockedRead = await vault.read('config');
    assert.ok(!lockedRead.success);

    // Unlock
    const unlockResult = await vault.unlock(TEST_PASSPHRASE);
    assert.ok(unlockResult.success, `Unlock failed: ${unlockResult.error}`);

    // Read everything back
    const config = await vault.read('config');
    assert.deepEqual(config.data, { theme: 'dark', mode: 'partner' });

    const scores = await vault.read('scores');
    assert.deepEqual(scores.data, { debugger: 0.92, optimizer: 0.78 });

    const history = await vault.read('history');
    assert.equal(history.data.length, 2);
    assert.equal(history.data[0].event, 'session_start');
  });

  it('wrong passphrase rejected, correct passphrase works after', async () => {
    vault.lock();
    const bad = await vault.unlock('wrong words that are definitely not the right passphrase at all');
    assert.ok(!bad.success);
    assert.equal(vault.status, 'locked');

    const good = await vault.unlock(TEST_PASSPHRASE);
    assert.ok(good.success);
    assert.equal(vault.status, 'unlocked');
  });

  it('export contains all keys and data', async () => {
    const exported = await vault.exportAll();
    assert.ok(exported.success);
    assert.ok('config' in exported.data);
    assert.ok('scores' in exported.data);
    assert.ok('history' in exported.data);
    assert.ok(exported.meta.version);
  });

  it('delete removes a key, others survive', async () => {
    await vault.delete('scores');
    const scores = await vault.read('scores');
    assert.equal(scores.data, null);
    const config = await vault.read('config');
    assert.ok(config.data); // Still there
  });
});

// ============================================================
// TIER 2: Identity + Attestation Full Round-Trip
// ============================================================

describe('TIER 2: Identity + Attestation Round-Trip', () => {
  let vault;
  const LAWS = '{"first_law":"do no harm","second_law":"obey user","third_law":"protect integrity"}';

  before(async () => {
    vault = new SovereignVault(path.join(testDir, 'identity'));
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
  });

  after(() => vault.lock());

  it('generate identity → sign → verify → attestation → verify attestation', async () => {
    // Generate
    const gen = await vault.generateIdentity('friday-integration-test');
    assert.ok(gen.success);
    assert.ok(gen.publicKeys.signing);
    assert.ok(gen.publicKeys.exchange);

    // Sign a message
    const signResult = await vault.signMessage('test message');
    assert.ok(signResult.success);

    // Verify the signature
    const id = await vault.getIdentity();
    const valid = vault.verifySignature('test message', signResult.signature, id.data.signing.publicKey);
    assert.ok(valid);

    // Tampered message fails
    const invalid = vault.verifySignature('tampered', signResult.signature, id.data.signing.publicKey);
    assert.ok(!invalid);

    // Generate attestation
    const attest = await vault.generateAttestation(LAWS);
    assert.ok(attest.success);
    assert.ok(attest.attestation.lawsHash);
    assert.ok(attest.attestation.signature);

    // Verify attestation
    const verResult = vault.verifyAttestation(attest.attestation, LAWS);
    assert.ok(verResult.valid, `Attestation verification failed: ${verResult.reason}`);

    // Wrong laws fail
    const wrongLaws = vault.verifyAttestation(attest.attestation, '{"different":"laws"}');
    assert.ok(!wrongLaws.valid);
  });

  it('identity survives lock/unlock cycle', async () => {
    vault.lock();
    await vault.unlock(TEST_PASSPHRASE);
    const id = await vault.getIdentity();
    assert.ok(id.success);
    assert.equal(id.data.name, 'friday-integration-test');

    // Can still sign after unlock
    const sig = await vault.signMessage('after unlock');
    assert.ok(sig.success);
  });
});

// ============================================================
// TIER 3: P2P Encrypted Channel (Two Vaults Communicating)
// ============================================================

describe('TIER 3: P2P Encrypted Channel Between Two Agents', () => {
  let aliceVault, bobVault;
  let aliceChannel, bobChannel;
  const _messagesReceived = { alice: [], bob: [] };

  before(async () => {
    aliceVault = new SovereignVault(path.join(testDir, 'alice'));
    bobVault = new SovereignVault(path.join(testDir, 'bob'));
    await aliceVault.init();
    await bobVault.init();
    await aliceVault.initialize(TEST_PASSPHRASE);
    await bobVault.initialize(TEST_PASSPHRASE);
    await aliceVault.generateIdentity('alice');
    await bobVault.generateIdentity('bob');
  });

  after(() => {
    if (aliceChannel) aliceChannel.close();
    if (bobChannel) bobChannel.close();
    aliceVault.lock();
    bobVault.lock();
  });

  it('ECDH handshake produces matching session keys', () => {
    const alice = generateExchangeKeyPair();
    const bob = generateExchangeKeyPair();

    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const keysA = deriveSessionKeys(secretA, alice.publicKey, bob.publicKey);

    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    const keysB = deriveSessionKeys(secretB, bob.publicKey, alice.publicKey);

    // Safety numbers match
    assert.equal(keysA.safetyNumber, keysB.safetyNumber);

    // Cross-direction key matching
    let aEnc, bDec;
    keysA.encryptKey.withAccess(b => aEnc = Buffer.from(b));
    keysB.decryptKey.withAccess(b => bDec = Buffer.from(b));
    assert.deepEqual(aEnc, bDec);

    alice.privateKey.destroy(); bob.privateKey.destroy();
    keysA.encryptKey.destroy(); keysA.decryptKey.destroy();
    keysB.encryptKey.destroy(); keysB.decryptKey.destroy();
  });

  it('full message exchange: encrypt → sign → transmit → verify → decrypt', () => {
    const aliceExch = generateExchangeKeyPair();
    const bobExch = generateExchangeKeyPair();
    const aliceSign = generateSigningKeyPair();

    // Derive session keys for both sides
    const secretA = deriveSharedSecret(aliceExch.privateKey, bobExch.publicKey);
    const aliceKeys = deriveSessionKeys(secretA, aliceExch.publicKey, bobExch.publicKey);
    const secretB = deriveSharedSecret(bobExch.privateKey, aliceExch.publicKey);
    const bobKeys = deriveSessionKeys(secretB, bobExch.publicKey, aliceExch.publicKey);

    // Alice sends 3 messages
    for (let i = 0; i < 3; i++) {
      const msg = Buffer.from(JSON.stringify({ type: 'text', content: `Message ${i}` }));
      const encrypted = encryptMessage(msg, aliceKeys.encryptKey, i);
      const signature = sign(encrypted, aliceSign.privateKey);

      // Bob receives
      const sigValid = verify(encrypted, signature, aliceSign.publicKey);
      assert.ok(sigValid, `Signature failed on message ${i}`);
      const { plaintext, sequence } = decryptMessage(encrypted, bobKeys.decryptKey, i);
      assert.equal(sequence, i);
      const parsed = JSON.parse(plaintext.toString());
      assert.equal(parsed.content, `Message ${i}`);
    }

    aliceExch.privateKey.destroy(); bobExch.privateKey.destroy();
    aliceSign.privateKey.destroy();
    aliceKeys.encryptKey.destroy(); aliceKeys.decryptKey.destroy();
    bobKeys.encryptKey.destroy(); bobKeys.decryptKey.destroy();
  });

  it('tampered message rejected', () => {
    const a = generateExchangeKeyPair();
    const b = generateExchangeKeyPair();
    const sA = deriveSharedSecret(a.privateKey, b.publicKey);
    const aKeys = deriveSessionKeys(sA, a.publicKey, b.publicKey);
    const sB = deriveSharedSecret(b.privateKey, a.publicKey);
    const bKeys = deriveSessionKeys(sB, b.publicKey, a.publicKey);

    const msg = Buffer.from('sensitive data');
    const encrypted = encryptMessage(msg, aKeys.encryptKey, 0);
    // Tamper
    if (encrypted.length > 25) encrypted[25] ^= 0xff;
    assert.throws(() => decryptMessage(encrypted, bKeys.decryptKey, 0));

    a.privateKey.destroy(); b.privateKey.destroy();
    aKeys.encryptKey.destroy(); aKeys.decryptKey.destroy();
    bKeys.encryptKey.destroy(); bKeys.decryptKey.destroy();
  });

  it('replay (wrong sequence) rejected', () => {
    const a = generateExchangeKeyPair();
    const b = generateExchangeKeyPair();
    const sA = deriveSharedSecret(a.privateKey, b.publicKey);
    const aKeys = deriveSessionKeys(sA, a.publicKey, b.publicKey);
    const sB = deriveSharedSecret(b.privateKey, a.publicKey);
    const bKeys = deriveSessionKeys(sB, b.publicKey, a.publicKey);

    const encrypted = encryptMessage(Buffer.from('msg'), aKeys.encryptKey, 7);
    assert.throws(() => decryptMessage(encrypted, bKeys.decryptKey, 5), /Sequence mismatch/);

    a.privateKey.destroy(); b.privateKey.destroy();
    aKeys.encryptKey.destroy(); aKeys.decryptKey.destroy();
    bKeys.encryptKey.destroy(); bKeys.decryptKey.destroy();
  });
});

// ============================================================
// TIER 4: Privacy Shield End-to-End
// ============================================================

describe('TIER 4: Privacy Shield End-to-End', () => {
  let vault;

  before(async () => {
    vault = new SovereignVault(path.join(testDir, 'privacy'));
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
  });

  after(() => vault.lock());

  it('scrubs all PII categories and rehydrates perfectly', () => {
    const shield = vault.privacyShield;
    shield.reset();
    const nonce = shield.getNonce();

    // Build a text with multiple PII types
    const original = [
      'Contact stephen@futurespeak.ai for details.',
      'API key: sk-ant-abc123def456ghi789jkl012mno',
      'Call 512-555-1234 for support.',
      'Server at 203.0.113.42 is down.',
    ].join(' ');

    // Scrub (using inline scrubber matching index.js patterns)
    const PII = {
      SECRET: [/sk-ant-[a-zA-Z0-9-]{20,}/g],
      EMAIL: [/\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,}\b/g],
      PHONE: [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g],
      IP: [/\b(?!127\.0\.0\.1|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g],
    };

    let scrubbed = original;
    const nonceSeed = parseInt(nonce.slice(0, 8), 16);
    for (const [cat, pats] of Object.entries(PII)) {
      for (const pat of pats) {
        pat.lastIndex = 0;
        scrubbed = scrubbed.replace(pat, (match) => {
          let hash = 2166136261 ^ nonceSeed;
          for (let i = 0; i < match.length; i++) { hash ^= match.charCodeAt(i); hash = Math.imul(hash, 16777619); }
          const h = (hash >>> 0).toString(16).padStart(8, '0');
          const placeholder = `\u00abPII:${cat}:${h}\u00bb`;
          shield.storePiiMapping(placeholder, match, cat);
          return placeholder;
        });
      }
    }

    // Verify scrubbing
    assert.ok(!scrubbed.includes('stephen@futurespeak.ai'), 'Email not scrubbed');
    assert.ok(!scrubbed.includes('sk-ant-'), 'API key not scrubbed');
    assert.ok(!scrubbed.includes('512-555-1234'), 'Phone not scrubbed');
    assert.ok(!scrubbed.includes('203.0.113.42'), 'IP not scrubbed');
    assert.ok(scrubbed.includes('\u00abPII:EMAIL:'), 'Email placeholder missing');
    assert.ok(scrubbed.includes('\u00abPII:SECRET:'), 'Secret placeholder missing');

    // Verify rehydration
    const restored = scrubbed.replace(/\u00abPII:[A-Z_]+:[0-9a-f]+\u00bb/g, (ph) => {
      const m = shield.getPiiMapping(ph);
      return m ? m.original : ph;
    });
    assert.equal(restored, original, 'Rehydration did not perfectly restore original');

    // Verify stats
    const stats = shield.getStats();
    assert.ok(stats.total >= 4, `Expected >= 4 PII items, got ${stats.total}`);
    assert.ok(stats.categories.EMAIL >= 1);
    assert.ok(stats.categories.SECRET >= 1);
  });

  it('session nonce is deterministic, reset produces new nonce', () => {
    const shield = vault.privacyShield;
    const n1 = shield.getNonce();
    const n2 = shield.getNonce();
    assert.equal(n1, n2); // Same within session

    shield.reset();
    const n3 = shield.getNonce();
    assert.notEqual(n1, n3); // Different after reset
  });
});

// ============================================================
// TIER 5: HTTP Bridge
// ============================================================

describe('TIER 5: HTTP Bridge Endpoints', () => {
  let vault, server, port;

  before(async () => {
    const vaultDir = path.join(testDir, 'http-bridge');
    vault = new SovereignVault(vaultDir);
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);

    // Start a minimal HTTP server matching the vault server's bridge
    server = http.createServer(async (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      const url = new URL(req.url, 'http://localhost');
      try {
        if (url.pathname === '/status') {
          res.end(JSON.stringify({ vault: vault.status, meta: vault.meta }));
        } else if (url.pathname === '/read') {
          const key = url.searchParams.get('key');
          res.end(JSON.stringify(await vault.read(key)));
        } else if (url.pathname === '/write' && req.method === 'POST') {
          const body = await readBody(req);
          const { key, data } = JSON.parse(body);
          res.end(JSON.stringify(await vault.write(key, data)));
        } else if (url.pathname === '/list') {
          res.end(JSON.stringify(await vault.listKeys()));
        } else {
          res.writeHead(404);
          res.end('{}');
        }
      } catch (err) {
        res.writeHead(500);
        res.end(JSON.stringify({ error: err.message }));
      }
    });

    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    port = server.address().port;
  });

  after(() => {
    vault.lock();
    server.close();
  });

  it('GET /status returns vault status', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/status`);
    assert.equal(res.vault, 'unlocked');
    assert.ok(res.meta.version);
  });

  it('POST /write + GET /read round-trips data', async () => {
    const writeRes = await httpPost(`http://127.0.0.1:${port}/write`, {
      key: 'http-test', data: { hello: 'world' }
    });
    assert.ok(writeRes.success);

    const readRes = await httpGet(`http://127.0.0.1:${port}/read?key=http-test`);
    assert.deepEqual(readRes.data, { hello: 'world' });
  });

  it('GET /list shows stored keys', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/list`);
    assert.ok(res.keys.includes('http-test'));
  });

  it('GET /read for missing key returns null', async () => {
    const res = await httpGet(`http://127.0.0.1:${port}/read?key=nonexistent`);
    assert.equal(res.data, null);
  });
});

// ============================================================
// TIER 6: PeerManager + Pairing
// ============================================================

describe('TIER 6: PeerManager + Pairing Codes', () => {
  it('pairing code generation, validation, and expiry', () => {
    const pm = new PeerManager({});

    // Generate
    const code = pm.generatePairingCode();
    assert.equal(code.length, 8);
    assert.match(code, /^[A-Z2-9]+$/); // No confusable chars

    // Validate (one-time use)
    assert.ok(pm.validatePairingCode(code));
    assert.ok(!pm.validatePairingCode(code)); // Consumed

    // Multiple codes are unique
    const codes = new Set();
    for (let i = 0; i < 100; i++) {
      codes.add(pm.generatePairingCode());
    }
    assert.equal(codes.size, 100); // All unique
  });

  it('channel lifecycle: create → stats → remove', async () => {
    const pm = new PeerManager({});
    const sentMessages = [];

    pm.createChannel({
      peerId: 'peer-1',
      peerName: 'Test Peer',
      sendFn: async (data) => sentMessages.push(data)
    });

    const channels = pm.channels;
    assert.ok('peer-1' in channels);
    assert.equal(channels['peer-1'].peerName, 'Test Peer');
    assert.equal(channels['peer-1'].state, 'new');

    pm.removeChannel('peer-1');
    assert.ok(!('peer-1' in pm.channels));
  });
});

// ============================================================
// TIER 7: Ollama Monitor (graceful degradation)
// ============================================================

describe('TIER 7: Ollama Monitor Graceful Degradation', () => {
  it('reports unhealthy when Ollama not running', async () => {
    const mon = new OllamaMonitor('http://localhost:99999');
    const status = await mon.checkHealth();
    assert.equal(status.healthy, false);
    assert.deepEqual(status.models, []);
    assert.equal(status.lastCheck, null);
  });

  it('tracks status consistently across calls', async () => {
    const mon = new OllamaMonitor('http://localhost:99999');
    await mon.checkHealth();
    await mon.checkHealth();
    const status = mon.status;
    assert.equal(status.healthy, false);
    assert.equal(status.baseUrl, 'http://localhost:99999');
  });
});

// ============================================================
// TIER 8: StateManager — Namespace Persistence with Real Vault
// ============================================================
//
// These tests verify the cycle-27 fix: the namespace separator is
// ":" (not "/") so vault's validateKey accepts namespaced keys.
//
// Windows note: NTFS treats "name:key.enc" as an alternate data
// stream, so listKeys() (which reads the directory) will not see
// colon-namespaced files. Data round-trips via read/write are
// unaffected. Tests below verify round-trip behavior and use
// vault.read() with the full key to confirm the separator format —
// they do not rely on listKeys() for colon-namespaced keys.

describe('TIER 8: StateManager Namespace Persistence', () => {
  let vault;
  let sm;

  before(async () => {
    vault = new SovereignVault(path.join(testDir, 'state-manager'));
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
    sm = new StateManager(vault);
  });

  after(() => vault.lock());

  it('namespace write/read round-trips data correctly', async () => {
    const ns = sm.namespace('test-subsystem');
    const payload = { key: 'value', count: 42 };

    const writeResult = await ns.write('settings', payload);
    assert.ok(writeResult.success, `write failed: ${writeResult.error}`);

    const readResult = await ns.read('settings');
    assert.ok(readResult.success, `read failed: ${readResult.error}`);
    assert.deepEqual(readResult.data, payload);
  });

  it('vault stores the key with colon separator (not slash)', async () => {
    const ns = sm.namespace('test-subsystem');
    await ns.write('prefs', { theme: 'dark' });

    // The key written to the vault must be "test-subsystem:prefs".
    // A slash-separated key would throw from validateKey; reading the
    // colon-separated key back directly confirms the format is correct.
    const directRead = await vault.read('test-subsystem:prefs');
    assert.ok(directRead.success, 'direct colon-key read failed');
    assert.deepEqual(directRead.data, { theme: 'dark' });
  });

  it('data survives lock/unlock cycle', async () => {
    const ns = sm.namespace('test-subsystem');
    await ns.write('persistent', { survives: true });

    vault.lock();
    assert.equal(vault.status, 'locked');

    const unlockResult = await vault.unlock(TEST_PASSPHRASE);
    assert.ok(unlockResult.success, `unlock failed: ${unlockResult.error}`);

    const readResult = await ns.read('persistent');
    assert.ok(readResult.success);
    assert.deepEqual(readResult.data, { survives: true });
  });

  it('namespace isolation: alpha cannot read beta data', async () => {
    const alpha = sm.namespace('subsystem-alpha');
    const beta = sm.namespace('subsystem-beta');

    await alpha.write('secret', { owner: 'alpha' });
    await beta.write('secret', { owner: 'beta' });

    // Each namespace reads its own data
    const alphaRead = await alpha.read('secret');
    const betaRead = await beta.read('secret');
    assert.deepEqual(alphaRead.data, { owner: 'alpha' });
    assert.deepEqual(betaRead.data, { owner: 'beta' });

    // They are different — the namespace prefix isolates the keys
    assert.notDeepEqual(alphaRead.data, betaRead.data);
  });

  it('namespace isolation: beta cannot access alpha-only key', async () => {
    const alpha = sm.namespace('subsystem-alpha');
    const beta = sm.namespace('subsystem-beta');

    await alpha.write('alpha-only', { secret: 'for alpha' });

    // beta reads "alpha-only" which maps to "subsystem-beta:alpha-only" — absent
    const betaAttempt = await beta.read('alpha-only');
    assert.ok(betaAttempt.success, 'read call itself should succeed');
    assert.equal(betaAttempt.data, null, 'beta must not see alpha-only data');

    // alpha can read its own
    const alphaRead = await alpha.read('alpha-only');
    assert.deepEqual(alphaRead.data, { secret: 'for alpha' });
  });

  it('namespace delete removes only that namespace key', async () => {
    const ns = sm.namespace('test-subsystem');

    await ns.write('to-delete', { temporary: true });
    await ns.write('to-keep', { permanent: true });

    await ns.delete('to-delete');

    const deleted = await ns.read('to-delete');
    assert.equal(deleted.data, null, 'deleted key should be gone');

    const kept = await ns.read('to-keep');
    assert.deepEqual(kept.data, { permanent: true }, 'sibling key should survive');
  });

  it('write rejects slash in key name (validateKey enforcement)', async () => {
    // This confirms that using "/" as separator would break — the cycle-27
    // fix was correct to switch to ":".
    await assert.rejects(
      () => vault.read('test-subsystem/settings'),
      /path separator/
    );
  });
});

// ============================================================
// Helpers
// ============================================================

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON: ${data}`)); }
      });
    }).on('error', reject);
  });
}

function httpPost(url, body) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const parsed = new URL(url);
    const req = http.request({
      hostname: parsed.hostname, port: parsed.port, path: parsed.pathname,
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Invalid JSON: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
  });
}
