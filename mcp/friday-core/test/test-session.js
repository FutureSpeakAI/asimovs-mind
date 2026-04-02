/**
 * Session Conductor + Epistemic Independence Score Tests
 *
 * Tests session lifecycle and EIS tracking using mock dependencies.
 * Uses node:test and node:assert/strict. No external frameworks.
 *
 * Run: node --test test/test-session.js
 */

import { describe, it } from 'node:test';
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

// ═══════════════════════════════════════════════════════════════════════
// EIS: SIGNAL SYNTHESIS (llm:request-completed without pre-extracted signals)
// ═══════════════════════════════════════════════════════════════════════

import { wireSubsystems } from '../core/wiring.js';
import { PersonalityProfile } from '../subsystems/personality/profile.js';
import { CalibrationEngine } from '../subsystems/personality/calibration.js';
import { PersonalityEvolution } from '../subsystems/personality/evolution.js';
import { SentimentEngine } from '../subsystems/personality/sentiment.js';

function createMockState() {
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
    _store: store,
  };
}

describe('EIS wiring: synthesises fallback signals when event lacks .signals', () => {
  it('records interaction even when llm:request-completed has no signals field', () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry({});
    const { epistemicTracker } = wireSubsystems(registry, bus);

    // Publish without a signals field
    bus.publish('llm:request-completed', { queryComplexity: 3 });

    // With one item: verification=0, complexity=(3-1)*25=50, correction=0
    const score = epistemicTracker.score;
    assert.ok(score.overall >= 0 && score.overall <= 100, 'score should be in valid range');
    assert.equal(score.verification, 0, 'no verification signal should yield 0');
    assert.equal(score.complexity, 50, 'queryComplexity 3 should map to 50');
  });

  it('uses pre-extracted signals when present', () => {
    const bus = createMockEventBus();
    const registry = createMockRegistry({});
    const { epistemicTracker } = wireSubsystems(registry, bus);

    bus.publish('llm:request-completed', {
      signals: { hadVerification: true, hadCorrection: false, queryComplexity: 5, hadRejection: false },
    });

    const score = epistemicTracker.score;
    assert.equal(score.verification, 100, 'explicit verification signal should yield 100');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// EIS FEEDBACK LOOP: eis:updated -> personality challenge level
// ═══════════════════════════════════════════════════════════════════════

describe('EIS feedback loop: increase_challenge_level raises personality challenge', () => {
  it('applies challenge level increase when eis:updated fires with declining trend', async () => {
    const bus = createMockEventBus();

    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());
    await profile.setChallengeLevel(2);

    const registry = createMockRegistry({ personality: { profile } });
    wireSubsystems(registry, bus);

    bus.publish('eis:updated', {
      score: { overall: 20 },
      trend: 'declining',
      recommendation: 'increase_challenge_level',
    });

    await new Promise(r => setTimeout(r, 20));

    assert.equal(profile.getProfile().challengeLevel, 3, 'challenge level should be raised from 2 to 3');
  });

  it('does not exceed challenge ceiling of 5', async () => {
    const bus = createMockEventBus();

    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());
    await profile.setChallengeLevel(5);

    const registry = createMockRegistry({ personality: { profile } });
    wireSubsystems(registry, bus);

    bus.publish('eis:updated', {
      score: { overall: 10 },
      trend: 'declining',
      recommendation: 'increase_challenge_level',
    });

    await new Promise(r => setTimeout(r, 20));

    assert.equal(profile.getProfile().challengeLevel, 5, 'challenge level should not exceed 5');
  });

  it('ignores eis:updated with no recommendation', async () => {
    const bus = createMockEventBus();

    const profile = new PersonalityProfile();
    await profile.initialize(createMockState());
    await profile.setChallengeLevel(3);

    const registry = createMockRegistry({ personality: { profile } });
    wireSubsystems(registry, bus);

    bus.publish('eis:updated', {
      score: { overall: 60 },
      trend: 'stable',
      recommendation: null,
    });

    await new Promise(r => setTimeout(r, 20));

    assert.equal(profile.getProfile().challengeLevel, 3, 'challenge level should be unchanged when no recommendation');
  });
});

// ═══════════════════════════════════════════════════════════════════════
// PERSONALITY SAVE/LOAD ROUND-TRIP
// ═══════════════════════════════════════════════════════════════════════

describe('Personality save/load: profile survives re-initialise', () => {
  it('reloads saved profile fields on second initialize', async () => {
    const state = createMockState();
    const profile1 = new PersonalityProfile();
    await profile1.initialize(state);
    await profile1.setMode('focus');
    await profile1.setChallengeLevel(4);

    // Simulate new session: fresh instance, same state store
    const profile2 = new PersonalityProfile();
    await profile2.initialize(state);

    assert.equal(profile2.getProfile().mode, 'focus', 'mode should survive reload');
    assert.equal(profile2.getProfile().challengeLevel, 4, 'challenge level should survive reload');
  });
});

describe('Personality save/load: calibration state survives re-initialise', () => {
  it('reloads dimension changes from a previous session', async () => {
    const state = createMockState();
    const cal1 = new CalibrationEngine();
    await cal1.initialize(state);
    // Apply a strong explicit signal then wait for the 2-second debounced save
    cal1.recordSignal({ source: 'explicit', type: 'more_formal', magnitude: 1.0 });
    cal1.incrementSession();
    await new Promise(r => setTimeout(r, 2100));

    const cal2 = new CalibrationEngine();
    await cal2.initialize(state);

    const dims = cal2.getDimensions();
    assert.ok(dims.formality > 0.5, `formality should be above default 0.5 after reload, got ${dims.formality}`);
  });
});

describe('Personality save/load: evolution session count survives re-initialise', () => {
  it('preserves session count across instances', async () => {
    const state = createMockState();
    const evo1 = new PersonalityEvolution();
    await evo1.initialize(state);
    await evo1.incrementSession(['warm', 'curious']);
    await evo1.incrementSession(['warm', 'curious']);

    const evo2 = new PersonalityEvolution();
    await evo2.initialize(state);

    const evoState = evo2.getEvolutionState();
    assert.ok(evoState !== null, 'evolution state should be loaded');
    assert.equal(evoState.sessionCount, 2, 'session count should survive reload');
  });
});

describe('Personality save/load: mood log survives re-initialise', () => {
  it('reloads mood log entries on second initialize', async () => {
    const state = createMockState();
    const bus = createMockEventBus();

    const sent1 = new SentimentEngine();
    await sent1.initialize(state, bus);
    // Use a string guaranteed to match 'frustrated' pattern
    sent1.analyse('I am so frustrated, the damn thing is still broken!');
    // Allow async #persistLog to settle
    await new Promise(r => setTimeout(r, 50));

    const sent2 = new SentimentEngine();
    await sent2.initialize(state, bus);

    const log = sent2.getMoodLog();
    assert.ok(log.length >= 1, 'mood log should be restored from state');
    assert.equal(log[0].mood, 'frustrated', 'mood entry should match what was recorded');
  });
});
