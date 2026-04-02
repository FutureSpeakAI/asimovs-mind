/**
 * Cloud Gate -- Consent-based cloud access gating.
 *
 * Ported from nexus-os: cloud-gate.ts
 * Removed: Electron, IPC, BrowserWindow, settingsManager.
 * Changed: Uses ConsentTracker for consent state. Policies in vault.
 *
 * Before any cloud API call, CloudGate checks:
 *   1. User consented to cloud API access
 *   2. Data is appropriate for cloud (no PII without explicit consent)
 *   3. The specific task category has a policy
 *
 * Returns allow/deny with a reason. Sovereign-first: when in doubt, stay local.
 */

const TASK_CATEGORIES = ['code', 'chat', 'analysis', 'creative', 'tool-use', 'general'];
const POLICY_SCOPES = ['once', 'session', 'always'];

export class CloudGate {
  #policies = new Map();   // taskCategory -> { decision, scope, createdAt }
  #stats = { localDelivered: 0, escalatedAllowed: 0, escalatedDenied: 0 };
  #consentTracker = null;
  #state = null;

  async initialize(state, consentTracker) {
    this.#state = state;
    this.#consentTracker = consentTracker;

    try {
      const saved = await state.get('cloud-policies');
      if (saved && typeof saved === 'object') {
        for (const [category, policy] of Object.entries(saved)) {
          if (policy && policy.scope === 'always') {
            this.#policies.set(category, policy);
          }
        }
      }
    } catch {
      // Fresh start
    }
  }

  // -- Gate check -----------------------------------------------------------

  checkGate(taskCategory, _context) {
    // 1. Check if cloud API consent exists
    if (this.#consentTracker) {
      const consent = this.#consentTracker.checkConsent('cloud_api');
      if (!consent.granted) {
        this.#stats.escalatedDenied++;
        return { allowed: false, reason: 'no-cloud-consent', detail: 'User has not consented to cloud API access' };
      }
    }

    // 2. Check category-specific policy
    const policy = this.#policies.get(taskCategory);
    if (policy) {
      if (policy.scope === 'once') {
        this.#policies.delete(taskCategory);
      }
      if (policy.decision === 'allow') {
        this.#stats.escalatedAllowed++;
        return { allowed: true, reason: 'policy-allow', detail: `Policy allows ${taskCategory} (scope: ${policy.scope})` };
      } else {
        this.#stats.escalatedDenied++;
        return { allowed: false, reason: 'policy-deny', detail: `Policy denies ${taskCategory}` };
      }
    }

    // 3. No explicit policy -- default: deny (sovereign-first)
    this.#stats.escalatedDenied++;
    return {
      allowed: false,
      reason: 'no-policy',
      detail: `No policy for task category "${taskCategory}". Set one with enterprise_cloud_gate action:"set_policy".`,
    };
  }

  // -- Policy management ----------------------------------------------------

  setPolicy(category, decision, scope = 'session') {
    const policy = { decision, scope, createdAt: Date.now() };
    this.#policies.set(category, policy);
    if (scope === 'always') this.#persistPolicy(category, policy);
    return policy;
  }

  getPolicy(category) {
    return this.#policies.get(category) || null;
  }

  clearPolicy(category) {
    const existed = this.#policies.has(category);
    this.#policies.delete(category);
    this.#persistPolicy(category, null);
    return existed;
  }

  clearAllPolicies() {
    const count = this.#policies.size;
    this.#policies.clear();
    if (this.#state) {
      this.#state.set('cloud-policies', {}).catch(() => {});
    }
    return count;
  }

  // -- Stats ----------------------------------------------------------------

  getStats() {
    return { ...this.#stats };
  }

  incrementStat(type) {
    if (type in this.#stats) this.#stats[type]++;
  }

  getAllPolicies() {
    const result = {};
    for (const [category, policy] of this.#policies) {
      result[category] = { ...policy };
    }
    return result;
  }

  // -- Private helpers ------------------------------------------------------

  async #persistPolicy(category, policy) {
    try {
      if (!this.#state) return;
      const existing = (await this.#state.get('cloud-policies')) || {};
      if (policy) {
        existing[category] = policy;
      } else {
        delete existing[category];
      }
      await this.#state.set('cloud-policies', existing);
    } catch {
      // Best effort
    }
  }
}

export { TASK_CATEGORIES, POLICY_SCOPES };
