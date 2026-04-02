/**
 * Briefing Subsystem -- Daily briefings, meeting prep, and meeting intelligence.
 *
 * Tools (3):
 *   briefing_daily       -- Generate or retrieve daily briefings
 *   briefing_meeting_prep  -- Prepare context for upcoming meetings
 *   briefing_meeting_intel -- Analyze meeting notes/transcripts post-meeting
 *
 * Ported from nexus-os: daily-briefing.ts, meeting-prep.ts, meeting-intelligence.ts
 * Stripped: Electron, BrowserWindow, IPC, direct AI calls, calendarIntegration.
 *
 * Briefings are read-only informational outputs. No message is ever sent
 * and no action is ever taken without explicit user approval.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { DailyBriefingEngine } from './daily.js';
import { MeetingIntelligence } from './meeting.js';

const BRIEFING_TYPES = ['morning', 'midday', 'evening'];
const MEETING_STATUSES = ['upcoming', 'active', 'completed', 'cancelled'];

export class BriefingSubsystem extends Subsystem {
  #daily;
  #meetings;

  constructor(deps) {
    super('briefing', deps);
    this.#daily = new DailyBriefingEngine();
    this.#meetings = new MeetingIntelligence();
  }

  async start() {
    await this.#daily.initialize(this.state);
    await this.#meetings.initialize(this.state);
    await super.start();

    const status = this.#daily.getStatus();
    const mStats = this.#meetings.getStats();
    this.log.info(`Briefing started: ${status.totalBriefings} briefings, ${mStats.total} meetings`);
  }

  registerEvents() {
    // Listen for commitment/calendar changes to mark briefings stale
    this.eventBus.on('commitments:changed', () => {
      // Briefing staleness is checked on demand, no action needed here
    });
  }

  /** Expose engines for other subsystems */
  get daily() { return this.#daily; }
  get meetings() { return this.#meetings; }

  registerTools(server) {
    const daily = this.#daily;
    const meetings = this.#meetings;

    // -- briefing_daily -------------------------------------------------------

    server.tool(
      'briefing_daily',
      'Generate or retrieve a daily briefing. Actions: "generate" creates a new briefing from provided source data, "latest" returns the most recent briefing, "history" returns recent briefings, "status" shows briefing system status.',
      {
        action: z.enum(['generate', 'latest', 'history', 'status']).describe('Action to perform'),
        type: z.enum(BRIEFING_TYPES).optional().describe('Briefing type (morning, midday, evening)'),
        limit: z.number().int().min(1).max(50).default(5).optional().describe('Max briefings for history'),
        source_data: z.object({
          calendarEvents: z.array(z.object({
            title: z.string(),
            startTime: z.number(),
            endTime: z.number(),
            attendees: z.array(z.string()).optional(),
            location: z.string().optional(),
          })).optional(),
          activeCommitments: z.array(z.object({
            id: z.string(),
            description: z.string(),
            personName: z.string(),
            direction: z.string(),
            deadline: z.number().nullable(),
            status: z.string(),
          })).optional(),
          overdueCommitments: z.array(z.object({
            id: z.string(),
            description: z.string(),
            personName: z.string(),
            direction: z.string(),
            deadline: z.number().nullable(),
            status: z.string(),
          })).optional(),
          upcomingDeadlines: z.array(z.object({
            id: z.string(),
            description: z.string(),
            personName: z.string(),
            direction: z.string(),
            deadline: z.number().nullable(),
            status: z.string(),
          })).optional(),
          unrepliedMessages: z.array(z.object({
            recipient: z.string(),
            channel: z.string(),
            summary: z.string(),
            sentAt: z.number(),
            expectedReplyByMs: z.number(),
          })).optional(),
          followUpSuggestions: z.array(z.object({
            personName: z.string(),
            type: z.string(),
            reason: z.string(),
            urgency: z.string(),
          })).optional(),
          recentActivity: z.array(z.object({
            timestamp: z.number(),
            summary: z.string(),
            type: z.string(),
          })).optional(),
          sessionSummary: z.string().optional(),
        }).optional().describe('Source data for generating a briefing'),
      },
      async ({ action, type, limit, source_data }) => {
        switch (action) {
          case 'generate': {
            const briefingType = type || 'morning';
            const data = source_data || {};
            const briefing = daily.generateBriefing(briefingType, data);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  generated: true,
                  briefing: {
                    id: briefing.id,
                    type: briefing.type,
                    summary: briefing.summary,
                    sectionCount: briefing.sections.length,
                    metadata: briefing.metadata,
                  },
                  formatted: daily.formatAsText(briefing),
                }, null, 2),
              }],
            };
          }

          case 'latest': {
            const briefing = daily.getLatestBriefing(type);
            if (!briefing) {
              return { content: [{ type: 'text', text: JSON.stringify({ found: false, type: type || 'any' }) }] };
            }
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  found: true,
                  briefing,
                  formatted: daily.formatAsText(briefing),
                  isStale: type ? daily.isBriefingStale(type) : false,
                }, null, 2),
              }],
            };
          }

          case 'history': {
            const history = daily.getBriefingHistory(limit || 5);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  count: history.length,
                  briefings: history.map((b) => ({
                    id: b.id,
                    type: b.type,
                    summary: b.summary,
                    generatedAt: new Date(b.generatedAt).toISOString(),
                    sectionCount: b.sections.length,
                  })),
                }, null, 2),
              }],
            };
          }

          case 'status': {
            return {
              content: [{ type: 'text', text: JSON.stringify(daily.getStatus(), null, 2) }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );

    // -- briefing_meeting_prep ------------------------------------------------

    server.tool(
      'briefing_meeting_prep',
      'Prepare for a meeting or manage the meeting lifecycle. Actions: "create" creates a meeting, "start" starts it, "end" ends it, "cancel" cancels it, "prep" generates a prep document, "add_note" adds a note, "list" lists meetings.',
      {
        action: z.enum(['create', 'start', 'end', 'cancel', 'prep', 'add_note', 'list']).describe('Action'),
        meeting_id: z.string().optional().describe('Meeting ID (for start/end/cancel/prep/add_note)'),
        name: z.string().optional().describe('Meeting name (for create)'),
        description: z.string().optional().describe('Meeting description (for create)'),
        attendees: z.array(z.string()).optional().describe('Attendee names/emails'),
        scheduled_start: z.string().optional().describe('ISO datetime'),
        scheduled_end: z.string().optional().describe('ISO datetime'),
        meeting_url: z.string().optional().describe('Video call URL'),
        note_content: z.string().optional().describe('Note text (for add_note)'),
        note_type: z.enum(['note', 'action-item', 'decision', 'question', 'insight']).optional().describe('Note type'),
        status_filter: z.enum(MEETING_STATUSES).optional().describe('Filter for list'),
        limit: z.number().int().min(1).max(100).default(20).optional(),
      },
      async ({ action, meeting_id, name, description, attendees, scheduled_start, scheduled_end, meeting_url, note_content, note_type, status_filter, limit }) => {
        switch (action) {
          case 'create': {
            if (!name) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting name required' }) }] };
            const meeting = meetings.createMeeting({
              name, description, attendees, scheduledStart: scheduled_start,
              scheduledEnd: scheduled_end, meetingUrl: meeting_url,
            });
            return {
              content: [{ type: 'text', text: JSON.stringify({ created: true, meeting: { id: meeting.id, name: meeting.name, status: meeting.status } }, null, 2) }],
            };
          }

          case 'start': {
            if (!meeting_id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting ID required' }) }] };
            const meeting = meetings.startMeeting(meeting_id);
            if (!meeting) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting not found' }) }] };
            return {
              content: [{ type: 'text', text: JSON.stringify({ started: true, id: meeting.id, status: meeting.status }, null, 2) }],
            };
          }

          case 'end': {
            if (!meeting_id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting ID required' }) }] };
            const meeting = meetings.endMeeting(meeting_id, { summary: description });
            if (!meeting) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting not found' }) }] };
            return {
              content: [{ type: 'text', text: JSON.stringify({ ended: true, id: meeting.id, status: meeting.status, duration: meeting.startedAt ? Math.round((meeting.endedAt - meeting.startedAt) / 60000) + 'min' : 'unknown' }, null, 2) }],
            };
          }

          case 'cancel': {
            if (!meeting_id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting ID required' }) }] };
            const meeting = meetings.cancelMeeting(meeting_id);
            if (!meeting) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting not found' }) }] };
            return {
              content: [{ type: 'text', text: JSON.stringify({ cancelled: true, id: meeting.id }, null, 2) }],
            };
          }

          case 'prep': {
            if (!meeting_id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting ID required' }) }] };
            const meeting = meetings.getMeeting(meeting_id);
            if (!meeting) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting not found' }) }] };
            const context = meetings.buildPrepContext(meeting);
            return {
              content: [{ type: 'text', text: JSON.stringify({ meetingId: meeting.id, name: meeting.name, prepContext: context }, null, 2) }],
            };
          }

          case 'add_note': {
            if (!meeting_id || !note_content) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting ID and note content required' }) }] };
            }
            const note = meetings.addNote(meeting_id, { content: note_content, type: note_type });
            if (!note) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting not found' }) }] };
            return {
              content: [{ type: 'text', text: JSON.stringify({ added: true, note }, null, 2) }],
            };
          }

          case 'list': {
            const list = meetings.listMeetings({ status: status_filter, limit: limit || 20 });
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  count: list.length,
                  meetings: list.map((m) => ({
                    id: m.id, name: m.name, status: m.status,
                    attendees: m.attendees.length,
                    scheduledStart: m.scheduledStart,
                    notes: m.notes.length,
                  })),
                }, null, 2),
              }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );

    // -- briefing_meeting_intel ------------------------------------------------

    server.tool(
      'briefing_meeting_intel',
      'Analyze meeting content for intelligence extraction. Builds structured context from notes and transcripts for action item extraction, commitment detection, and sentiment analysis. Returns the content block for AI processing.',
      {
        meeting_id: z.string().describe('Meeting ID to analyze'),
        include_transcript: z.boolean().default(true).optional().describe('Include transcript in context'),
      },
      async ({ meeting_id, include_transcript: _include_transcript }) => {
        const meeting = meetings.getMeeting(meeting_id);
        if (!meeting) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'Meeting not found' }) }] };
        }

        const context = meetings.buildIntelContext(meeting);
        const stats = meetings.getStats();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              meetingId: meeting.id,
              name: meeting.name,
              status: meeting.status,
              attendees: meeting.attendees,
              durationMins: meeting.startedAt && meeting.endedAt
                ? Math.round((meeting.endedAt - meeting.startedAt) / 60000)
                : null,
              noteCount: meeting.notes.length,
              hasTranscript: !!meeting.transcript,
              hasSummary: !!meeting.summary,
              actionItems: meeting.actionItems || [],
              intelContext: context,
              systemStats: stats,
            }, null, 2),
          }],
        };
      },
    );
  }
}
