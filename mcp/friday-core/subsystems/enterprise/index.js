/**
 * Enterprise Safety Subsystem -- Consent, cloud gating, confidence, commitments.
 *
 * Tools (5):
 *   enterprise_consent_check   -- Check if consent exists for an action category
 *   enterprise_consent_grant   -- Grant or revoke consent for an action category
 *   enterprise_cloud_gate      -- Gate cloud API access by task category
 *   enterprise_confidence      -- Assess confidence in an LLM response
 *   enterprise_commitment_track -- Track commitments, deadlines, follow-ups
 *
 * Ported from nexus-os: consent-gate.ts, cloud-gate.ts, confidence-assessor.ts,
 *   commitment-tracker.ts. Stripped: Electron, IPC, BrowserWindow, settingsManager.
 *
 * Enterprise safety principles:
 *   - No data leaves the machine without user consent
 *   - Confidence scoring prevents low-quality responses from reaching the user
 *   - Commitments are tracked and follow-ups are suggested (never auto-sent)
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { ConsentTracker, CONSENT_CATEGORIES } from './consent.js';
import { CloudGate, TASK_CATEGORIES, POLICY_SCOPES } from './cloud-gate.js';
import { assessConfidence } from './confidence.js';
import { CommitmentTracker } from './commitments.js';

const COMMITMENT_DIRECTIONS = ['user_promised', 'other_promised', 'mutual'];
const COMMITMENT_SOURCES = ['conversation', 'email', 'message', 'meeting', 'calendar', 'manual'];

export class EnterpriseSubsystem extends Subsystem {
  #consent;
  #cloudGate;
  #commitments;

  constructor(deps) {
    super('enterprise', deps);
    this.#consent = new ConsentTracker();
    this.#cloudGate = new CloudGate();
    this.#commitments = new CommitmentTracker();
  }

  async start() {
    await this.#consent.initialize(this.state);
    await this.#cloudGate.initialize(this.state, this.#consent);
    await this.#commitments.initialize(this.state);
    await super.start();

    const status = this.#commitments.getStatus();
    this.log.info(`Enterprise started: ${status.activeCommitments} active commitments, ${status.overdueCommitments} overdue`);
  }

  registerEvents() {
    // Listen for commitment mentions from memory extraction
    this.eventBus.on('memory:commitment_mentions', (mentions) => {
      for (const mention of mentions) {
        this.#commitments.addCommitment(mention);
      }
    });

    // Listen for outbound messages to track for follow-up
    this.eventBus.on('gateway:outbound_message', (msg) => {
      this.#commitments.trackOutboundMessage(msg);
    });
  }

  /** Expose internals for other subsystems */
  get consent() { return this.#consent; }
  get cloudGate() { return this.#cloudGate; }
  get commitments() { return this.#commitments; }

  registerTools(server) {
    const consent = this.#consent;
    const cloudGate = this.#cloudGate;
    const commitments = this.#commitments;

    // -- enterprise_consent_check --------------------------------------------

    server.tool(
      'enterprise_consent_check',
      'Check if the user has consented to a specific action category. Categories: cloud_api, data_sharing, destructive_actions, send_messages, calendar_events, financial_actions, code_execution, browser_automation.',
      {
        category: z.enum(CONSENT_CATEGORIES).describe('Consent category to check'),
      },
      async ({ category }) => {
        const result = consent.checkConsent(category);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ category, ...result }, null, 2),
          }],
        };
      },
    );

    // -- enterprise_consent_grant --------------------------------------------

    server.tool(
      'enterprise_consent_grant',
      'Grant or revoke consent for an action category. Scope: "once" (single use), "session" (until restart), "always" (persistent). Use action "revoke" to remove consent, "revoke_all" to clear everything, "status" to see all consent states.',
      {
        action: z.enum(['grant', 'revoke', 'revoke_all', 'status', 'audit']).describe('Action'),
        category: z.enum(CONSENT_CATEGORIES).optional().describe('Consent category'),
        scope: z.enum(['once', 'session', 'always']).default('session').optional().describe('Consent scope'),
        reason: z.string().optional().describe('Reason for grant/revoke'),
        limit: z.number().int().min(1).max(200).default(50).optional().describe('Audit log limit'),
      },
      async ({ action, category, scope, reason, limit }) => {
        switch (action) {
          case 'grant': {
            if (!category) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Category required' }) }] };
            const result = consent.grantConsent(category, scope || 'session', reason || '');
            return {
              content: [{ type: 'text', text: JSON.stringify({ granted: true, category, ...result }, null, 2) }],
            };
          }

          case 'revoke': {
            if (!category) return { content: [{ type: 'text', text: JSON.stringify({ error: 'Category required' }) }] };
            const result = consent.revokeConsent(category, reason || '');
            return {
              content: [{ type: 'text', text: JSON.stringify({ category, ...result }, null, 2) }],
            };
          }

          case 'revoke_all': {
            const result = consent.revokeAll(reason || 'Bulk revoke');
            return {
              content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
            };
          }

          case 'status': {
            const status = consent.getStatus();
            return {
              content: [{ type: 'text', text: JSON.stringify(status, null, 2) }],
            };
          }

          case 'audit': {
            const log = consent.getAuditLog(limit || 50);
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  count: log.length,
                  entries: log.map((e) => ({ ...e, time: new Date(e.ts).toISOString() })),
                }, null, 2),
              }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );

    // -- enterprise_cloud_gate -----------------------------------------------

    server.tool(
      'enterprise_cloud_gate',
      'Gate cloud API access by task category. Actions: "check" tests if a task can use cloud, "set_policy" allows/denies a category, "clear_policy" removes a policy, "status" shows all policies and stats.',
      {
        action: z.enum(['check', 'set_policy', 'clear_policy', 'status']).describe('Action'),
        task_category: z.enum(TASK_CATEGORIES).optional().describe('Task category'),
        decision: z.enum(['allow', 'deny']).optional().describe('Policy decision (for set_policy)'),
        scope: z.enum(POLICY_SCOPES).default('session').optional().describe('Policy scope'),
      },
      async ({ action, task_category, decision, scope }) => {
        switch (action) {
          case 'check': {
            if (!task_category) return { content: [{ type: 'text', text: JSON.stringify({ error: 'task_category required' }) }] };
            const result = cloudGate.checkGate(task_category);
            return {
              content: [{ type: 'text', text: JSON.stringify({ taskCategory: task_category, ...result }, null, 2) }],
            };
          }

          case 'set_policy': {
            if (!task_category || !decision) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'task_category and decision required' }) }] };
            }
            const policy = cloudGate.setPolicy(task_category, decision, scope || 'session');
            return {
              content: [{ type: 'text', text: JSON.stringify({ set: true, taskCategory: task_category, policy }, null, 2) }],
            };
          }

          case 'clear_policy': {
            if (!task_category) return { content: [{ type: 'text', text: JSON.stringify({ error: 'task_category required' }) }] };
            const existed = cloudGate.clearPolicy(task_category);
            return {
              content: [{ type: 'text', text: JSON.stringify({ cleared: true, existed, taskCategory: task_category }) }],
            };
          }

          case 'status': {
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  stats: cloudGate.getStats(),
                  policies: cloudGate.getAllPolicies(),
                }, null, 2),
              }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );

    // -- enterprise_confidence -----------------------------------------------

    server.tool(
      'enterprise_confidence',
      'Assess confidence in an LLM response using structural signals. Returns a score (0-1) and whether the response should be escalated for review. Checks for: malformed tool calls, unknown tools, truncation, empty responses, unexpectedly brief responses.',
      {
        content: z.string().optional().describe('Response text content'),
        tool_calls: z.array(z.object({
          name: z.string(),
          input: z.unknown(),
        })).optional().describe('Tool calls in the response'),
        stop_reason: z.string().optional().describe('Stop reason (end_turn, max_tokens, etc.)'),
        tool_definitions: z.array(z.object({
          name: z.string(),
        })).optional().describe('Known tool definitions for validation'),
        threshold: z.number().min(0).max(1).default(0.5).optional().describe('Escalation threshold'),
      },
      async ({ content, tool_calls, stop_reason, tool_definitions, threshold }) => {
        const response = {
          content: content || '',
          toolCalls: tool_calls || [],
          stopReason: stop_reason || 'end_turn',
        };

        const result = assessConfidence(response, tool_definitions, { threshold });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              score: result.score,
              escalate: result.escalate,
              signalCount: result.signals.length,
              signals: result.signals,
            }, null, 2),
          }],
        };
      },
    );

    // -- enterprise_commitment_track -----------------------------------------

    server.tool(
      'enterprise_commitment_track',
      'Track commitments, deadlines, and follow-ups. Actions: "add" creates a commitment, "complete"/"cancel"/"snooze" change status, "list" shows active commitments, "status" shows overview, "follow_ups" generates suggestions, "track_outbound" tracks a sent message, "record_reply" marks a reply received.',
      {
        action: z.enum(['add', 'complete', 'cancel', 'snooze', 'list', 'status', 'follow_ups', 'track_outbound', 'record_reply', 'context']).describe('Action'),
        commitment_id: z.string().optional().describe('Commitment ID (for complete/cancel/snooze)'),
        description: z.string().optional().describe('What was committed to'),
        person_name: z.string().optional().describe('Person involved'),
        direction: z.enum(COMMITMENT_DIRECTIONS).optional().describe('Who made the commitment'),
        source: z.enum(COMMITMENT_SOURCES).optional().describe('Where detected'),
        deadline: z.number().optional().describe('Deadline timestamp (ms)'),
        confidence: z.number().min(0).max(1).default(0.8).optional().describe('Confidence this is a real commitment'),
        notes: z.string().optional().describe('Notes or reason'),
        snooze_until: z.number().optional().describe('Snooze until timestamp (ms)'),
        recipient: z.string().optional().describe('Message recipient (for track_outbound)'),
        channel: z.string().optional().describe('Channel (for track_outbound/record_reply)'),
        summary: z.string().optional().describe('Message summary (for track_outbound)'),
      },
      async ({ action, commitment_id, description, person_name, direction, source, deadline, confidence, notes, snooze_until, recipient, channel, summary }) => {
        switch (action) {
          case 'add': {
            if (!description || !person_name) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'description and person_name required' }) }] };
            }
            const c = commitments.addCommitment({
              description,
              personName: person_name,
              direction: direction || 'user_promised',
              source: source || 'conversation',
              deadline: deadline || null,
              confidence: confidence ?? 0.8,
              domain: '',
              contextSnippet: '',
            });
            if (!c) {
              return { content: [{ type: 'text', text: JSON.stringify({ added: false, reason: 'Duplicate or below confidence threshold' }) }] };
            }
            return { content: [{ type: 'text', text: JSON.stringify({ added: true, commitment: c }, null, 2) }] };
          }

          case 'complete': {
            if (!commitment_id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'commitment_id required' }) }] };
            const ok = commitments.completeCommitment(commitment_id, notes);
            return { content: [{ type: 'text', text: JSON.stringify({ completed: ok, id: commitment_id }) }] };
          }

          case 'cancel': {
            if (!commitment_id) return { content: [{ type: 'text', text: JSON.stringify({ error: 'commitment_id required' }) }] };
            const ok = commitments.cancelCommitment(commitment_id, notes);
            return { content: [{ type: 'text', text: JSON.stringify({ cancelled: ok, id: commitment_id }) }] };
          }

          case 'snooze': {
            if (!commitment_id || !snooze_until) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'commitment_id and snooze_until required' }) }] };
            }
            const ok = commitments.snoozeCommitment(commitment_id, snooze_until);
            return { content: [{ type: 'text', text: JSON.stringify({ snoozed: ok, id: commitment_id, until: new Date(snooze_until).toISOString() }) }] };
          }

          case 'list': {
            const active = commitments.getActiveCommitments();
            const upcoming = commitments.getUpcomingDeadlines();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  active: active.map((c) => ({
                    id: c.id, description: c.description, personName: c.personName,
                    direction: c.direction, status: c.status,
                    deadline: c.deadline ? new Date(c.deadline).toISOString() : null,
                    createdAt: new Date(c.createdAt).toISOString(),
                  })),
                  upcoming: upcoming.map((c) => ({
                    id: c.id, description: c.description, personName: c.personName,
                    deadline: c.deadline ? new Date(c.deadline).toISOString() : null,
                  })),
                }, null, 2),
              }],
            };
          }

          case 'status': {
            return {
              content: [{ type: 'text', text: JSON.stringify(commitments.getStatus(), null, 2) }],
            };
          }

          case 'follow_ups': {
            const suggestions = commitments.generateFollowUpSuggestions();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  newSuggestions: suggestions.length,
                  suggestions: suggestions.map((s) => ({
                    id: s.id, type: s.type, personName: s.personName,
                    suggestedAction: s.suggestedAction, urgency: s.urgency,
                  })),
                }, null, 2),
              }],
            };
          }

          case 'track_outbound': {
            if (!recipient || !channel) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'recipient and channel required' }) }] };
            }
            const msg = commitments.trackOutboundMessage({ recipient, channel, summary: summary || '' });
            return {
              content: [{ type: 'text', text: JSON.stringify({ tracked: true, message: msg }, null, 2) }],
            };
          }

          case 'record_reply': {
            if (!recipient || !channel) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'recipient and channel required' }) }] };
            }
            const found = commitments.recordReply(recipient, channel);
            return {
              content: [{ type: 'text', text: JSON.stringify({ recorded: found, recipient, channel }) }],
            };
          }

          case 'context': {
            const ctx = commitments.getContextString();
            return {
              content: [{ type: 'text', text: JSON.stringify({ context: ctx || 'No active commitments or pending items.' }) }],
            };
          }

          default:
            return { content: [{ type: 'text', text: JSON.stringify({ error: `Unknown action: ${action}` }) }] };
        }
      },
    );
  }
}
