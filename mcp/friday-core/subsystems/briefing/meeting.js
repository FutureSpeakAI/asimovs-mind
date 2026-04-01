/**
 * Meeting Prep and Intelligence -- Lifecycle management for meetings.
 *
 * Ported from nexus-os: meeting-prep.ts + meeting-intelligence.ts
 * Removed: Electron imports, BrowserWindow, IPC, Gemini API calls,
 *          direct trustGraph/memoryManager/calendarIntegration imports.
 * Changed: Pure data structure, event-driven, vault-backed state.
 *
 * Meeting lifecycle: upcoming -> active -> processing -> completed | cancelled
 *
 * This module does NOT call AI models directly. It structures meeting data
 * and emits events; the agent runtime handles LLM summarization.
 */

import crypto from 'node:crypto';

const DEFAULT_CONFIG = {
  maxMeetings: 200,
  retentionDays: 90,
};

export class MeetingIntelligence {
  #meetings = [];
  #config;
  #state = null;
  #activeMeetingId = null;
  #saveQueued = false;

  constructor(config) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  async initialize(state) {
    this.#state = state;
    try {
      const data = await state.get('meetings');
      if (Array.isArray(data)) {
        this.#meetings = data;
      }
    } catch {
      this.#meetings = [];
    }

    // Recover stale meetings
    for (const m of this.#meetings) {
      if (m.status === 'active' && m.startedAt) {
        const hoursActive = (Date.now() - m.startedAt) / (60 * 60 * 1000);
        if (hoursActive > 8) {
          m.status = 'completed';
          m.endedAt = m.startedAt + 60 * 60 * 1000;
        }
      }
      if (m.status === 'processing') {
        m.status = 'completed';
      }
    }

    this.#prune();
    this.#queueSave();
  }

  // -- CRUD -----------------------------------------------------------------

  createMeeting(opts) {
    const meeting = {
      id: crypto.randomUUID().slice(0, 12),
      name: opts.name,
      description: opts.description || '',
      status: 'upcoming',
      attendees: opts.attendees || [],
      attendeeIntel: [],
      createdAt: Date.now(),
      scheduledStart: opts.scheduledStart,
      scheduledEnd: opts.scheduledEnd,
      meetingUrl: opts.meetingUrl,
      platform: opts.platform || this.#detectPlatform(opts.meetingUrl),
      notes: [],
      tags: opts.tags || [],
      projectName: opts.projectName,
    };

    this.#meetings.unshift(meeting);
    if (this.#meetings.length > this.#config.maxMeetings) {
      this.#meetings = this.#meetings.slice(0, this.#config.maxMeetings);
    }
    this.#queueSave();
    return meeting;
  }

  getMeeting(id) {
    return this.#meetings.find((m) => m.id === id) || null;
  }

  getActiveMeeting() {
    if (!this.#activeMeetingId) return null;
    return this.getMeeting(this.#activeMeetingId);
  }

  listMeetings(opts) {
    let results = [...this.#meetings];
    if (opts?.status) results = results.filter((m) => m.status === opts.status);
    if (opts?.search) {
      const q = opts.search.toLowerCase();
      results = results.filter((m) =>
        m.name.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.attendees.some((a) => a.toLowerCase().includes(q)),
      );
    }
    return results.slice(0, opts?.limit || 50);
  }

  // -- Lifecycle state machine ----------------------------------------------

  startMeeting(meetingId) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting || meeting.status !== 'upcoming') return meeting;

    meeting.status = 'active';
    meeting.startedAt = Date.now();
    this.#activeMeetingId = meetingId;

    meeting.notes.push({
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      author: 'auto',
      content: `Meeting started at ${new Date().toLocaleTimeString()}`,
      type: 'note',
    });

    this.#queueSave();
    return meeting;
  }

  endMeeting(meetingId, opts) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting || meeting.status !== 'active') return meeting;

    meeting.status = 'completed';
    meeting.endedAt = Date.now();

    if (opts?.transcript) meeting.transcript = opts.transcript;
    if (opts?.summary) meeting.summary = opts.summary;
    if (opts?.actionItems) meeting.actionItems = opts.actionItems;

    const durationMins = meeting.startedAt ? Math.round((Date.now() - meeting.startedAt) / 60000) : 0;
    meeting.notes.push({
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      author: 'auto',
      content: `Meeting ended after ${durationMins} minutes`,
      type: 'note',
    });

    if (this.#activeMeetingId === meetingId) this.#activeMeetingId = null;
    this.#queueSave();
    return meeting;
  }

  cancelMeeting(meetingId) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting || meeting.status !== 'upcoming') return meeting;

    meeting.status = 'cancelled';
    if (this.#activeMeetingId === meetingId) this.#activeMeetingId = null;
    this.#queueSave();
    return meeting;
  }

  // -- Notes ----------------------------------------------------------------

  addNote(meetingId, note) {
    const meeting = this.getMeeting(meetingId);
    if (!meeting) return null;

    const entry = {
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
      author: note.author || 'agent',
      content: note.content,
      type: note.type || 'note',
    };

    meeting.notes.push(entry);
    this.#queueSave();
    return entry;
  }

  // -- Meeting prep context -------------------------------------------------

  buildPrepContext(meeting) {
    const parts = [`Meeting: ${meeting.name}`];
    if (meeting.description) parts.push(`Description: ${meeting.description}`);
    if (meeting.attendees.length > 0) parts.push(`Attendees: ${meeting.attendees.join(', ')}`);
    if (meeting.scheduledStart) parts.push(`Scheduled: ${meeting.scheduledStart}`);
    if (meeting.meetingUrl) parts.push(`Link: ${meeting.meetingUrl}`);
    if (meeting.attendeeIntel.length > 0) {
      parts.push('\nAttendee context:');
      for (const intel of meeting.attendeeIntel) {
        parts.push(`  ${intel.name}:`);
        if (intel.trustProfile) parts.push(`    Trust: ${intel.trustProfile}`);
        if (intel.memories?.length > 0) {
          for (const m of intel.memories) parts.push(`    - ${m}`);
        }
      }
    }
    return parts.join('\n');
  }

  buildIntelContext(meeting) {
    const parts = [`Meeting: ${meeting.name}`];
    if (meeting.startedAt && meeting.endedAt) {
      parts.push(`Duration: ${Math.round((meeting.endedAt - meeting.startedAt) / 60000)} minutes`);
    }
    if (meeting.attendees.length > 0) parts.push(`Attendees: ${meeting.attendees.join(', ')}`);

    const humanNotes = meeting.notes.filter((n) => n.author !== 'auto');
    if (humanNotes.length > 0) {
      parts.push('\nNotes:');
      for (const note of humanNotes) {
        const prefix = note.type !== 'note' ? `[${note.type.toUpperCase()}] ` : '';
        parts.push(`  ${prefix}${note.content}`);
      }
    }

    if (meeting.transcript) {
      parts.push(`\nTranscript (partial): ${meeting.transcript.slice(0, 2000)}`);
    }

    return parts.join('\n');
  }

  // -- Stats ----------------------------------------------------------------

  getStats() {
    const completed = this.#meetings.filter((m) => m.status === 'completed');
    const durations = completed
      .filter((m) => m.startedAt && m.endedAt)
      .map((m) => (m.endedAt - m.startedAt) / 60000);
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : 0;

    return {
      total: this.#meetings.length,
      upcoming: this.#meetings.filter((m) => m.status === 'upcoming').length,
      active: this.#meetings.filter((m) => m.status === 'active').length,
      completed: completed.length,
      cancelled: this.#meetings.filter((m) => m.status === 'cancelled').length,
      totalNotes: this.#meetings.reduce((sum, m) => sum + m.notes.length, 0),
      avgDurationMins: avgDuration,
    };
  }

  // -- Private helpers ------------------------------------------------------

  #detectPlatform(url) {
    if (!url) return undefined;
    const lower = url.toLowerCase();
    if (lower.includes('meet.google.com')) return 'google-meet';
    if (lower.includes('zoom.us') || lower.includes('zoom.com')) return 'zoom';
    if (lower.includes('teams.microsoft.com')) return 'teams';
    return 'other';
  }

  #prune() {
    const cutoff = Date.now() - this.#config.retentionDays * 24 * 60 * 60 * 1000;
    this.#meetings = this.#meetings.filter((m) => {
      if (m.status === 'upcoming' || m.status === 'active') return true;
      return m.createdAt > cutoff;
    });
  }

  #queueSave() {
    if (this.#saveQueued || !this.#state) return;
    this.#saveQueued = true;
    setTimeout(async () => {
      this.#saveQueued = false;
      try {
        await this.#state.set('meetings', this.#meetings);
      } catch {
        // Best effort
      }
    }, 2000);
  }
}
