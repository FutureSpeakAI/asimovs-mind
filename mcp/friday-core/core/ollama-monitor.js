/**
 * OllamaMonitor — Local Ollama health and model discovery
 *
 * Extracted from vault.js (ARCH-003 / ARCH-008): OllamaMonitor has no
 * relationship to vault/encryption and belongs as a standalone module.
 *
 * A single shared instance is created in index.js, added to the deps
 * object, and consumed by both VaultSubsystem (vault_status tool) and
 * OllamaSubsystem (ollama_status tool).
 */

// --- TUNABLE ---
const HEALTH_CHECK_TIMEOUT_MS = 5000;

export class OllamaMonitor {
  #healthy = false;
  #models = [];
  #loadedModels = [];
  #lastCheck = null;
  #baseUrl;

  constructor(baseUrl = 'http://localhost:11434') {
    this.#baseUrl = baseUrl;
  }

  async checkHealth() {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
      const resp = await fetch(`${this.#baseUrl}/api/tags`, { signal: controller.signal });
      clearTimeout(timeout);
      if (!resp.ok) { this.#healthy = false; return this.status; }
      const data = await resp.json();
      this.#models = (data.models || []).map(m => ({
        name: m.name, model: m.model, size: m.size, digest: m.digest
      }));
      this.#healthy = true;
      this.#lastCheck = new Date().toISOString();
    } catch {
      this.#healthy = false;
      this.#models = [];
    }

    // Check loaded models
    if (this.#healthy) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);
        const resp = await fetch(`${this.#baseUrl}/api/ps`, { signal: controller.signal });
        clearTimeout(timeout);
        if (resp.ok) {
          const data = await resp.json();
          this.#loadedModels = (data.models || []).map(m => ({
            name: m.name, model: m.model, size: m.size,
            sizeVram: m.size_vram, expiresAt: m.expires_at
          }));
        }
      } catch {
        this.#loadedModels = [];
      }
    }

    return this.status;
  }

  get status() {
    return {
      healthy: this.#healthy,
      models: this.#models,
      loadedModels: this.#loadedModels,
      lastCheck: this.#lastCheck,
      baseUrl: this.#baseUrl
    };
  }
}
