/**
 * Song Store -- Operator's personal music library for Musical Memory.
 *
 * Stores song references (title, artist, link, chords, tags) in the vault
 * under the musical-memory namespace. The operator supplies all content --
 * this module never generates or fetches copyrighted material.
 *
 * Songs are tagged with emotional valence and free-form tags for the arc
 * tracker's selection logic. Deduplication is by title+artist (normalized).
 */

import crypto from 'node:crypto';

const MAX_SONGS = 500;
const MAX_LINES_PER_SONG = 20;
const MAX_TAGS_PER_SONG = 20;

const VALENCE_VALUES = ['uplifting', 'neutral', 'melancholy', 'intense', 'calming'];

export class SongStore {
  #songs = new Map(); // id -> song object
  #state = null;

  async initialize(state) {
    this.#state = state;
    try {
      const result = await state.read('songs');
      const saved = result?.success ? result.data : null;
      if (Array.isArray(saved)) {
        for (const song of saved) {
          if (song?.id) this.#songs.set(song.id, song);
        }
      }
    } catch {
      // Fresh start
    }
  }

  get size() { return this.#songs.size; }

  /**
   * Add a song to the library. Deduplicates by normalized title+artist.
   * Returns the song object (existing if duplicate, new if added).
   */
  add({ title, artist, link, lines, chords, tags, emotional_valence }) {
    if (!title || !artist) return null;

    // Dedup check
    const normalizedKey = `${title.toLowerCase().trim()}::${artist.toLowerCase().trim()}`;
    for (const existing of this.#songs.values()) {
      const existingKey = `${existing.title.toLowerCase().trim()}::${existing.artist.toLowerCase().trim()}`;
      if (existingKey === normalizedKey) {
        // Update fields if provided
        if (link) existing.link = link;
        if (lines?.length) existing.lines = lines.slice(0, MAX_LINES_PER_SONG);
        if (chords) existing.chords = chords;
        if (tags?.length) existing.tags = [...new Set([...existing.tags, ...tags])].slice(0, MAX_TAGS_PER_SONG);
        if (emotional_valence && VALENCE_VALUES.includes(emotional_valence)) existing.emotional_valence = emotional_valence;
        this.#queueSave();
        return existing;
      }
    }

    // Enforce cap
    if (this.#songs.size >= MAX_SONGS) {
      // Evict least-played song
      let minPlay = Infinity, minId = null;
      for (const [id, s] of this.#songs) {
        if (s.playCount < minPlay) { minPlay = s.playCount; minId = id; }
      }
      if (minId) this.#songs.delete(minId);
    }

    const song = {
      id: crypto.randomUUID(),
      title: title.trim(),
      artist: artist.trim(),
      link: link || null,
      lines: Array.isArray(lines) ? lines.slice(0, MAX_LINES_PER_SONG) : [],
      chords: chords || null,
      tags: Array.isArray(tags) ? [...new Set(tags)].slice(0, MAX_TAGS_PER_SONG) : [],
      emotional_valence: VALENCE_VALUES.includes(emotional_valence) ? emotional_valence : 'neutral',
      addedAt: Date.now(),
      playCount: 0,
    };

    this.#songs.set(song.id, song);
    this.#queueSave();
    return song;
  }

  remove(id) {
    const existed = this.#songs.delete(id);
    if (existed) this.#queueSave();
    return existed;
  }

  get(id) {
    return this.#songs.get(id) || null;
  }

  getAll() {
    return [...this.#songs.values()];
  }

  /**
   * Search songs by text query and/or valence filter.
   */
  search(query, valence, limit = 5) {
    let results = [...this.#songs.values()];

    if (valence && VALENCE_VALUES.includes(valence)) {
      results = results.filter(s => s.emotional_valence === valence);
    }

    if (query) {
      const q = query.toLowerCase();
      results = results.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.artist.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    return results.slice(0, Math.min(limit, 50));
  }

  /**
   * Get songs matching a valence category.
   */
  getByValence(valence) {
    return [...this.#songs.values()].filter(s => s.emotional_valence === valence);
  }

  /**
   * Get songs matching any of the given tags.
   */
  getByTags(tags) {
    if (!Array.isArray(tags) || tags.length === 0) return [];
    const tagSet = new Set(tags.map(t => t.toLowerCase()));
    return [...this.#songs.values()].filter(s =>
      s.tags.some(t => tagSet.has(t.toLowerCase()))
    );
  }

  /**
   * Select the best song for a given mode and current emotional indicators.
   */
  selectForMode(mode, currentValence) {
    const songs = this.getAll();
    if (songs.length === 0) return null;

    let candidates;
    switch (mode) {
      case 'mirror':
        // Match current valence
        candidates = songs.filter(s => s.emotional_valence === currentValence);
        break;
      case 'shift': {
        // Select adjacent-but-resolving valence
        const shiftMap = {
          intense: ['neutral', 'uplifting'],
          melancholy: ['calming', 'neutral'],
          neutral: ['uplifting', 'calming'],
          calming: ['uplifting', 'neutral'],
          uplifting: ['uplifting'],
        };
        const targets = shiftMap[currentValence] || ['neutral', 'uplifting'];
        candidates = songs.filter(s => targets.includes(s.emotional_valence));
        break;
      }
      case 'celebration':
        candidates = songs.filter(s => s.emotional_valence === 'uplifting' || s.emotional_valence === 'intense');
        break;
      default:
        candidates = songs;
    }

    if (candidates.length === 0) candidates = songs;

    // Prefer least-played to rotate the library
    candidates.sort((a, b) => a.playCount - b.playCount);
    return candidates[0];
  }

  incrementPlayCount(id) {
    const song = this.#songs.get(id);
    if (song) {
      song.playCount++;
      this.#queueSave();
    }
  }

  // -- Persistence --

  #saveTimer = null;

  #queueSave() {
    if (this.#saveTimer || !this.#state) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#save();
    }, 2000);
  }

  async #save() {
    if (!this.#state) return;
    try {
      await this.#state.write('songs', [...this.#songs.values()]);
    } catch {
      // Best effort
    }
  }

  async stop() {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
    await this.#save();
  }
}
