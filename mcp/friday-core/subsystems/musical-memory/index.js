/**
 * Musical Memory Subsystem -- Emotional arc orchestration through music.
 *
 * Tools (6):
 *   musical_memory_vibe       -- Set session emotional baseline
 *   musical_memory_add_song   -- Add a song to the operator's library
 *   musical_memory_search     -- Search songs by text/valence
 *   musical_memory_mode       -- View or override current arc mode
 *   musical_memory_arc        -- Get full session emotional arc
 *   musical_memory_status     -- System status dashboard
 *
 * Reads mood data from the sentiment engine (via sentiment:mood_change),
 * monitors agent completions for milestones and frustration, and composes
 * musical context injections for inter-agent messaging.
 *
 * Based on Anthropic's April 2026 emotion concepts research paper:
 * emotion vectors are local (not persistent), so musical context must be
 * interleaved with work to have effect -- not front-loaded or appended.
 *
 * The operator sets the baseline because they're the origin of everything
 * that follows. Their state at the start of a session is the initial
 * condition from which the entire emotional arc unfolds.
 */

import { z } from 'zod';
import { Subsystem } from '../../core/subsystem.js';
import { SongStore } from './song-store.js';
import { EmotionalArcTracker } from './arc-tracker.js';
import { FrustrationDetector } from './frustration-detector.js';
import { InjectionComposer } from './injection-composer.js';

const VIBE_VALUES = ['energized', 'focused', 'melancholy', 'chill', 'angry', 'joyful'];
const VALENCE_VALUES = ['uplifting', 'neutral', 'melancholy', 'intense', 'calming'];
const _MODE_VALUES = ['mirror', 'shift', 'celebration'];

export class MusicalMemorySubsystem extends Subsystem {
  #songStore;
  #arcTracker;
  #frustrationDetector;
  #injectionComposer;
  #active = false; // true when operator has set a vibe this session
  #lastInjection = null;

  constructor(deps) {
    super('musical-memory', deps);
    this.#songStore = new SongStore();
    this.#arcTracker = new EmotionalArcTracker();
    this.#frustrationDetector = new FrustrationDetector();
    this.#injectionComposer = new InjectionComposer();
  }

  async start() {
    await this.#songStore.initialize(this.state);
    this.#arcTracker.initialize(this.eventBus);
    await super.start();
    this.log.info(`Musical Memory started: ${this.#songStore.size} songs in library`);
  }

  async stop() {
    await this.#songStore.stop();
    this.#arcTracker.reset();
    this.#frustrationDetector.reset();
    this.#active = false;
    this.#lastInjection = null;
    await super.stop();
  }

  // -- Public API for session conductor --

  /**
   * Generate the session-start prompt asking the operator about their vibe.
   * Returns null if the subsystem should stay silent (no songs yet on first use).
   */
  getSessionPrompt() {
    const songCount = this.#songStore.size;
    if (songCount === 0) {
      return 'Before we dive in -- what kind of music are you feeling right now? Drop me a song, an artist, a vibe, whatever comes to mind. I\'ll build from there.';
    }
    return `What's the soundtrack today? You've got ${songCount} songs in your Musical Memory. Share a track that matches where your head is at and we'll build from there.`;
  }

  /**
   * Get the current musical injection for agent context, if one is active.
   * Called by wiring.js when agents are spawned.
   */
  getActiveInjection() {
    if (!this.#active || !this.#arcTracker.isActive) return null;

    const mode = this.#arcTracker.currentMode;
    const valence = this.#arcTracker.currentValence;
    const song = this.#songStore.selectForMode(mode, valence);
    if (!song) return null;

    const injection = this.#injectionComposer.compose({
      mode,
      song,
      trigger: this.#arcTracker.getArcState().escalationTrajectory,
      arcPosition: this.#getArcPosition(),
    });

    if (injection) {
      this.#songStore.incrementPlayCount(song.id);
      this.#arcTracker.recordInjection();
      this.#lastInjection = injection;
    }

    return injection;
  }

  // -- Event handlers (called from wiring.js) --

  /**
   * Handle mood change from sentiment engine.
   */
  onMoodChange(data) {
    if (!this.#active) return;
    const mood = data?.mood || data?.data?.mood;
    const energy = data?.energyLevel ?? data?.data?.energyLevel ?? 0.5;
    if (mood) {
      this.#arcTracker.updateMood(mood, energy);
      this.#frustrationDetector.recordMoodChange({ mood, energyLevel: energy });
      this.#arcTracker.updateFrustration(this.#frustrationDetector.score);
    }
  }

  /**
   * Handle agent completion for milestone detection and frustration tracking.
   */
  onAgentCompleted(data) {
    if (!this.#active) return;
    const completionData = data?.data || data;
    const success = completionData?.success !== false;

    this.#frustrationDetector.recordAgentCompletion({
      success,
      output: completionData?.summary || completionData?.description || '',
      error: completionData?.error || '',
    });

    this.#arcTracker.updateFrustration(this.#frustrationDetector.score);
    this.#arcTracker.checkMilestone(completionData);
  }

  /**
   * Handle agent failure for frustration tracking.
   */
  onAgentFailed(data) {
    if (!this.#active) return;
    this.#frustrationDetector.recordAgentCompletion({
      success: false,
      output: '',
      error: data?.data?.error || data?.error || '',
    });
    this.#arcTracker.updateFrustration(this.#frustrationDetector.score);
  }

  // -- Internal --

  #getArcPosition() {
    const arc = this.#arcTracker.getArcState();
    const trajectory = arc.escalationTrajectory;
    if (trajectory === 'rising') return 'early';
    if (trajectory === 'sustained') return 'sustained';
    if (trajectory === 'de-escalating') return 'resolving';
    if (trajectory === 'resolved') return 'resolved';
    return 'developing';
  }

  // -- MCP Tools --

  registerTools(server) {
    const self = this;

    // -- musical_memory_vibe --
    server.tool(
      'musical_memory_vibe',
      'Set the session\'s musical vibe baseline. Called in response to the session-start prompt. This establishes the emotional starting point for the arc.',
      {
        vibe: z.enum(VIBE_VALUES).describe('Current emotional vibe'),
        song: z.object({
          title: z.string().max(200),
          artist: z.string().max(200),
          link: z.string().max(500).optional(),
          tags: z.array(z.string().max(50)).max(10).optional(),
        }).optional().describe('Optional song to associate with this vibe'),
      },
      async ({ vibe, song }) => {
        self.#arcTracker.setSessionVibe(vibe, song?.tags);
        self.#active = true;

        if (song) {
          self.#songStore.add({
            title: song.title,
            artist: song.artist,
            link: song.link,
            tags: [...(song.tags || []), vibe],
            emotional_valence: self.#vibeToValence(vibe),
          });
        }

        if (self.eventBus) {
          self.eventBus.publish('musical-memory:baseline-set', {
            vibe,
            songCount: self.#songStore.size,
            timestamp: Date.now(),
          });
        }

        return { content: [{ type: 'text', text: JSON.stringify({
          vibeSet: vibe,
          mode: 'mirror',
          songCount: self.#songStore.size,
          message: `Musical Memory activated. Starting in mirror mode, building from ${vibe} energy.`,
        }, null, 2) }] };
      }
    );

    // -- musical_memory_add_song --
    server.tool(
      'musical_memory_add_song',
      'Add a song to the operator\'s personal Musical Memory library.',
      {
        title: z.string().max(200).describe('Song title'),
        artist: z.string().max(200).describe('Artist or band name'),
        link: z.string().max(500).optional().describe('URL where the operator listens (Spotify, YouTube, etc.)'),
        lines: z.array(z.string().max(500)).max(20).optional().describe('Favorite lines from the song (operator-supplied)'),
        chords: z.string().max(2000).optional().describe('Chord progression'),
        tags: z.array(z.string().max(50)).max(20).optional().describe('Emotional tags (e.g. energy, calm, defiance, grit, joy)'),
        emotional_valence: z.enum(VALENCE_VALUES).optional().describe('Overall emotional character'),
      },
      async ({ title, artist, link, lines, chords, tags, emotional_valence }) => {
        const song = self.#songStore.add({ title, artist, link, lines, chords, tags, emotional_valence });
        if (!song) {
          return { content: [{ type: 'text', text: JSON.stringify({ added: false, reason: 'Title and artist are required' }) }] };
        }

        // If Musical Memory is active and operator is adding a song, treat as recalibration
        if (self.#active && tags?.length) {
          const dominantVibe = tags[0];
          if (VIBE_VALUES.includes(dominantVibe)) {
            self.#arcTracker.recalibrate(dominantVibe);
          }
        }

        return { content: [{ type: 'text', text: JSON.stringify({
          added: true,
          song: { id: song.id, title: song.title, artist: song.artist, tags: song.tags },
          librarySize: self.#songStore.size,
        }, null, 2) }] };
      }
    );

    // -- musical_memory_search --
    server.tool(
      'musical_memory_search',
      'Search the operator\'s Musical Memory song library.',
      {
        query: z.string().max(500).optional().describe('Text to search for in titles, artists, tags'),
        valence: z.enum(VALENCE_VALUES).optional().describe('Filter by emotional valence'),
        limit: z.number().int().min(1).max(50).default(5).describe('Max results'),
      },
      async ({ query, valence, limit }) => {
        const results = self.#songStore.search(query, valence, limit);
        return { content: [{ type: 'text', text: JSON.stringify({
          count: results.length,
          results: results.map(s => ({
            id: s.id, title: s.title, artist: s.artist,
            tags: s.tags, valence: s.emotional_valence,
            link: s.link, playCount: s.playCount,
          })),
        }, null, 2) }] };
      }
    );

    // -- musical_memory_mode --
    server.tool(
      'musical_memory_mode',
      'View or override the current Musical Memory arc mode. Modes: mirror (reflect state), shift (lean toward resolution), celebration (milestone reinforcement), auto (let the system decide).',
      {
        action: z.enum(['get', 'force_mirror', 'force_shift', 'force_celebration', 'auto'])
          .default('get').describe('Action to perform'),
      },
      async ({ action }) => {
        if (action === 'get') {
          return { content: [{ type: 'text', text: JSON.stringify({
            currentMode: self.#arcTracker.currentMode || 'inactive',
            currentValence: self.#arcTracker.currentValence,
            active: self.#active,
          }, null, 2) }] };
        }

        const modeMap = {
          force_mirror: 'mirror', force_shift: 'shift', force_celebration: 'celebration', auto: 'auto',
        };
        const newMode = self.#arcTracker.forceMode(modeMap[action]);
        return { content: [{ type: 'text', text: JSON.stringify({
          mode: newMode,
          forced: action !== 'auto',
        }, null, 2) }] };
      }
    );

    // -- musical_memory_arc --
    server.tool(
      'musical_memory_arc',
      'Get the full session emotional arc: mode history, current mode, injection count, frustration level, trajectory.',
      {},
      async () => {
        const arc = self.#arcTracker.getArcState();
        const frustration = self.#frustrationDetector.getState();
        return { content: [{ type: 'text', text: JSON.stringify({
          ...arc,
          frustration,
          lastInjection: self.#lastInjection ? {
            mode: self.#lastInjection.mode,
            song: self.#lastInjection.songReference,
            composedAt: self.#lastInjection.composedAt,
          } : null,
        }, null, 2) }] };
      }
    );

    // -- musical_memory_status --
    server.tool(
      'musical_memory_status',
      'Musical Memory system status: song count, arc state, active mode, last injection.',
      {},
      async () => {
        return { content: [{ type: 'text', text: JSON.stringify({
          active: self.#active,
          songCount: self.#songStore.size,
          currentMode: self.#arcTracker.currentMode || 'inactive',
          currentValence: self.#arcTracker.currentValence,
          injectionCount: self.#arcTracker.injectionCount,
          milestoneCount: self.#arcTracker.milestoneCount,
          frustrationScore: self.#frustrationDetector.score,
          sessionVibe: self.#arcTracker.sessionVibe,
          lastInjection: self.#lastInjection ? {
            mode: self.#lastInjection.mode,
            song: self.#lastInjection.songReference?.title,
            at: self.#lastInjection.composedAt,
          } : null,
        }, null, 2) }] };
      }
    );
  }

  registerEvents() {
    // Events are wired through wiring.js, not here.
    // This method is intentionally empty -- all event routing goes
    // through the central wiring module for auditability.
  }

  // -- Helpers --

  #vibeToValence(vibe) {
    const map = {
      energized: 'uplifting', focused: 'neutral', melancholy: 'melancholy',
      chill: 'calming', angry: 'intense', joyful: 'uplifting',
    };
    return map[vibe] || 'neutral';
  }
}
