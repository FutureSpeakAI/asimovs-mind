/**
 * Subsystem base class and registry
 *
 * Every Friday subsystem extends Subsystem and implements:
 * - registerTools(server) — register MCP tools
 * - registerEvents() — subscribe to event bus topics
 * - start() / stop() — lifecycle management
 */

export class Subsystem {
  constructor(name, { vault, eventBus, stateManager, logger }) {
    this.name = name;
    this.vault = vault;
    this.eventBus = eventBus;
    this.state = stateManager ? stateManager.namespace(name) : null;
    this.log = logger ? logger.child(name) : { info: () => {}, warn: () => {}, error: () => {} };
    this._started = false;
  }

  /** Override: register MCP tools on the server */
  registerTools(server) {}

  /** Override: subscribe to event bus topics */
  registerEvents() {}

  /** Override: async initialization */
  async start() { this._started = true; }

  /** Override: cleanup */
  async stop() { this._started = false; }

  get started() { return this._started; }
}

export class SubsystemRegistry {
  #subsystems = new Map();
  #startOrder = [];

  register(subsystem) {
    if (this.#subsystems.has(subsystem.name)) {
      throw new Error(`Subsystem "${subsystem.name}" already registered`);
    }
    this.#subsystems.set(subsystem.name, subsystem);
    this.#startOrder.push(subsystem.name);
  }

  async startAll() {
    for (const name of this.#startOrder) {
      const sub = this.#subsystems.get(name);
      sub.registerEvents();
      await sub.start();
    }
  }

  registerAllTools(server) {
    for (const [, sub] of this.#subsystems) {
      sub.registerTools(server);
    }
  }

  async stopAll() {
    for (const name of [...this.#startOrder].reverse()) {
      await this.#subsystems.get(name).stop();
    }
  }

  get(name) { return this.#subsystems.get(name); }

  get names() { return [...this.#subsystems.keys()]; }

  get stats() {
    const result = {};
    for (const [name, sub] of this.#subsystems) {
      result[name] = { started: sub.started };
    }
    return result;
  }
}
