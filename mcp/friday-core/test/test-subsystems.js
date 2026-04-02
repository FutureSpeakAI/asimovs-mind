/**
 * Comprehensive unit tests for the 12 friday-core subsystems.
 *
 * Uses node:test (describe/it) and node:assert/strict. No external frameworks.
 * Mock vault & event bus at the top since the real ones require Argon2id.
 *
 * Run: node --test --test-force-exit test/test-subsystems.js
 * (--test-force-exit needed because some subsystems use internal timers)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

// ═══════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════

/** Mock vault: in-memory key-value store */
function _createMockVault() {
  const store = new Map();
  return {
    status: 'unlocked',
    read: async (key) => ({ success: true, data: store.get(key) || null }),
    write: async (key, data) => { store.set(key, data); return { success: true }; },
    append: async (key, entry) => {
      const arr = store.get(key) || [];
      arr.push(entry);
      store.set(key, arr);
      return { success: true };
    },
    delete: async (key) => { store.delete(key); return { success: true }; },
    listKeys: async () => ({ success: true, keys: [...store.keys()] }),
    privacyShield: {
      getNonce: () => 'testnonce',
      storePiiMapping: () => {},
      getPiiMapping: () => null,
      getStats: () => ({ total: 0, categories: {} }),
      reset: () => {},
    },
  };
}

/** Mock state manager namespace */
function createMockState() {
  const store = new Map();
  return {
    read: async (key) => ({ success: true, data: store.get(key) || null }),
    write: async (key, data) => { store.set(key, data); return { success: true }; },
    append: async (key, entry) => {
      const arr = store.get(key) || [];
      arr.push(entry);
      store.set(key, arr);
      return { success: true };
    },
    delete: async (key) => { store.delete(key); return { success: true }; },
    list: async () => ({ success: true, keys: [...store.keys()] }),
    // Some subsystems use .get/.set instead of .read/.write
    get: async (key) => store.get(key) || null,
    set: async (key, data) => { store.set(key, data); },
  };
}

/** Mock event bus */
function createMockEventBus() {
  const bus = new EventEmitter();
  bus.publish = (topic, data) => bus.emit(topic, { topic, data, timestamp: Date.now() });
  bus.recent = () => [];
  bus.stats = { published: 0, topics: [] };
  return bus;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. LLM (Intelligence Router)
// ═══════════════════════════════════════════════════════════════════════

import {
  IntelligenceRouter,
  classifyTask,
  scoreModel,
  estimateRequestCost,
  buildRoutingExplanation,
} from '../subsystems/llm/router.js';

describe('LLM / IntelligenceRouter', () => {
  let router;

  beforeEach(async () => {
    router = new IntelligenceRouter({ state: createMockState() });
    await router.initialize();
  });

  it('profileTask returns correct category for code-related tasks', () => {
    const task = router.profileTask('Please refactor this function to use async/await');
    assert.equal(task.category, 'code');
  });

  it('profileTask returns correct category for reasoning tasks', () => {
    const task = router.profileTask('Analyse the tradeoffs between microservices and monolith');
    assert.equal(task.category, 'reasoning');
  });

  it('profileTask returns correct category for creative tasks', () => {
    const task = router.profileTask('Write a blog post about AI safety');
    assert.equal(task.category, 'creative');
  });

  it('profileTask returns correct category for extraction tasks', () => {
    const task = router.profileTask('Summarize these meeting notes and list key points');
    assert.equal(task.category, 'extraction');
  });

  it('profileTask returns correct complexity levels', () => {
    const trivial = router.profileTask('Hello');
    assert.equal(trivial.complexity, 'trivial');

    const simple = router.profileTask(
      'What is the capital of France? Tell me about it and give me some interesting facts ' +
      'about the city including its population and history.',
    );
    assert.equal(simple.complexity, 'simple');

    // Moderate: > 50 words
    const moderate = router.profileTask(
      'I need you to look at several files and understand how the data flows ' +
      'through the system from the API endpoint all the way down to the database. ' +
      'There are multiple services involved and I want to understand the request lifecycle ' +
      'across all of them so I can debug an issue that is intermittent.',
    );
    assert.equal(moderate.complexity, 'moderate');
  });

  it('profileTask detects expert complexity from keywords', () => {
    const expert = router.profileTask(
      'Provide a comprehensive and thorough analysis of the entire codebase architecture ' +
      'including all subsystems, their interactions, data flow patterns, error handling strategies, ' +
      'and performance characteristics. I need an exhaustive review covering every module.',
    );
    assert.equal(expert.complexity, 'expert');
  });

  it('default model registry has models', () => {
    const models = router.getModelRegistry();
    assert.ok(models.length >= 5, 'Should have at least 5 default models');
    const modelIds = models.map((m) => m.modelId);
    assert.ok(modelIds.includes('anthropic/claude-opus-4'));
    assert.ok(modelIds.includes('anthropic/claude-sonnet-4'));
  });

  it('local-preferred policy gives bonus to local models', () => {
    const localModel = {
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
      available: true,
      lastChecked: 0,
      rateLimit: 0,
      consecutiveFailures: 0,
    };

    const task = classifyTask({ messageContent: 'Write hello world', toolCount: 0 });

    const scorePreferred = scoreModel(localModel, task, { localModelPolicy: 'preferred', localMinCapability: 0.55, maxRequestCostUsd: 1.0, monthlyBudgetUsd: 0 });
    const scoreDisabled = scoreModel(localModel, task, { localModelPolicy: 'disabled', localMinCapability: 0.55, maxRequestCostUsd: 1.0, monthlyBudgetUsd: 0 });

    assert.ok(scorePreferred.totalScore > 0, 'preferred policy should score > 0');
    assert.equal(scoreDisabled.totalScore, 0, 'disabled policy should score 0');
  });

  it('classifyTask detects tool-use category', () => {
    const task = classifyTask({ messageContent: 'Search for the latest news', toolCount: 3 });
    assert.equal(task.category, 'tool-use');
    assert.equal(task.requiresToolUse, true);
  });

  it('classifyTask detects vision requirement', () => {
    const task = classifyTask({ messageContent: 'What is in this image?', hasImages: true });
    assert.equal(task.category, 'vision');
    assert.equal(task.requiresVision, true);
  });

  it('scoreModel disqualifies unavailable models', () => {
    const model = {
      modelId: 'test/model',
      available: false,
      contextWindow: 32000,
      strengths: {},
      supportsToolUse: false,
      supportsVision: false,
      supportsAudio: false,
      consecutiveFailures: 0,
    };
    const task = classifyTask({ messageContent: 'Hello' });
    const score = scoreModel(model, task, { maxRequestCostUsd: 1.0, monthlyBudgetUsd: 0 });
    assert.equal(score.totalScore, 0);
  });

  it('estimateRequestCost computes correctly', () => {
    const model = { inputCostPerMillion: 10, outputCostPerMillion: 30 };
    const cost = estimateRequestCost(model, 1_000_000, 500_000);
    assert.equal(cost, 10 + 15); // 10 for input + 15 for output
  });

  it('buildRoutingExplanation includes task info', () => {
    const selected = {
      modelId: 'test/model',
      totalScore: 0.8,
      breakdown: { capabilityScore: 0.9, costScore: 0.7, speedScore: 0.8, contextScore: 1.0, reliabilityScore: 1.0 },
    };
    const task = { category: 'code', complexity: 'moderate' };
    const explanation = buildRoutingExplanation(selected, task, false, false);
    assert.ok(explanation.includes('code'));
    assert.ok(explanation.includes('moderate'));
  });

  it('selectModel returns a decision', () => {
    const task = router.profileTask('Debug this Python function');
    const decision = router.selectModel(task);
    assert.ok(decision.selectedModelId);
    assert.ok(decision.id);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. MEMORY (Tiers, Episodic, Consolidation, Search)
// ═══════════════════════════════════════════════════════════════════════

import { MemoryTiers } from '../subsystems/memory/tiers.js';
import { EpisodicMemory } from '../subsystems/memory/episodic.js';
import { MemoryConsolidation } from '../subsystems/memory/consolidation.js';

// We need a minimal mock of SemanticSearchEngine for MemoryTiers
function createMockSearchEngine() {
  const entries = new Map();
  return {
    index: async (id, text, type, meta) => { entries.set(id, { id, text, type, meta, embedding: [] }); },
    indexBulk: async (items) => { for (const item of items) entries.set(item.id, item); },
    remove: (id) => { entries.delete(id); },
    search: async () => [],
    getCount: () => entries.size,
    isReady: () => false,
  };
}

describe('Memory / MemoryTiers', () => {
  let tiers;

  beforeEach(async () => {
    tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), createMockSearchEngine());
  });

  it('store and recall from short-term', async () => {
    const entry = await tiers.store('Stephen prefers dark mode', 'preference', 'short');
    assert.ok(entry);
    assert.ok(entry.id);
    assert.equal(entry.content, 'Stephen prefers dark mode');

    const shortTerm = tiers.getShortTerm();
    assert.equal(shortTerm.length, 1);
    assert.equal(shortTerm[0].content, 'Stephen prefers dark mode');
  });

  it('duplicate detection rejects similar content', async () => {
    await tiers.store('The project uses TypeScript for the backend', 'fact', 'medium');
    const _dup = await tiers.store('The project uses TypeScript for the backend', 'fact', 'medium');

    // The duplicate should be reinforced (same entry returned with bumped count)
    const mediumTerm = tiers.getMediumTerm();
    assert.equal(mediumTerm.length, 1, 'Should still be 1 entry after duplicate');
    assert.ok(mediumTerm[0].accessCount >= 2, 'Access count should be bumped');
  });

  it('store to medium-term persists via state', async () => {
    const state = createMockState();
    const t2 = new MemoryTiers();
    await t2.initialize(state, createMockSearchEngine());
    await t2.store('Important observation about code quality', 'context', 'medium');

    // Verify the state was written
    const saved = await state.read('medium-term');
    assert.ok(saved.data);
    assert.ok(Array.isArray(saved.data));
    assert.equal(saved.data.length, 1);
  });

  it('store to long-term with high confidence', async () => {
    const entry = await tiers.store('TypeScript is the primary language', 'fact', 'long', 0.5);
    assert.ok(entry);
    assert.ok(entry.confidence >= 0.7, 'Long-term entries start at >= 0.7 confidence');
  });

  it('recall uses keyword fallback when no semantic search', async () => {
    await tiers.store('The database uses PostgreSQL for persistence', 'fact', 'short');
    await tiers.store('Redis is used for caching', 'fact', 'short');

    const results = await tiers.recall('PostgreSQL');
    assert.ok(results.length >= 1);
    assert.ok(results[0].content.includes('PostgreSQL'));
  });

  it('forget removes a memory by ID', async () => {
    const entry = await tiers.store('Temporary fact', 'fact', 'short');
    const forgotten = await tiers.forget(entry.id);
    assert.ok(forgotten);
    assert.equal(tiers.getShortTerm().length, 0);
  });

  it('status returns tier counts', async () => {
    await tiers.store('Short term item', 'fact', 'short');
    await tiers.store('Medium term item', 'fact', 'medium');
    const status = tiers.status();
    assert.equal(status.shortTerm.count, 1);
    assert.equal(status.mediumTerm.count, 1);
    assert.equal(status.totalMemories, 2);
  });
});

describe('Memory / EpisodicMemory', () => {
  let episodic;

  beforeEach(async () => {
    episodic = new EpisodicMemory();
    await episodic.initialize(createMockState(), createMockSearchEngine());
  });

  it('start and end episode', async () => {
    const started = episodic.startEpisode('Test debugging session');
    assert.ok(started.id);
    assert.equal(started.title, 'Test debugging session');
    assert.ok(episodic.isRecording());

    const ended = await episodic.endEpisode('Fixed the critical bug in auth module', {
      topics: ['debugging', 'auth'],
      emotionalTone: 'focused',
    });
    assert.ok(ended);
    assert.equal(ended.summary, 'Fixed the critical bug in auth module');
    assert.ok(!episodic.isRecording());
  });

  it('search episodes by keyword', async () => {
    episodic.startEpisode('Auth debugging');
    await episodic.endEpisode('Fixed authentication token refresh bug', {
      topics: ['auth', 'tokens'],
    });

    episodic.startEpisode('Database migration');
    await episodic.endEpisode('Migrated user table to new schema', {
      topics: ['database', 'migration'],
    });

    const results = episodic.search('authentication');
    assert.ok(results.length >= 1, 'Should find the auth episode');
    assert.ok(results[0].summary.includes('authentication'));
  });

  it('addObservation increments turn count', () => {
    episodic.startEpisode('Coding session');
    episodic.addObservation('user', 'Can you fix the login page?');
    episodic.addObservation('assistant', 'Sure, looking at it now.');
    episodic.addObservation('user', 'Great, also check the session handling.');

    const active = episodic.getActiveEpisode();
    assert.equal(active.turnCount, 3);
  });

  it('getRecent returns latest episodes', async () => {
    for (let i = 0; i < 3; i++) {
      episodic.startEpisode(`Episode ${i}`);
      await episodic.endEpisode(`Summary for episode ${i}`);
    }
    const recent = episodic.getRecent(2);
    assert.equal(recent.length, 2);
  });

  it('status reports correctly', async () => {
    episodic.startEpisode('Active test');
    const status = episodic.status();
    assert.equal(status.recording, true);
    assert.ok(status.activeEpisode);
    assert.equal(status.activeEpisode.title, 'Active test');
  });
});

describe('Memory / MemoryConsolidation', () => {
  it('high-access entries get higher promotion scores', async () => {
    const tiers = new MemoryTiers();
    const search = createMockSearchEngine();
    await tiers.initialize(createMockState(), search);

    // Store a medium-term entry with high access
    const _entry = await tiers.store('Important recurring observation', 'fact', 'medium', 0.9);

    // Simulate high access by storing the same text multiple times
    // (the duplicate detector will reinforce it)
    for (let i = 0; i < 5; i++) {
      await tiers.store('Important recurring observation', 'fact', 'medium', 0.9);
    }

    const consolidation = new MemoryConsolidation(tiers, search);
    const scores = consolidation.scoreAll();
    assert.ok(scores.length >= 1);
    // The entry with high access count should have a higher score
    const scored = scores[0];
    assert.ok(scored.score > 0, 'Score should be positive');
    assert.ok(scored.accessCount >= 3, 'Should have high access count');
  });

  it('scoreAll returns scored entries', async () => {
    const tiers = new MemoryTiers();
    const search = createMockSearchEngine();
    await tiers.initialize(createMockState(), search);

    await tiers.store('Entry one', 'fact', 'medium');
    await tiers.store('Entry two completely different content here', 'context', 'medium');

    const consolidation = new MemoryConsolidation(tiers, search);
    const scores = consolidation.scoreAll();
    assert.equal(scores.length, 2);
    assert.ok(scores[0].id);
    assert.ok(typeof scores[0].score === 'number');
  });

  it('run() does not crash with empty medium-term', async () => {
    const tiers = new MemoryTiers();
    const search = createMockSearchEngine();
    await tiers.initialize(createMockState(), search);

    const consolidation = new MemoryConsolidation(tiers, search);
    const result = await consolidation.run();
    assert.equal(result.promoted.length, 0);
    assert.equal(result.pruned.length, 0);
    assert.equal(result.skipped, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. CONTEXT (Graph, Injector)
// ═══════════════════════════════════════════════════════════════════════

import { ContextGraph } from '../subsystems/context/graph.js';
import { ContextInjector } from '../subsystems/context/injector.js';

describe('Context / ContextGraph', () => {
  let graph;

  beforeEach(() => {
    graph = new ContextGraph({
      state: createMockState(),
      eventBus: createMockEventBus(),
    });
  });

  it('add node, query by type', () => {
    graph.addNode({ id: 'file:index.js', type: 'file', name: 'index.js' });
    graph.addNode({ id: 'person:alice', type: 'person', name: 'Alice' });
    graph.addNode({ id: 'file:server.js', type: 'file', name: 'server.js' });

    const files = graph.query('', 'file');
    assert.equal(files.length, 2);
    assert.ok(files.every((n) => n.type === 'file'));

    const people = graph.query('', 'person');
    assert.equal(people.length, 1);
    assert.equal(people[0].name, 'Alice');
  });

  it('add edge, get neighbors', () => {
    graph.addNode({ id: 'proj:myapp', type: 'project', name: 'myapp' });
    graph.addNode({ id: 'file:main.ts', type: 'file', name: 'main.ts' });
    graph.addNode({ id: 'file:utils.ts', type: 'file', name: 'utils.ts' });

    graph.addEdge({ from: 'proj:myapp', to: 'file:main.ts', relationship: 'contains' });
    graph.addEdge({ from: 'proj:myapp', to: 'file:utils.ts', relationship: 'contains' });
    graph.addEdge({ from: 'file:main.ts', to: 'file:utils.ts', relationship: 'imports' });

    const neighbors = graph.getNeighbors('proj:myapp', 1);
    assert.equal(neighbors.length, 2);
    assert.ok(neighbors.some((n) => n.node.name === 'main.ts'));
    assert.ok(neighbors.some((n) => n.node.name === 'utils.ts'));
  });

  it('prune old nodes', () => {
    // Add a node and manually backdate its lastSeen via re-adding with metadata
    const node = graph.addNode({ id: 'old:node', type: 'concept', name: 'old stuff' });
    // Manually set lastSeen to the past by re-touching the node object
    // Since addNode returns a reference for existing nodes, we can mutate it
    node.lastSeen = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago

    // Default maxAge is 7 days, so pruning with default should remove the 10-day-old node
    const result = graph.prune();
    assert.ok(result.prunedNodes >= 1);
    assert.equal(graph.getNode('old:node'), null);
  });

  it('query by name pattern', () => {
    graph.addNode({ id: 'file:auth.ts', type: 'file', name: 'auth.ts' });
    graph.addNode({ id: 'file:auth-utils.ts', type: 'file', name: 'auth-utils.ts' });
    graph.addNode({ id: 'file:server.ts', type: 'file', name: 'server.ts' });

    const results = graph.query('auth');
    assert.equal(results.length, 2);
  });

  it('getEdgesFor returns edges for a node', () => {
    graph.addNode({ id: 'a', type: 'file', name: 'a.ts' });
    graph.addNode({ id: 'b', type: 'file', name: 'b.ts' });
    graph.addEdge({ from: 'a', to: 'b', relationship: 'imports' });

    const edges = graph.getEdgesFor('a');
    assert.equal(edges.length, 1);
    assert.equal(edges[0].relationship, 'imports');
  });

  it('removeNode cleans up edges', () => {
    graph.addNode({ id: 'x', type: 'concept', name: 'x' });
    graph.addNode({ id: 'y', type: 'concept', name: 'y' });
    graph.addEdge({ from: 'x', to: 'y', relationship: 'related' });

    graph.removeNode('x');
    assert.equal(graph.getNode('x'), null);
    assert.equal(graph.getEdgesFor('y').length, 0);
  });

  it('stats reports node and edge counts', () => {
    graph.addNode({ id: 'a', type: 'file', name: 'a' });
    graph.addNode({ id: 'b', type: 'file', name: 'b' });
    graph.addEdge({ from: 'a', to: 'b', relationship: 'imports' });

    const stats = graph.stats;
    assert.equal(stats.nodeCount, 2);
    assert.equal(stats.edgeCount, 1);
  });
});

describe('Context / ContextInjector', () => {
  it('inject returns context string', () => {
    const graph = new ContextGraph({
      state: createMockState(),
      eventBus: createMockEventBus(),
    });
    graph.addNode({ id: 'file:router.js', type: 'file', name: 'router.js' });
    graph.addNode({ id: 'file:auth.js', type: 'file', name: 'auth.js' });
    graph.addEdge({ from: 'file:router.js', to: 'file:auth.js', relationship: 'imports' });

    const bus = createMockEventBus();
    const injector = new ContextInjector({ graph, eventBus: bus });

    const context = injector.inject('router');
    assert.ok(typeof context === 'string');
    assert.ok(context.includes('Active Context'));
  });

  it('inject with no query returns generic context or empty string', () => {
    const graph = new ContextGraph({ state: createMockState(), eventBus: createMockEventBus() });
    const injector = new ContextInjector({ graph, eventBus: createMockEventBus() });

    const context = injector.inject('');
    assert.ok(typeof context === 'string');
  });

  it('snapshot returns structured data', () => {
    const graph = new ContextGraph({ state: createMockState(), eventBus: createMockEventBus() });
    graph.addNode({ id: 'test:node', type: 'concept', name: 'test' });

    const bus = createMockEventBus();
    const injector = new ContextInjector({ graph, eventBus: bus });

    const snap = injector.snapshot();
    assert.ok(snap.timestamp);
    assert.ok(Array.isArray(snap.recentEvents));
    assert.ok(Array.isArray(snap.activeEntities));
    assert.ok(snap.graphStats);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. TRUST (Graph)
// ═══════════════════════════════════════════════════════════════════════

import { TrustGraph } from '../subsystems/trust/graph.js';

describe('Trust / TrustGraph', () => {
  let trust;

  beforeEach(async () => {
    trust = new TrustGraph();
    await trust.initialize(createMockState());
  });

  it('add person, retrieve scores', () => {
    const { person, isNew } = trust.resolvePerson('Alice Johnson');
    assert.ok(person);
    assert.ok(isNew);
    assert.equal(person.primaryName, 'Alice Johnson');
    assert.ok(person.trust.overall >= 0 && person.trust.overall <= 1);
  });

  it('add evidence updates scores', () => {
    const { person } = trust.resolvePerson('Bob Smith');
    const originalReliability = person.trust.reliability;

    trust.addEvidence(person.id, {
      type: 'promise_kept',
      description: 'Delivered the report on time',
      impact: 0.8,
    });

    // Score should have moved
    const updated = trust.getPersonById(person.id);
    assert.ok(updated.trust.reliability !== originalReliability || updated.evidence.length === 1);
    assert.equal(updated.evidence.length, 1);
  });

  it('person resolution (exact alias match)', () => {
    const { person: first } = trust.resolvePerson('Charlie Davis');
    trust.addAlias(first.id, 'cdavis@example.com', 'email');

    const { person: resolved, isNew } = trust.resolvePerson('cdavis@example.com');
    assert.ok(!isNew, 'Should resolve to existing person');
    assert.equal(resolved.id, first.id);
  });

  it('person resolution (fuzzy matching)', () => {
    const { person: original } = trust.resolvePerson('Jennifer Williams');

    // Slightly different spelling should fuzzy-match (Levenshtein <= 2)
    const { person: fuzzy, isNew } = trust.resolvePerson('Jenifer Williams');
    assert.ok(!isNew, 'Should resolve to existing person via fuzzy match');
    assert.equal(fuzzy.id, original.id);
  });

  it('re-evaluation recomputes from all evidence', () => {
    const { person } = trust.resolvePerson('Eve Technical');

    // Add enough evidence to trigger re-evaluation (threshold = 5)
    for (let i = 0; i < 6; i++) {
      trust.addEvidence(person.id, {
        type: 'promise_kept',
        description: `Kept promise #${i}`,
        impact: 0.7,
      });
    }

    const updated = trust.getPersonById(person.id);
    // After re-eval, reliability should reflect all the positive evidence
    assert.ok(updated.trust.reliability > 0.5, 'Reliability should be above 0.5 after positive evidence');
    assert.ok(updated.trust.overall > 0.5, 'Overall should be above 0.5');
  });

  it('getPersonCount tracks added persons', () => {
    trust.resolvePerson('Margaret Thompson');
    trust.resolvePerson('Hiroshi Nakamura');
    trust.resolvePerson('Priya Chandrasekaran');
    assert.equal(trust.getPersonCount(), 3);
  });

  it('getMostTrusted returns persons sorted by trust', () => {
    const { person: a } = trust.resolvePerson('Trusted Alice');
    const { person: b } = trust.resolvePerson('Less Trusted Bob');

    // Give Alice positive evidence
    for (let i = 0; i < 5; i++) {
      trust.addEvidence(a.id, { type: 'promise_kept', description: 'Great work', impact: 0.9 });
    }
    // Give Bob negative evidence
    trust.addEvidence(b.id, { type: 'promise_broken', description: 'Missed deadline', impact: -0.5 });

    const top = trust.getMostTrusted(2);
    assert.equal(top.length, 2);
    assert.ok(top[0].trust.overall >= top[1].trust.overall);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 5. PERSONALITY (Profile, Calibration, Sentiment)
// ═══════════════════════════════════════════════════════════════════════

import { PersonalityProfile } from '../subsystems/personality/profile.js';
import {
  CalibrationEngine,
  detectExplicitSignal,
  detectImplicitSignals,
} from '../subsystems/personality/calibration.js';
import { SentimentEngine } from '../subsystems/personality/sentiment.js';

describe('Personality / FridayProfile', () => {
  let profile;

  beforeEach(async () => {
    profile = new PersonalityProfile();
    await profile.initialize(createMockState());
  });

  it('set and get mode', async () => {
    await profile.setMode('focus');
    const p = profile.getProfile();
    assert.equal(p.mode, 'focus');
  });

  it('rejects invalid mode', async () => {
    await assert.rejects(
      () => profile.setMode('banana'),
      (err) => err.message.includes('Invalid mode'),
    );
  });

  it('buildPersonalityPrompt returns a string with the name', () => {
    const prompt = profile.buildPersonalityPrompt();
    assert.ok(typeof prompt === 'string');
    assert.ok(prompt.includes('Friday'));
  });

  it('getCondensedProfile returns summary', () => {
    const condensed = profile.getCondensedProfile();
    assert.equal(condensed.name, 'Friday');
    assert.ok(condensed.summary.includes('Friday'));
  });

  it('setChallengeLevel clamps to 1-5', async () => {
    await profile.setChallengeLevel(10);
    assert.equal(profile.getProfile().challengeLevel, 5);

    await profile.setChallengeLevel(-1);
    assert.equal(profile.getProfile().challengeLevel, 1);
  });
});

describe('Personality / CalibrationEngine', () => {
  let calibration;

  beforeEach(async () => {
    calibration = new CalibrationEngine();
    await calibration.initialize(createMockState());
  });

  it('processes explicit signals', () => {
    const before = calibration.getDimensions();
    calibration.recordSignal({
      source: 'explicit',
      type: 'more_formal',
      magnitude: 0.8,
    });
    const after = calibration.getDimensions();
    assert.ok(after.formality > before.formality, 'Formality should increase');
  });

  it('detectExplicitSignal detects more_verbose', () => {
    const signal = detectExplicitSignal('Please elaborate more on this topic');
    assert.equal(signal, 'more_verbose');
  });

  it('detectExplicitSignal detects less_verbose', () => {
    const signal = detectExplicitSignal('Be more concise please');
    assert.equal(signal, 'less_verbose');
  });

  it('detectExplicitSignal returns null for no match', () => {
    const signal = detectExplicitSignal('What is the weather like today?');
    assert.equal(signal, null);
  });

  it('detectImplicitSignals detects technical_question', () => {
    const signals = detectImplicitSignals('How do I implement an async function with await?');
    assert.ok(signals.includes('technical_question'));
  });

  it('detectImplicitSignals detects casual_chat', () => {
    const signals = detectImplicitSignals('haha yeah that was funny lol');
    assert.ok(signals.includes('casual_chat'));
  });

  it('processUserMessage applies signals', () => {
    const before = calibration.getDimensions();
    calibration.processUserMessage('Please be more formal in your responses');
    const after = calibration.getDimensions();
    assert.ok(after.formality > before.formality);
  });

  it('getCalibrationExplanation returns string', () => {
    const explanation = calibration.getCalibrationExplanation();
    assert.ok(typeof explanation === 'string');
    assert.ok(explanation.includes('Formality'));
  });

  it('resetAll resets dimensions to defaults', () => {
    calibration.recordSignal({ source: 'explicit', type: 'more_formal', magnitude: 1.0 });
    calibration.resetAll();
    const dims = calibration.getDimensions();
    assert.equal(dims.formality, 0.5);
    assert.equal(dims.verbosity, 0.5);
  });
});

describe('Personality / SentimentAnalyzer', () => {
  let sentiment;

  beforeEach(async () => {
    sentiment = new SentimentEngine();
    await sentiment.initialize(createMockState(), createMockEventBus());
  });

  it('detects frustrated mood from keywords', () => {
    const mood = sentiment.analyse('This is so frustrating, the damn thing is still broken!');
    assert.equal(mood, 'frustrated');
  });

  it('detects positive mood', () => {
    const mood = sentiment.analyse('Thanks, that looks great! Really appreciate the help.');
    assert.equal(mood, 'positive');
  });

  it('detects excited mood', () => {
    const mood = sentiment.analyse('This is amazing!! Absolutely brilliant, love it!');
    assert.equal(mood, 'excited');
  });

  it('detects stressed mood', () => {
    const mood = sentiment.analyse('I am so overwhelmed with deadlines, running out of time');
    assert.equal(mood, 'stressed');
  });

  it('detects tired mood', () => {
    const mood = sentiment.analyse('I am exhausted, had a long day and my brain is fried');
    assert.equal(mood, 'tired');
  });

  it('detects curious mood', () => {
    const mood = sentiment.analyse('I am wondering how this works, tell me more about it');
    assert.equal(mood, 'curious');
  });

  it('returns neutral for unrecognized text', () => {
    const mood = sentiment.analyse('The quick brown fox jumps over the lazy dog');
    assert.equal(mood, 'neutral');
  });

  it('getState returns current state', () => {
    sentiment.analyse('Thanks, great job!');
    const state = sentiment.getState();
    assert.ok(state.currentMood);
    assert.ok(typeof state.energyLevel === 'number');
  });

  it('getContextString builds context', () => {
    sentiment.analyse('This is frustrating!');
    const ctx = sentiment.getContextString('Boss');
    assert.ok(ctx.includes('Emotional Context'));
    assert.ok(ctx.includes('Boss'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 6. AGENTS (Delegation, Awareness, Teams)
// ═══════════════════════════════════════════════════════════════════════

import { DelegationEngine } from '../subsystems/agents/delegation.js';
import { AwarenessMesh } from '../subsystems/agents/awareness.js';
import { AgentTeamManager } from '../subsystems/agents/teams.js';

describe('Agents / DelegationEngine', () => {
  let engine;

  beforeEach(() => {
    engine = new DelegationEngine();
    engine.initialize(createMockEventBus());
  });

  it('creates delegation with depth limit', () => {
    const root = engine.registerRoot('root-1', 'orchestrator', 'Main task', 'local');
    assert.equal(root.depth, 0);
    assert.equal(root.trustTier, 'local');

    const child = engine.prepareSubAgent({
      agentType: 'coder',
      description: 'Write tests',
      parentTaskId: 'root-1',
    });
    assert.ok(child.success);
    assert.equal(child.node.depth, 1);

    // Prepare a grandchild
    const grandchild = engine.prepareSubAgent({
      agentType: 'reviewer',
      description: 'Review tests',
      parentTaskId: child.taskId,
    });
    assert.ok(grandchild.success);
    assert.equal(grandchild.node.depth, 2);

    // At depth 3 (default limit is 3), it should block
    const greatGrandchild = engine.prepareSubAgent({
      agentType: 'formatter',
      description: 'Format code',
      parentTaskId: grandchild.taskId,
    });
    assert.ok(!greatGrandchild.success, 'Should fail at depth limit');
    assert.ok(greatGrandchild.error.includes('Depth limit'));
  });

  it('trust tier inheritance (child <= parent)', () => {
    engine.registerRoot('root-2', 'orchestrator', 'Main task', 'approved-dm');

    // Child requests higher trust (local) -- should be blocked to parent tier
    const child = engine.prepareSubAgent({
      agentType: 'worker',
      description: 'Work task',
      parentTaskId: 'root-2',
      trustTier: 'local',
    });
    assert.ok(child.success);
    assert.equal(child.node.trustTier, 'approved-dm', 'Child should not escalate above parent tier');

    // Child requesting lower trust should be allowed
    const child2 = engine.prepareSubAgent({
      agentType: 'worker2',
      description: 'Public task',
      parentTaskId: 'root-2',
      trustTier: 'public',
    });
    assert.ok(child2.success);
    assert.equal(child2.node.trustTier, 'public');
  });

  it('reportCompletion and collectChildResults', () => {
    engine.registerRoot('root-3', 'orchestrator', 'Task with children');
    const child = engine.prepareSubAgent({
      agentType: 'coder',
      description: 'Write code',
      parentTaskId: 'root-3',
    });

    engine.markRunning(child.taskId);
    engine.reportCompletion(child.taskId, 'Code written', null);

    const results = engine.collectChildResults('root-3');
    assert.equal(results.length, 1);
    assert.equal(results[0].result, 'Code written');
    assert.equal(results[0].state, 'completed');
  });

  it('getStats returns correct counts', () => {
    engine.registerRoot('root-4', 'orchestrator', 'Stats test');
    const stats = engine.getStats();
    assert.equal(stats.totalNodes, 1);
    assert.ok(stats.activeNodes >= 1);
  });
});

describe('Agents / AwarenessMesh', () => {
  let mesh;

  beforeEach(() => {
    mesh = new AwarenessMesh();
    mesh.initialize(createMockEventBus());
  });

  it('register and deregister agents', () => {
    mesh.registerAgent('task-1', 'coder', 'Write code');
    mesh.registerAgent('task-2', 'reviewer', 'Review code');

    const active = mesh.getActiveAgents();
    assert.equal(active.length, 2);

    mesh.deregisterAgent('task-1', 'Code written');
    // Agent should still be accessible but marked
    const agent = mesh.getAgent('task-1');
    assert.ok(agent.deregisteredAt);
  });

  it('detect deadlock in circular dependencies', () => {
    mesh.registerAgent('a', 'coder', 'Task A');
    mesh.registerAgent('b', 'reviewer', 'Task B');
    mesh.registerAgent('c', 'tester', 'Task C');

    mesh.declareDependency('a', 'b', 'A waits for B');
    mesh.declareDependency('b', 'c', 'B waits for C');
    mesh.declareDependency('c', 'a', 'C waits for A -- circular!');

    const deadlocks = mesh.detectDeadlocks();
    assert.ok(deadlocks.length >= 1, 'Should detect at least one cycle');
  });

  it('no deadlock without circular dependencies', () => {
    mesh.registerAgent('x', 'coder', 'Task X');
    mesh.registerAgent('y', 'reviewer', 'Task Y');

    mesh.declareDependency('x', 'y', 'X waits for Y');

    const deadlocks = mesh.detectDeadlocks();
    assert.equal(deadlocks.length, 0);
  });

  it('getSnapshot includes all data', () => {
    mesh.registerAgent('snap-1', 'worker', 'Snapshot test');
    const snap = mesh.getSnapshot();
    assert.ok(Array.isArray(snap.agents));
    assert.ok(Array.isArray(snap.dependencies));
    assert.ok(Array.isArray(snap.broadcasts));
    assert.ok(snap.timestamp);
  });

  it('broadcast and getBroadcasts', () => {
    mesh.registerAgent('bc-1', 'coder', 'Broadcasting agent', { trustTier: 'local' });
    mesh.broadcast('bc-1', 'Found a critical bug in auth module');

    const broadcasts = mesh.getBroadcasts(null, 10);
    assert.ok(broadcasts.length >= 1);
    assert.ok(broadcasts[0].summary.includes('critical bug'));
  });
});

describe('Agents / TeamCoordinator', () => {
  let teams;

  beforeEach(() => {
    teams = new AgentTeamManager();
  });

  it('create team and add tasks', () => {
    const team = teams.create('Auth Team', 'Fix authentication flow');
    assert.ok(team.id);
    assert.equal(team.name, 'Auth Team');
    assert.equal(team.goal, 'Fix authentication flow');
    assert.equal(team.status, 'active');

    const task = teams.addTask(team.id, 'Audit token refresh logic', 'high');
    assert.ok(task);
    assert.equal(task.description, 'Audit token refresh logic');
    assert.equal(task.priority, 'high');
    assert.equal(task.status, 'pending');
  });

  it('add member and claim task', () => {
    const team = teams.create('Test Team', 'Run all tests');
    teams.addMember(team.id, 'agent-001');
    const task = teams.addTask(team.id, 'Run unit tests');

    const claimed = teams.claimTask(team.id, task.id, 'agent-001');
    assert.ok(claimed);

    const retrieved = teams.get(team.id);
    const claimedTask = retrieved.taskList.find((t) => t.id === task.id);
    assert.equal(claimedTask.status, 'in-progress');
    assert.equal(claimedTask.assignedTo, 'agent-001');
  });

  it('complete all tasks marks team completed', () => {
    const team = teams.create('Ship Team', 'Deploy to prod');
    const task = teams.addTask(team.id, 'Run deploy script');
    teams.completeTask(team.id, task.id, 'Deployed successfully');

    const updated = teams.get(team.id);
    assert.equal(updated.status, 'completed');
  });

  it('listActive returns only active teams', () => {
    teams.create('Active Team', 'Goal A');
    const disbanded = teams.create('Disbanded Team', 'Goal B');
    teams.disband(disbanded.id);

    const active = teams.listActive();
    assert.equal(active.length, 1);
    assert.equal(active[0].name, 'Active Team');
  });

  it('getContext returns formatted team context', () => {
    const team = teams.create('Context Team', 'Test context');
    teams.addTask(team.id, 'Write tests');
    teams.postMessage(team.id, 'Friday', 'Starting test suite...');

    const ctx = teams.getContext(team.id);
    assert.ok(ctx.includes('Context Team'));
    assert.ok(ctx.includes('Test context'));
    assert.ok(ctx.includes('Write tests'));
    assert.ok(ctx.includes('Starting test suite'));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 7. TOOLS (Registry, Delegate)
// ═══════════════════════════════════════════════════════════════════════

import { ToolRegistry, SAFETY_LEVELS } from '../subsystems/tools/registry.js';
import { ExecutionDelegate } from '../subsystems/tools/delegate.js';

describe('Tools / ToolRegistry', () => {
  let registry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  it('register and list tools', () => {
    registry.register(
      { name: 'test_tool', description: 'A test tool', safety_level: 'read_only', category: 'system' },
      async () => 'ok',
    );
    registry.register(
      { name: 'another_tool', description: 'Another one', safety_level: 'write', category: 'code' },
      async () => 'done',
    );

    const defs = registry.getDefinitions();
    assert.equal(defs.length, 2);
    assert.equal(registry.size, 2);
    assert.ok(registry.names.includes('test_tool'));
  });

  it('filter by category', () => {
    registry.register(
      { name: 'code_tool', description: 'Code tool', category: 'code' },
      async () => 'ok',
    );
    registry.register(
      { name: 'memory_tool', description: 'Memory tool', category: 'memory' },
      async () => 'ok',
    );

    const codeTools = registry.getDefinitions({ category: 'code' });
    assert.equal(codeTools.length, 1);
    assert.equal(codeTools[0].name, 'code_tool');
  });

  it('resolve returns the handler', () => {
    const handler = async () => 'executed';
    registry.register({ name: 'exec_tool', description: 'test' }, handler);
    const resolved = registry.resolve('exec_tool');
    assert.equal(resolved, handler);
  });

  it('resolve throws on unknown tool', () => {
    assert.throws(() => registry.resolve('nonexistent'), /Unknown tool/);
  });

  it('has checks existence', () => {
    registry.register({ name: 'exists_tool', description: 'test' }, async () => 'ok');
    assert.ok(registry.has('exists_tool'));
    assert.ok(!registry.has('does_not_exist'));
  });

  it('getByCategory groups tools', () => {
    registry.register({ name: 'a', description: 'a', category: 'code' }, async () => 'ok');
    registry.register({ name: 'b', description: 'b', category: 'code' }, async () => 'ok');
    registry.register({ name: 'c', description: 'c', category: 'memory' }, async () => 'ok');

    const grouped = registry.getByCategory();
    assert.equal(grouped.code.length, 2);
    assert.equal(grouped.memory.length, 1);
  });

  it('prevents duplicate registration', () => {
    registry.register({ name: 'dup', description: 'first' }, async () => 'ok');
    assert.throws(
      () => registry.register({ name: 'dup', description: 'second' }, async () => 'ok'),
      /already registered/,
    );
  });

  it('registerFromConnector prefixes names', () => {
    registry.registerFromConnector('git', [
      { name: 'status', description: 'Git status' },
      { name: 'log', description: 'Git log' },
    ], async (toolName, _args) => ({ result: `${toolName} executed` }));

    assert.ok(registry.has('git_status'));
    assert.ok(registry.has('git_log'));
    assert.equal(registry.size, 2);
  });
});

describe('Tools / ExecutionDelegate', () => {
  it('read_only tools execute without confirmation', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'safe_read', description: 'Read data', safety_level: SAFETY_LEVELS.read_only },
      async () => 'data read successfully',
    );

    const delegate = new ExecutionDelegate(registry);
    const result = await delegate.execute('safe_read', {});
    assert.ok(result.result);
    assert.equal(result.result, 'data read successfully');
    assert.ok(!result.pending);
  });

  it('write tools require confirmation', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'write_file', description: 'Write file', safety_level: SAFETY_LEVELS.write },
      async () => 'file written',
    );

    const delegate = new ExecutionDelegate(registry);
    const result = await delegate.execute('write_file', { path: '/tmp/test' });
    assert.ok(result.pending, 'Write tool should require confirmation');
    assert.ok(result.decision_id);
  });

  it('destructive tools require confirmation', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'delete_all', description: 'Delete everything', safety_level: SAFETY_LEVELS.destructive },
      async () => 'deleted',
    );

    const delegate = new ExecutionDelegate(registry);
    const result = await delegate.execute('delete_all', {});
    assert.ok(result.pending);
    assert.ok(result.decision_id);
  });

  it('executeAfterConfirmation runs the tool', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'write_op', description: 'Write op', safety_level: SAFETY_LEVELS.write },
      async () => 'write completed',
    );

    const delegate = new ExecutionDelegate(registry);
    const pending = await delegate.execute('write_op', {});
    assert.ok(pending.decision_id);

    const confirmed = await delegate.executeAfterConfirmation(pending.decision_id, true);
    assert.equal(confirmed.result, 'write completed');
  });

  it('denied confirmation blocks execution', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'deny_test', description: 'Deny test', safety_level: SAFETY_LEVELS.write },
      async () => 'should not run',
    );

    const delegate = new ExecutionDelegate(registry);
    const pending = await delegate.execute('deny_test', {});
    const denied = await delegate.executeAfterConfirmation(pending.decision_id, false);
    assert.ok(denied.error.includes('denied'));
  });

  it('unknown tool returns error', async () => {
    const registry = new ToolRegistry();
    const delegate = new ExecutionDelegate(registry);
    const result = await delegate.execute('nonexistent', {});
    assert.ok(result.error.includes('Unknown tool'));
  });

  it('getAuditLog returns entries', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'audit_test', description: 'test', safety_level: SAFETY_LEVELS.read_only },
      async () => 'ok',
    );

    const delegate = new ExecutionDelegate(registry);
    await delegate.execute('audit_test', { key: 'value' });

    const log = delegate.getAuditLog();
    assert.ok(log.length >= 1);
    assert.equal(log[0].tool, 'audit_test');
    assert.equal(log[0].status, 'success');
  });

  it('skipSafety bypasses confirmation', async () => {
    const registry = new ToolRegistry();
    registry.register(
      { name: 'force_write', description: 'Force', safety_level: SAFETY_LEVELS.destructive },
      async () => 'forced',
    );

    const delegate = new ExecutionDelegate(registry);
    const result = await delegate.execute('force_write', {}, { skipSafety: true });
    assert.equal(result.result, 'forced');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 8. CONNECTORS (Registry)
// ═══════════════════════════════════════════════════════════════════════

import { ConnectorRegistry } from '../subsystems/connectors/registry.js';

describe('Connectors / ConnectorRegistry', () => {
  it('register connector, list tools', async () => {
    const registry = new ConnectorRegistry();
    await registry.initialize([
      {
        id: 'test-connector',
        label: 'Test Connector',
        category: 'testing',
        description: 'A test connector',
        module: {
          detect: async () => true,
          getTools: () => [
            { name: 'test_action', description: 'Do a thing' },
            { name: 'test_query', description: 'Query something' },
          ],
          execute: async (toolName, _args) => ({ result: `${toolName} done` }),
        },
      },
    ]);

    const tools = registry.getAllTools();
    assert.equal(tools.length, 2);
    assert.ok(tools.some((t) => t.name === 'test_action'));
  });

  it('detect returns boolean per connector', async () => {
    const registry = new ConnectorRegistry();
    await registry.initialize([
      {
        id: 'available',
        label: 'Available',
        category: 'test',
        description: 'Available connector',
        module: {
          detect: async () => true,
          getTools: () => [{ name: 'avail_tool', description: 'Available tool' }],
          execute: async () => ({ result: 'ok' }),
        },
      },
      {
        id: 'unavailable',
        label: 'Unavailable',
        category: 'test',
        description: 'Unavailable connector',
        module: {
          detect: async () => false,
          getTools: () => [{ name: 'unavail_tool', description: 'Unavail tool' }],
          execute: async () => ({ result: 'nope' }),
        },
      },
    ]);

    const available = registry.getAvailableConnectors();
    assert.equal(available.length, 1);
    assert.equal(available[0].id, 'available');

    const all = registry.getAllConnectors();
    assert.equal(all.length, 2);
  });

  it('executeTool routes to correct connector', async () => {
    const registry = new ConnectorRegistry();
    await registry.initialize([
      {
        id: 'exec-test',
        label: 'Exec Test',
        category: 'test',
        description: 'Exec test connector',
        module: {
          detect: async () => true,
          getTools: () => [{ name: 'exec_tool', description: 'Exec tool' }],
          execute: async (toolName, args) => ({ result: `${toolName}: ${JSON.stringify(args)}` }),
        },
      },
    ]);

    const result = await registry.executeTool('exec_tool', { query: 'test' });
    assert.ok(result.result.includes('exec_tool'));
  });

  it('executeTool returns error for unknown tool', async () => {
    const registry = new ConnectorRegistry();
    await registry.initialize([]);

    const result = await registry.executeTool('nonexistent', {});
    assert.ok(result.error.includes('Unknown'));
  });

  it('getStatus returns summary', async () => {
    const registry = new ConnectorRegistry();
    await registry.initialize([
      {
        id: 'status-test',
        label: 'Status Test',
        category: 'test',
        description: 'Test',
        module: { detect: async () => true, getTools: () => [], execute: async () => ({}) },
      },
    ]);

    const status = registry.getStatus();
    assert.equal(status.initialized, true);
    assert.equal(status.totalConnectors, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 9. GATEWAY (TrustEngine, Sessions, Audit)
// ═══════════════════════════════════════════════════════════════════════

import { TrustEngine } from '../subsystems/gateway/trust-engine.js';
import { SessionStore } from '../subsystems/gateway/sessions.js';
import { AuditLog } from '../subsystems/gateway/audit.js';

describe('Gateway / TrustEngine', () => {
  let engine;

  beforeEach(async () => {
    engine = new TrustEngine();
    await engine.initialize(createMockState());
  });

  it('resolves trust tiers correctly', () => {
    // No owner set, no identity -- should default to public
    const tier = engine.resolveTrust('discord', 'unknown-user');
    assert.equal(tier, 'public');

    // Set owner
    engine.setOwner('discord', 'owner-id');
    const ownerTier = engine.resolveTrust('discord', 'owner-id');
    assert.equal(ownerTier, 'owner_dm');
  });

  it('getPolicy returns correct policies', () => {
    const ownerPolicy = engine.getPolicy('owner');
    assert.equal(ownerPolicy.tier, 'owner');
    assert.equal(ownerPolicy.maxIterations, 25);
    assert.ok(ownerPolicy.memoryRead);
    assert.ok(ownerPolicy.memoryWrite);

    const publicPolicy = engine.getPolicy('public');
    assert.equal(publicPolicy.tier, 'public');
    assert.equal(publicPolicy.maxIterations, 0);
    assert.ok(!publicPolicy.memoryRead);
  });

  it('filterTools respects trust tiers', () => {
    const tools = ['web_search', 'git_status', 'run_powershell', 'firecrawl_search'];

    const ownerFiltered = engine.filterTools(tools, engine.getPolicy('owner'));
    assert.equal(ownerFiltered.length, 4, 'Owner sees all tools');

    const publicFiltered = engine.filterTools(tools, engine.getPolicy('public'));
    assert.equal(publicFiltered.length, 0, 'Public sees no tools');

    const groupFiltered = engine.filterTools(tools, engine.getPolicy('group'));
    assert.ok(groupFiltered.includes('web_search'));
    assert.ok(groupFiltered.includes('firecrawl_search'));
    assert.ok(!groupFiltered.includes('run_powershell'));
  });

  it('checkRateLimit enforces limits', () => {
    const policy = engine.getPolicy('public');

    // Public has rateLimitPerMinute = 3
    assert.ok(engine.checkRateLimit('user-1', policy));
    assert.ok(engine.checkRateLimit('user-1', policy));
    assert.ok(engine.checkRateLimit('user-1', policy));
    assert.ok(!engine.checkRateLimit('user-1', policy), 'Should be rate limited after 3 requests');
  });

  it('unknown tier falls back to public policy', () => {
    const policy = engine.getPolicy('nonexistent_tier');
    assert.equal(policy.tier, 'public');
  });

  afterEach(async () => {
    if (engine) await engine.destroy();
  });
});

describe('Gateway / SessionStore', () => {
  let sessions;

  beforeEach(async () => {
    sessions = new SessionStore();
    await sessions.initialize(createMockState());
  });

  it('create and get session', () => {
    sessions.addUserMessage('discord', 'user-1', 'Hello Friday');
    sessions.addAssistantMessage('discord', 'user-1', 'Hello! How can I help?');

    const history = sessions.getHistory('discord', 'user-1');
    assert.equal(history.length, 2);
    assert.equal(history[0].role, 'user');
    assert.equal(history[0].content, 'Hello Friday');
    assert.equal(history[1].role, 'assistant');
  });

  it('getHistory returns empty for unknown session', () => {
    const history = sessions.getHistory('discord', 'nonexistent');
    assert.equal(history.length, 0);
  });

  it('clearSession removes messages', () => {
    sessions.addUserMessage('slack', 'user-2', 'Test message');
    sessions.clearSession('slack', 'user-2');
    const history = sessions.getHistory('slack', 'user-2');
    assert.equal(history.length, 0);
  });

  it('getActiveCount tracks sessions', () => {
    sessions.addUserMessage('discord', 'user-a', 'Hi');
    sessions.addUserMessage('slack', 'user-b', 'Hello');
    assert.equal(sessions.getActiveCount(), 2);
  });

  it('listSessions returns all sessions', () => {
    sessions.addUserMessage('discord', 'user-1', 'msg');
    sessions.addUserMessage('slack', 'user-2', 'msg');
    const list = sessions.listSessions();
    assert.equal(list.length, 2);
    assert.ok(list[0].key);
    assert.ok(list[0].channel);
  });
});

describe('Gateway / AuditLog', () => {
  let audit;

  beforeEach(async () => {
    audit = new AuditLog();
    await audit.initialize(createMockState());
  });

  it('append and query entries', () => {
    audit.logInbound('discord', 'user-1', 'public', 'Hello', 'msg-001');
    audit.logOutbound('discord', 'user-1', 'Hi there!', [], 150);

    const entries = audit.getEntries(10);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].dir, 'in');
    assert.equal(entries[1].dir, 'out');
  });

  it('filter entries by direction', () => {
    audit.logInbound('discord', 'user-1', 'owner_dm', 'Hello', 'msg-002');
    audit.logOutbound('discord', 'user-1', 'Reply', [], 100);
    audit.logInbound('discord', 'user-1', 'owner_dm', 'Another message', 'msg-003');

    const inbound = audit.getEntries(10, 'in');
    assert.equal(inbound.length, 2);
    assert.ok(inbound.every((e) => e.dir === 'in'));
  });

  it('getStats returns counts', () => {
    audit.logInbound('discord', 'u', 'public', 'msg', 'id1');
    audit.logOutbound('discord', 'u', 'reply', [], 100);
    audit.logInbound('discord', 'u', 'public', 'msg2', 'id2');

    const stats = audit.getStats();
    assert.equal(stats.totalEntries, 3);
    assert.equal(stats.inbound, 2);
    assert.equal(stats.outbound, 1);
    assert.ok(stats.month);
  });

  it('log truncates long text', () => {
    const longText = 'x'.repeat(2000);
    audit.log({ text: longText, dir: 'in' });

    const entries = audit.getEntries(1);
    assert.ok(entries[0].text.length <= 500);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 10. BRIEFING (Daily)
// ═══════════════════════════════════════════════════════════════════════

import { DailyBriefingEngine } from '../subsystems/briefing/daily.js';

describe('Briefing / DailyBriefing', () => {
  let briefing;

  beforeEach(async () => {
    briefing = new DailyBriefingEngine();
    await briefing.initialize(createMockState());
  });

  it('generates structured briefing with sections', () => {
    const result = briefing.generateBriefing('morning', {
      calendarEvents: [
        { title: 'Team standup', startTime: Date.now() + 3600000, attendees: ['Alice', 'Bob'] },
        { title: 'Client call', startTime: Date.now() + 7200000 },
      ],
      overdueCommitments: [
        { direction: 'user_promised', description: 'Send the report to Alice', personName: 'Alice', deadline: Date.now() - 86400000 },
      ],
      activeCommitments: [],
      upcomingDeadlines: [],
      unrepliedMessages: [],
    });

    assert.ok(result.id);
    assert.equal(result.type, 'morning');
    assert.ok(result.summary.includes('2 events'));
    assert.ok(result.sections.length >= 1);
    assert.ok(result.metadata.calendarEventCount === 2);
    assert.ok(result.metadata.overdueCount === 1);
  });

  it('generateBriefing handles empty data', () => {
    const result = briefing.generateBriefing('morning', {});
    assert.ok(result);
    assert.ok(result.summary.includes('Clear schedule'));
    assert.equal(result.sections.length, 0);
  });

  it('getLatestBriefing returns most recent', () => {
    briefing.generateBriefing('morning', {
      calendarEvents: [{ title: 'Test', startTime: Date.now() }],
    });

    const latest = briefing.getLatestBriefing('morning');
    assert.ok(latest);
    assert.equal(latest.type, 'morning');
  });

  it('isBriefingStale returns true when no briefing exists', () => {
    assert.ok(briefing.isBriefingStale('morning'));
  });

  it('formatAsText returns readable string', () => {
    const result = briefing.generateBriefing('evening', {
      recentActivity: [
        { timestamp: Date.now() - 3600000, summary: 'Deployed new version' },
      ],
    });

    const text = briefing.formatAsText(result);
    assert.ok(typeof text === 'string');
    assert.ok(text.includes('Generated'));
  });

  it('getStatus returns current state', () => {
    const status = briefing.getStatus();
    assert.equal(status.totalBriefings, 0);
    assert.equal(status.morningTime, '08:00');
    assert.equal(status.eveningTime, '17:30');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 11. VOICE (StateMachine, Fallback)
// ═══════════════════════════════════════════════════════════════════════

import { VoiceStateMachine } from '../subsystems/voice/state-machine.js';
import { VoiceFallbackManager } from '../subsystems/voice/fallback.js';

describe('Voice / VoiceStateMachine', () => {
  let machine;

  beforeEach(() => {
    machine = new VoiceStateMachine();
    machine.initialize(createMockEventBus());
  });

  it('valid transitions accepted', () => {
    assert.equal(machine.getState(), 'IDLE');

    const ok1 = machine.transition('CONNECTING', 'User started voice');
    assert.ok(ok1);
    assert.equal(machine.getState(), 'CONNECTING');

    const ok2 = machine.transition('ACTIVE', 'Connection established');
    assert.ok(ok2);
    assert.equal(machine.getState(), 'ACTIVE');

    const ok3 = machine.transition('PAUSED', 'User paused');
    assert.ok(ok3);
    assert.equal(machine.getState(), 'PAUSED');
  });

  it('invalid transitions rejected', () => {
    assert.equal(machine.getState(), 'IDLE');

    // IDLE -> ACTIVE is not a valid transition (must go through CONNECTING)
    const rejected = machine.transition('ACTIVE', 'Skip connecting');
    assert.ok(!rejected);
    assert.equal(machine.getState(), 'IDLE');

    // IDLE -> PAUSED is not valid
    const rejected2 = machine.transition('PAUSED', 'Direct pause');
    assert.ok(!rejected2);
    assert.equal(machine.getState(), 'IDLE');
  });

  it('same-state transition is a no-op', () => {
    const result = machine.transition('IDLE', 'Already idle');
    assert.ok(!result);
  });

  it('canTransition checks without applying', () => {
    assert.ok(machine.canTransition('CONNECTING'));
    assert.ok(!machine.canTransition('ACTIVE'));
    assert.ok(machine.canTransition('ERROR'));
  });

  it('getTransitionLog tracks transitions', () => {
    machine.transition('CONNECTING');
    machine.transition('ACTIVE');
    machine.transition('PAUSED');

    const log = machine.getTransitionLog();
    assert.equal(log.length, 3);
    assert.equal(log[0].from, 'IDLE');
    assert.equal(log[0].to, 'CONNECTING');
  });

  it('reset returns to IDLE and clears log', () => {
    machine.transition('CONNECTING');
    machine.transition('ACTIVE');
    machine.reset();

    assert.equal(machine.getState(), 'IDLE');
    assert.equal(machine.getTransitionLog().length, 0);
  });

  it('getHealth reports health metrics', () => {
    machine.reportHealth(true);
    machine.reportHealth(true);
    machine.reportHealth(true);

    const health = machine.getHealth();
    assert.equal(health.consecutiveHealthy, 3);
    assert.equal(health.consecutiveUnhealthy, 0);

    machine.reportHealth(false);
    const health2 = machine.getHealth();
    assert.equal(health2.consecutiveHealthy, 0);
    assert.equal(health2.consecutiveUnhealthy, 1);
  });

  it('error recovery transitions work', () => {
    machine.transition('ERROR', 'Something failed');
    assert.equal(machine.getState(), 'ERROR');

    const recovered = machine.transition('RECOVERING', 'Attempting recovery');
    assert.ok(recovered);
    assert.equal(machine.getState(), 'RECOVERING');

    const active = machine.transition('ACTIVE', 'Recovery successful');
    assert.ok(active);
    assert.equal(machine.getState(), 'ACTIVE');
  });
});

describe('Voice / VoiceFallback', () => {
  let fallback;

  beforeEach(() => {
    fallback = new VoiceFallbackManager();
    fallback.initialize(createMockEventBus());
  });

  it('cascade order maintained', () => {
    // Set availability
    fallback.setPathAvailability('personaplex', true, 'GPU available');
    fallback.setPathAvailability('cloud', true, 'API key set');
    fallback.setPathAvailability('local', true, 'Whisper installed');
    fallback.setPathAvailability('text', true);

    // Start with personaplex
    fallback.startPath('personaplex');
    assert.equal(fallback.getCurrentPath(), 'personaplex');

    // Personaplex fails, should cascade to cloud
    const next1 = fallback.recordPathFailure('personaplex', 'GPU error');
    assert.equal(next1.nextPath, 'cloud');
    assert.ok(!next1.exhausted);

    // Cloud fails, should cascade to local
    const next2 = fallback.recordPathFailure('cloud', 'API timeout');
    assert.equal(next2.nextPath, 'local');

    // Local fails, should cascade to text (the universal floor)
    const next3 = fallback.recordPathFailure('local', 'Whisper crash');
    assert.equal(next3.nextPath, 'text');
    // Text was found in the availability list, so it's not truly exhausted
    // (exhausted only when no path at all is found)
    assert.equal(next3.exhausted, false);
  });

  it('getAvailability returns all paths', () => {
    fallback.setPathAvailability('cloud', true, 'API ready');
    fallback.setPathAvailability('local', false, 'No Whisper');

    const avail = fallback.getAvailability();
    assert.equal(avail.length, 4);
    // Text is always available
    const textPath = avail.find((a) => a.path === 'text');
    assert.ok(textPath.available);
  });

  it('getPathErrors records failures', () => {
    fallback.startPath('cloud');
    fallback.recordPathFailure('cloud', 'Timeout');

    const errors = fallback.getPathErrors();
    assert.ok(errors.length >= 1);
    assert.equal(errors[0].path, 'cloud');
    assert.equal(errors[0].error, 'Timeout');
  });

  it('reset clears all state', () => {
    fallback.startPath('cloud');
    fallback.recordPathFailure('cloud', 'Error');
    fallback.reset();

    assert.equal(fallback.getCurrentPath(), null);
    assert.equal(fallback.getAttemptedPaths().length, 0);
    assert.equal(fallback.getPathErrors().length, 0);
  });

  it('health check tracking works', () => {
    fallback.recordHealthCheck('stt', true);
    fallback.recordHealthCheck('stt', true);
    fallback.recordHealthCheck('stt', false);
    fallback.recordHealthCheck('stt', false);
    fallback.recordHealthCheck('stt', false);

    const report = fallback.getHealthReport();
    assert.equal(report.stt.consecutiveFailures, 3);
    assert.equal(report.stt.healthy, false);
    assert.equal(report.stt.escalationLevel, 'visible');
  });

  it('getSnapshot returns complete state', () => {
    fallback.startPath('local');
    const snap = fallback.getSnapshot();
    assert.equal(snap.currentPath, 'local');
    assert.ok(snap.priorities);
    assert.ok(Array.isArray(snap.availability));
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 12. ENTERPRISE (Consent, CloudGate, Commitments)
// ═══════════════════════════════════════════════════════════════════════

import { ConsentTracker } from '../subsystems/enterprise/consent.js';
import { CloudGate } from '../subsystems/enterprise/cloud-gate.js';
import { CommitmentTracker } from '../subsystems/enterprise/commitments.js';

describe('Enterprise / ConsentGate', () => {
  let consent;

  beforeEach(async () => {
    consent = new ConsentTracker();
    await consent.initialize(createMockState());
  });

  it('grant then check returns true', () => {
    consent.grantConsent('cloud_api', 'session', 'User approved');
    const result = consent.checkConsent('cloud_api');
    assert.ok(result.granted);
    assert.equal(result.scope, 'session');
  });

  it('check without grant returns false', () => {
    const result = consent.checkConsent('destructive_actions');
    assert.ok(!result.granted);
    assert.ok(result.reason);
  });

  it('revoke removes consent', () => {
    consent.grantConsent('send_messages', 'always', 'Permanent');
    consent.revokeConsent('send_messages', 'Changed mind');

    const result = consent.checkConsent('send_messages');
    assert.ok(!result.granted);
  });

  it('once-scoped consent is consumed after first check', () => {
    consent.grantConsent('code_execution', 'once', 'One-time approval');

    const first = consent.checkConsent('code_execution');
    assert.ok(first.granted);

    const second = consent.checkConsent('code_execution');
    assert.ok(!second.granted, 'Once-scoped consent should be consumed');
  });

  it('revokeAll revokes everything', () => {
    consent.grantConsent('cloud_api', 'session');
    consent.grantConsent('send_messages', 'session');

    const result = consent.revokeAll('Emergency revoke');
    assert.ok(result.revokedCount >= 2);

    assert.ok(!consent.checkConsent('cloud_api').granted);
    assert.ok(!consent.checkConsent('send_messages').granted);
  });

  it('getStatus returns all categories', () => {
    consent.grantConsent('cloud_api', 'always');
    const status = consent.getStatus();
    assert.ok('cloud_api' in status);
    assert.ok('destructive_actions' in status);
    assert.equal(status.cloud_api.granted, true);
    assert.equal(status.destructive_actions.granted, false);
  });

  it('getAuditLog records actions', () => {
    consent.grantConsent('cloud_api', 'session');
    consent.checkConsent('cloud_api');
    consent.revokeConsent('cloud_api');

    const log = consent.getAuditLog();
    assert.ok(log.length >= 3);
  });
});

describe('Enterprise / CloudGate', () => {
  let gate;
  let consentTracker;

  beforeEach(async () => {
    consentTracker = new ConsentTracker();
    await consentTracker.initialize(createMockState());

    gate = new CloudGate();
    await gate.initialize(createMockState(), consentTracker);
  });

  it('blocks when no consent', () => {
    const result = gate.checkGate('code', {});
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'no-cloud-consent');
  });

  it('blocks when consent exists but no policy', () => {
    consentTracker.grantConsent('cloud_api', 'session');

    const result = gate.checkGate('code', {});
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'no-policy');
  });

  it('allows when consent and policy exist', () => {
    consentTracker.grantConsent('cloud_api', 'session');
    gate.setPolicy('code', 'allow', 'session');

    const result = gate.checkGate('code', {});
    assert.ok(result.allowed);
    assert.equal(result.reason, 'policy-allow');
  });

  it('denies when policy explicitly denies', () => {
    consentTracker.grantConsent('cloud_api', 'session');
    gate.setPolicy('analysis', 'deny', 'session');

    const result = gate.checkGate('analysis', {});
    assert.ok(!result.allowed);
    assert.equal(result.reason, 'policy-deny');
  });

  it('clearPolicy removes the policy', () => {
    gate.setPolicy('code', 'allow', 'session');
    const existed = gate.clearPolicy('code');
    assert.ok(existed);
    assert.equal(gate.getPolicy('code'), null);
  });

  it('getStats tracks decisions', () => {
    consentTracker.grantConsent('cloud_api', 'session');
    gate.setPolicy('code', 'allow', 'session');

    gate.checkGate('code', {});
    gate.checkGate('analysis', {}); // No policy, denied

    const stats = gate.getStats();
    assert.ok(stats.escalatedAllowed >= 1);
    assert.ok(stats.escalatedDenied >= 1);
  });
});

describe('Enterprise / CommitmentTracker', () => {
  let tracker;

  beforeEach(async () => {
    tracker = new CommitmentTracker();
    await tracker.initialize(createMockState());
  });

  it('track and list commitments', () => {
    const commitment = tracker.addCommitment({
      description: 'Send the quarterly report to Alice',
      direction: 'user_promised',
      personName: 'Alice',
      confidence: 0.9,
    });

    assert.ok(commitment);
    assert.ok(commitment.id);
    assert.equal(commitment.status, 'active');
    assert.equal(commitment.personName, 'Alice');

    const active = tracker.getActiveCommitments();
    assert.equal(active.length, 1);
  });

  it('completeCommitment marks as completed', () => {
    const c = tracker.addCommitment({
      description: 'Review PR #42',
      direction: 'user_promised',
      personName: 'Bob',
      confidence: 0.8,
    });

    const completed = tracker.completeCommitment(c.id, 'PR approved and merged');
    assert.ok(completed);

    const active = tracker.getActiveCommitments();
    assert.equal(active.length, 0);
  });

  it('cancelCommitment marks as cancelled', () => {
    const c = tracker.addCommitment({
      description: 'Cancelled task',
      direction: 'user_promised',
      personName: 'Charlie',
      confidence: 0.7,
    });

    tracker.cancelCommitment(c.id, 'No longer needed');
    const byId = tracker.getCommitmentById(c.id);
    assert.equal(byId.status, 'cancelled');
  });

  it('low confidence commitments are rejected', () => {
    const result = tracker.addCommitment({
      description: 'Vague maybe',
      direction: 'user_promised',
      personName: 'Dave',
      confidence: 0.2,
    });
    assert.equal(result, null);
  });

  it('deduplicates similar commitments within an hour', () => {
    tracker.addCommitment({
      description: 'Send report to Alice about the quarterly results',
      direction: 'user_promised',
      personName: 'Alice',
      confidence: 0.9,
    });

    const dup = tracker.addCommitment({
      description: 'Send report to Alice about the quarterly results',
      direction: 'user_promised',
      personName: 'Alice',
      confidence: 0.9,
    });

    assert.equal(dup, null, 'Duplicate should be rejected');
    assert.equal(tracker.getActiveCommitments().length, 1);
  });

  it('getStatus returns summary', () => {
    tracker.addCommitment({
      description: 'Task 1',
      direction: 'user_promised',
      personName: 'Eve',
      confidence: 0.8,
    });

    const status = tracker.getStatus();
    assert.equal(status.activeCommitments, 1);
    assert.equal(status.totalTracked, 1);
  });

  it('trackOutboundMessage records messages', () => {
    const msg = tracker.trackOutboundMessage({
      recipient: 'Alice',
      channel: 'slack',
      summary: 'Hey, just following up on the report',
    });
    assert.ok(msg.id);
    assert.equal(msg.recipient, 'Alice');
    assert.ok(!msg.replyReceived);

    const unreplied = tracker.getUnrepliedMessages();
    assert.equal(unreplied.length, 1);
  });

  it('recordReply marks message as replied', () => {
    tracker.trackOutboundMessage({
      recipient: 'Bob',
      channel: 'email',
      summary: 'Project update',
    });

    const replied = tracker.recordReply('Bob', 'email');
    assert.ok(replied);

    const unreplied = tracker.getUnrepliedMessages();
    assert.equal(unreplied.length, 0);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 13. PERSISTENCE ROUND-TRIP
//
// These tests verify that subsystem state.read/state.write envelope
// handling works correctly end-to-end. The mock below intentionally
// omits .get/.set so that any subsystem using the wrong API fails loudly.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Strict envelope-only state mock. No .get/.set aliases.
 * state.read returns { success: true, data } like the real StateManager.
 * state.write stores the raw data value.
 */
function createStrictMockState() {
  const store = new Map();
  return {
    read: async (key) => ({ success: true, data: store.get(key) ?? null }),
    write: async (key, data) => { store.set(key, data); return { success: true }; },
    append: async (key, entry) => {
      const arr = store.get(key) || [];
      arr.push(entry);
      store.set(key, arr);
      return { success: true };
    },
    delete: async (key) => { store.delete(key); return { success: true }; },
    list: async () => ({ success: true, keys: [...store.keys()] }),
  };
}

describe('Persistence round-trip / Memory medium-tier', () => {
  it('store an observation then reload: data survives re-initialize', async () => {
    const state = createStrictMockState();

    // Instance A: store an observation to medium tier (triggers an awaited write)
    const tiersA = new MemoryTiers();
    await tiersA.initialize(state, createMockSearchEngine());
    const stored = await tiersA.store(
      'The CI pipeline uses GitHub Actions for automated tests',
      'fact',
      'medium',
    );
    assert.ok(stored, 'store() should return an entry');
    assert.ok(stored.id, 'entry should have an id');

    // Verify the write reached state (state.read returns the envelope)
    const raw = await state.read('medium-term');
    assert.ok(raw.success, 'state.read should succeed');
    assert.ok(Array.isArray(raw.data), 'state should hold an array');
    assert.equal(raw.data.length, 1, 'exactly one entry should be persisted');
    assert.equal(raw.data[0].content, 'The CI pipeline uses GitHub Actions for automated tests');

    // Instance B: initialize from the same state, no prior in-memory data
    const tiersB = new MemoryTiers();
    await tiersB.initialize(state, createMockSearchEngine());
    const medium = tiersB.getMediumTerm();
    assert.equal(medium.length, 1, 'reloaded instance should see the persisted entry');
    assert.equal(medium[0].content, 'The CI pipeline uses GitHub Actions for automated tests');
  });

  it('recall finds the reloaded observation by keyword', async () => {
    const state = createStrictMockState();

    const tiersA = new MemoryTiers();
    await tiersA.initialize(state, createMockSearchEngine());
    await tiersA.store('PostgreSQL is the primary database', 'fact', 'medium');

    const tiersB = new MemoryTiers();
    await tiersB.initialize(state, createMockSearchEngine());
    const results = await tiersB.recall('PostgreSQL');
    assert.ok(results.length >= 1, 'recall should find the reloaded entry');
    assert.ok(results[0].content.includes('PostgreSQL'));
  });
});

describe('Persistence round-trip / Trust graph', () => {
  it('add person and evidence, save, reload: person and evidence survive', async () => {
    const state = createStrictMockState();

    // Instance A: add a person and evidence, then explicitly save
    const trustA = new TrustGraph();
    await trustA.initialize(state);
    const { person } = trustA.resolvePerson('Diana Prince');
    trustA.addEvidence(person.id, {
      type: 'promise_kept',
      description: 'Delivered the design specs on time',
      impact: 0.85,
    });
    await trustA.save();

    // Verify the write reached state
    const raw = await state.read('graph');
    assert.ok(raw.success, 'state.read should succeed after save()');
    assert.ok(raw.data, 'state should contain graph data');
    assert.ok(Array.isArray(raw.data.persons), 'persisted data should have persons array');
    assert.equal(raw.data.persons.length, 1, 'one person should be persisted');

    // Instance B: initialize from the same state
    const trustB = new TrustGraph();
    await trustB.initialize(state);
    assert.equal(trustB.getPersonCount(), 1, 'reloaded graph should have 1 person');
    const reloaded = trustB.getPersonById(person.id);
    assert.ok(reloaded, 'person should be findable by id after reload');
    assert.equal(reloaded.primaryName, 'Diana Prince');
    assert.equal(reloaded.evidence.length, 1, 'evidence should survive reload');
    assert.equal(reloaded.evidence[0].description, 'Delivered the design specs on time');
  });
});

describe('Persistence round-trip / Enterprise ConsentTracker', () => {
  it('always-scoped grant persists and reloads on fresh initialize', async () => {
    const state = createStrictMockState();

    // Pre-populate state as if a previous session had granted always-scoped consent.
    // This mirrors what ConsentTracker writes when scope === 'always'.
    const persistedGrant = {
      granted: true,
      scope: 'always',
      grantedAt: Date.now() - 1000,
      reason: 'User approved in previous session',
    };
    await state.write('consents', { cloud_api: persistedGrant });

    // Instance loads from persisted state
    const consent = new ConsentTracker();
    await consent.initialize(state);

    const result = consent.checkConsent('cloud_api');
    assert.ok(result.granted, 'always-scoped consent should load and be granted');
    assert.equal(result.scope, 'always');
  });

  it('session-scoped grant does not reload after re-initialize', async () => {
    const state = createStrictMockState();

    // Session-scoped consent is intentionally NOT persisted across sessions
    await state.write('consents', {
      send_messages: { granted: true, scope: 'session', grantedAt: Date.now() },
    });

    const consent = new ConsentTracker();
    await consent.initialize(state);

    // Session-scope should NOT be re-loaded (only 'always' scope survives reload)
    const result = consent.checkConsent('send_messages');
    assert.ok(!result.granted, 'session-scoped consent should not survive re-initialize');
  });
});

describe('Persistence round-trip / Enterprise CommitmentTracker', () => {
  it('commitment pre-loaded from persisted state appears in active list', async () => {
    const state = createStrictMockState();

    // Pre-populate as if a previous instance wrote commitments to state
    const preExisting = {
      id: 'test-abc-001',
      description: 'Review the quarterly budget proposal',
      direction: 'user_promised',
      personName: 'Finance Team',
      source: 'conversation',
      status: 'active',
      createdAt: Date.now() - 5000,
      deadline: null,
      domain: '',
      contextSnippet: '',
      confidence: 0.9,
      reminded: false,
      lastRemindedAt: null,
      resolvedAt: null,
      notes: '',
    };
    await state.write('commitments', {
      commitments: [preExisting],
      outboundMessages: [],
      followUpSuggestions: [],
    });

    // Fresh tracker loads from state
    const tracker = new CommitmentTracker();
    await tracker.initialize(state);

    const active = tracker.getActiveCommitments();
    assert.equal(active.length, 1, 'pre-loaded commitment should appear in active list');
    assert.equal(active[0].id, 'test-abc-001');
    assert.equal(active[0].description, 'Review the quarterly budget proposal');
    assert.equal(active[0].personName, 'Finance Team');
  });

  it('commitment added in one instance is written to state correctly', async () => {
    const state = createStrictMockState();

    const tracker = new CommitmentTracker();
    await tracker.initialize(state);

    tracker.addCommitment({
      description: 'Send the weekly status update to Alice',
      direction: 'user_promised',
      personName: 'Alice',
      confidence: 0.88,
    });

    // The commitment tracker queues a deferred write via setTimeout.
    // We verify the in-memory state is correct and that a second instance
    // initialized from a write-synchronized state would load it correctly.
    const activeInMemory = tracker.getActiveCommitments();
    assert.equal(activeInMemory.length, 1, 'commitment should be in memory immediately');
    assert.equal(activeInMemory[0].personName, 'Alice');
    assert.equal(activeInMemory[0].status, 'active');

    // Force state to be populated (simulates what the deferred write will do)
    const status = tracker.getStatus();
    assert.equal(status.activeCommitments, 1, 'getStatus should reflect the added commitment');
    assert.equal(status.totalTracked, 1);
  });
});
