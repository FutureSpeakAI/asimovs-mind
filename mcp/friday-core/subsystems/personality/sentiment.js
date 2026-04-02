/**
 * Sentiment Analysis Engine — keyword-based mood detection
 *
 * Analyses user messages for emotional tone using pattern heuristics.
 * Tracks mood over time, energy level, and emotional patterns.
 * No LLM dependency for basic sentiment — pure pattern matching.
 *
 * Ported from nexus-os: sentiment.ts. Stripped Electron, fs persistence,
 * EventEmitter. Uses state persistence and eventBus instead.
 */

const MOOD_PATTERNS = [
  // Frustrated / annoyed
  {
    mood: 'frustrated',
    energy: 0.6,
    weight: 0.8,
    keywords: [
      /\b(frustrated|annoyed|irritated|ugh|damn|shit|fuck|bloody|ffs|wtf|broken|stupid|hate this|sick of|fed up|for god'?s? sake)\b/i,
      /\b(doesn'?t work|not working|still broken|keeps? (failing|crashing)|won'?t|can'?t believe)\b/i,
      /!{2,}/,
    ],
  },
  // Stressed / overwhelmed
  {
    mood: 'stressed',
    energy: 0.4,
    weight: 0.75,
    keywords: [
      /\b(stressed|overwhelmed|too much|swamped|drowning|deadline|behind|pressure|panic|anxiety|anxious|worried)\b/i,
      /\b(running out of time|not enough time|so much to do|can'?t keep up)\b/i,
    ],
  },
  // Tired / low energy
  {
    mood: 'tired',
    energy: 0.2,
    weight: 0.7,
    keywords: [
      /\b(tired|exhausted|knackered|shattered|drained|sleepy|wiped|burned? out|burnout|long day|need (a |some )?sleep|need (a |some )?rest|zonked)\b/i,
      /\b(barely awake|can'?t think|brain is fried|running on fumes)\b/i,
    ],
  },
  // Excited / high energy positive
  {
    mood: 'excited',
    energy: 0.95,
    weight: 0.8,
    keywords: [
      /\b(excited|amazing|incredible|brilliant|love it|perfect|yes!|nailed it|awesome|fantastic|can'?t wait|let'?s go|holy shit)\b/i,
      /\b(this is (great|huge|massive)|blew my mind|game.?changer)\b/i,
      /!{2,}.*(!|\?)/,
    ],
  },
  // Positive / warm
  {
    mood: 'positive',
    energy: 0.7,
    weight: 0.6,
    keywords: [
      /\b(thanks?|thank you|great|good|nice|happy|pleased|glad|cool|sweet|lovely|cheers|appreciate|helpful|working|works)\b/i,
      /\b(well done|good job|looks? good|that'?s right|exactly|perfect)\b/i,
      /(?:^|\s)[;:]-?\)/,
    ],
  },
  // Curious / exploratory
  {
    mood: 'curious',
    energy: 0.65,
    weight: 0.5,
    keywords: [
      /\b(wondering|curious|what if|how (would|could|does|do)|why (does|do|is|are)|interesting|tell me (more|about)|explore|investigate|dig into)\b/i,
      /\b(could we|what about|have you (thought|considered)|I'?m thinking)\b/i,
    ],
  },
  // Focused / deep work
  {
    mood: 'focused',
    energy: 0.75,
    weight: 0.45,
    keywords: [
      /\b(ok (so|let'?s|now)|right(,| so)|next|continue|moving on|let'?s (do|get|start|move)|focus on|back to|anyway)\b/i,
      /\b(implement|build|create|write|code|fix|refactor|deploy|ship)\b/i,
    ],
  },
];

const MAX_LOG_SIZE = 500;

const MOOD_DESCRIPTIONS = {
  positive: 'in a good mood',
  neutral: 'in a neutral state',
  frustrated: 'frustrated or annoyed',
  tired: 'tired or low energy',
  excited: 'excited and high energy',
  stressed: 'stressed or under pressure',
  curious: 'in an exploratory, curious mood',
  focused: 'in deep focus mode',
};

export class SentimentEngine {
  #currentState = {
    currentMood: 'neutral',
    confidence: 0,
    energyLevel: 0.5,
    moodStreak: 0,
    lastAnalysed: 0,
  };
  #moodLog = [];
  #state = null;  // subsystem state namespace
  #eventBus = null;

  async initialize(state, eventBus) {
    this.#state = state;
    this.#eventBus = eventBus;

    const result = await state.read('mood_log');
    if (result?.success && Array.isArray(result.data)) {
      this.#moodLog = result.data.slice(-MAX_LOG_SIZE);
    }
  }

  /**
   * Analyse a user message and update sentiment state.
   * Returns the detected mood.
   */
  analyse(text) {
    if (!text || text.trim().length < 2) return this.#currentState.currentMood;

    const previousMood = this.#currentState.currentMood;
    const previousEnergy = this.#currentState.energyLevel;

    let bestMood = 'neutral';
    let bestScore = 0;
    let bestEnergy = 0.5;
    let trigger = '';

    for (const pattern of MOOD_PATTERNS) {
      let matches = 0;
      for (const kw of pattern.keywords) {
        const match = text.match(kw);
        if (match) {
          matches++;
          if (!trigger && match[0]) {
            trigger = match[0].slice(0, 30);
          }
        }
      }

      if (matches > 0) {
        const score = Math.min(pattern.weight, pattern.weight * (matches / pattern.keywords.length) + 0.2);
        if (score > bestScore) {
          bestScore = score;
          bestMood = pattern.mood;
          bestEnergy = pattern.energy;
        }
      }
    }

    // Time-of-day energy modulation
    const hour = new Date().getHours();
    if (hour >= 23 || hour < 6) {
      bestEnergy = Math.min(bestEnergy, 0.35);
    } else if (hour >= 6 && hour < 9) {
      bestEnergy *= 0.85;
    }

    // Update streak
    if (bestMood === this.#currentState.currentMood) {
      this.#currentState.moodStreak++;
    } else {
      this.#currentState.moodStreak = 1;
    }

    // Smooth energy transitions (exponential moving average)
    this.#currentState.energyLevel = this.#currentState.energyLevel * 0.6 + bestEnergy * 0.4;
    this.#currentState.currentMood = bestMood;
    this.#currentState.confidence = bestScore;
    this.#currentState.lastAnalysed = Date.now();

    // Log entry
    const entry = {
      mood: bestMood,
      confidence: bestScore,
      energy: this.#currentState.energyLevel,
      timestamp: Date.now(),
      trigger: trigger || undefined,
    };
    this.#moodLog.push(entry);

    if (this.#moodLog.length > MAX_LOG_SIZE) {
      this.#moodLog = this.#moodLog.slice(-MAX_LOG_SIZE);
    }
    this.#persistLog();

    // Emit mood change event
    if (bestMood !== previousMood || Math.abs(this.#currentState.energyLevel - previousEnergy) > 0.05) {
      if (this.#eventBus) {
        this.#eventBus.emit('sentiment:mood_change', this.getState());
      }
    }

    return bestMood;
  }

  getState() {
    return { ...this.#currentState };
  }

  getMoodLog() {
    return [...this.#moodLog];
  }

  /**
   * Build a context string for injection into the system prompt.
   */
  getContextString(userName = 'The user') {
    if (!this.#currentState.lastAnalysed) return '';

    const parts = ['## Emotional Context'];

    parts.push(`- ${userName} seems ${MOOD_DESCRIPTIONS[this.#currentState.currentMood]}`);

    if (this.#currentState.moodStreak > 3) {
      parts.push(`- This mood has been consistent for ${this.#currentState.moodStreak} messages`);
    }

    if (this.#currentState.energyLevel < 0.3) {
      parts.push('- Energy level: low');
    } else if (this.#currentState.energyLevel > 0.8) {
      parts.push('- Energy level: high');
    }

    const recent = this.#moodLog.slice(-5);
    if (recent.length >= 3) {
      const moods = recent.map((e) => e.mood);
      const uniqueMoods = new Set(moods);
      if (uniqueMoods.size === 1 && moods[0] !== 'neutral') {
        parts.push(`- Mood has been consistently ${moods[0]} recently`);
      } else if (
        recent.length >= 3 &&
        recent[recent.length - 1].energy < recent[0].energy - 0.2
      ) {
        parts.push('- Energy has been declining over recent messages');
      }
    }

    return parts.join('\n');
  }

  async #persistLog() {
    if (!this.#state) return;
    try {
      await this.#state.write('mood_log', this.#moodLog);
    } catch {
      // Non-critical
    }
  }
}
