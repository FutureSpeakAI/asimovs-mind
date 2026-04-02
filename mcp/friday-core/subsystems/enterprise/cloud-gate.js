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
      const savedResult = await state.read('cloud-policies');
      const saved = savedResult?.success ? savedResult.data : null;
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
    // 1. Verify cloud API consent exists WITHOUT consuming it yet.
    //    Consuming a once-scoped consent happens only if we ultimately allow
    //    the action — doing it before the policy check would silently spend
    //    the grant even when the gate returns denied.
    if (this.#consentTracker) {
      const consentState = this.#consentTracker.peekConsent('cloud_api');
      if (!consentState.granted) {
        this.#stats.escalatedDenied++;
        return { allowed: false, reason: 'no-cloud-consent', detail: 'User has not consented to cloud API access' };
      }
    }

    // 2. Check category-specific policy
    const policy = this.#policies.get(taskCategory);

    if (!policy) {
      // No explicit policy -- default: deny (sovereign-first)
      this.#stats.escalatedDenied++;
      return {
        allowed: false,
        reason: 'no-policy',
        detail: `No policy for task category "${taskCategory}". Set one with enterprise_cloud_gate action:"set_policy".`,
      };
    }

    if (policy.decision !== 'allow') {
      // Policy explicitly denies — no consent consumed, no policy consumed
      this.#stats.escalatedDenied++;
      return { allowed: false, reason: 'policy-deny', detail: `Policy denies ${taskCategory}` };
    }

    // 3. Action is allowed — now consume once-scoped grants
    if (this.#consentTracker) {
      this.#consentTracker.checkConsent('cloud_api');
    }
    if (policy.scope === 'once') {
      this.#policies.delete(taskCategory);
    }

    this.#stats.escalatedAllowed++;
    return { allowed: true, reason: 'policy-allow', detail: `Policy allows ${taskCategory} (scope: ${policy.scope})` };
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
      this.#state.write('cloud-policies', {}).catch(() => {});
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
      const result = await this.#state.read('cloud-policies');
      const existing = (result?.success ? result.data : null) || {};
      if (policy) {
        existing[category] = policy;
      } else {
        delete existing[category];
      }
      await this.#state.write('cloud-policies', existing);
    } catch {
      // Best effort
    }
  }
}

export { TASK_CATEGORIES, POLICY_SCOPES };
