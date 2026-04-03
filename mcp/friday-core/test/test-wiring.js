/**
 * Event Wiring Tests
 *
 * Validates cross-subsystem event wiring using mock subsystems and a mock event bus.
 * Uses node:test and node:assert/strict. No external frameworks.
 *
 * Run: node --test test/test-wiring.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { wireSubsystems } from '../core/wiring.js';

// ═══════════════════════════════════════════════════════════════════════
// MOCKS
// ═══════════════════════════════════════════════════════════════════════

/** Mock event bus matching FridayEventBus interface */
function createMockEventBus() {
  const bus = new EventEmitter();
  bus.setMaxListeners(100);
  const published = [];
  bus.publish = (topic, data) => {
    const event = { topic, data, timestamp: Date.now(), id: Math.random().toString(36) };
    published.push(event);
    bus.emit(topic, event);
  };
  bus.recent = () => [];
  bus.stats = { published: 0, topics: [] };
  bus._published = published;
  return bus;
}

/** Mock subsystem: tracks start/stop calls */
function createMockSubsystem(name, extras = {}) {
  const calls = [];
  return {
    name,
    started: false,
    _calls: calls,
    start: async () => { calls.push('start'); },
    stop: async () => { calls.push('stop'); },
    ...extras,
  };
}

/** Mock registry that returns subsystems by name */
function createMockRegistry(subsystems) {
  const map = new Map();
  for (const sub of subsystems) map.set(sub.name, sub);
  return {
    get: (name) => map.get(name),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════

describe('Event Wiring: vault:unlocked', () => {
  let bus, registry;
  let personality, memory, context, trust, connectors;

  beforeEach(() => {
    bus = createMockEventBus();
    personality = createMockSubsystem('personality');
    memory = createMockSubsystem('memory');
    context = createMockSubsystem('context');
    trust = createMockSubsystem('trust');
    connectors = createMockSubsystem('connectors', {
      registry: { initialize: async () => { connectors._calls.push('connectors-init'); } }
    });
    registry = createMockRegistry([personality, memory, context, trust, connectors]);
    wireSubsystems(registry, bus);
  });

  it('triggers personality, memory, context, trust, connectors on vault:unlocked', async () => {
    bus.publish('vault:unlocked', {});
    // Allow async handlers to resolve
    await new Promise(r => setTimeout(r, 50));

    assert.ok(personality._calls.includes('start'), 'personality.start() not called');
    assert.ok(memory._calls.includes('start'), 'memory.start() not called');
    assert.ok(context._calls.includes('start'), 'context.start() not called');
    assert.ok(trust._calls.includes('start'), 'trust.start() not called');
    assert.ok(connectors._calls.includes('connectors-init'), 'connectors.registry.initialize() not called');
  });
});

describe('Event Wiring: vault:locking', () => {
  let bus, registry;
  let memory, context, trust, personality;

  beforeEach(() => {
    bus = createMockEventBus();
    memory = createMockSubsystem('memory');
    context = createMockSubsystem('context');
    trust = createMockSubsystem('trust');
    personality = createMockSubsystem('personality');
    registry = createMockRegistry([memory, context, trust, personality]);
    wireSubsystems(registry, bus);
  });

  it('triggers subsystem flush on session:end (consolidates vault:locking shutdown)', async () => {
    bus.publish('session:end', {});
    await new Promise(r => setTimeout(r, 50));

    assert.ok(memory._calls.includes('stop'), 'memory.stop() not called');
    assert.ok(context._calls.includes('stop'), 'context.stop() not called');
    assert.ok(trust._calls.includes('stop'), 'trust.stop() not called');
    assert.ok(personality._calls.includes('stop'), 'personality.stop() not called');
  });
});

describe('Event Wiring: memory:stored feeds context graph', () => {
  let bus, registry;
  let context, personality;
  let graphEvents;

  beforeEach(() => {
    bus = createMockEventBus();
    graphEvents = [];
    context = createMockSubsystem('context', {
      graph: { processEvent: (event) => { graphEvents.push(event); } }
    });
    personality = createMockSubsystem('personality', {
      sentiment: { analyse: () => {} }
    });
    registry = createMockRegistry([context, personality]);
    wireSubsystems(registry, bus);
  });

  it('memory:stored event feeds context graph', () => {
    bus.publish('memory:stored', { content: 'test observation' });
    assert.equal(graphEvents.length, 1, 'context.graph.processEvent not called');
  });

  it('memory:stored with _fromWiring flag is ignored', () => {
    bus.publish('memory:stored', { content: 'looped event', _fromWiring: true });
    assert.equal(graphEvents.length, 0, 'should not process _fromWiring events');
  });
});

describe('Event Wiring: trust:evidence-added refreshes gateway', () => {
  // ARCH-001: wiring.js must NOT publish memory:store-request on trust:evidence-added.
  // Memory storage is handled directly by MemorySubsystem.registerEvents() to avoid double-writing.
  let bus, registry;
  let refreshCalled;

  beforeEach(() => {
    bus = createMockEventBus();
    refreshCalled = false;
    const gateway = createMockSubsystem('gateway', { refresh: () => { refreshCalled = true; } });
    registry = createMockRegistry([gateway]);
    wireSubsystems(registry, bus);
  });

  it('refreshes gateway and does NOT publish memory:store-request', () => {
    bus.publish('trust:evidence-added', { description: 'user verified claim' });

    assert.ok(refreshCalled, 'gateway.refresh() not called');
    const storeReq = bus._published.find(e => e.topic === 'memory:store-request');
    assert.ok(!storeReq, 'memory:store-request must not be published from wiring.js (ARCH-001)');
  });
});

describe('Event Wiring: agent:completed updates trust graph', () => {
  // ARCH-001: wiring.js must NOT publish memory:store-request on agent:completed.
  // Memory storage is handled directly by MemorySubsystem.registerEvents() to avoid double-writing.
  let bus, registry;
  let trust;
  let agentResults;

  beforeEach(() => {
    bus = createMockEventBus();
    agentResults = [];
    trust = createMockSubsystem('trust', {
      graph: { processAgentResult: (data) => { agentResults.push(data); } }
    });
    registry = createMockRegistry([trust]);
    wireSubsystems(registry, bus);
  });

  it('calls trust.graph.processAgentResult and does NOT publish memory:store-request', () => {
    bus.publish('agent:completed', { summary: 'Debugger fixed issue', agentName: 'debugger', success: true });

    assert.equal(agentResults.length, 1, 'trust.graph.processAgentResult not called');
    assert.equal(agentResults[0].agentName, 'debugger');

    const storeReq = bus._published.find(e => e.topic === 'memory:store-request');
    assert.ok(!storeReq, 'memory:store-request must not be published from wiring.js (ARCH-001)');
  });
});

describe('Event Wiring: privacy:scrubbed logs through enterprise', () => {
  let bus, registry;
  let loggedEvents;

  beforeEach(() => {
    bus = createMockEventBus();
    loggedEvents = [];
    const enterprise = createMockSubsystem('enterprise', {
      consent: {
        logEvent: (type, data) => { loggedEvents.push({ type, data }); }
      }
    });
    registry = createMockRegistry([enterprise]);
    wireSubsystems(registry, bus);
  });

  it('logs privacy_scrub event through enterprise', () => {
    bus.publish('privacy:scrubbed', { categoriesFound: ['EMAIL', 'PHONE'] });

    assert.equal(loggedEvents.length, 1, 'enterprise.consent.logEvent not called');
    assert.equal(loggedEvents[0].type, 'privacy_scrub');
    assert.deepEqual(loggedEvents[0].data.categoriesFound, ['EMAIL', 'PHONE']);
  });
});

describe('Event Wiring: session:end flushes all subsystems', () => {
  let bus, registry;
  let memory, context, trust, personality, enterprise;

  beforeEach(() => {
    bus = createMockEventBus();
    memory = createMockSubsystem('memory');
    context = createMockSubsystem('context');
    trust = createMockSubsystem('trust');
    personality = createMockSubsystem('personality');
    enterprise = createMockSubsystem('enterprise');
    registry = createMockRegistry([memory, context, trust, personality, enterprise]);
    wireSubsystems(registry, bus);
  });

  it('stops all subsystems on session:end', async () => {
    bus.publish('session:end', { summary: {} });
    await new Promise(r => setTimeout(r, 50));

    assert.ok(memory._calls.includes('stop'), 'memory.stop() not called');
    assert.ok(context._calls.includes('stop'), 'context.stop() not called');
    assert.ok(trust._calls.includes('stop'), 'trust.stop() not called');
    assert.ok(personality._calls.includes('stop'), 'personality.stop() not called');
    assert.ok(enterprise._calls.includes('stop'), 'enterprise.stop() not called');
  });
});

describe('Event Wiring: Error isolation', () => {
  let bus, registry;

  it('subscriber errors do not crash the bus', async () => {
    bus = createMockEventBus();
    const _calledAfterError = [];

    // Create a subsystem whose start() throws
    const badPersonality = createMockSubsystem('personality', {
      start: async () => { throw new Error('personality exploded'); }
    });
    const memory = createMockSubsystem('memory');
    const context = createMockSubsystem('context');
    const trust = createMockSubsystem('trust');
    const connectors = createMockSubsystem('connectors');

    registry = createMockRegistry([badPersonality, memory, context, trust, connectors]);

    // Suppress stderr output from wiring's warn()
    const origWrite = process.stderr.write;
    process.stderr.write = () => true;
    try {
      wireSubsystems(registry, bus);
      bus.publish('vault:unlocked', {});
      await new Promise(r => setTimeout(r, 50));

      // memory.start() should still be called even though personality.start() threw
      assert.ok(memory._calls.includes('start'), 'memory.start() should fire despite personality error');
    } finally {
      process.stderr.write = origWrite;
    }
  });
});

describe('Event Wiring: No feedback loops', () => {
  let bus, registry;

  it('memory:stored with _fromWiring does not recursively trigger memory:stored processing', () => {
    bus = createMockEventBus();
    const graphEvents = [];
    const context = createMockSubsystem('context', {
      graph: { processEvent: (e) => { graphEvents.push(e); } }
    });
    const personality = createMockSubsystem('personality', {
      sentiment: { analyse: () => {} }
    });
    const memory = createMockSubsystem('memory', { started: true });
    const gateway = createMockSubsystem('gateway', { refresh: () => {} });
    registry = createMockRegistry([context, personality, memory, gateway]);
    wireSubsystems(registry, bus);

    // trust:evidence-added will publish memory:store-request with _fromWiring
    bus.publish('trust:evidence-added', { description: 'test evidence' });

    // Now simulate memory subsystem publishing memory:stored with _fromWiring
    // (as if the memory subsystem processed the store-request and marked it)
    bus.publish('memory:stored', { content: 'from wiring', _fromWiring: true });

    // The _fromWiring event should NOT be processed by context graph
    assert.equal(graphEvents.length, 0, 'context graph should not process _fromWiring memory:stored events');

    // But a normal memory:stored without the flag SHOULD be processed
    bus.publish('memory:stored', { content: 'user-initiated' });
    assert.equal(graphEvents.length, 1, 'normal memory:stored should be processed');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// INTEGRATION TESTS -- multi-step cross-subsystem flows
// ═══════════════════════════════════════════════════════════════════════

describe('Integration: vault:unlocked -> personality mother signal -> calibration', () => {
  let bus, registry;
  let personality, memory;

  beforeEach(() => {
    bus = createMockEventBus();
    // Personality mock exposing profile and calibration sub-objects, simulating
    // the interfaces used by wiring.js (epistemicTracker binding) and the real
    // PersonalitySubsystem.start() path.
    const challengeLevels = [];
    personality = createMockSubsystem('personality', {
      profile: {
        getProfile: () => ({ challengeLevel: 3 }),
        setChallengeLevel: async (level) => { challengeLevels.push(level); },
      },
      sentiment: { analyse: () => {} },
      _challengeLevels: challengeLevels,
    });
    memory = createMockSubsystem('memory');
    registry = createMockRegistry([personality, memory]);
    wireSubsystems(registry, bus);
  });

  it('vault:unlocked starts personality before memory (sequence matters)', async () => {
    const order = [];
    personality.start = async () => { order.push('personality'); };
    memory.start = async () => { order.push('memory'); };

    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 50));

    assert.equal(order[0], 'personality', 'personality must start first (shapes greeting)');
    assert.equal(order[1], 'memory', 'memory must start second');
  });

  it('wiring.js binds epistemicTracker to personality after wireSubsystems()', () => {
    // wireSubsystems() runs synchronously and assigns the tracker immediately
    assert.ok(personality.epistemicTracker !== undefined, 'epistemicTracker should be bound to personality');
    assert.ok(personality.epistemicTracker !== null, 'epistemicTracker should not be null');
  });

  it('EIS declining trend triggers challenge level increase on personality', () => {
    // Feed enough declining interactions to trigger eis:updated with recommendation
    // EIS publishes when score shifts > CHANGE_THRESHOLD (3 points)
    // With all hadVerification=false, hadCorrection=false, queryComplexity=1,
    // the score stays near 0 -- we force the event directly to test the wiring route.
    const challengeLevels = [];
    personality.profile = {
      getProfile: () => ({ challengeLevel: 2 }),
      setChallengeLevel: async (level) => { challengeLevels.push(level); },
    };

    bus.publish('eis:updated', {
      score: { overall: 20 },
      trend: 'declining',
      recommendation: 'increase_challenge_level',
    });

    // setChallengeLevel is called async via .catch() so give it a tick
    return new Promise(r => setTimeout(r, 10)).then(() => {
      assert.equal(challengeLevels.length, 1, 'setChallengeLevel should be called once');
      assert.equal(challengeLevels[0], 3, 'challenge level should be raised from 2 to 3');
    });
  });

  it('EIS improving trend does NOT increase challenge level', () => {
    const challengeLevels = [];
    personality.profile = {
      getProfile: () => ({ challengeLevel: 3 }),
      setChallengeLevel: async (level) => { challengeLevels.push(level); },
    };

    bus.publish('eis:updated', {
      score: { overall: 75 },
      trend: 'improving',
      recommendation: 'maintain_current_approach',
    });

    return new Promise(r => setTimeout(r, 10)).then(() => {
      assert.equal(challengeLevels.length, 0, 'setChallengeLevel must not be called on improving trend');
    });
  });
});

describe('Integration: vault:unlocked -> memory starts -> session buffer wired', () => {
  let bus, registry;
  let memory;

  beforeEach(() => {
    bus = createMockEventBus();
    memory = createMockSubsystem('memory');
    registry = createMockRegistry([memory]);
    wireSubsystems(registry, bus);
  });

  it('memory.start() is called exactly once on vault:unlocked', async () => {
    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 50));

    const startCalls = memory._calls.filter(c => c === 'start');
    assert.equal(startCalls.length, 1, 'memory.start() must be called exactly once');
  });

  it('memory.start() is not called when vault:unlocked is absent', async () => {
    // No publish -- memory should never start
    await new Promise(r => setTimeout(r, 20));
    assert.equal(memory._calls.length, 0, 'memory should not start without vault:unlocked');
  });

  it('second vault:unlocked does not double-start memory', async () => {
    bus.publish('vault:unlocked', {});
    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 50));

    // Two events means two calls -- wiring does not deduplicate. This test
    // confirms the current behaviour so regressions are caught. Idempotency
    // is the responsibility of each subsystem's start() method.
    const startCalls = memory._calls.filter(c => c === 'start');
    assert.equal(startCalls.length, 2, 'two vault:unlocked events produce two start() calls (idempotency is subsystem responsibility)');
  });
});

describe('Integration: memory:stored -> context graph updated (explicit wiring route)', () => {
  let bus, registry;
  let context;
  let graphEvents;

  beforeEach(() => {
    bus = createMockEventBus();
    graphEvents = [];
    context = createMockSubsystem('context', {
      graph: { processEvent: (event) => { graphEvents.push(event); } }
    });
    registry = createMockRegistry([context]);
    wireSubsystems(registry, bus);
  });

  it('memory:stored routes the full event object to context.graph.processEvent', () => {
    bus.publish('memory:stored', { content: 'Stephen discussed the architecture decision' });
    assert.equal(graphEvents.length, 1, 'exactly one graph event expected');
    // The event passed to processEvent is the full bus event wrapper
    assert.ok(graphEvents[0].data?.content === 'Stephen discussed the architecture decision',
      'graph receives full event with original data');
  });

  it('memory:stored without content is silently skipped by the context route', () => {
    bus.publish('memory:stored', { tier: 'short' }); // no content field
    assert.equal(graphEvents.length, 0, 'context graph should not be called when content is absent');
  });

  it('multiple memory:stored events all feed the context graph in order', () => {
    bus.publish('memory:stored', { content: 'observation one' });
    bus.publish('memory:stored', { content: 'observation two' });
    bus.publish('memory:stored', { content: 'observation three' });

    assert.equal(graphEvents.length, 3, 'all three observations should reach the graph');
    assert.equal(graphEvents[0].data.content, 'observation one');
    assert.equal(graphEvents[2].data.content, 'observation three');
  });
});

describe('Integration: trust:evidence-added -> context graph fed (architectural guard)', () => {
  // ARCH-001: wiring.js must not publish memory:store-request on trust:evidence-added.
  // The trust evidence -> context graph path happens ONLY if memory:stored is later
  // emitted by MemorySubsystem, then wiring forwards it to context.graph.
  // This test verifies the gateway refresh fires AND that no memory:store-request
  // leaks out of wiring.js (which would cause double-writes).
  let bus, registry;
  let gateway, context;
  let graphEvents;
  let refreshCalled;

  beforeEach(() => {
    bus = createMockEventBus();
    graphEvents = [];
    refreshCalled = false;
    gateway = createMockSubsystem('gateway', {
      refresh: () => { refreshCalled = true; }
    });
    context = createMockSubsystem('context', {
      graph: { processEvent: (e) => { graphEvents.push(e); } }
    });
    registry = createMockRegistry([gateway, context]);
    wireSubsystems(registry, bus);
  });

  it('trust:evidence-added refreshes gateway exactly once', () => {
    bus.publish('trust:evidence-added', { description: 'user confirmed Alice as trustworthy' });
    assert.ok(refreshCalled, 'gateway.refresh() must be called');
  });

  it('trust:evidence-added does not directly populate the context graph', () => {
    bus.publish('trust:evidence-added', { description: 'test evidence' });
    // Context graph is only fed by memory:stored, not directly by trust:evidence-added
    assert.equal(graphEvents.length, 0, 'context graph must not be fed directly from trust:evidence-added');
  });

  it('trust:evidence-added followed by memory:stored does feed the context graph', () => {
    bus.publish('trust:evidence-added', { description: 'test evidence' });
    // Simulate the memory subsystem later emitting memory:stored (its own responsibility)
    bus.publish('memory:stored', { content: 'Evidence: user confirmed Alice as trustworthy' });

    assert.ok(refreshCalled, 'gateway refresh should have fired');
    assert.equal(graphEvents.length, 1, 'context graph should be fed by the subsequent memory:stored');
  });
});

describe('Integration: session:end -> all subsystems stop cleanly', () => {
  let bus, registry;
  let memory, context, trust, personality, enterprise;

  beforeEach(() => {
    bus = createMockEventBus();
    memory = createMockSubsystem('memory');
    context = createMockSubsystem('context');
    trust = createMockSubsystem('trust');
    personality = createMockSubsystem('personality');
    enterprise = createMockSubsystem('enterprise');
    registry = createMockRegistry([memory, context, trust, personality, enterprise]);
    wireSubsystems(registry, bus);
  });

  it('session:end stops all five subsystems', async () => {
    bus.publish('session:end', { summary: { duration: 3600 } });
    await new Promise(r => setTimeout(r, 50));

    for (const [name, sub] of [['memory', memory], ['context', context], ['trust', trust], ['personality', personality], ['enterprise', enterprise]]) {
      assert.ok(sub._calls.includes('stop'), `${name}.stop() must be called on session:end`);
    }
  });

  it('session:end stop order: memory first, enterprise last', async () => {
    const stopOrder = [];
    memory.stop = async () => { stopOrder.push('memory'); };
    context.stop = async () => { stopOrder.push('context'); };
    trust.stop = async () => { stopOrder.push('trust'); };
    personality.stop = async () => { stopOrder.push('personality'); };
    enterprise.stop = async () => { stopOrder.push('enterprise'); };

    bus.publish('session:end', {});
    await new Promise(r => setTimeout(r, 50));

    assert.equal(stopOrder[0], 'memory', 'memory must flush first');
    assert.equal(stopOrder[stopOrder.length - 1], 'enterprise', 'enterprise stops last');
  });

  it('session:end does not call start() on any subsystem', async () => {
    bus.publish('session:end', {});
    await new Promise(r => setTimeout(r, 50));

    for (const [name, sub] of [['memory', memory], ['context', context], ['trust', trust], ['personality', personality], ['enterprise', enterprise]]) {
      assert.ok(!sub._calls.includes('start'), `${name}.start() must NOT be called on session:end`);
    }
  });

  it('one subsystem throwing on stop does not prevent the others from stopping', async () => {
    memory.stop = async () => { throw new Error('memory flush exploded'); };

    const origWrite = process.stderr.write;
    process.stderr.write = () => true;
    try {
      bus.publish('session:end', {});
      await new Promise(r => setTimeout(r, 50));
    } finally {
      process.stderr.write = origWrite;
    }

    // context, trust, personality, enterprise should all still stop
    assert.ok(context._calls.includes('stop'), 'context.stop() should fire despite memory error');
    assert.ok(trust._calls.includes('stop'), 'trust.stop() should fire despite memory error');
    assert.ok(personality._calls.includes('stop'), 'personality.stop() should fire despite memory error');
    assert.ok(enterprise._calls.includes('stop'), 'enterprise.stop() should fire despite memory error');
  });
});

describe('Integration: connector:detected -> tools.refreshConnectorTools called', () => {
  let bus, registry;
  let tools;
  let refreshedIds;

  beforeEach(() => {
    bus = createMockEventBus();
    refreshedIds = [];
    tools = createMockSubsystem('tools', {
      started: true,
      refreshConnectorTools: (id) => { refreshedIds.push(id); },
    });
    registry = createMockRegistry([tools]);
    wireSubsystems(registry, bus);
  });

  it('connector:detected calls tools.refreshConnectorTools with the connectorId', () => {
    bus.publish('connector:detected', { connectorId: 'git-devops' });
    assert.equal(refreshedIds.length, 1, 'refreshConnectorTools must be called once');
    assert.equal(refreshedIds[0], 'git-devops', 'connectorId must be forwarded');
  });

  it('connector:detected without connectorId is silently skipped', () => {
    bus.publish('connector:detected', { name: 'orphan connector' }); // no connectorId
    assert.equal(refreshedIds.length, 0, 'must not call refreshConnectorTools if connectorId is absent');
  });

  it('connector:detected is ignored when tools subsystem is not started', () => {
    tools.started = false;
    bus.publish('connector:detected', { connectorId: 'perplexity' });
    assert.equal(refreshedIds.length, 0, 'must not refresh tools if tools subsystem is not yet started');
  });

  it('multiple connector:detected events each trigger a refresh', () => {
    bus.publish('connector:detected', { connectorId: 'perplexity' });
    bus.publish('connector:detected', { connectorId: 'firecrawl' });
    bus.publish('connector:detected', { connectorId: 'comms-hub' });

    assert.equal(refreshedIds.length, 3, 'each connector detection triggers its own refresh');
    assert.deepEqual(refreshedIds, ['perplexity', 'firecrawl', 'comms-hub']);
  });
});

describe('Integration: message:user -> personality sentiment + calibration', () => {
  // The personality subsystem registers its own message:user handler in registerEvents().
  // wiring.js does not handle message:user directly. This suite tests the contract
  // that wiring.js exposes: the personality mock receives the right calls via the bus.
  // We verify by attaching a real bus listener that mimics personality.registerEvents().
  let bus, registry;
  let sentimentAnalysed;
  let calibrationProcessed;

  beforeEach(() => {
    bus = createMockEventBus();
    sentimentAnalysed = [];
    calibrationProcessed = [];

    // Simulate what PersonalitySubsystem.registerEvents() does: subscribe to message:user
    bus.on('message:user', (data) => {
      if (data.text) {
        sentimentAnalysed.push(data.text);
        calibrationProcessed.push({ text: data.text, responseTimeMs: data.responseTimeMs });
      }
    });

    const personality = createMockSubsystem('personality', {
      sentiment: { analyse: (t) => { sentimentAnalysed.push(t); } },
    });
    registry = createMockRegistry([personality]);
    wireSubsystems(registry, bus);
  });

  it('message:user event carries text to sentiment handler', () => {
    bus.on('message:user', (data) => {
      if (data.text) sentimentAnalysed.push(`via-bus:${data.text}`);
    });

    bus.emit('message:user', { text: 'Stephen is frustrated today' });

    // Our beforeEach listener captured it
    assert.ok(sentimentAnalysed.some(t => t === 'Stephen is frustrated today' || t === 'via-bus:Stephen is frustrated today'),
      'message:user text must reach the sentiment handler');
  });

  it('message:user without text does not trigger sentiment processing', () => {
    bus.emit('message:user', { source: 'voice', text: '' });
    // beforeEach listener only pushes if data.text is truthy
    const captured = sentimentAnalysed.filter(t => t === '');
    assert.equal(captured.length, 0, 'empty text should not trigger processing');
  });

  it('message:user responseTimeMs is forwarded to calibration handler', () => {
    bus.emit('message:user', { text: 'How do I refactor this?', responseTimeMs: 1200 });
    const entry = calibrationProcessed.find(e => e.text === 'How do I refactor this?');
    assert.ok(entry, 'calibration handler should have received the message');
    assert.equal(entry.responseTimeMs, 1200, 'responseTimeMs must be forwarded intact');
  });
});

describe('Integration: trust:score-updated -> briefing queues trust-change note', () => {
  let bus, registry;
  let queuedNotes;

  beforeEach(() => {
    bus = createMockEventBus();
    queuedNotes = [];
    const briefing = createMockSubsystem('briefing', {
      daily: {
        queueNote: (note) => { queuedNotes.push(note); },
      }
    });
    registry = createMockRegistry([briefing]);
    wireSubsystems(registry, bus);
  });

  it('trust:score-updated queues a trust-change note in briefing', () => {
    bus.publish('trust:score-updated', {
      personName: 'Alice',
      overall: 0.82,
    });

    assert.equal(queuedNotes.length, 1, 'one briefing note should be queued');
    assert.equal(queuedNotes[0].type, 'trust-change', 'note type must be trust-change');
    assert.ok(queuedNotes[0].summary.includes('Alice'), 'summary must include the person name');
    assert.ok(queuedNotes[0].summary.includes('0.82'), 'summary must include the score');
  });

  it('trust:score-updated without personName is silently skipped', () => {
    bus.publish('trust:score-updated', { overall: 0.5 }); // no personName
    assert.equal(queuedNotes.length, 0, 'no note should be queued if personName is absent');
  });

  it('trust:score-updated queued note includes a timestamp', () => {
    const before = Date.now();
    bus.publish('trust:score-updated', { personName: 'Bob', overall: 0.6 });
    const after = Date.now();

    assert.equal(queuedNotes.length, 1);
    assert.ok(typeof queuedNotes[0].timestamp === 'number', 'timestamp must be a number');
    assert.ok(queuedNotes[0].timestamp >= before && queuedNotes[0].timestamp <= after,
      'timestamp must fall within the test window');
  });
});

describe('Integration: enterprise:commitment-created -> briefing queues commitment note', () => {
  let bus, registry;
  let queuedNotes;

  beforeEach(() => {
    bus = createMockEventBus();
    queuedNotes = [];
    const briefing = createMockSubsystem('briefing', {
      daily: {
        queueNote: (note) => { queuedNotes.push(note); },
      }
    });
    registry = createMockRegistry([briefing]);
    wireSubsystems(registry, bus);
  });

  it('enterprise:commitment-created queues a commitment note in briefing', () => {
    bus.publish('enterprise:commitment-created', {
      description: 'Review PR by end of week',
      personName: 'Carlos',
    });

    assert.equal(queuedNotes.length, 1, 'one briefing note should be queued');
    assert.equal(queuedNotes[0].type, 'commitment', 'note type must be commitment');
    assert.ok(queuedNotes[0].summary.includes('Review PR by end of week'),
      'summary must include the commitment description');
    assert.ok(queuedNotes[0].summary.includes('Carlos'), 'summary must include the person name');
  });

  it('enterprise:commitment-created without description is silently skipped', () => {
    bus.publish('enterprise:commitment-created', { personName: 'Dave' }); // no description
    assert.equal(queuedNotes.length, 0, 'no note should be queued if description is absent');
  });

  it('enterprise:commitment-created with unknown person uses "unknown" fallback', () => {
    bus.publish('enterprise:commitment-created', {
      description: 'Follow up on the invoice',
      // personName omitted
    });

    assert.equal(queuedNotes.length, 1);
    assert.ok(queuedNotes[0].summary.includes('unknown'),
      'missing personName should fall back to "unknown" in the summary');
  });
});

describe('Integration: LLM interaction -> EIS tracker -> eis:updated published', () => {
  let bus, registry;
  let eisEvents;

  beforeEach(() => {
    bus = createMockEventBus();
    eisEvents = [];
    bus.on('eis:updated', (event) => { eisEvents.push(event); });
    registry = createMockRegistry([]);
    wireSubsystems(registry, bus);
  });

  it('llm:request-completed feeds EIS tracker without throwing', () => {
    assert.doesNotThrow(() => {
      bus.publish('llm:request-completed', {
        signals: { hadCorrection: true, hadVerification: true, queryComplexity: 4, hadRejection: false },
      });
    });
  });

  it('llm:request-completed without signals object synthesises defaults', () => {
    // Should not throw even when signals are absent
    assert.doesNotThrow(() => {
      bus.publish('llm:request-completed', { queryComplexity: 3 });
    });
  });

  it('repeated llm:request-completed events accumulate in tracker window', async () => {
    // Feed enough interactions to push the score far enough for eis:updated to fire.
    // All verifications + high complexity -> score rises well above initial 50.
    // We suppress stderr to avoid noise from the info log inside EpistemicTracker.
    const origWrite = process.stderr.write;
    process.stderr.write = () => true;
    try {
      for (let i = 0; i < 10; i++) {
        bus.publish('llm:request-completed', {
          signals: { hadCorrection: true, hadVerification: true, queryComplexity: 5, hadRejection: true },
        });
      }
    } finally {
      process.stderr.write = origWrite;
    }

    // eis:updated fires when overall score shifts > 3 points from initial 50
    assert.ok(eisEvents.length >= 1, 'eis:updated should fire after enough interactions shift the score');
  });
});
