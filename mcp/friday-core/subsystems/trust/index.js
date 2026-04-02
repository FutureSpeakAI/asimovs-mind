/**
 * Trust Subsystem — Person-level trust graph with hermeneutic re-evaluation
 *
 * Tools: trust_person_score, trust_evidence_add, trust_evidence_list,
 *        trust_reevaluate, trust_graph_status, trust_person_resolve, trust_explain
 *
 * Models every person in the user's world with multi-dimensional trust scoring,
 * evidence tracking, fuzzy person resolution, and hermeneutic re-evaluation.
 *
 * Ported from nexus-os: trust-graph.ts. Stripped Electron, vault crypto, IPC.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { TrustGraph } from './graph.js';

const EVIDENCE_TYPES = [
  'promise_kept', 'promise_broken',
  'accurate_info', 'inaccurate_info',
  'helpful_action', 'unhelpful_action',
  'emotional_support', 'user_stated',
  'observed', 'inferred',
];

const DECAY_THRESHOLD_DAYS = 30;

export class TrustSubsystem extends Subsystem {
  #graph;

  constructor(deps) {
    super('trust', deps);
    this.#graph = new TrustGraph();
  }

  async start() {
    await this.#graph.initialize(this.state);
    await super.start();
    this.log.info(`Trust graph loaded: ${this.#graph.getPersonCount()} persons`);
  }

  async stop() {
    await this.#graph.save();
    await super.stop();
  }

  registerEvents() {
    // Auto-decay on vault unlock (session start equivalent)
    this.eventBus.on('vault:unlocked', () => {
      try {
        this.autoDecay();
      } catch (err) {
        this.log.warn(`Trust auto-decay on unlock failed: ${err.message}`);
      }
    });
  }

  /** Expose the graph instance for other subsystems */
  get graph() {
    return this.#graph;
  }

  /**
   * Auto-decay: iterate all persons in the graph. Anyone not seen in 30+ days
   * gets a decay pass. Publishes trust:score-updated for each affected person.
   */
  autoDecay() {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;
    const persons = this.#graph.getAllPersons();
    let decayCount = 0;

    for (const person of persons) {
      const daysSince = (now - person.lastSeen) / msPerDay;
      if (daysSince < DECAY_THRESHOLD_DAYS) continue;

      const beforeOverall = person.trust.overall;
      this.#graph.recomputeTrust(person.id);
      decayCount++;

      if (this.eventBus) {
        this.eventBus.publish('trust:score-updated', {
          personName: person.primaryName,
          personId: person.id,
          overall: person.trust.overall,
          previousOverall: beforeOverall,
          reason: 'auto_decay',
          daysSinceSeen: Math.floor(daysSince),
        });
      }
    }

    if (decayCount > 0) {
      this.log.info(`Auto-decay applied to ${decayCount} persons`);
    }
  }

  /**
   * Build a natural-language explanation of a person's trust score.
   */
  #explainTrust(identifier) {
    const { person } = this.#graph.resolvePerson(identifier);
    if (!person) return { found: false, explanation: `No person found matching "${identifier}".` };

    const overall = person.trust.overall;
    const label = overall >= 0.85 ? 'very high'
      : overall >= 0.7 ? 'high'
      : overall >= 0.55 ? 'moderate'
      : overall >= 0.4 ? 'developing'
      : overall >= 0.25 ? 'low'
      : 'very low';

    const positive = person.evidence.filter(e => e.impact > 0).length;
    const negative = person.evidence.filter(e => e.impact < 0).length;

    // Top 3 evidence entries by absolute impact
    const topEvidence = [...person.evidence]
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 3)
      .map(e => e.description);

    const daysSinceSeen = Math.floor((Date.now() - person.lastSeen) / (24 * 60 * 60 * 1000));
    const lastSeenStr = daysSinceSeen === 0 ? 'today' : `${daysSinceSeen} day${daysSinceSeen === 1 ? '' : 's'} ago`;

    let explanation = `Your trust in ${person.primaryName} is ${(overall * 100).toFixed(0)}% (${label}). `;
    explanation += `Based on: ${positive} positive evidence, ${negative} negative. `;
    if (topEvidence.length > 0) {
      explanation += `Key factors: ${topEvidence.join('; ')}. `;
    }
    explanation += `Last seen ${lastSeenStr}.`;

    return { found: true, person: person.primaryName, explanation, overall, label };
  }

  registerTools(server) {
    const graph = this.#graph;

    // -- trust_person_score -----------------------------------------------

    server.tool(
      'trust_person_score',
      'Get trust scores for a person. Resolves name/alias using fuzzy matching. Returns multi-dimensional trust breakdown.',
      {
        identifier: z.string().describe('Person name, email, handle, or alias to look up'),
      },
      async ({ identifier }) => {
        const { person, confidence, isNew } = graph.resolvePerson(identifier);
        if (!person) {
          return { content: [{ type: 'text', text: JSON.stringify({ found: false, identifier }) }] };
        }

        const context = graph.getContextForPerson(person.id);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              found: true,
              matchConfidence: confidence,
              isNew,
              person: {
                id: person.id,
                name: person.primaryName,
                aliases: person.aliases.map((a) => a.value),
                trust: person.trust,
                domains: person.domains,
                interactions: person.interactionCount,
                lastSeen: person.lastSeen,
                notes: person.notes,
              },
              context,
            }, null, 2)
          }]
        };
      }
    );

    // -- trust_evidence_add ------------------------------------------------

    server.tool(
      'trust_evidence_add',
      'Add trust evidence for a person. Evidence drives trust score computation. Types: promise_kept/broken, accurate/inaccurate_info, helpful/unhelpful_action, emotional_support, user_stated, observed, inferred.',
      {
        identifier: z.string().describe('Person name or alias'),
        type: z.enum(EVIDENCE_TYPES).describe('Evidence type'),
        description: z.string().describe('What happened'),
        impact: z.number().min(-1).max(1).describe('Impact: -1 (strongly negative) to +1 (strongly positive)'),
        domain: z.string().optional().describe('Domain (e.g. "engineering", "finance")'),
      },
      async ({ identifier, type, description, impact, domain }) => {
        const { person, isNew } = graph.resolvePerson(identifier);
        if (!person) {
          return { content: [{ type: 'text', text: JSON.stringify({ added: false, reason: 'Could not resolve person' }) }] };
        }

        graph.addEvidence(person.id, { type, description, impact, domain });

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              added: true,
              personId: person.id,
              personName: person.primaryName,
              isNewPerson: isNew,
              currentTrust: person.trust,
            }, null, 2)
          }]
        };
      }
    );

    // -- trust_evidence_list -----------------------------------------------

    server.tool(
      'trust_evidence_list',
      'List trust evidence for a person, sorted by impact. Shows the raw observations that drive trust scoring.',
      {
        identifier: z.string().describe('Person name or alias'),
        limit: z.number().int().min(1).max(50).default(10).describe('Max entries to return'),
      },
      async ({ identifier, limit }) => {
        const { person } = graph.resolvePerson(identifier);
        if (!person) {
          return { content: [{ type: 'text', text: JSON.stringify({ found: false, identifier }) }] };
        }

        const evidence = [...person.evidence]
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, limit);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              personName: person.primaryName,
              totalEvidence: person.evidence.length,
              evidence: evidence.map((e) => ({
                id: e.id,
                type: e.type,
                description: e.description,
                impact: e.impact,
                domain: e.domain,
                timestamp: e.timestamp,
                age: `${Math.floor((Date.now() - e.timestamp) / (1000 * 60 * 60 * 24))}d ago`,
              })),
            }, null, 2)
          }]
        };
      }
    );

    // -- trust_reevaluate --------------------------------------------------

    server.tool(
      'trust_reevaluate',
      'Force a full hermeneutic re-evaluation of trust scores for a person. Recomputes ALL dimensions from ALL evidence.',
      {
        identifier: z.string().describe('Person name or alias'),
      },
      async ({ identifier }) => {
        const { person } = graph.resolvePerson(identifier);
        if (!person) {
          return { content: [{ type: 'text', text: JSON.stringify({ found: false, identifier }) }] };
        }

        const beforeOverall = person.trust.overall;
        graph.recomputeTrust(person.id);
        const afterOverall = person.trust.overall;

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              personName: person.primaryName,
              evidenceCount: person.evidence.length,
              trustBefore: beforeOverall,
              trustAfter: afterOverall,
              delta: afterOverall - beforeOverall,
              trust: person.trust,
            }, null, 2)
          }]
        };
      }
    );

    // -- trust_graph_status ------------------------------------------------

    server.tool(
      'trust_graph_status',
      'Get overview of the trust graph: total persons, top trusted, recent interactions, and system stats.',
      {},
      async () => {
        const status = graph.getStatus();
        const promptContext = graph.getPromptContext();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...status,
              promptContext,
            }, null, 2)
          }]
        };
      }
    );

    // -- trust_person_resolve ----------------------------------------------

    server.tool(
      'trust_person_resolve',
      'Resolve an identifier to a person node without modifying trust. Shows match confidence and whether a new person was created.',
      {
        identifier: z.string().describe('Name, email, handle, or alias'),
        type: z.enum(['name', 'email', 'handle', 'phone', 'nickname']).optional()
          .describe('Hint for the identifier type'),
      },
      async ({ identifier, type }) => {
        const { person, confidence, isNew } = graph.resolvePerson(identifier, type);
        if (!person) {
          return { content: [{ type: 'text', text: JSON.stringify({ resolved: false, identifier }) }] };
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              resolved: true,
              isNew,
              matchConfidence: confidence,
              person: {
                id: person.id,
                name: person.primaryName,
                aliases: person.aliases,
                trust: { overall: person.trust.overall },
                interactions: person.interactionCount,
              },
            }, null, 2)
          }]
        };
      }
    );

    // -- trust_explain ------------------------------------------------------

    server.tool(
      'trust_explain',
      'Get a natural language explanation of trust for a person. Summarizes score, evidence breakdown, key factors, and last seen.',
      {
        identifier: z.string().describe('Person name, email, handle, or alias'),
      },
      async ({ identifier }) => {
        const result = this.#explainTrust(identifier);
        return {
          content: [{
            type: 'text',
            text: result.found
              ? JSON.stringify(result, null, 2)
              : JSON.stringify({ found: false, explanation: result.explanation }),
          }]
        };
      }
    );
  }
}
