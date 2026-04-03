/**
 * Subsystem base class and registry
 *
 * Every Friday subsystem extends Subsystem and implements:
 * - registerTools(server) — register MCP tools
 * - registerEvents() — subscribe to event bus topics
 * - start() / stop() — lifecycle management
 *
 * Startup tiers: subsystems tagged with the same numeric tier value are
 * started in parallel via Promise.all(). Subsystems with no tier tag
 * (tier === undefined) are started sequentially, preserving legacy order.
 */

export class Subsystem {
  /**
   * @param {string} name
   * @param {{ vault, eventBus, stateManager, logger }} deps
   * @param {{ tier?: number }} [opts] — numeric tier for parallel startup grouping
   */
  constructor(name, { vault, eventBus, stateManager, logger }, opts = {}) {
    this.name = name;
    this.vault = vault;
    this.eventBus = eventBus;
    this.state = stateManager ? stateManager.namespace(name) : null;
    this.log = logger ? logger.child(name) : { info: () => {}, warn: () => {}, error: () => {} };
    this._started = false;
    /** @type {number|undefined} */
    this.tier = opts.tier;
  }

  /** Override: register MCP tools on the server */
  registerTools(_server) {}

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

  /**
   * @param {Subsystem} subsystem
   * @param {{ tier?: number }} [opts]
   */
  register(subsystem, opts = {}) {
    if (this.#subsystems.has(subsystem.name)) {
      throw new Error(`Subsystem "${subsystem.name}" already registered`);
    }
    if (typeof opts.tier === 'number') {
      subsystem.tier = opts.tier;
    }
    this.#subsystems.set(subsystem.name, subsystem);
    this.#startOrder.push(subsystem.name);
  }

  // --- TUNABLE ---
  async startAll() {
    // Register all events first (synchronous, order-independent)
    for (const name of this.#startOrder) {
      this.#subsystems.get(name).registerEvents();
    }

    // Group subsystems by tier. Subsystems with an explicit numeric tier are
    // started in parallel within that tier. Subsystems with no tier assigned
    // fall back to sequential startup to preserve any implicit ordering.
    const tiered = new Map();   // tier number -> name[]
    const sequential = [];      // names with no tier

    for (const name of this.#startOrder) {
      const sub = this.#subsystems.get(name);
      if (typeof sub.tier === 'number') {
        if (!tiered.has(sub.tier)) tiered.set(sub.tier, []);
        tiered.get(sub.tier).push(name);
      } else {
        sequential.push(name);
      }
    }

    // On any startup failure, stop the subsystems that already started so we
    // don't leave a partially-initialised system running. Re-throw the original
    // error so main() (and its caller in bootstrap.js) can surface it cleanly.
    try {
      if (tiered.size === 0) {
        // No tiers declared — original sequential behaviour
        for (const name of sequential) {
          await this.#subsystems.get(name).start();
        }
        return;
      }

      // Start sequential (un-tiered) subsystems first, then run tiers in order
      for (const name of sequential) {
        await this.#subsystems.get(name).start();
      }

      const sortedTiers = [...tiered.keys()].sort((a, b) => a - b);
      for (const t of sortedTiers) {
        await Promise.all(
          tiered.get(t).map((name) => this.#subsystems.get(name).start())
        );
      }
    } catch (startErr) {
      // Best-effort cleanup of already-started subsystems (reverse order)
      await this.stopAll().catch(() => {});
      throw startErr;
    }
  }

  registerAllTools(server) {
    for (const [, sub] of this.#subsystems) {
      sub.registerTools(server);
    }
  }

  async stopAll() {
    for (const name of [...this.#startOrder].reverse()) {
      try {
        await this.#subsystems.get(name).stop();
      } catch (err) {
        process.stderr.write(`[friday:registry] ${name}.stop() failed: ${err?.message || err}\n`);
      }
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
