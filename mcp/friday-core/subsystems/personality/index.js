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

export class PersonalitySubsystem extends Subsystem {
  #profile;
  #calibration;
  #sentiment;
  #evolution;

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

    await super.start();
    this.log.info(`Personality loaded: ${profile.name} (mode: ${profile.mode})`);
  }

  async stop() {
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

    // Idle check-in reactions
    this.eventBus.on('checkin:dismissed', () => this.#calibration.recordDismissal());
    this.eventBus.on('checkin:engaged', () => this.#calibration.recordEngagement());
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
        text: z.string().describe('Text to analyse for sentiment'),
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
