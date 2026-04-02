/**
 * Context Subsystem -- Knowledge graph + context injection for LLM requests
 *
 * Ported from nexus-os context-graph.ts + context-injector.ts.
 * Uses the shared event bus (not its own stream) per porting rules.
 *
 * MCP tools:
 *   context_snapshot  - Get current context (recent events + active entities)
 *   context_inject    - Build enriched context block for an LLM request
 *   context_add       - Add a node or edge to the knowledge graph
 *   context_query     - Query the knowledge graph by pattern
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { ContextGraph } from './graph.js';
import { ContextInjector } from './injector.js';

export class ContextSubsystem extends Subsystem {
  #graph;
  #injector;
  #persistTimer = null;

  constructor(deps) {
    super('context', deps);

    this.#graph = new ContextGraph({
      state: this.state,
      eventBus: this.eventBus,
      log: this.log,
    });

    this.#injector = new ContextInjector({
      graph: this.#graph,
      eventBus: this.eventBus,
      log: this.log,
    });
  }

  // -- Lifecycle ---------------------------------------------------------------

  async start() {
    await this.#graph.load();

    // Auto-persist every 5 minutes
    this.#persistTimer = setInterval(() => {
      this.#graph.persist().catch(err =>
        this.log.warn(`context graph persist failed: ${err.message}`)
      );
    }, 5 * 60 * 1000);
    this.#persistTimer.unref();

    this.log.info('context subsystem started');
    await super.start();
  }

  async stop() {
    if (this.#persistTimer) {
      clearInterval(this.#persistTimer);
      this.#persistTimer = null;
    }
    await this.#graph.persist();
    this.log.info('context subsystem stopped');
    await super.stop();
  }

  // -- Event bus subscription --------------------------------------------------

  registerEvents() {
    if (!this.eventBus) return;

    // Feed entity-rich events into the graph. Wiring.js routes memory:stored
    // explicitly, so we only subscribe to events that carry entity content.
    // The prior wildcard '*' handler was removed because it processed every
    // event (including noise like eis:updated, trust:score-updated) at cost
    // of CPU with no entity extraction benefit.
    const feedGraph = (event) => {
      try { this.#graph.processEvent(event); } catch { /* graph errors are non-fatal */ }
    };
    this.eventBus.on('message:user', feedGraph);
    this.eventBus.on('message:assistant', feedGraph);
    this.eventBus.on('trust:evidence-added', feedGraph);

    // On vault:unlocked, reload graph from vault
    this.eventBus.on('vault:unlocked', async () => {
      try {
        await this.#graph.load();
        this.log.info('context graph reloaded on vault unlock');
      } catch (err) {
        this.log.warn(`context graph reload on unlock failed: ${err.message}`);
      }
    });

    // On session:start, hydrate with cwd info (project name, git branch)
    this.eventBus.on('session:start', (event) => {
      try {
        const data = event.data || {};
        if (data.projectName) {
          this.#graph.addNode({
            id: `proj:${data.projectName}`,
            type: 'project',
            name: data.projectName,
            metadata: {
              cwd: data.cwd,
              gitBranch: data.gitBranch || null,
            },
          });
        }
        if (data.cwd) {
          this.#graph.addNode({
            id: `file:${data.cwd}`,
            type: 'file',
            name: data.cwd.split(/[\\/]/).pop() || data.cwd,
            metadata: { path: data.cwd, isWorkdir: true },
          });
        }
        this.log.info('context hydrated with session cwd info');
      } catch (err) {
        this.log.warn(`context session hydration failed: ${err.message}`);
      }
    });

    // memory:stored is routed explicitly through wiring.js

    // On session:end, save graph to vault. vault:locking triggers session:end
    // via the conductor, so subscribing to both would cause a double save.
    this.eventBus.on('session:end', async () => {
      try {
        await this.#graph.persist();
        this.log.info('context graph saved to vault');
      } catch (err) {
        this.log.warn(`context graph save failed: ${err.message}`);
      }
    });
  }

  // -- MCP tools ---------------------------------------------------------------

  registerTools(server) {
    // context_snapshot -- current state overview
    server.tool(
      'context_snapshot',
      'Get current context snapshot: recent events, active entities, graph neighborhoods. Use to understand what the user is working on.',
      {
        depth: z.number().min(1).max(5).default(2)
          .describe('How many relationship hops to traverse (1-5, default 2)'),
      },
      async ({ depth }) => {
        const snapshot = this.#injector.snapshot(depth);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(snapshot, null, 2),
          }],
        };
      }
    );

    // context_inject -- build context block for LLM prompt
    server.tool(
      'context_inject',
      'Build an enriched context block for an LLM request. Finds relevant entities and recent activity based on the query. Returns markdown suitable for system prompt injection.',
      {
        query: z.string()
          .describe('What the user is asking about. Used to focus the context on relevant entities.'),
      },
      async ({ query }) => {
        const context = this.#injector.inject(query);
        return {
          content: [{
            type: 'text',
            text: context || '(no context available)',
          }],
        };
      }
    );

    // context_add -- add node or edge to the graph
    server.tool(
      'context_add',
      'Add a node or edge to the knowledge graph. Nodes track entities (files, functions, people, concepts, projects). Edges track relationships (contains, imports, calls, mentions, related).',
      {
        type: z.enum(['node', 'edge'])
          .describe('Whether to add a node or an edge'),
        data: z.object({
          // Node fields
          id: z.string().optional()
            .describe('Node ID (auto-generated if omitted)'),
          nodeType: z.enum(['file', 'function', 'person', 'concept', 'project']).optional()
            .describe('Type of node (required for nodes)'),
          name: z.string().optional()
            .describe('Display name (required for nodes)'),
          metadata: z.record(z.unknown()).optional()
            .describe('Additional metadata for the node'),
          // Edge fields
          from: z.string().optional()
            .describe('Source node ID (required for edges)'),
          to: z.string().optional()
            .describe('Target node ID (required for edges)'),
          relationship: z.enum(['contains', 'imports', 'calls', 'mentions', 'related']).optional()
            .describe('Edge relationship type (required for edges)'),
          weight: z.number().min(0).max(10).optional()
            .describe('Edge weight (default 1.0)'),
        }).describe('Node or edge data'),
      },
      async ({ type, data }) => {
        if (type === 'node') {
          if (!data.nodeType || !data.name) {
            return {
              content: [{ type: 'text', text: 'Error: nodeType and name are required for nodes' }],
              isError: true,
            };
          }
          const node = this.#graph.addNode({
            id: data.id,
            type: data.nodeType,
            name: data.name,
            metadata: data.metadata || {},
          });
          return {
            content: [{ type: 'text', text: JSON.stringify({ added: 'node', node }, null, 2) }],
          };
        }

        if (type === 'edge') {
          if (!data.from || !data.to || !data.relationship) {
            return {
              content: [{ type: 'text', text: 'Error: from, to, and relationship are required for edges' }],
              isError: true,
            };
          }
          const edge = this.#graph.addEdge({
            from: data.from,
            to: data.to,
            relationship: data.relationship,
            weight: data.weight || 1.0,
          });
          if (!edge) {
            return {
              content: [{ type: 'text', text: 'Error: could not add edge (missing nodes or invalid relationship)' }],
              isError: true,
            };
          }
          return {
            content: [{ type: 'text', text: JSON.stringify({ added: 'edge', edge }, null, 2) }],
          };
        }

        return {
          content: [{ type: 'text', text: 'Error: type must be "node" or "edge"' }],
          isError: true,
        };
      }
    );

    // context_query -- query the knowledge graph
    server.tool(
      'context_query',
      'Query the knowledge graph. Search by name pattern and optional type filter. Returns nodes sorted by relevance (recency + connectivity).',
      {
        pattern: z.string()
          .describe('Substring to match against node names'),
        type: z.enum(['file', 'function', 'person', 'concept', 'project']).optional()
          .describe('Filter by node type'),
      },
      async ({ pattern, type }) => {
        const results = this.#graph.query(pattern, type);
        const output = {
          query: { pattern, type: type || 'all' },
          resultCount: results.length,
          results: results.slice(0, 20).map(node => ({
            id: node.id,
            type: node.type,
            name: node.name,
            lastSeen: new Date(node.lastSeen).toISOString(),
            metadata: node.metadata,
            edges: this.#graph.getEdgesFor(node.id).map(e => ({
              from: e.from,
              to: e.to,
              relationship: e.relationship,
              weight: e.weight,
            })),
          })),
          graphStats: this.#graph.stats,
        };
        return {
          content: [{ type: 'text', text: JSON.stringify(output, null, 2) }],
        };
      }
    );
  }

  // -- Public accessors for other subsystems -----------------------------------

  get graph() { return this.#graph; }
  get injector() { return this.#injector; }
}
