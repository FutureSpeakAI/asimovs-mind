/**
 * Unified LLM Client -- single entry point for all completions and streaming.
 *
 * Delegates to registered providers (Ollama, Anthropic, OpenRouter).
 * Handles fallback chains: if the selected provider fails, automatically
 * retries with the next available provider (unless an explicit provider
 * was requested, to avoid accidental data leakage to cloud).
 *
 * Ported from nexus-os/src/main/llm-client.ts
 * Stripped: Privacy Shield (will be a separate subsystem), CloudGate,
 *           confidence assessor, local-first routing wrapper.
 */

export class LLMClient {
  #providers = new Map();
  #defaultProvider = 'anthropic';

  // ── Provider management ───────────────────────────────────────────

  registerProvider(provider) {
    this.#providers.set(provider.name, provider);
    process.stderr.write(`[LLMClient] Registered provider: ${provider.name}\n`);
  }

  setDefaultProvider(name) {
    this.#defaultProvider = name;
  }

  getDefaultProvider() {
    return this.#defaultProvider;
  }

  getProvider(name) {
    return this.#providers.get(name);
  }

  isProviderAvailable(name) {
    const p = this.#providers.get(name);
    return !!p && p.isAvailable();
  }

  /** Return all registered providers with their availability status. */
  getStatus() {
    const result = [];
    for (const [name, provider] of this.#providers) {
      result.push({
        name,
        available: provider.isAvailable(),
        isDefault: name === this.#defaultProvider,
      });
    }
    return result;
  }

  // ── Completions ───────────────────────────────────────────────────

  /**
   * Send a completion request, with automatic fallback.
   *
   * @param {object} request -- { messages, systemPrompt?, model?, maxTokens?, temperature?, tools?, toolChoice?, signal?, taskHint?, responseFormat? }
   * @param {string} [providerName] -- explicit provider name (skips fallback on failure when set)
   * @returns {Promise<object>} LLMResponse
   */
  async complete(request, providerName) {
    const provider = this.#resolveProvider(providerName);
    try {
      return await provider.complete(request);
    } catch (err) {
      // If explicit provider was requested, do NOT fall back — prevents accidental
      // data leakage to cloud when caller intended local-only processing
      if (providerName) throw err;

      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write('[friday:llm] Provider \'' + provider.name + '\' failed: ' + errMsg + ' -- trying fallbacks\n');

      for (const [, fallback] of this.#providers) {
        if (fallback.name === provider.name) continue;
        if (!fallback.isAvailable()) continue;
        try {
          process.stderr.write('[friday:llm] Retrying with fallback \'' + fallback.name + '\'\n');
          return await fallback.complete(request);
        } catch {
          continue;
        }
      }
      throw err;
    }
  }

  /**
   * Stream a completion request, with automatic fallback.
   * When an explicit provider is requested and fails, does NOT
   * fall back (prevents accidental data leakage to cloud).
   */
  async *stream(request, providerName) {
    const provider = this.#resolveProvider(providerName);

    try {
      for await (const chunk of provider.stream(request)) {
        yield chunk;
      }
      return;
    } catch (err) {
      // If explicit provider requested, don't fall back
      if (providerName) throw err;

      const errMsg = err instanceof Error ? err.message : String(err);
      process.stderr.write('[friday:llm] Streaming from \'' + provider.name + '\' failed: ' + errMsg + ' -- trying fallbacks\n');
    }

    // Try fallbacks
    for (const [, fallback] of this.#providers) {
      if (fallback.name === provider.name) continue;
      if (!fallback.isAvailable()) continue;
      try {
        process.stderr.write('[friday:llm] Retrying stream with fallback \'' + fallback.name + '\'\n');
        for await (const chunk of fallback.stream(request)) {
          yield chunk;
        }
        return;
      } catch {
        continue;
      }
    }

    throw new Error('[LLMClient] All providers failed for streaming request.');
  }

  /**
   * Simple text completion convenience wrapper.
   */
  async text(prompt, options = {}) {
    const response = await this.complete(
      {
        messages: [{ role: 'user', content: prompt }],
        systemPrompt: options.systemPrompt,
        model: options.model,
        maxTokens: options.maxTokens ?? 1024,
        temperature: options.temperature,
        taskHint: options.taskHint,
        signal: options.signal,
      },
      options.provider,
    );
    return response.content;
  }

  // ── Private ───────────────────────────────────────────────────────

  #resolveProvider(explicit) {
    const name = explicit || this.#defaultProvider;
    const provider = this.#providers.get(name);

    if (!provider) {
      for (const [, p] of this.#providers) {
        if (p.isAvailable()) {
          process.stderr.write('[friday:llm] Provider \'' + name + '\' not found, falling back to \'' + p.name + '\'\n');
          return p;
        }
      }
      throw new Error(
        `[LLMClient] No provider available. Requested: '${name}'. ` +
        `Registered: [${[...this.#providers.keys()].join(', ')}]`,
      );
    }

    if (!provider.isAvailable()) {
      for (const [, p] of this.#providers) {
        if (p.isAvailable() && p.name !== name) {
          process.stderr.write('[friday:llm] Provider \'' + name + '\' unavailable, falling back to \'' + p.name + '\'\n');
          return p;
        }
      }
      throw new Error(`[LLMClient] Provider '${name}' is not available and no fallback found.`);
    }

    return provider;
  }
}
