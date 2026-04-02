/**
 * Memory Subsystem — 3-tier memory with semantic search
 *
 * Tools: memory_store, memory_recall, memory_search, memory_consolidate,
 *        memory_status, memory_episode_start, memory_episode_end, memory_forget
 *
 * Architecture:
 *   Short-term  — current session, in-memory only, cleared on stop
 *   Medium-term — persisted observations promoted from short-term (vault-backed)
 *   Long-term   — consolidated insights promoted from medium-term (vault-backed)
 *
 * Embedding pipeline (Ollama) generates vector embeddings for semantic search.
 * When Ollama is unavailable, degrades gracefully to keyword matching.
 *
 * Ported from nexus-os: memory.ts, episodic-memory.ts, memory-consolidation.ts,
 * embedding-pipeline.ts, semantic-search.ts. Stripped of Electron, Obsidian,
 * integrity signing, trust graph, personality bridge, and Gemini cloud fallback.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { EmbeddingPipeline } from './embedding.js';
import { SemanticSearchEngine } from './search.js';
import { MemoryTiers } from './tiers.js';
import { EpisodicMemory } from './episodic.js';
import { MemoryConsolidation } from './consolidation.js';

// Capacity caps per tier
const TIER_CAPS = { short: 100, medium: 500, long: 1000 };

export class MemorySubsystem extends Subsystem {
  #pipeline;
  #search;
  #tiers;
  #episodic;
  #consolidation;
  #sessionBufferTimer = null;

  constructor(deps) {
    super('memory', deps);
    this.#pipeline = new EmbeddingPipeline();
    this.#search = new SemanticSearchEngine(this.#pipeline);
    this.#tiers = new MemoryTiers();
    this.#episodic = new EpisodicMemory();
    this.#consolidation = new MemoryConsolidation(this.#tiers, this.#search);
  }

  async start() {
    // Initialize semantic search (probes Ollama, loads cached embeddings)
    await this.#search.initialize(this.state);

    // Initialize 3-tier memory (loads persisted medium/long term from vault)
    await this.#tiers.initialize(this.state, this.#search);

    // Initialize episodic memory (loads episodes from vault)
    await this.#episodic.initialize(this.state, this.#search);

    // Session buffer: flush short-term to vault every 5 minutes for crash recovery
    this.#sessionBufferTimer = setInterval(() => {
      this.#flushSessionBuffer().catch(err =>
        this.log.warn(`session buffer flush failed: ${err.message}`)
      );
    }, 5 * 60 * 1000);

    await super.start();
    this.log.info('Memory subsystem started');
  }

  async stop() {
    // Clear session buffer interval and do final flush
    if (this.#sessionBufferTimer) {
      clearInterval(this.#sessionBufferTimer);
      this.#sessionBufferTimer = null;
    }
    await this.#flushSessionBuffer();
    this.#tiers.clearShortTerm();
    this.#pipeline.stop();
    await super.stop();
  }

  async #flushSessionBuffer() {
    if (!this.state) return;
    const shortTerm = this.#tiers.getShortTerm();
    if (shortTerm.length > 0) {
      await this.state.write('session-buffer', {
        entries: shortTerm,
        flushedAt: Date.now(),
      });
    }
  }

  registerEvents() {
    // Listen for session-end to clear short-term
    this.eventBus.on('session:end', () => {
      this.#tiers.clearShortTerm();
    });

    // Auto-extract: trust evidence -> store observation
    this.eventBus.on('trust:evidence-added', (event) => {
      if (!this.started || !event.data?.description) return;
      this.#storeWithCapacity(
        `Trust observation: ${event.data.description}`,
        'fact', 'medium', 0.7
      ).catch(() => {});
    });

    // Auto-extract: agent completed -> store result observation
    this.eventBus.on('agent:completed', (event) => {
      if (!this.started || !event.data?.summary) return;
      this.#storeWithCapacity(
        `Agent result: ${event.data.summary}`,
        'context', 'short', 0.9
      ).catch(() => {});
    });

    // Auto-extract: connector detected -> store tool availability
    this.eventBus.on('connector:detected', (event) => {
      if (!this.started || !event.data?.connectorId) return;
      this.#storeWithCapacity(
        `Connector available: ${event.data.connectorId}`,
        'context', 'short', 0.6
      ).catch(() => {});
    });

    // Auto-extract: enterprise commitment -> store as memory
    this.eventBus.on('enterprise:commitment-created', (event) => {
      if (!this.started || !event.data?.description) return;
      this.#storeWithCapacity(
        `Commitment: ${event.data.description} (${event.data.personName || 'unknown'})`,
        'fact', 'medium', 0.8
      ).catch(() => {});
    });
  }

  /**
   * Store with capacity management. If a tier is over its cap, evict the
   * oldest entry with the lowest access count before inserting.
   */
  async #storeWithCapacity(content, category, tier, confidence) {
    const tierMap = { short: 'shortTerm', medium: 'mediumTerm', long: 'longTerm' };
    const tierKey = tierMap[tier];
    const cap = TIER_CAPS[tier];

    if (tierKey && cap) {
      const getter = {
        shortTerm: () => this.#tiers.getShortTerm(),
        mediumTerm: () => this.#tiers.getMediumTerm(),
        longTerm: () => this.#tiers.getLongTerm(),
      };
      const entries = getter[tierKey]();
      if (entries.length >= cap) {
        // Evict oldest entry with lowest access count
        const sorted = [...entries].sort((a, b) => {
          const accessDiff = a.accessCount - b.accessCount;
          if (accessDiff !== 0) return accessDiff;
          return a.created - b.created;
        });
        if (sorted.length > 0) {
          await this.#tiers.forget(sorted[0].id);
        }
      }
    }

    return this.#tiers.store(content, category, tier, confidence);
  }

  registerTools(server) {
    const tiers = this.#tiers;
    const search = this.#search;
    const episodic = this.#episodic;
    const consolidation = this.#consolidation;
    const pipeline = this.#pipeline;

    // -- memory_store ---------------------------------------------------

    server.tool(
      'memory_store',
      'Store an observation in memory. Short-term is session-only, medium-term persists, long-term is for confirmed facts.',
      {
        content: z.string().max(50000).describe('The observation or fact to remember'),
        category: z.enum(['preference', 'pattern', 'context', 'fact'])
          .default('fact')
          .describe('Category: preference, pattern, context, or fact'),
        tier: z.enum(['short', 'medium', 'long'])
          .default('short')
          .describe('Memory tier: short (session), medium (persisted), long (consolidated)'),
        confidence: z.number().min(0).max(1).default(0.5)
          .describe('Confidence score 0-1'),
      },
      async ({ content, category, tier, confidence }) => {
        const entry = await tiers.store(content, category, tier, confidence);
        if (!entry) {
          return { content: [{ type: 'text', text: JSON.stringify({ stored: false, reason: 'Duplicate detected in target tier' }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ stored: true, id: entry.id, tier, category, confidence: entry.confidence }) }] };
      }
    );

    // -- memory_recall --------------------------------------------------

    server.tool(
      'memory_recall',
      'Recall relevant memories using semantic search (if embeddings available) or keyword matching.',
      {
        query: z.string().describe('What to search for'),
        limit: z.number().int().min(1).max(50).default(5)
          .describe('Maximum results to return'),
      },
      async ({ query, limit }) => {
        const results = await tiers.recall(query, limit);
        return { content: [{ type: 'text', text: JSON.stringify({ count: results.length, results }, null, 2) }] };
      }
    );

    // -- memory_search --------------------------------------------------

    server.tool(
      'memory_search',
      'Full semantic search across all indexed memories. Supports tier filtering.',
      {
        query: z.string().describe('Search query'),
        tier: z.enum(['short-term', 'medium-term', 'long-term', 'episode'])
          .optional()
          .describe('Filter by tier (optional)'),
        limit: z.number().int().min(1).max(50).default(10)
          .describe('Maximum results'),
      },
      async ({ query, tier, limit }) => {
        const options = { maxResults: limit, minScore: 0.2 };
        if (tier) options.types = [tier];

        const results = await search.search(query, options);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              query,
              count: results.length,
              embeddingsAvailable: pipeline.isReady(),
              results,
            }, null, 2)
          }]
        };
      }
    );

    // -- memory_consolidate ---------------------------------------------

    server.tool(
      'memory_consolidate',
      'Trigger a memory consolidation pass. Promotes high-scoring medium-term observations to long-term.',
      {},
      async () => {
        const result = await consolidation.run();
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }
    );

    // -- memory_status --------------------------------------------------

    server.tool(
      'memory_status',
      'Memory system statistics: counts per tier, embedding pipeline health, episode status.',
      {},
      async () => {
        const tierStatus = tiers.status();
        const episodeStatus = episodic.status();
        const searchStats = search.getStats();
        const scores = consolidation.scoreAll();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              tiers: tierStatus,
              episodes: episodeStatus,
              embeddings: {
                available: pipeline.isReady(),
                model: pipeline.modelName,
                indexed: search.getCount(),
                byType: searchStats,
              },
              consolidation: {
                candidateCount: scores.filter(s => s.meetsThreshold).length,
                candidates: scores.filter(s => s.meetsThreshold).slice(0, 5),
              },
            }, null, 2)
          }]
        };
      }
    );

    // -- memory_episode_start -------------------------------------------

    server.tool(
      'memory_episode_start',
      'Begin recording an episode (session). Tracks observations until ended.',
      {
        title: z.string().describe('Episode title describing the session topic'),
      },
      async ({ title }) => {
        const episode = episodic.startEpisode(title);
        return { content: [{ type: 'text', text: JSON.stringify({ started: true, episode }) }] };
      }
    );

    // -- memory_episode_end ---------------------------------------------

    server.tool(
      'memory_episode_end',
      'End the current episode and store it with a summary.',
      {
        summary: z.string().describe('Summary of what happened in this episode'),
        topics: z.array(z.string().max(200)).max(20).default([])
          .describe('Topic tags (1-3 words each)'),
        emotionalTone: z.string().default('neutral')
          .describe('Emotional tone: positive, neutral, frustrated, excited, focused, etc.'),
        keyDecisions: z.array(z.string().max(500)).max(20).default([])
          .describe('Key decisions or action items from this episode'),
      },
      async ({ summary, topics, emotionalTone, keyDecisions }) => {
        const episode = await episodic.endEpisode(summary, { topics, emotionalTone, keyDecisions });
        if (!episode) {
          return { content: [{ type: 'text', text: JSON.stringify({ ended: false, reason: 'No active episode' }) }] };
        }
        return { content: [{ type: 'text', text: JSON.stringify({ ended: true, episode }, null, 2) }] };
      }
    );

    // -- memory_forget --------------------------------------------------

    server.tool(
      'memory_forget',
      'Remove a specific memory by ID from any tier.',
      {
        id: z.string().describe('Memory entry ID to forget'),
      },
      async ({ id }) => {
        // Try tiers first
        let found = await tiers.forget(id);

        // Try episodes
        if (!found) {
          found = await episodic.deleteEpisode(id);
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ forgotten: found, id })
          }]
        };
      }
    );
  }
}
