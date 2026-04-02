/**
 * Execution Delegate -- wires together the tool execution pipeline:
 *   Tool call -> safety check -> resolve handler -> execute -> audit
 *
 * Three outcomes:
 *   - approved  -> execute handler, return result
 *   - pending   -> return pending with decision ID for confirmation
 *   - denied    -> return error with reason
 *
 * The delegate never throws. The caller always gets a result object.
 *
 * Ported from nexus-os: execution-delegate.ts
 * Stripped of: Electron IPC, Gemini types. Added: event bus integration,
 * audit trail logging, safety level checks without external safety pipeline.
 */

import { SAFETY_LEVELS } from './registry.js';

export class ExecutionDelegate {
  #registry;
  #eventBus;
  #log;
  #auditLog = [];
  #pendingDecisions = new Map();
  #decisionCounter = 0;

  /** Maximum audit log entries before trimming */
  static MAX_AUDIT_ENTRIES = 1000;

  /**
   * @param {import('./registry.js').ToolRegistry} registry
   * @param {object} [deps]
   * @param {object} [deps.eventBus]
   * @param {object} [deps.log]
   */
  constructor(registry, deps = {}) {
    this.#registry = registry;
    this.#eventBus = deps.eventBus;
    this.#log = deps.log || { info: () => {}, warn: () => {}, error: () => {} };
  }

  /**
   * Execute a tool call through the safety pipeline.
   * @param {string} toolName
   * @param {object} args
   * @param {{ skipSafety?: boolean }} [options]
   * @returns {Promise<{ result?: string, error?: string, pending?: boolean, decision_id?: string }>}
   */
  async execute(toolName, args, options = {}) {
    const startTime = Date.now();

    // 1. Resolve the tool definition for safety metadata
    const definition = this.#registry.getDefinition(toolName);
    if (!definition) {
      return { error: `Unknown tool: ${toolName}` };
    }

    // 2. Safety check based on safety_level
    if (!options.skipSafety) {
      const safetyResult = this.#checkSafety(definition, args);

      if (safetyResult.status === 'denied') {
        this.#audit(toolName, args, 'denied', safetyResult.reason, Date.now() - startTime);
        return { error: `Tool execution denied: ${safetyResult.reason}` };
      }

      if (safetyResult.status === 'pending') {
        const decisionId = this.#createPendingDecision(toolName, args, definition);
        this.#audit(toolName, args, 'pending', null, Date.now() - startTime);
        return {
          pending: true,
          decision_id: decisionId,
          error: `Tool execution requires confirmation (decision: ${decisionId}). ` +
                 `Safety level: ${definition.safety_level}`,
        };
      }
    }

    // 3. Approved -- resolve and execute
    return this.#runHandler(toolName, args, startTime);
  }

  /**
   * Execute a tool after user confirmation.
   * @param {string} decisionId
   * @param {boolean} approved
   * @returns {Promise<{ result?: string, error?: string }>}
   */
  async executeAfterConfirmation(decisionId, approved) {
    const decision = this.#pendingDecisions.get(decisionId);
    if (!decision) {
      return { error: `Decision "${decisionId}" not found or expired` };
    }

    this.#pendingDecisions.delete(decisionId);

    if (!approved) {
      this.#audit(decision.toolName, decision.args, 'denied', 'User denied', 0);
      return { error: `Tool execution denied by user` };
    }

    const startTime = Date.now();
    return this.#runHandler(decision.toolName, decision.args, startTime);
  }

  /**
   * Check safety of a tool call based on its safety_level.
   * @param {object} definition
   * @param {object} args
   * @returns {{ status: 'approved'|'pending'|'denied', reason?: string }}
   */
  #checkSafety(definition, _args) {
    const level = definition.safety_level || SAFETY_LEVELS.read_only;

    switch (level) {
      case SAFETY_LEVELS.read_only:
        return { status: 'approved' };

      case SAFETY_LEVELS.write:
        // Write operations require confirmation
        return {
          status: 'pending',
          reason: `Write operation: ${definition.name}`,
        };

      case SAFETY_LEVELS.destructive:
        // Destructive operations require confirmation + audit
        return {
          status: 'pending',
          reason: `Destructive operation: ${definition.name} -- requires explicit confirmation`,
        };

      default:
        return { status: 'approved' };
    }
  }

  /**
   * Run the tool handler and capture result/error.
   */
  async #runHandler(toolName, args, startTime) {
    try {
      const handler = this.#registry.resolve(toolName);
      const output = await handler(args);

      const elapsed = Date.now() - startTime;
      this.#audit(toolName, args, 'success', null, elapsed);

      // Emit execution event
      if (this.#eventBus) {
        this.#eventBus.publish('tool:executed', {
          tool: toolName,
          elapsed,
          success: true,
        });
      }

      return { result: typeof output === 'string' ? output : JSON.stringify(output) };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const message = err instanceof Error ? err.message : String(err);

      this.#audit(toolName, args, 'error', message, elapsed);

      if (this.#eventBus) {
        this.#eventBus.publish('tool:executed', {
          tool: toolName,
          elapsed,
          success: false,
          error: message,
        });
      }

      return { error: `Tool execution error: ${message}` };
    }
  }

  /**
   * Create a pending decision entry.
   */
  #createPendingDecision(toolName, args, definition) {
    const id = `decision_${++this.#decisionCounter}_${Date.now()}`;
    this.#pendingDecisions.set(id, {
      toolName,
      args,
      definition,
      createdAt: Date.now(),
    });

    // Auto-expire after 5 minutes
    setTimeout(() => {
      this.#pendingDecisions.delete(id);
    }, 5 * 60 * 1000);

    return id;
  }

  /**
   * Append to the audit trail.
   */
  #audit(toolName, args, status, reason, elapsedMs) {
    const entry = {
      timestamp: new Date().toISOString(),
      tool: toolName,
      status,
      reason: reason || null,
      elapsed_ms: elapsedMs,
      // Redact args for audit (only keys, not values -- to avoid leaking secrets)
      arg_keys: args ? Object.keys(args) : [],
    };

    this.#auditLog.push(entry);

    // Trim if over limit
    if (this.#auditLog.length > ExecutionDelegate.MAX_AUDIT_ENTRIES) {
      this.#auditLog = this.#auditLog.slice(-ExecutionDelegate.MAX_AUDIT_ENTRIES);
    }

    this.#log.info(`[audit] ${status}: ${toolName} (${elapsedMs}ms)`);
  }

  /**
   * Get the audit trail.
   * @param {{ limit?: number, tool?: string, status?: string }} [filter]
   * @returns {object[]}
   */
  getAuditLog(filter = {}) {
    let entries = [...this.#auditLog];

    if (filter.tool) {
      entries = entries.filter((e) => e.tool === filter.tool);
    }
    if (filter.status) {
      entries = entries.filter((e) => e.status === filter.status);
    }

    const limit = filter.limit || 50;
    return entries.slice(-limit);
  }

  /**
   * Get pending decisions.
   * @returns {Array<{id: string, toolName: string, createdAt: number}>}
   */
  getPendingDecisions() {
    const result = [];
    for (const [id, decision] of this.#pendingDecisions) {
      result.push({
        id,
        tool: decision.toolName,
        safety_level: decision.definition.safety_level,
        created_at: new Date(decision.createdAt).toISOString(),
      });
    }
    return result;
  }
}
