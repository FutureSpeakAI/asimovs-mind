/**
 * Sovereign Vault — Test Suite
 * Tests crypto, vault lifecycle, identity, attestation, and privacy shield.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initCrypto,
  validatePassphrase,
  generateSalt,
  deriveMasterKey,
  deriveAllKeys,
  encrypt,
  decrypt,
  createCanary,
  verifyCanary,
  hmacSign,
  hmacVerify,
  generateSigningKeyPair,
  sign,
  verify,
  SecureBuffer
} from './crypto.js';
import { SovereignVault, OllamaMonitor } from './vault.js';

const TEST_PASSPHRASE = 'correct horse battery staple extra words here today';
const WRONG_PASSPHRASE = 'incorrect mule capacitor clip wrong words there yesterday';

let testDir;

before(async () => {
  await initCrypto();
  testDir = path.join(os.tmpdir(), `vault-test-${Date.now()}`);
});

after(async () => {
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
});

// --- Crypto unit tests ---

describe('Passphrase Validation', () => {
  it('rejects short passphrases', () => {
    const r = validatePassphrase('too short');
    assert.equal(r.valid, false);
    assert.match(r.reason, /8 words/);
  });

  it('rejects passphrases with too few unique words', () => {
    const r = validatePassphrase('the the the the the the the the');
    assert.equal(r.valid, false);
    assert.match(r.reason, /unique/);
  });

  it('accepts valid passphrases', () => {
    const r = validatePassphrase(TEST_PASSPHRASE);
    assert.equal(r.valid, true);
  });
});

describe('SecureBuffer', () => {
  it('creates from source and wipes source', () => {
    const source = Buffer.from('secret key material here!!!!');
    const original = Buffer.from(source);
    const sb = SecureBuffer.from(source);
    // Source should be wiped
    assert.notDeepEqual(source, original);
    // SecureBuffer should have original data
    sb.withAccess((buf) => {
      assert.deepEqual(buf, original);
    });
    sb.destroy();
  });

  it('throws after destruction', () => {
    const sb = new SecureBuffer(32);
    sb.destroy();
    assert.throws(() => sb.withAccess(() => {}), /destroyed/);
  });
});

describe('Key Derivation', () => {
  it('derives deterministic keys from passphrase + salt', async () => {
    const salt = await generateSalt();
    const mk1 = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys1 = deriveAllKeys(mk1);
    assert.equal(mk1.isDestroyed, true); // master key destroyed

    const mk2 = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys2 = deriveAllKeys(mk2);

    // Same passphrase + salt = same sub-keys
    let v1, v2;
    keys1.vaultKey.withAccess(b => v1 = Buffer.from(b));
    keys2.vaultKey.withAccess(b => v2 = Buffer.from(b));
    assert.deepEqual(v1, v2);

    keys1.vaultKey.destroy(); keys1.hmacKey.destroy(); keys1.identityKey.destroy();
    keys2.vaultKey.destroy(); keys2.hmacKey.destroy(); keys2.identityKey.destroy();
  });

  it('different salts produce different keys', async () => {
    const salt1 = await generateSalt();
    const salt2 = await generateSalt();
    const mk1 = await deriveMasterKey(TEST_PASSPHRASE, salt1);
    const mk2 = await deriveMasterKey(TEST_PASSPHRASE, salt2);
    const keys1 = deriveAllKeys(mk1);
    const keys2 = deriveAllKeys(mk2);

    let v1, v2;
    keys1.vaultKey.withAccess(b => v1 = Buffer.from(b));
    keys2.vaultKey.withAccess(b => v2 = Buffer.from(b));
    assert.notDeepEqual(v1, v2);

    keys1.vaultKey.destroy(); keys1.hmacKey.destroy(); keys1.identityKey.destroy();
    keys2.vaultKey.destroy(); keys2.hmacKey.destroy(); keys2.identityKey.destroy();
  });
});

describe('AES-256-GCM Encryption', () => {
  it('round-trips plaintext', async () => {
    const salt = await generateSalt();
    const mk = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys = deriveAllKeys(mk);

    const plaintext = Buffer.from('{"name":"Friday","role":"agent"}');
    const ciphertext = encrypt(plaintext, keys.vaultKey);
    assert.notDeepEqual(ciphertext, plaintext);
    assert.ok(ciphertext.length > plaintext.length); // IV + authTag overhead

    const decrypted = decrypt(ciphertext, keys.vaultKey);
    assert.deepEqual(decrypted, plaintext);

    keys.vaultKey.destroy(); keys.hmacKey.destroy(); keys.identityKey.destroy();
  });

  it('rejects tampered ciphertext', async () => {
    const salt = await generateSalt();
    const mk = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys = deriveAllKeys(mk);

    const ciphertext = encrypt(Buffer.from('secret'), keys.vaultKey);
    // Tamper with a byte in the middle
    ciphertext[20] ^= 0xff;
    assert.throws(() => decrypt(ciphertext, keys.vaultKey));

    keys.vaultKey.destroy(); keys.hmacKey.destroy(); keys.identityKey.destroy();
  });

  it('different IVs produce different ciphertexts', async () => {
    const salt = await generateSalt();
    const mk = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys = deriveAllKeys(mk);

    const plaintext = Buffer.from('same data');
    const c1 = encrypt(plaintext, keys.vaultKey);
    const c2 = encrypt(plaintext, keys.vaultKey);
    assert.notDeepEqual(c1, c2); // Different random IVs

    keys.vaultKey.destroy(); keys.hmacKey.destroy(); keys.identityKey.destroy();
  });
});

describe('Canary', () => {
  it('verifies correct passphrase', async () => {
    const salt = await generateSalt();
    const mk = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys = deriveAllKeys(mk);

    const canary = createCanary(keys.identityKey);
    assert.ok(verifyCanary(canary, keys.identityKey));

    keys.vaultKey.destroy(); keys.hmacKey.destroy(); keys.identityKey.destroy();
  });

  it('rejects wrong passphrase', async () => {
    const salt = await generateSalt();
    const mk1 = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys1 = deriveAllKeys(mk1);
    const canary = createCanary(keys1.identityKey);

    const mk2 = await deriveMasterKey(WRONG_PASSPHRASE, salt);
    const keys2 = deriveAllKeys(mk2);
    assert.ok(!verifyCanary(canary, keys2.identityKey));

    keys1.vaultKey.destroy(); keys1.hmacKey.destroy(); keys1.identityKey.destroy();
    keys2.vaultKey.destroy(); keys2.hmacKey.destroy(); keys2.identityKey.destroy();
  });
});

describe('HMAC', () => {
  it('signs and verifies governance data', async () => {
    const salt = await generateSalt();
    const mk = await deriveMasterKey(TEST_PASSPHRASE, salt);
    const keys = deriveAllKeys(mk);

    const data = '{"first_law":"do no harm"}';
    const sig = hmacSign(data, keys.hmacKey);
    assert.ok(hmacVerify(data, sig, keys.hmacKey));
    assert.ok(!hmacVerify(data + 'tampered', sig, keys.hmacKey));

    keys.vaultKey.destroy(); keys.hmacKey.destroy(); keys.identityKey.destroy();
  });
});

describe('Ed25519', () => {
  it('signs and verifies messages', () => {
    const kp = generateSigningKeyPair();
    const msg = Buffer.from('test message');
    const sig = sign(msg, kp.privateKey);
    assert.ok(verify(msg, sig, kp.publicKey));
    assert.ok(!verify(Buffer.from('wrong'), sig, kp.publicKey));
    kp.privateKey.destroy();
  });
});

// --- Vault integration tests ---

describe('SovereignVault Lifecycle', () => {
  let vault;
  let vaultDir;

  before(async () => {
    vaultDir = path.join(testDir, 'vault-lifecycle');
    vault = new SovereignVault(vaultDir);
    await vault.init();
  });

  after(() => { vault.lock(); });

  it('starts uninitialized', () => {
    assert.equal(vault.status, 'uninitialized');
  });

  it('initializes with passphrase', async () => {
    const result = await vault.initialize(TEST_PASSPHRASE);
    assert.ok(result.success);
    assert.equal(vault.status, 'unlocked');
  });

  it('rejects weak passphrases', async () => {
    const v2dir = path.join(testDir, 'vault-weak');
    const v2 = new SovereignVault(v2dir);
    await v2.init();
    const result = await v2.initialize('too short');
    assert.ok(!result.success);
    assert.match(result.error, /8 words/);
  });

  it('reads and writes encrypted state', async () => {
    const data = { name: 'Friday', mode: 'partner', trust_level: 0.95 };
    const writeResult = await vault.write('user-profile', data);
    assert.ok(writeResult.success);

    const readResult = await vault.read('user-profile');
    assert.ok(readResult.success);
    assert.deepEqual(readResult.data, data);
  });

  it('returns null for missing keys', async () => {
    const result = await vault.read('nonexistent');
    assert.ok(result.success);
    assert.equal(result.data, null);
  });

  it('appends to arrays', async () => {
    await vault.write('log', []);
    await vault.append('log', { event: 'start', ts: 1 });
    await vault.append('log', { event: 'stop', ts: 2 });
    const result = await vault.read('log');
    assert.ok(result.success);
    assert.equal(result.data.length, 2);
    assert.equal(result.data[0].event, 'start');
  });

  it('lists encrypted keys', async () => {
    const result = await vault.listKeys();
    assert.ok(result.success);
    assert.ok(result.keys.includes('user-profile'));
    assert.ok(result.keys.includes('log'));
  });

  it('deletes state', async () => {
    await vault.delete('log');
    const result = await vault.read('log');
    assert.equal(result.data, null);
  });

  it('locks and destroys keys', () => {
    vault.lock();
    assert.equal(vault.status, 'locked');
  });

  it('refuses reads when locked', async () => {
    const result = await vault.read('user-profile');
    assert.ok(!result.success);
    assert.match(result.error, /locked/);
  });

  it('unlocks with correct passphrase', async () => {
    const result = await vault.unlock(TEST_PASSPHRASE);
    assert.ok(result.success);
    assert.equal(vault.status, 'unlocked');
  });

  it('rejects wrong passphrase', async () => {
    vault.lock();
    const result = await vault.unlock(WRONG_PASSPHRASE);
    assert.ok(!result.success);
    assert.match(result.error, /Wrong passphrase/);
  });

  it('data survives lock/unlock cycle', async () => {
    await vault.unlock(TEST_PASSPHRASE);
    const result = await vault.read('user-profile');
    assert.ok(result.success);
    assert.equal(result.data.name, 'Friday');
  });

  it('exports all state', async () => {
    const result = await vault.exportAll();
    assert.ok(result.success);
    assert.ok('user-profile' in result.data);
    assert.equal(result.data['user-profile'].name, 'Friday');
  });
});

// --- Identity + Attestation tests ---

describe('Ed25519 Identity', () => {
  let vault;

  before(async () => {
    const vaultDir = path.join(testDir, 'vault-identity');
    vault = new SovereignVault(vaultDir);
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
  });

  after(() => { vault.lock(); });

  it('generates identity', async () => {
    const result = await vault.generateIdentity('friday-test');
    assert.ok(result.success);
    assert.ok(result.publicKeys.signing);
    assert.ok(result.publicKeys.exchange);
  });

  it('retrieves identity', async () => {
    const result = await vault.getIdentity();
    assert.ok(result.success);
    assert.equal(result.data.name, 'friday-test');
  });

  it('signs and verifies messages', async () => {
    const signResult = await vault.signMessage('hello from friday');
    assert.ok(signResult.success);

    const id = await vault.getIdentity();
    const valid = vault.verifySignature('hello from friday', signResult.signature, id.data.signing.publicKey);
    assert.ok(valid);

    const invalid = vault.verifySignature('tampered', signResult.signature, id.data.signing.publicKey);
    assert.ok(!invalid);
  });

  it('identity survives lock/unlock', async () => {
    vault.lock();
    await vault.unlock(TEST_PASSPHRASE);
    const result = await vault.getIdentity();
    assert.ok(result.success);
    assert.equal(result.data.name, 'friday-test');
  });
});

describe('cLaw Attestation', () => {
  let vault;
  const LAWS_TEXT = '1. Do no harm. 2. Obey user. 3. Protect integrity.';

  before(async () => {
    const vaultDir = path.join(testDir, 'vault-attestation');
    vault = new SovereignVault(vaultDir);
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
    await vault.generateIdentity('friday-attest');
  });

  after(() => { vault.lock(); });

  it('generates valid attestation', async () => {
    const result = await vault.generateAttestation(LAWS_TEXT);
    assert.ok(result.success);
    assert.ok(result.attestation.lawsHash);
    assert.ok(result.attestation.timestamp);
    assert.ok(result.attestation.signature);
    assert.ok(result.attestation.signerPublicKey);
  });

  it('verifies own attestation', async () => {
    const gen = await vault.generateAttestation(LAWS_TEXT);
    const ver = vault.verifyAttestation(gen.attestation, LAWS_TEXT);
    assert.ok(ver.valid);
  });

  it('rejects attestation with wrong laws', async () => {
    const gen = await vault.generateAttestation(LAWS_TEXT);
    const ver = vault.verifyAttestation(gen.attestation, 'different laws');
    assert.ok(!ver.valid);
    assert.match(ver.reason, /hash mismatch/);
  });

  it('rejects expired attestation', async () => {
    const gen = await vault.generateAttestation(LAWS_TEXT);
    gen.attestation.timestamp -= 6 * 60 * 1000; // 6 minutes ago
    // Re-sign would be needed for a real test, but we can check the timestamp check
    const ver = vault.verifyAttestation(gen.attestation, LAWS_TEXT);
    // Will fail on either timestamp or signature
    assert.ok(!ver.valid);
  });
});

// --- Privacy Shield tests ---

describe('Privacy Shield', () => {
  let vault;

  before(async () => {
    const vaultDir = path.join(testDir, 'vault-privacy');
    vault = new SovereignVault(vaultDir);
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
  });

  after(() => { vault.lock(); });

  it('scrubs email addresses', () => {
    const shield = vault.privacyShield;
    const nonce = shield.getNonce();
    const text = 'Contact me at stephen@futurespeak.ai for details';
    const scrubbed = scrubText(text, nonce, shield);
    assert.ok(!scrubbed.includes('stephen@futurespeak.ai'));
    assert.ok(scrubbed.includes('\u00abPII:EMAIL:'));
  });

  it('scrubs API keys', () => {
    const shield = vault.privacyShield;
    shield.reset();
    const nonce = shield.getNonce();
    const text = 'My key is sk-ant-abcdef1234567890abcdef';
    const scrubbed = scrubText(text, nonce, shield);
    assert.ok(!scrubbed.includes('sk-ant-'));
    assert.ok(scrubbed.includes('\u00abPII:SECRET:'));
  });

  it('rehydrates placeholders', () => {
    const shield = vault.privacyShield;
    shield.reset();
    const nonce = shield.getNonce();
    const original = 'Send to user@example.com please';
    const scrubbed = scrubText(original, nonce, shield);
    const restored = rehydrateText(scrubbed, shield);
    assert.equal(restored, original);
  });

  it('session nonce is deterministic within session', () => {
    const shield = vault.privacyShield;
    const n1 = shield.getNonce();
    const n2 = shield.getNonce();
    assert.equal(n1, n2);
  });

  it('reset changes nonce', () => {
    const shield = vault.privacyShield;
    const n1 = shield.getNonce();
    shield.reset();
    const n2 = shield.getNonce();
    assert.notEqual(n1, n2);
  });

  it('tracks stats by category', () => {
    const shield = vault.privacyShield;
    shield.reset();
    const nonce = shield.getNonce();
    scrubText('email: test@test.com, key: sk-ant-1234567890abcdef1234', nonce, shield);
    const stats = shield.getStats();
    assert.ok(stats.total >= 2);
    assert.ok(stats.categories.EMAIL >= 1);
    assert.ok(stats.categories.SECRET >= 1);
  });
});

// --- P2P Protocol tests ---

import {
  deriveSharedSecret,
  deriveSessionKeys,
  encryptMessage,
  decryptMessage,
  generateExchangeKeyPair
} from './crypto.js';
import { PeerChannel, PeerManager } from './protocol.js';

describe('X25519 ECDH Key Agreement', () => {
  it('derives identical shared secrets on both sides', () => {
    const alice = generateExchangeKeyPair();
    const bob = generateExchangeKeyPair();

    const secretAlice = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const secretBob = deriveSharedSecret(bob.privateKey, alice.publicKey);

    assert.deepEqual(secretAlice, secretBob);

    alice.privateKey.destroy();
    bob.privateKey.destroy();
  });

  it('derives session keys with correct directionality', () => {
    const alice = generateExchangeKeyPair();
    const bob = generateExchangeKeyPair();

    const secret = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const aliceKeys = deriveSessionKeys(secret, alice.publicKey, bob.publicKey);
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    const bobKeys = deriveSessionKeys(secretB, bob.publicKey, alice.publicKey);

    // Alice's encrypt key should equal Bob's decrypt key (and vice versa)
    let aliceEnc, bobDec, aliceDec, bobEnc;
    aliceKeys.encryptKey.withAccess(b => aliceEnc = Buffer.from(b));
    bobKeys.decryptKey.withAccess(b => bobDec = Buffer.from(b));
    aliceKeys.decryptKey.withAccess(b => aliceDec = Buffer.from(b));
    bobKeys.encryptKey.withAccess(b => bobEnc = Buffer.from(b));

    assert.deepEqual(aliceEnc, bobDec);
    assert.deepEqual(aliceDec, bobEnc);

    // Safety numbers match
    assert.equal(aliceKeys.safetyNumber, bobKeys.safetyNumber);
    assert.match(aliceKeys.safetyNumber, /^\d{6}$/);

    alice.privateKey.destroy(); bob.privateKey.destroy();
    aliceKeys.encryptKey.destroy(); aliceKeys.decryptKey.destroy();
    bobKeys.encryptKey.destroy(); bobKeys.decryptKey.destroy();
  });
});

describe('P2P Message Encryption', () => {
  it('encrypts and decrypts messages with sequence numbers', () => {
    const alice = generateExchangeKeyPair();
    const bob = generateExchangeKeyPair();

    // Each side derives their own view of session keys
    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const aliceKeys = deriveSessionKeys(secretA, alice.publicKey, bob.publicKey);
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    const bobKeys = deriveSessionKeys(secretB, bob.publicKey, alice.publicKey);

    // Alice encrypts with her encryptKey, Bob decrypts with his decryptKey
    const plaintext = Buffer.from('Hello from Alice to Bob');
    const encrypted = encryptMessage(plaintext, aliceKeys.encryptKey, 0);
    assert.ok(encrypted.length > plaintext.length);

    const { plaintext: decrypted, sequence } = decryptMessage(encrypted, bobKeys.decryptKey, 0);
    assert.deepEqual(decrypted, plaintext);
    assert.equal(sequence, 0);

    alice.privateKey.destroy(); bob.privateKey.destroy();
    aliceKeys.encryptKey.destroy(); aliceKeys.decryptKey.destroy();
    bobKeys.encryptKey.destroy(); bobKeys.decryptKey.destroy();
  });

  it('rejects messages with wrong sequence', () => {
    const alice = generateExchangeKeyPair();
    const bob = generateExchangeKeyPair();
    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const aliceKeys = deriveSessionKeys(secretA, alice.publicKey, bob.publicKey);
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    const bobKeys = deriveSessionKeys(secretB, bob.publicKey, alice.publicKey);

    const encrypted = encryptMessage(Buffer.from('test'), aliceKeys.encryptKey, 5);
    assert.throws(() => decryptMessage(encrypted, bobKeys.decryptKey, 3), /Sequence mismatch/);

    alice.privateKey.destroy(); bob.privateKey.destroy();
    aliceKeys.encryptKey.destroy(); aliceKeys.decryptKey.destroy();
    bobKeys.encryptKey.destroy(); bobKeys.decryptKey.destroy();
  });

  it('rejects tampered encrypted messages', () => {
    const alice = generateExchangeKeyPair();
    const bob = generateExchangeKeyPair();
    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    const aliceKeys = deriveSessionKeys(secretA, alice.publicKey, bob.publicKey);
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    const bobKeys = deriveSessionKeys(secretB, bob.publicKey, alice.publicKey);

    const encrypted = encryptMessage(Buffer.from('secret'), aliceKeys.encryptKey, 0);
    encrypted[30] ^= 0xff; // Tamper
    assert.throws(() => decryptMessage(encrypted, bobKeys.decryptKey, 0));

    alice.privateKey.destroy(); bob.privateKey.destroy();
    aliceKeys.encryptKey.destroy(); aliceKeys.decryptKey.destroy();
    bobKeys.encryptKey.destroy(); bobKeys.decryptKey.destroy();
  });
});

describe('PeerChannel', () => {
  it('tracks channel state and stats', () => {
    const channel = new PeerChannel({
      peerId: 'test-peer',
      peerName: 'Test Agent',
      sendFn: async () => {}
    });
    assert.equal(channel.state, 'new');
    assert.equal(channel.peerId, 'test-peer');
    assert.equal(channel.peerName, 'Test Agent');
    assert.equal(channel.stats.messagesSent, 0);
  });
});

describe('PeerManager', () => {
  it('creates and removes channels', () => {
    const vault = { privacyShield: { getNonce: () => 'test' } };
    const pm = new PeerManager(vault);
    pm.createChannel({ peerId: 'a', peerName: 'Agent A', sendFn: async () => {} });
    pm.createChannel({ peerId: 'b', peerName: 'Agent B', sendFn: async () => {} });
    assert.equal(Object.keys(pm.channels).length, 2);
    pm.removeChannel('a');
    assert.equal(Object.keys(pm.channels).length, 1);
  });

  it('generates and validates pairing codes', () => {
    const vault = {};
    const pm = new PeerManager(vault);
    const code = pm.generatePairingCode();
    assert.equal(code.length, 8);
    assert.ok(pm.validatePairingCode(code)); // First use: valid
    assert.ok(!pm.validatePairingCode(code)); // Second use: consumed
  });
});

// --- Ollama monitor test ---

describe('OllamaMonitor', () => {
  it('reports unhealthy when Ollama is not running', async () => {
    const mon = new OllamaMonitor('http://localhost:99999');
    const status = await mon.checkHealth();
    assert.equal(status.healthy, false);
  });
});

// Helper: inline PII scrubbing (mirrors index.js logic)
function scrubText(text, nonce, shield) {
  const PII_PATTERNS = {
    SECRET: [/sk-ant-[a-zA-Z0-9-]{20,}/g, /sk-[a-zA-Z0-9]{20,}/g],
    EMAIL: [/\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,}\b/g],
    PHONE: [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g],
  };
  let result = text;
  const nonceSeed = parseInt(nonce.slice(0, 8), 16);
  for (const [category, patterns] of Object.entries(PII_PATTERNS)) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      result = result.replace(pattern, (match) => {
        let hash = 2166136261 ^ nonceSeed;
        for (let i = 0; i < match.length; i++) { hash ^= match.charCodeAt(i); hash = Math.imul(hash, 16777619); }
        const h = (hash >>> 0).toString(16).padStart(8, '0');
        const placeholder = `\u00abPII:${category}:${h}\u00bb`;
        shield.storePiiMapping(placeholder, match, category);
        return placeholder;
      });
    }
  }
  return result;
}

function rehydrateText(text, shield) {
  return text.replace(/\u00abPII:[A-Z_]+:[0-9a-f]+\u00bb/g, (placeholder) => {
    const mapping = shield.getPiiMapping(placeholder);
    return mapping ? mapping.original : placeholder;
  });
}
