/**
 * Tools Subsystem -- Tool registry + execution delegate with safety checks
 *
 * MCP tools (4):
 *   tool_register   -- Register a new tool dynamically
 *   tool_execute     -- Execute a registered tool by name
 *   tool_list        -- List all registered tools with metadata
 *   tool_safety_check -- Check the safety level of a tool before execution
 *
 * Ported from nexus-os: tool-registry.ts, execution-delegate.ts
 * Stripped of: Electron, Gemini types, safety-pipeline.ts (simplified inline).
 * Added: MCP tool interface, category/safety metadata, audit trail.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { ToolRegistry, SAFETY_LEVELS } from './registry.js';
import { ExecutionDelegate } from './delegate.js';

export { ToolRegistry, SAFETY_LEVELS, CATEGORIES } from './registry.js';
export { ExecutionDelegate } from './delegate.js';

export class ToolsSubsystem extends Subsystem {
  #registry;
  #delegate;

  constructor(deps) {
    super('tools', deps);
    this.#registry = new ToolRegistry();
    this.#delegate = new ExecutionDelegate(this.#registry, {
      eventBus: this.eventBus,
      log: this.log,
    });
  }

  /** Public access to registry for other subsystems */
  get registry() { return this.#registry; }

  /** Public access to delegate for other subsystems */
  get delegate() { return this.#delegate; }

  /**
   * Called by wiring.js on connector:detected events.
   * Connector tools are dispatched dynamically through connector_execute,
   * so no re-registration is needed — this logs the event for observability.
   */
  refreshConnectorTools(connectorId) {
    this.log.info(`Connector detected: ${connectorId}`);
  }

  async start() {
    await super.start();
    this.log.info(`Tools subsystem started (${this.#registry.size} tools registered)`);
  }

  registerTools(server) {
    // tool_register -- dynamically register a new tool
    server.tool(
      'tool_register',
      'Register a new tool with metadata. Tools registered this way are available via tool_execute.',
      {
        name: z.string().max(100).describe('Unique tool name'),
        description: z.string().max(5_000).describe('What the tool does'),
        safety_level: z.enum(['read_only', 'write', 'destructive']).default('read_only')
          .describe('Safety level: read_only (no confirm), write (confirm), destructive (confirm + audit)'),
        category: z.enum([
          'code', 'project', 'communication', 'research',
          'meeting', 'memory', 'trust', 'system', 'automation', 'task'
        ]).default('system').describe('Tool category'),
        params: z.record(z.any()).optional().describe('Parameter schema (JSON object)'),
      },
      async (args) => {
        try {
          // Dynamic registration -- handler is a no-op placeholder.
          // Real tools are registered programmatically via the registry API.
          this.#registry.register({
            name: args.name,
            description: args.description,
            safety_level: args.safety_level,
            category: args.category,
            params: args.params || {},
          }, async () => {
            return `Tool "${args.name}" is registered but has no implementation. Register a handler via the Tools API.`;
          }, 'dynamic');

          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                registered: true,
                name: args.name,
                safety_level: args.safety_level,
                category: args.category,
                total_tools: this.#registry.size,
              }, null, 2),
            }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Registration failed: ${err.message}` }],
            isError: true,
          };
        }
      }
    );

    // tool_execute -- execute a registered tool
    server.tool(
      'tool_execute',
      'Execute a registered tool by name. Checks safety level before execution.',
      {
        name: z.string().max(100).describe('Tool name to execute'),
        args: z.record(z.any()).optional().describe('Arguments to pass to the tool'),
        skip_safety: z.boolean().default(false)
          .describe('Skip safety checks (use with caution)'),
        decision_id: z.string().optional()
          .describe('Decision ID from a previous pending result, to confirm execution'),
      },
      async (toolArgs) => {
        try {
          let result;

          if (toolArgs.decision_id) {
            // Confirming a pending decision
            result = await this.#delegate.executeAfterConfirmation(
              toolArgs.decision_id,
              true // approved
            );
          } else {
            result = await this.#delegate.execute(
              toolArgs.name,
              toolArgs.args || {},
              { skipSafety: toolArgs.skip_safety }
            );
          }

          if (result.error) {
            return {
              content: [{ type: 'text', text: result.error }],
              isError: !result.pending,
            };
          }

          return {
            content: [{ type: 'text', text: result.result || '(no output)' }],
          };
        } catch (err) {
          return {
            content: [{ type: 'text', text: `Execution failed: ${err.message}` }],
            isError: true,
          };
        }
      }
    );

    // tool_list -- list all registered tools
    server.tool(
      'tool_list',
      'List all registered tools with metadata. Optionally filter by category or safety level.',
      {
        category: z.string().optional().describe('Filter by category'),
        safety_level: z.string().optional().describe('Filter by safety level'),
        source: z.string().optional().describe('Filter by source (builtin, connector:*, dynamic)'),
      },
      async (args) => {
        const definitions = this.#registry.getDefinitions({
          category: args.category,
          safety_level: args.safety_level,
          source: args.source,
        });

        const tools = definitions.map((d) => ({
          name: d.name,
          description: d.description,
          category: d.category,
          safety_level: d.safety_level,
          source: this.#registry.getSource(d.name),
          ...(d.connector && { connector: d.connector }),
        }));

        const byCategory = this.#registry.getByCategory();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              total: tools.length,
              categories: byCategory,
              tools,
            }, null, 2),
          }],
        };
      }
    );

    // tool_safety_check -- inspect safety level and audit trail for a tool
    server.tool(
      'tool_safety_check',
      'Check the safety level, category, and recent audit trail for a tool before execution.',
      {
        name: z.string().max(100).describe('Tool name to check'),
        include_audit: z.boolean().default(false).describe('Include recent audit entries for this tool'),
      },
      async (args) => {
        const definition = this.#registry.getDefinition(args.name);

        if (!definition) {
          return {
            content: [{ type: 'text', text: `Tool "${args.name}" is not registered.` }],
            isError: true,
          };
        }

        const result = {
          name: definition.name,
          description: definition.description,
          safety_level: definition.safety_level,
          category: definition.category,
          source: this.#registry.getSource(definition.name),
          requires_confirmation: definition.safety_level !== SAFETY_LEVELS.read_only,
          requires_audit: definition.safety_level === SAFETY_LEVELS.destructive,
          pending_decisions: this.#delegate.getPendingDecisions()
            .filter((d) => d.tool === args.name),
        };

        if (args.include_audit) {
          result.recent_audit = this.#delegate.getAuditLog({
            tool: args.name,
            limit: 10,
          });
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      }
    );
  }
}
