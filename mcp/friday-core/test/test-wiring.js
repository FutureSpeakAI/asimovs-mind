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

  it('triggers subsystem flush on vault:locking', async () => {
    bus.publish('vault:locking', {});
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

describe('Event Wiring: trust:evidence-added creates memory observation', () => {
  let bus, registry;
  let memory;

  beforeEach(() => {
    bus = createMockEventBus();
    memory = createMockSubsystem('memory', { started: true });
    const gateway = createMockSubsystem('gateway', { refresh: () => {} });
    registry = createMockRegistry([memory, gateway]);
    wireSubsystems(registry, bus);
  });

  it('publishes memory:store-request with _fromWiring guard', () => {
    bus.publish('trust:evidence-added', { description: 'user verified claim' });

    const storeReq = bus._published.find(e => e.topic === 'memory:store-request');
    assert.ok(storeReq, 'memory:store-request not published');
    assert.ok(storeReq.data._fromWiring, '_fromWiring guard not set');
    assert.ok(storeReq.data.content.includes('Trust evidence'), 'content missing trust evidence text');
  });
});

describe('Event Wiring: agent:completed records in memory and trust', () => {
  let bus, registry;
  let memory, trust;
  let agentResults;

  beforeEach(() => {
    bus = createMockEventBus();
    agentResults = [];
    memory = createMockSubsystem('memory', { started: true });
    trust = createMockSubsystem('trust', {
      graph: { processAgentResult: (data) => { agentResults.push(data); } }
    });
    registry = createMockRegistry([memory, trust]);
    wireSubsystems(registry, bus);
  });

  it('publishes memory:store-request and calls trust.graph.processAgentResult', () => {
    bus.publish('agent:completed', { summary: 'Debugger fixed issue', agentName: 'debugger', success: true });

    const storeReq = bus._published.find(e => e.topic === 'memory:store-request');
    assert.ok(storeReq, 'memory:store-request not published');
    assert.ok(storeReq.data.content.includes('Agent completed'), 'memory content missing');

    assert.equal(agentResults.length, 1, 'trust.graph.processAgentResult not called');
    assert.equal(agentResults[0].agentName, 'debugger');
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
    const calledAfterError = [];

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
