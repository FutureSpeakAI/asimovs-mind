/**
 * Emotional Arc Tracker -- Three-mode state machine for Musical Memory.
 *
 * Modes:
 *   MIRROR      -- Reflect the operator's current emotional state
 *   SHIFT       -- Lean toward emotional resolution
 *   CELEBRATION -- Milestone reinforcement
 *
 * The tracker reads mood data from the sentiment engine and frustration
 * scores from the FrustrationDetector to decide when to transition between
 * modes. Transitions require sustained conditions (3+ consecutive readings)
 * to prevent jitter, following the CHANGE_THRESHOLD pattern from core/eis.js.
 *
 * The operator never sees or configures modes. They experience music
 * appearing at the right moments. The machinery is architectural.
 */

// --- TUNABLE ---
const SUSTAINED_THRESHOLD = 3;         // readings before mode transition
const FRUSTRATION_SHIFT_THRESHOLD = 0.6; // frustration score to trigger shift
const CELEBRATION_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes after celebration
const MODE_HISTORY_CAP = 100;

const VALENCE_FROM_MOOD = {
  happy: 'uplifting', excited: 'uplifting', confident: 'uplifting',
  calm: 'calming', relaxed: 'calming', peaceful: 'calming',
  neutral: 'neutral', focused: 'neutral',
  frustrated: 'intense', stressed: 'intense', angry: 'intense',
  sad: 'melancholy', anxious: 'melancholy', tired: 'melancholy',
};

export class EmotionalArcTracker {
  #currentMode = null;      // null until vibe is set
  #sessionVibe = null;      // operator's baseline from session start
  #moodHistory = [];        // rolling window of { mood, energy, timestamp }
  #frustrationHistory = []; // rolling window of frustration scores
  #milestoneCount = 0;
  #modeHistory = [];        // { mode, enteredAt, trigger }
  #lastCelebrationAt = 0;
  #injectionCount = 0;
  #currentValence = 'neutral';
  #eventBus = null;
  #forced = false;          // true when operator has forced a mode

  initialize(eventBus) {
    this.#eventBus = eventBus;
  }

  get currentMode() { return this.#currentMode; }
  get currentValence() { return this.#currentValence; }
  get sessionVibe() { return this.#sessionVibe; }
  get injectionCount() { return this.#injectionCount; }
  get milestoneCount() { return this.#milestoneCount; }
  get isActive() { return this.#currentMode !== null; }

  /**
   * Set the session baseline. Called when the operator responds to the
   * vibe question. Activates the arc tracker in Mirror mode.
   */
  setSessionVibe(vibe, initialTags) {
    this.#sessionVibe = { vibe, tags: initialTags || [], setAt: Date.now() };
    this.#currentValence = this.#vibeToValence(vibe);
    this.#forced = false;
    this.#transitionTo('mirror', 'session_baseline');
  }

  /**
   * Recalibrate the baseline mid-session (operator shared a new song).
   */
  recalibrate(vibe) {
    this.#sessionVibe = { ...this.#sessionVibe, vibe, recalibratedAt: Date.now() };
    this.#currentValence = this.#vibeToValence(vibe);
    this.#forced = false;
    this.#transitionTo('mirror', 'recalibration');
  }

  /**
   * Update mood from sentiment engine.
   */
  updateMood(mood, energyLevel) {
    this.#moodHistory.push({ mood, energy: energyLevel, timestamp: Date.now() });
    if (this.#moodHistory.length > 20) this.#moodHistory.shift();

    this.#currentValence = VALENCE_FROM_MOOD[mood] || 'neutral';

    if (!this.#forced && this.#currentMode) {
      this.#evaluateTransition();
    }
  }

  /**
   * Update frustration level from the detector.
   */
  updateFrustration(score) {
    this.#frustrationHistory.push({ score, timestamp: Date.now() });
    if (this.#frustrationHistory.length > 20) this.#frustrationHistory.shift();

    if (!this.#forced && this.#currentMode) {
      this.#evaluateTransition();
    }
  }

  /**
   * Check if an agent completion represents a milestone.
   */
  checkMilestone(completionData) {
    if (!this.#currentMode) return false;

    const text = (completionData?.summary || completionData?.description || '').toLowerCase();
    const milestoneKeywords = [
      'all tests pass', 'tests passing', 'build succeeded', 'deployed',
      'shipped', 'merged', 'completed successfully', 'milestone',
      'zero failures', '0 failures', 'done',
    ];

    const isMilestone = milestoneKeywords.some(kw => text.includes(kw));
    if (isMilestone) {
      this.#milestoneCount++;
      if (!this.#forced) {
        this.#transitionTo('celebration', 'milestone');
        this.#lastCelebrationAt = Date.now();
      }
      return true;
    }
    return false;
  }

  /**
   * Force a specific mode (operator override via tool).
   */
  forceMode(mode) {
    if (mode === 'auto') {
      this.#forced = false;
      this.#evaluateTransition();
      return this.#currentMode;
    }
    this.#forced = true;
    this.#transitionTo(mode, 'operator_override');
    return mode;
  }

  /**
   * Record that an injection was made.
   */
  recordInjection() {
    this.#injectionCount++;
  }

  /**
   * Get the full arc state for the status tool.
   */
  getArcState() {
    return {
      currentMode: this.#currentMode,
      currentValence: this.#currentValence,
      sessionVibe: this.#sessionVibe,
      forced: this.#forced,
      milestoneCount: this.#milestoneCount,
      injectionCount: this.#injectionCount,
      moodHistory: this.#moodHistory.slice(-10),
      frustrationLevel: this.#frustrationHistory.length > 0
        ? this.#frustrationHistory[this.#frustrationHistory.length - 1].score
        : 0,
      escalationTrajectory: this.#getTrajectory(),
      modeHistory: this.#modeHistory.slice(-20),
    };
  }

  reset() {
    this.#currentMode = null;
    this.#sessionVibe = null;
    this.#moodHistory = [];
    this.#frustrationHistory = [];
    this.#milestoneCount = 0;
    this.#modeHistory = [];
    this.#lastCelebrationAt = 0;
    this.#injectionCount = 0;
    this.#currentValence = 'neutral';
    this.#forced = false;
  }

  // -- Internal --

  #evaluateTransition() {
    const now = Date.now();

    // After celebration, return to mirror after cooldown
    if (this.#currentMode === 'celebration' && now - this.#lastCelebrationAt > CELEBRATION_COOLDOWN_MS) {
      this.#transitionTo('mirror', 'celebration_cooldown');
      return;
    }

    // Check for shift: sustained frustration
    const recentFrustration = this.#frustrationHistory.slice(-SUSTAINED_THRESHOLD);
    if (recentFrustration.length >= SUSTAINED_THRESHOLD) {
      const allHigh = recentFrustration.every(f => f.score >= FRUSTRATION_SHIFT_THRESHOLD);
      if (allHigh && this.#currentMode === 'mirror') {
        this.#transitionTo('shift', 'sustained_frustration');
        return;
      }
    }

    // Check for return to mirror: frustration resolved
    if (this.#currentMode === 'shift') {
      const recent = this.#frustrationHistory.slice(-SUSTAINED_THRESHOLD);
      if (recent.length >= SUSTAINED_THRESHOLD) {
        const allLow = recent.every(f => f.score < FRUSTRATION_SHIFT_THRESHOLD * 0.5);
        if (allLow) {
          this.#transitionTo('mirror', 'frustration_resolved');
          return;
        }
      }
    }

    // Check for declining energy -> shift
    if (this.#currentMode === 'mirror' && this.#moodHistory.length >= 5) {
      const recent5 = this.#moodHistory.slice(-5);
      const declining = recent5.every((m, i) =>
        i === 0 || m.energy <= recent5[i - 1].energy
      );
      if (declining && recent5[recent5.length - 1].energy < 0.3) {
        this.#transitionTo('shift', 'declining_energy');
      }
    }
  }

  #transitionTo(newMode, trigger) {
    if (newMode === this.#currentMode) return;
    const previousMode = this.#currentMode;
    this.#currentMode = newMode;
    this.#modeHistory.push({ mode: newMode, enteredAt: Date.now(), trigger });
    if (this.#modeHistory.length > MODE_HISTORY_CAP) {
      this.#modeHistory.splice(0, this.#modeHistory.length - MODE_HISTORY_CAP);
    }

    if (this.#eventBus) {
      this.#eventBus.publish('musical-memory:mode-changed', {
        previousMode,
        newMode,
        trigger,
        timestamp: Date.now(),
      });
    }
  }

  #getTrajectory() {
    if (this.#frustrationHistory.length < 3) return 'stable';
    const recent = this.#frustrationHistory.slice(-5);
    const first = recent[0].score;
    const last = recent[recent.length - 1].score;
    const diff = last - first;

    if (diff > 0.2) return 'rising';
    if (diff < -0.2) return 'de-escalating';
    if (last > 0.6) return 'sustained';
    if (last < 0.2) return 'resolved';
    return 'stable';
  }

  #vibeToValence(vibe) {
    const map = {
      energized: 'uplifting', focused: 'neutral', melancholy: 'melancholy',
      chill: 'calming', angry: 'intense', joyful: 'uplifting',
    };
    return map[vibe] || 'neutral';
  }
}
