/**
 * Ollama provider -- talks to Ollama's native /api/* endpoints.
 *
 * Uses NDJSON streaming, native tool calling format, and health-check
 * caching. No SDK dependency; pure fetch().
 *
 * Ported from nexus-os/src/main/providers/ollama-provider.ts
 */

import { randomUUID } from 'crypto';

const DEFAULT_ENDPOINT = 'http://localhost:11434';
const DEFAULT_MODEL = 'llama3.2';
const HEALTH_CACHE_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

export class OllamaProvider {
  name = 'ollama';

  #healthCache = null; // { healthy, timestamp }
  #endpoint = DEFAULT_ENDPOINT;

  /**
   * @param {{ endpoint?: string }} opts
   */
  constructor(opts = {}) {
    if (opts.endpoint) this.#endpoint = opts.endpoint;
  }

  // ── Availability ──────────────────────────────────────────────────

  isAvailable() {
    if (
      this.#healthCache &&
      Date.now() - this.#healthCache.timestamp < HEALTH_CACHE_MS
    ) {
      return this.#healthCache.healthy;
    }
    return false;
  }

  async checkHealth() {
    if (
      this.#healthCache &&
      Date.now() - this.#healthCache.timestamp < HEALTH_CACHE_MS
    ) {
      return this.#healthCache.healthy;
    }
    const healthy = await this.#performHealthCheck();
    this.#healthCache = { healthy, timestamp: Date.now() };
    return healthy;
  }

  // ── Completions ───────────────────────────────────────────────────

  async complete(request) {
    return this.#withRetry(async () => {
      const model = request.model || DEFAULT_MODEL;
      const start = Date.now();
      const url = `${this.#endpoint}/api/chat`;
      const body = this.#buildBody(request, model, false);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal || AbortSignal.timeout(60_000),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(
          `[OllamaProvider] API error (${res.status}): ${text}`,
        );
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return this.#parseResponse(data, model, Date.now() - start);
    }, 'complete');
  }

  async *stream(request) {
    const model = request.model || DEFAULT_MODEL;
    const start = Date.now();
    const url = `${this.#endpoint}/api/chat`;
    const body = this.#buildBody(request, model, true);

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: request.signal || undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[OllamaProvider] API error (${res.status}): ${text}`);
    }

    if (!res.body) {
      throw new Error('[OllamaProvider] No response body for streaming');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    let resolvedModel = model;
    let promptTokens = 0;
    let completionTokens = 0;
    const toolCalls = [];
    const seenToolIds = new Set();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let chunk;
          try {
            chunk = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (chunk.model) resolvedModel = chunk.model;

          if (chunk.done) {
            promptTokens = chunk.prompt_eval_count || 0;
            completionTokens = chunk.eval_count || 0;
            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                const converted = this.#convertToolCall(tc);
                if (!seenToolIds.has(converted.id)) {
                  seenToolIds.add(converted.id);
                  toolCalls.push(converted);
                  yield { toolCall: converted, done: false };
                }
              }
            }
          } else if (chunk.message?.content) {
            fullText += chunk.message.content;
            yield { text: chunk.message.content, done: false };
          }

          if (!chunk.done && chunk.message?.tool_calls) {
            for (const tc of chunk.message.tool_calls) {
              const converted = this.#convertToolCall(tc);
              if (!seenToolIds.has(converted.id)) {
                seenToolIds.add(converted.id);
                toolCalls.push(converted);
                yield { toolCall: converted, done: false };
              }
            }
          }
        }
      }
    } catch (err) {
      if (err?.name === 'AbortError') {
        yield {
          done: true,
          fullResponse: {
            content: fullText,
            toolCalls,
            usage: { inputTokens: promptTokens, outputTokens: completionTokens },
            model: resolvedModel,
            provider: 'ollama',
            stopReason: 'interrupted',
            latencyMs: Date.now() - start,
          },
        };
        return;
      }
      throw err;
    }

    yield {
      done: true,
      fullResponse: {
        content: fullText,
        toolCalls,
        usage: { inputTokens: promptTokens, outputTokens: completionTokens },
        model: resolvedModel,
        provider: 'ollama',
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
        latencyMs: Date.now() - start,
      },
    };
  }

  // ── Model listing ─────────────────────────────────────────────────

  async listModels() {
    try {
      const res = await fetch(`${this.#endpoint}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!Array.isArray(data.models)) return [];
      return data.models.map((m) => {
        const paramSize = m.details?.parameter_size
          ? ` (${m.details.parameter_size})`
          : '';
        return { id: m.name, name: `${m.name}${paramSize}` };
      });
    } catch {
      return [];
    }
  }

  // ── Private: retry ────────────────────────────────────────────────

  async #withRetry(fn, label) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === MAX_RETRIES || !this.#isRetryable(err)) throw err;
        const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
        console.warn(
          `[OllamaProvider] ${label} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  #isRetryable(err) {
    if (err instanceof Error) {
      if (
        err.message.includes('ECONNREFUSED') ||
        err.message.includes('ETIMEDOUT') ||
        err.message.includes('ENOTFOUND') ||
        err.message.includes('fetch failed')
      )
        return true;
    }
    if (err && typeof err === 'object' && 'status' in err) {
      const s = err.status;
      return s === 500 || s === 502 || s === 503;
    }
    return false;
  }

  // ── Private: request building ─────────────────────────────────────

  #buildBody(request, model, stream) {
    const messages = this.#formatMessages(request);
    const body = { model, messages, stream };
    const options = {};
    if (request.temperature !== undefined) options.temperature = request.temperature;
    if (request.maxTokens) options.num_predict = request.maxTokens;
    if (Object.keys(options).length) body.options = options;
    if (request.tools?.length) body.tools = this.#formatTools(request.tools);
    return body;
  }

  #formatMessages(request) {
    const out = [];
    if (request.systemPrompt) {
      out.push({ role: 'system', content: request.systemPrompt });
    }
    for (const msg of request.messages) {
      if (msg.role === 'system') {
        out.push({ role: 'system', content: typeof msg.content === 'string' ? msg.content : '' });
        continue;
      }
      if (msg.role === 'tool') {
        out.push({
          role: 'tool',
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
        continue;
      }
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        out.push({
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : '',
          tool_calls: msg.tool_calls.map((tc) => ({
            function: {
              name: tc.name,
              arguments: typeof tc.input === 'object' && tc.input !== null ? tc.input : {},
            },
          })),
        });
        continue;
      }
      // Regular message -- flatten content parts to text
      let content;
      if (typeof msg.content === 'string') {
        content = msg.content;
      } else if (Array.isArray(msg.content)) {
        content = msg.content
          .filter((p) => p.type === 'text')
          .map((p) => p.text || '')
          .join('');
      } else {
        content = msg.content ? String(msg.content) : '';
      }
      out.push({ role: msg.role, content });
    }
    return out;
  }

  #formatTools(tools) {
    return tools.map((t) => {
      if (t.function) {
        return {
          type: 'function',
          function: {
            name: t.function.name,
            description: t.function.description || '',
            parameters: t.function.parameters || {},
          },
        };
      }
      return {
        type: 'function',
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.input_schema || {},
        },
      };
    });
  }

  // ── Private: response parsing ─────────────────────────────────────

  #parseResponse(data, requestedModel, latencyMs) {
    const content = data.message?.content || '';
    const toolCalls = (data.message?.tool_calls || []).map((tc) =>
      this.#convertToolCall(tc),
    );
    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.prompt_eval_count || 0,
        outputTokens: data.eval_count || 0,
      },
      model: data.model || requestedModel,
      provider: 'ollama',
      stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
      latencyMs,
    };
  }

  #convertToolCall(tc) {
    return {
      id: `call_${randomUUID()}`,
      type: 'tool_use',
      name: tc.function.name,
      input: tc.function.arguments,
    };
  }

  async #performHealthCheck() {
    try {
      const res = await fetch(`${this.#endpoint}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
      });
      return res.ok;
    } catch {
      return false;
    }
  }
}
