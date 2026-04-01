/**
 * Confidence Assessor -- Structural confidence scoring for LLM responses.
 *
 * Ported from nexus-os: confidence-assessor.ts
 * Removed: TypeScript types (LLMRequest/LLMResponse/ToolDefinition imports).
 * Changed: Pure function module, accepts plain objects.
 *
 * No ML inference is performed. This module inspects structural properties
 * of an LLM response (tool call validity, truncation, emptiness, brevity)
 * to produce a confidence score in [0, 1].
 *
 * Signals that reduce confidence:
 *   - malformed-tool-call: tool input is not an object (-0.7)
 *   - unknown-tool: tool name not in definitions (-0.5)
 *   - truncated: response hit max_tokens (-0.3)
 *   - empty-response: no content and no tool calls (-0.8)
 *   - unexpectedly-brief: content under 20 chars (-0.2)
 */

const WEIGHTS = {
  MALFORMED_TOOL_CALL: -0.7,
  UNKNOWN_TOOL: -0.5,
  TRUNCATED: -0.3,
  EMPTY_RESPONSE: -0.8,
  UNEXPECTEDLY_BRIEF: -0.2,
};

const DEFAULT_THRESHOLD = 0.5;
const BRIEF_CONTENT_THRESHOLD = 20;

// -- Signal checkers ----------------------------------------------------------

function checkToolCallValidity(toolCalls, toolDefs) {
  const signals = [];
  const knownNames = new Set(toolDefs?.map((t) => t.name) ?? []);

  for (const call of toolCalls || []) {
    if (call.input !== null && call.input !== undefined && typeof call.input !== 'object') {
      signals.push({
        name: 'malformed-tool-call',
        weight: WEIGHTS.MALFORMED_TOOL_CALL,
        detail: `Tool call "${call.name}" has non-object input: ${typeof call.input}`,
      });
    }
    if (toolDefs?.length > 0 && !knownNames.has(call.name)) {
      signals.push({
        name: 'unknown-tool',
        weight: WEIGHTS.UNKNOWN_TOOL,
        detail: `Tool "${call.name}" is not in the provided tool definitions`,
      });
    }
  }
  return signals;
}

function checkTruncation(response) {
  if (response.stopReason === 'max_tokens') {
    return [{ name: 'truncated', weight: WEIGHTS.TRUNCATED, detail: 'Response was truncated due to max_tokens limit' }];
  }
  return [];
}

function checkEmpty(response) {
  const hasContent = response.content && response.content.trim().length > 0;
  const hasToolCalls = response.toolCalls && response.toolCalls.length > 0;
  if (!hasContent && !hasToolCalls) {
    return [{ name: 'empty-response', weight: WEIGHTS.EMPTY_RESPONSE, detail: 'Response contains no content and no tool calls' }];
  }
  return [];
}

function checkBrevity(response) {
  if (!response.content || response.content.trim().length === 0) return [];
  if (response.toolCalls?.length > 0) return [];
  if (response.content.length < BRIEF_CONTENT_THRESHOLD) {
    return [{
      name: 'unexpectedly-brief',
      weight: WEIGHTS.UNEXPECTEDLY_BRIEF,
      detail: `Response is only ${response.content.length} chars (threshold: ${BRIEF_CONTENT_THRESHOLD})`,
    }];
  }
  return [];
}

// -- Main export --------------------------------------------------------------

/**
 * Assess the confidence of an LLM response using structural signals.
 * Pure function: no side effects, same inputs always give same output.
 *
 * @param {object} response - The LLM response { content, toolCalls, stopReason }
 * @param {object[]} [tools] - Tool definitions [{ name }] for validation
 * @param {object} [options] - { threshold: number }
 * @returns {{ score: number, signals: object[], escalate: boolean }}
 */
export function assessConfidence(response, tools, options) {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;

  const signals = [
    ...checkEmpty(response),
    ...checkTruncation(response),
    ...checkToolCallValidity(response.toolCalls, tools),
    ...checkBrevity(response),
  ];

  const totalPenalty = signals.reduce((sum, s) => sum + s.weight, 0);
  const rawScore = 1.0 + totalPenalty;
  const score = Math.max(0, Math.min(1, Math.round(rawScore * 1e10) / 1e10));

  return {
    score,
    signals,
    escalate: score < threshold,
  };
}

export { WEIGHTS, DEFAULT_THRESHOLD };
