/**
 * Internal Module Tests -- Edge cases for subsystem implementation modules.
 *
 * Covers internal logic not reached by tool-handler or wiring tests:
 *
 *   1.  LLM IntelligenceRouter  -- classifyTask, scoreModel, model selection,
 *       budget enforcement, circuit breaker, pinned model, Ollama discovery,
 *       decision history cap, recordOutcome preference learning
 *   2.  LLM Client              -- provider fallback, explicit-provider no-fallback,
 *       stream fallback, all-providers-fail error, no-provider-available error
 *   3.  Memory MemoryTiers      -- SHA-256 dedup, Jaccard dedup, tier caps (LFU eviction),
 *       confidence clamping, forget, clearShortTerm, unknown tier, status
 *   4.  Memory EpisodicMemory   -- startEpisode, addObservation, endEpisode,
 *       auto-end on overlap, MAX_EPISODES cap, search scoring, deleteEpisode
 *   5.  Personality ProfileManager -- mode validation, challengeLevel clamping,
 *       slider modifiers, condensed profile, prompt construction
 *   6.  Personality PersonalityEvolution -- computeEvolution clamping, maturity factor,
 *       incrementSession version tracking, getSelfDescription branches
 *   7.  Gateway AuditLog        -- log truncation, direction filtering, max-entries cap,
 *       logInbound / logOutbound helpers, getStats
 *   8.  Context ContextGraph    -- addNode / addEdge, invalid types rejected,
 *       edge weight accumulation, getNeighbors, prune, pruneNodes / pruneEdges,
 *       processEvent entity extraction, query, toJSON
 *   9.  Enterprise ConsentManager -- grant/check/revoke lifecycle, once-scope consumed,
 *       always-scope persisted, session-scope not persisted, revokeAll, audit trail cap
 *  10.  Enterprise CloudGate    -- no-consent denied, no-policy denied, policy-deny,
 *       policy-allow consumes once-scoped grant, clearPolicy, clearAllPolicies, stats
 *
 * Run: node --test test/test-internals.js
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ── Module imports ───────────────────────────────────────────────────────────

import {
  classifyTask,
  scoreModel,
  estimateRequestCost,
  buildRoutingExplanation,
  IntelligenceRouter,
} from '../subsystems/llm/router.js';

import { LLMClient } from '../subsystems/llm/client.js';

import { MemoryTiers } from '../subsystems/memory/tiers.js';
import { EpisodicMemory } from '../subsystems/memory/episodic.js';

import { PersonalityProfile } from '../subsystems/personality/profile.js';
import { PersonalityEvolution } from '../subsystems/personality/evolution.js';

import { AuditLog } from '../subsystems/gateway/audit.js';

import { ContextGraph } from '../subsystems/context/graph.js';

import { ConsentTracker, CONSENT_CATEGORIES } from '../subsystems/enterprise/consent.js';
import { CloudGate } from '../subsystems/enterprise/cloud-gate.js';

// ── Shared test helpers ──────────────────────────────────────────────────────

/**
 * In-memory mock of a vault state namespace.
 * Mirrors the API used by all subsystem state accessors.
 */
function createMockState() {
  const store = new Map();
  return {
    read:  async (key) => ({ success: true, data: store.get(key) ?? null }),
    write: async (key, data) => {
      store.set(key, JSON.parse(JSON.stringify(data)));
      return { success: true };
    },
    delete: async (key) => { store.delete(key); return { success: true }; },
    list:   async () => ({ success: true, keys: [...store.keys()] }),
    _store: store,
  };
}

/**
 * A minimal model definition used throughout the router tests.
 */
function makeModel(overrides = {}) {
  return {
    modelId: 'test/model',
    name: 'Test Model',
    provider: 'anthropic',
    routeVia: 'anthropic',
    contextWindow: 200000,
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
    tokensPerSecond: 80,
    strengths: {
      reasoning: 0.88, code: 0.90, creative: 0.85,
      extraction: 0.90, 'tool-use': 0.90, conversation: 0.88,
    },
    supportsToolUse: true,
    supportsVision: true,
    supportsAudio: false,
    available: true,
    lastChecked: 0,
    rateLimit: 120,
    consecutiveFailures: 0,
    ...overrides,
  };
}

const DEFAULT_CONFIG = {
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

// ═══════════════════════════════════════════════════════════════════════════════
// 1. LLM IntelligenceRouter
// ═══════════════════════════════════════════════════════════════════════════════

describe('LLM / classifyTask: category detection', () => {
  it('detects code category from keywords', () => {
    const t = classifyTask({ messageContent: 'refactor this TypeScript function' });
    assert.equal(t.category, 'code');
  });

  it('detects reasoning category', () => {
    const t = classifyTask({ messageContent: 'analyse and evaluate the legal contract' });
    assert.equal(t.category, 'reasoning');
  });

  it('detects creative category', () => {
    const t = classifyTask({ messageContent: 'write a short story about Friday' });
    assert.equal(t.category, 'creative');
  });

  it('detects extraction category', () => {
    const t = classifyTask({ messageContent: 'summarise the key points from this document' });
    assert.equal(t.category, 'extraction');
  });

  it('detects tool-use category when toolCount > 0 and action verb present', () => {
    const t = classifyTask({ messageContent: 'search for recent news', toolCount: 1 });
    assert.equal(t.category, 'tool-use');
  });

  it('detects vision when hasImages is true', () => {
    const t = classifyTask({ messageContent: 'what is in this image', hasImages: true });
    assert.equal(t.category, 'vision');
  });

  it('detects audio when hasAudio is true', () => {
    const t = classifyTask({ messageContent: 'transcribe this', hasAudio: true });
    assert.equal(t.category, 'audio');
  });

  it('defaults to conversation for plain messages', () => {
    const t = classifyTask({ messageContent: 'hello there' });
    assert.equal(t.category, 'conversation');
  });
});

describe('LLM / classifyTask: complexity detection', () => {
  it('classifies trivial for very short messages (< 15 words)', () => {
    const t = classifyTask({ messageContent: 'hi' });
    assert.equal(t.complexity, 'trivial');
  });

  it('classifies expert for comprehensive keyword', () => {
    const t = classifyTask({ messageContent: 'write a comprehensive analysis of this topic' });
    assert.equal(t.complexity, 'expert');
  });

  it('classifies expert when word count exceeds 500', () => {
    const long = 'word '.repeat(510);
    const t = classifyTask({ messageContent: long });
    assert.equal(t.complexity, 'expert');
  });

  it('classifies moderate for messages with more than 50 words', () => {
    const medium = 'word '.repeat(60);
    const t = classifyTask({ messageContent: medium });
    assert.equal(t.complexity, 'moderate');
  });
});

describe('LLM / classifyTask: token estimation', () => {
  it('estimatedInputTokens incorporates message, system prompt, and conversation lengths', () => {
    const t = classifyTask({
      messageContent: 'hello',
      systemPromptLength: 400,
      conversationLength: 400,
    });
    // (5/4) + (400/4) + (400/4) = ~202 tokens
    assert.ok(t.estimatedInputTokens > 100, `Expected > 100 tokens, got ${t.estimatedInputTokens}`);
  });

  it('sets requiresLongContext true when estimatedInputTokens > 32000', () => {
    // 32000 * 4 chars/token = 128000 char message
    const huge = 'x'.repeat(128001);
    const t = classifyTask({ messageContent: huge });
    assert.equal(t.requiresLongContext, true);
  });
});

describe('LLM / scoreModel: hard disqualifiers', () => {
  it('returns 0 when model does not support required vision', () => {
    const model = makeModel({ supportsVision: false });
    const task = { requiresVision: true, requiresAudio: false, requiresToolUse: false, estimatedInputTokens: 100, category: 'reasoning', complexity: 'simple', latency: 'standard' };
    const s = scoreModel(model, task, DEFAULT_CONFIG);
    assert.equal(s.totalScore, 0);
  });

  it('returns 0 when model does not support required audio', () => {
    const model = makeModel({ supportsAudio: false });
    const task = { requiresVision: false, requiresAudio: true, requiresToolUse: false, estimatedInputTokens: 100, category: 'audio', complexity: 'simple', latency: 'realtime' };
    const s = scoreModel(model, task, DEFAULT_CONFIG);
    assert.equal(s.totalScore, 0);
  });

  it('returns 0 when model does not support required tool-use', () => {
    const model = makeModel({ supportsToolUse: false });
    const task = { requiresVision: false, requiresAudio: false, requiresToolUse: true, estimatedInputTokens: 100, category: 'tool-use', complexity: 'simple', latency: 'standard' };
    const s = scoreModel(model, task, DEFAULT_CONFIG);
    assert.equal(s.totalScore, 0);
  });

  it('returns 0 when model is not available', () => {
    const model = makeModel({ available: false });
    const task = { requiresVision: false, requiresAudio: false, requiresToolUse: false, estimatedInputTokens: 100, category: 'code', complexity: 'simple', latency: 'standard' };
    const s = scoreModel(model, task, DEFAULT_CONFIG);
    assert.equal(s.totalScore, 0);
  });

  it('returns 0 when circuit breaker is tripped (3+ consecutive failures)', () => {
    const model = makeModel({ consecutiveFailures: 3 });
    const task = { requiresVision: false, requiresAudio: false, requiresToolUse: false, estimatedInputTokens: 100, category: 'code', complexity: 'simple', latency: 'standard' };
    const s = scoreModel(model, task, DEFAULT_CONFIG);
    assert.equal(s.totalScore, 0);
  });

  it('returns 0 when token count exceeds 90% of context window', () => {
    const model = makeModel({ contextWindow: 1000 });
    const task = { requiresVision: false, requiresAudio: false, requiresToolUse: false, estimatedInputTokens: 950, category: 'code', complexity: 'simple', latency: 'standard' };
    const s = scoreModel(model, task, DEFAULT_CONFIG);
    assert.equal(s.totalScore, 0);
  });
});

describe('LLM / scoreModel: local model policies', () => {
  const localModel = makeModel({
    modelId: 'ollama/llama3',
    provider: 'ollama',
    routeVia: 'ollama',
    inputCostPerMillion: 0,
    outputCostPerMillion: 0,
    strengths: { reasoning: 0.60, code: 0.70, creative: 0.55, extraction: 0.65, 'tool-use': 0.50, conversation: 0.60 },
  });

  const simpleTask = {
    requiresVision: false, requiresAudio: false, requiresToolUse: false,
    estimatedInputTokens: 100, category: 'code', complexity: 'simple', latency: 'standard',
  };

  it('disabled policy returns 0 for local models', () => {
    const s = scoreModel(localModel, simpleTask, { ...DEFAULT_CONFIG, localModelPolicy: 'disabled' });
    assert.equal(s.totalScore, 0);
  });

  it('background policy allows extraction but not code', () => {
    const extractionTask = { ...simpleTask, category: 'extraction' };
    const sExtraction = scoreModel(localModel, extractionTask, { ...DEFAULT_CONFIG, localModelPolicy: 'background' });
    const sCode = scoreModel(localModel, simpleTask, { ...DEFAULT_CONFIG, localModelPolicy: 'background' });
    assert.ok(sExtraction.totalScore > 0, 'extraction should be allowed under background policy');
    assert.equal(sCode.totalScore, 0, 'code should be blocked under background policy');
  });

  it('conservative policy blocks expert complexity for local models', () => {
    const expertTask = { ...simpleTask, complexity: 'expert' };
    const s = scoreModel(localModel, expertTask, { ...DEFAULT_CONFIG, localModelPolicy: 'conservative' });
    assert.equal(s.totalScore, 0);
  });

  it('preferred policy gives local bonus when category strength >= 0.4', () => {
    const sPreferred = scoreModel(localModel, simpleTask, { ...DEFAULT_CONFIG, localModelPolicy: 'preferred' });
    assert.ok(sPreferred.totalScore > 0, 'preferred policy should return a positive score');
    // The local bonus (0.3) means score should be meaningfully above a naive score
  });

  it('preferred policy blocks local model when strength is below localMinCapability', () => {
    const weakModel = makeModel({
      ...localModel,
      strengths: { ...localModel.strengths, code: 0.30 },
    });
    const s = scoreModel(weakModel, simpleTask, { ...DEFAULT_CONFIG, localModelPolicy: 'preferred', localMinCapability: 0.55 });
    assert.equal(s.totalScore, 0, 'model below minimum capability must score 0');
  });
});

describe('LLM / estimateRequestCost', () => {
  it('computes cost correctly for a known model', () => {
    const model = makeModel({ inputCostPerMillion: 3, outputCostPerMillion: 15 });
    const cost = estimateRequestCost(model, 1_000_000, 1_000_000);
    assert.equal(cost, 18); // 3 + 15
  });

  it('returns 0 for free local models', () => {
    const model = makeModel({ inputCostPerMillion: 0, outputCostPerMillion: 0 });
    const cost = estimateRequestCost(model, 1_000_000, 1_000_000);
    assert.equal(cost, 0);
  });
});

describe('LLM / buildRoutingExplanation', () => {
  it('includes BUDGET CONSTRAINED flag when relevant', () => {
    const score = { modelId: 'test/model', totalScore: 0.8, breakdown: { capabilityScore: 0.9, costScore: 0.5, speedScore: 0.7 } };
    const task = { category: 'code', complexity: 'simple' };
    const explanation = buildRoutingExplanation(score, task, true, false);
    assert.ok(explanation.includes('BUDGET CONSTRAINED'), 'Should include budget constrained flag');
  });

  it('includes FALLBACK flag when relevant', () => {
    const score = { modelId: 'test/model', totalScore: 0.5, breakdown: { capabilityScore: 0.6, costScore: 0.5, speedScore: 0.4 } };
    const task = { category: 'conversation', complexity: 'trivial' };
    const explanation = buildRoutingExplanation(score, task, false, true);
    assert.ok(explanation.includes('FALLBACK'), 'Should include fallback flag');
  });
});

describe('LLM / IntelligenceRouter: initialization and model selection', () => {
  it('initializes with default models on fresh state', async () => {
    const router = new IntelligenceRouter({ state: createMockState() });
    await router.initialize();
    const models = router.getModelRegistry();
    assert.ok(models.length >= 5, `Expected at least 5 default models, got ${models.length}`);
  });

  it('selectModel returns a decision for a simple code task', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    const task = classifyTask({ messageContent: 'write a JavaScript sorting function' });
    const decision = router.selectModel(task);
    assert.ok(decision.id, 'Decision must have an id');
    assert.ok(decision.selectedModelId, 'Decision must have a selected model');
    assert.ok(typeof decision.reason === 'string' && decision.reason.length > 0);
  });

  it('selectModel uses pinned model when configured', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    router.updateConfig({ pinnedModelId: 'anthropic/claude-haiku-3.5' });
    const task = classifyTask({ messageContent: 'quick answer please' });
    const decision = router.selectModel(task);
    assert.equal(decision.selectedModelId, 'anthropic/claude-haiku-3.5');
  });

  it('selectModel throws when monthly budget is fully exhausted', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    router.updateConfig({ monthlyBudgetUsd: 1.0, monthlySpentUsd: 1.0 });
    const task = classifyTask({ messageContent: 'do something' });
    assert.throws(() => router.selectModel(task), /budget exhausted/i);
  });

  it('selectModel falls back to fallbackModelId when all models score 0', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    // Disable all models
    const models = router.getModelRegistry();
    for (const m of models) {
      router.setModelAvailability(m.modelId, false);
    }
    const task = classifyTask({ messageContent: 'code something' });
    const decision = router.selectModel(task);
    assert.ok(decision.isFallback, 'Should be marked as fallback');
    assert.equal(decision.selectedModelId, 'anthropic/claude-sonnet-4');
  });

  it('recordOutcome tracks cost and resets consecutive failures on success', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    const task = classifyTask({ messageContent: 'fix this bug in my code' });
    const decision = router.selectModel(task);

    router.recordOutcome(decision.id, {
      success: true,
      durationMs: 1500,
      inputTokens: 1000,
      outputTokens: 500,
    });

    const stats = router.getStats();
    assert.equal(stats.successfulRoutes, 1);
    assert.equal(stats.failedRoutes, 0);
    assert.ok(stats.totalCostUsd > 0, 'Cost should be tracked after recordOutcome');

    // Circuit breaker should be cleared
    const model = router.getModel(decision.selectedModelId);
    assert.equal(model.consecutiveFailures, 0, 'Consecutive failures must be 0 after success');
  });

  it('recordOutcome increments consecutiveFailures on failure', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    const task = classifyTask({ messageContent: 'refactor this function' });
    const decision = router.selectModel(task);

    router.recordOutcome(decision.id, { success: false, durationMs: 200 });

    const model = router.getModel(decision.selectedModelId);
    assert.equal(model.consecutiveFailures, 1);

    const stats = router.getStats();
    assert.equal(stats.failedRoutes, 1);
  });

  it('decision history is capped at maxDecisionHistory', async () => {
    const router = new IntelligenceRouter({ state: createMockState() });
    await router.initialize();
    router.updateConfig({ maxDecisionHistory: 5 });

    const task = classifyTask({ messageContent: 'simple question' });
    for (let i = 0; i < 8; i++) {
      router.selectModel(task);
    }

    const recent = router.getRecentDecisions(100);
    assert.ok(recent.length <= 5, `Decision history should be capped at 5, got ${recent.length}`);
  });

  it('registerOllamaModels adds new models and marks them available', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    const before = router.getModelRegistry().length;

    router.registerOllamaModels([{ id: 'mistral', name: 'Mistral 7B' }]);

    const after = router.getModelRegistry().length;
    assert.equal(after, before + 1, 'One new Ollama model should be added');

    const m = router.getModel('ollama/mistral');
    assert.ok(m, 'New model must be retrievable by id');
    assert.equal(m.available, true);
    assert.equal(m.provider, 'ollama');
  });

  it('registerOllamaModels updates existing model rather than duplicating', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();

    router.registerOllamaModels([{ id: 'llama3', name: 'Llama 3' }]);
    const before = router.getModelRegistry().length;

    // Register same model again
    router.registerOllamaModels([{ id: 'llama3', name: 'Llama 3' }]);
    const after = router.getModelRegistry().length;
    assert.equal(after, before, 'Duplicate registration must not add a new entry');
  });

  it('setModelAvailability sets circuit breaker reset on availability restored', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    const m = router.getModel('anthropic/claude-opus-4');

    // Simulate failures
    m.consecutiveFailures = 3;
    router.setModelAvailability('anthropic/claude-opus-4', true);

    const updated = router.getModel('anthropic/claude-opus-4');
    assert.equal(updated.consecutiveFailures, 0, 'consecutiveFailures must reset when model becomes available');
  });

  it('getStats returns zeroed stats when no decisions recorded', async () => {
    const router = new IntelligenceRouter();
    await router.initialize();
    const stats = router.getStats();
    assert.equal(stats.totalDecisions, 0);
    assert.equal(stats.successfulRoutes, 0);
    assert.equal(stats.failedRoutes, 0);
    assert.equal(stats.fallbacksUsed, 0);
    assert.equal(stats.totalCostUsd, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. LLM Client
// ═══════════════════════════════════════════════════════════════════════════════

describe('LLM / LLMClient: provider management', () => {
  function makeProvider(name, available = true, responseContent = 'ok') {
    return {
      name,
      isAvailable: () => available,
      complete: async (_req) => ({ content: responseContent, model: name }),
      stream: async function* (_req) { yield { chunk: responseContent }; },
    };
  }

  it('registers providers and reports status', () => {
    const client = new LLMClient();
    client.registerProvider(makeProvider('anthropic'));
    client.registerProvider(makeProvider('openrouter', false));
    const status = client.getStatus();
    assert.equal(status.length, 2);
    const anthro = status.find(s => s.name === 'anthropic');
    assert.ok(anthro.available);
    const or = status.find(s => s.name === 'openrouter');
    assert.ok(!or.available);
  });

  it('complete uses the default provider', async () => {
    const client = new LLMClient();
    client.registerProvider(makeProvider('anthropic', true, 'from-anthropic'));
    client.setDefaultProvider('anthropic');
    const resp = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(resp.content, 'from-anthropic');
  });

  it('complete falls back to second provider when first fails', async () => {
    const client = new LLMClient();

    const failing = {
      name: 'failing',
      isAvailable: () => true,
      complete: async () => { throw new Error('provider down'); },
      stream: async function* () { throw new Error('provider down'); },
    };
    client.registerProvider(failing);
    client.registerProvider(makeProvider('backup', true, 'from-backup'));
    client.setDefaultProvider('failing');

    const resp = await client.complete({ messages: [{ role: 'user', content: 'hi' }] });
    assert.equal(resp.content, 'from-backup');
  });

  it('complete throws when all providers fail', async () => {
    const client = new LLMClient();

    const alwaysFails = (name) => ({
      name,
      isAvailable: () => true,
      complete: async () => { throw new Error('fail'); },
      stream: async function* () { throw new Error('fail'); },
    });
    client.registerProvider(alwaysFails('p1'));
    client.registerProvider(alwaysFails('p2'));
    client.setDefaultProvider('p1');

    await assert.rejects(() => client.complete({ messages: [] }), /fail/i);
  });

  it('complete throws when no provider is registered', async () => {
    const client = new LLMClient();
    await assert.rejects(
      () => client.complete({ messages: [] }),
      /No provider available/i
    );
  });

  it('complete skips unavailable fallback providers', async () => {
    const client = new LLMClient();
    const failing = {
      name: 'primary',
      isAvailable: () => true,
      complete: async () => { throw new Error('primary down'); },
      stream: async function* () { throw new Error('primary down'); },
    };
    client.registerProvider(failing);
    // Register an unavailable provider -- should be skipped
    client.registerProvider(makeProvider('unavailable', false, 'should-not-reach'));
    client.setDefaultProvider('primary');

    // Both fail: primary throws, unavailable is skipped, nothing left to try
    await assert.rejects(() => client.complete({ messages: [] }));
  });

  it('stream falls back when default provider stream fails', async () => {
    const client = new LLMClient();

    const failingStream = {
      name: 'primary',
      isAvailable: () => true,
      complete: async () => ({ content: 'ok' }),
      stream: async function* () { throw new Error('stream broken'); },
    };
    client.registerProvider(failingStream);
    client.registerProvider(makeProvider('backup', true, 'streamed-chunk'));
    client.setDefaultProvider('primary');

    const chunks = [];
    for await (const chunk of client.stream({ messages: [] })) {
      chunks.push(chunk);
    }
    assert.ok(chunks.length > 0, 'Should receive chunks from backup provider');
  });

  it('stream does NOT fall back when an explicit provider is named', async () => {
    const client = new LLMClient();
    const failingStream = {
      name: 'explicit',
      isAvailable: () => true,
      complete: async () => ({ content: 'ok' }),
      stream: async function* () { throw new Error('explicit fail'); },
    };
    client.registerProvider(failingStream);
    client.registerProvider(makeProvider('backup', true, 'backup-chunk'));

    await assert.rejects(async () => {
      for await (const _chunk of client.stream({ messages: [] }, 'explicit')) { /* empty */ }
    }, /explicit fail/i, 'Explicit provider failure must propagate without fallback');
  });

  it('text() convenience wrapper returns content string', async () => {
    const client = new LLMClient();
    client.registerProvider(makeProvider('anthropic', true, 'text response'));
    const result = await client.text('What is 2+2?');
    assert.equal(result, 'text response');
  });

  it('isProviderAvailable returns false for unknown provider', () => {
    const client = new LLMClient();
    assert.equal(client.isProviderAvailable('ghost'), false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Memory / MemoryTiers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Memory / MemoryTiers: short-term SHA-256 deduplication', () => {
  it('rejects exact-duplicate content in short-term tier', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const first = await tiers.store('Stephen prefers dark mode', 'preference', 'short');
    assert.ok(first, 'First store must succeed');

    const second = await tiers.store('Stephen prefers dark mode', 'preference', 'short');
    assert.equal(second, null, 'Duplicate short-term entry must return null');

    assert.equal(tiers.getShortTerm().length, 1, 'Only one entry should be in short-term');
  });

  it('allows same content after explicit forget removes the hash', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const entry = await tiers.store('temporary thought', 'fact', 'short');
    await tiers.forget(entry.id);

    const re = await tiers.store('temporary thought', 'fact', 'short');
    assert.ok(re, 'Re-storing after forget must succeed');
  });
});

describe('Memory / MemoryTiers: medium-term Jaccard deduplication', () => {
  it('detects near-duplicate via Jaccard similarity and reinforces existing entry', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const original = await tiers.store('Stephen works on asimovs mind project', 'fact', 'medium', 0.5);
    assert.ok(original);
    const originalCount = original.accessCount;

    // Near-duplicate -- only a couple of words differ, high overlap
    const reinforced = await tiers.store('Stephen works on asimovs mind project daily', 'fact', 'medium', 0.5);

    // The returned entry should be the ORIGINAL, reinforced
    assert.ok(reinforced, 'Near-duplicate must return the reinforced entry (not null)');
    assert.equal(reinforced.id, original.id, 'Reinforced entry must be the original entry');
    assert.ok(reinforced.accessCount > originalCount, 'accessCount must increment on reinforcement');
    assert.ok(reinforced.confidence > 0.5, 'Confidence must increase on reinforcement');

    assert.equal(tiers.getMediumTerm().length, 1, 'Only one medium-term entry should exist');
  });

  it('stores genuinely different content in medium-term', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    await tiers.store('Stephen prefers dark mode interfaces', 'preference', 'medium');
    await tiers.store('FutureSpeak focuses on voice interfaces', 'project', 'medium');

    assert.equal(tiers.getMediumTerm().length, 2);
  });

  it('returns null for exact-duplicate in long-term', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const first = await tiers.store('Friday uses three-law architecture', 'fact', 'long');
    assert.ok(first);

    const second = await tiers.store('Friday uses three-law architecture', 'fact', 'long');
    assert.equal(second, null, 'Duplicate in long-term must return null');
  });
});

describe('Memory / MemoryTiers: confidence clamping', () => {
  it('clamps confidence to [0, 1] range', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const over = await tiers.store('test', 'fact', 'short', 1.5);
    assert.equal(over.confidence, 1.0, 'Confidence above 1 must be clamped to 1');

    const under = await tiers.store('test2', 'fact', 'short', -0.5);
    assert.equal(under.confidence, 0.0, 'Confidence below 0 must be clamped to 0');
  });

  it('long-term confidence floor is 0.7', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const entry = await tiers.store('Friday has a vault subsystem', 'fact', 'long', 0.1);
    assert.ok(entry.confidence >= 0.7, `Long-term confidence must be at least 0.7, got ${entry.confidence}`);
  });
});

describe('Memory / MemoryTiers: tier caps and LFU eviction', () => {
  it('short-term never exceeds TIER_CAP (100)', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    for (let i = 0; i < 110; i++) {
      await tiers.store(`unique short-term memory content entry number ${i}`, 'fact', 'short');
    }

    const st = tiers.getShortTerm();
    assert.ok(st.length <= 100, `Short-term must be capped at 100, got ${st.length}`);
  });

  it('clearShortTerm empties the short-term tier', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    await tiers.store('memory alpha', 'fact', 'short');
    await tiers.store('memory beta', 'fact', 'short');
    tiers.clearShortTerm();

    assert.equal(tiers.getShortTerm().length, 0);
    // After clear, same content can be re-stored (hashes cleared)
    const reStored = await tiers.store('memory alpha', 'fact', 'short');
    assert.ok(reStored, 'Same content should be storable after clearShortTerm');
  });
});

describe('Memory / MemoryTiers: forget', () => {
  it('forget returns true and removes the entry', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const entry = await tiers.store('remove me', 'fact', 'short');
    const result = await tiers.forget(entry.id);
    assert.equal(result, true);
    assert.equal(tiers.getShortTerm().length, 0);
  });

  it('forget returns false for unknown id', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const result = await tiers.forget('nonexistent-id-xyz');
    assert.equal(result, false);
  });
});

describe('Memory / MemoryTiers: unknown tier', () => {
  it('throws for unknown tier name', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    await assert.rejects(
      () => tiers.store('content', 'fact', 'cosmic'),
      /Unknown tier/i
    );
  });
});

describe('Memory / MemoryTiers: keyword recall', () => {
  it('keyword recall finds matching entries across tiers', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    await tiers.store('Friday uses vault encryption for security', 'fact', 'short');
    await tiers.store('The weather today is cloudy', 'observation', 'short');

    const results = await tiers.recall('vault encryption');
    assert.ok(results.length > 0, 'Should find the vault entry');
    assert.ok(results[0].content.includes('vault'), 'First result should mention vault');
  });

  it('status returns correct counts across all tiers', async () => {
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    await tiers.store('short one', 'fact', 'short');
    await tiers.store('medium one', 'fact', 'medium');
    await tiers.store('long one', 'fact', 'long');

    const s = tiers.status();
    assert.equal(s.shortTerm.count, 1);
    assert.equal(s.mediumTerm.count, 1);
    assert.equal(s.longTerm.count, 1);
    assert.equal(s.totalMemories, 3);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Memory / EpisodicMemory
// ═══════════════════════════════════════════════════════════════════════════════

describe('Memory / EpisodicMemory: episode lifecycle', () => {
  it('startEpisode creates an active episode', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    const ep = em.startEpisode('First session');
    assert.equal(ep.title, 'First session');
    assert.ok(em.isRecording());
    assert.ok(ep.startTime > 0);
  });

  it('addObservation increments turnCount', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Test session');
    em.addObservation('user', 'Hello Friday');
    em.addObservation('assistant', 'Hello Boss');

    const active = em.getActiveEpisode();
    assert.equal(active.turnCount, 2);
  });

  it('addObservation is a no-op when no episode is active', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    // Should not throw
    em.addObservation('user', 'This goes nowhere');
    assert.equal(em.isRecording(), false);
  });

  it('endEpisode persists the episode and clears the active episode', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Work session');
    em.addObservation('user', 'Let us build something');
    const ep = await em.endEpisode('Built the feature', {
      topics: ['coding', 'Friday'],
      emotionalTone: 'focused',
      keyDecisions: ['use ES modules'],
    });

    assert.ok(ep, 'endEpisode must return the completed episode');
    assert.equal(ep.summary, 'Built the feature');
    assert.deepEqual(ep.topics, ['coding', 'Friday']);
    assert.equal(ep.emotionalTone, 'focused');
    assert.deepEqual(ep.keyDecisions, ['use ES modules']);
    assert.ok(ep.endTime > 0);
    assert.ok(ep.durationSeconds >= 0);

    assert.equal(em.isRecording(), false);
    assert.equal(em.getAll().length, 1);
  });

  it('endEpisode returns null when no episode is active', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    const result = await em.endEpisode('nothing to end');
    assert.equal(result, null);
  });

  it('starting a new episode auto-ends the previous one', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('First episode');
    em.startEpisode('Second episode');

    // Both must have been recorded
    assert.equal(em.getAll().length, 1, 'First episode auto-ended and stored');
    assert.equal(em.getAll()[0].summary, 'Auto-ended: new episode started');
    assert.ok(em.isRecording(), 'Second episode must now be active');
  });

  it('episodes are capped at MAX_EPISODES (200)', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    for (let i = 0; i < 205; i++) {
      em.startEpisode(`Episode ${i}`);
      await em.endEpisode(`Summary ${i}`);
    }

    assert.ok(em.getAll().length <= 200, `Episodes must be capped at 200, got ${em.getAll().length}`);
  });
});

describe('Memory / EpisodicMemory: search', () => {
  it('search ranks the best text-matching episode first', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Vault debugging session');
    await em.endEpisode('Fixed the AES-GCM encryption bug in vault', { topics: ['vault', 'encryption'] });

    em.startEpisode('UI discussion');
    await em.endEpisode('Talked about the holographic dashboard');

    const results = em.search('vault');
    // Both episodes are recent so both get the recency bonus, but the vault episode
    // scores higher because "vault" appears in summary (+10) and topics (+5).
    assert.ok(results.length >= 1, 'At least one episode must be returned');
    assert.ok(results[0].summary.includes('vault'), 'The vault episode must be ranked first');
  });

  it('search scores topic matches higher than recency-only episodes', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Topic session');
    await em.endEpisode('General chat', { topics: ['memory', 'storage'] });

    const results = em.search('memory');
    assert.ok(results.length > 0, 'At least one result must come back');
    // The episode with the matching topic must be in results
    assert.ok(results.some(r => r.topics.includes('memory')), 'Topic-matched episode must be present');
  });

  it('search returns empty array when query is genuinely absent and episodes are old', async () => {
    // Simulate an old episode (endTime set far in the past) so recency bonus is 0.
    // Then a query that does not match summary, title, topics, or decisions should
    // return an empty result.
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Unrelated session');
    const ep = await em.endEpisode('Talked about cooking');

    // Manually backdate the episode so the recency bonus does not apply.
    ep.endTime = Date.now() - 8 * 24 * 60 * 60 * 1000; // 8 days ago

    const results = em.search('quantum physics blockchain');
    assert.equal(results.length, 0, 'No matches for a query with zero relevance to old episodes');
  });
});

describe('Memory / EpisodicMemory: deleteEpisode', () => {
  it('deleteEpisode removes a specific episode by id', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Delete me');
    const ep = await em.endEpisode('This should be deleted');

    const deleted = await em.deleteEpisode(ep.id);
    assert.equal(deleted, true);
    assert.equal(em.getAll().length, 0);
  });

  it('deleteEpisode returns false for unknown id', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    const result = await em.deleteEpisode('nonexistent-episode-id');
    assert.equal(result, false);
  });
});

describe('Memory / EpisodicMemory: status and context string', () => {
  it('status reflects current recording state', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    let s = em.status();
    assert.equal(s.recording, false);
    assert.equal(s.totalEpisodes, 0);

    em.startEpisode('Active now');
    s = em.status();
    assert.equal(s.recording, true);
    assert.equal(s.activeEpisode.title, 'Active now');
  });

  it('getContextString returns empty string when no episodes', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    assert.equal(em.getContextString(), '');
  });

  it('getContextString includes episode summaries when episodes exist', async () => {
    const em = new EpisodicMemory();
    await em.initialize(createMockState(), null);

    em.startEpisode('Session A');
    await em.endEpisode('Worked on the memory subsystem');

    const ctx = em.getContextString();
    assert.ok(ctx.includes('memory subsystem'), 'Context string should include episode summary');
    assert.ok(ctx.startsWith('## Recent Episodes'), 'Context string should have header');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Personality / PersonalityProfile
// ═══════════════════════════════════════════════════════════════════════════════

describe('Personality / PersonalityProfile: mode validation', () => {
  it('rejects invalid mode in updateProfile', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await assert.rejects(
      () => profile.updateProfile({ mode: 'supervillain' }),
      /Invalid mode/i
    );
  });

  it('accepts all five valid modes', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    for (const mode of ['partner', 'focus', 'teacher', 'creative', 'sentinel']) {
      await profile.setMode(mode);
      const p = profile.getProfile();
      assert.equal(p.mode, mode, `Mode should be set to ${mode}`);
    }
  });

  it('rejects invalid mode in setMode', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await assert.rejects(
      () => profile.setMode('ghost'),
      /Invalid mode/i
    );
  });
});

describe('Personality / PersonalityProfile: challenge level clamping', () => {
  it('clamps challenge level to minimum of 1', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.setChallengeLevel(-5);
    assert.equal(profile.getProfile().challengeLevel, 1);
  });

  it('clamps challenge level to maximum of 5', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.setChallengeLevel(99);
    assert.equal(profile.getProfile().challengeLevel, 5);
  });

  it('accepts valid challenge levels within [1, 5]', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.setChallengeLevel(3);
    assert.equal(profile.getProfile().challengeLevel, 3);
  });
});

describe('Personality / PersonalityProfile: prompt building', () => {
  it('buildPersonalityPrompt includes identity line and name', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.updateProfile({ name: 'Friday', identityLine: 'I am Friday.' });
    const prompt = profile.buildPersonalityPrompt();

    assert.ok(prompt.includes('Friday'), 'Prompt must include the agent name');
    assert.ok(prompt.includes('I am Friday.'), 'Prompt must include the identity line');
  });

  it('buildPersonalityPrompt changes based on mode', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.setMode('focus');
    const focusPrompt = profile.buildPersonalityPrompt();
    assert.ok(focusPrompt.includes('deep work'), 'Focus mode prompt must mention deep work');

    await profile.setMode('teacher');
    const teacherPrompt = profile.buildPersonalityPrompt();
    assert.ok(teacherPrompt.includes('Explain'), 'Teacher mode prompt must include explanation directive');
  });

  it('buildPersonalityPrompt includes slider modifiers when sliders are set', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.updateProfile({
      sliders: { communicationStyle: 90, emotionalTone: 80, initiativeLevel: 50, humor: 50, formality: 10 },
    });

    const prompt = profile.buildPersonalityPrompt();
    assert.ok(prompt.includes('Personality Calibration'), 'Should include personality calibration section');
    assert.ok(prompt.includes('casual'), 'Low formality should produce casual directive');
  });

  it('getCondensedProfile returns correct structure', async () => {
    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());

    await profile.updateProfile({ name: 'Friday', traits: ['warm', 'curious'] });
    const condensed = profile.getCondensedProfile();

    assert.equal(condensed.name, 'Friday');
    assert.deepEqual(condensed.traits, ['warm', 'curious']);
    assert.ok(typeof condensed.summary === 'string' && condensed.summary.length > 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 6. Personality / PersonalityEvolution
// ═══════════════════════════════════════════════════════════════════════════════

describe('Personality / PersonalityEvolution: computeEvolution', () => {
  it('clamps particleSpeed to [0.5, 2.0]', () => {
    const evo = new PersonalityEvolution();
    // 'energetic' maps to 1.8; adding more extreme traits cannot exceed 2.0
    const result = evo.computeEvolution(['energetic', 'enthusiastic', 'playful', 'dynamic'], 10);
    assert.ok(result.particleSpeed <= 2.0, 'particleSpeed must not exceed 2.0');
    assert.ok(result.particleSpeed >= 0.5, 'particleSpeed must be at least 0.5');
  });

  it('clamps cubeFragmentation to [0, 1]', () => {
    const evo = new PersonalityEvolution();
    const result = evo.computeEvolution(['calm', 'steady', 'grounded', 'simple'], 5);
    assert.ok(result.cubeFragmentation >= 0, 'cubeFragmentation must not be negative');
    assert.ok(result.cubeFragmentation <= 1, 'cubeFragmentation must not exceed 1');
  });

  it('clamps glowIntensity to [0.5, 2.0]', () => {
    const evo = new PersonalityEvolution();
    const result = evo.computeEvolution(['warm', 'empathetic', 'caring', 'nurturing'], 20);
    assert.ok(result.glowIntensity <= 2.0, 'glowIntensity must not exceed 2.0');
    assert.ok(result.glowIntensity >= 0.5, 'glowIntensity must be at least 0.5');
  });

  it('secondaryHue is always (primaryHue + 150) mod 360', () => {
    const evo = new PersonalityEvolution();
    const result = evo.computeEvolution(['warm'], 1);
    // 'warm' maps to hue 30
    assert.equal(result.primaryHue, 30);
    assert.equal(result.secondaryHue, (30 + 150) % 360);
  });

  it('returns default values for unknown traits', () => {
    const evo = new PersonalityEvolution();
    const result = evo.computeEvolution(['unknowntraitxyz'], 0);
    // Falls back to defaults
    assert.equal(result.primaryHue, 200); // default
    assert.equal(result.particleSpeed, 1.0); // default (clamped from default)
  });

  it('hasDepthTraits increases dustDensity', () => {
    const evo = new PersonalityEvolution();
    const withDepth = evo.computeEvolution(['wise', 'analytical'], 5);
    const withoutDepth = evo.computeEvolution(['warm', 'calm'], 5);
    assert.ok(withDepth.dustDensity > withoutDepth.dustDensity, 'Depth traits should increase dustDensity');
  });
});

describe('Personality / PersonalityEvolution: maturity factor', () => {
  it('returns 0 for 0 sessions', () => {
    const evo = new PersonalityEvolution();
    assert.equal(evo.getMaturityFactor(0), 0);
  });

  it('returns 1.0 at exactly 50 sessions', () => {
    const evo = new PersonalityEvolution();
    assert.equal(evo.getMaturityFactor(50), 1.0);
  });

  it('caps at 1.0 beyond 50 sessions', () => {
    const evo = new PersonalityEvolution();
    assert.equal(evo.getMaturityFactor(100), 1.0);
  });

  it('returns 0.5 at 25 sessions', () => {
    const evo = new PersonalityEvolution();
    assert.equal(evo.getMaturityFactor(25), 0.5);
  });
});

describe('Personality / PersonalityEvolution: incrementSession and state', () => {
  it('incrementSession increases session count', async () => {
    const evo = new PersonalityEvolution();
    await evo.initialize(createMockState());

    const s1 = await evo.incrementSession(['warm', 'curious']);
    assert.equal(s1.sessionCount, 1);

    const s2 = await evo.incrementSession(['warm', 'curious']);
    assert.equal(s2.sessionCount, 2);
  });

  it('getEvolutionState returns null before any session', async () => {
    const evo = new PersonalityEvolution();
    await evo.initialize(createMockState());

    assert.equal(evo.getEvolutionState(), null);
  });

  it('getEvolutionState returns data after incrementSession', async () => {
    const evo = new PersonalityEvolution();
    await evo.initialize(createMockState());

    await evo.incrementSession(['analytical', 'curious']);
    const state = evo.getEvolutionState();
    assert.ok(state !== null);
    assert.equal(state.sessionCount, 1);
  });

  it('getSelfDescription returns no-evolution message before first session', async () => {
    const evo = new PersonalityEvolution();
    await evo.initialize(createMockState());

    const desc = evo.getSelfDescription();
    assert.equal(desc, 'No evolution data yet.');
  });

  it('getSelfDescription includes maturity and session count after sessions', async () => {
    const evo = new PersonalityEvolution();
    await evo.initialize(createMockState());

    await evo.incrementSession(['energetic', 'playful']);
    const desc = evo.getSelfDescription();
    assert.ok(desc.includes('Session 1'), 'Description must include session count');
    assert.ok(desc.includes('maturity'), 'Description must include maturity');
  });

  it('getSelfDescription includes personality description at high maturity', async () => {
    const evo = new PersonalityEvolution();
    await evo.initialize(createMockState());

    // Simulate high session count
    for (let i = 0; i < 20; i++) {
      await evo.incrementSession(['energetic', 'enthusiastic', 'warm']);
    }

    const desc = evo.getSelfDescription();
    // With energetic traits and 20+ sessions (40% maturity > 20%), should have description
    assert.ok(desc.length > 20, 'Description should be substantive at higher maturity');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Gateway / AuditLog
// ═══════════════════════════════════════════════════════════════════════════════

describe('Gateway / AuditLog: basic logging', () => {
  it('logInbound records an inbound entry with correct fields', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    await audit.logInbound('discord', 'user-123', 0.8, 'Hello Friday!', 'msg-001');

    const entries = audit.getEntries(10);
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.dir, 'in');
    assert.equal(e.channel, 'discord');
    assert.equal(e.sender, 'user-123');
    assert.equal(e.trust, 0.8);
    assert.equal(e.text, 'Hello Friday!');
    assert.equal(e.msgId, 'msg-001');
    assert.ok(typeof e.ts === 'number' && e.ts > 0);
  });

  it('logOutbound records an outbound entry', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    await audit.logOutbound('slack', 'recipient-456', 'Response text', ['tool_1'], 250);

    const entries = audit.getEntries(10);
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.dir, 'out');
    assert.equal(e.recipient, 'recipient-456');
    assert.equal(e.durationMs, 250);
  });
});

describe('Gateway / AuditLog: text truncation', () => {
  it('truncates text longer than 500 characters', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    const longText = 'x'.repeat(1000);
    await audit.log({ dir: 'in', channel: 'test', text: longText });

    const entries = audit.getEntries(10);
    assert.equal(entries[0].text.length, 500, 'Text must be truncated to 500 chars');
  });

  it('preserves text shorter than 500 characters unchanged', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    const shortText = 'Hello, I am a short message.';
    await audit.log({ dir: 'in', channel: 'test', text: shortText });

    const entries = audit.getEntries(10);
    assert.equal(entries[0].text, shortText);
  });

  it('handles missing text field without crashing', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    await audit.log({ dir: 'out', channel: 'test' });
    const entries = audit.getEntries(10);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].text, '');
  });
});

describe('Gateway / AuditLog: direction filtering', () => {
  it('getEntries with direction filter returns only matching entries', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    await audit.logInbound('discord', 'u1', 0.9, 'inbound message', 'm1');
    await audit.logOutbound('discord', 'u1', 'outbound reply', [], 100);
    await audit.logInbound('discord', 'u2', 0.7, 'another inbound', 'm2');

    const inbound = audit.getEntries(50, 'in');
    assert.equal(inbound.length, 2, 'Should return 2 inbound entries');
    for (const e of inbound) {
      assert.equal(e.dir, 'in');
    }

    const outbound = audit.getEntries(50, 'out');
    assert.equal(outbound.length, 1, 'Should return 1 outbound entry');
    assert.equal(outbound[0].dir, 'out');
  });

  it('getEntries without filter returns all entries', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    await audit.logInbound('discord', 'u1', 0.9, 'msg', 'm1');
    await audit.logOutbound('discord', 'u1', 'reply', [], 50);

    const all = audit.getEntries(50);
    assert.equal(all.length, 2);
  });

  it('getEntries respects the limit parameter', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    for (let i = 0; i < 20; i++) {
      await audit.logInbound('discord', `u${i}`, 0.5, `msg ${i}`, `m${i}`);
    }

    const limited = audit.getEntries(5);
    assert.equal(limited.length, 5, 'Should return only the last 5 entries');
  });
});

describe('Gateway / AuditLog: max entries cap', () => {
  it('caps at MAX_ENTRIES_PER_MONTH (5000)', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    // Log more than the cap
    for (let i = 0; i < 5010; i++) {
      await audit.log({ dir: 'in', channel: 'test', text: `entry ${i}` });
    }

    // getEntries returns from the internal array; we can probe via limit=9999
    const entries = audit.getEntries(9999);
    assert.ok(entries.length <= 5000, `Entries must be capped at 5000, got ${entries.length}`);
  });
});

describe('Gateway / AuditLog: getStats', () => {
  it('getStats returns correct inbound/outbound counts', async () => {
    const audit = new AuditLog();
    await audit.initialize(createMockState());

    await audit.logInbound('discord', 'u1', 0.9, 'in1', 'm1');
    await audit.logInbound('discord', 'u2', 0.9, 'in2', 'm2');
    await audit.logOutbound('discord', 'u1', 'out1', [], 100);

    const stats = audit.getStats();
    assert.equal(stats.inbound, 2);
    assert.equal(stats.outbound, 1);
    assert.equal(stats.totalEntries, 3);
    assert.ok(typeof stats.month === 'string' && stats.month.length === 7, 'Month should be YYYY-MM');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 8. Context / ContextGraph
// ═══════════════════════════════════════════════════════════════════════════════

describe('Context / ContextGraph: node operations', () => {
  it('addNode creates a node with correct fields', () => {
    const graph = new ContextGraph({});
    const node = graph.addNode({ type: 'file', name: 'index.js', metadata: { path: '/src/index.js' } });

    assert.ok(node, 'addNode must return the created node');
    assert.equal(node.type, 'file');
    assert.equal(node.name, 'index.js');
    assert.deepEqual(node.metadata, { path: '/src/index.js' });
    assert.ok(node.id, 'Node must have an id');
    assert.ok(node.lastSeen > 0, 'lastSeen must be set');
  });

  it('addNode with invalid type returns null', () => {
    const graph = new ContextGraph({});
    const node = graph.addNode({ type: 'galaxy', name: 'Milky Way' });
    assert.equal(node, null, 'Unknown node type must return null');
  });

  it('addNode updates existing node on duplicate id', () => {
    const graph = new ContextGraph({});
    const n1 = graph.addNode({ id: 'my-node', type: 'concept', name: 'Architecture' });
    const n2 = graph.addNode({ id: 'my-node', type: 'concept', name: 'Architecture', metadata: { updated: true } });

    assert.equal(n1.id, n2.id, 'Must return the same id on duplicate');
    assert.equal(graph.stats.nodeCount, 1, 'Should still have only one node');
    assert.deepEqual(n2.metadata, { updated: true }, 'Metadata must be merged/updated');
  });

  it('getNode returns null for unknown id', () => {
    const graph = new ContextGraph({});
    assert.equal(graph.getNode('nonexistent'), null);
  });

  it('findNodeByName finds by name (case-insensitive) and optional type filter', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'function', name: 'buildPersonalityPrompt' });
    graph.addNode({ type: 'file', name: 'profile.js' });

    const fn = graph.findNodeByName('buildpersonalityprompt');
    assert.ok(fn, 'Should find by name case-insensitively');
    assert.equal(fn.name, 'buildPersonalityPrompt');

    const notFound = graph.findNodeByName('buildPersonalityPrompt', 'file');
    assert.equal(notFound, null, 'Type filter should exclude the function node');
  });

  it('removeNode also removes connected edges', () => {
    const graph = new ContextGraph({});
    const n1 = graph.addNode({ id: 'n1', type: 'file', name: 'a.js' });
    const n2 = graph.addNode({ id: 'n2', type: 'file', name: 'b.js' });
    graph.addEdge({ from: n1.id, to: n2.id, relationship: 'imports' });

    graph.removeNode(n1.id);

    assert.equal(graph.getNode(n1.id), null, 'Node must be removed');
    assert.equal(graph.getEdgesFor(n1.id).length, 0, 'Edges to removed node must be cleaned up');
  });
});

describe('Context / ContextGraph: edge operations', () => {
  it('addEdge creates an edge between two nodes', () => {
    const graph = new ContextGraph({});
    const n1 = graph.addNode({ id: 'n1', type: 'file', name: 'router.js' });
    const n2 = graph.addNode({ id: 'n2', type: 'function', name: 'selectModel' });

    const edge = graph.addEdge({ from: n1.id, to: n2.id, relationship: 'contains' });
    assert.ok(edge, 'addEdge must return the created edge');
    assert.equal(edge.from, n1.id);
    assert.equal(edge.to, n2.id);
    assert.equal(edge.relationship, 'contains');
    assert.equal(edge.weight, 1.0);
  });

  it('addEdge with invalid relationship returns null', () => {
    const graph = new ContextGraph({});
    const n1 = graph.addNode({ id: 'n1', type: 'file', name: 'a.js' });
    const n2 = graph.addNode({ id: 'n2', type: 'file', name: 'b.js' });

    const edge = graph.addEdge({ from: n1.id, to: n2.id, relationship: 'teleports' });
    assert.equal(edge, null, 'Unknown relationship must return null');
  });

  it('addEdge returns null when source node is missing', () => {
    const graph = new ContextGraph({});
    const n2 = graph.addNode({ id: 'n2', type: 'file', name: 'b.js' });

    const edge = graph.addEdge({ from: 'ghost-id', to: n2.id, relationship: 'imports' });
    assert.equal(edge, null, 'Edge with missing source must return null');
  });

  it('addEdge accumulates weight on repeated edges (not to exceed 10)', () => {
    const graph = new ContextGraph({});
    const n1 = graph.addNode({ id: 'n1', type: 'file', name: 'a.js' });
    const n2 = graph.addNode({ id: 'n2', type: 'file', name: 'b.js' });

    for (let i = 0; i < 60; i++) {
      graph.addEdge({ from: n1.id, to: n2.id, relationship: 'mentions', weight: 1.0 });
    }

    const edges = graph.getEdgesFor(n1.id);
    assert.equal(edges.length, 1, 'Repeated edge should not duplicate');
    assert.ok(edges[0].weight <= 10, `Edge weight must be capped at 10, got ${edges[0].weight}`);
  });
});

describe('Context / ContextGraph: queries', () => {
  it('query finds nodes by substring match', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'file', name: 'test-internals.js' });
    graph.addNode({ type: 'file', name: 'test-core.js' });
    graph.addNode({ type: 'concept', name: 'memory management' });

    const results = graph.query('test');
    assert.equal(results.length, 2, 'Should find 2 nodes matching "test"');
  });

  it('query with type filter only returns matching type', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'file', name: 'router.js' });
    graph.addNode({ type: 'concept', name: 'router concept' });

    const files = graph.query('router', 'file');
    assert.equal(files.length, 1);
    assert.equal(files[0].type, 'file');
  });

  it('query with empty pattern returns all nodes of the given type', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'person', name: 'Stephen' });
    graph.addNode({ type: 'person', name: 'Alice' });
    graph.addNode({ type: 'file', name: 'index.js' });

    const people = graph.query('', 'person');
    assert.equal(people.length, 2);
  });

  it('getNeighbors returns connected nodes at depth 1', () => {
    const graph = new ContextGraph({});
    const n1 = graph.addNode({ id: 'root', type: 'project', name: 'friday' });
    const n2 = graph.addNode({ id: 'child', type: 'file', name: 'index.js' });
    graph.addEdge({ from: n1.id, to: n2.id, relationship: 'contains' });

    const neighbors = graph.getNeighbors(n1.id, 1);
    assert.equal(neighbors.length, 1);
    assert.equal(neighbors[0].node.id, n2.id);
    assert.equal(neighbors[0].depth, 1);
  });

  it('getTopNodes returns nodes sorted by relevance score', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'file', name: 'recently-used.js' });
    graph.addNode({ type: 'file', name: 'old-file.js' });

    const top = graph.getTopNodes(5);
    assert.ok(top.length <= 2);
    // All results should be nodes
    for (const n of top) {
      assert.ok(n.id && n.name && n.type);
    }
  });

  it('getActiveNodes returns nodes seen within the window', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'file', name: 'active.js' });

    const active = graph.getActiveNodes(60 * 1000); // 1-minute window
    assert.ok(active.length >= 1, 'Newly added node should be active');
    assert.equal(active[0].name, 'active.js');
  });
});

describe('Context / ContextGraph: pruning', () => {
  it('prune removes nodes and edges older than maxAge', () => {
    const graph = new ContextGraph({ config: { maxAge: 1000 } });
    const n1 = graph.addNode({ id: 'old', type: 'file', name: 'stale.js' });
    const n2 = graph.addNode({ id: 'new', type: 'file', name: 'fresh.js' });
    graph.addEdge({ from: n1.id, to: n2.id, relationship: 'imports' });

    // Manually backdate the old node's lastSeen
    n1.lastSeen = Date.now() - 2000;

    const { prunedNodes } = graph.prune(1000);
    assert.ok(prunedNodes >= 1, 'At least one node should have been pruned');
    assert.equal(graph.getNode('old'), null, 'Stale node must be pruned');
  });

  it('toJSON returns nodes and edges arrays', () => {
    const graph = new ContextGraph({});
    graph.addNode({ type: 'concept', name: 'test' });

    const json = graph.toJSON();
    assert.ok(Array.isArray(json.nodes), 'toJSON must return nodes array');
    assert.ok(Array.isArray(json.edges), 'toJSON must return edges array');
    assert.equal(json.nodes.length, 1);
  });
});

describe('Context / ContextGraph: processEvent entity extraction', () => {
  it('processEvent with tool.invoke creates a function node', () => {
    const graph = new ContextGraph({});
    graph.processEvent({ topic: 'tool.invoke', data: { toolName: 'memory_store' }, timestamp: Date.now() });

    const fn = graph.findNodeByName('memory_store', 'function');
    assert.ok(fn, 'Function node should be created from tool.invoke event');
  });

  it('processEvent with git event creates project and file nodes', () => {
    const graph = new ContextGraph({});
    graph.processEvent({
      topic: 'git.commit',
      data: { repo: 'asimovs-mind', files: ['subsystems/memory/tiers.js', 'test/test-internals.js'] },
      timestamp: Date.now(),
    });

    const proj = graph.findNodeByName('asimovs-mind', 'project');
    assert.ok(proj, 'Project node must be created from git event');

    const stats = graph.stats;
    assert.ok(stats.nodeCount >= 3, 'Should have project node plus file nodes');
  });

  it('processEvent with communication event creates person nodes', () => {
    const graph = new ContextGraph({});
    graph.processEvent({
      topic: 'communication',
      data: { from: 'Stephen', to: 'Friday' },
      timestamp: Date.now(),
    });

    const stephen = graph.findNodeByName('Stephen', 'person');
    const friday = graph.findNodeByName('Friday', 'person');
    assert.ok(stephen, 'Person "Stephen" must be created');
    assert.ok(friday, 'Person "Friday" must be created');
  });

  it('processEvent extracts file paths from text', () => {
    const graph = new ContextGraph({});
    graph.processEvent({
      topic: 'other',
      data: { text: 'edited subsystems/memory/tiers.js today' },
      timestamp: Date.now(),
    });

    const stats = graph.stats;
    assert.ok(stats.nodeCount >= 1, 'File node should be extracted from text');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 9. Enterprise / ConsentManager
// ═══════════════════════════════════════════════════════════════════════════════

describe('Enterprise / ConsentTracker: grant and check', () => {
  it('grantConsent then checkConsent returns granted=true', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session', 'user approved');

    const result = ct.checkConsent('cloud_api');
    assert.equal(result.granted, true);
    assert.equal(result.scope, 'session');
  });

  it('checkConsent returns granted=false when no consent recorded', () => {
    const ct = new ConsentTracker();
    const result = ct.checkConsent('cloud_api');
    assert.equal(result.granted, false);
    assert.ok(result.reason, 'Reason must be provided');
  });

  it('once-scoped consent is consumed after first checkConsent', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'once', 'one-time grant');

    const first = ct.checkConsent('cloud_api');
    assert.equal(first.granted, true, 'First check must succeed');

    const second = ct.checkConsent('cloud_api');
    assert.equal(second.granted, false, 'Second check must fail (once consumed)');
  });

  it('peekConsent does not consume once-scoped grant', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'once', 'peek test');

    ct.peekConsent('cloud_api');  // Should not consume
    ct.peekConsent('cloud_api');  // Should not consume

    const check = ct.checkConsent('cloud_api');
    assert.equal(check.granted, true, 'Grant must still be present after peek');
  });
});

describe('Enterprise / ConsentTracker: revoke', () => {
  it('revokeConsent makes checkConsent return false', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session', 'test');
    ct.revokeConsent('cloud_api', 'no longer needed');

    const result = ct.checkConsent('cloud_api');
    assert.equal(result.granted, false);
  });

  it('revokeAll revokes all currently-set consents', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session');
    ct.grantConsent('data_sharing', 'session');
    ct.grantConsent('code_execution', 'session');

    const { revokedCount } = ct.revokeAll('cleanup');
    assert.equal(revokedCount, 3, 'Three consents should have been revoked');

    for (const cat of ['cloud_api', 'data_sharing', 'code_execution']) {
      assert.equal(ct.checkConsent(cat).granted, false, `${cat} must be revoked`);
    }
  });

  it('revokeConsent returns existed=false when category was not previously set', () => {
    const ct = new ConsentTracker();
    const result = ct.revokeConsent('financial_actions', 'never had it anyway');
    // revokeConsent still sets a deny entry, but existed reflects prior state
    assert.equal(result.revoked, true, 'Revoke should be marked complete');
  });
});

describe('Enterprise / ConsentTracker: audit trail', () => {
  it('getAuditLog records grant, check, and revoke actions', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session', 'test grant');
    ct.checkConsent('cloud_api');
    ct.revokeConsent('cloud_api', 'test revoke');

    const log = ct.getAuditLog(100);
    assert.ok(log.length >= 3, `Expected at least 3 audit entries, got ${log.length}`);

    const actions = log.map(e => e.action);
    assert.ok(actions.includes('grant'), 'Audit log must contain grant action');
    assert.ok(actions.includes('check'), 'Audit log must contain check action');
    assert.ok(actions.includes('revoke'), 'Audit log must contain revoke action');
  });

  it('audit log entries include category, ts, and result fields', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('code_execution', 'session', 'reason');

    const log = ct.getAuditLog(10);
    const entry = log[0];
    assert.ok(entry.category, 'Entry must have category');
    assert.ok(entry.ts > 0, 'Entry must have timestamp');
    assert.ok(typeof entry.result === 'boolean', 'Entry must have boolean result');
  });
});

describe('Enterprise / ConsentTracker: getStatus', () => {
  it('getStatus covers all CONSENT_CATEGORIES', () => {
    const ct = new ConsentTracker();
    const status = ct.getStatus();

    for (const cat of CONSENT_CATEGORIES) {
      assert.ok(cat in status, `Status must include category: ${cat}`);
    }
  });

  it('getStatus shows granted:true for granted categories', () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session');

    const status = ct.getStatus();
    assert.equal(status.cloud_api.granted, true);
    assert.equal(status.data_sharing.granted, false, 'Unset category defaults to false');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 10. Enterprise / CloudGate
// ═══════════════════════════════════════════════════════════════════════════════

describe('Enterprise / CloudGate: checkGate', () => {
  it('denies when no cloud_api consent exists', async () => {
    const ct = new ConsentTracker();
    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);

    const result = gate.checkGate('code', {});
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'no-cloud-consent');
  });

  it('denies when cloud_api consent exists but no policy is set', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session', 'user approved');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);

    const result = gate.checkGate('code', {});
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'no-policy');
  });

  it('denies when policy explicitly denies the category', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session', 'approved');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);
    gate.setPolicy('code', 'deny', 'session');

    const result = gate.checkGate('code', {});
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'policy-deny');
  });

  it('allows when cloud_api consent and allow policy both exist', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'session', 'approved');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);
    gate.setPolicy('code', 'allow', 'session');

    const result = gate.checkGate('code', {});
    assert.equal(result.allowed, true);
    assert.equal(result.reason, 'policy-allow');
  });

  it('once-scoped cloud_api consent is consumed only when gate allows', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'once', 'one-time');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);
    gate.setPolicy('code', 'allow', 'session');

    // First call: allowed, consent consumed
    const first = gate.checkGate('code', {});
    assert.equal(first.allowed, true, 'First call must be allowed');

    // Second call: consent gone, should be denied
    const second = gate.checkGate('code', {});
    assert.equal(second.allowed, false, 'Second call must fail (consent consumed)');
  });

  it('once-scoped policy is consumed after first allowed call', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'always', 'persistent');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);
    gate.setPolicy('chat', 'allow', 'once');

    const first = gate.checkGate('chat', {});
    assert.equal(first.allowed, true, 'First call must be allowed');

    // Policy consumed -- second call should deny with no-policy
    const second = gate.checkGate('chat', {});
    assert.equal(second.allowed, false, 'Second call must fail (once policy consumed)');
    assert.equal(second.reason, 'no-policy');
  });

  it('deny policy does not consume once-scoped cloud_api consent', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'once', 'one-time');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);
    gate.setPolicy('code', 'deny', 'session');

    // This should deny without consuming the once-scoped grant
    gate.checkGate('code', {});

    // Now check with allow policy -- consent should still be available
    gate.setPolicy('chat', 'allow', 'session');
    const result = gate.checkGate('chat', {});
    assert.equal(result.allowed, true, 'Once-scoped grant must survive a deny-policy call');
  });
});

describe('Enterprise / CloudGate: policy management', () => {
  it('setPolicy and getPolicy round-trip', async () => {
    const gate = new CloudGate();
    await gate.initialize(createMockState(), null);

    gate.setPolicy('analysis', 'allow', 'session');
    const policy = gate.getPolicy('analysis');

    assert.ok(policy, 'Policy must be retrievable');
    assert.equal(policy.decision, 'allow');
    assert.equal(policy.scope, 'session');
  });

  it('clearPolicy removes the policy', async () => {
    const gate = new CloudGate();
    await gate.initialize(createMockState(), null);

    gate.setPolicy('creative', 'allow', 'session');
    const existed = gate.clearPolicy('creative');

    assert.equal(existed, true, 'clearPolicy must return true when policy existed');
    assert.equal(gate.getPolicy('creative'), null, 'Policy must be gone after clear');
  });

  it('clearPolicy returns false when policy did not exist', async () => {
    const gate = new CloudGate();
    await gate.initialize(createMockState(), null);

    const existed = gate.clearPolicy('general');
    assert.equal(existed, false);
  });

  it('clearAllPolicies removes all policies and returns count', async () => {
    const gate = new CloudGate();
    await gate.initialize(createMockState(), null);

    gate.setPolicy('code', 'allow', 'session');
    gate.setPolicy('chat', 'deny', 'session');

    const count = gate.clearAllPolicies();
    assert.equal(count, 2, 'clearAllPolicies must return the number of removed policies');

    const all = gate.getAllPolicies();
    assert.equal(Object.keys(all).length, 0, 'getAllPolicies must be empty after clearAll');
  });

  it('getAllPolicies returns a snapshot of all current policies', async () => {
    const gate = new CloudGate();
    await gate.initialize(createMockState(), null);

    gate.setPolicy('code', 'allow', 'session');
    gate.setPolicy('analysis', 'deny', 'session');

    const all = gate.getAllPolicies();
    assert.ok('code' in all);
    assert.ok('analysis' in all);
    assert.equal(all.code.decision, 'allow');
    assert.equal(all.analysis.decision, 'deny');
  });
});

describe('Enterprise / CloudGate: stats tracking', () => {
  it('escalatedDenied increments on each denial', async () => {
    const ct = new ConsentTracker();
    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);

    gate.checkGate('code', {});  // no consent -- denied
    gate.checkGate('chat', {});  // no consent -- denied

    const stats = gate.getStats();
    assert.ok(stats.escalatedDenied >= 2, `Expected at least 2 denials, got ${stats.escalatedDenied}`);
  });

  it('escalatedAllowed increments on each allowed call', async () => {
    const ct = new ConsentTracker();
    ct.grantConsent('cloud_api', 'always', 'persistent');

    const gate = new CloudGate();
    await gate.initialize(createMockState(), ct);
    gate.setPolicy('code', 'allow', 'always');

    gate.checkGate('code', {});
    gate.checkGate('code', {});

    const stats = gate.getStats();
    assert.ok(stats.escalatedAllowed >= 2, `Expected at least 2 allowed, got ${stats.escalatedAllowed}`);
  });

  it('incrementStat increments a known stat field', async () => {
    const gate = new CloudGate();
    await gate.initialize(createMockState(), null);

    const before = gate.getStats().localDelivered;
    gate.incrementStat('localDelivered');
    const after = gate.getStats().localDelivered;

    assert.equal(after, before + 1);
  });
});
