/**
 * Awareness Mesh — Cross-agent coordination layer
 *
 * Provides:
 *   - Cross-tree awareness (agents in different delegation trees know about each other)
 *   - Dependency declarations (agent A depends on agent B's output)
 *   - Mesh-wide broadcasting (share results beyond team/tree boundaries)
 *   - Deadlock detection (circular dependencies flagged via DFS cycle detection)
 *   - Rich awareness context generation
 *
 * Trust tiers are respected: broadcasts carry the sender's trust tier, and
 * agents can only see broadcasts from same or more-restricted tiers.
 *
 * Ported from nexus-os: awareness-mesh.ts. Stripped Electron, contextStream.
 * Pure in-memory coordination with eventBus integration.
 */

const TRUST_TIER_ORDER = {
  local: 0,
  'owner-dm': 1,
  'approved-dm': 2,
  group: 3,
  public: 4,
};

const DEFAULT_CONFIG = {
  maxBroadcasts: 100,
  maxDependencies: 200,
  broadcastRetentionMs: 10 * 60 * 1000,
  dependencyRetentionMs: 5 * 60 * 1000,
};

export class AwarenessMesh {
  #agents = new Map();
  #dependencies = [];
  #broadcasts = [];
  #updateCallbacks = [];
  #config;
  #idCounter = 0;
  #eventBus = null;

  constructor(config) {
    this.#config = { ...DEFAULT_CONFIG, ...config };
  }

  initialize(eventBus) {
    this.#eventBus = eventBus;
  }

  configure(config) {
    this.#config = { ...this.#config, ...config };
  }

  /* -- Agent Registration -- */

  registerAgent(taskId, agentType, description, opts) {
    if (this.#agents.has(taskId)) return;

    const agent = {
      taskId,
      agentType,
      description,
      phase: 'starting',
      progress: 0,
      role: opts?.role || 'solo',
      trustTier: opts?.trustTier || 'local',
      teamId: opts?.teamId,
      treeRoot: opts?.treeRoot,
      parentId: opts?.parentId,
      registeredAt: Date.now(),
      deregisteredAt: undefined,
      result: undefined,
    };

    this.#agents.set(taskId, agent);
    this.#emitEvent({ type: 'agent-registered', taskId, timestamp: Date.now() });
  }

  deregisterAgent(taskId, result) {
    const agent = this.#agents.get(taskId);
    if (!agent) return;

    agent.deregisteredAt = Date.now();
    if (result) agent.result = result;

    this.#resolveDependenciesFor(taskId);
    this.#emitEvent({ type: 'agent-deregistered', taskId, timestamp: Date.now() });

    // Clean up after a delay
    setTimeout(() => {
      this.#agents.delete(taskId);
    }, 30_000);
  }

  updateAgent(taskId, updates) {
    const agent = this.#agents.get(taskId);
    if (!agent) return;

    Object.assign(agent, updates);
    this.#emitEvent({
      type: 'agent-updated',
      taskId,
      timestamp: Date.now(),
      data: updates,
    });
  }

  getAgent(taskId) {
    return this.#agents.get(taskId) || null;
  }

  getActiveAgents() {
    return [...this.#agents.values()].filter((a) => !a.deregisteredAt);
  }

  /* -- Dependencies -- */

  declareDependency(waitingTaskId, dependsOnTaskId, reason) {
    const existing = this.#dependencies.find(
      (d) => d.waitingTaskId === waitingTaskId && d.dependsOnTaskId === dependsOnTaskId && !d.resolved
    );
    if (existing) return existing.id;

    const id = `dep-${String(++this.#idCounter).padStart(4, '0')}`;
    const dep = {
      id,
      waitingTaskId,
      dependsOnTaskId,
      reason,
      resolved: false,
      declaredAt: Date.now(),
      resolvedAt: undefined,
    };

    this.#dependencies.push(dep);
    this.#pruneResolved();

    this.#emitEvent({
      type: 'dependency-declared',
      taskId: waitingTaskId,
      timestamp: Date.now(),
      data: { dependsOn: dependsOnTaskId, reason },
    });

    // Check for deadlocks
    const deadlocks = this.detectDeadlocks();
    if (deadlocks.length > 0) {
      this.#emitEvent({
        type: 'deadlock-detected',
        taskId: waitingTaskId,
        timestamp: Date.now(),
        data: { cycles: deadlocks },
      });
    }

    return id;
  }

  #resolveDependenciesFor(dependsOnTaskId) {
    for (const dep of this.#dependencies) {
      if (dep.dependsOnTaskId === dependsOnTaskId && !dep.resolved) {
        dep.resolved = true;
        dep.resolvedAt = Date.now();

        this.#emitEvent({
          type: 'dependency-resolved',
          taskId: dep.waitingTaskId,
          timestamp: Date.now(),
          data: { dependsOn: dependsOnTaskId },
        });
      }
    }
  }

  getUnresolvedDependencies(taskId) {
    return this.#dependencies.filter((d) => d.waitingTaskId === taskId && !d.resolved);
  }

  getDependents(taskId) {
    return this.#dependencies.filter((d) => d.dependsOnTaskId === taskId && !d.resolved);
  }

  /**
   * Detect circular dependencies (deadlocks) using DFS cycle detection.
   * Returns arrays of task IDs forming cycles.
   */
  detectDeadlocks() {
    const graph = new Map();

    for (const dep of this.#dependencies) {
      if (dep.resolved) continue;
      const edges = graph.get(dep.waitingTaskId) || [];
      edges.push(dep.dependsOnTaskId);
      graph.set(dep.waitingTaskId, edges);
    }

    const cycles = [];
    const visited = new Set();
    const inStack = new Set();
    const path = [];

    const dfs = (node) => {
      if (inStack.has(node)) {
        const cycleStart = path.indexOf(node);
        if (cycleStart >= 0) {
          cycles.push([...path.slice(cycleStart), node]);
        }
        return;
      }
      if (visited.has(node)) return;

      visited.add(node);
      inStack.add(node);
      path.push(node);

      for (const neighbor of graph.get(node) || []) {
        dfs(neighbor);
      }

      path.pop();
      inStack.delete(node);
    };

    for (const node of graph.keys()) {
      if (!visited.has(node)) {
        dfs(node);
      }
    }

    return cycles;
  }

  /* -- Broadcasting -- */

  broadcast(fromTaskId, summary) {
    const agent = this.#agents.get(fromTaskId);
    if (!agent) return;

    const bc = {
      id: `bc-${String(++this.#idCounter).padStart(4, '0')}`,
      fromTaskId,
      agentType: agent.agentType,
      summary: summary.slice(0, 500),
      trustTier: agent.trustTier,
      timestamp: Date.now(),
    };

    this.#broadcasts.push(bc);
    this.#pruneBroadcasts();

    this.#emitEvent({
      type: 'broadcast',
      taskId: fromTaskId,
      timestamp: Date.now(),
      data: { summary: bc.summary },
    });
  }

  getBroadcasts(forTaskId, limit = 20) {
    let visible = this.#broadcasts;

    if (forTaskId) {
      const agent = this.#agents.get(forTaskId);
      if (agent) {
        const myTierOrder = TRUST_TIER_ORDER[agent.trustTier];
        visible = visible.filter((bc) => TRUST_TIER_ORDER[bc.trustTier] <= myTierOrder);
      }
    }

    return visible.slice(-limit);
  }

  /* -- Awareness Context Generation -- */

  getAwarenessContext(taskId) {
    const agent = this.#agents.get(taskId);
    if (!agent) return 'Not registered in awareness mesh.';

    const active = this.getActiveAgents().filter((a) => a.taskId !== taskId);

    if (active.length === 0) {
      return 'No other agents are currently active.';
    }

    const parts = [];

    // Active peers
    const peerSummary = active
      .map((a) => {
        const phase = a.phase || 'working';
        const progress = a.progress > 0 ? ` (${a.progress}%)` : '';
        const team = a.teamId ? ` [Team:${a.teamId.slice(0, 6)}]` : '';
        const tree = a.treeRoot === agent.treeRoot && agent.treeRoot ? ' [same-tree]' : '';
        return `- ${a.agentType} -- ${phase}${progress}${team}${tree}: ${a.description.slice(0, 60)}`;
      })
      .slice(0, 8);

    parts.push(`ACTIVE AGENTS (${active.length}):\n${peerSummary.join('\n')}`);

    // Delegation siblings
    if (agent.parentId) {
      const siblings = active.filter((a) => a.parentId === agent.parentId);
      if (siblings.length > 0) {
        parts.push(
          `SIBLINGS (same parent):\n${siblings
            .map((s) => `- ${s.agentType}: ${s.description.slice(0, 60)}`)
            .join('\n')}`
        );
      }
    }

    // Unresolved dependencies
    const deps = this.getUnresolvedDependencies(taskId);
    if (deps.length > 0) {
      parts.push(
        `WAITING FOR:\n${deps
          .map((d) => {
            const depAgent = this.#agents.get(d.dependsOnTaskId);
            const name = depAgent?.agentType || d.dependsOnTaskId.slice(0, 8);
            return `- ${name}: ${d.reason}`;
          })
          .join('\n')}`
      );
    }

    // Agents waiting on me
    const dependents = this.getDependents(taskId);
    if (dependents.length > 0) {
      parts.push(
        `DEPENDING ON ME:\n${dependents
          .map((d) => {
            const waitAgent = this.#agents.get(d.waitingTaskId);
            const name = waitAgent?.agentType || d.waitingTaskId.slice(0, 8);
            return `- ${name}: ${d.reason}`;
          })
          .join('\n')}`
      );
    }

    // Recent broadcasts (trust-filtered)
    const recentBroadcasts = this.getBroadcasts(taskId, 5);
    if (recentBroadcasts.length > 0) {
      parts.push(
        `RECENT BROADCASTS:\n${recentBroadcasts
          .map((bc) => `- [${bc.agentType}] ${bc.summary.slice(0, 80)}`)
          .join('\n')}`
      );
    }

    return parts.join('\n\n');
  }

  /* -- Snapshot -- */

  getSnapshot() {
    const active = this.getActiveAgents();
    const activeTrees = new Set();
    const activeTeams = new Set();

    for (const agent of active) {
      if (agent.treeRoot) activeTrees.add(agent.treeRoot);
      if (agent.teamId) activeTeams.add(agent.teamId);
    }

    return {
      agents: active,
      dependencies: this.#dependencies.filter((d) => !d.resolved),
      broadcasts: this.#broadcasts.slice(-20),
      activeTrees: [...activeTrees],
      activeTeams: [...activeTeams],
      deadlocks: this.detectDeadlocks(),
      timestamp: Date.now(),
    };
  }

  getStats() {
    return {
      activeAgents: this.getActiveAgents().length,
      totalRegistered: this.#agents.size,
      unresolvedDeps: this.#dependencies.filter((d) => !d.resolved).length,
      broadcasts: this.#broadcasts.length,
      deadlocks: this.detectDeadlocks().length,
    };
  }

  /* -- Event System -- */

  onUpdate(callback) {
    this.#updateCallbacks.push(callback);
    return () => {
      const idx = this.#updateCallbacks.indexOf(callback);
      if (idx >= 0) this.#updateCallbacks.splice(idx, 1);
    };
  }

  #emitEvent(event) {
    for (const cb of this.#updateCallbacks) {
      try { cb(event); } catch { /* swallow */ }
    }
    if (this.#eventBus) {
      this.#eventBus.publish('mesh:event', event);
    }
  }

  /* -- Maintenance -- */

  #pruneBroadcasts() {
    const now = Date.now();
    this.#broadcasts = this.#broadcasts.filter(
      (bc) => now - bc.timestamp < this.#config.broadcastRetentionMs
    );
    if (this.#broadcasts.length > this.#config.maxBroadcasts) {
      this.#broadcasts = this.#broadcasts.slice(-this.#config.maxBroadcasts);
    }
  }

  #pruneResolved() {
    const now = Date.now();
    this.#dependencies = this.#dependencies.filter(
      (d) => !d.resolved || (d.resolvedAt && now - d.resolvedAt < this.#config.dependencyRetentionMs)
    );
    if (this.#dependencies.length > this.#config.maxDependencies) {
      this.#dependencies = this.#dependencies.slice(-this.#config.maxDependencies);
    }
  }

  cleanup() {
    this.#agents.clear();
    this.#dependencies = [];
    this.#broadcasts = [];
    this.#updateCallbacks = [];
    this.#idCounter = 0;
  }
}
