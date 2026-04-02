/**
 * Episodic Memory — Session-based episode tracking
 *
 * Records timestamped session episodes with summaries, topics,
 * emotional tone, and key decisions. Episodes are created when
 * a session ends via memory_episode_end.
 *
 * Ported from nexus-os episodic-memory.ts -- stripped of Electron,
 * Obsidian vault sync, settings manager, LLM client (summarization
 * is now the caller's responsibility), and relationship memory.
 */

import crypto from 'node:crypto';

const MAX_EPISODES = 200;

/**
 * @typedef {Object} Episode
 * @property {string} id
 * @property {string} title
 * @property {number} startTime
 * @property {number} endTime
 * @property {number} durationSeconds
 * @property {string} summary
 * @property {string[]} topics
 * @property {string} emotionalTone
 * @property {string[]} keyDecisions
 * @property {number} turnCount
 * @property {Array<{role: string, text: string}>} [observations]
 */

export class EpisodicMemory {
  /** @type {Episode[]} */
  #episodes = [];

  /** @type {Episode|null} Current active episode */
  #active = null;

  /** @type {Array<{role: string, text: string}>} Observations in current episode */
  #observations = [];

  /** @type {object|null} Namespaced state accessor */
  #state = null;

  /** @type {import('./search.js').SemanticSearchEngine|null} */
  #search = null;

  /**
   * @param {object} state - Namespaced state accessor (read/write)
   * @param {import('./search.js').SemanticSearchEngine} search - Semantic search engine
   */
  async initialize(state, search) {
    this.#state = state;
    this.#search = search;
    await this.#load();
    process.stderr.write(`[EpisodicMemory] Loaded ${this.#episodes.length} episodes\n`);
  }

  // -- Accessors -------------------------------------------------------

  getAll() { return [...this.#episodes]; }

  getById(id) { return this.#episodes.find(e => e.id === id) || null; }

  getRecent(count = 5) { return this.#episodes.slice(-count); }

  isRecording() { return this.#active !== null; }

  getActiveEpisode() { return this.#active; }

  // -- Episode lifecycle -----------------------------------------------

  /**
   * Begin recording a new episode.
   * @param {string} title - Episode title
   * @returns {Episode} The new active episode
   */
  startEpisode(title) {
    if (this.#active) {
      process.stderr.write('[friday:episodic] Episode already in progress, ending it first\n');
      // Auto-end the previous without summary
      this.#finalizeEpisode('Auto-ended: new episode started');
    }

    this.#active = {
      id: crypto.randomUUID(),
      title,
      startTime: Date.now(),
      endTime: 0,
      durationSeconds: 0,
      summary: '',
      topics: [],
      emotionalTone: 'neutral',
      keyDecisions: [],
      turnCount: 0,
    };
    this.#observations = [];

    process.stderr.write(`[EpisodicMemory] Started episode: "${title}"\n`);
    return { ...this.#active };
  }

  /**
   * Record an observation during the active episode.
   */
  addObservation(role, text) {
    if (!this.#active) return;
    this.#observations.push({ role, text });
    this.#active.turnCount = this.#observations.length;
  }

  /**
   * End the active episode and store it.
   * @param {string} summary - Summary of what happened
   * @param {object} [meta] - Optional metadata: topics, emotionalTone, keyDecisions
   * @returns {Episode|null}
   */
  async endEpisode(summary, meta = {}) {
    if (!this.#active) {
      process.stderr.write('[friday:episodic] No active episode to end\n');
      return null;
    }

    this.#active.summary = summary;
    this.#active.topics = meta.topics || [];
    this.#active.emotionalTone = meta.emotionalTone || 'neutral';
    this.#active.keyDecisions = meta.keyDecisions || [];

    const episode = this.#finalizeEpisode(summary);
    return episode;
  }

  // -- Search ----------------------------------------------------------

  /**
   * Search episodes by text. Matches against summary, topics, decisions.
   */
  search(query, maxResults = 10) {
    const q = query.toLowerCase();

    const scored = this.#episodes.map(ep => {
      let score = 0;

      if (ep.summary.toLowerCase().includes(q)) score += 10;
      if (ep.title && ep.title.toLowerCase().includes(q)) score += 8;

      for (const topic of ep.topics) {
        if (topic.toLowerCase().includes(q)) score += 5;
      }

      for (const decision of ep.keyDecisions) {
        if (decision.toLowerCase().includes(q)) score += 4;
      }

      // Recency bonus
      const ageHours = (Date.now() - ep.endTime) / (1000 * 60 * 60);
      if (ageHours < 24) score += 3;
      else if (ageHours < 168) score += 1;

      return { episode: ep, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

    return scored.map(s => s.episode);
  }

  // -- Delete ----------------------------------------------------------

  async deleteEpisode(id) {
    const before = this.#episodes.length;
    this.#episodes = this.#episodes.filter(e => e.id !== id);

    if (this.#episodes.length < before) {
      await this.#save();
      if (this.#search) this.#search.remove(id);
      return true;
    }
    return false;
  }

  // -- Context for LLM injection --------------------------------------

  getContextString() {
    const recent = this.getRecent(5);
    if (recent.length === 0) return '';

    const lines = recent.map(ep => {
      const when = this.#formatTimeAgo(ep.endTime);
      const topics = ep.topics.length > 0 ? ` [${ep.topics.join(', ')}]` : '';
      return `- ${when}: ${ep.summary}${topics}`;
    });

    return `## Recent Episodes\n${lines.join('\n')}`;
  }

  // -- Status ----------------------------------------------------------

  status() {
    return {
      totalEpisodes: this.#episodes.length,
      recording: this.#active !== null,
      activeEpisode: this.#active ? { id: this.#active.id, title: this.#active.title, turnCount: this.#active.turnCount } : null,
      oldest: this.#episodes.length > 0 ? new Date(this.#episodes[0].startTime).toISOString() : null,
      newest: this.#episodes.length > 0 ? new Date(this.#episodes[this.#episodes.length - 1].startTime).toISOString() : null,
    };
  }

  // -- Internal --------------------------------------------------------

  #finalizeEpisode(summary) {
    if (!this.#active) return null;

    this.#active.endTime = Date.now();
    this.#active.durationSeconds = Math.round((this.#active.endTime - this.#active.startTime) / 1000);
    this.#active.summary = summary;

    const episode = { ...this.#active };
    this.#episodes.push(episode);

    // Cap at max
    if (this.#episodes.length > MAX_EPISODES) {
      this.#episodes = this.#episodes.slice(-MAX_EPISODES);
    }

    // Index for semantic search
    if (this.#search) {
      const searchText = `${episode.title} ${episode.summary} ${episode.topics.join(' ')} ${episode.keyDecisions.join(' ')}`;
      this.#search.index(episode.id, searchText, 'episode', {
        summary: episode.summary,
        topics: episode.topics,
        emotionalTone: episode.emotionalTone,
        startTime: episode.startTime,
      }).catch(err => process.stderr.write('[friday:episodic] Search index failed: ' + err.message + '\n'));
    }

    // Save async
    this.#save().catch(err => process.stderr.write('[friday:episodic] Save failed: ' + err.message + '\n'));

    // Clear active
    this.#active = null;
    this.#observations = [];

    process.stderr.write(`[EpisodicMemory] Completed episode ${episode.id.slice(0, 8)}: "${summary.slice(0, 80)}"\n`);
    return episode;
  }

  #formatTimeAgo(timestamp) {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'yesterday';
    if (days < 7) return `${days} days ago`;
    return new Date(timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }

  async #save() {
    if (!this.#state) return;
    // Strip observations from persisted form (too large)
    const stripped = this.#episodes.map(ep => ({
      ...ep,
      observations: undefined,
    }));
    await this.#state.write('episodes', stripped);
  }

  async #load() {
    if (!this.#state) return;
    const result = await this.#state.read('episodes');
    if (result.success && Array.isArray(result.data)) {
      this.#episodes = result.data;
    }
  }
}
