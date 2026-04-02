/**
 * Sovereign Vault — Encrypted state management
 *
 * File layout:
 *   .asimovs-mind/vault/
 *   +-- salt              # 32-byte random salt (hex)
 *   +-- canary.enc        # Passphrase verification blob (base64)
 *   +-- meta.json         # Vault metadata (version, created_at)
 *   +-- port              # HTTP bridge port (written on start)
 *   +-- state/            # Encrypted state files
 *       +-- *.enc
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export { OllamaMonitor } from './ollama-monitor.js';
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
  generateExchangeKeyPair,
  encryptPrivateKey,
  decryptPrivateKey,
  sign,
  verify
} from './crypto.js';

const VAULT_VERSION = '1.0.0';

// Key validation: only alphanumeric, hyphens, underscores, colons, and single dots.
// No path separators, no consecutive dots, max 128 chars.
function validateKey(key) {
  if (typeof key !== 'string') throw new Error('Vault key must be a string');
  if (key.length === 0) throw new Error('Vault key must not be empty');
  if (key.length > 128) throw new Error('Vault key exceeds 128-character limit');
  if (/[/\\]/.test(key)) throw new Error('Vault key must not contain path separators');
  if (/\.\./.test(key)) throw new Error('Vault key must not contain consecutive dots');
  if (!/^[a-zA-Z0-9_\-:.]+$/.test(key)) throw new Error('Vault key contains invalid characters (only alphanumeric, hyphens, underscores, colons, dots allowed)');
}

export class SovereignVault {
  #vaultDir;
  #stateDir;
  #vaultKey = null;
  #hmacKey = null;
  #identityKey = null;
  #locked = true;
  #initialized = false;
  #meta = null;

  // Privacy Shield state (in-memory only)
  #piiMappings = new Map();
  #piiNonce = null;
  #piiStats = { total: 0, categories: {} };

  constructor(vaultDir) {
    this.#vaultDir = vaultDir;
    this.#stateDir = path.join(vaultDir, 'state');
  }

  get status() {
    if (!this.#initialized) return 'uninitialized';
    if (this.#locked) return 'locked';
    return 'unlocked';
  }

  get meta() {
    return this.#meta;
  }

  // --- Lifecycle ---

  async init() {
    await initCrypto();
    try {
      const metaPath = path.join(this.#vaultDir, 'meta.json');
      const raw = await fs.readFile(metaPath, 'utf-8');
      this.#meta = JSON.parse(raw);
      this.#initialized = true;
    } catch {
      this.#initialized = false;
    }
  }

  async initialize(passphrase) {
    const validation = validatePassphrase(passphrase);
    if (!validation.valid) {
      return { success: false, error: validation.reason };
    }

    // Create directories
    await fs.mkdir(this.#vaultDir, { recursive: true });
    await fs.mkdir(this.#stateDir, { recursive: true });

    // Generate salt
    const salt = await generateSalt();
    await fs.writeFile(path.join(this.#vaultDir, 'salt'), salt.toString('hex'), 'utf-8');

    // Derive keys
    const masterKey = await deriveMasterKey(passphrase, salt);
    const keys = deriveAllKeys(masterKey);
    // masterKey is destroyed inside deriveAllKeys

    // Create canary for passphrase verification
    const canary = createCanary(keys.identityKey);
    await fs.writeFile(path.join(this.#vaultDir, 'canary.enc'), canary.toString('base64'), 'utf-8');

    // Write metadata
    this.#meta = {
      version: VAULT_VERSION,
      created_at: new Date().toISOString(),
      key_derivation: 'argon2id',
      encryption: 'aes-256-gcm',
      sub_keys: ['vault(BLAKE2b)', 'hmac(BLAKE2b)', 'identity(BLAKE2b)']
    };
    await fs.writeFile(
      path.join(this.#vaultDir, 'meta.json'),
      JSON.stringify(this.#meta, null, 2),
      'utf-8'
    );

    // Store keys
    this.#vaultKey = keys.vaultKey;
    this.#hmacKey = keys.hmacKey;
    this.#identityKey = keys.identityKey;
    this.#locked = false;
    this.#initialized = true;

    // Migrate any existing plaintext state
    const migrated = await this.#migrateExistingState();

    return { success: true, migrated };
  }

  async unlock(passphrase) {
    if (!this.#initialized) return { success: false, error: 'Vault not initialized' };
    if (!this.#locked) return { success: true, already_unlocked: true };

    // Read salt
    const saltHex = await fs.readFile(path.join(this.#vaultDir, 'salt'), 'utf-8');
    const salt = Buffer.from(saltHex.trim(), 'hex');

    // Derive keys
    const masterKey = await deriveMasterKey(passphrase, salt);
    const keys = deriveAllKeys(masterKey);

    // Verify canary
    const canaryB64 = await fs.readFile(path.join(this.#vaultDir, 'canary.enc'), 'utf-8');
    const canaryBuf = Buffer.from(canaryB64.trim(), 'base64');
    if (!verifyCanary(canaryBuf, keys.identityKey)) {
      keys.vaultKey.destroy();
      keys.hmacKey.destroy();
      keys.identityKey.destroy();
      return { success: false, error: 'Wrong passphrase' };
    }

    this.#vaultKey = keys.vaultKey;
    this.#hmacKey = keys.hmacKey;
    this.#identityKey = keys.identityKey;
    this.#locked = false;

    return { success: true };
  }

  lock() {
    if (this.#vaultKey) this.#vaultKey.destroy();
    if (this.#hmacKey) this.#hmacKey.destroy();
    if (this.#identityKey) this.#identityKey.destroy();
    this.#vaultKey = null;
    this.#hmacKey = null;
    this.#identityKey = null;
    this.#locked = true;
    // Clear privacy shield state
    this.#piiMappings.clear();
    this.#piiNonce = null;
    this.#piiStats = { total: 0, categories: {} };
  }

  // --- State read/write ---

  async read(key) {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    validateKey(key);
    const filePath = path.join(this.#stateDir, `${key}.enc`);
    if (!path.resolve(filePath).startsWith(path.resolve(this.#stateDir) + path.sep)) {
      throw new Error('Path traversal detected');
    }
    try {
      const b64 = await fs.readFile(filePath, 'utf-8');
      const ciphertext = Buffer.from(b64.trim(), 'base64');
      const plaintext = decrypt(ciphertext, this.#vaultKey);
      return { success: true, data: JSON.parse(plaintext.toString('utf-8')) };
    } catch (err) {
      if (err.code === 'ENOENT') return { success: true, data: null };
      return { success: false, error: `Decryption failed: ${err.message}` };
    }
  }

  async write(key, data) {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    validateKey(key);
    await fs.mkdir(this.#stateDir, { recursive: true });
    const plaintext = Buffer.from(JSON.stringify(data), 'utf-8');
    const ciphertext = encrypt(plaintext, this.#vaultKey);
    const filePath = path.join(this.#stateDir, `${key}.enc`);
    if (!path.resolve(filePath).startsWith(path.resolve(this.#stateDir) + path.sep)) {
      throw new Error('Path traversal detected');
    }
    await fs.writeFile(filePath, ciphertext.toString('base64'), 'utf-8');
    return { success: true };
  }

  async append(key, entry) {
    // Read existing array, append, write back
    const result = await this.read(key);
    const arr = (result.success && Array.isArray(result.data)) ? result.data : [];
    arr.push(entry);
    return this.write(key, arr);
  }

  async delete(key) {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    validateKey(key);
    const filePath = path.join(this.#stateDir, `${key}.enc`);
    if (!path.resolve(filePath).startsWith(path.resolve(this.#stateDir) + path.sep)) {
      throw new Error('Path traversal detected');
    }
    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch (err) {
      if (err.code === 'ENOENT') return { success: true };
      return { success: false, error: err.message };
    }
  }

  async listKeys() {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    try {
      const files = await fs.readdir(this.#stateDir);
      const keys = files
        .filter(f => f.endsWith('.enc'))
        .map(f => f.replace(/\.enc$/, ''));
      return { success: true, keys };
    } catch {
      return { success: true, keys: [] };
    }
  }

  async exportAll() {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    const keys = await this.listKeys();
    if (!keys.success) return keys;
    const exported = {};
    for (const key of keys.keys) {
      const result = await this.read(key);
      if (result.success) exported[key] = result.data;
    }
    return { success: true, data: exported, meta: this.#meta };
  }

  // --- HMAC governance ---

  signGovernance(data) {
    if (this.#locked) throw new Error('Vault is locked');
    return hmacSign(data, this.#hmacKey);
  }

  verifyGovernance(data, signature) {
    if (this.#locked) throw new Error('Vault is locked');
    return hmacVerify(data, signature, this.#hmacKey);
  }

  // --- Ed25519 identity ---

  async generateIdentity(name) {
    if (this.#locked) return { success: false, error: 'Vault is locked' };

    const signing = generateSigningKeyPair();
    const exchange = generateExchangeKeyPair();

    // Encrypt private keys with identity sub-key
    const encSigningPriv = encryptPrivateKey(signing.privateKey, this.#identityKey);
    const encExchangePriv = encryptPrivateKey(exchange.privateKey, this.#identityKey);

    // Destroy unencrypted private keys
    signing.privateKey.destroy();
    exchange.privateKey.destroy();

    const identity = {
      name,
      created_at: new Date().toISOString(),
      signing: {
        publicKey: signing.publicKey.toString('base64'),
        encryptedPrivateKey: encSigningPriv.toString('base64')
      },
      exchange: {
        publicKey: exchange.publicKey.toString('base64'),
        encryptedPrivateKey: encExchangePriv.toString('base64')
      }
    };

    await this.write('agent-identity', identity);
    return { success: true, publicKeys: { signing: identity.signing.publicKey, exchange: identity.exchange.publicKey } };
  }

  async getIdentity() {
    return this.read('agent-identity');
  }

  async signMessage(message) {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    const idResult = await this.read('agent-identity');
    if (!idResult.success || !idResult.data) return { success: false, error: 'No identity' };

    const encPriv = Buffer.from(idResult.data.signing.encryptedPrivateKey, 'base64');
    const privateKey = decryptPrivateKey(encPriv, this.#identityKey);
    const msgBuf = Buffer.from(message, 'utf-8');
    const signature = sign(msgBuf, privateKey);
    privateKey.destroy();

    return { success: true, signature: signature.toString('base64') };
  }

  /**
   * Decrypts and returns the Ed25519 signing private key as a SecureBuffer.
   * Caller MUST call .destroy() on the returned key when done.
   */
  async getSigningPrivateKey() {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    const idResult = await this.read('agent-identity');
    if (!idResult.success || !idResult.data) return { success: false, error: 'No identity' };
    const encPriv = Buffer.from(idResult.data.signing.encryptedPrivateKey, 'base64');
    const privateKey = decryptPrivateKey(encPriv, this.#identityKey);
    return { success: true, privateKey };
  }

  /**
   * Decrypts and returns the X25519 exchange private key as a SecureBuffer.
   * Caller MUST call .destroy() on the returned key when done.
   */
  async getExchangePrivateKey() {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    const idResult = await this.read('agent-identity');
    if (!idResult.success || !idResult.data) return { success: false, error: 'No identity' };
    const encPriv = Buffer.from(idResult.data.exchange.encryptedPrivateKey, 'base64');
    const privateKey = decryptPrivateKey(encPriv, this.#identityKey);
    return { success: true, privateKey };
  }

  verifySignature(message, signatureB64, publicKeyB64) {
    const msgBuf = Buffer.from(message, 'utf-8');
    const sigBuf = Buffer.from(signatureB64, 'base64');
    const pubBuf = Buffer.from(publicKeyB64, 'base64');
    return verify(msgBuf, sigBuf, pubBuf);
  }

  // --- cLaw Attestation ---

  async generateAttestation(lawsText) {
    if (this.#locked) return { success: false, error: 'Vault is locked' };
    const idResult = await this.read('agent-identity');
    if (!idResult.success || !idResult.data) return { success: false, error: 'No identity' };

    const lawsHash = crypto.createHash('sha256').update(lawsText).digest('hex');
    const timestamp = Date.now();
    const payload = `${lawsHash}|${timestamp}`;

    const signResult = await this.signMessage(payload);
    if (!signResult.success) return signResult;

    return {
      success: true,
      attestation: {
        lawsHash,
        timestamp,
        signature: signResult.signature,
        signerPublicKey: idResult.data.signing.publicKey
      }
    };
  }

  verifyAttestation(attestation, lawsText) {
    const expectedHash = crypto.createHash('sha256').update(lawsText).digest('hex');
    if (attestation.lawsHash !== expectedHash) return { valid: false, reason: 'Laws hash mismatch' };

    const now = Date.now();
    const age = now - attestation.timestamp;
    if (age > 5 * 60 * 1000) return { valid: false, reason: 'Attestation expired (>5 min)' };
    if (age < -60 * 1000) return { valid: false, reason: 'Attestation from the future' };

    const payload = `${attestation.lawsHash}|${attestation.timestamp}`;
    const valid = this.verifySignature(payload, attestation.signature, attestation.signerPublicKey);
    if (!valid) return { valid: false, reason: 'Signature verification failed' };

    return { valid: true };
  }

  // --- Privacy Shield state (in-memory only) ---

  get privacyShield() {
    return {
      storePiiMapping: (placeholder, original, category) => {
        this.#piiMappings.set(placeholder, { original, category });
        this.#piiStats.total++;
        this.#piiStats.categories[category] = (this.#piiStats.categories[category] || 0) + 1;
      },
      getPiiMapping: (placeholder) => this.#piiMappings.get(placeholder),
      getAllMappings: () => new Map(this.#piiMappings),
      getStats: () => ({ ...this.#piiStats }),
      getNonce: () => {
        if (!this.#piiNonce) {
          this.#piiNonce = crypto.randomBytes(8).toString('hex');
        }
        return this.#piiNonce;
      },
      reset: () => {
        this.#piiMappings.clear();
        this.#piiNonce = null;
        this.#piiStats = { total: 0, categories: {} };
      }
    };
  }

  // --- Plaintext migration ---

  async #migrateExistingState() {
    const migrated = [];
    const asimovDir = path.dirname(this.#vaultDir);

    // Known plaintext state files from the old plugin
    const migrationMap = {
      'user-profile.json': 'user-profile',
      'knowledge/memories.json': 'memories',
      'trust-tracker.json': 'trust-tracker',
      'knowledge/recent-sessions.json': 'recent-sessions',
      'session-history.jsonl': 'session-history',
      'knowledge/entities.json': 'entity-graph',
    };

    for (const [relPath, key] of Object.entries(migrationMap)) {
      const fullPath = path.join(asimovDir, relPath);
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        let data;
        if (relPath.endsWith('.jsonl')) {
          data = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        } else {
          data = JSON.parse(raw);
        }
        await this.write(key, data);
        migrated.push(relPath);
        // Rename old file to .migrated
        await fs.rename(fullPath, fullPath + '.migrated');
      } catch {
        // File doesn't exist or can't be parsed, skip
      }
    }

    // Migrate evidence and trust from memory.py stores
    const memoryFiles = {
      'evidence.jsonl': 'evidence',
      'trust-scores.json': 'trust-scores',
      'entity-graph.json': 'entity-graph-memory',
    };

    for (const [relPath, key] of Object.entries(memoryFiles)) {
      const fullPath = path.join(asimovDir, relPath);
      try {
        const raw = await fs.readFile(fullPath, 'utf-8');
        let data;
        if (relPath.endsWith('.jsonl')) {
          data = raw.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
        } else {
          data = JSON.parse(raw);
        }
        await this.write(key, data);
        migrated.push(relPath);
        await fs.rename(fullPath, fullPath + '.migrated');
      } catch {
        // skip
      }
    }

    return migrated;
  }
}
