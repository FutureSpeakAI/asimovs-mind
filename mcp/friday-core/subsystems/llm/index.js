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

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { LLMClient } from './client.js';
import { IntelligenceRouter } from './router.js';
import { OllamaProvider } from './providers/ollama.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenRouterProvider } from './providers/openrouter.js';

// SSRF blocklist for ollamaEndpoint vault override — blocks cloud metadata
// and private network endpoints. Localhost is intentionally ALLOWED because
// Ollama typically runs on 127.0.0.1:11434.
const BLOCKED_OLLAMA_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal']);
function isBlockedOllamaHost(hostname) {
  const lower = hostname.toLowerCase();
  if (BLOCKED_OLLAMA_HOSTS.has(lower)) return true;
  if (lower.endsWith('.internal') && lower !== 'metadata.google.internal') return true;
  const parts = lower.split('.');
  if (parts.length === 4) {
    const [a, b] = parts.map(Number);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

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

  // Zod schemas for LLM tools
  static #messageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.string(),
  });

  registerTools(server) {
    // ── llm_complete ────────────────────────────────────────────────
    server.tool(
      'llm_complete',
      'Send a completion request to an LLM. Returns the full response text, model used, token usage, and latency.',
      {
        messages: z.array(LLMSubsystem.#messageSchema).describe('Array of chat messages'),
        model: z.string().optional().describe('Specific model ID (e.g. "claude-sonnet-4-20250514")'),
        provider: z.string().optional().describe('Provider name: "anthropic", "ollama", or "openrouter"'),
        systemPrompt: z.string().optional().describe('System prompt (separate from messages)'),
        maxTokens: z.number().optional().describe('Max output tokens. Default: 1024'),
        temperature: z.number().optional().describe('Sampling temperature 0-2'),
      },
      async ({ messages, model, provider, systemPrompt, maxTokens, temperature }) => {
        const response = await this.client.complete({
          messages, model, systemPrompt,
          maxTokens: maxTokens || 1024,
          temperature,
        }, provider);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content: response.content,
              model: response.model,
              provider: response.provider,
              usage: response.usage,
              stopReason: response.stopReason,
              latencyMs: response.latencyMs,
            }, null, 2),
          }],
        };
      },
    );

    // ── llm_stream ──────────────────────────────────────────────────
    server.tool(
      'llm_stream',
      'Stream a completion request. Returns accumulated text from the full stream.',
      {
        messages: z.array(LLMSubsystem.#messageSchema).describe('Chat messages array'),
        model: z.string().optional().describe('Model ID'),
        provider: z.string().optional().describe('Provider name'),
        systemPrompt: z.string().optional().describe('System prompt'),
        maxTokens: z.number().optional().describe('Max output tokens. Default: 4096'),
        temperature: z.number().optional().describe('Temperature'),
      },
      async ({ messages, model, provider, systemPrompt, maxTokens, temperature }) => {
        let fullText = '';
        let finalResponse = null;

        for await (const chunk of this.client.stream({
          messages, model, systemPrompt,
          maxTokens: maxTokens || 4096,
          temperature,
        }, provider)) {
          if (chunk.text) fullText += chunk.text;
          if (chunk.done && chunk.fullResponse) finalResponse = chunk.fullResponse;
        }

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              content: finalResponse?.content || fullText,
              model: finalResponse?.model || 'unknown',
              provider: finalResponse?.provider || 'unknown',
              usage: finalResponse?.usage || { inputTokens: 0, outputTokens: 0 },
              stopReason: finalResponse?.stopReason || 'end_turn',
              latencyMs: finalResponse?.latencyMs || 0,
            }, null, 2),
          }],
        };
      },
    );

    // ── llm_status ──────────────────────────────────────────────────
    server.tool(
      'llm_status',
      'Show all registered LLM providers, their availability, and the default provider.',
      {},
      async () => {
        const providers = this.client.getStatus();
        const stats = this.router.getStats();
        return {
          content: [{
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
          }],
        };
      },
    );

    // ── llm_model_list ──────────────────────────────────────────────
    server.tool(
      'llm_model_list',
      'List all models across all providers with capabilities and availability.',
      {
        availableOnly: z.boolean().optional().describe('Only show available models. Default: false'),
      },
      async ({ availableOnly }) => {
        const all = availableOnly
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
    );

    // ── llm_route ───────────────────────────────────────────────────
    server.tool(
      'llm_route',
      'Given a task description, return the recommended model and the reasoning behind the selection.',
      {
        task: z.string().describe('Natural-language description of the task'),
      },
      async ({ task }) => {
        const profile = this.router.profileTask(task);
        const decision = this.router.selectModel(profile);
        const model = this.router.getModel(decision.selectedModelId);

        return {
          content: [{
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
          }],
        };
      },
    );

    // ── llm_set_provider ────────────────────────────────────────────
    server.tool(
      'llm_set_provider',
      'Set the default LLM provider. Valid: "anthropic", "ollama", "openrouter".',
      {
        provider: z.string().describe('Provider name to set as default'),
      },
      async ({ provider }) => {
        const valid = ['anthropic', 'ollama', 'openrouter'];
        if (!valid.includes(provider)) {
          return {
            content: [
              { type: 'text', text: `Invalid provider "${provider}". Valid: ${valid.join(', ')}` },
            ],
            isError: true,
          };
        }
        this.client.setDefaultProvider(provider);
        return {
          content: [
            { type: 'text', text: `Default provider set to "${provider}".` },
          ],
        };
      },
    );
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

    // --- TUNABLE: Ollama discovery is fire-and-forget so the 5 s health-check
    // timeout never blocks Tier 2 startup. Models are registered asynchronously;
    // any llm_complete call before discovery finishes uses cloud providers.
    (async () => {
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
    })();

    // Set default provider based on what's available
    if (this.anthropic.isAvailable()) {
      this.client.setDefaultProvider('anthropic');
    } else if (this.openrouter.isAvailable()) {
      this.client.setDefaultProvider('openrouter');
    } else if (this.ollama.isAvailable()) {
      this.client.setDefaultProvider('ollama');
    }

    await super.start();
    this.log.info?.(`LLM subsystem started. Default provider: ${this.client.getDefaultProvider()}`);
  }

  async stop() {
    this.router.stop();
    await super.stop();
  }

  // ── Private ───────────────────────────────────────────────────────

  async #loadApiKeys() {
    let result;
    if (this.vault) {
      try {
        result = await this.vault.read('api-keys');
      } catch {
        // No keys yet -- that's fine
      }
    }

    const keys = result?.success ? result.data : null;
    if (!keys) return;

    if (keys.anthropic) this.anthropic.setApiKey(keys.anthropic);
    if (keys.openrouter) this.openrouter.setApiKey(keys.openrouter);

    // OpenRouter model preference
    if (keys.openrouterModel) this.openrouter.setDefaultModel(keys.openrouterModel);

    // Ollama endpoint override — validate URL to prevent SSRF via corrupted vault
    if (keys.ollamaEndpoint) {
      try {
        const parsed = new URL(keys.ollamaEndpoint);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          process.stderr.write(`[friday:llm] Rejected ollamaEndpoint: invalid protocol ${parsed.protocol}\n`);
        } else if (isBlockedOllamaHost(parsed.hostname)) {
          process.stderr.write(`[friday:llm] Rejected ollamaEndpoint: blocked hostname ${parsed.hostname}\n`);
        } else {
          this.ollama = new OllamaProvider({ endpoint: keys.ollamaEndpoint });
          this.client.registerProvider(this.ollama);
        }
      } catch {
        process.stderr.write(`[friday:llm] Rejected ollamaEndpoint: invalid URL\n`);
      }
    }
  }

}
