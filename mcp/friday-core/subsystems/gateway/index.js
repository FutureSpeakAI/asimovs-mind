/**
 * Gateway Subsystem -- Trust-gated messaging gateway for external channels.
 *
 * Tools (5):
 *   gateway_authenticate   -- Resolve a sender's trust tier and policy
 *   gateway_session_create -- Create or restore a session for a sender
 *   gateway_session_status -- Get session status and history
 *   gateway_audit          -- Query the audit log
 *   gateway_policy         -- Get or modify trust policies and pairings
 *
 * Ported from nexus-os: gateway/trust-engine.ts, session-store.ts,
 *   persona-adapter.ts, audit-log.ts. Stripped Electron, IPC, filesystem.
 *
 * Trust tiers: owner > owner_dm > approved_dm > group > public
 * Fails CLOSED to 'public' (most restrictive) on any error.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { TrustEngine } from './trust-engine.js';
import { SessionStore } from './sessions.js';
import { AuditLog } from './audit.js';

const TRUST_TIERS = ['owner', 'owner_dm', 'approved_dm', 'group', 'public'];

export class GatewaySubsystem extends Subsystem {
  #trust;
  #sessions;
  #audit;

  constructor(deps) {
    super('gateway', deps);
    this.#trust = new TrustEngine();
    this.#sessions = new SessionStore();
    this.#audit = new AuditLog();
  }

  async start() {
    await this.#trust.initialize(this.state);
    await this.#sessions.initialize(this.state);
    await this.#audit.initialize(this.state);
    await super.start();

    const identities = this.#trust.getPairedIdentities();
    this.log.info(`Gateway started: ${identities.length} paired identities`);
  }

  async stop() {
    await this.#trust.destroy();
    await super.stop();
  }

  registerEvents() {
    // Periodically prune expired sessions
    this.eventBus.on('system:tick', () => {
      try {
        this.#sessions.pruneExpired();
      } catch (err) {
        process.stderr.write(`[friday:gateway] pruneExpired failed: ${err.message}\n`);
      }
    });
  }

  /** Expose internals for other subsystems */
  get trust() { return this.#trust; }
  get sessions() { return this.#sessions; }
  get audit() { return this.#audit; }

  registerTools(server) {
    const trust = this.#trust;
    const sessions = this.#sessions;
    const audit = this.#audit;

    // -- gateway_authenticate -------------------------------------------------

    server.tool(
      'gateway_authenticate',
      'Resolve a sender\'s trust tier and capability policy. Returns allowed tools, memory permissions, rate limits, and iteration cap for this sender. Fails closed to "public" tier on any error.',
      {
        channel: z.string().describe('Channel name (telegram, discord, slack, etc.)'),
        sender_id: z.string().describe('Sender identifier within the channel'),
        sender_name: z.string().optional().describe('Human-readable sender name'),
      },
      async ({ channel, sender_id, sender_name }) => {
        const tier = trust.resolveTrust(channel, sender_id);
        const policy = trust.getPolicy(tier);
        const withinRateLimit = trust.checkRateLimit(sender_id, policy);

        audit.logInbound(channel, sender_id, tier, `authenticate request`);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tier,
              policy: {
                maxIterations: policy.maxIterations,
                memoryRead: policy.memoryRead,
                memoryWrite: policy.memoryWrite,
                canTriggerScheduler: policy.canTriggerScheduler,
                rateLimitPerMinute: policy.rateLimitPerMinute,
                toolAllowPatterns: policy.toolAllowPatterns,
                toolBlockPatterns: policy.toolBlockPatterns,
              },
              withinRateLimit,
              senderName: sender_name || sender_id,
            }, null, 2),
          }],
        };
      },
    );

    // -- gateway_session_create -----------------------------------------------

    server.tool(
      'gateway_session_create',
      'Create or restore a gateway session for a sender. Adds a message to session history. Returns the conversation context for this sender.',
      {
        channel: z.string().min(1).describe('Channel name'),
        sender_id: z.string().min(1).describe('Sender identifier'),
        message: z.string().describe('The user message to add'),
        role: z.enum(['user', 'assistant']).default('user').describe('Message role'),
      },
      async ({ channel, sender_id, message, role }) => {
        if (!channel.trim() || !sender_id.trim()) {
          return { content: [{ type: 'text', text: JSON.stringify({ error: 'channel and sender_id must be non-empty' }) }] };
        }
        if (role === 'user') {
          sessions.addUserMessage(channel, sender_id, message);
        } else {
          sessions.addAssistantMessage(channel, sender_id, message);
        }

        const history = sessions.getHistory(channel, sender_id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              sessionKey: `${channel}:${sender_id}`,
              messageCount: history.length,
              history,
            }, null, 2),
          }],
        };
      },
    );

    // -- gateway_session_status ------------------------------------------------

    server.tool(
      'gateway_session_status',
      'Get the status of gateway sessions. Lists active sessions, their message counts, and expiry state.',
      {
        channel: z.string().optional().describe('Filter by channel'),
        sender_id: z.string().optional().describe('Filter by sender'),
      },
      async ({ channel, sender_id }) => {
        if (channel && sender_id) {
          const history = sessions.getHistory(channel, sender_id);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                sessionKey: `${channel}:${sender_id}`,
                messageCount: history.length,
                history,
              }, null, 2),
            }],
          };
        }

        const allSessions = sessions.listSessions();
        const filtered = channel
          ? allSessions.filter((s) => s.channel === channel)
          : allSessions;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              activeSessions: sessions.getActiveCount(),
              sessions: filtered.map((s) => ({
                key: s.key,
                channel: s.channel,
                senderId: s.senderId,
                messages: s.messageCount,
                lastActivity: new Date(s.lastActivity).toISOString(),
                expired: s.expired,
              })),
            }, null, 2),
          }],
        };
      },
    );

    // -- gateway_audit --------------------------------------------------------

    server.tool(
      'gateway_audit',
      'Query the gateway audit log. Returns recent inbound/outbound message records with timestamps, channels, senders, and trust tiers.',
      {
        limit: z.number().int().min(1).max(200).default(50).describe('Max entries'),
        direction: z.enum(['in', 'out']).optional().describe('Filter by direction'),
      },
      async ({ limit, direction }) => {
        const entries = audit.getEntries(limit, direction);
        const stats = audit.getStats();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              stats,
              entries: entries.map((e) => ({
                ...e,
                time: new Date(e.ts).toISOString(),
              })),
            }, null, 2),
          }],
        };
      },
    );

    // -- gateway_policy -------------------------------------------------------

    server.tool(
      'gateway_policy',
      'Manage gateway trust policies. Actions: "get" returns policy for a tier, "pair" approves a pairing code, "revoke" removes a paired identity, "list_paired" shows all paired identities, "list_pending" shows pending pairing requests.',
      {
        action: z.enum(['get', 'pair', 'revoke', 'list_paired', 'list_pending']).describe('Action to perform'),
        tier: z.enum(TRUST_TIERS).optional().describe('Trust tier (for "get" action)'),
        code: z.string().optional().describe('Pairing code (for "pair" action)'),
        identity_id: z.string().optional().describe('Identity ID (for "revoke" action)'),
        pair_tier: z.enum(TRUST_TIERS).optional().describe('Tier to assign on pairing (default: approved_dm)'),
      },
      async ({ action, tier, code, identity_id, pair_tier }) => {
        switch (action) {
          case 'get': {
            const t = tier || 'public';
            const policy = trust.getPolicy(t);
            return {
              content: [{ type: 'text', text: JSON.stringify({ tier: t, policy }, null, 2) }],
            };
          }

          case 'pair': {
            if (!code) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Pairing code required' }) }] };
            }
            const identity = await trust.approvePairing(code, pair_tier || 'approved_dm');
            if (!identity) {
              return { content: [{ type: 'text', text: JSON.stringify({ paired: false, reason: 'Invalid or expired code' }) }] };
            }
            return {
              content: [{ type: 'text', text: JSON.stringify({ paired: true, identity }, null, 2) }],
            };
          }

          case 'revoke': {
            if (!identity_id) {
              return { content: [{ type: 'text', text: JSON.stringify({ error: 'Identity ID required' }) }] };
            }
            const revoked = await trust.revokePairing(identity_id);
            return {
              content: [{ type: 'text', text: JSON.stringify({ revoked }) }],
            };
          }

          case 'list_paired': {
            const identities = trust.getPairedIdentities();
            return {
              content: [{ type: 'text', text: JSON.stringify({ count: identities.length, identities }, null, 2) }],
            };
          }

          case 'list_pending': {
            const pending = trust.getPendingPairings();
            return {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  count: pending.length,
                  pending: pending.map((p) => ({
                    code: p.code,
                    channel: p.channel,
                    senderName: p.senderName,
                    expiresIn: Math.max(0, Math.round((p.expiresAt - Date.now()) / 1000)) + 's',
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
  }
}
