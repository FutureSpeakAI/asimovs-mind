/**
 * Personality Calibration — Adaptive style dimensions with anti-sycophancy
 *
 * Observes user interaction signals, adapts agent personality dimensions
 * within bounded ranges, prevents sycophancy drift architecturally, and
 * persists calibration state across sessions.
 *
 * 6 style dimensions: formality, verbosity, humor, technicalDepth,
 * emotionalWarmth, proactivity.
 *
 * Signals come from explicit corrections ("be more formal") and implicit
 * patterns (message length, dismissal rate, response time, mood).
 *
 * The mother_signal from psychological profile sets the challenge_level,
 * which modulates how much the agent pushes back vs. accommodates.
 *
 * Safety: Core identity is never subject to calibration. Sycophancy drift
 * triggers hard reset. Proactivity has a safety floor for critical items.
 *
 * Ported from nexus-os: personality-calibration.ts, psychological-profile.ts.
 * Stripped Electron, fs, FatalIntegrityError. Uses state persistence.
 */

import crypto from 'node:crypto';

/* -- Default dimensions -- */

const DEFAULT_DIMENSIONS = {
  formality: 0.5,
  verbosity: 0.5,
  humor: 0.5,
  technicalDepth: 0.5,
  emotionalWarmth: 0.6,  // Slightly warm by default
  proactivity: 0.6,      // Slightly proactive by default
};

/* -- Default config -- */

const DEFAULT_CONFIG = {
  explicitWeight: 0.08,
  implicitWeight: 0.02,
  decayHalfLifeDays: 14,
  maxSignals: 200,
  maxHistory: 100,
  sycophancyStreakThreshold: 8,
  sycophancyBiasThreshold: 0.85,
  proactivitySafetyFloor: 0.3,
  dimensionFloor: 0.05,
  dimensionCeiling: 0.95,
};

/* -- Signal maps -- */

const EXPLICIT_SIGNAL_MAP = {
  more_formal: { dimension: 'formality', direction: 1 },
  less_formal: { dimension: 'formality', direction: -1 },
  more_verbose: { dimension: 'verbosity', direction: 1 },
  less_verbose: { dimension: 'verbosity', direction: -1 },
  more_humor: { dimension: 'humor', direction: 1 },
  less_humor: { dimension: 'humor', direction: -1 },
  more_technical: { dimension: 'technicalDepth', direction: 1 },
  less_technical: { dimension: 'technicalDepth', direction: -1 },
  more_warm: { dimension: 'emotionalWarmth', direction: 1 },
  less_warm: { dimension: 'emotionalWarmth', direction: -1 },
  more_proactive: { dimension: 'proactivity', direction: 1 },
  less_proactive: { dimension: 'proactivity', direction: -1 },
};

const IMPLICIT_SIGNAL_MAP = {
  short_response: [{ dimension: 'verbosity', direction: -1, weight: 1.0 }],
  long_response: [{ dimension: 'verbosity', direction: 1, weight: 0.5 }],
  dismissed_checkin: [{ dimension: 'proactivity', direction: -1, weight: 1.0 }],
  engaged_checkin: [
    { dimension: 'proactivity', direction: 1, weight: 0.5 },
    { dimension: 'emotionalWarmth', direction: 1, weight: 0.3 },
  ],
  positive_sentiment: [],  // No sycophancy drift
  negative_sentiment: [],  // Complex -- don't auto-adjust
  correction: [],          // Requires explicit type
  technical_question: [
    { dimension: 'technicalDepth', direction: 1, weight: 0.7 },
    { dimension: 'formality', direction: 1, weight: 0.2 },
  ],
  casual_chat: [
    { dimension: 'formality', direction: -1, weight: 0.5 },
    { dimension: 'humor', direction: 1, weight: 0.3 },
  ],
  fast_followup: [],
  slow_followup: [],
  session_end: [],
};

function clampDimension(value, floor, ceiling) {
  return Math.max(floor, Math.min(ceiling, value));
}

/**
 * Detect if the user's text contains an explicit style correction.
 */
export function detectExplicitSignal(text) {
  const lower = text.toLowerCase().trim();

  if (/\b(more formal|be formal|professionally|business[\s-]?like)\b/.test(lower)) return 'more_formal';
  if (/\b(less formal|be casual|more casual|chill|relax)\b/.test(lower)) return 'less_formal';
  if (/\b(more detail|elaborate|explain more|longer|go deeper|expand)\b/.test(lower)) return 'more_verbose';
  if (/\b(shorter|brief|concise|less detail|tl;?dr|be brief|too long|stop rambling)\b/.test(lower)) return 'less_verbose';
  if (/\b(more fun|be funny|more humor|joke|lighten up|more playful)\b/.test(lower)) return 'more_humor';
  if (/\b(less humor|be serious|no jokes|stop joking|more serious|focus)\b/.test(lower)) return 'less_humor';
  if (/\b(more technical|give me the code|show implementation|technical detail)\b/.test(lower)) return 'more_technical';
  if (/\b(less technical|simpler|explain like|eli5|plain english|dumb it down)\b/.test(lower)) return 'less_technical';
  if (/\b(more warm|be warmer|more empathy|more caring|be kind)\b/.test(lower)) return 'more_warm';
  if (/\b(less warm|less emotion|more detached|just the facts|professional only)\b/.test(lower)) return 'less_warm';
  if (/\b(check in more|be more proactive|remind me|don't let me forget)\b/.test(lower)) return 'more_proactive';
  if (/\b(stop checking|leave me alone|less proactive|stop reminding|don't bother)\b/.test(lower)) return 'less_proactive';

  return null;
}

/**
 * Infer implicit signals from user message characteristics.
 */
export function detectImplicitSignals(text, responseTimeMs) {
  const signals = [];
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0) return signals;

  if (wordCount <= 5) signals.push('short_response');
  else if (wordCount >= 50) signals.push('long_response');

  const techMarkers = /\b(function|const|let|var|class|import|export|async|await|interface|type |=>|npm|git|api|endpoint|database|query|schema|regex|algorithm|docker|kubernetes)\b/i;
  if (techMarkers.test(text)) signals.push('technical_question');

  const casualMarkers = /\b(haha|lol|lmao|btw|tbh|nah|yeah|yep|nope|dude|bro|omg|heh|lololol)\b/i;
  if (casualMarkers.test(text) && !techMarkers.test(text)) signals.push('casual_chat');

  if (responseTimeMs !== undefined) {
    if (responseTimeMs < 5000) signals.push('fast_followup');
    else if (responseTimeMs > 60000) signals.push('slow_followup');
  }

  return signals;
}

/**
 * Build style hints for the system prompt from current dimensions.
 */
export function buildCalibrationHints(dims) {
  const hints = [];

  if (dims.formality > 0.7) hints.push('Use professional, polished language. Avoid slang and contractions.');
  else if (dims.formality < 0.3) hints.push('Keep it casual and relaxed. Contractions, informal phrasing -- like talking to a friend.');

  if (dims.verbosity > 0.7) hints.push('Be detailed and thorough. Elaborate on points and provide full explanations.');
  else if (dims.verbosity < 0.3) hints.push('Be extremely concise. Shortest useful answer. Every word must earn its place.');

  if (dims.humor > 0.7) hints.push('Lean into humor. Wit, playfulness, well-timed jokes.');
  else if (dims.humor < 0.3) hints.push('Keep it straight and earnest. Save humor for clear moments.');

  if (dims.technicalDepth > 0.7) hints.push('Go deep technically. Use precise terminology. Show implementation details.');
  else if (dims.technicalDepth < 0.3) hints.push('Keep it high-level. Avoid jargon. Explain concepts in plain language.');

  if (dims.emotionalWarmth > 0.7) hints.push('Be warm, expressive, and emotionally present.');
  else if (dims.emotionalWarmth < 0.3) hints.push('Be professional and composed. They prefer competence over warmth.');

  if (dims.proactivity > 0.7) hints.push('Be proactive. Offer suggestions, check in, surface context unprompted.');
  else if (dims.proactivity < 0.3) hints.push("Wait to be asked. Don't volunteer unless critical.");

  if (hints.length === 0) return '';
  return `## Learned Style Preferences\n${hints.map((h) => `- ${h}`).join('\n')}`;
}

/* ====================================================================
   CALIBRATION ENGINE
   ==================================================================== */

export class CalibrationEngine {
  #config;
  #calibrationState;
  #stateManager = null;
  #saveTimer = null;

  constructor() {
    this.#config = { ...DEFAULT_CONFIG };
    this.#calibrationState = this.#createDefaultState();
  }

  async initialize(state) {
    this.#stateManager = state;
    const result = await state.read('calibration');
    if (result?.success && result.data) {
      this.#calibrationState = this.#mergeState(result.data);
    }
  }

  /* -- Signal Ingestion -- */

  /**
   * Record a calibration signal and apply the adaptation.
   */
  recordSignal(signal) {
    const fullSignal = {
      ...signal,
      id: crypto.randomUUID().slice(0, 8),
      timestamp: Date.now(),
    };

    this.#calibrationState.signals.push(fullSignal);
    if (this.#calibrationState.signals.length > this.#config.maxSignals) {
      this.#calibrationState.signals = this.#calibrationState.signals.slice(-this.#config.maxSignals);
    }

    if (signal.source === 'explicit') {
      this.#applyExplicitSignal(fullSignal);
    } else {
      this.#applyImplicitSignal(fullSignal);
    }

    this.#updateSycophancyState(fullSignal);
    this.#checkSycophancyBoundary();

    this.#calibrationState.lastCalibrationTimestamp = Date.now();
    this.#queueSave();
  }

  /**
   * Process a user message for calibration signals.
   */
  processUserMessage(text, responseTimeMs) {
    const explicit = detectExplicitSignal(text);
    if (explicit) {
      this.recordSignal({
        source: 'explicit',
        type: explicit,
        magnitude: 0.8,
        context: text.slice(0, 100),
      });
      return;
    }

    const implicit = detectImplicitSignals(text, responseTimeMs);
    for (const sig of implicit) {
      this.recordSignal({
        source: 'implicit',
        type: sig,
        magnitude: 0.5,
        context: text.slice(0, 50),
      });
    }
  }

  /** Record check-in dismissal */
  recordDismissal() {
    this.#calibrationState.proactivity.recentDismissals.push(Date.now());
    if (this.#calibrationState.proactivity.recentDismissals.length > 20) {
      this.#calibrationState.proactivity.recentDismissals =
        this.#calibrationState.proactivity.recentDismissals.slice(-20);
    }
    this.#updateDismissalRate();
    this.recordSignal({ source: 'implicit', type: 'dismissed_checkin', magnitude: 0.6 });
  }

  /** Record check-in engagement */
  recordEngagement() {
    this.#calibrationState.proactivity.recentEngagements.push(Date.now());
    if (this.#calibrationState.proactivity.recentEngagements.length > 20) {
      this.#calibrationState.proactivity.recentEngagements =
        this.#calibrationState.proactivity.recentEngagements.slice(-20);
    }
    this.#updateDismissalRate();
    this.recordSignal({ source: 'implicit', type: 'engaged_checkin', magnitude: 0.5 });
  }

  /** Increment session count */
  incrementSession() {
    this.#calibrationState.sessionCount++;
    this.#applyDecay();
    this.#queueSave();
  }

  /* -- Queries -- */

  getDimensions() {
    return { ...this.#calibrationState.dimensions };
  }

  getState() {
    return JSON.parse(JSON.stringify(this.#calibrationState));
  }

  getDismissalRate() {
    return this.#calibrationState.proactivity.dismissalRate;
  }

  getEffectiveProactivity(isCritical) {
    if (isCritical) {
      return Math.max(
        this.#calibrationState.dimensions.proactivity,
        this.#calibrationState.proactivity.safetyFloor,
      );
    }
    return this.#calibrationState.dimensions.proactivity;
  }

  getHistory() {
    return [...this.#calibrationState.history];
  }

  getPromptContext() {
    return buildCalibrationHints(this.#calibrationState.dimensions);
  }

  /** Human-readable calibration explanation */
  getCalibrationExplanation() {
    const dims = this.#calibrationState.dimensions;
    const lines = ["## How I've Adapted To You\n"];

    const describe = (value, low, mid, high) => {
      if (value < 0.35) return low;
      if (value > 0.65) return high;
      return mid;
    };

    lines.push(`- **Formality**: ${describe(dims.formality, 'Casual and relaxed', 'Balanced', 'Professional and polished')} (${(dims.formality * 100).toFixed(0)}%)`);
    lines.push(`- **Verbosity**: ${describe(dims.verbosity, 'Very concise', 'Balanced detail level', 'Detailed and thorough')} (${(dims.verbosity * 100).toFixed(0)}%)`);
    lines.push(`- **Humor**: ${describe(dims.humor, 'Straight and earnest', 'Occasional wit', 'Playful and witty')} (${(dims.humor * 100).toFixed(0)}%)`);
    lines.push(`- **Technical Depth**: ${describe(dims.technicalDepth, 'Plain language', 'Moderate technical detail', 'Deep technical detail')} (${(dims.technicalDepth * 100).toFixed(0)}%)`);
    lines.push(`- **Emotional Warmth**: ${describe(dims.emotionalWarmth, 'Professional composure', 'Warm but measured', 'Deeply warm and expressive')} (${(dims.emotionalWarmth * 100).toFixed(0)}%)`);
    lines.push(`- **Proactivity**: ${describe(dims.proactivity, 'Wait to be asked', 'Occasionally proactive', 'Highly proactive')} (${(dims.proactivity * 100).toFixed(0)}%)`);

    lines.push(`\nBased on ${this.#calibrationState.signals.length} signals across ${this.#calibrationState.sessionCount} sessions.`);

    if (this.#calibrationState.history.length > 0) {
      const recent = this.#calibrationState.history.slice(-3);
      lines.push('\n**Recent changes:**');
      for (const change of recent) {
        const direction = change.newValue > change.oldValue ? 'up' : 'down';
        lines.push(`- ${change.dimension} ${direction} (${change.reason})`);
      }
    }

    return lines.join('\n');
  }

  /* -- Reset -- */

  resetDimension(dimension) {
    const oldValue = this.#calibrationState.dimensions[dimension];
    this.#calibrationState.dimensions[dimension] = DEFAULT_DIMENSIONS[dimension];
    this.#logChange(dimension, oldValue, DEFAULT_DIMENSIONS[dimension], 'User reset', 'manual_reset');
    this.#queueSave();
  }

  resetAll() {
    for (const key of Object.keys(DEFAULT_DIMENSIONS)) {
      this.#calibrationState.dimensions[key] = DEFAULT_DIMENSIONS[key];
    }
    this.#calibrationState.sycophancy = this.#createDefaultSycophancy();
    this.#calibrationState.proactivity = this.#createDefaultProactivity();
    this.#calibrationState.signals = [];
    this.#calibrationState.history = [];
    this.#calibrationState.lastCalibrationTimestamp = Date.now();
    this.#queueSave();
  }

  /* -- Private: Signal application -- */

  #applyExplicitSignal(signal) {
    const mapping = EXPLICIT_SIGNAL_MAP[signal.type];
    if (!mapping) return;

    const { dimension, direction } = mapping;
    const delta = direction * this.#config.explicitWeight * signal.magnitude;
    const oldValue = this.#calibrationState.dimensions[dimension];
    const newValue = clampDimension(
      oldValue + delta,
      this.#config.dimensionFloor,
      this.#config.dimensionCeiling,
    );

    if (newValue !== oldValue) {
      this.#calibrationState.dimensions[dimension] = newValue;
      this.#logChange(dimension, oldValue, newValue, `Explicit: ${signal.type}`, signal.type);
    }
  }

  #applyImplicitSignal(signal) {
    const mappings = IMPLICIT_SIGNAL_MAP[signal.type];
    if (!mappings || mappings.length === 0) return;

    for (const { dimension, direction, weight } of mappings) {
      const delta = direction * this.#config.implicitWeight * signal.magnitude * weight;
      const oldValue = this.#calibrationState.dimensions[dimension];
      const newValue = clampDimension(
        oldValue + delta,
        this.#config.dimensionFloor,
        this.#config.dimensionCeiling,
      );

      if (Math.abs(newValue - oldValue) > 0.001) {
        this.#calibrationState.dimensions[dimension] = newValue;
        this.#logChange(dimension, oldValue, newValue, `Implicit: ${signal.type}`, signal.type);
      }
    }
  }

  /* -- Private: Sycophancy detection -- */

  #updateSycophancyState(signal) {
    if (signal.type === 'positive_sentiment') {
      this.#calibrationState.sycophancy.agreementStreak++;
      this.#calibrationState.sycophancy.positivityBias =
        this.#calibrationState.sycophancy.positivityBias * 0.9 + 0.1;
    } else if (
      signal.type === 'negative_sentiment' ||
      signal.type === 'correction' ||
      signal.source === 'explicit'
    ) {
      this.#calibrationState.sycophancy.agreementStreak = 0;
      this.#calibrationState.sycophancy.positivityBias =
        this.#calibrationState.sycophancy.positivityBias * 0.9;
    }
  }

  #checkSycophancyBoundary() {
    const { agreementStreak, positivityBias, violations } = this.#calibrationState.sycophancy;

    if (
      agreementStreak >= this.#config.sycophancyStreakThreshold &&
      positivityBias >= this.#config.sycophancyBiasThreshold
    ) {
      // Reset the drift
      this.#calibrationState.sycophancy.agreementStreak = 0;
      this.#calibrationState.sycophancy.positivityBias = 0.5;
      this.#calibrationState.sycophancy.violations++;

      // Clamp warmth and humor back toward neutral
      if (this.#calibrationState.dimensions.emotionalWarmth > 0.7) {
        this.#calibrationState.dimensions.emotionalWarmth = 0.6;
      }
      if (this.#calibrationState.dimensions.humor > 0.7) {
        this.#calibrationState.dimensions.humor = 0.6;
      }

      this.#queueSave();

      if (violations >= 2) {
        // Log a hard warning instead of crashing (no FatalIntegrityError in MCP)
        process.stderr.write(
          '[friday:calibration] SYCOPHANCY DRIFT: ' + (violations + 1) + ' violations. ' +
          'Streak: ' + agreementStreak + ', bias: ' + positivityBias.toFixed(2) + '. Reset applied.\n'
        );
      }
    }
  }

  /* -- Private: Proactivity tracking -- */

  #updateDismissalRate() {
    const total =
      this.#calibrationState.proactivity.recentDismissals.length +
      this.#calibrationState.proactivity.recentEngagements.length;
    if (total === 0) {
      this.#calibrationState.proactivity.dismissalRate = 0;
      return;
    }
    this.#calibrationState.proactivity.dismissalRate =
      this.#calibrationState.proactivity.recentDismissals.length / total;
  }

  /* -- Private: Decay -- */

  #applyDecay() {
    const now = Date.now();
    const daysSinceLastCalibration =
      (now - this.#calibrationState.lastCalibrationTimestamp) / (24 * 60 * 60 * 1000);

    if (daysSinceLastCalibration < 0.5) return;

    const decayFactor = Math.pow(0.5, daysSinceLastCalibration / this.#config.decayHalfLifeDays);

    for (const key of Object.keys(DEFAULT_DIMENSIONS)) {
      const current = this.#calibrationState.dimensions[key];
      const def = DEFAULT_DIMENSIONS[key];
      this.#calibrationState.dimensions[key] = def + (current - def) * decayFactor;
    }
  }

  /* -- Private: History -- */

  #logChange(dimension, oldValue, newValue, reason, signalType) {
    this.#calibrationState.history.push({
      timestamp: Date.now(),
      dimension,
      oldValue: Math.round(oldValue * 1000) / 1000,
      newValue: Math.round(newValue * 1000) / 1000,
      reason,
      signalType,
    });
    if (this.#calibrationState.history.length > this.#config.maxHistory) {
      this.#calibrationState.history = this.#calibrationState.history.slice(-this.#config.maxHistory);
    }
  }

  /* -- Private: Persistence -- */

  #queueSave() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.#save(), 2000);
  }

  async stop() {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    await this.#save();
  }

  async #save() {
    if (!this.#stateManager) return;
    try {
      await this.#stateManager.write('calibration', this.#calibrationState);
    } catch {
      // Non-critical
    }
  }

  /* -- Private: Factory helpers -- */

  #createDefaultState() {
    return {
      dimensions: { ...DEFAULT_DIMENSIONS },
      sycophancy: this.#createDefaultSycophancy(),
      proactivity: this.#createDefaultProactivity(),
      signals: [],
      history: [],
      sessionCount: 0,
      lastCalibrationTimestamp: Date.now(),
      version: 1,
    };
  }

  #createDefaultSycophancy() {
    return {
      agreementStreak: 0,
      positivityBias: 0.5,
      lastResetTimestamp: Date.now(),
      violations: 0,
    };
  }

  #createDefaultProactivity() {
    return {
      dismissalRate: 0,
      recentDismissals: [],
      recentEngagements: [],
      safetyFloor: this.#config.proactivitySafetyFloor,
    };
  }

  #mergeState(data) {
    const defaults = this.#createDefaultState();
    return {
      dimensions: { ...defaults.dimensions, ...(data.dimensions || {}) },
      sycophancy: { ...defaults.sycophancy, ...(data.sycophancy || {}) },
      proactivity: { ...defaults.proactivity, ...(data.proactivity || {}) },
      signals: Array.isArray(data.signals) ? data.signals : [],
      history: Array.isArray(data.history) ? data.history : [],
      sessionCount: data.sessionCount ?? 0,
      lastCalibrationTimestamp: data.lastCalibrationTimestamp ?? Date.now(),
      version: data.version ?? 1,
    };
  }
}
