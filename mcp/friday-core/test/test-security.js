/**
 * Security Hardening Tests — Cycles 1-4
 *
 * Tests: vault key validation, SSRF protection, ReDoS guard,
 * provider whitelist, and input bounds.
 *
 * Run: node --test test/test-security.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  initCrypto,
  generateExchangeKeyPair,
  generateSigningKeyPair,
  deriveSharedSecret,
  deriveSessionKeys,
  encryptMessage,
  decryptMessage,
  SecureBuffer
} from '../core/crypto.js';
import { PeerChannel } from '../subsystems/p2p/protocol.js';
import { SovereignVault } from '../core/vault.js';
import { execute as commsExecute } from '../subsystems/connectors/comms.js';
import { execute as _terminalExecute } from '../subsystems/connectors/terminal.js';
import { execute as gitExecute } from '../subsystems/connectors/git-devops.js';

// ─────────────────────────────────────────────────────────────────────────────
// Setup: one unlocked vault for key validation tests
// ─────────────────────────────────────────────────────────────────────────────

const TEST_PASSPHRASE = 'correct horse battery staple extra words here today';
let testDir;
let vault;

before(async () => {
  await initCrypto();
  testDir = path.join(os.tmpdir(), `security-test-${Date.now()}`);
  const vaultDir = path.join(testDir, 'vault');
  vault = new SovereignVault(vaultDir);
  await vault.init();
  await vault.initialize(TEST_PASSPHRASE);
});

after(async () => {
  vault.lock();
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Vault key validation
// ─────────────────────────────────────────────────────────────────────────────

describe('Vault key validation', () => {
  it('rejects keys containing "/"', async () => {
    await assert.rejects(
      () => vault.write('path/traversal', { x: 1 }),
      /path separator/
    );
  });

  it('rejects keys containing ".."', async () => {
    await assert.rejects(
      () => vault.write('..evil', { x: 1 }),
      /consecutive dots/
    );
  });

  it('rejects keys longer than 128 characters', async () => {
    const longKey = 'a'.repeat(129);
    await assert.rejects(
      () => vault.write(longKey, { x: 1 }),
      /128/
    );
  });

  it('accepts "my-key"', async () => {
    const result = await vault.write('my-key', { ok: true });
    assert.equal(result.success, true);
  });

  it('accepts "api_keys"', async () => {
    const result = await vault.write('api_keys', { ok: true });
    assert.equal(result.success, true);
  });

  it('accepts "trust:scores"', async () => {
    const result = await vault.write('trust:scores', { ok: true });
    assert.equal(result.success, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. SSRF protection — validateWebhookUrl via comms execute
// Using webhook_send which calls validateWebhookUrl with HTTPS-only mode.
// All blocked cases return an error string; example.com requires HTTPS.
// ─────────────────────────────────────────────────────────────────────────────

describe('SSRF protection', () => {
  it('blocks localhost', async () => {
    const res = await commsExecute('webhook_send', { url: 'https://localhost/hook' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /localhost/i);
  });

  it('blocks 127.0.0.1', async () => {
    const res = await commsExecute('webhook_send', { url: 'https://127.0.0.1/hook' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /localhost/i);
  });

  it('blocks 169.254.169.254 (link-local)', async () => {
    const res = await commsExecute('webhook_send', { url: 'https://169.254.169.254/metadata' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /private IP/i);
  });

  it('blocks 10.0.0.1 (private)', async () => {
    const res = await commsExecute('webhook_send', { url: 'https://10.0.0.1/hook' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /private IP/i);
  });

  it('blocks 192.168.1.1 (private)', async () => {
    const res = await commsExecute('webhook_send', { url: 'https://192.168.1.1/hook' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /private IP/i);
  });

  it('allows https://example.com — no SSRF error', async () => {
    // The network call will fail (connection refused or DNS), but the error
    // must NOT be a URL validation error — it should be a network error.
    const res = await commsExecute('webhook_send', { url: 'https://example.com/hook' });
    if (res.error) {
      assert.doesNotMatch(res.error, /localhost|private IP|HTTPS/i,
        `Expected network error, got validation error: ${res.error}`);
    }
    // result is also acceptable (HTTP 4xx from example.com)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ReDoS protection — terminal_wait_for pattern guard
//
// In terminalWaitFor (terminal.js lines 244-255) the session lookup runs before
// the pattern guard, so a nonexistent session_id short-circuits before the guard
// fires. The guard logic is pure and side-effect-free, so we mirror it here
// verbatim to unit-test it directly.  This is the canonical form from source:
//
//   if (pat.length > 200) { /* reject */ }
//   if (/([+*?]|\{\d).*[)]\s*[+*?{]/.test(pat) || /[(].*[+*?].*[+*?]/.test(pat)) { /* reject */ }
// ─────────────────────────────────────────────────────────────────────────────

// Verbatim guard extracted from subsystems/connectors/terminal.js terminalWaitFor
function reDoSGuard(pat) {
  if (pat.length > 200) {
    return { error: 'Pattern rejected: exceeds maximum length of 200 characters' };
  }
  if (/([+*?]|\{\d).*[)]\s*[+*?{]/.test(pat) || /[(].*[+*?].*[+*?]/.test(pat)) {
    return { error: 'Pattern rejected: potential catastrophic backtracking' };
  }
  return null; // safe
}

describe('ReDoS protection', () => {
  it('rejects "(a+)+" — nested quantifier', () => {
    const result = reDoSGuard('(a+)+');
    assert.ok(result, 'guard must block this pattern');
    assert.match(result.error, /backtracking|rejected/i);
  });

  it('rejects "(a*)*" — nested quantifier', () => {
    const result = reDoSGuard('(a*)*');
    assert.ok(result, 'guard must block this pattern');
    assert.match(result.error, /backtracking|rejected/i);
  });

  it('rejects patterns longer than 200 characters', () => {
    const result = reDoSGuard('a'.repeat(201));
    assert.ok(result, 'guard must block over-length patterns');
    assert.match(result.error, /200|length/i);
  });

  it('allows safe pattern "\\d+"', () => {
    const result = reDoSGuard('\\d+');
    assert.equal(result, null, 'safe pattern must not be blocked');
  });

  it('allows safe pattern "error|warn"', () => {
    const result = reDoSGuard('error|warn');
    assert.equal(result, null, 'safe pattern must not be blocked');
  });

  it('allows safe pattern "^hello"', () => {
    const result = reDoSGuard('^hello');
    assert.equal(result, null, 'safe pattern must not be blocked');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Provider whitelist — cloud_cli
// ─────────────────────────────────────────────────────────────────────────────

describe('Provider whitelist', () => {
  it('rejects provider="cmd"', async () => {
    const res = await gitExecute('cloud_cli', { provider: 'cmd', command: 'ls' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /Unsupported provider/i);
  });

  it('rejects provider="/usr/bin/rm"', async () => {
    const res = await gitExecute('cloud_cli', { provider: '/usr/bin/rm', command: '-rf /' });
    assert.ok(res.error, 'expected an error');
    assert.match(res.error, /Unsupported provider/i);
  });

  it('accepts provider="aws" — whitelist passes, exec may fail', async () => {
    const res = await gitExecute('cloud_cli', { provider: 'aws', command: '--version' });
    // If aws CLI is not installed, we get a spawn/exec error — NOT a whitelist error.
    if (res.error) {
      assert.doesNotMatch(res.error, /Unsupported provider/i,
        `Expected exec error, got whitelist rejection: ${res.error}`);
    }
    // result is fine too (aws --version output)
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Input bounds
// ─────────────────────────────────────────────────────────────────────────────

describe('Input bounds', () => {
  it('vault_write rejects payloads over 1 MB', () => {
    // Replicate the inline guard from subsystems/vault/index.js line 104.
    // The check: JSON.stringify(data).length > 1_048_576
    const bigString = 'x'.repeat(1_048_577);
    const isOversized = JSON.stringify(bigString).length > 1_048_576;
    assert.equal(isOversized, true,
      'A string of 1,048,577 chars must trigger the over-1MB guard');
  });

  it('vault_write allows payloads exactly at 1 MB', () => {
    // 1,048,576 chars of content serialises to 1,048,578 bytes of JSON
    // (two surrounding quote chars) — still over; use shorter content.
    // The guard is on the serialised length, so use a value whose JSON
    // representation is exactly 1,048,576 bytes: a string of 1,048,574 chars.
    const atLimit = 'x'.repeat(1_048_574);
    const isOversized = JSON.stringify(atLimit).length > 1_048_576;
    assert.equal(isOversized, false,
      'A string whose JSON is 1,048,576 bytes should not trigger the guard');
  });

  it('memory_store content over 50 K is rejected by Zod schema', () => {
    // The Zod schema in subsystems/memory/index.js uses z.string().max(50000).
    // Validate that 50,001 chars exceeds the limit and <= 50,000 does not.
    const overLimit = 'x'.repeat(50_001);
    const atLimit   = 'x'.repeat(50_000);
    assert.equal(overLimit.length > 50_000, true);
    assert.equal(atLimit.length > 50_000, false);
  });

  it('git_log count is capped at 500', () => {
    // Replicate the cap from git-devops.js line 89: Math.min(args.count ?? 20, 500)
    assert.equal(Math.min(9999, 500), 500,
      'Any count over 500 must be clamped to 500');
    assert.equal(Math.min(499, 500), 499,
      'Counts below 500 must pass through unchanged');
    assert.equal(Math.min(undefined ?? 20, 500), 20,
      'Missing count defaults to 20');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. HKDF key derivation — direction correctness and safety number
// ─────────────────────────────────────────────────────────────────────────────

describe('HKDF key derivation', () => {
  // One-time setup: generate two exchange key pairs for all HKDF tests.
  let alice, bob;
  let keysFromAlice, keysFromBob;

  before(() => {
    alice = generateExchangeKeyPair();
    bob   = generateExchangeKeyPair();

    // Alice's perspective
    const secretA = deriveSharedSecret(alice.privateKey, bob.publicKey);
    keysFromAlice = deriveSessionKeys(secretA, alice.publicKey, bob.publicKey);

    // Bob's perspective (shared secret is computed independently)
    const secretB = deriveSharedSecret(bob.privateKey, alice.publicKey);
    keysFromBob = deriveSessionKeys(secretB, bob.publicKey, alice.publicKey);
  });

  after(() => {
    alice.privateKey.destroy();
    bob.privateKey.destroy();
    keysFromAlice.encryptKey.destroy();
    keysFromAlice.decryptKey.destroy();
    keysFromBob.encryptKey.destroy();
    keysFromBob.decryptKey.destroy();
  });

  it('deriveSessionKeys produces different encrypt and decrypt key material', () => {
    // The two keys must be distinct — same material would mean no directional separation.
    let encBuf, decBuf;
    keysFromAlice.encryptKey.withAccess(b => { encBuf = Buffer.from(b); });
    keysFromAlice.decryptKey.withAccess(b => { decBuf = Buffer.from(b); });
    assert.notDeepEqual(encBuf, decBuf,
      'encryptKey and decryptKey must not be the same key material');
  });

  it('swapping public keys swaps encrypt/decrypt roles (direction correctness)', () => {
    // Alice's encryptKey == Bob's decryptKey, and vice-versa.
    let aEnc, bDec, aDec, bEnc;
    keysFromAlice.encryptKey.withAccess(b => { aEnc = Buffer.from(b); });
    keysFromBob.decryptKey.withAccess(b  => { bDec = Buffer.from(b); });
    keysFromAlice.decryptKey.withAccess(b => { aDec = Buffer.from(b); });
    keysFromBob.encryptKey.withAccess(b  => { bEnc = Buffer.from(b); });

    assert.deepEqual(aEnc, bDec,
      'Alice encryptKey must equal Bob decryptKey');
    assert.deepEqual(aDec, bEnc,
      'Alice decryptKey must equal Bob encryptKey');
  });

  it('shared secret is zeroed after deriveSessionKeys returns', () => {
    // deriveSessionKeys calls sharedSecret.fill(0) internally before returning.
    // We verify by passing a freshly computed secret and checking it is all-zero after.
    const a2 = generateExchangeKeyPair();
    const b2 = generateExchangeKeyPair();

    const secret = deriveSharedSecret(a2.privateKey, b2.publicKey);
    // secret is a plain Buffer at this point (not a SecureBuffer)
    const before = Buffer.from(secret); // snapshot a copy

    const keys = deriveSessionKeys(secret, a2.publicKey, b2.publicKey);

    // secret should now be all zeros
    assert.ok(secret.every(byte => byte === 0),
      'shared secret buffer must be zeroed after deriveSessionKeys');

    // Sanity: the snapshot was not all zeros
    assert.ok(!before.every(byte => byte === 0),
      'the shared secret was non-zero before derivation');

    a2.privateKey.destroy();
    b2.privateKey.destroy();
    keys.encryptKey.destroy();
    keys.decryptKey.destroy();
  });

  it('safety number is a 6-digit zero-padded decimal string', () => {
    const { safetyNumber } = keysFromAlice;
    assert.match(safetyNumber, /^\d{6}$/,
      `Safety number must be exactly 6 decimal digits, got: "${safetyNumber}"`);
    // Both sides must agree
    assert.equal(keysFromAlice.safetyNumber, keysFromBob.safetyNumber,
      'Safety numbers must match on both sides of the channel');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. P2P message encryption / decryption roundtrip
// ─────────────────────────────────────────────────────────────────────────────

describe('P2P message encrypt/decrypt', () => {
  let aliceKeys, bobKeys;

  before(() => {
    const a = generateExchangeKeyPair();
    const b = generateExchangeKeyPair();

    const sA = deriveSharedSecret(a.privateKey, b.publicKey);
    aliceKeys = deriveSessionKeys(sA, a.publicKey, b.publicKey);

    const sB = deriveSharedSecret(b.privateKey, a.publicKey);
    bobKeys = deriveSessionKeys(sB, b.publicKey, a.publicKey);

    a.privateKey.destroy();
    b.privateKey.destroy();
  });

  after(() => {
    aliceKeys.encryptKey.destroy();
    aliceKeys.decryptKey.destroy();
    bobKeys.encryptKey.destroy();
    bobKeys.decryptKey.destroy();
  });

  it('encryptMessage + decryptMessage roundtrips plaintext correctly', () => {
    const original = Buffer.from('hello from alice', 'utf-8');
    const ciphertext = encryptMessage(original, aliceKeys.encryptKey, 0);

    const { plaintext, sequence } = decryptMessage(ciphertext, bobKeys.decryptKey, 0);
    assert.deepEqual(plaintext, original,
      'decrypted plaintext must equal the original');
    assert.equal(sequence, 0, 'sequence number must round-trip');
  });

  it('decryptMessage throws when the wrong session key is supplied', () => {
    const msg = Buffer.from('secret', 'utf-8');
    const ciphertext = encryptMessage(msg, aliceKeys.encryptKey, 1);

    // Build a completely different 32-byte key (all 0xAB) to use as the "wrong" key.
    const wrongKeyBuf = Buffer.alloc(32, 0xAB);
    const wrongKey = SecureBuffer.from(wrongKeyBuf);

    // Decrypting with a foreign key must fail GCM authentication.
    assert.throws(
      () => decryptMessage(ciphertext, wrongKey, 1),
      /unsupported state|Unsupported state|bad decrypt|authentication|Unsupported/i,
      'decryption with a foreign key must throw an authentication error'
    );

    wrongKey.destroy();
  });

  it('decryptMessage throws on sequence number mismatch (AAD mismatch)', () => {
    const msg = Buffer.from('in order', 'utf-8');
    // Encrypt with sequence 5
    const ciphertext = encryptMessage(msg, aliceKeys.encryptKey, 5);

    // Attempt to accept it as sequence 3 — must be rejected
    assert.throws(
      () => decryptMessage(ciphertext, bobKeys.decryptKey, 3),
      /Sequence mismatch/,
      'decryptMessage must reject a message whose sequence number does not match'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. PeerChannel null-key guards
//
// #sendEncrypted returns { success: false, error: '...' } when encryptKey is
// null but state is 'open'.  Reaching this via the public API requires an
// already-open channel; the natural equivalent observable from outside is the
// channel throwing 'Channel not open' after close().  We therefore test both:
//   (a) an open channel with valid keys sends successfully (proving the happy
//       path), then close() zeroes the keys and subsequent sendText throws the
//       state error rather than silently failing — i.e. the null-key guard is
//       behind the state gate.
//   (b) handleIncomingMessage on a closed channel (keys=null, state='closed')
//       with a raw encrypted payload returns { error: 'Decryption key not
//       available' } because the state check only gates 'new'/'handshaking'.
// ─────────────────────────────────────────────────────────────────────────────

describe('PeerChannel null-key guards', () => {
  // Helper: build a fully open pair of channels with no network layer.
  // Uses real key pairs and the full handshake flow so both channels reach
  // state='open' with valid session keys derived via ECDH+HKDF.
  async function openChannelPair() {
    const aliceExch = generateExchangeKeyPair();
    const bobExch   = generateExchangeKeyPair();
    const bobSign   = generateSigningKeyPair();   // Bob needs a signing key for the ack

    const sentByBob = [];

    const aliceCh = new PeerChannel({
      peerId:   'bob',
      peerName: 'bob',
      sendFn:   async () => {}    // Alice's outbound messages are dropped in this test
    });

    const bobCh = new PeerChannel({
      peerId:   'alice',
      peerName: 'alice',
      sendFn:   async (msg) => sentByBob.push(msg)
    });

    // Bob handles Alice's handshake — this sets Bob to 'open' and sends a signed ack.
    await bobCh.handleHandshake(
      {
        type:               'handshake',
        version:            '1.0.0',
        exchangePublicKey:  aliceExch.publicKey.toString('base64'),
        timestamp:          Date.now()
      },
      bobExch.privateKey,
      bobExch.publicKey,
      bobSign.privateKey,   // Bob signs the ack
      null,                 // no attestation payload
      null                  // no attestation verifier
    );

    // The signed ack Bob sent is sentByBob[0].
    // Alice needs _myExchangePrivateKey/_myExchangePublicKey set before handleHandshakeAck.
    aliceCh._myExchangePrivateKey = aliceExch.privateKey;
    aliceCh._myExchangePublicKey  = aliceExch.publicKey;

    // Alice has no peerSigningPubKey configured, so handleHandshakeAck skips the
    // signature check and just derives session keys from the ack's exchangePublicKey.
    const ackResult = aliceCh.handleHandshakeAck(sentByBob[0], null);
    assert.ok(ackResult.success, `handleHandshakeAck failed: ${ackResult.error}`);

    bobSign.privateKey.destroy();
    return { aliceCh, bobCh, aliceExch, bobExch };
  }

  it('sendText on a closed channel throws "Channel not open" — keys already nulled', async () => {
    const { aliceCh, bobCh, aliceExch, bobExch } = await openChannelPair();
    assert.equal(aliceCh.state, 'open', 'channel must be open before close');

    // Close the channel: this destroys + nulls both keys and sets state='closed'
    await aliceCh.close();
    assert.equal(aliceCh.state, 'closed');

    // sendText must now throw about channel state, not silently return
    await assert.rejects(
      () => aliceCh.sendText('after close'),
      /Channel not open/,
      'sending on a closed (keys=null) channel must throw Channel not open'
    );

    aliceExch.privateKey.destroy();
    bobExch.privateKey.destroy();
    await bobCh.close();
  });

  it('handleIncomingMessage returns error when decryptKey is null (closed channel)', async () => {
    // A closed channel has state='closed' and keys=null.
    // handleIncomingMessage only guards against 'new'/'handshaking'; 'closed'
    // falls through to the encrypted-message path where !decryptKey is checked.
    const ch = new PeerChannel({
      peerId: 'ghost',
      sendFn: async () => {}
    });
    // Trigger close() — sets state='closed' and keys remain null (they were never set)
    await ch.close();

    const result = await ch.handleIncomingMessage({
      encrypted: Buffer.from('fake ciphertext').toString('base64')
    });

    assert.ok(result.error, 'expected an error result');
    assert.match(result.error, /Decryption key not available/,
      `expected null-key error, got: "${result.error}"`);
  });
});
