/**
 * Personality Subsystem — Friday's identity, adaptive style, sentiment, evolution
 *
 * Tools: personality_profile, personality_calibrate, personality_mood,
 *        personality_evolve, personality_self_knowledge, personality_sentiment
 *
 * Combines:
 *   - Profile: name, mode, traits, tone, values, backstory
 *   - Calibration: 6 adaptive style dimensions with anti-sycophancy
 *   - Sentiment: keyword-based mood detection and tracking
 *   - Evolution: trait-based personality maturation over sessions
 *
 * Ported from nexus-os: personality.ts, personality-calibration.ts,
 * personality-evolution.ts, psychological-profile.ts, sentiment.ts.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { PersonalityProfile } from './profile.js';
import { CalibrationEngine } from './calibration.js';
import { SentimentEngine } from './sentiment.js';
import { PersonalityEvolution } from './evolution.js';

// Sycophancy risk -> challenge level mapping
const SYCOPHANCY_CHALLENGE_MAP = {
  highest: 5,
  high: 4,
  moderate: 3,
  low: 2,
  unknown: 3,
};

const MAX_PERSONALITY_HISTORY = 20;

export class PersonalitySubsystem extends Subsystem {
  #profile;
  #calibration;
  #sentiment;
  #evolution;

  /** Set by wiring.js -- epistemic independence tracker */
  epistemicTracker = null;

  constructor(deps) {
    super('personality', deps);
    this.#profile = new PersonalityProfile();
    this.#calibration = new CalibrationEngine();
    this.#sentiment = new SentimentEngine();
    this.#evolution = new PersonalityEvolution();
  }

  async start() {
    await this.#profile.initialize(this.state);
    await this.#calibration.initialize(this.state);
    await this.#sentiment.initialize(this.state, this.eventBus);
    await this.#evolution.initialize(this.state);

    // Increment session count on start
    this.#calibration.incrementSession();
    const profile = this.#profile.getProfile();
    await this.#evolution.incrementSession(profile.traits);

    // Mother Signal Bridge: load user-profile and calibrate challenge level
    await this.#applyMotherSignal();

    await super.start();
    this.log.info(`Personality loaded: ${profile.name} (mode: ${profile.mode})`);
  }

  /**
   * Read user-profile from vault root, extract mother_signal.sycophancy_risk,
   * map to challenge level, and merge user preferences into personality.
   */
  async #applyMotherSignal() {
    try {
      // Read from vault root (not namespaced)
      const vault = this.state?.constructor?.name === 'Object' ? null : this.vault;
      if (!vault) return;

      const result = await vault.read('user-profile');
      const userProfile = result?.success ? result.data : result;
      if (!userProfile) return;

      // Extract sycophancy risk and map to challenge level
      const risk = userProfile.mother_signal?.sycophancy_risk || 'unknown';
      const challengeLevel = SYCOPHANCY_CHALLENGE_MAP[risk] || 3;
      await this.#profile.updateProfile({ challengeLevel });
      this.log.info(`Mother signal: sycophancy_risk=${risk} -> challengeLevel=${challengeLevel}`);

      // Merge user preferences into personality if they exist
      const prefs = userProfile.preferences || {};
      const prefKeys = ['stuck_behavior', 'error_handling', 'quality_vs_speed', 'anti_patterns'];
      const toMerge = {};
      for (const key of prefKeys) {
        if (prefs[key] !== undefined) toMerge[key] = prefs[key];
      }
      if (Object.keys(toMerge).length > 0) {
        const current = this.#profile.getProfile();
        await this.#profile.updateProfile({
          ...current,
          userPreferences: { ...(current.userPreferences || {}), ...toMerge },
        });
        this.log.info(`Merged user preferences: ${Object.keys(toMerge).join(', ')}`);
      }
    } catch (err) {
      this.log.warn(`Mother signal load failed: ${err.message}`);
    }
  }

  /**
   * Personality versioning: snapshot current profile before overwriting.
   * Keeps a rolling history of max 20 versions.
   */
  async #snapshotVersion() {
    try {
      if (!this.state) return;
      const currentProfile = this.#profile.getProfile();
      const historyResult = await this.state.read('personality-history');
      const history = (historyResult?.success ? historyResult.data : historyResult) || [];
      const versions = Array.isArray(history) ? history : [];

      versions.push({
        profile: currentProfile,
        savedAt: Date.now(),
      });

      // Cap at MAX_PERSONALITY_HISTORY
      while (versions.length > MAX_PERSONALITY_HISTORY) {
        versions.shift();
      }

      await this.state.write('personality-history', versions);
    } catch (err) {
      this.log.warn(`Personality version snapshot failed: ${err.message}`);
    }
  }

  async stop() {
    // Snapshot current personality version before shutdown
    await this.#snapshotVersion();
    await this.#calibration.stop();
    await super.stop();
  }

  registerEvents() {
    // Process every user message for sentiment + calibration
    this.eventBus.on('message:user', (data) => {
      if (data.text) {
        this.#sentiment.analyse(data.text);
        this.#calibration.processUserMessage(data.text, data.responseTimeMs);
      }
    });

    // On vault:unlocked, re-apply mother signal (in case vault was locked during start)
    this.eventBus.on('vault:unlocked', async () => {
      try {
        await this.#applyMotherSignal();
      } catch (err) {
        this.log.warn(`Mother signal re-apply on unlock failed: ${err.message}`);
      }
    });
  }

  /** Expose components for other subsystems */
  get profile() { return this.#profile; }
  get calibration() { return this.#calibration; }
  get sentiment() { return this.#sentiment; }
  get evolution() { return this.#evolution; }

  registerTools(server) {
    const profile = this.#profile;
    const calibration = this.#calibration;
    const sentiment = this.#sentiment;
    const evolution = this.#evolution;

    // -- personality_profile -----------------------------------------------

    server.tool(
      'personality_profile',
      'Get or update the agent personality profile. Shows name, mode, traits, tone, challenge level. Pass updates to modify.',
      {
        updates: z.object({
          name: z.string().optional(),
          userName: z.string().optional(),
          mode: z.enum(['partner', 'focus', 'teacher', 'creative', 'sentinel']).optional(),
          traits: z.array(z.string()).optional(),
          tone: z.string().optional(),
          backstory: z.string().optional(),
          identityLine: z.string().optional(),
          challengeLevel: z.number().int().min(1).max(5).optional(),
        }).optional().describe('Optional profile updates. Omit to just read.'),
      },
      async ({ updates }) => {
        if (updates && Object.keys(updates).length > 0) {
          await profile.updateProfile(updates);
        }

        const current = profile.getProfile();
        const condensed = profile.getCondensedProfile();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              profile: current,
              summary: condensed.summary,
            }, null, 2)
          }]
        };
      }
    );

    // -- personality_calibrate ---------------------------------------------

    server.tool(
      'personality_calibrate',
      'View or adjust personality calibration. Shows 6 adaptive style dimensions (formality, verbosity, humor, technicalDepth, emotionalWarmth, proactivity). Can reset a dimension or all.',
      {
        action: z.enum(['view', 'reset_dimension', 'reset_all']).default('view')
          .describe('Action: view current state, reset one dimension, or reset all'),
        dimension: z.enum(['formality', 'verbosity', 'humor', 'technicalDepth', 'emotionalWarmth', 'proactivity'])
          .optional()
          .describe('Dimension to reset (for reset_dimension action)'),
      },
      async ({ action, dimension }) => {
        if (action === 'reset_all') {
          calibration.resetAll();
          return {
            content: [{ type: 'text', text: JSON.stringify({ action: 'reset_all', dimensions: calibration.getDimensions() }) }]
          };
        }

        if (action === 'reset_dimension' && dimension) {
          calibration.resetDimension(dimension);
          return {
            content: [{ type: 'text', text: JSON.stringify({ action: 'reset_dimension', dimension, dimensions: calibration.getDimensions() }) }]
          };
        }

        // View
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              dimensions: calibration.getDimensions(),
              explanation: calibration.getCalibrationExplanation(),
              promptContext: calibration.getPromptContext(),
              history: calibration.getHistory().slice(-5),
            }, null, 2)
          }]
        };
      }
    );

    // -- personality_mood ---------------------------------------------------

    server.tool(
      'personality_mood',
      "Get the current detected mood and energy level, based on analysis of recent user messages.",
      {},
      async () => {
        const state = sentiment.getState();
        const p = profile.getProfile();
        const context = sentiment.getContextString(p.userName);
        const log = sentiment.getMoodLog().slice(-10);

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              currentMood: state.currentMood,
              confidence: state.confidence,
              energyLevel: state.energyLevel,
              moodStreak: state.moodStreak,
              contextBlock: context,
              recentLog: log.map((e) => ({
                mood: e.mood,
                energy: e.energy.toFixed(2),
                trigger: e.trigger,
                timestamp: e.timestamp,
              })),
            }, null, 2)
          }]
        };
      }
    );

    // -- personality_evolve -------------------------------------------------

    server.tool(
      'personality_evolve',
      'View personality evolution state. Shows how the personality has developed over sessions based on traits.',
      {},
      async () => {
        const evoState = evolution.getEvolutionState();
        const p = profile.getProfile();
        const description = evolution.getSelfDescription();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              evolution: evoState,
              maturity: evoState ? evolution.getMaturityFactor(evoState.sessionCount) : 0,
              selfDescription: description,
              traits: p.traits,
            }, null, 2)
          }]
        };
      }
    );

    // -- personality_self_knowledge -----------------------------------------

    server.tool(
      'personality_self_knowledge',
      "Get Friday's self-knowledge: who I am, how I've adapted, my current emotional read, my evolution. For introspection.",
      {},
      async () => {
        const p = profile.getProfile();
        const condensed = profile.getCondensedProfile();
        const dims = calibration.getDimensions();
        const calExplanation = calibration.getCalibrationExplanation();
        const sentState = sentiment.getState();
        const evoState = evolution.getEvolutionState();
        const evoDescription = evolution.getSelfDescription();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              identity: {
                name: p.name,
                userName: p.userName,
                mode: p.mode,
                traits: p.traits,
                challengeLevel: p.challengeLevel,
                summary: condensed.summary,
              },
              calibration: {
                dimensions: dims,
                explanation: calExplanation,
              },
              currentMood: {
                mood: sentState.currentMood,
                energy: sentState.energyLevel,
                streak: sentState.moodStreak,
              },
              evolution: {
                state: evoState,
                description: evoDescription,
              },
            }, null, 2)
          }]
        };
      }
    );

    // -- personality_sentiment ----------------------------------------------

    server.tool(
      'personality_sentiment',
      'Analyse a specific text for sentiment/mood. Returns detected mood, confidence, and energy without updating internal state.',
      {
        text: z.string().max(50000).describe('Text to analyse for sentiment'),
      },
      async ({ text }) => {
        // Create a temporary engine to analyse without side effects
        const tempEngine = new SentimentEngine();
        const mood = tempEngine.analyse(text);
        const state = tempEngine.getState();

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              text: text.slice(0, 100),
              detectedMood: mood,
              confidence: state.confidence,
              energy: state.energyLevel,
            })
          }]
        };
      }
    );
  }
}
