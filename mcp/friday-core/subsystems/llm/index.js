/**
 * LLM Subsystem -- MCP-facing entry point for the intelligence layer.
 *
 * Wires up providers (Ollama, Anthropic, OpenRouter), the intelligence
 * router, and the unified LLM client. Registers MCP tools for completions,
 * streaming, status, model listing, routing, and provider selection.
 *
 * Ported from nexus-os LLM subsystem (intelligence-router + llm-client +
 * three providers). Electron/IPC stripped; replaced with MCP tool surface.
 */

import { Subsystem } from '../../core/subsystem.js';
import { LLMClient } from './client.js';
import { IntelligenceRouter } from './router.js';
import { OllamaProvider } from './providers/ollama.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenRouterProvider } from './providers/openrouter.js';

export class LLMSubsystem extends Subsystem {
  constructor(deps) {
    super('llm', deps);
    this.client = new LLMClient();
    this.router = new IntelligenceRouter({
      state: this.state,
    });
    this.ollama = new OllamaProvider();
    this.anthropic = new AnthropicProvider();
    this.openrouter = new OpenRouterProvider();
  }

  // ── MCP Tool Registration ─────────────────────────────────────────

  registerTools(server) {
    // ── llm_complete ────────────────────────────────────────────────
    server.setRequestHandler?.('tools/call', async (request) => {
      // This is a fallback; prefer the pattern below
    });

    // Use the addTool pattern if server supports it, otherwise register inline
    this.#registerTool(server, {
      name: 'llm_complete',
      description: 'Send a completion request to an LLM. Returns the full response text, model used, token usage, and latency.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            description: 'Array of chat messages. Each: { role: "system"|"user"|"assistant", content: string }',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string', enum: ['system', 'user', 'assistant', 'tool'] },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          model: { type: 'string', description: 'Specific model ID (e.g. "claude-sonnet-4-20250514"). Optional.' },
          provider: { type: 'string', description: 'Provider name: "anthropic", "ollama", or "openrouter". Optional.' },
          systemPrompt: { type: 'string', description: 'System prompt (separate from messages). Optional.' },
          maxTokens: { type: 'number', description: 'Max output tokens. Default: 1024.' },
          temperature: { type: 'number', description: 'Sampling temperature 0-2. Optional.' },
        },
        required: ['messages'],
      },
      handler: async (params) => {
        const response = await this.client.complete({
          messages: params.messages,
          model: params.model,
          systemPrompt: params.systemPrompt,
          maxTokens: params.maxTokens || 1024,
          temperature: params.temperature,
        }, params.provider);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                content: response.content,
                model: response.model,
                provider: response.provider,
                usage: response.usage,
                stopReason: response.stopReason,
                latencyMs: response.latencyMs,
              }, null, 2),
            },
          ],
        };
      },
    });

    // ── llm_stream ──────────────────────────────────────────────────
    this.#registerTool(server, {
      name: 'llm_stream',
      description: 'Stream a completion request. Returns accumulated text from the full stream.',
      inputSchema: {
        type: 'object',
        properties: {
          messages: {
            type: 'array',
            description: 'Chat messages array',
            items: {
              type: 'object',
              properties: {
                role: { type: 'string' },
                content: { type: 'string' },
              },
              required: ['role', 'content'],
            },
          },
          model: { type: 'string', description: 'Model ID. Optional.' },
          provider: { type: 'string', description: 'Provider name. Optional.' },
          systemPrompt: { type: 'string', description: 'System prompt. Optional.' },
          maxTokens: { type: 'number', description: 'Max output tokens. Default: 4096.' },
          temperature: { type: 'number', description: 'Temperature. Optional.' },
        },
        required: ['messages'],
      },
      handler: async (params) => {
        let fullText = '';
        let finalResponse = null;

        for await (const chunk of this.client.stream({
          messages: params.messages,
          model: params.model,
          systemPrompt: params.systemPrompt,
          maxTokens: params.maxTokens || 4096,
          temperature: params.temperature,
        }, params.provider)) {
          if (chunk.text) fullText += chunk.text;
          if (chunk.done && chunk.fullResponse) finalResponse = chunk.fullResponse;
        }

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                content: finalResponse?.content || fullText,
                model: finalResponse?.model || 'unknown',
                provider: finalResponse?.provider || 'unknown',
                usage: finalResponse?.usage || { inputTokens: 0, outputTokens: 0 },
                stopReason: finalResponse?.stopReason || 'end_turn',
                latencyMs: finalResponse?.latencyMs || 0,
              }, null, 2),
            },
          ],
        };
      },
    });

    // ── llm_status ──────────────────────────────────────────────────
    this.#registerTool(server, {
      name: 'llm_status',
      description: 'Show all registered LLM providers, their availability, and the default provider.',
      inputSchema: { type: 'object', properties: {} },
      handler: async () => {
        const providers = this.client.getStatus();
        const stats = this.router.getStats();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                providers,
                defaultProvider: this.client.getDefaultProvider(),
                routerStats: {
                  totalDecisions: stats.totalDecisions,
                  monthlySpent: `$${stats.monthlySpentUsd.toFixed(4)}`,
                  monthlyBudget: stats.monthlyBudgetUsd > 0
                    ? `$${stats.monthlyBudgetUsd.toFixed(2)}`
                    : 'unlimited',
                  avgLatencyMs: Math.round(stats.avgLatencyMs),
                },
              }, null, 2),
            },
          ],
        };
      },
    });

    // ── llm_model_list ──────────────────────────────────────────────
    this.#registerTool(server, {
      name: 'llm_model_list',
      description: 'List all models across all providers with capabilities and availability.',
      inputSchema: {
        type: 'object',
        properties: {
          availableOnly: { type: 'boolean', description: 'Only show available models. Default: false.' },
        },
      },
      handler: async (params) => {
        const all = params.availableOnly
          ? this.router.getAvailableModels()
          : this.router.getModelRegistry();

        const models = all.map((m) => ({
          modelId: m.modelId,
          name: m.name,
          provider: m.provider,
          available: m.available,
          contextWindow: m.contextWindow,
          supportsToolUse: m.supportsToolUse,
          supportsVision: m.supportsVision,
          costPer1MInput: `$${m.inputCostPerMillion}`,
          costPer1MOutput: `$${m.outputCostPerMillion}`,
          strengths: m.strengths,
        }));

        return {
          content: [{ type: 'text', text: JSON.stringify(models, null, 2) }],
        };
      },
    });

    // ── llm_route ───────────────────────────────────────────────────
    this.#registerTool(server, {
      name: 'llm_route',
      description: 'Given a task description, return the recommended model and the reasoning behind the selection.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Natural-language description of the task.' },
        },
        required: ['task'],
      },
      handler: async (params) => {
        const profile = this.router.profileTask(params.task);
        const decision = this.router.selectModel(profile);
        const model = this.router.getModel(decision.selectedModelId);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                recommendedModel: decision.selectedModelId,
                modelName: model?.name || decision.selectedModelId,
                provider: model?.provider || 'unknown',
                taskProfile: {
                  category: profile.category,
                  complexity: profile.complexity,
                  latency: profile.latency,
                  estimatedInputTokens: profile.estimatedInputTokens,
                },
                reason: decision.reason,
                budgetConstrained: decision.budgetConstrained,
                isFallback: decision.isFallback,
                topScores: decision.scores.slice(0, 5).map((s) => ({
                  modelId: s.modelId,
                  score: s.totalScore.toFixed(3),
                  breakdown: s.breakdown,
                })),
              }, null, 2),
            },
          ],
        };
      },
    });

    // ── llm_set_provider ────────────────────────────────────────────
    this.#registerTool(server, {
      name: 'llm_set_provider',
      description: 'Set the default LLM provider. Valid: "anthropic", "ollama", "openrouter".',
      inputSchema: {
        type: 'object',
        properties: {
          provider: { type: 'string', description: 'Provider name to set as default.' },
        },
        required: ['provider'],
      },
      handler: async (params) => {
        const valid = ['anthropic', 'ollama', 'openrouter'];
        if (!valid.includes(params.provider)) {
          return {
            content: [
              { type: 'text', text: `Invalid provider "${params.provider}". Valid: ${valid.join(', ')}` },
            ],
            isError: true,
          };
        }
        this.client.setDefaultProvider(params.provider);
        return {
          content: [
            { type: 'text', text: `Default provider set to "${params.provider}".` },
          ],
        };
      },
    });
  }

  // ── Events ────────────────────────────────────────────────────────

  registerEvents() {
    if (!this.eventBus) return;

    // Listen for API key updates from vault
    this.eventBus.on?.('vault:key-updated', (data) => {
      if (data?.key === 'api-keys') {
        this.#loadApiKeys(data.value).catch((err) =>
          this.log.warn?.('Failed to reload API keys:', err?.message),
        );
      }
    });

    // Listen for provider config changes
    this.eventBus.on?.('config:provider-changed', (data) => {
      if (data?.provider) {
        this.client.setDefaultProvider(data.provider);
      }
    });
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async start() {
    // Initialize router (loads saved state)
    await this.router.initialize();

    // Load API keys from vault
    await this.#loadApiKeys();

    // Register providers with the client
    this.client.registerProvider(this.ollama);
    this.client.registerProvider(this.anthropic);
    this.client.registerProvider(this.openrouter);

    // Check Ollama health and discover models
    try {
      const healthy = await this.ollama.checkHealth();
      if (healthy) {
        const models = await this.ollama.listModels();
        if (models.length > 0) {
          this.router.registerOllamaModels(models);
          this.log.info?.(`Ollama online: ${models.length} models available`);
        }
      } else {
        this.log.info?.('Ollama not reachable -- local models disabled');
      }
    } catch (err) {
      this.log.warn?.('Ollama discovery failed:', err?.message);
    }

    // Set default provider based on what's available
    if (this.anthropic.isAvailable()) {
      this.client.setDefaultProvider('anthropic');
    } else if (this.openrouter.isAvailable()) {
      this.client.setDefaultProvider('openrouter');
    } else if (this.ollama.isAvailable()) {
      this.client.setDefaultProvider('ollama');
    }

    this._started = true;
    this.log.info?.(`LLM subsystem started. Default provider: ${this.client.getDefaultProvider()}`);
  }

  async stop() {
    this.router.stop();
    this._started = false;
  }

  // ── Private ───────────────────────────────────────────────────────

  async #loadApiKeys(keys) {
    // Try to read from vault if no keys passed
    if (!keys && this.vault) {
      try {
        keys = await this.vault.read('api-keys');
      } catch {
        // No keys yet -- that's fine
      }
    }

    if (!keys) return;

    if (keys.anthropic) this.anthropic.setApiKey(keys.anthropic);
    if (keys.openrouter) this.openrouter.setApiKey(keys.openrouter);

    // OpenRouter model preference
    if (keys.openrouterModel) this.openrouter.setDefaultModel(keys.openrouterModel);

    // Ollama endpoint override
    if (keys.ollamaEndpoint) {
      this.ollama = new OllamaProvider({ endpoint: keys.ollamaEndpoint });
      this.client.registerProvider(this.ollama);
    }
  }

  /**
   * Register a single MCP tool on the server.
   * Adapts to whichever registration pattern the server supports.
   */
  #registerTool(server, { name, description, inputSchema, handler }) {
    if (typeof server.tool === 'function') {
      // MCP SDK style: server.tool(name, description, schema, handler)
      server.tool(name, description, inputSchema, async (params) => {
        return handler(params);
      });
    } else if (typeof server.addTool === 'function') {
      server.addTool({ name, description, inputSchema }, handler);
    } else if (this._toolRegistry) {
      // Fallback: store tools for bulk registration
      this._toolRegistry.set(name, { name, description, inputSchema, handler });
    } else {
      // Last resort: store and let the registry pick them up
      if (!this._pendingTools) this._pendingTools = [];
      this._pendingTools.push({ name, description, inputSchema, handler });
    }
  }
}
