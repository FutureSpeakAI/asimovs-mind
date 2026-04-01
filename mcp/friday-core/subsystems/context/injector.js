/**
 * Context Injector -- Builds context snapshots for LLM request enrichment
 *
 * Ported from nexus-os context-injector.ts. Reads the knowledge graph and
 * recent event bus events to assemble a context block that can be prepended
 * to LLM system prompts. Supports query-driven focus: given a user query,
 * it finds the most relevant graph nodes and recent activity.
 *
 * No singletons, no side effects. Pure computation over graph + events.
 */

const MAX_RECENT_EVENTS = 15;
const MAX_CONTEXT_ENTITIES = 12;
const MAX_CONTEXT_LENGTH = 3000; // chars, rough budget for injected context

export class ContextInjector {
  #graph;
  #eventBus;
  #log;

  constructor({ graph, eventBus, log } = {}) {
    this.#graph = graph;
    this.#eventBus = eventBus;
    this.#log = log || { info: () => {}, warn: () => {}, error: () => {} };
  }

  // -- Snapshot: recent events + active entities ------------------------------

  /**
   * Build a context snapshot suitable for quick inspection.
   * Returns structured data about what's happening right now.
   *
   * @param {number} depth - How many hops into the graph to traverse (default 2)
   */
  snapshot(depth = 2) {
    const recentEvents = this.#getRecentEvents();
    const activeNodes = this.#graph.getActiveNodes(10 * 60 * 1000); // last 10 min
    const topNodes = this.#graph.getTopNodes(10);

    // For each active node, get neighbors up to requested depth
    const neighborhoods = [];
    const seen = new Set();
    for (const node of activeNodes.slice(0, 5)) {
      if (seen.has(node.id)) continue;
      seen.add(node.id);

      const neighbors = this.#graph.getNeighbors(node.id, depth);
      if (neighbors.length > 0) {
        neighborhoods.push({
          center: { id: node.id, type: node.type, name: node.name },
          related: neighbors
            .filter(n => !seen.has(n.node.id))
            .slice(0, 8)
            .map(n => ({
              id: n.node.id,
              type: n.node.type,
              name: n.node.name,
              relationship: n.edge.relationship,
              depth: n.depth,
            })),
        });
        for (const n of neighbors) seen.add(n.node.id);
      }
    }

    return {
      timestamp: Date.now(),
      recentEvents: recentEvents.map(e => ({
        topic: e.topic,
        summary: e.data?.summary || e.data?.text || truncate(JSON.stringify(e.data), 100),
        timestamp: e.timestamp,
      })),
      activeEntities: activeNodes.slice(0, 10).map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
      })),
      topEntities: topNodes.map(n => ({
        id: n.id,
        type: n.type,
        name: n.name,
      })),
      neighborhoods,
      graphStats: this.#graph.stats,
    };
  }

  // -- Inject: build context block for a query --------------------------------

  /**
   * Build a context string for LLM system prompt injection, focused on a query.
   * Finds graph nodes relevant to the query, gathers their neighborhoods,
   * and combines with recent events into a markdown block.
   *
   * @param {string} query - What the user is asking about
   * @returns {string} Markdown context block
   */
  inject(query) {
    if (!query) return this.#buildGenericContext();

    const lines = ['## Active Context'];

    // 1. Find graph nodes matching the query
    const queryTokens = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
    const matchedNodes = [];

    for (const token of queryTokens) {
      const hits = this.#graph.query(token);
      for (const node of hits.slice(0, 5)) {
        if (!matchedNodes.find(n => n.id === node.id)) {
          matchedNodes.push(node);
        }
      }
    }

    // 2. Also consider active nodes (what the user has been working with recently)
    const activeNodes = this.#graph.getActiveNodes(10 * 60 * 1000);
    for (const node of activeNodes.slice(0, 5)) {
      if (!matchedNodes.find(n => n.id === node.id)) {
        matchedNodes.push(node);
      }
    }

    // 3. Build entity section
    if (matchedNodes.length > 0) {
      const grouped = {};
      for (const node of matchedNodes.slice(0, MAX_CONTEXT_ENTITIES)) {
        if (!grouped[node.type]) grouped[node.type] = [];
        grouped[node.type].push(node.name);
      }

      lines.push('### Relevant Entities');
      for (const [type, names] of Object.entries(grouped)) {
        lines.push(`- **${type}**: ${names.join(', ')}`);
      }

      // 4. Relationships for the top matched nodes
      const relationships = [];
      for (const node of matchedNodes.slice(0, 4)) {
        const neighbors = this.#graph.getNeighbors(node.id, 1);
        for (const n of neighbors.slice(0, 3)) {
          relationships.push(
            `${node.name} --[${n.edge.relationship}]--> ${n.node.name}`
          );
        }
      }
      if (relationships.length > 0) {
        lines.push('### Relationships');
        for (const rel of relationships.slice(0, 8)) {
          lines.push(`- ${rel}`);
        }
      }
    }

    // 5. Recent activity
    const recentEvents = this.#getRecentEvents();
    if (recentEvents.length > 0) {
      lines.push('### Recent Activity');
      for (const event of recentEvents.slice(0, 8)) {
        const ago = this.#agoString(event.timestamp);
        const summary = event.data?.summary || event.data?.text || event.topic;
        lines.push(`- [${ago}] ${truncate(summary, 80)}`);
      }
    }

    const result = lines.join('\n');
    return truncate(result, MAX_CONTEXT_LENGTH);
  }

  // -- Private helpers --------------------------------------------------------

  #buildGenericContext() {
    const lines = ['## Active Context'];

    const topNodes = this.#graph.getTopNodes(8);
    if (topNodes.length > 0) {
      const grouped = {};
      for (const node of topNodes) {
        if (!grouped[node.type]) grouped[node.type] = [];
        grouped[node.type].push(node.name);
      }

      lines.push('### Key Entities');
      for (const [type, names] of Object.entries(grouped)) {
        lines.push(`- **${type}**: ${names.join(', ')}`);
      }
    }

    const recentEvents = this.#getRecentEvents();
    if (recentEvents.length > 0) {
      lines.push('### Recent Activity');
      for (const event of recentEvents.slice(0, 5)) {
        const ago = this.#agoString(event.timestamp);
        const summary = event.data?.summary || event.data?.text || event.topic;
        lines.push(`- [${ago}] ${truncate(summary, 80)}`);
      }
    }

    if (lines.length <= 1) return '';
    return truncate(lines.join('\n'), MAX_CONTEXT_LENGTH);
  }

  #getRecentEvents() {
    if (!this.#eventBus) return [];
    try {
      return this.#eventBus.recent(null, MAX_RECENT_EVENTS);
    } catch {
      return [];
    }
  }

  #agoString(timestamp) {
    const seconds = Math.round((Date.now() - timestamp) / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  }
}

function truncate(str, maxLen) {
  if (!str || str.length <= maxLen) return str || '';
  return str.slice(0, maxLen - 3) + '...';
}
