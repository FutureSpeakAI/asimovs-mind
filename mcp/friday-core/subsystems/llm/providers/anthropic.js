/**
 * Anthropic provider -- raw fetch() against the Anthropic Messages API.
 *
 * No SDK dependency. Streams via SSE. Handles Anthropic-specific message
 * formatting, tool-use blocks, and content-part images.
 *
 * Ported from nexus-os/src/main/providers/anthropic-provider.ts
 */

const API_BASE = 'https://api.anthropic.com';
const API_VERSION = '2023-06-01';
const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

export class AnthropicProvider {
  name = 'anthropic';

  #apiKey = null;

  /**
   * @param {{ apiKey?: string }} opts
   */
  constructor(opts = {}) {
    if (opts.apiKey) this.#apiKey = opts.apiKey;
  }

  /** Update the API key at runtime (e.g., after vault read). */
  setApiKey(key) {
    this.#apiKey = key || null;
  }

  isAvailable() {
    return !!this.#apiKey;
  }

  // ── Completions ───────────────────────────────────────────────────

  async complete(request) {
    this.#requireKey();
    return this.#withRetry(async () => {
      const model = request.model || DEFAULT_MODEL;
      const start = Date.now();
      const { messages, system } = this.#formatMessages(request);
      const tools = request.tools ? this.#formatTools(request.tools) : undefined;

      const body = {
        model,
        max_tokens: request.maxTokens || 1024,
        messages,
        ...(system ? { system } : {}),
        ...(tools?.length ? { tools } : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      };

      // toolChoice
      if (request.toolChoice === 'auto') {
        body.tool_choice = { type: 'auto' };
      } else if (request.toolChoice && typeof request.toolChoice === 'object') {
        body.tool_choice = { type: 'tool', name: request.toolChoice.name };
      }

      const res = await fetch(`${API_BASE}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.#apiKey,
          'anthropic-version': API_VERSION,
        },
        body: JSON.stringify(body),
        signal: request.signal || AbortSignal.timeout(120_000),
      });

      if (!res.ok) {
        const text = await res.text();
        const err = new Error(`[AnthropicProvider] API error (${res.status}): ${text}`);
        err.status = res.status;
        throw err;
      }

      const data = await res.json();
      return this.#parseResponse(data, model, Date.now() - start);
    }, 'complete');
  }

  async *stream(request) {
    this.#requireKey();
    const model = request.model || DEFAULT_MODEL;
    const start = Date.now();
    const { messages, system } = this.#formatMessages(request);
    const tools = request.tools ? this.#formatTools(request.tools) : undefined;

    const body = {
      model,
      max_tokens: request.maxTokens || 4096,
      messages,
      stream: true,
      ...(system ? { system } : {}),
      ...(tools?.length ? { tools } : {}),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
    };

    const res = await fetch(`${API_BASE}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.#apiKey,
        'anthropic-version': API_VERSION,
      },
      body: JSON.stringify(body),
      signal: request.signal || undefined,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`[AnthropicProvider] Streaming API error (${res.status}): ${text}`);
    }

    // Parse SSE stream
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;
    const toolCalls = [];
    let stopReason = 'end_turn';
    let currentToolUse = null;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

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

          if (event.type === 'message_start') {
            inputTokens = event.message?.usage?.input_tokens || 0;
          } else if (event.type === 'content_block_start') {
            if (event.content_block?.type === 'tool_use') {
              currentToolUse = {
                id: event.content_block.id,
                name: event.content_block.name,
                inputJson: '',
              };
            }
          } else if (event.type === 'content_block_delta') {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              fullText += event.delta.text;
              yield { text: event.delta.text, done: false };
            } else if (event.delta?.type === 'input_json_delta' && currentToolUse) {
              currentToolUse.inputJson += event.delta.partial_json || '';
            }
          } else if (event.type === 'content_block_stop') {
            if (currentToolUse) {
              let parsedInput;
              try {
                parsedInput = JSON.parse(currentToolUse.inputJson);
              } catch {
                parsedInput = currentToolUse.inputJson;
              }
              const tc = {
                id: currentToolUse.id,
                type: 'tool_use',
                name: currentToolUse.name,
                input: parsedInput,
              };
              toolCalls.push(tc);
              yield { toolCall: tc, done: false };
              currentToolUse = null;
            }
          } else if (event.type === 'message_delta') {
            stopReason = event.delta?.stop_reason || stopReason;
            outputTokens = event.usage?.output_tokens || outputTokens;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      done: true,
      fullResponse: {
        content: fullText,
        toolCalls,
        usage: { inputTokens, outputTokens },
        model,
        provider: 'anthropic',
        stopReason,
        latencyMs: Date.now() - start,
      },
    };
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
          `[AnthropicProvider] ${label} attempt ${attempt + 1} failed, retrying in ${Math.round(delay)}ms`,
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
      return s === 429 || s === 500 || s === 502 || s === 503 || s === 529;
    }
    return false;
  }

  // ── Private: message formatting ───────────────────────────────────

  #formatMessages(request) {
    let system = request.systemPrompt || undefined;
    const messages = [];

    for (const msg of request.messages) {
      if (msg.role === 'system') {
        system = (system ? system + '\n\n' : '') +
          (typeof msg.content === 'string' ? msg.content : '');
        continue;
      }
      if (msg.role === 'tool') {
        messages.push({
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.tool_call_id,
              content: typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content),
              ...(msg.name === 'error' ? { is_error: true } : {}),
            },
          ],
        });
        continue;
      }
      if (msg.role === 'assistant' && msg.tool_calls?.length) {
        const blocks = [];
        if (typeof msg.content === 'string' && msg.content) {
          blocks.push({ type: 'text', text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          blocks.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.input });
        }
        messages.push({ role: 'assistant', content: blocks });
        continue;
      }
      // Regular message
      if (typeof msg.content === 'string') {
        messages.push({ role: msg.role, content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const parts = msg.content.map((p) => {
          if (p.type === 'text') return { type: 'text', text: p.text };
          if (p.type === 'image' && p.source) {
            return {
              type: 'image',
              source: { type: 'base64', media_type: p.source.media_type, data: p.source.data },
            };
          }
          return p;
        });
        messages.push({ role: msg.role, content: parts });
      } else {
        messages.push({ role: msg.role, content: msg.content });
      }
    }

    return { messages, system };
  }

  #formatTools(tools) {
    return tools.map((t) => {
      if (t.input_schema) {
        return { name: t.name, description: t.description || '', input_schema: t.input_schema };
      }
      if (t.function) {
        return {
          name: t.function.name,
          description: t.function.description || '',
          input_schema: t.function.parameters || { type: 'object', properties: {} },
        };
      }
      return {
        name: t.name,
        description: t.description || '',
        input_schema: { type: 'object', properties: {} },
      };
    });
  }

  // ── Private: response parsing ─────────────────────────────────────

  #parseResponse(data, model, latencyMs) {
    let content = '';
    const toolCalls = [];

    for (const block of data.content || []) {
      if (block.type === 'text') content += block.text || '';
      else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id || '',
          type: 'tool_use',
          name: block.name || '',
          input: block.input || {},
        });
      }
    }

    let stopReason = data.stop_reason || 'end_turn';
    if (stopReason === 'end_turn') stopReason = 'end_turn';
    else if (stopReason === 'tool_use') stopReason = 'tool_use';
    else if (stopReason === 'max_tokens') stopReason = 'max_tokens';

    return {
      content,
      toolCalls,
      usage: {
        inputTokens: data.usage?.input_tokens || 0,
        outputTokens: data.usage?.output_tokens || 0,
      },
      model,
      provider: 'anthropic',
      stopReason,
      latencyMs,
    };
  }

  #requireKey() {
    if (!this.#apiKey) {
      throw new Error(
        'ANTHROPIC_API_KEY not configured. Set it in vault api-keys.',
      );
    }
  }
}
