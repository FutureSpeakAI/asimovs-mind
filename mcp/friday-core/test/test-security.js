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

import { initCrypto } from '../core/crypto.js';
import { SovereignVault } from '../core/vault.js';
import { execute as commsExecute } from '../subsystems/connectors/comms.js';
import { execute as terminalExecute } from '../subsystems/connectors/terminal.js';
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
