/**
 * OpenRouter provider -- OpenAI-compatible API giving access to 200+ models.
 *
 * Pure fetch(), SSE streaming, OpenAI tool-call format.
 *
 * Ported from nexus-os/src/main/providers/openrouter-provider.ts
 */

const API_BASE = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'anthropic/claude-sonnet-4';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

export class OpenRouterProvider {
  name = 'openrouter';

  #apiKey = null;
  #defaultModel = DEFAULT_MODEL;
  #siteUrl = '';
  #siteName = 'Agent Friday';

  /**
   * @param {{ apiKey?: string, defaultModel?: string, siteUrl?: string, siteName?: string }} opts
   */
  constructor(opts = {}) {
    if (opts.apiKey) this.#apiKey = opts.apiKey;
    if (opts.defaultModel) this.#defaultModel = opts.defaultModel;
    if (opts.siteUrl) this.#siteUrl = opts.siteUrl;
    if (opts.siteName) this.#siteName = opts.siteName;
  }

  setApiKey(key) {
    this.#apiKey = key || null;
  }

  setDefaultModel(model) {
    this.#defaultModel = model || DEFAULT_MODEL;
  }

  isAvailable() {
    return !!this.#apiKey;
  }

  // ── Completions ───────────────────────────────────────────────────

  async complete(request) {
    this.#requireKey();
    return this.#withRetry(async () => {
      const model = request.model || this.#defaultModel;
      const start = Date.now();

      const body = this.#buildBody(request, model, false);

      const res = await fetch(`${API_BASE}/chat/completions`, {
        method: 'POST',
        headers: this.#headers(),
        body: JSON.stringify(body),
        signal: request.signal || AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`[OpenRouterProvider] API error (${res.status}): ${text}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return this.#parseResponse(data, model, Date.now() - start);
    }, 'complete');
  }

  async *stream(request) {
    this.#requireKey();
    const model = request.model || this.#defaultModel;
    const start = Date.now();

    const body = this.#buildBody(request, model, true);

    const res = await fetch(`${API_BASE}/chat/completions`, {
      method: 'POST',
      headers: this.#headers(),
      body: JSON.stringify(body),
      signal: request.signal || undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[OpenRouterProvider] Streaming API error (${res.status}): ${text}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';
    const toolCalls = [];
    // Accumulate partial tool calls by index
    const toolCallAccum = new Map();
    let resolvedModel = model;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (!payload || payload === '[DONE]') continue;

          let event;
          try {
            event = JSON.parse(payload);
          } catch {
            continue;
          }

          if (event.model) resolvedModel = event.model;

          const delta = event.choices?.[0]?.delta;
          if (!delta) continue;

          // Text content
          if (delta.content) {
            fullText += delta.content;
            yield { text: delta.content, done: false };
          }

          // Tool calls (OpenAI streaming format: delta.tool_calls array)
          if (delta.tool_calls) {
            for (const dtc of delta.tool_calls) {
              const idx = dtc.index ?? 0;
              if (!toolCallAccum.has(idx)) {
                toolCallAccum.set(idx, {
                  id: dtc.id || '',
                  name: dtc.function?.name || '',
                  args: '',
                });
              }
              const accum = toolCallAccum.get(idx);
              if (dtc.id) accum.id = dtc.id;
              if (dtc.function?.name) accum.name = dtc.function.name;
              if (dtc.function?.arguments) accum.args += dtc.function.arguments;
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    // Finalize tool calls
    for (const [, accum] of toolCallAccum) {
      let parsedArgs;
      try {
        parsedArgs = JSON.parse(accum.args);
      } catch {
        parsedArgs = accum.args;
      }
      toolCalls.push({
        id: accum.id,
        type: 'tool_use',
        name: accum.name,
        input: parsedArgs,
      });
    }

    yield {
      done: true,
      fullResponse: {
        content: fullText,
        toolCalls,
        usage: { inputTokens: 0, outputTokens: 0 },
        model: resolvedModel,
        provider: 'openrouter',
        stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
        latencyMs: Date.now() - start,
      },
    };
  }

  // ── Model listing ─────────────────────────────────────────────────

  async listModels() {
    try {
      const res = await fetch(`${API_BASE}/models`, {
        headers: this.#headers(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return (data.data || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
      }));
    } catch {
      return [];
    }
  }

  // ── Private ───────────────────────────────────────────────────────

  #headers() {
    const h = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.#apiKey}`,
    };
    if (this.#siteUrl) h['HTTP-Referer'] = this.#siteUrl;
    if (this.#siteName) h['X-Title'] = this.#siteName;
    return h;
  }

  #buildBody(request, model, stream) {
    const messages = this.#formatMessages(request);
    const body = {
      model,
      messages,
      stream,
      max_tokens: request.maxTokens || (stream ? 4096 : 1024),
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools?.length) body.tools = this.#formatTools(request.tools);
    if (request.responseFormat) body.response_format = request.responseFormat;
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
          tool_call_id: msg.tool_call_id,
          content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
        });
        continue;
      }
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        out.push({
          role: 'assistant',
          content: typeof msg.content === 'string' ? msg.content : null,
          tool_calls: msg.tool_calls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: typeof tc.input === 'string' ? tc.input : JSON.stringify(tc.input),
            },
          })),
        });
        continue;
      }
      // Regular messages
      if (typeof msg.content === 'string') {
        out.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const parts = msg.content.map((p) => {
          if (p.type === 'text') return { type: 'text', text: p.text };
          if (p.type === 'image' && p.source) {
            return {
              type: 'image_url',
              image_url: { url: `data:${p.source.media_type};base64,${p.source.data}` },
            };
          }
          if (p.type === 'image_url' || p.image_url) return p;
          return { type: 'text', text: JSON.stringify(p) };
        });
        out.push({ role: msg.role, content: parts });
      } else {
        out.push({ role: msg.role, content: msg.content });
      }
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

  #parseResponse(data, model, latencyMs) {
    const choice = data.choices?.[0];
    if (!choice) {
      return {
        content: '',
        toolCalls: [],
        usage: { inputTokens: 0, outputTokens: 0 },
        model,
        provider: 'openrouter',
        stopReason: 'end_turn',
        latencyMs,
      };
    }

    const content = choice.message?.content || '';
    const toolCalls = (choice.message?.tool_calls || []).map((tc) => {
      let parsedArgs;
      try {
        parsedArgs = JSON.parse(tc.function.arguments);
      } catch {
        parsedArgs = tc.function.arguments;
      }
      return {
        id: tc.id,
        type: 'tool_use',
        name: tc.function.name,
        input: parsedArgs,
      };
    });

    let stopReason = choice.finish_reason || 'end_turn';
    if (stopReason === 'stop') stopReason = 'end_turn';
    else if (stopReason === 'tool_calls') stopReason = 'tool_use';

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.usage?.prompt_tokens || 0,
        outputTokens: data.usage?.completion_tokens || 0,
      },
      model: data.model || model,
      provider: 'openrouter',
      stopReason,
      latencyMs,
    };
  }

  #requireKey() {
    if (!this.#apiKey) {
      throw new Error('OPENROUTER_API_KEY not configured. Set it in vault api-keys.');
    }
  }

  async #withRetry(fn, label) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (attempt === MAX_RETRIES || !this.#isRetryable(err)) throw err;
        const delay = BASE_DELAY_MS * 2 ** attempt + Math.random() * 500;
        process.stderr.write('[friday:openrouter] ' + label + ' attempt ' + (attempt + 1) + ' failed, retrying in ' + Math.round(delay) + 'ms\n');
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
      return s === 429 || s === 500 || s === 502 || s === 503;
    }
    return false;
  }
}
