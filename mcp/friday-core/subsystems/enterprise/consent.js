/**
 * Consent Tracking -- Persistent consent management for side-effect actions.
 *
 * Ported from nexus-os: consent-gate.ts
 * Removed: Electron, BrowserWindow, IPC, integrityManager, renderer.
 * Changed: Consent stored in vault-backed state. No UI prompts (MCP tools
 *          are the consent surface). Consent can be granted/revoked via tools.
 *
 * Categories: cloud_api, data_sharing, destructive_actions, send_messages,
 *   calendar_events, financial_actions, code_execution, browser_automation.
 *
 * Consent is persistent (vault-backed). Consent can be scoped:
 *   'once'    -- single use, consumed after first check
 *   'session' -- valid until subsystem restarts
 *   'always'  -- persisted across restarts
 */

const CONSENT_CATEGORIES = [
  'cloud_api', 'data_sharing', 'destructive_actions', 'send_messages',
  'calendar_events', 'financial_actions', 'code_execution', 'browser_automation',
];

export class ConsentTracker {
  #consents = new Map();  // category -> { granted, scope, grantedAt, reason }
  #auditLog = [];
  #state = null;
  #maxAuditEntries = 500;

  async initialize(state) {
    this.#state = state;
    try {
      const saved = await state.get('consents');
      if (saved && typeof saved === 'object') {
        for (const [category, consent] of Object.entries(saved)) {
          if (consent.scope === 'always') {
            this.#consents.set(category, consent);
          }
        }
      }
      const log = await state.get('consent-audit');
      if (Array.isArray(log)) {
        this.#auditLog = log.slice(-this.#maxAuditEntries);
      }
    } catch {
      // Fresh start
    }
  }

  // -- Consent checks -------------------------------------------------------

  checkConsent(category) {
    const consent = this.#consents.get(category);
    if (!consent) {
      this.#logAudit(category, 'check', false, 'no consent recorded');
      return { granted: false, reason: 'No consent recorded for this category' };
    }

    if (!consent.granted) {
      this.#logAudit(category, 'check', false, 'explicitly denied');
      return { granted: false, reason: consent.reason || 'Consent denied' };
    }

    // Consume once-scoped consents
    if (consent.scope === 'once') {
      this.#consents.delete(category);
      this.#queueSave();
    }

    this.#logAudit(category, 'check', true, `scope: ${consent.scope}`);
    return { granted: true, scope: consent.scope, grantedAt: consent.grantedAt };
  }

  // -- Grant / Revoke -------------------------------------------------------

  grantConsent(category, scope = 'session', reason = '') {
    const consent = {
      granted: true,
      scope,
      grantedAt: Date.now(),
      reason,
    };
    this.#consents.set(category, consent);
    this.#logAudit(category, 'grant', true, `scope: ${scope}, reason: ${reason}`);
    if (scope === 'always') this.#queueSave();
    return consent;
  }

  revokeConsent(category, reason = '') {
    const existed = this.#consents.has(category);
    this.#consents.set(category, {
      granted: false,
      scope: 'always',
      grantedAt: Date.now(),
      reason,
    });
    this.#logAudit(category, 'revoke', false, reason);
    this.#queueSave();
    return { revoked: true, existed };
  }

  revokeAll(reason = '') {
    const categories = [...this.#consents.keys()];
    for (const category of categories) {
      this.revokeConsent(category, reason);
    }
    return { revokedCount: categories.length };
  }

  // -- Status ---------------------------------------------------------------

  getStatus() {
    const result = {};
    for (const category of CONSENT_CATEGORIES) {
      const consent = this.#consents.get(category);
      result[category] = consent
        ? { granted: consent.granted, scope: consent.scope, grantedAt: consent.grantedAt }
        : { granted: false, scope: null };
    }
    return result;
  }

  getAuditLog(limit = 50) {
    return this.#auditLog.slice(-limit);
  }

  // -- Private helpers ------------------------------------------------------

  #logAudit(category, action, result, detail) {
    this.#auditLog.push({
      ts: Date.now(),
      category,
      action,
      result,
      detail,
    });
    if (this.#auditLog.length > this.#maxAuditEntries) {
      this.#auditLog = this.#auditLog.slice(-this.#maxAuditEntries);
    }
  }

  #saveQueued = false;

  #queueSave() {
    if (this.#saveQueued || !this.#state) return;
    this.#saveQueued = true;
    setTimeout(async () => {
      this.#saveQueued = false;
      try {
        const data = {};
        for (const [category, consent] of this.#consents) {
          data[category] = consent;
        }
        await this.#state.set('consents', data);
        await this.#state.set('consent-audit', this.#auditLog);
      } catch {
        // Best effort
      }
    }, 2000);
  }
}

export { CONSENT_CATEGORIES };
