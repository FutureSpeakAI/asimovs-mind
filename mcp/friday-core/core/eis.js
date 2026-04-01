/**
 * Epistemic Independence Score (EIS)
 *
 * Tracks three dimensions over a rolling 20-interaction window:
 *   - Verification frequency: Does the user check Friday's outputs?
 *   - Query complexity: Are queries getting more sophisticated?
 *   - Correction rate: Does the user push back on answers?
 *
 * Overall EIS = weighted average: verification 40%, complexity 30%, correction 30%.
 * Higher scores signal greater epistemic independence from the AI.
 *
 * Pure logic utility -- no MCP tools, used by personality subsystem.
 */

const WEIGHTS = { verification: 0.4, complexity: 0.3, correction: 0.3 };
const CHANGE_THRESHOLD = 3; // publish only if score shifts > 3 points

function clamp(v, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, v));
}

export class EpistemicTracker {
  #window = [];
  #maxWindow = 20;
  #score = { verification: 50, complexity: 50, correction: 50, overall: 50 };
  #eventBus;
  #logger;

  constructor({ eventBus, logger } = {}) {
    this.#eventBus = eventBus;
    this.#logger = logger || { info: () => {}, warn: () => {} };
  }

  /**
   * Called after each LLM interaction with extracted signals.
   * @param {{ hadCorrection: boolean, hadVerification: boolean, queryComplexity: number, hadRejection: boolean }} signals
   */
  recordInteraction(signals) {
    this.#window.push({ ...signals, timestamp: Date.now() });
    if (this.#window.length > this.#maxWindow) this.#window.shift();
    this.#recompute();
  }

  #recompute() {
    if (this.#window.length === 0) return;

    const prev = this.#score.overall;

    // Verification: % of interactions with verification signals
    const verCount = this.#window.filter(s => s.hadVerification).length;
    this.#score.verification = clamp((verCount / this.#window.length) * 100);

    // Complexity: rolling average mapped from 1-5 scale to 0-100
    const complexitySum = this.#window.reduce((s, i) => s + (i.queryComplexity || 1), 0);
    this.#score.complexity = clamp(((complexitySum / this.#window.length) - 1) * 25);

    // Correction: % of interactions with corrections or rejections
    const corrCount = this.#window.filter(s => s.hadCorrection || s.hadRejection).length;
    this.#score.correction = clamp((corrCount / this.#window.length) * 100);

    // Overall weighted average
    this.#score.overall = clamp(
      this.#score.verification * WEIGHTS.verification +
      this.#score.complexity * WEIGHTS.complexity +
      this.#score.correction * WEIGHTS.correction
    );

    // Publish if meaningful change
    if (Math.abs(this.#score.overall - prev) > CHANGE_THRESHOLD && this.#eventBus) {
      this.#eventBus.publish('eis:updated', {
        score: this.score,
        trend: this.trend,
        recommendation: this.recommendation,
      });
      this.#logger.info(`EIS updated: ${this.#score.overall.toFixed(1)} (was ${prev.toFixed(1)})`);
    }
  }

  get score() {
    return { ...this.#score };
  }

  /** Compare first half of window to second half -- positive means improving */
  get trend() {
    const len = this.#window.length;
    if (len < 4) return 'insufficient_data';

    const mid = Math.floor(len / 2);
    const firstHalf = this.#window.slice(0, mid);
    const secondHalf = this.#window.slice(mid);

    const avg = (arr) => {
      const v = arr.filter(s => s.hadVerification).length / arr.length;
      const c = arr.reduce((s, i) => s + (i.queryComplexity || 1), 0) / arr.length;
      const r = arr.filter(s => s.hadCorrection || s.hadRejection).length / arr.length;
      return v * WEIGHTS.verification + ((c - 1) / 4) * WEIGHTS.complexity + r * WEIGHTS.correction;
    };

    const delta = avg(secondHalf) - avg(firstHalf);
    if (delta > 0.05) return 'improving';
    if (delta < -0.05) return 'declining';
    return 'stable';
  }

  /** If independence is declining, recommend increasing challenge level */
  get recommendation() {
    const t = this.trend;
    if (t === 'declining') return 'increase_challenge_level';
    if (t === 'improving') return 'maintain_current_approach';
    if (this.#score.overall < 30) return 'increase_challenge_level';
    return null;
  }
}
