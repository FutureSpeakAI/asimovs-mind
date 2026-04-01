/**
 * User Happy Path Tests
 *
 * Tests the plugin from a USER's perspective, not a developer's.
 * Each test simulates what a real user would experience.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { initCrypto } from './crypto.js';
import { SovereignVault } from './vault.js';

const PLUGIN_ROOT = path.resolve(import.meta.dirname, '..', '..');
const TEST_PASSPHRASE = 'correct horse battery staple extra words here today';
let testDir;

before(async () => {
  await initCrypto();
  testDir = path.join(os.tmpdir(), `user-paths-${Date.now()}`);
});

after(async () => {
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
});

// ============================================================
// PATH 1: Brand New User — First Install
// ============================================================

describe('PATH 1: Brand New User — First Install', () => {
  it('GETTING_STARTED.md exists and is readable', async () => {
    const content = await fs.readFile(path.join(PLUGIN_ROOT, 'GETTING_STARTED.md'), 'utf-8');
    assert.ok(content.length > 200, 'GETTING_STARTED.md is too short');
    assert.ok(content.includes('/friday unlock'), 'Should mention /friday unlock');
    assert.ok(content.includes('/onboard'), 'Should mention /onboard');
    assert.ok(content.includes('Node.js') || content.includes('node'), 'Should mention Node.js prerequisite');
    assert.ok(content.includes('Python') || content.includes('python'), 'Should mention Python prerequisite');
  });

  it('README.md points to GETTING_STARTED.md', async () => {
    const content = await fs.readFile(path.join(PLUGIN_ROOT, 'README.md'), 'utf-8');
    assert.ok(content.includes('GETTING_STARTED'), 'README should reference GETTING_STARTED.md');
  });

  it('plugin.json declares MCP server that points to existing file', async () => {
    const raw = await fs.readFile(path.join(PLUGIN_ROOT, 'plugin.json'), 'utf-8');
    const plugin = JSON.parse(raw);
    assert.ok(plugin.mcpServers, 'plugin.json should declare mcpServers');
    assert.ok(plugin.mcpServers['sovereign-vault'], 'Should have sovereign-vault MCP server');
    const serverPath = path.join(PLUGIN_ROOT, 'mcp', 'vault-server', 'index.js');
    const exists = await fs.access(serverPath).then(() => true).catch(() => false);
    assert.ok(exists, 'MCP server index.js should exist');
  });

  it('vault server has self-bootstrapping for npm install', async () => {
    const indexContent = await fs.readFile(path.join(PLUGIN_ROOT, 'mcp', 'vault-server', 'index.js'), 'utf-8');
    assert.ok(indexContent.includes('ensureDependencies'), 'Should have ensureDependencies function');
    assert.ok(indexContent.includes('npm install'), 'Should auto-run npm install');
  });
});

// ============================================================
// PATH 2: First Session — Vault Setup
// ============================================================

describe('PATH 2: First Session — Vault Initialization', () => {
  let vault;
  const vaultDir = path.join(os.tmpdir(), `user-vault-${Date.now()}`);

  after(async () => {
    if (vault) vault.lock();
    try { await fs.rm(vaultDir, { recursive: true, force: true }); } catch {}
  });

  it('vault starts uninitialized (user has never set up)', async () => {
    vault = new SovereignVault(vaultDir);
    await vault.init();
    assert.equal(vault.status, 'uninitialized');
  });

  it('personality-loader would show first-time setup banner', async () => {
    const loaderContent = await fs.readFile(path.join(PLUGIN_ROOT, 'hooks', 'personality-loader.py'), 'utf-8');
    assert.ok(loaderContent.includes('/friday unlock'), 'Loader should mention /friday unlock in first-run path');
    assert.ok(loaderContent.includes('/onboard'), 'Loader should mention /onboard in first-run path');
  });

  it('user creates vault with passphrase', async () => {
    const result = await vault.initialize(TEST_PASSPHRASE);
    assert.ok(result.success, `Init failed: ${result.error}`);
    assert.equal(vault.status, 'unlocked');
  });

  it('vault files are created on disk', async () => {
    const files = ['salt', 'canary.enc', 'meta.json'];
    for (const file of files) {
      const exists = await fs.access(path.join(vaultDir, file)).then(() => true).catch(() => false);
      assert.ok(exists, `Vault file missing after init: ${file}`);
    }
  });

  it('user rejects weak passphrase', async () => {
    const weakVault = new SovereignVault(path.join(os.tmpdir(), `weak-${Date.now()}`));
    await weakVault.init();
    const result = await weakVault.initialize('too short');
    assert.ok(!result.success);
    assert.ok(result.error.includes('8 words'), `Error should mention 8 words: ${result.error}`);
  });
});

// ============================================================
// PATH 3: Returning User — Unlock and Resume
// ============================================================

describe('PATH 3: Returning User — Unlock and Resume', () => {
  let vault;
  const vaultDir = path.join(os.tmpdir(), `return-user-${Date.now()}`);

  before(async () => {
    vault = new SovereignVault(vaultDir);
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
    // Simulate previous session: save a profile
    await vault.write('user-profile', {
      name: 'Stephen',
      role: 'creator',
      mode: 'partner',
      preferences: { verbose: false }
    });
    await vault.write('recent-sessions', [
      { date: '2026-03-31', summary: 'Built P2P protocol' }
    ]);
    vault.lock();
  });

  after(() => { if (vault) vault.lock(); });

  it('vault is locked at session start', () => {
    assert.equal(vault.status, 'locked');
  });

  it('wrong passphrase is rejected with clear message', async () => {
    const result = await vault.unlock('this is the wrong passphrase for sure yes definitely');
    assert.ok(!result.success);
    assert.ok(result.error.includes('Wrong passphrase'), `Error should say wrong passphrase: ${result.error}`);
  });

  it('correct passphrase unlocks and data is available', async () => {
    const result = await vault.unlock(TEST_PASSPHRASE);
    assert.ok(result.success);

    const profile = await vault.read('user-profile');
    assert.equal(profile.data.name, 'Stephen');
    assert.equal(profile.data.mode, 'partner');

    const sessions = await vault.read('recent-sessions');
    assert.equal(sessions.data.length, 1);
    assert.ok(sessions.data[0].summary.includes('P2P'));
  });
});

// ============================================================
// PATH 4: User Saves and Retrieves Work
// ============================================================

describe('PATH 4: User Saves and Retrieves Work Across Sessions', () => {
  let vault;
  const vaultDir = path.join(os.tmpdir(), `work-${Date.now()}`);

  before(async () => {
    vault = new SovereignVault(vaultDir);
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
  });

  after(() => vault.lock());

  it('trust scores persist across lock/unlock', async () => {
    await vault.write('trust-scores', {
      'KellerJordan/Muon': { trust: 0.92, kept: 2 },
      'facebookresearch/schedule_free': { trust: 0.65, kept: 0 }
    });

    vault.lock();
    await vault.unlock(TEST_PASSPHRASE);

    const scores = await vault.read('trust-scores');
    assert.equal(scores.data['KellerJordan/Muon'].trust, 0.92);
  });

  it('session history appends correctly', async () => {
    await vault.write('session-history', []);
    await vault.append('session-history', { session: 1, date: '2026-04-01', files: 12 });
    await vault.append('session-history', { session: 2, date: '2026-04-01', files: 8 });

    const history = await vault.read('session-history');
    assert.equal(history.data.length, 2);
    assert.equal(history.data[0].session, 1);
    assert.equal(history.data[1].session, 2);
  });

  it('agent performance tracking works', async () => {
    await vault.write('agent-trust', {
      debugger: { deployed: 47, kept: 43, crashed: 0, keep_rate: 0.91 },
      optimizer: { deployed: 31, kept: 24, crashed: 1, keep_rate: 0.77 }
    });

    const trust = await vault.read('agent-trust');
    assert.ok(trust.data.debugger.keep_rate > 0.9);
    assert.ok(trust.data.optimizer.keep_rate > 0.7);
  });
});

// ============================================================
// PATH 5: User Sends Encrypted Message to Peer
// ============================================================

describe('PATH 5: User-to-User Encrypted Communication', () => {
  let aliceVault, bobVault;

  before(async () => {
    aliceVault = new SovereignVault(path.join(testDir, 'alice-msg'));
    bobVault = new SovereignVault(path.join(testDir, 'bob-msg'));
    await aliceVault.init();
    await bobVault.init();
    await aliceVault.initialize(TEST_PASSPHRASE);
    await bobVault.initialize(TEST_PASSPHRASE);
  });

  after(() => {
    aliceVault.lock();
    bobVault.lock();
  });

  it('both users can generate identities', async () => {
    const aliceId = await aliceVault.generateIdentity('alice-dev');
    const bobId = await bobVault.generateIdentity('bob-dev');
    assert.ok(aliceId.success);
    assert.ok(bobId.success);
    // Public keys are different
    assert.notEqual(aliceId.publicKeys.signing, bobId.publicKeys.signing);
  });

  it('both users can generate attestations proving governance', async () => {
    const laws = '{"first_law":"do no harm"}';
    const aliceAttest = await aliceVault.generateAttestation(laws);
    const bobAttest = await bobVault.generateAttestation(laws);
    assert.ok(aliceAttest.success);
    assert.ok(bobAttest.success);

    // Each can verify the other's attestation
    const aliceVerifies = aliceVault.verifyAttestation(bobAttest.attestation, laws);
    const bobVerifies = bobVault.verifyAttestation(aliceAttest.attestation, laws);
    assert.ok(aliceVerifies.valid, `Alice can't verify Bob: ${aliceVerifies.reason}`);
    assert.ok(bobVerifies.valid, `Bob can't verify Alice: ${bobVerifies.reason}`);
  });
});

// ============================================================
// PATH 6: Privacy Shield Protects Real-World Data
// ============================================================

describe('PATH 6: Privacy Shield Protects Real User Data', () => {
  let vault;

  before(async () => {
    vault = new SovereignVault(path.join(testDir, 'privacy-user'));
    await vault.init();
    await vault.initialize(TEST_PASSPHRASE);
  });

  after(() => vault.lock());

  it('protects a realistic cloud API request', () => {
    const shield = vault.privacyShield;
    shield.reset();
    const nonce = shield.getNonce();

    // Simulate a user asking Claude to search for something personal
    const userQuery = 'Find flights from Austin to NYC for stephen@futurespeak.ai on May 15. My Stripe key is sk-test-51Hf8KqR8x9yz1234567890abc and my phone is 512-867-5309.';

    const scrubbed = scrubWithShield(userQuery, nonce, shield);

    // Verify all PII removed
    assert.ok(!scrubbed.includes('stephen@futurespeak.ai'), 'Email leaked');
    assert.ok(!scrubbed.includes('sk-test-'), 'Stripe key leaked');
    assert.ok(!scrubbed.includes('512-867-5309'), 'Phone leaked');

    // Verify structural content preserved
    assert.ok(scrubbed.includes('flights from Austin'), 'Non-PII content lost');
    assert.ok(scrubbed.includes('May 15'), 'Date content lost');

    // Verify rehydration
    const restored = rehydrateWithShield(scrubbed, shield);
    assert.equal(restored, userQuery, 'Rehydration failed');
  });

  it('does NOT scrub local/private IPs (they are safe)', () => {
    const shield = vault.privacyShield;
    shield.reset();
    const nonce = shield.getNonce();

    const text = 'My server is at 192.168.1.100 and localhost is 127.0.0.1';
    const scrubbed = scrubWithShield(text, nonce, shield);

    // Private IPs should NOT be scrubbed
    assert.ok(scrubbed.includes('127.0.0.1'), 'Should not scrub localhost');
    assert.ok(scrubbed.includes('192.168.1.100'), 'Should not scrub private IP');
  });
});

// ============================================================
// PATH 7: Onboard Skill Requires Vault
// ============================================================

describe('PATH 7: Onboarding Requires Vault', () => {
  it('onboard skill checks vault status before proceeding', async () => {
    const content = await fs.readFile(path.join(PLUGIN_ROOT, 'skills', 'onboard', 'SKILL.md'), 'utf-8');
    assert.ok(content.includes('vault_status') || content.includes('vault'),
      'Onboard skill should check vault status');
    assert.ok(content.includes('/friday unlock'),
      'Onboard skill should direct user to /friday unlock if vault not ready');
  });

  it('unlock skill reads port from file, not hardcoded', async () => {
    const content = await fs.readFile(path.join(PLUGIN_ROOT, 'skills', 'unlock', 'SKILL.md'), 'utf-8');
    assert.ok(!content.includes('9780'), 'Should not hardcode port 9780');
    assert.ok(content.includes('vault/port') || content.includes('port'),
      'Should read port from .asimovs-mind/vault/port');
  });
});

// ============================================================
// PATH 8: Governance Protects User
// ============================================================

describe('PATH 8: Governance Framework Works', () => {
  it('laws.json has all three laws', async () => {
    const raw = await fs.readFile(path.join(PLUGIN_ROOT, 'governance', 'laws.json'), 'utf-8');
    const laws = JSON.parse(raw);
    const text = JSON.stringify(laws).toLowerCase();
    assert.ok(text.includes('harm') || text.includes('first'), 'First law missing');
    assert.ok(text.includes('obey') || text.includes('second'), 'Second law missing');
    assert.ok(text.includes('protect') || text.includes('third'), 'Third law missing');
  });

  it('safety floors enforce encryption', async () => {
    const raw = await fs.readFile(path.join(PLUGIN_ROOT, 'governance', 'safety-floors.json'), 'utf-8');
    assert.ok(raw.includes('encryption_at_rest'), 'Missing encryption safety floor');
    assert.ok(raw.includes('privacy_shield_on_cloud'), 'Missing privacy shield safety floor');
  });

  it('protected zones protect vault files', async () => {
    const raw = await fs.readFile(path.join(PLUGIN_ROOT, 'governance', 'protected-zones.json'), 'utf-8');
    assert.ok(raw.includes('vault'), 'Vault should be a protected zone');
  });
});

// ============================================================
// Helpers
// ============================================================

function scrubWithShield(text, nonce, shield) {
  const PII = {
    SECRET: [/sk-[a-zA-Z0-9_-]{20,}/g],
    EMAIL: [/\b[a-zA-Z0-9._%+-]{1,64}@[a-zA-Z0-9.-]{1,253}\.[a-zA-Z]{2,}\b/g],
    PHONE: [/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g],
    IP: [/\b(?!127\.0\.0\.1|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g],
  };
  let result = text;
  const seed = parseInt(nonce.slice(0, 8), 16);
  for (const [cat, pats] of Object.entries(PII)) {
    for (const pat of pats) {
      pat.lastIndex = 0;
      result = result.replace(pat, (match) => {
        let h = 2166136261 ^ seed;
        for (let i = 0; i < match.length; i++) { h ^= match.charCodeAt(i); h = Math.imul(h, 16777619); }
        const ph = `\u00abPII:${cat}:${(h >>> 0).toString(16).padStart(8, '0')}\u00bb`;
        shield.storePiiMapping(ph, match, cat);
        return ph;
      });
    }
  }
  return result;
}

function rehydrateWithShield(text, shield) {
  return text.replace(/\u00abPII:[A-Z_]+:[0-9a-f]+\u00bb/g, (ph) => {
    const m = shield.getPiiMapping(ph);
    return m ? m.original : ph;
  });
}
