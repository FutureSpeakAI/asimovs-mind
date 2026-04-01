/**
 * Commitment Tracker -- Logs and tracks commitments Friday makes to the user.
 *
 * Ported from nexus-os: commitment-tracker.ts
 * Removed: Electron, app.getPath, filesystem persistence.
 * Changed: Vault-backed state. No timers (on-demand via tools).
 *
 * Tracks commitments (promises, deadlines, follow-ups) from conversations
 * and messages. Detects unreplied communications and generates proactive nudges.
 *
 * All proactive outputs are SUGGESTIONS only. No message is ever sent
 * without explicit user approval.
 */

import crypto from 'node:crypto';

const DEFAULT_CONFIG = {
  maxCommitments: 200,
  maxOutboundMessages: 100,
  retentionDays: 90,
  defaultResponseHours: 48,
  reminderLeadHours: 24,
  minConfidence: 0.5,
};

const CHANNEL_RESPONSE_BASELINES = {
  email: 48,
  slack: 4,
  teams: 4,
  telegram: 8,
  text: 2,
  discord: 12,
  whatsapp: 4,
  meeting: 168,
  default: 48,
};

export class CommitmentTracker {
  #commitments = [];
  #outboundMessages = [];
  #followUpSuggestions = [];
  #config;
  #state = null;
  #saveQueued = false;

  constructor(config) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(state) {
    this.#state = state;
    try {
      const data = await state.get('commitments');
      if (data) {
        this.#commitments = Array.isArray(data.commitments) ? data.commitments : [];
        this.#outboundMessages = Array.isArray(data.outboundMessages) ? data.outboundMessages : [];
        this.#followUpSuggestions = Array.isArray(data.followUpSuggestions) ? data.followUpSuggestions : [];
      }
    } catch {
      // Fresh start
    }
    this.#updateOverdueStatus();
    this.#pruneOld();
  }

  // -- Commitment CRUD ------------------------------------------------------

  addCommitment(mention) {
    if (mention.confidence < this.#config.minConfidence) return null;

    // Dedup
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const isDupe = this.#commitments.some((c) =>
      c.personName.toLowerCase() === mention.personName.toLowerCase() &&
      c.createdAt > oneHourAgo &&
      this.#textSimilarity(c.description, mention.description) > 0.7,
    );
    if (isDupe) return null;

    const commitment = {
      id: crypto.randomUUID().slice(0, 12),
      description: mention.description.slice(0, 500),
      direction: mention.direction,
      personName: mention.personName.slice(0, 100),
      source: mention.source || 'conversation',
      status: 'active',
      createdAt: Date.now(),
      deadline: mention.deadline || null,
      domain: (mention.domain || '').slice(0, 50),
      contextSnippet: (mention.contextSnippet || '').slice(0, 300),
      confidence: Math.max(0, Math.min(1, mention.confidence)),
      reminded: false,
      lastRemindedAt: null,
      resolvedAt: null,
      notes: '',
    };

    this.#commitments.push(commitment);
    this.#enforceLimit();
    this.#queueSave();
    return commitment;
  }

  completeCommitment(id, notes) {
    const c = this.#commitments.find((x) => x.id === id);
    if (!c || c.status === 'completed' || c.status === 'cancelled') return false;
    c.status = 'completed';
    c.resolvedAt = Date.now();
    if (notes) c.notes = notes;
    this.#queueSave();
    return true;
  }

  cancelCommitment(id, reason) {
    const c = this.#commitments.find((x) => x.id === id);
    if (!c || c.status === 'completed' || c.status === 'cancelled') return false;
    c.status = 'cancelled';
    c.resolvedAt = Date.now();
    if (reason) c.notes = reason;
    this.#queueSave();
    return true;
  }

  snoozeCommitment(id, untilMs) {
    const c = this.#commitments.find((x) => x.id === id);
    if (!c || c.status === 'completed' || c.status === 'cancelled') return false;
    c.status = 'snoozed';
    c.lastRemindedAt = untilMs;
    this.#queueSave();
    return true;
  }

  // -- Outbound message tracking --------------------------------------------

  trackOutboundMessage(msg) {
    const baseline = CHANNEL_RESPONSE_BASELINES[msg.channel?.toLowerCase()] ?? CHANNEL_RESPONSE_BASELINES.default;
    const contactBaseline = this.#getContactBaseline(msg.recipient, msg.channel);

    const outbound = {
      id: crypto.randomUUID().slice(0, 12),
      recipient: (msg.recipient || '').slice(0, 100),
      channel: (msg.channel || '').slice(0, 30),
      summary: (msg.summary || '').slice(0, 300),
      sentAt: Date.now(),
      replyReceived: false,
      replyReceivedAt: null,
      expectedResponseHours: contactBaseline ?? baseline,
      followUpSuggested: false,
    };

    this.#outboundMessages.push(outbound);
    if (this.#outboundMessages.length > this.#config.maxOutboundMessages) {
      const replied = this.#outboundMessages.filter((m) => m.replyReceived).sort((a, b) => a.sentAt - b.sentAt);
      if (replied.length > 0) {
        this.#outboundMessages = this.#outboundMessages.filter((m) => m.id !== replied[0].id);
      } else {
        this.#outboundMessages.shift();
      }
    }

    this.#queueSave();
    return outbound;
  }

  recordReply(recipient, channel) {
    const lower = recipient.toLowerCase();
    const lowerChan = channel.toLowerCase();
    const msg = [...this.#outboundMessages].reverse().find((m) =>
      !m.replyReceived && m.recipient.toLowerCase().includes(lower) && m.channel.toLowerCase() === lowerChan,
    );
    if (!msg) return false;
    msg.replyReceived = true;
    msg.replyReceivedAt = Date.now();
    this.#queueSave();
    return true;
  }

  // -- Follow-up generation -------------------------------------------------

  generateFollowUpSuggestions() {
    const now = Date.now();
    const suggestions = [];

    for (const msg of this.#outboundMessages) {
      if (msg.replyReceived || msg.followUpSuggested) continue;
      const elapsed = (now - msg.sentAt) / (60 * 60 * 1000);
      if (elapsed >= msg.expectedResponseHours) {
        const days = Math.round(elapsed / 24);
        suggestions.push({
          id: crypto.randomUUID().slice(0, 12),
          relatedId: msg.id,
          type: 'unreplied_message',
          personName: msg.recipient,
          suggestedAction: `No reply from ${msg.recipient} on ${msg.channel} after ${days > 0 ? days + ' day(s)' : Math.round(elapsed) + ' hours'}. Original: "${msg.summary.slice(0, 80)}". Consider a follow-up.`,
          urgency: this.#computeUrgency(elapsed, msg.expectedResponseHours),
          createdAt: now,
        });
        msg.followUpSuggested = true;
      }
    }

    for (const c of this.#commitments) {
      if (c.status !== 'active' || !c.deadline || c.reminded) continue;
      const hoursUntil = (c.deadline - now) / (60 * 60 * 1000);
      if (hoursUntil <= this.#config.reminderLeadHours && hoursUntil > 0) {
        const who = c.direction === 'user_promised' ? 'You committed' : `${c.personName} committed`;
        suggestions.push({
          id: crypto.randomUUID().slice(0, 12),
          relatedId: c.id,
          type: 'approaching_deadline',
          personName: c.personName,
          suggestedAction: `${who} to "${c.description.slice(0, 80)}" -- due in ${hoursUntil < 24 ? Math.round(hoursUntil) + 'h' : Math.round(hoursUntil / 24) + 'd'}.`,
          urgency: hoursUntil <= 4 ? 'high' : 'medium',
          createdAt: now,
        });
        c.reminded = true;
        c.lastRemindedAt = now;
      }
    }

    for (const c of this.#commitments) {
      if (c.status !== 'overdue') continue;
      if (c.lastRemindedAt && (now - c.lastRemindedAt) < 24 * 60 * 60 * 1000) continue;
      const hoursOverdue = (now - (c.deadline || c.createdAt)) / (60 * 60 * 1000);
      const who = c.direction === 'user_promised' ? 'You promised' : `${c.personName} promised`;
      suggestions.push({
        id: crypto.randomUUID().slice(0, 12),
        relatedId: c.id,
        type: 'overdue_commitment',
        personName: c.personName,
        suggestedAction: `OVERDUE: ${who} "${c.description.slice(0, 80)}" -- ${Math.round(hoursOverdue / 24)} day(s) overdue.`,
        urgency: hoursOverdue > 72 ? 'critical' : 'high',
        createdAt: now,
      });
      c.lastRemindedAt = now;
    }

    if (suggestions.length > 0) {
      this.#followUpSuggestions.push(...suggestions);
      if (this.#followUpSuggestions.length > 100) {
        this.#followUpSuggestions = this.#followUpSuggestions.slice(-100);
      }
      this.#queueSave();
    }

    return suggestions;
  }

  // -- Queries --------------------------------------------------------------

  getActiveCommitments() {
    return this.#commitments.filter((c) => c.status === 'active' || c.status === 'overdue');
  }

  getOverdueCommitments() {
    return this.#commitments.filter((c) => c.status === 'overdue');
  }

  getUpcomingDeadlines(withinHours = 72) {
    const cutoff = Date.now() + withinHours * 60 * 60 * 1000;
    return this.#commitments
      .filter((c) => c.status === 'active' && c.deadline && c.deadline <= cutoff && c.deadline > Date.now())
      .sort((a, b) => (a.deadline || 0) - (b.deadline || 0));
  }

  getUnrepliedMessages() {
    return this.#outboundMessages.filter((m) => !m.replyReceived);
  }

  getPendingSuggestions() {
    return this.#followUpSuggestions.filter((s) => !s.delivered);
  }

  getCommitmentById(id) {
    return this.#commitments.find((c) => c.id === id) || null;
  }

  getStatus() {
    return {
      activeCommitments: this.#commitments.filter((c) => c.status === 'active').length,
      overdueCommitments: this.#commitments.filter((c) => c.status === 'overdue').length,
      pendingFollowUps: this.#followUpSuggestions.filter((s) => !s.delivered).length,
      trackedOutbound: this.#outboundMessages.filter((m) => !m.replyReceived).length,
      totalTracked: this.#commitments.length,
    };
  }

  getContextString() {
    const active = this.getActiveCommitments();
    const unreplied = this.getUnrepliedMessages();
    if (active.length === 0 && unreplied.length === 0) return '';

    const lines = [];
    const overdue = this.getOverdueCommitments();
    if (overdue.length > 0) {
      lines.push('OVERDUE:');
      for (const c of overdue.slice(0, 5)) {
        const days = Math.round((Date.now() - (c.deadline || c.createdAt)) / (24 * 60 * 60 * 1000));
        const who = c.direction === 'user_promised' ? 'You promised' : `${c.personName} promised`;
        lines.push(`  - ${who}: "${c.description.slice(0, 60)}" (${days}d overdue)`);
      }
    }

    const upcoming = this.getUpcomingDeadlines(48);
    if (upcoming.length > 0) {
      lines.push('UPCOMING:');
      for (const c of upcoming.slice(0, 5)) {
        const hours = Math.round((c.deadline - Date.now()) / (60 * 60 * 1000));
        const who = c.direction === 'user_promised' ? 'You committed' : `${c.personName} committed`;
        lines.push(`  - ${who}: "${c.description.slice(0, 60)}" (due in ${hours < 24 ? hours + 'h' : Math.round(hours / 24) + 'd'})`);
      }
    }

    return lines.join('\n');
  }

  // -- Private helpers ------------------------------------------------------

  #updateOverdueStatus() {
    const now = Date.now();
    for (const c of this.#commitments) {
      if (c.status === 'active' && c.deadline && c.deadline < now) c.status = 'overdue';
      if (c.status === 'snoozed' && c.lastRemindedAt && c.lastRemindedAt < now) {
        c.status = c.deadline && c.deadline < now ? 'overdue' : 'active';
        c.reminded = false;
      }
    }
  }

  #pruneOld() {
    const cutoff = Date.now() - this.#config.retentionDays * 24 * 60 * 60 * 1000;
    this.#commitments = this.#commitments.filter((c) => {
      if (['active', 'overdue', 'snoozed'].includes(c.status)) return true;
      return (c.resolvedAt || c.createdAt) > cutoff;
    });
    const suggestionCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    this.#followUpSuggestions = this.#followUpSuggestions.filter((s) => !s.delivered || s.createdAt > suggestionCutoff);
    const msgCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    this.#outboundMessages = this.#outboundMessages.filter((m) => !m.replyReceived || m.sentAt > msgCutoff);
  }

  #enforceLimit() {
    if (this.#commitments.length <= this.#config.maxCommitments) return;
    const resolved = this.#commitments
      .filter((c) => c.status === 'completed' || c.status === 'cancelled')
      .sort((a, b) => (a.resolvedAt || a.createdAt) - (b.resolvedAt || b.createdAt));
    while (this.#commitments.length > this.#config.maxCommitments && resolved.length > 0) {
      const r = resolved.shift();
      this.#commitments = this.#commitments.filter((c) => c.id !== r.id);
    }
  }

  #textSimilarity(a, b) {
    const wordsA = new Set(a.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    const wordsB = new Set(b.toLowerCase().split(/\s+/).filter((w) => w.length > 2));
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    let intersection = 0;
    for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
    return intersection / (wordsA.size + wordsB.size - intersection);
  }

  #computeUrgency(elapsed, expected) {
    const ratio = elapsed / expected;
    if (ratio >= 4) return 'critical';
    if (ratio >= 2.5) return 'high';
    if (ratio >= 1.5) return 'medium';
    return 'low';
  }

  #getContactBaseline(recipient, channel) {
    const lower = recipient.toLowerCase();
    const lowerChan = channel.toLowerCase();
    const replied = this.#outboundMessages.filter((m) =>
      m.replyReceived && m.replyReceivedAt &&
      m.recipient.toLowerCase().includes(lower) && m.channel.toLowerCase() === lowerChan,
    );
    if (replied.length < 3) return null;
    const times = replied.map((m) => (m.replyReceivedAt - m.sentAt) / (60 * 60 * 1000));
    times.sort((a, b) => a - b);
    return Math.round(times[Math.floor(times.length * 0.8)]);
  }

  #queueSave() {
    if (this.#saveQueued || !this.#state) return;
    this.#saveQueued = true;
    setTimeout(async () => {
      this.#saveQueued = false;
      try {
        await this.#state.set('commitments', {
          commitments: this.#commitments,
          outboundMessages: this.#outboundMessages,
          followUpSuggestions: this.#followUpSuggestions,
        });
      } catch {
        // Best effort
      }
    }, 2000);
  }
}
