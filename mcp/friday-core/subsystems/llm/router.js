/**
 * Intelligence Router -- scores and routes tasks to optimal models.
 *
 * Task profiling, model registry, multi-factor scoring (capability, cost,
 * speed, context fit, reliability), budget enforcement, circuit breaking,
 * local-model policy, decision history.
 *
 * Ported from nexus-os/src/main/intelligence-router.ts
 * Stripped: Electron app.getPath, settingsManager, fs persistence.
 * State is held in memory and optionally persisted via vault/stateManager.
 */

import { randomUUID } from 'crypto';

// ── Constants ────────────────────────────────────────────────────────

const COMPLEXITY_WEIGHTS = {
  trivial: 0.1,
  simple: 0.3,
  moderate: 0.5,
  complex: 0.8,
  expert: 1.0,
};

const LATENCY_MAX_MS = {
  realtime: 500,
  fast: 3000,
  standard: 15000,
  batch: 120000,
};

const CIRCUIT_BREAKER_THRESHOLD = 3;

// ── Default model registry ───────────────────────────────────────────

const DEFAULT_MODELS = [
  // Anthropic direct
  {
    modelId: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4',
    provider: 'anthropic',
    routeVia: 'anthropic',
    contextWindow: 200000,
    inputCostPerMillion: 15,
    outputCostPerMillion: 75,
    tokensPerSecond: 40,
    strengths: { reasoning: 0.98, code: 0.95, creative: 0.92, extraction: 0.95, 'tool-use': 0.95, conversation: 0.90 },
    supportsToolUse: true,
    supportsVision: true,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 60,
    consecutiveFailures: 0,
  },
  {
    modelId: 'anthropic/claude-sonnet-4',
    name: 'Claude Sonnet 4',
    provider: 'anthropic',
    routeVia: 'anthropic',
    contextWindow: 200000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    tokensPerSecond: 80,
    strengths: { reasoning: 0.88, code: 0.90, creative: 0.85, extraction: 0.90, 'tool-use': 0.90, conversation: 0.88 },
    supportsToolUse: true,
    supportsVision: true,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 120,
    consecutiveFailures: 0,
  },
  {
    modelId: 'anthropic/claude-haiku-3.5',
    name: 'Claude Haiku 3.5',
    provider: 'anthropic',
    routeVia: 'anthropic',
    contextWindow: 200000,
    inputCostPerMillion: 0.8,
    outputCostPerMillion: 4,
    tokensPerSecond: 150,
    strengths: { reasoning: 0.70, code: 0.72, creative: 0.65, extraction: 0.78, 'tool-use': 0.75, conversation: 0.80 },
    supportsToolUse: true,
    supportsVision: true,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 200,
    consecutiveFailures: 0,
  },
  // OpenRouter
  {
    modelId: 'openai/gpt-4o',
    name: 'GPT-4o',
    provider: 'openrouter',
    routeVia: 'openrouter',
    contextWindow: 128000,
    inputCostPerMillion: 2.5,
    outputCostPerMillion: 10,
    tokensPerSecond: 90,
    strengths: { reasoning: 0.88, code: 0.87, creative: 0.85, extraction: 0.87, 'tool-use': 0.90, vision: 0.90, conversation: 0.88 },
    supportsToolUse: true,
    supportsVision: true,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 100,
    consecutiveFailures: 0,
  },
  {
    modelId: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    provider: 'openrouter',
    routeVia: 'openrouter',
    contextWindow: 128000,
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
    tokensPerSecond: 150,
    strengths: { reasoning: 0.65, code: 0.68, creative: 0.62, extraction: 0.72, 'tool-use': 0.70, conversation: 0.75 },
    supportsToolUse: true,
    supportsVision: true,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 200,
    consecutiveFailures: 0,
  },
  {
    modelId: 'meta-llama/llama-3.3-70b',
    name: 'Llama 3.3 70B',
    provider: 'openrouter',
    routeVia: 'openrouter',
    contextWindow: 131072,
    inputCostPerMillion: 0.4,
    outputCostPerMillion: 0.4,
    tokensPerSecond: 120,
    strengths: { reasoning: 0.72, code: 0.75, creative: 0.68, extraction: 0.75, 'tool-use': 0.60, conversation: 0.72 },
    supportsToolUse: true,
    supportsVision: false,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 200,
    consecutiveFailures: 0,
  },
  {
    modelId: 'deepseek/deepseek-r1',
    name: 'DeepSeek R1',
    provider: 'openrouter',
    routeVia: 'openrouter',
    contextWindow: 163840,
    inputCostPerMillion: 0.55,
    outputCostPerMillion: 2.19,
    tokensPerSecond: 60,
    strengths: { reasoning: 0.92, code: 0.90, creative: 0.65, extraction: 0.82, 'tool-use': 0.55, conversation: 0.60 },
    supportsToolUse: false,
    supportsVision: false,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 100,
    consecutiveFailures: 0,
  },
  {
    modelId: 'qwen/qwen-2.5-coder-32b',
    name: 'Qwen 2.5 Coder 32B',
    provider: 'openrouter',
    routeVia: 'openrouter',
    contextWindow: 32768,
    inputCostPerMillion: 0.2,
    outputCostPerMillion: 0.2,
    tokensPerSecond: 140,
    strengths: { reasoning: 0.60, code: 0.88, creative: 0.45, extraction: 0.65, 'tool-use': 0.55, conversation: 0.55 },
    supportsToolUse: false,
    supportsVision: false,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 200,
    consecutiveFailures: 0,
  },
  // Ollama / local placeholders (enabled via discovery)
  {
    modelId: 'ollama/llama3',
    name: 'Llama 3 (Ollama)',
    provider: 'ollama',
    routeVia: 'ollama',
    contextWindow: 131072,
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    tokensPerSecond: 40,
    strengths: { reasoning: 0.72, code: 0.75, creative: 0.68, extraction: 0.75, 'tool-use': 0.60, conversation: 0.72 },
    supportsToolUse: true,
    supportsVision: false,
    supportsAudio: false,
    available: false,
    lastChecked: 0,
    rateLimit: 0,
    consecutiveFailures: 0,
  },
];

// ── Exported pure functions ──────────────────────────────────────────

/**
 * Classify a task from message content and context.
 */
export function classifyTask({
  messageContent,
  toolCount = 0,
  hasImages = false,
  hasAudio = false,
  systemPromptLength = 0,
  conversationLength = 0,
}) {
  const lower = messageContent.toLowerCase();
  const wordCount = messageContent.split(/\s+/).length;

  // Category detection
  let category = 'conversation';
  if (hasAudio) category = 'audio';
  else if (hasImages) category = 'vision';
  else if (toolCount > 0 && /\b(search|browse|execute|run|fetch|call|look up)\b/.test(lower)) category = 'tool-use';
  else if (/\b(code|function|class|refactor|debug|implement|typescript|python|javascript|bug|error|fix)\b/.test(lower)) category = 'code';
  else if (/\b(analy[zs]e|review|evaluate|compare|assess|reason|explain why|think through|legal|contract)\b/.test(lower)) category = 'reasoning';
  else if (/\b(write|draft|compose|creative|story|poem|blog|article|essay|brainstorm)\b/.test(lower)) category = 'creative';
  else if (/\b(extract|summar|parse|list|key points|highlights|tldr)\b/.test(lower)) category = 'extraction';
  else if (/\b(embed|similar|semantic|vector|match)\b/.test(lower)) category = 'embedding';

  // Complexity
  let complexity = 'simple';
  if (wordCount > 500 || /\b(comprehensive|thorough|detailed|in-depth|exhaustive)\b/.test(lower)) complexity = 'expert';
  else if (wordCount > 200 || /\b(analy[zs]e|review|evaluate|compare|multi-step)\b/.test(lower)) complexity = 'complex';
  else if (wordCount > 50 || toolCount > 3) complexity = 'moderate';
  else if (wordCount < 15) complexity = 'trivial';

  // Latency
  let latency = 'standard';
  if (hasAudio) latency = 'realtime';
  else if (wordCount < 30 && category === 'conversation') latency = 'fast';
  else if (/\b(batch|background|whenever|no rush)\b/.test(lower)) latency = 'batch';

  const estimatedInputTokens = Math.ceil(
    (messageContent.length / 4) + (systemPromptLength / 4) + (conversationLength / 4),
  );

  return {
    category,
    complexity,
    latency,
    estimatedInputTokens,
    requiresToolUse: toolCount > 0,
    requiresVision: hasImages,
    requiresAudio: hasAudio,
    requiresLongContext: estimatedInputTokens > 32000,
    tags: [],
  };
}

/**
 * Score a model against a task profile. Returns 0-1.
 */
export function scoreModel(model, task, config) {
  // Hard disqualifiers
  if (task.requiresVision && !model.supportsVision) return zeroScore(model.modelId);
  if (task.requiresAudio && !model.supportsAudio) return zeroScore(model.modelId);
  if (task.requiresToolUse && !model.supportsToolUse) return zeroScore(model.modelId);
  if (task.estimatedInputTokens > model.contextWindow * 0.9) return zeroScore(model.modelId);
  if (!model.available) return zeroScore(model.modelId);
  if (model.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) return zeroScore(model.modelId);

  // Local model policy
  let localBonus = 0;
  const isLocal = model.routeVia === 'ollama' || model.provider === 'ollama' ||
                  model.routeVia === 'local' || model.provider === 'local';

  if (isLocal) {
    const policy = config.localModelPolicy || 'preferred';
    if (policy === 'disabled') return zeroScore(model.modelId);

    const bgCats = new Set(['extraction', 'embedding']);
    if (policy === 'background' && !bgCats.has(task.category)) return zeroScore(model.modelId);

    if (policy === 'conservative') {
      if (task.complexity === 'expert' || task.complexity === 'complex') return zeroScore(model.modelId);
      const blocked = new Set(['reasoning', 'audio', 'vision']);
      if (blocked.has(task.category)) return zeroScore(model.modelId);
    }

    if (policy === 'preferred') {
      const catStrength = model.strengths[task.category] ?? 0;
      if (catStrength >= 0.4) localBonus = 0.3;
    }

    const minCap = config.localMinCapability ?? 0.55;
    const catStr = model.strengths[task.category] ?? 0;
    if (catStr < minCap) return zeroScore(model.modelId);
  }

  // Capability
  const categoryStrength = model.strengths[task.category] ?? 0.5;
  const complexityNeeded = COMPLEXITY_WEIGHTS[task.complexity] || 0.5;
  const capabilityScore = Math.min(1, categoryStrength / Math.max(complexityNeeded, 0.3));

  // Cost (inverted: cheaper = higher)
  const estimatedCost = estimateRequestCost(model, task.estimatedInputTokens, task.estimatedInputTokens * 0.5);
  const maxCost = config.maxRequestCostUsd || 1.0;
  let costScore = 1 - Math.min(estimatedCost / maxCost, 1);
  if (config.preferCost) costScore = Math.pow(costScore, 0.5);

  if (config.monthlyBudgetUsd > 0) {
    const remaining = config.monthlyBudgetUsd - (config.monthlySpentUsd || 0);
    if (estimatedCost > remaining) costScore = 0;
  }

  // Speed
  const maxLatency = LATENCY_MAX_MS[task.latency] || 15000;
  const estOutputTokens = task.estimatedInputTokens * 0.5;
  const estTimeMs = (estOutputTokens / model.tokensPerSecond) * 1000;
  let speedScore = Math.min(1, maxLatency / Math.max(estTimeMs, 100));
  if (config.preferSpeed) speedScore = Math.pow(speedScore, 0.5);

  // Context utilization
  const utilization = task.estimatedInputTokens / model.contextWindow;
  const contextScore = utilization < 0.5 ? 1.0
    : utilization < 0.8 ? 0.8
    : utilization < 0.95 ? 0.5
    : 0.1;

  // Reliability
  const reliabilityScore = model.consecutiveFailures === 0 ? 1.0
    : Math.max(0, 1 - model.consecutiveFailures * 0.3);

  // Weighted composite
  const totalScore =
    capabilityScore * 0.35 +
    costScore * 0.20 +
    speedScore * 0.20 +
    contextScore * 0.10 +
    reliabilityScore * 0.15 +
    localBonus;

  return {
    modelId: model.modelId,
    totalScore: Math.max(0, Math.min(1, totalScore)),
    breakdown: { capabilityScore, costScore, speedScore, contextScore, reliabilityScore },
  };
}

export function estimateRequestCost(model, inputTokens, outputTokens) {
  return (
    (inputTokens * model.inputCostPerMillion) / 1_000_000 +
    (outputTokens * model.outputCostPerMillion) / 1_000_000
  );
}

export function buildRoutingExplanation(selected, task, budgetConstrained, isFallback) {
  const b = selected.breakdown;
  const parts = [
    `Task: ${task.category} (${task.complexity})`,
    `Capability: ${(b.capabilityScore * 100).toFixed(0)}%`,
    `Cost: ${(b.costScore * 100).toFixed(0)}%`,
    `Speed: ${(b.speedScore * 100).toFixed(0)}%`,
  ];
  if (budgetConstrained) parts.push('BUDGET CONSTRAINED');
  if (isFallback) parts.push('FALLBACK');
  return parts.join(' | ');
}

function zeroScore(modelId) {
  return {
    modelId,
    totalScore: 0,
    breakdown: { capabilityScore: 0, costScore: 0, speedScore: 0, contextScore: 0, reliabilityScore: 0 },
  };
}

// ── IntelligenceRouter class ─────────────────────────────────────────

export class IntelligenceRouter {
  #models = [];
  #decisions = [];
  #config = {
    enabled: true,
    monthlyBudgetUsd: 0,
    monthlySpentUsd: 0,
    budgetResetDay: 1,
    preferSpeed: false,
    preferCost: false,
    pinnedModelId: null,
    maxRequestCostUsd: 1.0,
    maxDecisionHistory: 500,
    fallbackModelId: 'anthropic/claude-sonnet-4',
    localModelPolicy: 'preferred',
    localMinCapability: 0.55,
  };

  /**
   * @param {{ state?: object }} opts -- optional stateManager namespace for persistence
   */
  constructor(opts = {}) {
    this._state = opts.state || null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────

  async initialize() {
    // Load saved state if available
    if (this._state) {
      try {
        const saved = await this._state.read('router-state');
        if (saved) {
          if (saved.models) this.#models = saved.models;
          if (saved.decisions) this.#decisions = saved.decisions;
          if (saved.config) this.#config = { ...this.#config, ...saved.config };
        }
      } catch {
        // Fresh start
      }
    }

    // Merge defaults (preserve existing customized entries)
    for (const def of DEFAULT_MODELS) {
      if (!this.#models.find((m) => m.modelId === def.modelId)) {
        this.#models.push({ ...def });
      }
    }

    this.#checkBudgetReset();

    process.stderr.write(
      `[Router] Initialized -- ${this.#models.length} models, ` +
      `${this.#decisions.length} decisions in history\n`,
    );
  }

  stop() {
    this.#persistState();
  }

  // ── Task profiling (convenience wrapper) ──────────────────────────

  profileTask(description) {
    return classifyTask({
      messageContent: description,
      toolCount: 0,
      hasImages: false,
      hasAudio: false,
      systemPromptLength: 0,
      conversationLength: 0,
    });
  }

  // ── Model selection ───────────────────────────────────────────────

  selectModel(task) {
    const decisionId = randomUUID().slice(0, 12);

    // Pinned model
    if (this.#config.pinnedModelId) {
      const pinned = this.#models.find((m) => m.modelId === this.#config.pinnedModelId);
      if (pinned?.available) {
        const d = this.#createDecision(decisionId, task, pinned.modelId, 'User-pinned model', [], false, false);
        this.#recordDecision(d);
        return d;
      }
    }

    // Score and rank
    const scores = this.#models
      .map((m) => scoreModel(m, task, this.#config))
      .filter((s) => s.totalScore > 0)
      .sort((a, b) => b.totalScore - a.totalScore);

    if (scores.length === 0) {
      const d = this.#createDecision(
        decisionId, task, this.#config.fallbackModelId,
        'No model met requirements -- using fallback', [], false, true,
      );
      this.#recordDecision(d);
      return d;
    }

    const best = scores[0];
    const budgetConstrained = this.#isBudgetConstrained(task, best.modelId);
    let selectedModelId = best.modelId;
    let reason = buildRoutingExplanation(best, task, budgetConstrained, false);

    if (budgetConstrained && scores.length > 1) {
      for (const alt of scores.slice(1)) {
        if (!this.#isBudgetConstrained(task, alt.modelId)) {
          selectedModelId = alt.modelId;
          reason = buildRoutingExplanation(alt, task, true, false);
          break;
        }
      }
    }

    const d = this.#createDecision(decisionId, task, selectedModelId, reason, scores, budgetConstrained, false);
    this.#recordDecision(d);
    return d;
  }

  /**
   * Record outcome after request completes (success/failure/cost tracking).
   */
  recordOutcome(decisionId, outcome) {
    const d = this.#decisions.find((x) => x.id === decisionId);
    if (!d) return;

    d.success = outcome.success;
    d.durationMs = outcome.durationMs;
    d.actualInputTokens = outcome.inputTokens ?? null;
    d.actualOutputTokens = outcome.outputTokens ?? null;

    const model = this.#models.find((m) => m.modelId === d.selectedModelId);
    if (model && outcome.inputTokens && outcome.outputTokens) {
      d.actualCost = estimateRequestCost(model, outcome.inputTokens, outcome.outputTokens);
      this.#config.monthlySpentUsd += d.actualCost;
    }

    if (model) {
      model.consecutiveFailures = outcome.success ? 0 : model.consecutiveFailures + 1;
    }

    this.#persistState();
  }

  // ── Registry access ───────────────────────────────────────────────

  getModelRegistry() {
    return [...this.#models];
  }

  getAvailableModels() {
    return this.#models.filter(
      (m) => m.available && m.consecutiveFailures < CIRCUIT_BREAKER_THRESHOLD,
    );
  }

  getModel(modelId) {
    return this.#models.find((m) => m.modelId === modelId) || null;
  }

  registerModel(model) {
    const idx = this.#models.findIndex((m) => m.modelId === model.modelId);
    if (idx >= 0) this.#models[idx] = model;
    else this.#models.push(model);
    this.#persistState();
  }

  setModelAvailability(modelId, available) {
    const m = this.#models.find((x) => x.modelId === modelId);
    if (m) {
      m.available = available;
      m.lastChecked = Date.now();
      if (available) m.consecutiveFailures = 0;
      this.#persistState();
    }
  }

  // ── Ollama model discovery ────────────────────────────────────────

  /**
   * Register models discovered from Ollama's /api/tags response.
   * @param {Array<{id: string, name: string}>} ollamaModels
   */
  registerOllamaModels(ollamaModels) {
    for (const om of ollamaModels) {
      const modelId = `ollama/${om.id}`;
      const existing = this.#models.find((m) => m.modelId === modelId);
      if (existing) {
        existing.available = true;
        existing.lastChecked = Date.now();
        existing.consecutiveFailures = 0;
      } else {
        this.#models.push({
          modelId,
          name: `${om.name} (Ollama)`,
          provider: 'ollama',
          routeVia: 'ollama',
          contextWindow: 32768,
          inputCostPerMillion: 0,
          outputCostPerMillion: 0,
          tokensPerSecond: 40,
          strengths: {
            reasoning: 0.60, code: 0.60, creative: 0.55,
            extraction: 0.65, 'tool-use': 0.50, conversation: 0.60,
          },
          supportsToolUse: false,
          supportsVision: false,
          supportsAudio: false,
          available: true,
          lastChecked: Date.now(),
          rateLimit: 0,
          consecutiveFailures: 0,
        });
      }
    }
    this.#persistState();
  }

  // ── Config ────────────────────────────────────────────────────────

  getConfig() {
    return { ...this.#config };
  }

  updateConfig(partial) {
    Object.assign(this.#config, partial);
    this.#persistState();
    return { ...this.#config };
  }

  // ── Stats ─────────────────────────────────────────────────────────

  getStats() {
    const successful = this.#decisions.filter((d) => d.success === true);
    const failed = this.#decisions.filter((d) => d.success === false);
    const fallbacks = this.#decisions.filter((d) => d.isFallback);
    const totalCost = this.#decisions.reduce((sum, d) => sum + (d.actualCost || 0), 0);

    const usageMap = new Map();
    for (const d of this.#decisions) {
      const entry = usageMap.get(d.selectedModelId) || { count: 0, totalCost: 0 };
      entry.count++;
      entry.totalCost += d.actualCost || 0;
      usageMap.set(d.selectedModelId, entry);
    }

    const completed = this.#decisions.filter((d) => d.durationMs !== null);
    const avgLatency = completed.length > 0
      ? completed.reduce((sum, d) => sum + (d.durationMs || 0), 0) / completed.length
      : 0;

    return {
      totalDecisions: this.#decisions.length,
      successfulRoutes: successful.length,
      failedRoutes: failed.length,
      fallbacksUsed: fallbacks.length,
      totalCostUsd: totalCost,
      monthlySpentUsd: this.#config.monthlySpentUsd,
      monthlyBudgetUsd: this.#config.monthlyBudgetUsd,
      budgetUtilization: this.#config.monthlyBudgetUsd > 0
        ? this.#config.monthlySpentUsd / this.#config.monthlyBudgetUsd
        : 0,
      modelUsage: Array.from(usageMap.entries())
        .map(([modelId, { count, totalCost: tc }]) => ({ modelId, count, totalCost: tc }))
        .sort((a, b) => b.count - a.count),
      avgLatencyMs: avgLatency,
    };
  }

  // ── Decision history ──────────────────────────────────────────────

  getRecentDecisions(limit = 20) {
    return [...this.#decisions]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, limit);
  }

  // ── Private helpers ───────────────────────────────────────────────

  #createDecision(id, task, selectedModelId, reason, scores, budgetConstrained, isFallback) {
    return {
      id,
      timestamp: Date.now(),
      taskProfile: task,
      selectedModelId,
      reason,
      scores,
      budgetConstrained,
      isFallback,
      userOverride: null,
      durationMs: null,
      success: null,
      actualInputTokens: null,
      actualOutputTokens: null,
      actualCost: null,
    };
  }

  #recordDecision(decision) {
    this.#decisions.push(decision);
    if (this.#decisions.length > this.#config.maxDecisionHistory) {
      this.#decisions = this.#decisions.slice(-this.#config.maxDecisionHistory);
    }
    this.#persistState();
  }

  #isBudgetConstrained(task, modelId) {
    if (this.#config.monthlyBudgetUsd <= 0) return false;
    const model = this.#models.find((m) => m.modelId === modelId);
    if (!model) return true;
    const cost = estimateRequestCost(model, task.estimatedInputTokens, task.estimatedInputTokens * 0.5);
    return cost > this.#config.monthlyBudgetUsd - (this.#config.monthlySpentUsd || 0);
  }

  #checkBudgetReset() {
    const now = new Date();
    if (now.getDate() === this.#config.budgetResetDay) {
      const last = this.#decisions[this.#decisions.length - 1];
      if (last) {
        const d = new Date(last.timestamp);
        if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) {
          this.#config.monthlySpentUsd = 0;
          process.stderr.write('[Router] Monthly budget reset\n');
        }
      }
    }
  }

  #persistState() {
    if (!this._state) return;
    // Fire-and-forget; callers don't need to wait
    this._state.write('router-state', {
      models: this.#models,
      decisions: this.#decisions,
      config: this.#config,
      savedAt: Date.now(),
    }).catch((err) => {
      process.stderr.write(`[Router] State persist failed: ${err?.message}\n`);
    });
  }
}
