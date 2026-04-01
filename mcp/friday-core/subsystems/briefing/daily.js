/**
 * Daily Briefing Generator -- Compiles structured briefings from context sources.
 *
 * Ported from nexus-os: daily-briefing.ts
 * Removed: Electron imports, filesystem persistence (uses state), app.getPath.
 *
 * Generates morning, midday, and evening briefings from calendar events,
 * commitments, pending items, and activity snapshots. Briefings are read-only
 * informational outputs. This module generates context; it never acts autonomously.
 */

import crypto from 'node:crypto';

// -- Defaults -----------------------------------------------------------------

const DEFAULT_CONFIG = {
  enabled: true,
  morningTime: '08:00',
  eveningTime: '17:30',
  maxSections: 8,
  retentionDays: 30,
  maxBriefings: 200,
  staleThresholdMs: 4 * 60 * 60 * 1000,
};

const PRIORITY_RANK = { critical: 0, high: 1, normal: 2, low: 3 };

// -- Daily Briefing Engine ----------------------------------------------------

export class DailyBriefingEngine {
  #briefings = [];
  #config;
  #state = null;
  #saveQueued = false;

  constructor(config) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(state) {
    this.#state = state;
    try {
      const data = await state.get('briefings');
      if (Array.isArray(data)) {
        this.#briefings = data;
      }
    } catch {
      this.#briefings = [];
    }
    this.#prune();
  }

  // -- Briefing generation --------------------------------------------------

  generateBriefing(type, sourceData) {
    const now = Date.now();
    const sections = [];

    // Calendar events
    if (sourceData.calendarEvents?.length > 0) {
      const lines = sourceData.calendarEvents.map((e) => {
        const time = new Date(e.startTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        const attendees = e.attendees?.length
          ? ` (with ${e.attendees.slice(0, 3).join(', ')}${e.attendees.length > 3 ? ` +${e.attendees.length - 3}` : ''})`
          : '';
        return `- ${time}: ${e.title}${attendees}`;
      });
      sections.push({ title: "Today's Schedule", content: lines.join('\n'), priority: 'critical', source: 'calendar', metadata: { itemCount: sourceData.calendarEvents.length } });
    }

    // Overdue commitments
    if (sourceData.overdueCommitments?.length > 0) {
      const lines = sourceData.overdueCommitments.map((c) => {
        const who = c.direction === 'user_promised' ? 'You promised' : `${c.personName} promised`;
        const deadline = c.deadline ? ` (due ${new Date(c.deadline).toLocaleDateString()})` : '';
        return `- [OVERDUE] ${who}: ${c.description.slice(0, 80)}${deadline}`;
      });
      sections.push({ title: 'Overdue Items', content: lines.join('\n'), priority: 'critical', source: 'commitments', metadata: { itemCount: sourceData.overdueCommitments.length, actionable: true } });
    }

    // Upcoming deadlines
    if (sourceData.upcomingDeadlines?.length > 0) {
      const lines = sourceData.upcomingDeadlines.map((c) => {
        const who = c.direction === 'user_promised' ? 'You committed' : `${c.personName} committed`;
        const deadline = c.deadline ? ` (due ${new Date(c.deadline).toLocaleDateString()})` : '';
        return `- ${who}: ${c.description.slice(0, 80)}${deadline}`;
      });
      sections.push({ title: 'Upcoming Deadlines', content: lines.join('\n'), priority: 'high', source: 'commitments', metadata: { itemCount: sourceData.upcomingDeadlines.length } });
    }

    // Unreplied messages
    if (sourceData.unrepliedMessages?.length > 0) {
      const lines = sourceData.unrepliedMessages.map((m) => {
        const days = Math.round((now - m.sentAt) / (24 * 60 * 60 * 1000));
        return `- ${m.recipient} via ${m.channel}: "${m.summary.slice(0, 60)}" (${days}d ago)`;
      });
      sections.push({ title: 'Awaiting Replies', content: lines.join('\n'), priority: 'high', source: 'pending', metadata: { itemCount: sourceData.unrepliedMessages.length, actionable: true } });
    }

    // Follow-up suggestions
    if (sourceData.followUpSuggestions?.length > 0) {
      const items = sourceData.followUpSuggestions.slice(0, 5);
      const lines = items.map((s) => {
        const tag = (s.urgency === 'critical' || s.urgency === 'high') ? ` [${s.urgency.toUpperCase()}]` : '';
        return `- ${s.personName}${tag}: ${s.reason.slice(0, 80)}`;
      });
      sections.push({ title: 'Suggested Follow-Ups', content: lines.join('\n'), priority: 'normal', source: 'pending', metadata: { itemCount: items.length, actionable: true } });
    }

    // Active commitments
    if (sourceData.activeCommitments?.length > 0) {
      const items = sourceData.activeCommitments.slice(0, 8);
      const lines = items.map((c) => {
        const arrow = c.direction === 'user_promised' ? '->' : '<-';
        return `- ${arrow} ${c.personName}: ${c.description.slice(0, 70)}`;
      });
      sections.push({ title: 'Active Commitments', content: lines.join('\n'), priority: 'normal', source: 'commitments', metadata: { itemCount: sourceData.activeCommitments.length } });
    }

    // Recent activity (evening)
    if (type === 'evening' && sourceData.recentActivity?.length > 0) {
      const items = sourceData.recentActivity.slice(0, 10);
      const lines = items.map((a) => {
        const time = new Date(a.timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `- ${time}: ${a.summary.slice(0, 80)}`;
      });
      sections.push({ title: "Today's Activity", content: lines.join('\n'), priority: 'high', source: 'workstream', metadata: { itemCount: items.length } });
    }

    // Session summary (evening)
    if (type === 'evening' && sourceData.sessionSummary) {
      sections.push({ title: 'Session Summary', content: sourceData.sessionSummary.slice(0, 1000), priority: 'high', source: 'eod_summary' });
    }

    // Sort by priority, enforce max
    const finalSections = sections
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 3) - (PRIORITY_RANK[b.priority] ?? 3))
      .slice(0, this.#config.maxSections);

    const summary = this.#buildSummary(type, sourceData);
    const allText = finalSections.map((s) => s.content).join(' ');
    const wordCount = allText.split(/\s+/).filter(Boolean).length;

    const briefing = {
      id: crypto.randomUUID().slice(0, 12),
      generatedAt: now,
      deliveredAt: null,
      type,
      summary,
      sections: finalSections,
      metadata: {
        calendarEventCount: sourceData.calendarEvents?.length ?? 0,
        commitmentCount: (sourceData.activeCommitments?.length ?? 0) + (sourceData.overdueCommitments?.length ?? 0),
        pendingItemCount: sourceData.unrepliedMessages?.length ?? 0,
        overdueCount: sourceData.overdueCommitments?.length ?? 0,
        wordCount,
        estimatedReadTimeSec: Math.max(15, Math.round(wordCount / 3.5)),
      },
    };

    this.#briefings.push(briefing);
    this.#enforceLimit();
    this.#queueSave();
    return briefing;
  }

  // -- Queries --------------------------------------------------------------

  getLatestBriefing(type) {
    const filtered = type ? this.#briefings.filter((b) => b.type === type) : this.#briefings;
    if (filtered.length === 0) return null;
    return { ...filtered[filtered.length - 1] };
  }

  getBriefingHistory(limit = 10) {
    return this.#briefings.slice(-limit).reverse().map((b) => ({ ...b }));
  }

  getStatus() {
    const latest = this.getLatestBriefing();
    return {
      totalBriefings: this.#briefings.length,
      lastBriefingAt: latest?.generatedAt ?? null,
      lastBriefingType: latest?.type ?? null,
      morningTime: this.#config.morningTime,
      eveningTime: this.#config.eveningTime,
    };
  }

  isBriefingStale(type) {
    const latest = this.getLatestBriefing(type);
    if (!latest) return true;
    return (Date.now() - latest.generatedAt) > this.#config.staleThresholdMs;
  }

  getContextString() {
    const latest = this.getLatestBriefing('morning') || this.getLatestBriefing('midday');
    if (!latest) return '';
    if (Date.now() - latest.generatedAt > 12 * 60 * 60 * 1000) return '';

    const lines = [`[DAILY BRIEFING -- ${latest.type} @ ${new Date(latest.generatedAt).toLocaleTimeString()}]`, latest.summary];
    for (const section of latest.sections) {
      if (section.priority === 'critical' || section.priority === 'high') {
        lines.push(`\n## ${section.title}`, section.content);
      }
    }
    return lines.join('\n');
  }

  formatAsText(briefing) {
    const lines = [briefing.summary, ''];
    for (const section of briefing.sections) {
      lines.push(`## ${section.title}`, section.content, '');
    }
    lines.push(`-- Generated ${new Date(briefing.generatedAt).toLocaleTimeString()}`);
    return lines.join('\n');
  }

  // -- Private helpers ------------------------------------------------------

  #buildSummary(type, data) {
    const parts = [];
    if (type === 'morning' || type === 'midday') {
      const events = data.calendarEvents?.length ?? 0;
      if (events > 0) parts.push(`${events} event${events !== 1 ? 's' : ''} today`);
      const overdue = data.overdueCommitments?.length ?? 0;
      if (overdue > 0) parts.push(`${overdue} overdue item${overdue !== 1 ? 's' : ''}`);
      const unreplied = data.unrepliedMessages?.length ?? 0;
      if (unreplied > 0) parts.push(`${unreplied} awaiting repl${unreplied !== 1 ? 'ies' : 'y'}`);
      const upcoming = data.upcomingDeadlines?.length ?? 0;
      if (upcoming > 0) parts.push(`${upcoming} deadline${upcoming !== 1 ? 's' : ''} approaching`);
    } else {
      const activity = data.recentActivity?.length ?? 0;
      parts.push(`${activity} activity item${activity !== 1 ? 's' : ''} recorded`);
    }

    if (parts.length === 0) {
      return type === 'evening' ? 'Quiet day. No significant activity tracked.' : 'Clear schedule. No outstanding items.';
    }

    const prefix = type === 'morning' ? 'Good morning.' : type === 'midday' ? 'Midday update.' : 'End of day.';
    return `${prefix} ${parts.join(', ')}.`;
  }

  #enforceLimit() {
    if (this.#briefings.length > this.#config.maxBriefings) {
      this.#briefings = this.#briefings.slice(-this.#config.maxBriefings);
    }
  }

  #prune() {
    const cutoff = Date.now() - this.#config.retentionDays * 24 * 60 * 60 * 1000;
    this.#briefings = this.#briefings.filter((b) => b.generatedAt >= cutoff);
  }

  #queueSave() {
    if (this.#saveQueued || !this.#state) return;
    this.#saveQueued = true;
    setTimeout(async () => {
      this.#saveQueued = false;
      try {
        await this.#state.set('briefings', this.#briefings);
      } catch {
        // Best effort
      }
    }, 2000);
  }
}
