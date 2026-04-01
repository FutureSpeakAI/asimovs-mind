/**
 * Tool Registry -- catalogs tools by name with metadata, safety levels,
 * and categories. The registry is the catalog; it registers and resolves
 * tools but does NOT execute them. The execution delegate handles that.
 *
 * Ported from nexus-os: tool-registry.ts
 * Stripped of: Electron imports, Gemini types, singleton startup tools.
 * Added: categories, auto-prefixing for connector tools, MCP-style metadata.
 */

// Safety levels determine confirmation requirements
export const SAFETY_LEVELS = {
  read_only: 'read_only',     // No confirmation needed
  write: 'write',             // Requires confirmation
  destructive: 'destructive', // Requires confirmation + audit trail
};

// Tool categories for organization and routing
export const CATEGORIES = {
  code: 'code',
  project: 'project',
  communication: 'communication',
  research: 'research',
  meeting: 'meeting',
  memory: 'memory',
  trust: 'trust',
  system: 'system',
  automation: 'automation',
  task: 'task',
};

export class ToolRegistry {
  /** @type {Map<string, { definition: object, handler: function }>} */
  #tools = new Map();

  /** @type {Map<string, string>} tool name -> source (e.g. 'builtin', 'connector:git-devops') */
  #sources = new Map();

  /**
   * Register a tool with its definition and execution handler.
   * @param {object} definition - Tool definition with name, description, params, safety_level, category
   * @param {function} handler - Async function (input) => string
   * @param {string} [source='builtin'] - Where this tool came from
   */
  register(definition, handler, source = 'builtin') {
    if (!definition.name) {
      throw new Error('Tool definition must have a name');
    }
    if (this.#tools.has(definition.name)) {
      throw new Error(
        `Tool "${definition.name}" is already registered. Use a unique name.`
      );
    }
    if (typeof handler !== 'function') {
      throw new Error(`Tool "${definition.name}" handler must be a function`);
    }

    // Ensure defaults
    const def = {
      safety_level: SAFETY_LEVELS.read_only,
      category: CATEGORIES.system,
      params: {},
      ...definition,
    };

    this.#tools.set(def.name, { definition: def, handler });
    this.#sources.set(def.name, source);
  }

  /**
   * Register tools from a connector with auto-prefixing.
   * @param {string} connectorName - Connector ID for prefixing
   * @param {Array<{name: string, description: string, params: object, safety_level?: string, category?: string}>} tools
   * @param {function} executeFn - (toolName, args) => Promise<{result?: string, error?: string}>
   */
  registerFromConnector(connectorName, tools, executeFn) {
    for (const tool of tools) {
      const prefixedName = `${connectorName}_${tool.name}`;
      const definition = {
        ...tool,
        name: prefixedName,
        original_name: tool.name,
        connector: connectorName,
      };

      this.register(
        definition,
        async (input) => {
          const result = await executeFn(tool.name, input);
          if (result.error) throw new Error(result.error);
          return result.result || '(no output)';
        },
        `connector:${connectorName}`
      );
    }
  }

  /**
   * Get all registered tool definitions, optionally filtered.
   * @param {{ safety_level?: string, category?: string, source?: string }} [filter]
   * @returns {object[]}
   */
  getDefinitions(filter) {
    let all = Array.from(this.#tools.values()).map((t) => t.definition);

    if (filter?.safety_level) {
      all = all.filter((d) => d.safety_level === filter.safety_level);
    }
    if (filter?.category) {
      all = all.filter((d) => d.category === filter.category);
    }
    if (filter?.source) {
      all = all.filter((d) => this.#sources.get(d.name) === filter.source);
    }

    return all;
  }

  /**
   * Resolve a tool name to its handler.
   * @param {string} toolName
   * @returns {function}
   */
  resolve(toolName) {
    const entry = this.#tools.get(toolName);
    if (!entry) {
      const registered = Array.from(this.#tools.keys()).join(', ') || '(none)';
      throw new Error(
        `Unknown tool "${toolName}". Registered tools: ${registered}`
      );
    }
    return entry.handler;
  }

  /**
   * Get a tool definition by name.
   * @param {string} toolName
   * @returns {object|null}
   */
  getDefinition(toolName) {
    const entry = this.#tools.get(toolName);
    return entry ? entry.definition : null;
  }

  /**
   * Check if a tool is registered.
   * @param {string} toolName
   * @returns {boolean}
   */
  has(toolName) {
    return this.#tools.has(toolName);
  }

  /**
   * Get tool count.
   * @returns {number}
   */
  get size() {
    return this.#tools.size;
  }

  /**
   * Get all tool names.
   * @returns {string[]}
   */
  get names() {
    return Array.from(this.#tools.keys());
  }

  /**
   * Get a summary grouped by category.
   * @returns {Record<string, string[]>}
   */
  getByCategory() {
    const result = {};
    for (const [name, { definition }] of this.#tools) {
      const cat = definition.category || 'uncategorized';
      if (!result[cat]) result[cat] = [];
      result[cat].push(name);
    }
    return result;
  }

  /**
   * Get source for a tool.
   * @param {string} toolName
   * @returns {string|undefined}
   */
  getSource(toolName) {
    return this.#sources.get(toolName);
  }
}
