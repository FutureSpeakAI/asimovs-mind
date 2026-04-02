/**
 * Concurrency and Stress Tests — Friday Core
 *
 * 1. Concurrent vault writes (20 parallel) — no corruption
 * 2. Event bus flood (1000 events) — ring buffer stays bounded
 * 3. Memory tier concurrent stores (50 parallel) — dedup + cap respected
 * 4. Session conductor duplicate start — idempotent under concurrent fire
 * 5. Trust graph concurrent evidence (10 parallel) — no corruption
 *
 * Run: node --test test/test-concurrency.js
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';

import { initCrypto } from '../core/crypto.js';
import { SovereignVault } from '../core/vault.js';
import { FridayEventBus } from '../core/event-bus.js';
import { SessionConductor } from '../core/session-conductor.js';
import { MemoryTiers } from '../subsystems/memory/tiers.js';
import { TrustGraph } from '../subsystems/trust/graph.js';

// ---------------------------------------------------------------------------
// Shared vault setup (real, on-disk — used for test 1 only)
// ---------------------------------------------------------------------------

const TEST_PASSPHRASE = 'correct horse battery staple extra words here today';
let testDir;
let vault;

before(async () => {
  await initCrypto();
  testDir = path.join(os.tmpdir(), `concurrency-test-${Date.now()}`);
  const vaultDir = path.join(testDir, 'vault');
  vault = new SovereignVault(vaultDir);
  await vault.init();
  await vault.initialize(TEST_PASSPHRASE);
});

after(async () => {
  vault.lock();
  try { await fs.rm(testDir, { recursive: true, force: true }); } catch {}
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockState() {
  const store = new Map();
  return {
    read:   async (key) => ({ success: true, data: store.get(key) ?? null }),
    write:  async (key, data) => { store.set(key, JSON.parse(JSON.stringify(data))); return { success: true }; },
    append: async (key, entry) => {
      const arr = store.get(key) ?? [];
      arr.push(entry);
      store.set(key, arr);
      return { success: true };
    },
    delete: async (key) => { store.delete(key); return { success: true }; },
    list:   async () => ({ success: true, keys: [...store.keys()] }),
  };
}

function createMockEventBus() {
  const bus = new EventEmitter();
  bus.setMaxListeners(200);
  const published = [];
  bus.publish = (topic, data) => {
    const event = { topic, data, timestamp: Date.now(), id: Math.random().toString(36) };
    published.push(event);
    bus.emit(topic, event);
  };
  bus._published = published;
  return bus;
}

function createMockRegistry(subsystems = {}) {
  return { get: (name) => subsystems[name] ?? undefined };
}

function createMockLogger() {
  const logs = [];
  return {
    info:  (msg) => logs.push({ level: 'info', msg }),
    warn:  (msg) => logs.push({ level: 'warn', msg }),
    error: (msg) => logs.push({ level: 'error', msg }),
    _logs: logs,
  };
}

// ---------------------------------------------------------------------------
// 1. Concurrent vault writes
// ---------------------------------------------------------------------------

describe('Concurrent vault writes', () => {
  it('20 parallel writes to different keys produce no data corruption on read-back', async () => {
    const N = 20;
    const keys = Array.from({ length: N }, (_, i) => `concurrency-key-${i}`);
    const payloads = keys.map((k, i) => ({ key: k, index: i, marker: `value-${i}-${Math.random()}` }));

    // Fire all writes concurrently
    await Promise.all(keys.map((key, i) => vault.write(key, payloads[i])));

    // Read back all in parallel and verify
    const results = await Promise.all(keys.map(key => vault.read(key)));

    for (let i = 0; i < N; i++) {
      const res = results[i];
      assert.equal(res.success, true, `Read of key ${keys[i]} must succeed`);
      assert.ok(res.data !== null, `Data for key ${keys[i]} must not be null`);
      assert.equal(res.data.index, i, `Index mismatch for key ${keys[i]}`);
      assert.equal(res.data.marker, payloads[i].marker, `Marker mismatch for key ${keys[i]}`);
    }
  });

  it('concurrent writes to the SAME key: last write wins, file is not corrupted', async () => {
    // Write 10 concurrent updates to one key. The key existence and structure
    // must be valid after settling — we accept any of the 10 values.
    const N = 10;
    const KEY = 'concurrency-collision-key';
    await Promise.all(
      Array.from({ length: N }, (_, i) => vault.write(KEY, { round: i }))
    );

    const res = await vault.read(KEY);
    assert.equal(res.success, true, 'Read after concurrent collision writes must succeed');
    assert.ok(res.data !== null, 'Data must not be null after concurrent writes');
    assert.ok(
      typeof res.data.round === 'number' && res.data.round >= 0 && res.data.round < N,
      `round must be a number 0-${N - 1}, got: ${JSON.stringify(res.data)}`
    );
  });
});

// ---------------------------------------------------------------------------
// 2. Event bus flood
// ---------------------------------------------------------------------------

describe('Event bus flood', () => {
  it('1000 events published in a tight loop stay within ring buffer bound', () => {
    // Use default maxBufferSize (2000).  Publish 1000 events and confirm the
    // buffer length never exceeds the configured maximum.
    const MAX = 500; // use a smaller cap so we can test truncation too
    const bus = new FridayEventBus({ maxBufferSize: MAX });

    const N = 1000;
    for (let i = 0; i < N; i++) {
      bus.publish('flood:test', { seq: i });
    }

    const stats = bus.stats;
    assert.equal(stats.published, N, `All ${N} events must be counted as published`);
    assert.ok(
      stats.bufferSize <= MAX,
      `Buffer size ${stats.bufferSize} must not exceed cap of ${MAX}`
    );
  });

  it('events published beyond buffer capacity overwrite oldest — most recent N are retained', () => {
    const MAX = 100;
    const bus = new FridayEventBus({ maxBufferSize: MAX });
    const N = 300;

    for (let i = 0; i < N; i++) {
      bus.publish('overflow:test', { seq: i });
    }

    const recent = bus.recent('overflow:test', MAX);
    // The ring buffer keeps the last MAX events
    assert.equal(recent.length, MAX, `recent() must return exactly ${MAX} entries`);

    // The oldest retained event must have seq >= N - MAX
    const minSeq = recent[0].data.seq;
    assert.ok(
      minSeq >= N - MAX,
      `Oldest retained seq ${minSeq} must be >= ${N - MAX} (ring buffer evicted correctly)`
    );

    // The newest retained event must have seq = N - 1
    const maxSeq = recent[recent.length - 1].data.seq;
    assert.equal(maxSeq, N - 1, `Newest retained seq must be ${N - 1}`);
  });

  it('subscribers receive all events during a flood (synchronous dispatch)', () => {
    const bus = new FridayEventBus({ maxBufferSize: 2000 });
    const N = 1000;
    const received = [];
    bus.subscribe
      ? bus.subscribe('listener:test', (evt) => received.push(evt.data.seq))
      : bus.on('listener:test', (evt) => received.push(evt.data.seq));

    for (let i = 0; i < N; i++) {
      bus.publish('listener:test', { seq: i });
    }

    assert.equal(received.length, N, `Subscriber must receive all ${N} events`);
    // Verify order is preserved
    for (let i = 0; i < N; i++) {
      assert.equal(received[i], i, `Event at position ${i} must have seq ${i}`);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Memory concurrent stores
// ---------------------------------------------------------------------------

describe('Memory concurrent stores', () => {
  it('50 concurrent short-term stores respect the tier cap and deduplicate exact content', async () => {
    const TIER_CAP = 100; // TIER_CAPS.short from tiers.js
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const N = 50;
    // Half unique content, half exact duplicates of the first quarter
    const contents = Array.from({ length: N }, (_, i) => {
      if (i < N / 2) return `unique observation number ${i}`;
      // Exact duplicate of observation i - N/2 (triggers hash dedup)
      return `unique observation number ${i - N / 2}`;
    });

    await Promise.all(contents.map((c) => tiers.store(c, 'fact', 'short', 0.5)));

    const shortTerm = tiers.getShortTerm();
    // At most N/2 unique entries (duplicates discarded)
    const uniqueContents = new Set(shortTerm.map(e => e.content));
    assert.equal(
      shortTerm.length, N / 2,
      `Short-term should have ${N / 2} entries (duplicates deduplicated), got ${shortTerm.length}`
    );
    assert.equal(
      uniqueContents.size, N / 2,
      `All ${N / 2} entries must have distinct content`
    );
    assert.ok(
      shortTerm.length <= TIER_CAP,
      `Short-term length ${shortTerm.length} must not exceed cap ${TIER_CAP}`
    );
  });

  it('stores beyond the short-term cap evict entries and never exceed the cap', async () => {
    const TIER_CAP = 100;
    const tiers = new MemoryTiers();
    await tiers.initialize(createMockState(), null);

    const N = 150; // 50 over the cap
    await Promise.all(
      Array.from({ length: N }, (_, i) => tiers.store(`cap-overflow entry ${i}`, 'fact', 'short', 0.5))
    );

    const shortTerm = tiers.getShortTerm();
    assert.ok(
      shortTerm.length <= TIER_CAP,
      `Short-term must not exceed cap ${TIER_CAP} after ${N} stores, got ${shortTerm.length}`
    );
  });

  it('concurrent medium-term stores deduplicate via Jaccard similarity', async () => {
    const tiers = new MemoryTiers();
    const state = createMockState();
    await tiers.initialize(state, null);

    // Store one seed entry first (sequentially)
    await tiers.store('Stephen works on AI projects and machine learning research', 'fact', 'medium', 0.8);

    // Now fire 5 concurrent near-duplicate stores (>80% word overlap with seed)
    const nearDups = Array.from({ length: 5 }, () =>
      tiers.store('Stephen works on AI projects and machine learning research', 'fact', 'medium', 0.8)
    );
    await Promise.all(nearDups);

    const mediumTerm = tiers.getMediumTerm();
    // Should be 1 entry (the original) with reinforced access counts, not 6
    assert.equal(
      mediumTerm.length, 1,
      `Medium-term should deduplicate to 1 entry, got ${mediumTerm.length}`
    );
    assert.ok(
      mediumTerm[0].accessCount > 1,
      `Duplicate stores should reinforce accessCount (got ${mediumTerm[0].accessCount})`
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Session conductor concurrent start
// ---------------------------------------------------------------------------

describe('Session conductor concurrent start', () => {
  it('firing vault:unlocked twice concurrently produces exactly one session:start event', async () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry({});
    const vault = createMockVault();
    const logger = createMockLogger();

    const conductor = new SessionConductor({ registry, eventBus: bus, vault, logger });
    conductor.wire();

    // Fire two vault:unlocked events back-to-back before the first async
    // #onSessionStart can complete — simulating a duplicate event scenario.
    bus.publish('vault:unlocked', {});
    bus.publish('vault:unlocked', {});

    // Wait long enough for both async handlers to settle
    await new Promise(r => setTimeout(r, 100));

    const sessionStartEvents = bus._published.filter(e => e.topic === 'session:start');

    // With the guard in place, only ONE session:start should have been published.
    // Without a guard, both concurrent calls go through and publish twice.
    assert.equal(
      sessionStartEvents.length, 1,
      `Expected exactly 1 session:start event, got ${sessionStartEvents.length}. ` +
      `SessionConductor needs a concurrency guard in #onSessionStart.`
    );
  });

  it('a second vault:unlocked after the first completes does start a new session', async () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry({});
    const vault = createMockVault();
    const logger = createMockLogger();

    const conductor = new SessionConductor({ registry, eventBus: bus, vault, logger });
    conductor.wire();

    // First start — wait for it to fully complete
    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 100));

    // Second start (legitimate new session) — wait again
    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 100));

    const sessionStartEvents = bus._published.filter(e => e.topic === 'session:start');
    assert.equal(
      sessionStartEvents.length, 2,
      `Two sequential vault:unlocked events should produce 2 session:start events, got ${sessionStartEvents.length}`
    );
  });
});

// Minimal mock vault for session conductor tests (no crypto needed)
function createMockVault() {
  return { status: 'unlocked' };
}

// ---------------------------------------------------------------------------
// 5. Trust graph concurrent evidence
// ---------------------------------------------------------------------------

describe('Trust graph concurrent evidence', () => {
  it('10 concurrent addEvidence calls for the same person do not corrupt the graph', async () => {
    const graph = new TrustGraph();
    await graph.initialize(createMockState());

    // Create a person first
    const { person } = graph.resolvePerson('Alice Concurrent', 'name');
    assert.ok(person, 'Person must be resolved/created');
    const personId = person.id;

    // Add 10 pieces of evidence concurrently using synchronous addEvidence
    // (addEvidence is sync internally but #scheduleSave is async-deferred)
    const evidenceBatch = Array.from({ length: 10 }, (_, i) => ({
      type: i % 2 === 0 ? 'promise_kept' : 'helpful_action',
      description: `Concurrent evidence item ${i}`,
      impact: i % 2 === 0 ? 0.5 : 0.3,
      domain: 'testing',
    }));

    // These are synchronous calls but we wrap in Promise.all to mirror
    // what happens when event handlers fire in parallel microtask turns.
    await Promise.all(evidenceBatch.map(e => Promise.resolve().then(() => graph.addEvidence(personId, e))));

    // Graph must still find the person intact
    const loaded = graph.getPersonById(personId);
    assert.ok(loaded, 'Person must still exist after concurrent evidence adds');
    assert.equal(loaded.primaryName, 'Alice Concurrent', 'Primary name must be intact');

    // Evidence array must have at most MAX_EVIDENCE_PER_PERSON entries and at
    // least 1 (some may be trimmed by the cap, but the list must be valid).
    assert.ok(
      loaded.evidence.length >= 1 && loaded.evidence.length <= 50,
      `Evidence count ${loaded.evidence.length} must be between 1 and 50`
    );

    // All evidence entries must have valid required fields
    for (const e of loaded.evidence) {
      assert.ok(typeof e.id === 'string', 'Each evidence entry must have an id');
      assert.ok(typeof e.type === 'string', 'Each evidence entry must have a type');
      assert.ok(typeof e.impact === 'number', 'Each evidence entry must have a numeric impact');
    }

    // Trust scores must be valid numbers in [0, 1]
    const trust = loaded.trust;
    for (const dim of ['overall', 'reliability', 'emotionalTrust', 'timeliness', 'informationQuality']) {
      assert.ok(
        typeof trust[dim] === 'number' && trust[dim] >= 0 && trust[dim] <= 1,
        `trust.${dim} must be a number in [0, 1], got ${trust[dim]}`
      );
    }
  });

  it('concurrent addEvidence for DIFFERENT people does not cross-contaminate', async () => {
    const graph = new TrustGraph();
    await graph.initialize(createMockState());

    const names = ['Bob Alpha', 'Carol Beta', 'Dave Gamma', 'Eve Delta', 'Frank Epsilon'];
    const persons = names.map(name => graph.resolvePerson(name, 'name').person);

    // 5 concurrent batches, each adding 6 pieces of evidence to their own person
    await Promise.all(
      persons.map((p, pi) =>
        Promise.all(
          Array.from({ length: 6 }, (_, i) =>
            Promise.resolve().then(() =>
              graph.addEvidence(p.id, {
                type: 'accurate_info',
                description: `Evidence for ${names[pi]} item ${i}`,
                impact: 0.5,
              })
            )
          )
        )
      )
    );

    // Verify each person's evidence only references their own name
    for (let pi = 0; pi < persons.length; pi++) {
      const loaded = graph.getPersonById(persons[pi].id);
      assert.ok(loaded, `Person ${names[pi]} must still exist`);
      for (const ev of loaded.evidence) {
        assert.ok(
          ev.description.includes(names[pi]),
          `Person ${names[pi]} has cross-contaminated evidence: "${ev.description}"`
        );
      }
    }

    // Total person count must be exactly the 5 we created (no phantom nodes)
    assert.equal(
      graph.getPersonCount(), 5,
      `Graph must contain exactly 5 persons, got ${graph.getPersonCount()}`
    );
  });
});
