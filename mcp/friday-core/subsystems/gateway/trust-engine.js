/**
 * Gateway Trust Engine -- Trust tier verification and policy enforcement.
 *
 * Ported from nexus-os: gateway/trust-engine.ts
 * Removed: Electron imports, filesystem persistence (uses vault),
 *          settingsManager (uses state), IPC, BrowserWindow.
 *
 * Trust tiers: owner > owner_dm > approved_dm > group > public
 * Each tier maps to a TrustPolicy that gates tool access, memory permissions,
 * and iteration/rate limits. Fails CLOSED to 'public' on any error.
 */

import crypto from 'node:crypto';

// -- Trust Policies -----------------------------------------------------------

const TRUST_POLICIES = {
  owner: {
    tier: 'owner',
    maxIterations: 25,
    toolAllowPatterns: ['*'],
    toolBlockPatterns: [],
    memoryRead: true,
    memoryWrite: true,
    canTriggerScheduler: true,
    rateLimitPerMinute: 999,
  },
  owner_dm: {
    tier: 'owner_dm',
    maxIterations: 15,
    toolAllowPatterns: ['*'],
    toolBlockPatterns: ['ui_automation_*', 'system_management_*', 'run_powershell', 'execute_powershell'],
    memoryRead: true,
    memoryWrite: true,
    canTriggerScheduler: true,
    rateLimitPerMinute: 30,
  },
  approved_dm: {
    tier: 'approved_dm',
    maxIterations: 8,
    toolAllowPatterns: [
      'firecrawl_*', 'web_search', 'scrape_url',
      'calendar_get_*', 'draft_communication', 'gateway_send_message',
    ],
    toolBlockPatterns: [
      'powershell_*', 'run_powershell', 'execute_powershell', 'run_command',
      'terminal_*', 'ui_automation_*', 'system_management_*', 'vscode_*',
      'git_*', 'docker_*', 'office_*', 'adobe_*',
    ],
    memoryRead: true,
    memoryWrite: false,
    canTriggerScheduler: false,
    rateLimitPerMinute: 10,
  },
  group: {
    tier: 'group',
    maxIterations: 5,
    toolAllowPatterns: ['firecrawl_*', 'web_search', 'scrape_url'],
    toolBlockPatterns: ['*'],
    memoryRead: false,
    memoryWrite: false,
    canTriggerScheduler: false,
    rateLimitPerMinute: 5,
  },
  public: {
    tier: 'public',
    maxIterations: 0,
    toolAllowPatterns: [],
    toolBlockPatterns: ['*'],
    memoryRead: false,
    memoryWrite: false,
    canTriggerScheduler: false,
    rateLimitPerMinute: 3,
  },
};

// -- Pairing Code Config ------------------------------------------------------

const PAIRING_CODE_LENGTH = 8;
const PAIRING_CODE_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// -- Trust Engine -------------------------------------------------------------

export class TrustEngine {
  #identities = [];
  #pendingPairings = new Map();
  #rateLimits = new Map();
  #ownerIds = new Map();
  #sweepTimer = null;
  #state = null;

  async initialize(state) {
    this.#state = state;

    // Periodic sweep of stale rate-limit entries
    this.#sweepTimer = setInterval(() => this.#sweepRateLimits(), 60_000);
    if (this.#sweepTimer.unref) this.#sweepTimer.unref();

    // Load identities from vault-backed state
    try {
      const data = await state.get('identities');
      if (Array.isArray(data)) {
        this.#identities = data;
      }
    } catch {
      this.#identities = [];
    }
  }

  async destroy() {
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
  }

  // -- Owner registration ---------------------------------------------------

  setOwner(channel, senderId) {
    if (senderId) {
      this.#ownerIds.set(channel, senderId);
    }
  }

  // -- Trust resolution (fails CLOSED to 'public') -------------------------

  resolveTrust(channel, senderId) {
    try {
      const ownerId = this.#ownerIds.get(channel);
      if (ownerId && ownerId === senderId) {
        return 'owner_dm';
      }
      const identity = this.#identities.find(
        (id) => id.channel === channel && id.senderId === senderId,
      );
      if (identity) return identity.tier;
      return 'public';
    } catch {
      return 'public';
    }
  }

  // -- Policy lookup --------------------------------------------------------

  getPolicy(tier) {
    return TRUST_POLICIES[tier] || TRUST_POLICIES.public;
  }

  // -- Tool filtering -------------------------------------------------------

  filterTools(toolNames, policy) {
    if (policy.tier === 'owner') return toolNames;
    if (policy.tier === 'public') return [];

    return toolNames.filter((name) => {
      const allowed = this.#matchesAny(name, policy.toolAllowPatterns);
      const blocked = this.#matchesAny(name, policy.toolBlockPatterns);
      if (policy.tier === 'group') return allowed;
      if (blocked) return false;
      return allowed;
    });
  }

  // -- Rate limiting --------------------------------------------------------

  checkRateLimit(senderId, policy) {
    const now = Date.now();
    const windowMs = 60_000;

    if (!this.#rateLimits.has(senderId) && this.#rateLimits.size >= 10_000) {
      return false;
    }

    let entry = this.#rateLimits.get(senderId);
    if (!entry) {
      entry = { timestamps: [] };
      this.#rateLimits.set(senderId, entry);
    }

    entry.timestamps = entry.timestamps.filter((ts) => now - ts < windowMs);
    if (entry.timestamps.length >= policy.rateLimitPerMinute) return false;

    entry.timestamps.push(now);
    return true;
  }

  // -- Pairing flow ---------------------------------------------------------

  generatePairingCode(channel, senderId, senderName) {
    for (const [code, pending] of this.#pendingPairings) {
      if (pending.channel === channel && pending.senderId === senderId) {
        if (pending.expiresAt > Date.now()) return code;
        this.#pendingPairings.delete(code);
      }
    }
    const code = this.#generateCode();
    this.#pendingPairings.set(code, {
      code, channel, senderId, senderName,
      createdAt: Date.now(),
      expiresAt: Date.now() + PAIRING_CODE_EXPIRY_MS,
    });
    this.#cleanExpiredPairings();
    return code;
  }

  getPendingPairings() {
    this.#cleanExpiredPairings();
    return Array.from(this.#pendingPairings.values());
  }

  async approvePairing(code, tier = 'approved_dm') {
    const normalized = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pending = this.#pendingPairings.get(normalized);
    if (!pending || pending.expiresAt < Date.now()) return null;

    const identity = {
      id: crypto.randomUUID(),
      channel: pending.channel,
      senderId: pending.senderId,
      name: pending.senderName,
      tier,
      pairedAt: Date.now(),
    };

    this.#identities = this.#identities.filter(
      (id) => !(id.channel === pending.channel && id.senderId === pending.senderId),
    );
    this.#identities.push(identity);
    this.#pendingPairings.delete(normalized);
    await this.#saveIdentities();
    return identity;
  }

  async revokePairing(identityId) {
    const before = this.#identities.length;
    this.#identities = this.#identities.filter((id) => id.id !== identityId);
    if (this.#identities.length < before) {
      await this.#saveIdentities();
      return true;
    }
    return false;
  }

  getPairedIdentities() {
    return [...this.#identities];
  }

  // -- Private helpers ------------------------------------------------------

  #matchesAny(name, patterns) {
    for (const p of patterns) {
      if (p === '*') return true;
      if (p.endsWith('*') && name.startsWith(p.slice(0, -1))) return true;
      if (p === name) return true;
    }
    return false;
  }

  #generateCode() {
    let code = '';
    for (let i = 0; i < PAIRING_CODE_LENGTH; i++) {
      code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    }
    return code;
  }

  #cleanExpiredPairings() {
    const now = Date.now();
    for (const [code, pending] of this.#pendingPairings) {
      if (pending.expiresAt < now) this.#pendingPairings.delete(code);
    }
  }

  #sweepRateLimits() {
    const now = Date.now();
    for (const [key, entry] of this.#rateLimits) {
      const newest = entry.timestamps.length > 0 ? Math.max(...entry.timestamps) : 0;
      if (now - newest > 300_000) this.#rateLimits.delete(key);
    }
  }

  async #saveIdentities() {
    try {
      if (this.#state) {
        await this.#state.set('identities', this.#identities);
      }
    } catch (err) {
      process.stderr.write('[friday:trust] Failed to save identities: ' + (err instanceof Error ? err.message : 'Unknown error') + '\n');
    }
  }
}
