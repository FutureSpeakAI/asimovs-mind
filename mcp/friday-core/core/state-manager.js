/**
 * State Manager — Namespaced vault key access for subsystems
 *
 * Each subsystem gets a key prefix (e.g., "memory:short-term")
 * so subsystems cannot accidentally collide on vault keys.
 *
 * The separator is ":" rather than "/" because vault key validation
 * rejects path separators (/ and \) but explicitly allows colons.
 *
 * Root-level keys (no prefix) remain accessible for backward
 * compatibility with existing hooks and skills.
 */

export class StateManager {
  #vault;

  constructor(vault) {
    this.#vault = vault;
  }

  /** Create a namespaced accessor for a subsystem */
  namespace(subsystemName) {
    const prefix = `${subsystemName}:`;
    const vault = this.#vault;

    return {
      async read(key) {
        return vault.read(`${prefix}${key}`);
      },

      async write(key, data) {
        return vault.write(`${prefix}${key}`, data);
      },

      async append(key, entry) {
        return vault.append(`${prefix}${key}`, entry);
      },

      async delete(key) {
        return vault.delete(`${prefix}${key}`);
      },

      async list() {
        const result = await vault.listKeys();
        if (!result.success) return result;
        return {
          success: true,
          keys: result.keys
            .filter(k => k.startsWith(prefix))
            .map(k => k.slice(prefix.length))
        };
      }
    };
  }

  /** Direct vault access (for root-level keys, backward compatibility) */
  get vault() {
    return this.#vault;
  }
}
