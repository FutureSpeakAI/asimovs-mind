/**
 * Connector Registry -- Central hub for all software connectors.
 *
 * Architecture: Hub-and-spoke model where each connector module:
 *   1. detect()    -- checks if the app/tool is installed
 *   2. getTools()  -- declares tool definitions
 *   3. execute()   -- routes tool calls to native APIs
 *
 * The registry auto-discovers installed apps on startup, collects tools
 * from available connectors, and routes tool calls at runtime.
 *
 * Only tools for INSTALLED software are active, keeping the surface lean.
 *
 * Ported from nexus-os: connectors/registry.ts
 * Stripped of: Electron require(), Gemini function declarations, category UI routing.
 * Added: ESM dynamic import, getTools() pattern, vault API key access.
 */

export class ConnectorRegistry {
  /** @type {Map<string, import('./types.js').Connector>} */
  #connectors = new Map();

  /** @type {Map<string, string>} toolName -> connectorId */
  #toolToConnector = new Map();

  #initialized = false;
  #log;
  #vault;

  /**
   * @param {{ log?: object, vault?: object }} [deps]
   */
  constructor(deps = {}) {
    this.#log = deps.log || { info: () => {}, warn: () => {}, error: () => {} };
    this.#vault = deps.vault || null;
  }

  /**
   * Initialize: load all connector modules, run detection, build routing table.
   * @param {Array<{ id: string, label: string, category: string, description: string, module: object }>} modules
   */
  async initialize(modules) {
    if (this.#initialized) return;

    this.#log.info('[ConnectorRegistry] Initializing -- scanning for available software...');
    const startTime = Date.now();

    // Run detection in parallel
    const detections = await Promise.allSettled(
      modules.map(async (mod) => {
        try {
          // Pass vault to modules that need API keys
          const available = await mod.module.detect(this.#vault);
          return { ...mod, available };
        } catch (err) {
          this.#log.warn(
            `[ConnectorRegistry] Detection failed for ${mod.id}: ${err instanceof Error ? err.message : 'Unknown error'}`
          );
          return { ...mod, available: false };
        }
      })
    );

    // Register all connectors
    for (const result of detections) {
      if (result.status !== 'fulfilled') continue;

      const conn = result.value;
      let tools = [];

      if (conn.available) {
        try {
          tools = conn.module.getTools();
        } catch (err) {
          this.#log.warn(
            `[ConnectorRegistry] getTools() failed for ${conn.id}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const connector = {
        id: conn.id,
        label: conn.label,
        category: conn.category,
        description: conn.description,
        available: conn.available,
        tools,
        execute: (toolName, args) => conn.module.execute(toolName, args, this.#vault),
      };

      this.#connectors.set(conn.id, connector);

      if (conn.available && tools.length > 0) {
        for (const tool of tools) {
          this.#toolToConnector.set(tool.name, conn.id);
        }
        this.#log.info(`[ConnectorRegistry] + ${conn.label} -- ${tools.length} tools`);
      } else if (!conn.available) {
        this.#log.info(`[ConnectorRegistry] - ${conn.label} -- not detected`);
      }
    }

    this.#initialized = true;
    const elapsed = Date.now() - startTime;
    const available = this.getAvailableConnectors();
    const totalTools = available.reduce((sum, c) => sum + c.tools.length, 0);
    this.#log.info(
      `[ConnectorRegistry] Ready -- ${available.length} connectors, ${totalTools} tools (${elapsed}ms)`
    );
  }

  /**
   * Get all tool declarations for available connectors.
   * @returns {object[]}
   */
  getAllTools() {
    const tools = [];
    for (const conn of this.#connectors.values()) {
      if (conn.available) {
        tools.push(...conn.tools);
      }
    }
    return tools;
  }

  /**
   * Execute a tool call by name. Routes to the correct connector.
   * @param {string} toolName
   * @param {Record<string, unknown>} args
   * @returns {Promise<{result?: string, error?: string}>}
   */
  async executeTool(toolName, args) {
    const connectorId = this.#toolToConnector.get(toolName);
    if (!connectorId) {
      return { error: `Unknown connector tool: ${toolName}` };
    }

    const connector = this.#connectors.get(connectorId);
    if (!connector) {
      return { error: `Connector ${connectorId} not found` };
    }
    if (!connector.available) {
      return { error: `${connector.label} is not available on this system` };
    }

    try {
      return await connector.execute(toolName, args);
    } catch (err) {
      return {
        error: `${connector.label} error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  /**
   * Check if a tool name belongs to the connector system.
   * @param {string} toolName
   * @returns {boolean}
   */
  isConnectorTool(toolName) {
    return this.#toolToConnector.has(toolName);
  }

  /**
   * Get the connector ID for a tool.
   * @param {string} toolName
   * @returns {string|undefined}
   */
  getConnectorForTool(toolName) {
    return this.#toolToConnector.get(toolName);
  }

  /**
   * Get all available (detected) connectors.
   * @returns {object[]}
   */
  getAvailableConnectors() {
    return Array.from(this.#connectors.values()).filter((c) => c.available);
  }

  /**
   * Get all connectors (including unavailable).
   * @returns {object[]}
   */
  getAllConnectors() {
    return Array.from(this.#connectors.values());
  }

  /**
   * Get a specific connector by ID.
   * @param {string} id
   * @returns {object|undefined}
   */
  getConnector(id) {
    return this.#connectors.get(id);
  }

  /**
   * Get a status summary.
   */
  getStatus() {
    const all = this.getAllConnectors();
    const available = this.getAvailableConnectors();
    return {
      initialized: this.#initialized,
      totalConnectors: all.length,
      availableConnectors: available.length,
      totalTools: available.reduce((sum, c) => sum + c.tools.length, 0),
      connectors: all.map((c) => ({
        id: c.id,
        label: c.label,
        category: c.category,
        available: c.available,
        toolCount: c.tools.length,
      })),
    };
  }

  /**
   * Re-detect a specific connector (e.g. after software install).
   * @param {string} connectorId
   * @param {object} module -- The connector module
   * @returns {Promise<boolean>}
   */
  async redetect(connectorId, module) {
    const conn = this.#connectors.get(connectorId);
    if (!conn) return false;

    try {
      const available = await module.detect(this.#vault);
      conn.available = available;

      if (available) {
        conn.tools = module.getTools();
        for (const tool of conn.tools) {
          this.#toolToConnector.set(tool.name, connectorId);
        }
      } else {
        // Remove tool mappings
        for (const tool of conn.tools) {
          this.#toolToConnector.delete(tool.name);
        }
        conn.tools = [];
      }

      return available;
    } catch {
      return false;
    }
  }
}
