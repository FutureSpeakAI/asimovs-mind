/**
 * Delegation Engine — Recursive agent delegation with trust-tier inheritance
 *
 * Enables agents to spawn sub-agents with:
 *   - Trust-tier inheritance (child <= parent, never escalates)
 *   - Configurable depth limit (default 3, max 5)
 *   - Context summarization at each delegation level
 *   - Halt propagation to all descendants
 *   - Partial result collection from interrupted children
 *
 * Ported from nexus-os: delegation-engine.ts. Stripped Electron,
 * integrityManager, officeManager, contextStream, agentRunner coupling.
 * Pure coordination layer -- actual agent execution happens externally.
 */

const TRUST_TIER_ORDER = {
  local: 0,
  'owner-dm': 1,
  'approved-dm': 2,
  group: 3,
  public: 4,
};

const DEFAULT_CONFIG = {
  defaultDepthLimit: 3,
  maxDepthLimit: 5,
  maxChildrenPerAgent: 5,
  maxTotalNodes: 30,
  haltTimeoutMs: 500,
};

function generateId() {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export class DelegationEngine {
  #nodes = new Map();
  #roots = new Set();
  #config;
  #updateCallbacks = [];
  #eventBus = null;

  constructor(config) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(eventBus) {
    this.#eventBus = eventBus;
  }

  /* -- Configuration -- */

  getConfig() {
    return { ...this.#config };
  }

  updateConfig(updates) {
    if (updates.defaultDepthLimit !== undefined) {
      this.#config.defaultDepthLimit = Math.min(Math.max(1, updates.defaultDepthLimit), this.#config.maxDepthLimit);
    }
    if (updates.maxDepthLimit !== undefined) {
      this.#config.maxDepthLimit = Math.min(Math.max(1, updates.maxDepthLimit), 5);
    }
    if (updates.haltTimeoutMs !== undefined) {
      this.#config.haltTimeoutMs = Math.min(Math.max(100, updates.haltTimeoutMs), 2000);
    }
    if (updates.maxChildrenPerAgent !== undefined) {
      this.#config.maxChildrenPerAgent = Math.min(Math.max(1, updates.maxChildrenPerAgent), 10);
    }
    if (updates.maxTotalNodes !== undefined) {
      this.#config.maxTotalNodes = Math.min(Math.max(5, updates.maxTotalNodes), 100);
    }
  }

  /* -- Event Subscription -- */

  onUpdate(callback) {
    this.#updateCallbacks.push(callback);
    return () => {
      this.#updateCallbacks = this.#updateCallbacks.filter((cb) => cb !== callback);
    };
  }

  #emitUpdate(update) {
    for (const cb of this.#updateCallbacks) {
      try { cb(update); } catch { /* swallow */ }
    }
    if (this.#eventBus) {
      this.#eventBus.emit('delegation:update', update);
    }
  }

  /* -- Root Registration -- */

  registerRoot(taskId, agentType, description, trustTier = 'local') {
    const node = {
      taskId,
      agentType,
      description,
      parentId: null,
      depth: 0,
      trustTier,
      state: 'running',
      contextSummary: '',
      result: null,
      error: null,
      children: [],
      createdAt: Date.now(),
      completedAt: null,
    };

    this.#nodes.set(taskId, node);
    this.#roots.add(taskId);

    this.#emitUpdate({ type: 'node-created', node, rootId: taskId });
    return node;
  }

  /* -- Sub-Agent Spawning -- */

  /**
   * Validate and create a delegation node for a sub-agent.
   * Returns the node data if allowed, or an error if blocked.
   * Does NOT actually spawn -- the caller handles execution.
   */
  prepareSubAgent(options) {
    const { agentType, description, parentTaskId, parentContext } = options;

    const parentNode = this.#nodes.get(parentTaskId);
    if (!parentNode) {
      return { success: false, error: `Parent task ${parentTaskId} not found in delegation tree` };
    }

    // Depth limit
    const depthLimit = options.depthLimit
      ? Math.min(options.depthLimit, this.#config.maxDepthLimit)
      : this.#config.defaultDepthLimit;
    const childDepth = parentNode.depth + 1;
    if (childDepth >= depthLimit) {
      return { success: false, error: `Depth limit reached (${childDepth}/${depthLimit})` };
    }

    // Children-per-agent limit
    if (parentNode.children.length >= this.#config.maxChildrenPerAgent) {
      return { success: false, error: `Max children per agent reached (${this.#config.maxChildrenPerAgent})` };
    }

    // Total nodes circuit breaker
    if (this.#nodes.size >= this.#config.maxTotalNodes) {
      return { success: false, error: `Total node limit reached (${this.#config.maxTotalNodes})` };
    }

    // Trust tier can only degrade
    const parentTrustOrder = TRUST_TIER_ORDER[parentNode.trustTier];
    let childTrustTier = parentNode.trustTier;
    if (options.trustTier) {
      const requestedOrder = TRUST_TIER_ORDER[options.trustTier];
      if (requestedOrder < parentTrustOrder) {
        childTrustTier = parentNode.trustTier; // Block escalation
      } else {
        childTrustTier = options.trustTier;
      }
    }

    // Context summarization
    const contextSummary = this.#summarizeContext(parentNode, parentContext);

    // Create node
    const taskId = generateId();
    const childNode = {
      taskId,
      agentType,
      description,
      parentId: parentTaskId,
      depth: childDepth,
      trustTier: childTrustTier,
      state: 'pending',
      contextSummary,
      result: null,
      error: null,
      children: [],
      createdAt: Date.now(),
      completedAt: null,
    };

    this.#nodes.set(taskId, childNode);
    parentNode.children.push(taskId);
    parentNode.state = 'delegating';

    this.#emitUpdate({ type: 'node-created', node: childNode, rootId: this.#findRoot(taskId) });

    return { success: true, taskId, node: childNode };
  }

  /** Mark a prepared node as running (after external spawn succeeds) */
  markRunning(taskId) {
    const node = this.#nodes.get(taskId);
    if (node) node.state = 'running';
  }

  /** Reassign a delegation node to a different task ID (if runner assigns its own) */
  reassignTaskId(oldId, newId) {
    const node = this.#nodes.get(oldId);
    if (!node) return;

    this.#nodes.delete(oldId);
    node.taskId = newId;
    this.#nodes.set(newId, node);

    // Update parent's children list
    if (node.parentId) {
      const parent = this.#nodes.get(node.parentId);
      if (parent) {
        const idx = parent.children.indexOf(oldId);
        if (idx >= 0) parent.children[idx] = newId;
      }
    }

    // Update each child's parentId to point to the new ID
    for (const childId of node.children) {
      const child = this.#nodes.get(childId);
      if (child && child.parentId === oldId) {
        child.parentId = newId;
      }
    }
  }

  /* -- Result Collection -- */

  reportCompletion(taskId, result, error) {
    const node = this.#nodes.get(taskId);
    if (!node) return;

    node.result = result;
    node.error = error;
    node.state = error ? 'failed' : 'completed';
    node.completedAt = Date.now();

    const rootId = this.#findRoot(taskId);
    this.#emitUpdate({ type: 'node-completed', node, rootId });

    // Check if parent's children are all done
    if (node.parentId) {
      const parentNode = this.#nodes.get(node.parentId);
      if (parentNode && parentNode.state === 'delegating') {
        const allChildrenDone = parentNode.children.every((cid) => {
          const child = this.#nodes.get(cid);
          return child && (child.state === 'completed' || child.state === 'failed' || child.state === 'interrupted');
        });
        if (allChildrenDone) {
          parentNode.state = 'collecting';
          this.#emitUpdate({ type: 'node-updated', node: parentNode, rootId });
        }
      }
    }

    // Check tree completion
    if (this.#roots.has(taskId)) {
      this.#checkTreeCompletion(taskId);
    } else if (node.parentId) {
      this.#checkTreeCompletion(this.#findRoot(taskId));
    }
  }

  collectChildResults(parentTaskId) {
    const parentNode = this.#nodes.get(parentTaskId);
    if (!parentNode) return [];

    return parentNode.children.map((cid) => {
      const child = this.#nodes.get(cid);
      if (!child) {
        return { taskId: cid, agentType: 'unknown', description: 'unknown', result: null, error: 'Node not found', state: 'failed' };
      }
      return {
        taskId: child.taskId,
        agentType: child.agentType,
        description: child.description,
        result: child.result,
        error: child.error,
        state: child.state,
      };
    });
  }

  /* -- Halt Propagation -- */

  /**
   * Halt an entire delegation tree from any node.
   * Returns list of task IDs that need to be stopped externally.
   */
  async haltTree(taskId) {
    const startTime = Date.now();
    const partialResults = [];
    let halted = 0;

    // BFS to find all nodes in the tree
    const toHalt = [];
    const queue = [taskId];
    const visited = new Set();

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);
      toHalt.push(current);

      const node = this.#nodes.get(current);
      if (node) {
        for (const childId of node.children) {
          if (!visited.has(childId)) queue.push(childId);
        }
      }
    }

    const haltedTaskIds = [];

    for (const nodeId of toHalt) {
      const n = this.#nodes.get(nodeId);
      if (!n) continue;

      if (n.state === 'running' || n.state === 'delegating' || n.state === 'collecting') {
        partialResults.push({
          taskId: n.taskId,
          agentType: n.agentType,
          result: n.result,
          state: n.state,
        });

        n.state = 'interrupted';
        n.completedAt = Date.now();
        halted++;
        haltedTaskIds.push(nodeId);

        this.#emitUpdate({ type: 'node-halted', node: n, rootId: this.#findRoot(nodeId) });
      }
    }

    const rootId = this.#findRoot(taskId);
    this.#emitUpdate({ type: 'tree-halted', rootId, tree: this.getTree(rootId) });

    return { halted, partialResults, elapsedMs: Date.now() - startTime, haltedTaskIds };
  }

  /** Halt all active delegation trees */
  async haltAll() {
    const startTime = Date.now();
    let totalAgents = 0;
    const allHaltedIds = [];

    for (const rootId of [...this.#roots]) {
      const result = await this.haltTree(rootId);
      totalAgents += result.halted;
      allHaltedIds.push(...result.haltedTaskIds);
    }

    return { treesHalted: this.#roots.size, totalAgents, elapsedMs: Date.now() - startTime, haltedTaskIds: allHaltedIds };
  }

  /* -- Tree Queries -- */

  getTree(rootId) {
    if (!this.#roots.has(rootId)) {
      const actualRoot = this.#findRoot(rootId);
      if (!this.#roots.has(actualRoot)) return null;
      return this.getTree(actualRoot);
    }

    const rootNode = this.#nodes.get(rootId);
    if (!rootNode) return null;

    const nodes = [];
    const queue = [rootId];
    const visited = new Set();
    let maxDepth = 0;

    while (queue.length > 0) {
      const current = queue.shift();
      if (visited.has(current)) continue;
      visited.add(current);

      const node = this.#nodes.get(current);
      if (node) {
        nodes.push(node);
        maxDepth = Math.max(maxDepth, node.depth);
        for (const childId of node.children) {
          if (!visited.has(childId)) queue.push(childId);
        }
      }
    }

    const allDone = nodes.every((n) =>
      n.state === 'completed' || n.state === 'failed' || n.state === 'interrupted'
    );
    const anyInterrupted = nodes.some((n) => n.state === 'interrupted');

    return {
      rootId,
      nodes,
      depth: maxDepth,
      trustTier: rootNode.trustTier,
      state: allDone ? (anyInterrupted ? 'interrupted' : 'completed') : 'active',
      createdAt: rootNode.createdAt,
    };
  }

  getNode(taskId) {
    return this.#nodes.get(taskId) || null;
  }

  getActiveTrees() {
    const trees = [];
    for (const rootId of this.#roots) {
      const tree = this.getTree(rootId);
      if (tree && tree.state === 'active') trees.push(tree);
    }
    return trees;
  }

  getAllTrees() {
    const trees = [];
    for (const rootId of this.#roots) {
      const tree = this.getTree(rootId);
      if (tree) trees.push(tree);
    }
    return trees;
  }

  getChildren(taskId) {
    const node = this.#nodes.get(taskId);
    if (!node) return [];
    return node.children.map((cid) => this.#nodes.get(cid)).filter(Boolean);
  }

  getAncestry(taskId) {
    const chain = [];
    let current = this.#nodes.get(taskId);
    while (current) {
      chain.unshift(current);
      current = current.parentId ? this.#nodes.get(current.parentId) : undefined;
    }
    return chain;
  }

  getTrustTier(taskId) {
    const node = this.#nodes.get(taskId);
    return node ? node.trustTier : 'public';
  }

  isInTree(taskId) {
    return this.#nodes.has(taskId);
  }

  getStats() {
    let activeNodes = 0;
    let maxDepthSeen = 0;

    for (const node of this.#nodes.values()) {
      if (node.state === 'running' || node.state === 'delegating' || node.state === 'collecting') {
        activeNodes++;
      }
      maxDepthSeen = Math.max(maxDepthSeen, node.depth);
    }

    return {
      totalNodes: this.#nodes.size,
      activeNodes,
      activeTrees: this.getActiveTrees().length,
      maxDepthSeen,
      config: { ...this.#config },
    };
  }

  /* -- Cleanup -- */

  cleanup(maxAgeMs = 30 * 60 * 1000) {
    const now = Date.now();
    let removed = 0;

    for (const rootId of [...this.#roots]) {
      const tree = this.getTree(rootId);
      if (!tree) continue;

      if (tree.state !== 'active') {
        const oldestCompletion = Math.max(...tree.nodes.map((n) => n.completedAt || n.createdAt));
        if (now - oldestCompletion > maxAgeMs) {
          for (const node of tree.nodes) {
            this.#nodes.delete(node.taskId);
            removed++;
          }
          this.#roots.delete(rootId);
        }
      }
    }

    return removed;
  }

  /* -- Private Helpers -- */

  #findRoot(taskId) {
    let current = this.#nodes.get(taskId);
    while (current?.parentId) {
      const parent = this.#nodes.get(current.parentId);
      if (!parent) break;
      current = parent;
    }
    return current?.taskId || taskId;
  }

  #summarizeContext(parentNode, additionalContext) {
    const parts = [];

    const ancestry = this.getAncestry(parentNode.taskId);
    if (ancestry.length > 1) {
      parts.push(
        'Task chain: ' +
        ancestry.map((n) => `${n.agentType}("${n.description.slice(0, 40)}")`).join(' -> ')
      );
    }

    parts.push(`Parent task: ${parentNode.description.slice(0, 200)}`);
    parts.push(`Trust level: ${parentNode.trustTier}`);
    parts.push(`Delegation depth: ${parentNode.depth + 1}`);

    const siblings = parentNode.children
      .map((cid) => this.#nodes.get(cid))
      .filter((n) => n && n.state === 'running');
    if (siblings.length > 0) {
      parts.push(
        'Sibling agents: ' +
        siblings.map((s) => `${s.agentType}("${s.description.slice(0, 30)}")`).join(', ')
      );
    }

    if (additionalContext) {
      parts.push(`Parent context: ${additionalContext.slice(0, 500)}`);
    }

    return parts.join('\n');
  }

  #checkTreeCompletion(rootId) {
    const tree = this.getTree(rootId);
    if (!tree) return;

    if (tree.state !== 'active') {
      this.#emitUpdate({ type: 'tree-completed', tree, rootId });
    }
  }
}
