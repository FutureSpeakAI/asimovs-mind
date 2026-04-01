/**
 * Voice Pipeline State Machine -- Tracks the state of the voice pipeline.
 *
 * Ported from nexus-os: voice/voice-state-machine.ts
 * Removed: Electron, telemetryEngine, singleton pattern.
 * Changed: No timers (stateless MCP tool context), event-driven via eventBus.
 *
 * States: IDLE -> CONNECTING -> ACTIVE -> PAUSED -> ERROR -> RECOVERING
 * This does NOT capture audio or synthesize speech. It manages the state
 * machine that friday-voice (the Express server) uses. The actual audio
 * goes through friday-voice.
 *
 * The full nexus-os state machine has 16 states. For the MCP-portable version,
 * we collapse to a canonical 6 that cover the user-observable conditions.
 * friday-voice can expand these internally.
 */

// -- State definitions --------------------------------------------------------

const STATES = ['IDLE', 'CONNECTING', 'ACTIVE', 'PAUSED', 'ERROR', 'RECOVERING'];

// All legal transitions. If not in this table, the transition is rejected.
const TRANSITIONS = new Set([
  'IDLE->CONNECTING',
  'IDLE->ERROR',
  'CONNECTING->ACTIVE',
  'CONNECTING->ERROR',
  'CONNECTING->IDLE',
  'ACTIVE->PAUSED',
  'ACTIVE->ERROR',
  'ACTIVE->IDLE',
  'ACTIVE->RECOVERING',
  'PAUSED->ACTIVE',
  'PAUSED->IDLE',
  'PAUSED->ERROR',
  'ERROR->RECOVERING',
  'ERROR->IDLE',
  'RECOVERING->ACTIVE',
  'RECOVERING->CONNECTING',
  'RECOVERING->ERROR',
  'RECOVERING->IDLE',
]);

// -- Voice State Machine ------------------------------------------------------

export class VoiceStateMachine {
  #state = 'IDLE';
  #stateEnteredAt = Date.now();
  #transitionLog = [];
  #maxLogEntries = 200;
  #healthMetrics = { consecutiveHealthy: 0, consecutiveUnhealthy: 0 };
  #eventBus = null;

  initialize(eventBus) {
    this.#eventBus = eventBus;
  }

  // -- State queries ----------------------------------------------------------

  getState() {
    return this.#state;
  }

  getUptime() {
    return Date.now() - this.#stateEnteredAt;
  }

  getTransitionLog() {
    return [...this.#transitionLog];
  }

  getHealth() {
    return {
      state: this.#state,
      uptimeMs: this.getUptime(),
      ...this.#healthMetrics,
    };
  }

  // -- Transitions ------------------------------------------------------------

  canTransition(to) {
    if (this.#state === to) return false;
    return TRANSITIONS.has(`${this.#state}->${to}`);
  }

  transition(to, reason = '') {
    const from = this.#state;
    if (from === to) return false;

    if (!TRANSITIONS.has(`${from}->${to}`)) {
      console.warn(`[VoiceStateMachine] Illegal transition: ${from} -> ${to} (${reason})`);
      return false;
    }

    this.#state = to;
    this.#stateEnteredAt = Date.now();
    this.#healthMetrics = { consecutiveHealthy: 0, consecutiveUnhealthy: 0 };

    const entry = { from, to, at: Date.now(), reason };
    this.#transitionLog.push(entry);
    if (this.#transitionLog.length > this.#maxLogEntries) {
      this.#transitionLog = this.#transitionLog.slice(-this.#maxLogEntries);
    }

    if (this.#eventBus) {
      this.#eventBus.emit('voice:state-change', { from, to, reason });
    }

    return true;
  }

  // -- Health reporting -------------------------------------------------------

  reportHealth(healthy) {
    if (healthy) {
      this.#healthMetrics.consecutiveHealthy++;
      this.#healthMetrics.consecutiveUnhealthy = 0;
    } else {
      this.#healthMetrics.consecutiveUnhealthy++;
      this.#healthMetrics.consecutiveHealthy = 0;
    }
  }

  // -- Reset ------------------------------------------------------------------

  reset() {
    this.#state = 'IDLE';
    this.#stateEnteredAt = Date.now();
    this.#healthMetrics = { consecutiveHealthy: 0, consecutiveUnhealthy: 0 };
    this.#transitionLog = [];
  }

  // -- Snapshot for tools -----------------------------------------------------

  getSnapshot() {
    return {
      state: this.#state,
      uptimeMs: this.getUptime(),
      stateEnteredAt: this.#stateEnteredAt,
      health: { ...this.#healthMetrics },
      recentTransitions: this.#transitionLog.slice(-10).map((e) => ({
        from: e.from,
        to: e.to,
        reason: e.reason,
        time: new Date(e.at).toISOString(),
      })),
    };
  }
}
