/**
 * Context Graph -- Entity-relationship tracking with recency weighting
 *
 * Ported from nexus-os context-graph.ts. Stores nodes (files, functions,
 * people, concepts, projects) and edges (contains, imports, calls,
 * mentions, related). Persists via vault state. Not a full RDF store --
 * just practical entity tracking for context-aware LLM requests.
 *
 * Nodes: { id, type, name, metadata, lastSeen }
 * Edges: { from, to, relationship, weight, lastSeen }
 */

// -- Entity extraction patterns ------------------------------------------------

const FILE_PATTERN = /(?:^|\s|["'`(])([A-Za-z]:\\[^\s"'`),]+|\/(?:Users|home|tmp|var|etc|src|lib|app)[^\s"'`),]+|[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+\.(?:ts|tsx|js|jsx|py|rs|go|java|cpp|c|h|css|html|json|yaml|yml|md|txt|toml|sql|sh|bat|ps1)|[a-zA-Z0-9_-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|cpp|c|h|css|html|json|yaml|yml|md|txt|toml|sql|sh|bat|ps1))/g;
const URL_PATTERN = /https?:\/\/[^\s"'`),]+/g;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had',
  'her', 'was', 'one', 'our', 'out', 'has', 'have', 'that', 'this',
  'with', 'from', 'they', 'been', 'said', 'each', 'which', 'their',
  'will', 'other', 'about', 'many', 'then', 'them', 'these', 'some',
  'would', 'make', 'like', 'into', 'could', 'time', 'very', 'when',
  'come', 'made', 'find', 'back', 'only', 'long', 'just', 'over',
  'such', 'take', 'also', 'more', 'than', 'what', 'does',
  'using', 'used', 'test', 'file', 'true', 'false', 'null', 'undefined',
  'const', 'function', 'return', 'import', 'export', 'class', 'interface',
  'type', 'string', 'number', 'boolean', 'void', 'async', 'await',
]);

const NODE_TYPES = new Set(['file', 'function', 'person', 'concept', 'project']);
const EDGE_TYPES = new Set(['contains', 'imports', 'calls', 'mentions', 'related']);

const DEFAULT_CONFIG = {
  maxNodes: 500,
  maxEdges: 2000,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  decayHalfLife: 60 * 60 * 1000,    // 1 hour
};

// -- Type weights for relevance scoring ----------------------------------------

const TYPE_WEIGHTS = {
  file: 1.0,
  project: 0.95,
  function: 0.9,
  person: 0.8,
  concept: 0.5,
};

let nodeCounter = 0;

export class ContextGraph {
  #nodes = new Map();   // id -> node
  #edges = [];          // array of edge objects
  #config;
  #state;               // vault state namespace
  #eventBus;
  #log;

  constructor({ state, eventBus, log, config } = {}) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
    this.#state = state;
    this.#eventBus = eventBus;
    this.#log = log || { info: () => {}, warn: () => {}, error: () => {} };
  }

  // -- Lifecycle ---------------------------------------------------------------

  async load() {
    if (!this.#state) return;
    try {
      const result = await this.#state.read('graph');
      if (result?.success && result.data) {
        const data = result.data;
        if (data.nodes && Array.isArray(data.nodes)) {
          for (const n of data.nodes) {
            this.#nodes.set(n.id, n);
          }
        }
        if (data.edges && Array.isArray(data.edges)) {
          this.#edges = data.edges;
        }
        this.#log.info(`loaded graph: ${this.#nodes.size} nodes, ${this.#edges.length} edges`);
      }
    } catch (err) {
      this.#log.warn(`failed to load graph: ${err.message}`);
    }
  }

  async persist() {
    if (!this.#state) return;
    try {
      const data = {
        nodes: Array.from(this.#nodes.values()),
        edges: this.#edges,
        savedAt: Date.now(),
      };
      await this.#state.write('graph', data);
    } catch (err) {
      this.#log.warn(`failed to persist graph: ${err.message}`);
    }
  }

  // -- Node operations ---------------------------------------------------------

  addNode({ id, type, name, metadata = {} }) {
    if (!NODE_TYPES.has(type)) {
      this.#log.warn(`unknown node type: ${type}`);
      return null;
    }

    const now = Date.now();
    const nodeId = id || `${type}-${++nodeCounter}-${now.toString(36)}`;
    const existing = this.#nodes.get(nodeId);

    if (existing) {
      existing.lastSeen = now;
      existing.metadata = { ...existing.metadata, ...metadata };
      return existing;
    }

    if (this.#nodes.size >= this.#config.maxNodes) {
      this.pruneNodes();
    }

    const node = { id: nodeId, type, name, metadata, lastSeen: now };
    this.#nodes.set(nodeId, node);

    if (this.#eventBus) {
      this.#eventBus.publish('context.node.added', { node });
    }
    return node;
  }

  getNode(id) {
    return this.#nodes.get(id) || null;
  }

  findNodeByName(name, type) {
    const lower = name.toLowerCase();
    for (const node of this.#nodes.values()) {
      if (type && node.type !== type) continue;
      if (node.name.toLowerCase() === lower) return node;
    }
    return null;
  }

  removeNode(id) {
    const removed = this.#nodes.delete(id);
    if (removed) {
      this.#edges = this.#edges.filter(e => e.from !== id && e.to !== id);
    }
    return removed;
  }

  // -- Edge operations ---------------------------------------------------------

  addEdge({ from, to, relationship, weight = 1.0 }) {
    if (!EDGE_TYPES.has(relationship)) {
      this.#log.warn(`unknown edge type: ${relationship}`);
      return null;
    }
    if (!this.#nodes.has(from) || !this.#nodes.has(to)) {
      this.#log.warn(`edge references missing node: ${from} -> ${to}`);
      return null;
    }

    const now = Date.now();

    // Update existing edge if it matches
    const existing = this.#edges.find(
      e => e.from === from && e.to === to && e.relationship === relationship
    );
    if (existing) {
      existing.weight = Math.min(10, existing.weight + weight * 0.2);
      existing.lastSeen = now;
      return existing;
    }

    if (this.#edges.length >= this.#config.maxEdges) {
      this.pruneEdges();
    }

    const edge = { from, to, relationship, weight, lastSeen: now };
    this.#edges.push(edge);

    if (this.#eventBus) {
      this.#eventBus.publish('context.edge.added', { edge });
    }
    return edge;
  }

  // -- Queries -----------------------------------------------------------------

  /**
   * Query nodes by pattern (substring match on name) and optional type filter.
   */
  query(pattern, type) {
    const lower = pattern?.toLowerCase() || '';
    const results = [];

    for (const node of this.#nodes.values()) {
      if (type && node.type !== type) continue;
      if (lower && !node.name.toLowerCase().includes(lower)) continue;
      results.push(node);
    }

    const now = Date.now();
    return results.sort((a, b) =>
      this.#relevanceScore(b, now) - this.#relevanceScore(a, now)
    );
  }

  /**
   * Get neighboring nodes connected by edges, up to a given depth.
   */
  getNeighbors(nodeId, depth = 1) {
    const visited = new Set([nodeId]);
    let frontier = new Set([nodeId]);
    const result = [];

    for (let d = 0; d < depth; d++) {
      const nextFrontier = new Set();

      for (const edge of this.#edges) {
        if (frontier.has(edge.from) && !visited.has(edge.to)) {
          visited.add(edge.to);
          nextFrontier.add(edge.to);
          const node = this.#nodes.get(edge.to);
          if (node) result.push({ node, edge, depth: d + 1 });
        }
        if (frontier.has(edge.to) && !visited.has(edge.from)) {
          visited.add(edge.from);
          nextFrontier.add(edge.from);
          const node = this.#nodes.get(edge.from);
          if (node) result.push({ node, edge, depth: d + 1 });
        }
      }

      frontier = nextFrontier;
      if (frontier.size === 0) break;
    }

    return result;
  }

  /**
   * Get the top-N most relevant nodes by recency-weighted scoring.
   */
  getTopNodes(limit = 15) {
    const now = Date.now();
    return Array.from(this.#nodes.values())
      .map(node => ({ node, score: this.#relevanceScore(node, now) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(x => x.node);
  }

  /**
   * Get nodes seen within a recent time window.
   */
  getActiveNodes(windowMs = 5 * 60 * 1000) {
    const cutoff = Date.now() - windowMs;
    return Array.from(this.#nodes.values())
      .filter(n => n.lastSeen >= cutoff)
      .sort((a, b) => b.lastSeen - a.lastSeen);
  }

  /**
   * Get edges for a specific node.
   */
  getEdgesFor(nodeId) {
    return this.#edges.filter(e => e.from === nodeId || e.to === nodeId);
  }

  // -- Pruning -----------------------------------------------------------------

  prune(maxAge) {
    const cutoff = Date.now() - (maxAge || this.#config.maxAge);
    const beforeNodes = this.#nodes.size;
    const beforeEdges = this.#edges.length;

    for (const [id, node] of this.#nodes) {
      if (node.lastSeen < cutoff) {
        this.#nodes.delete(id);
      }
    }

    this.#edges = this.#edges.filter(e => {
      if (e.lastSeen < cutoff) return false;
      return this.#nodes.has(e.from) && this.#nodes.has(e.to);
    });

    const prunedNodes = beforeNodes - this.#nodes.size;
    const prunedEdges = beforeEdges - this.#edges.length;
    if (prunedNodes > 0 || prunedEdges > 0) {
      this.#log.info(`pruned ${prunedNodes} nodes, ${prunedEdges} edges`);
    }
    return { prunedNodes, prunedEdges };
  }

  pruneNodes() {
    const now = Date.now();
    const scored = Array.from(this.#nodes.entries())
      .map(([id, node]) => ({ id, score: this.#relevanceScore(node, now) }))
      .sort((a, b) => a.score - b.score);

    const toRemove = Math.ceil(scored.length * 0.2);
    for (let i = 0; i < toRemove; i++) {
      this.#nodes.delete(scored[i].id);
    }
    // Clean dangling edges
    this.#edges = this.#edges.filter(e => this.#nodes.has(e.from) && this.#nodes.has(e.to));
  }

  pruneEdges() {
    this.#edges.sort((a, b) => a.lastSeen - b.lastSeen);
    const toRemove = Math.ceil(this.#edges.length * 0.2);
    this.#edges.splice(0, toRemove);
  }

  // -- Entity extraction from event bus events ---------------------------------

  /**
   * Process an event bus event and extract entities into the graph.
   * Called by the context subsystem's event listener.
   */
  processEvent(event) {
    const { topic, data, timestamp } = event;
    const now = timestamp || Date.now();

    if (!data) return;

    // Extract entities based on topic
    if (topic === 'tool.invoke' || topic === 'tool-invoke') {
      if (data.toolName) {
        this.#touchNode(`fn:${data.toolName}`, 'function', data.toolName, now);
      }
      if (data.file || data.filePath) {
        const filePath = data.file || data.filePath;
        this.#touchNode(`file:${filePath}`, 'file', this.#basename(filePath), now, { path: filePath });
      }
    }

    if (topic === 'git' || topic === 'git.commit') {
      if (data.repo) {
        this.#touchNode(`proj:${data.repo}`, 'project', data.repo, now);
      }
      if (data.files && Array.isArray(data.files)) {
        const projId = data.repo ? `proj:${data.repo}` : null;
        for (const f of data.files.slice(0, 10)) {
          const fileId = this.#touchNode(`file:${f}`, 'file', this.#basename(f), now, { path: f });
          if (projId && fileId) {
            this.addEdge({ from: projId, to: fileId, relationship: 'contains' });
          }
        }
      }
    }

    if (topic === 'communication' || topic === 'message') {
      for (const key of ['person', 'from', 'to', 'author']) {
        if (data[key] && typeof data[key] === 'string') {
          this.#touchNode(`person:${data[key]}`, 'person', data[key], now);
        }
      }
    }

    // Extract from summary/text fields
    const text = data.summary || data.text || data.title || '';
    if (text && typeof text === 'string') {
      this.#extractFromText(text, now);
    }
  }

  // -- Snapshot / stats --------------------------------------------------------

  get stats() {
    return {
      nodeCount: this.#nodes.size,
      edgeCount: this.#edges.length,
      nodesByType: this.#countByType(),
    };
  }

  toJSON() {
    return {
      nodes: Array.from(this.#nodes.values()),
      edges: this.#edges,
    };
  }

  // -- Private helpers ---------------------------------------------------------

  #touchNode(id, type, name, now, metadata = {}) {
    const existing = this.#nodes.get(id);
    if (existing) {
      existing.lastSeen = now;
      return id;
    }
    const node = this.addNode({ id, type, name, metadata });
    return node ? node.id : null;
  }

  #extractFromText(text, now) {
    // File paths — use matchAll to get capture group 1, which excludes the
    // leading delimiter character (space, quote, paren) from the full match.
    const fileMatches = [...text.matchAll(FILE_PATTERN)].map(m => m[1]);
    if (fileMatches.length > 0) {
      for (const m of fileMatches.slice(0, 5)) {
        const clean = m.trim();
        if (!clean) continue;
        this.#touchNode(`file:${clean}`, 'file', this.#basename(clean), now, { path: clean });
      }
    }

    // URLs -- track as concept nodes
    const urlMatches = text.match(URL_PATTERN);
    if (urlMatches) {
      for (const m of urlMatches.slice(0, 3)) {
        this.#touchNode(`concept:${m}`, 'concept', m, now, { url: m });
      }
    }

    // Topic keywords from short text
    if (text.length < 200) {
      const words = text
        .replace(/[^a-zA-Z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length > 3 && w.length < 30)
        .filter(w => !STOP_WORDS.has(w.toLowerCase()));

      if (words.length >= 1 && words.length <= 8) {
        const topic = words.slice(0, 4).join(' ');
        if (topic.length > 4) {
          this.#touchNode(`concept:${topic.toLowerCase()}`, 'concept', topic, now);
        }
      }
    }
  }

  #relevanceScore(node, now) {
    const ageMs = now - node.lastSeen;
    const recency = Math.pow(0.5, ageMs / this.#config.decayHalfLife);

    const edgeCount = this.#edges.filter(
      e => e.from === node.id || e.to === node.id
    ).length;
    const connectivity = Math.min(1, Math.log10(edgeCount + 1) / Math.log10(11));

    const typeWeight = TYPE_WEIGHTS[node.type] || 0.5;

    return recency * 0.5 + connectivity * 0.3 + typeWeight * 0.2;
  }

  #countByType() {
    const counts = {};
    for (const node of this.#nodes.values()) {
      counts[node.type] = (counts[node.type] || 0) + 1;
    }
    return counts;
  }

  #basename(filePath) {
    if (!filePath) return '';
    const parts = filePath.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1] || filePath;
  }
}
