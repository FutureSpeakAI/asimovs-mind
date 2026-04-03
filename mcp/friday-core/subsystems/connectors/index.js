/**
 * Connectors Subsystem -- Dynamic software connector discovery and dispatch
 *
 * Exposes 4 MCP tools instead of 100+:
 *   connector_detect   -- Scan for available software on this machine
 *   connector_list     -- List detected connectors and their tools
 *   connector_execute  -- Execute a connector tool (dynamic dispatch)
 *   connector_status   -- Health check across all connectors
 *
 * Each connector module exports: { name, description, detect(), getTools(), execute() }
 * The subsystem loads all connectors, runs detection in parallel, and routes
 * tool calls through connector_execute at runtime.
 *
 * Ported from nexus-os: connectors/registry.ts + 9 connector modules.
 * Stripped of: Electron require(), TypeScript, Gemini function declarations.
 * Added: ESM imports, vault-based API key access, MCP tool interface.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { ConnectorRegistry } from './registry.js';

// Import all connector modules
import * as gitDevops from './git-devops.js';
import * as codingKit from './coding-kit.js';
import * as terminal from './terminal.js';
import * as systemMgmt from './system-mgmt.js';
import * as perplexity from './perplexity.js';
import * as firecrawl from './firecrawl.js';
import * as comms from './comms.js';
import * as powershell from './powershell.js';

/** All connector module definitions */
const CONNECTOR_MODULES = [
  { id: 'powershell',         label: 'PowerShell Bridge',       category: 'foundation',     description: powershell.description,  module: powershell },
  { id: 'terminal-sessions',  label: 'Terminal Sessions',       category: 'foundation',     description: terminal.description,    module: terminal },
  { id: 'git-devops',         label: 'Git & DevOps',            category: 'devops',         description: gitDevops.description,   module: gitDevops },
  { id: 'coding-kit',         label: 'Coding Kit',              category: 'devops',         description: codingKit.description,   module: codingKit },
  { id: 'system-management',  label: 'System Management',       category: 'system',         description: systemMgmt.description,  module: systemMgmt },
  { id: 'perplexity',         label: 'Perplexity AI Search',    category: 'intelligence',   description: perplexity.description,  module: perplexity },
  { id: 'firecrawl',          label: 'Firecrawl Web Intel',     category: 'intelligence',   description: firecrawl.description,   module: firecrawl },
  { id: 'comms-hub',          label: 'Communication Hub',       category: 'communication',  description: comms.description,       module: comms },
];

export class ConnectorSubsystem extends Subsystem {
  #registry;

  constructor(deps) {
    super('connectors', deps);
    this.#registry = new ConnectorRegistry({ log: this.log, vault: this.vault });
  }

  /** Public access to registry for other subsystems */
  get registry() { return this.#registry; }

  async start() {
    // Initialize all connectors (detection runs in parallel)
    await this.#registry.initialize(CONNECTOR_MODULES);

    await super.start();

    const status = this.#registry.getStatus();
    this.log.info(
      `Connectors subsystem started: ${status.availableConnectors}/${status.totalConnectors} connectors, ${status.totalTools} tools`
    );
  }

  registerTools(server) {
    // connector_detect -- scan for available software
    server.tool(
      'connector_detect',
      'Scan this machine for available software and update connector availability. ' +
      'Checks for git, docker, node, python, powershell, and cloud CLIs.',
      {
        connector_id: z.string().optional()
          .describe('Re-detect a specific connector by ID. If omitted, reports current detection state.'),
      },
      async (args) => {
        if (args.connector_id) {
          // Re-detect a specific connector
          const mod = CONNECTOR_MODULES.find((m) => m.id === args.connector_id);
          if (!mod) {
            return { content: [{ type: 'text', text: `Unknown connector: ${args.connector_id}` }], isError: true };
          }
          const available = await this.#registry.redetect(args.connector_id, mod.module);
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({ connector: args.connector_id, available, redetected: true }, null, 2),
            }],
          };
        }

        // Return current detection state
        const status = this.#registry.getStatus();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(status, null, 2),
          }],
        };
      }
    );

    // connector_list -- list detected connectors and their tools
    server.tool(
      'connector_list',
      'List all detected connectors and the tools they provide. ' +
      'Only tools for installed/available software are shown.',
      {
        available_only: z.boolean().default(true)
          .describe('Only show available connectors (default true)'),
        category: z.string().optional()
          .describe('Filter by category: foundation, devops, system, intelligence, communication'),
      },
      async (args) => {
        let connectors = args.available_only
          ? this.#registry.getAvailableConnectors()
          : this.#registry.getAllConnectors();

        if (args.category) {
          connectors = connectors.filter((c) => c.category === args.category);
        }

        const result = connectors.map((c) => ({
          id: c.id,
          label: c.label,
          category: c.category,
          description: c.description,
          available: c.available,
          tools: c.tools.map((t) => ({
            name: t.name,
            description: t.description,
            safety_level: t.safety_level || 'read_only',
          })),
        }));

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              connectors: result.length,
              totalTools: result.reduce((sum, c) => sum + c.tools.length, 0),
              data: result,
            }, null, 2),
          }],
        };
      }
    );

    // connector_execute -- execute a connector tool
    server.tool(
      'connector_execute',
      'Execute a tool from a specific connector. This is the primary way to invoke ' +
      'connector capabilities (git, docker, powershell, search, etc.). ' +
      'Use connector_list to discover available tools.',
      {
        connector: z.string().max(100).describe('Connector ID (e.g. "git-devops", "powershell", "perplexity")'),
        tool: z.string().max(100).describe('Tool name within the connector (e.g. "git_status", "powershell_execute")'),
        args: z.record(z.string(), z.any()).default({}).describe('Arguments for the tool'),
      },
      async (toolArgs) => {
        // Verify connector exists and is available
        const connector = this.#registry.getConnector(toolArgs.connector);
        if (!connector) {
          return {
            content: [{ type: 'text', text: `Unknown connector: ${toolArgs.connector}. Use connector_list to see available connectors.` }],
            isError: true,
          };
        }
        if (!connector.available) {
          return {
            content: [{ type: 'text', text: `Connector "${connector.label}" is not available on this system.` }],
            isError: true,
          };
        }

        // Verify tool exists in this connector
        const toolDef = connector.tools.find((t) => t.name === toolArgs.tool);
        if (!toolDef) {
          const available = connector.tools.map((t) => t.name).join(', ');
          return {
            content: [{ type: 'text', text: `Unknown tool "${toolArgs.tool}" in connector "${toolArgs.connector}". Available: ${available}` }],
            isError: true,
          };
        }

        // Execute via the connector registry
        const result = await this.#registry.executeTool(toolArgs.tool, toolArgs.args);

        if (result.error) {
          return {
            content: [{ type: 'text', text: result.error }],
            isError: true,
          };
        }

        return {
          content: [{ type: 'text', text: result.result || '(no output)' }],
        };
      }
    );

    // connector_status -- health check across all connectors
    server.tool(
      'connector_status',
      'Get health status of all connectors: which are available, tool counts, categories.',
      {},
      async () => {
        const status = this.#registry.getStatus();

        // Add summary
        const summary = {
          ...status,
          categories: {},
        };

        for (const conn of status.connectors) {
          if (!summary.categories[conn.category]) {
            summary.categories[conn.category] = { available: 0, total: 0, tools: 0 };
          }
          summary.categories[conn.category].total++;
          if (conn.available) {
            summary.categories[conn.category].available++;
            summary.categories[conn.category].tools += conn.toolCount;
          }
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify(summary, null, 2),
          }],
        };
      }
    );
  }
}
