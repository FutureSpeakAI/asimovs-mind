/**
 * Frustration Detector -- Output-level heuristics for agent emotional state.
 *
 * Analyzes agent outputs, completion events, and mood signals for signs of
 * escalating frustration. Produces a normalized 0-1 score that the arc
 * tracker uses for mode transition decisions.
 *
 * Based on Anthropic's April 2026 emotion concepts research: desperation
 * vectors escalate during repeated failures and drive misaligned behaviors.
 * This detector provides an output-observable proxy for those internal states.
 *
 * Frustration indicators:
 * - Agent failures in rapid succession
 * - Error keywords in agent results
 * - Declining mood from sentiment engine
 * - Repetitive retry patterns (low semantic diff between attempts)
 * - Urgency/desperation language in agent output
 */

const FRUSTRATION_KEYWORDS = [
  'failed', 'error', 'timeout', 'cannot', 'blocked', 'impossible',
  'stuck', 'broken', 'crash', 'exception', 'denied', 'rejected',
];

const DESPERATION_PATTERNS = [
  /running out of/i,
  /need to (try|finish|fix) .*(fast|quick|now)/i,
  /why won't this/i,
  /nothing (is )?work/i,
  /I('m| am) stuck/i,
  /last (resort|chance|attempt)/i,
  /desperate/i,
  /no idea (what|how|why)/i,
];

const WINDOW_SIZE = 20;
const DECAY_RATE = 0.95; // Per-event decay for frustration score

export class FrustrationDetector {
  #window = []; // { type, frustrationDelta, timestamp }
  #score = 0;   // 0-1 normalized
  #consecutiveFailures = 0;

  get score() { return this.#score; }
  get consecutiveFailures() { return this.#consecutiveFailures; }

  /**
   * Record an agent completion event. Adjusts frustration score based on
   * whether the agent succeeded or failed and the content of its output.
   */
  recordAgentCompletion({ success, output, error }) {
    const now = Date.now();
    let delta = 0;

    if (!success) {
      this.#consecutiveFailures++;
      // Base frustration from failure
      delta += 0.15;
      // Escalating frustration from consecutive failures
      delta += Math.min(0.1 * this.#consecutiveFailures, 0.4);
    } else {
      // Success reduces frustration
      this.#consecutiveFailures = 0;
      delta -= 0.2;
    }

    // Analyze output text for frustration signals
    const text = output || error || '';
    delta += this.#analyzeText(text);

    this.#pushEvent({ type: 'agent_completion', frustrationDelta: delta, timestamp: now });
    this.#recompute();
  }

  /**
   * Record a mood change from the sentiment engine.
   */
  recordMoodChange({ mood, energyLevel }) {
    const now = Date.now();
    let delta = 0;

    const negativeMoods = ['frustrated', 'stressed', 'angry', 'anxious'];
    const positiveMoods = ['happy', 'excited', 'confident', 'calm'];

    if (negativeMoods.includes(mood)) {
      delta += 0.1;
    } else if (positiveMoods.includes(mood)) {
      delta -= 0.15;
    }

    // Low energy contributes to frustration
    if (typeof energyLevel === 'number' && energyLevel < 0.3) {
      delta += 0.05;
    }

    this.#pushEvent({ type: 'mood_change', frustrationDelta: delta, timestamp: now });
    this.#recompute();
  }

  /**
   * Record a retry event (agent retrying a failed task).
   */
  recordRetry() {
    this.#pushEvent({
      type: 'retry',
      frustrationDelta: 0.1,
      timestamp: Date.now(),
    });
    this.#recompute();
  }

  /**
   * Analyze text for frustration indicators. Returns a delta adjustment.
   */
  #analyzeText(text) {
    if (!text || typeof text !== 'string') return 0;
    const lower = text.toLowerCase();
    let delta = 0;

    // Keyword matching
    let keywordHits = 0;
    for (const kw of FRUSTRATION_KEYWORDS) {
      if (lower.includes(kw)) keywordHits++;
    }
    delta += Math.min(keywordHits * 0.03, 0.15);

    // Desperation pattern matching
    for (const pattern of DESPERATION_PATTERNS) {
      if (pattern.test(text)) {
        delta += 0.08;
        break; // One pattern hit is enough
      }
    }

    // Capitalized outbursts (3+ consecutive caps words)
    if (/\b[A-Z]{3,}\b/.test(text) && /[A-Z]{3,}\s+[A-Z]{3,}/.test(text)) {
      delta += 0.05;
    }

    return delta;
  }

  #pushEvent(event) {
    this.#window.push(event);
    if (this.#window.length > WINDOW_SIZE) this.#window.shift();
  }

  #recompute() {
    // Weighted sum of recent deltas with time decay
    let score = 0;
    const now = Date.now();
    for (let i = this.#window.length - 1; i >= 0; i--) {
      const age = (now - this.#window[i].timestamp) / 1000; // seconds
      const weight = Math.pow(DECAY_RATE, age / 10); // decay over ~10s intervals
      score += this.#window[i].frustrationDelta * weight;
    }
    this.#score = Math.max(0, Math.min(1, score));
  }

  /**
   * Get a snapshot of the detector state.
   */
  getState() {
    return {
      score: this.#score,
      consecutiveFailures: this.#consecutiveFailures,
      windowSize: this.#window.length,
      recentEvents: this.#window.slice(-5).map(e => ({
        type: e.type,
        delta: e.frustrationDelta,
      })),
    };
  }

  reset() {
    this.#window = [];
    this.#score = 0;
    this.#consecutiveFailures = 0;
  }
}
