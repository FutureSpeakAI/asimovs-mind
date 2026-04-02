/**
 * Sovereign Vault Crypto Module
 *
 * Key hierarchy (ported from nexus-os passphrase-kdf.ts):
 *   Passphrase (>= 8 words)
 *     → Argon2id (opslimit=4, memlimit=256MB)
 *     → masterKey (32 bytes, destroyed after KDF)
 *       +-- BLAKE2b-KDF("AF_VAULT") → vaultKey (AES-256-GCM for state files)
 *       +-- BLAKE2b-KDF("AF_HMAC_") → hmacKey (HMAC-SHA256 for governance)
 *       +-- BLAKE2b-KDF("AF_IDENT") → identityKey (XSalsa20-Poly1305 for keypairs)
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sodium = require('libsodium-wrappers-sumo');
import crypto from 'node:crypto';

// Argon2id parameters matching nexus-os
const ARGON2_OPSLIMIT = 4;
const ARGON2_MEMLIMIT = 268435456; // 256 MB
// crypto_pwhash_SALTBYTES is 16 for Argon2id
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

// Sub-key context strings (8 bytes each, matching nexus-os)
const CTX_VAULT = 'AF_VAULT';
const CTX_HMAC = 'AF_HMAC_';
const CTX_IDENT = 'AF_IDENT';

// Canary plaintext for passphrase verification
const CANARY_PLAINTEXT = 'ASIMOV_VAULT_CANARY_v1';

let sodiumReady = false;

export async function initCrypto() {
  await sodium.ready;
  sodiumReady = true;
}

function ensureReady() {
  if (!sodiumReady) throw new Error('Crypto not initialized. Call initCrypto() first.');
}

// --- SecureBuffer: key material protection ---

export class SecureBuffer {
  #buffer;
  #destroyed = false;

  constructor(size) {
    this.#buffer = Buffer.alloc(size);
  }

  static from(source) {
    const sb = new SecureBuffer(source.length);
    source.copy(sb.#buffer);
    // Wipe the source
    crypto.randomFillSync(source);
    source.fill(0);
    return sb;
  }

  get length() {
    return this.#buffer.length;
  }

  withAccess(fn) {
    if (this.#destroyed) throw new Error('SecureBuffer has been destroyed');
    return fn(this.#buffer);
  }

  destroy() {
    if (this.#destroyed) return;
    // Overwrite with random then zero to defeat compiler optimizations
    crypto.randomFillSync(this.#buffer);
    this.#buffer.fill(0);
    this.#destroyed = true;
  }

  get isDestroyed() {
    return this.#destroyed;
  }
}

// --- Passphrase validation ---

export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string') return { valid: false, reason: 'Passphrase must be a string' };
  const words = passphrase.trim().split(/\s+/);
  if (words.length < 8) return { valid: false, reason: `Need at least 8 words, got ${words.length}` };
  const uniqueWords = new Set(words.map(w => w.toLowerCase()));
  if (uniqueWords.size < 4) return { valid: false, reason: 'Need at least 4 unique words' };
  const avgLen = words.reduce((sum, w) => sum + w.length, 0) / words.length;
  if (avgLen < 3) return { valid: false, reason: 'Words are too short on average' };
  if (passphrase.length < 24) return { valid: false, reason: 'Passphrase must be at least 24 characters' };
  return { valid: true };
}

// --- Key derivation ---

export async function generateSalt() {
  ensureReady();
  return Buffer.from(sodium.randombytes_buf(SALT_BYTES));
}

export async function deriveMasterKey(passphrase, salt) {
  ensureReady();
  const passphraseBytes = Buffer.from(passphrase, 'utf-8');
  const raw = sodium.crypto_pwhash(
    KEY_BYTES,
    passphraseBytes,
    salt,
    ARGON2_OPSLIMIT,
    ARGON2_MEMLIMIT,
    sodium.crypto_pwhash_ALG_ARGON2ID13
  );
  // Wipe passphrase bytes
  passphraseBytes.fill(0);
  return SecureBuffer.from(Buffer.from(raw));
}

function deriveSubKey(masterKey, context, subkeyId = 1) {
  ensureReady();
  // Pad context to 8 bytes
  const ctx = context.padEnd(8, '\0').slice(0, 8);
  let subKeyRaw;
  masterKey.withAccess((buf) => {
    subKeyRaw = sodium.crypto_kdf_derive_from_key(
      KEY_BYTES,
      subkeyId,
      ctx,
      buf
    );
  });
  return SecureBuffer.from(Buffer.from(subKeyRaw));
}

export function deriveAllKeys(masterKey) {
  const vaultKey = deriveSubKey(masterKey, CTX_VAULT, 1);
  const hmacKey = deriveSubKey(masterKey, CTX_HMAC, 2);
  const identityKey = deriveSubKey(masterKey, CTX_IDENT, 3);
  // Destroy master key immediately
  masterKey.destroy();
  return { vaultKey, hmacKey, identityKey };
}

// --- AES-256-GCM encryption/decryption ---

export function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(IV_BYTES);
  let ciphertext;
  key.withAccess((keyBuf) => {
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = cipher.update(plaintext);
    const final = cipher.final();
    const authTag = cipher.getAuthTag();
    // Format: [12-byte IV][ciphertext][16-byte authTag]
    ciphertext = Buffer.concat([iv, encrypted, final, authTag]);
  });
  return ciphertext;
}

export function decrypt(ciphertextBuf, key) {
  if (ciphertextBuf.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new Error('Ciphertext too short');
  }
  const iv = ciphertextBuf.subarray(0, IV_BYTES);
  const authTag = ciphertextBuf.subarray(ciphertextBuf.length - AUTH_TAG_BYTES);
  const encrypted = ciphertextBuf.subarray(IV_BYTES, ciphertextBuf.length - AUTH_TAG_BYTES);
  let plaintext;
  key.withAccess((keyBuf) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
    decipher.setAuthTag(authTag);
    const decrypted = decipher.update(encrypted);
    const final = decipher.final();
    plaintext = Buffer.concat([decrypted, final]);
  });
  return plaintext;
}

// --- Canary (passphrase verification) ---

export function createCanary(identityKey) {
  ensureReady();
  let canaryBuf;
  identityKey.withAccess((keyBuf) => {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const plaintext = Buffer.from(CANARY_PLAINTEXT, 'utf-8');
    const ciphertext = sodium.crypto_secretbox_easy(plaintext, nonce, keyBuf);
    canaryBuf = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
  });
  return canaryBuf;
}

export function verifyCanary(canaryBuf, identityKey) {
  ensureReady();
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  if (canaryBuf.length < nonceLen + sodium.crypto_secretbox_MACBYTES) return false;
  const nonce = canaryBuf.subarray(0, nonceLen);
  const ciphertext = canaryBuf.subarray(nonceLen);
  let verified = false;
  identityKey.withAccess((keyBuf) => {
    try {
      const plaintext = sodium.crypto_secretbox_open_easy(ciphertext, nonce, keyBuf);
      verified = Buffer.from(plaintext).toString('utf-8') === CANARY_PLAINTEXT;
    } catch {
      verified = false;
    }
  });
  return verified;
}

// --- HMAC-SHA256 for governance integrity ---

export function hmacSign(data, hmacKey) {
  let signature;
  hmacKey.withAccess((keyBuf) => {
    const hmac = crypto.createHmac('sha256', keyBuf);
    hmac.update(data);
    signature = hmac.digest('hex');
  });
  return signature;
}

export function hmacVerify(data, signature, hmacKey) {
  const computed = hmacSign(data, hmacKey);
  return crypto.timingSafeEqual(Buffer.from(computed, 'hex'), Buffer.from(signature, 'hex'));
}

// --- Ed25519 identity (for Phase 3, exposed early) ---

export function generateSigningKeyPair() {
  ensureReady();
  const kp = sodium.crypto_sign_keypair();
  return {
    publicKey: Buffer.from(kp.publicKey),
    privateKey: SecureBuffer.from(Buffer.from(kp.privateKey))
  };
}

export function generateExchangeKeyPair() {
  ensureReady();
  const kp = sodium.crypto_box_keypair();
  return {
    publicKey: Buffer.from(kp.publicKey),
    privateKey: SecureBuffer.from(Buffer.from(kp.privateKey))
  };
}

export function sign(message, privateKey) {
  ensureReady();
  let signature;
  privateKey.withAccess((keyBuf) => {
    signature = Buffer.from(sodium.crypto_sign_detached(message, keyBuf));
  });
  return signature;
}

export function verify(message, signature, publicKey) {
  ensureReady();
  try {
    return sodium.crypto_sign_verify_detached(signature, message, publicKey);
  } catch {
    return false;
  }
}

// --- Encrypt/decrypt private keys with identity key ---

export function encryptPrivateKey(privateKey, identityKey) {
  ensureReady();
  let encrypted;
  privateKey.withAccess((privBuf) => {
    identityKey.withAccess((idKeyBuf) => {
      const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
      const ciphertext = sodium.crypto_secretbox_easy(privBuf, nonce, idKeyBuf);
      encrypted = Buffer.concat([Buffer.from(nonce), Buffer.from(ciphertext)]);
    });
  });
  return encrypted;
}

export function decryptPrivateKey(encryptedBuf, identityKey) {
  ensureReady();
  const nonceLen = sodium.crypto_secretbox_NONCEBYTES;
  const nonce = encryptedBuf.subarray(0, nonceLen);
  const ciphertext = encryptedBuf.subarray(nonceLen);
  let privateKey;
  identityKey.withAccess((idKeyBuf) => {
    const raw = sodium.crypto_secretbox_open_easy(ciphertext, nonce, idKeyBuf);
    privateKey = SecureBuffer.from(Buffer.from(raw));
  });
  return privateKey;
}

// --- X25519 ECDH key agreement (P2P encrypted channels) ---

export function deriveSharedSecret(myExchangePrivateKey, peerExchangePublicKey) {
  ensureReady();
  let sharedSecret;
  myExchangePrivateKey.withAccess((privBuf) => {
    const raw = sodium.crypto_scalarmult(privBuf, peerExchangePublicKey);
    sharedSecret = Buffer.from(raw);
  });
  return sharedSecret;
}

export function deriveSessionKeys(sharedSecret, myPublicKey, peerPublicKey) {
  // HKDF-like derivation using BLAKE2b
  // Salt: SHA-256 of sorted public keys (domain separation per pair)
  ensureReady();
  const sorted = Buffer.compare(myPublicKey, peerPublicKey) < 0
    ? Buffer.concat([myPublicKey, peerPublicKey])
    : Buffer.concat([peerPublicKey, myPublicKey]);
  const salt = crypto.createHash('sha256').update(sorted).digest();

  // Derive two session keys: one for sending, one for receiving
  // Use different sub-key IDs to get different keys for each direction
  const ikm = Buffer.concat([sharedSecret, salt]);
  const sendKey = crypto.createHmac('sha256', salt).update(Buffer.concat([ikm, Buffer.from([0x01])])).digest();
  const recvKey = crypto.createHmac('sha256', salt).update(Buffer.concat([ikm, Buffer.from([0x02])])).digest();

  // Determine direction: the peer with the "lower" public key sends on key 1
  const iAmLower = Buffer.compare(myPublicKey, peerPublicKey) < 0;
  return {
    encryptKey: SecureBuffer.from(iAmLower ? sendKey : recvKey),
    decryptKey: SecureBuffer.from(iAmLower ? recvKey : sendKey),
    safetyNumber: computeSafetyNumber(sharedSecret)
  };
}

function computeSafetyNumber(sharedSecret) {
  // 6-digit safety number for MITM detection (shown to user for verification)
  const hash = crypto.createHash('sha256').update(sharedSecret).digest();
  const num = hash.readUInt32BE(0) % 1000000;
  return String(num).padStart(6, '0');
}

// --- P2P message encryption ---

export function encryptMessage(plaintext, sessionKey, sequence) {
  // AES-256-GCM with sequence number as AAD (prevents reordering)
  const iv = crypto.randomBytes(IV_BYTES);
  const aad = Buffer.alloc(8);
  aad.writeBigUInt64BE(BigInt(sequence));
  let ciphertext;
  sessionKey.withAccess((keyBuf) => {
    const cipher = crypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    cipher.setAAD(aad);
    const encrypted = cipher.update(plaintext);
    const final = cipher.final();
    const authTag = cipher.getAuthTag();
    ciphertext = Buffer.concat([iv, aad, encrypted, final, authTag]);
  });
  return ciphertext;
}

export function decryptMessage(ciphertextBuf, sessionKey, expectedSequence) {
  if (ciphertextBuf.length < IV_BYTES + 8 + AUTH_TAG_BYTES) {
    throw new Error('Message too short');
  }
  const iv = ciphertextBuf.subarray(0, IV_BYTES);
  const aad = ciphertextBuf.subarray(IV_BYTES, IV_BYTES + 8);
  const sequence = Number(aad.readBigUInt64BE(0));
  if (expectedSequence !== undefined && sequence !== expectedSequence) {
    throw new Error(`Sequence mismatch: expected ${expectedSequence}, got ${sequence}`);
  }
  const authTag = ciphertextBuf.subarray(ciphertextBuf.length - AUTH_TAG_BYTES);
  const encrypted = ciphertextBuf.subarray(IV_BYTES + 8, ciphertextBuf.length - AUTH_TAG_BYTES);
  let plaintext;
  sessionKey.withAccess((keyBuf) => {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuf, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(authTag);
    const decrypted = decipher.update(encrypted);
    const final = decipher.final();
    plaintext = Buffer.concat([decrypted, final]);
  });
  return { plaintext, sequence };
}

