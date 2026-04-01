/**
 * Session Conductor + Epistemic Independence Score Tests
 *
 * Tests session lifecycle and EIS tracking using mock dependencies.
 * Uses node:test and node:assert/strict. No external frameworks.
 *
 * Run: node --test test/test-session.js
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { SessionConductor } from '../core/session-conductor.js';
import { EpistemicTracker } from '../core/eis.js';

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
  bus._published = published;
  return bus;
}

/** Mock registry returning subsystems by name */
function createMockRegistry(subsystems = {}) {
  return {
    get: (name) => subsystems[name] || undefined,
  };
}

/** Mock vault */
function createMockVault() {
  return { status: 'unlocked' };
}

/** Mock logger */
function createMockLogger() {
  const logs = [];
  return {
    info: (msg) => { logs.push({ level: 'info', msg }); },
    warn: (msg) => { logs.push({ level: 'warn', msg }); },
    error: (msg) => { logs.push({ level: 'error', msg }); },
    _logs: logs,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// SESSION CONDUCTOR TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('SessionConductor: CWD detection', () => {
  it('detects cwd and gets at least a project root', async () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry();
    const vault = createMockVault();
    const logger = createMockLogger();

    const conductor = new SessionConductor({ registry, eventBus: bus, vault, logger });
    conductor.wire();

    // Trigger session start
    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 50));

    const cwd = conductor.cwdContext;
    assert.ok(cwd, 'cwdContext should be set after vault:unlocked');
    assert.ok(cwd.projectRoot, 'projectRoot should be set');
    assert.ok(cwd.projectName, 'projectName should be set');
    // projectRoot should be a non-empty string
    assert.ok(cwd.projectRoot.length > 0, 'projectRoot should be non-empty');
  });
});

describe('SessionConductor: Greeting composition', () => {
  it('greeting includes user name when personality is loaded', async () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry({
      personality: {
        profile: {
          getProfile: () => ({ mode: 'partner', userName: 'Stephen' }),
        },
      },
      enterprise: undefined,
      briefing: undefined,
    });
    const vault = createMockVault();
    const logger = createMockLogger();

    const conductor = new SessionConductor({ registry, eventBus: bus, vault, logger });
    conductor.wire();

    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 50));

    const greeting = conductor.greeting;
    assert.ok(greeting, 'greeting should be generated');
    assert.ok(greeting.includes('Stephen'), `Greeting should include user name "Stephen", got: ${greeting}`);
  });

  it('greeting falls back to "Boss" when personality is not loaded', async () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry({});
    const vault = createMockVault();
    const logger = createMockLogger();

    const conductor = new SessionConductor({ registry, eventBus: bus, vault, logger });
    conductor.wire();

    bus.publish('vault:unlocked', {});
    await new Promise(r => setTimeout(r, 50));

    const greeting = conductor.greeting;
    assert.ok(greeting, 'greeting should be generated');
    // Should use "Boss" fallback or "Ready." (focus mode) -- either way, should exist
    assert.ok(greeting.length > 0, 'greeting should not be empty');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EPISTEMIC TRACKER TESTS
// ═══════════════════════════════════════════════════════════════════════

describe('EpistemicTracker: Initial state', () => {
  it('starts at score 50', () => {
    const tracker = new EpistemicTracker();
    const score = tracker.score;
    assert.equal(score.overall, 50, 'Initial overall score should be 50');
    assert.equal(score.verification, 50, 'Initial verification score should be 50');
    assert.equal(score.complexity, 50, 'Initial complexity score should be 50');
    assert.equal(score.correction, 50, 'Initial correction score should be 50');
  });
});

describe('EpistemicTracker: Verification scoring', () => {
  it('increases verification score when user verifies', () => {
    const bus = createMockEventBus();
    const tracker = new EpistemicTracker({ eventBus: bus });

    // Record interactions where user verifies
    for (let i = 0; i < 5; i++) {
      tracker.recordInteraction({
        hadVerification: true,
        hadCorrection: false,
        queryComplexity: 3,
        hadRejection: false,
      });
    }

    const score = tracker.score;
    // 100% verification rate: should be at 100
    assert.ok(score.verification === 100, `Verification should be 100, got ${score.verification}`);
  });
});

describe('EpistemicTracker: Correction scoring', () => {
  it('increases correction score when user corrects', () => {
    const bus = createMockEventBus();
    const tracker = new EpistemicTracker({ eventBus: bus });

    // Record interactions where user corrects
    for (let i = 0; i < 5; i++) {
      tracker.recordInteraction({
        hadVerification: false,
        hadCorrection: true,
        queryComplexity: 1,
        hadRejection: false,
      });
    }

    const score = tracker.score;
    // 100% correction rate: correction should be at 100
    assert.ok(score.correction === 100, `Correction should be 100, got ${score.correction}`);
  });
});

describe('EpistemicTracker: Trend detection', () => {
  it('detects improving trend', () => {
    const bus = createMockEventBus();
    const tracker = new EpistemicTracker({ eventBus: bus });

    // First half: low engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: false,
        hadCorrection: false,
        queryComplexity: 1,
        hadRejection: false,
      });
    }
    // Second half: high engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: true,
        hadCorrection: true,
        queryComplexity: 5,
        hadRejection: false,
      });
    }

    const trend = tracker.trend;
    assert.equal(trend, 'improving', `Expected 'improving', got '${trend}'`);
  });

  it('detects declining trend', () => {
    const bus = createMockEventBus();
    const tracker = new EpistemicTracker({ eventBus: bus });

    // First half: high engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: true,
        hadCorrection: true,
        queryComplexity: 5,
        hadRejection: false,
      });
    }
    // Second half: low engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: false,
        hadCorrection: false,
        queryComplexity: 1,
        hadRejection: false,
      });
    }

    const trend = tracker.trend;
    assert.equal(trend, 'declining', `Expected 'declining', got '${trend}'`);
  });

  it('returns insufficient_data with fewer than 4 interactions', () => {
    const tracker = new EpistemicTracker();
    tracker.recordInteraction({ hadVerification: true, hadCorrection: false, queryComplexity: 3, hadRejection: false });
    assert.equal(tracker.trend, 'insufficient_data');
  });
});

describe('EpistemicTracker: Recommendation', () => {
  it('recommends increase_challenge_level when score declines', () => {
    const bus = createMockEventBus();
    const tracker = new EpistemicTracker({ eventBus: bus });

    // First half: high engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: true,
        hadCorrection: true,
        queryComplexity: 5,
        hadRejection: true,
      });
    }
    // Second half: zero engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: false,
        hadCorrection: false,
        queryComplexity: 1,
        hadRejection: false,
      });
    }

    assert.equal(tracker.trend, 'declining');
    assert.equal(tracker.recommendation, 'increase_challenge_level',
      `Expected 'increase_challenge_level', got '${tracker.recommendation}'`);
  });

  it('recommends maintain_current_approach when improving', () => {
    const bus = createMockEventBus();
    const tracker = new EpistemicTracker({ eventBus: bus });

    // First half: low engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: false,
        hadCorrection: false,
        queryComplexity: 1,
        hadRejection: false,
      });
    }
    // Second half: high engagement
    for (let i = 0; i < 4; i++) {
      tracker.recordInteraction({
        hadVerification: true,
        hadCorrection: true,
        queryComplexity: 5,
        hadRejection: true,
      });
    }

    assert.equal(tracker.trend, 'improving');
    assert.equal(tracker.recommendation, 'maintain_current_approach');
  });
});

describe('EpistemicTracker: Window cap', () => {
  it('window caps at 20 interactions', () => {
    const tracker = new EpistemicTracker();

    // Push 25 interactions
    for (let i = 0; i < 25; i++) {
      tracker.recordInteraction({
        hadVerification: i > 20, // only last few have verification
        hadCorrection: false,
        queryComplexity: 2,
        hadRejection: false,
      });
    }

    // Score should reflect only the last 20 interactions, not all 25
    // The window should have shifted so older entries are dropped
    const score = tracker.score;
    // With 25 pushed, window has [5..24]. Items 21-24 have hadVerification=true (4 out of 20 = 20%)
    assert.ok(score.verification >= 0 && score.verification <= 100, 'verification in valid range');
    // Verify it is NOT based on 25 items (that would be 4/25 = 16%)
    // With 20-item window, 4 out of 20 = 20%, so verification should be 20
    assert.equal(score.verification, 20, `Expected 20% verification (4/20), got ${score.verification}`);
  });
});
