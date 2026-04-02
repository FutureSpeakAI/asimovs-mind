/**
 * 3-Tier Memory Storage — Short / Medium / Long term
 *
 * Each memory entry: { id, content, category, confidence, created,
 *   accessed, accessCount, embedding }
 *
 * - Short-term: Current session observations. In-memory only, cleared on stop.
 * - Medium-term: Persisted observations promoted from short-term. Vault-backed.
 * - Long-term: Consolidated insights promoted from medium-term. Vault-backed.
 *
 * Ported from nexus-os memory.ts -- stripped of Electron, Obsidian vault,
 * integrity signing, trust graph, and personality bridge. All persistence
 * goes through the subsystem's namespaced vault state accessor.
 */

import crypto from 'node:crypto';

// --- TUNABLE ---
const TIER_CAPS = { short: 100, medium: 500, long: 1000 };
const MEDIUM_TERM_MAX_AGE_DAYS = 30;

// Stopwords for duplicate detection (Jaccard similarity)
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'and', 'but', 'or', 'not', 'no', 'so', 'if',
  'than', 'that', 'this', 'it', 'its', 'they', 'them', 'their',
  'he', 'she', 'his', 'her', 'we', 'us', 'our', 'you', 'your', 'i', 'my', 'me',
]);

export class MemoryTiers {
  /** @type {{ shortTerm: Array, mediumTerm: Array, longTerm: Array }} */
  #store = { shortTerm: [], mediumTerm: [], longTerm: [] };

  /** @type {Set<string>} SHA-256 content hashes for short-term dedup (O(1) lookup) */
  #shortTermHashes = new Set();

  /** @type {object|null} Namespaced state accessor */
  #state = null;

  /** @type {import('./search.js').SemanticSearchEngine|null} */
  #search = null;

  /**
   * @param {object} state - Namespaced state from the subsystem
   * @param {import('./search.js').SemanticSearchEngine} search - Semantic search engine
   */
  async initialize(state, search) {
    this.#state = state;
    this.#search = search;

    // Load persisted tiers from vault
    await this.#load();

    // Prune expired medium-term entries
    this.#pruneExpired();

    // Re-index all persisted memories for semantic search
    const toIndex = [];
    for (const entry of this.#store.mediumTerm) {
      toIndex.push({ id: entry.id, text: entry.content, type: 'medium-term', meta: { category: entry.category } });
    }
    for (const entry of this.#store.longTerm) {
      toIndex.push({ id: entry.id, text: entry.content, type: 'long-term', meta: { category: entry.category } });
    }
    if (toIndex.length > 0 && search) {
      search.indexBulk(toIndex).catch(err => process.stderr.write('[friday:memory] Bulk re-index failed: ' + err.message + '\n'));
    }

    process.stderr.write(
      `[MemoryTiers] Loaded: short=${this.#store.shortTerm.length}, ` +
      `medium=${this.#store.mediumTerm.length}, long=${this.#store.longTerm.length}\n`
    );
  }

  // -- Accessors -------------------------------------------------------

  getShortTerm() { return [...this.#store.shortTerm]; }
  getMediumTerm() { return [...this.#store.mediumTerm]; }
  getLongTerm() { return [...this.#store.longTerm]; }

  // -- Store a memory --------------------------------------------------

  /**
   * Store a new memory entry. Default tier is short-term.
   * Returns the created entry.
   */
  async store(content, category = 'fact', tier = 'short', confidence = 0.5) {
    const entry = {
      id: crypto.randomUUID(),
      content,
      category,
      confidence: Math.max(0, Math.min(1, confidence)),
      created: Date.now(),
      accessed: Date.now(),
      accessCount: 1,
      embedding: null,
    };

    switch (tier) {
      case 'short': {
        // Content-hash dedup: skip exact duplicates (catches duplicate event firings)
        const hash = crypto.createHash('sha256').update(content).digest('hex');
        if (this.#shortTermHashes.has(hash)) return null;

        // Enforce cap via LFU+age eviction before inserting
        if (this.#store.shortTerm.length >= TIER_CAPS.short) {
          this.#evictOne(this.#store.shortTerm);
        }

        this.#shortTermHashes.add(hash);
        this.#store.shortTerm.push(entry);
        // Short-term is in-memory only, no vault write
        break;
      }

      case 'medium': {
        // Duplicate check via Jaccard similarity
        const isDup = this.#isDuplicate(content, this.#store.mediumTerm.map(e => e.content));
        if (isDup) {
          // Reinforce existing
          const existing = this.#findDuplicate(content, this.#store.mediumTerm);
          if (existing) {
            existing.accessCount++;
            existing.accessed = Date.now();
            existing.confidence = Math.min(1, existing.confidence + 0.1);
            await this.#save('medium-term');
            return existing;
          }
        }

        // Enforce cap via LFU+age eviction before inserting
        if (this.#store.mediumTerm.length >= TIER_CAPS.medium) {
          const evicted = this.#evictOne(this.#store.mediumTerm);
          if (evicted && this.#search) this.#search.remove(evicted.id);
        }

        this.#store.mediumTerm.push(entry);
        await this.#save('medium-term');
        if (this.#search) {
          this.#search.index(entry.id, content, 'medium-term', { category }).catch(() => {});
        }
        break;
      }

      case 'long': {
        const isDup = this.#isDuplicate(content, this.#store.longTerm.map(e => e.content));
        if (isDup) return null; // Already known

        // Enforce cap via LFU+age eviction before inserting
        if (this.#store.longTerm.length >= TIER_CAPS.long) {
          const evicted = this.#evictOne(this.#store.longTerm);
          if (evicted && this.#search) this.#search.remove(evicted.id);
        }

        entry.confidence = Math.max(0.7, confidence); // Long-term starts at higher confidence
        this.#store.longTerm.push(entry);
        await this.#save('long-term');
        if (this.#search) {
          this.#search.index(entry.id, content, 'long-term', { category }).catch(() => {});
        }
        break;
      }

      default:
        throw new Error(`Unknown tier: ${tier}`);
    }

    return entry;
  }

  // -- Recall (simple query) -------------------------------------------

  /**
   * Recall relevant memories. Uses semantic search if available, keyword fallback otherwise.
   */
  async recall(query, limit = 5) {
    // Try semantic search first
    if (this.#search) {
      const results = await this.#search.search(query, { maxResults: limit, minScore: 0.2 });
      if (results.length > 0) {
        // Touch accessed counters
        for (const r of results) {
          this.#touchAccess(r.id);
        }
        return results.map(r => ({
          id: r.id,
          content: r.text,
          type: r.type,
          score: r.score,
          meta: r.meta,
        }));
      }
    }

    // Fallback: substring match across all tiers
    return this.#keywordRecall(query, limit);
  }

  // -- Delete a memory by ID ------------------------------------------

  async forget(id) {
    let found = false;

    const shortIdx = this.#store.shortTerm.findIndex(e => e.id === id);
    if (shortIdx >= 0) {
      const [removed] = this.#store.shortTerm.splice(shortIdx, 1);
      // Remove hash so the same content can be re-stored after an explicit forget
      const hash = crypto.createHash('sha256').update(removed.content).digest('hex');
      this.#shortTermHashes.delete(hash);
      found = true;
    }

    const medIdx = this.#store.mediumTerm.findIndex(e => e.id === id);
    if (medIdx >= 0) {
      this.#store.mediumTerm.splice(medIdx, 1);
      await this.#save('medium-term');
      found = true;
    }

    const longIdx = this.#store.longTerm.findIndex(e => e.id === id);
    if (longIdx >= 0) {
      this.#store.longTerm.splice(longIdx, 1);
      await this.#save('long-term');
      found = true;
    }

    if (found && this.#search) {
      this.#search.remove(id);
    }

    return found;
  }

  // -- Stats -----------------------------------------------------------

  status() {
    const tierStats = (arr) => {
      if (arr.length === 0) return { count: 0, oldest: null, newest: null };
      const sorted = [...arr].sort((a, b) => a.created - b.created);
      return {
        count: arr.length,
        oldest: new Date(sorted[0].created).toISOString(),
        newest: new Date(sorted[sorted.length - 1].created).toISOString(),
      };
    };

    return {
      shortTerm: tierStats(this.#store.shortTerm),
      mediumTerm: tierStats(this.#store.mediumTerm),
      longTerm: tierStats(this.#store.longTerm),
      totalMemories: this.#store.shortTerm.length + this.#store.mediumTerm.length + this.#store.longTerm.length,
    };
  }

  // -- Clear short-term (session end) ----------------------------------

  clearShortTerm() {
    this.#store.shortTerm = [];
    this.#shortTermHashes.clear();
  }

  // -- Internal --------------------------------------------------------

  #touchAccess(id) {
    for (const tier of [this.#store.shortTerm, this.#store.mediumTerm, this.#store.longTerm]) {
      const entry = tier.find(e => e.id === id);
      if (entry) {
        entry.accessed = Date.now();
        entry.accessCount++;
        break;
      }
    }
  }

  #keywordRecall(query, limit) {
    const q = query.toLowerCase();
    const now = Date.now();
    const maxAgeMs = 30 * 24 * 60 * 60 * 1000; // 30 days normalization window
    const results = [];

    const keywordScore = (entry, tier) => {
      const text = entry.content.toLowerCase();
      if (!text.includes(q) && !q.split(/\s+/).some(w => text.includes(w))) return 0;
      let s = text.includes(q) ? 5 : 1;
      if (tier === 'long-term') s += 3;
      if (tier === 'medium-term') s += 1;
      return s;
    };

    const blendedScore = (entry, tier) => {
      const kw = keywordScore(entry, tier);
      if (kw === 0) return 0;
      // Time-weighted recall: blend keyword relevance (0.6) with recency (0.4)
      const ageMs = Math.max(0, now - (entry.accessed || entry.created));
      const recency = Math.max(0, 1 - ageMs / maxAgeMs);
      return kw * 0.6 + recency * 10 * 0.4; // scale recency to comparable range
    };

    for (const entry of this.#store.longTerm) {
      const s = blendedScore(entry, 'long-term');
      if (s > 0) results.push({ id: entry.id, content: entry.content, type: 'long-term', score: s, meta: { category: entry.category } });
    }
    for (const entry of this.#store.mediumTerm) {
      const s = blendedScore(entry, 'medium-term');
      if (s > 0) results.push({ id: entry.id, content: entry.content, type: 'medium-term', score: s, meta: { category: entry.category } });
    }
    for (const entry of this.#store.shortTerm) {
      const s = blendedScore(entry, 'short-term');
      if (s > 0) results.push({ id: entry.id, content: entry.content, type: 'short-term', score: s, meta: { category: entry.category } });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Jaccard similarity duplicate detection (>= 80% word overlap).
   */
  #isDuplicate(newText, existingTexts) {
    const newWords = this.#tokenize(newText);
    if (newWords.size === 0) return false;

    for (const existing of existingTexts) {
      const existingWords = this.#tokenize(existing);
      if (existingWords.size === 0) continue;

      let intersection = 0;
      for (const word of newWords) {
        if (existingWords.has(word)) intersection++;
      }
      const union = new Set([...newWords, ...existingWords]).size;
      if (intersection / union >= 0.8) return true;
    }

    return false;
  }

  /**
   * Find the duplicate entry from an array.
   */
  #findDuplicate(newText, entries) {
    const newWords = this.#tokenize(newText);
    if (newWords.size === 0) return null;

    for (const entry of entries) {
      const existingWords = this.#tokenize(entry.content);
      if (existingWords.size === 0) continue;

      let intersection = 0;
      for (const word of newWords) {
        if (existingWords.has(word)) intersection++;
      }
      const union = new Set([...newWords, ...existingWords]).size;
      if (intersection / union >= 0.8) return entry;
    }

    return null;
  }

  #tokenize(text) {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    return new Set(words.filter(w => !STOP_WORDS.has(w) && w.length > 2));
  }

  /**
   * Evict the oldest entry with the lowest access count from an array in-place.
   * Returns the evicted entry, or null if the array is empty.
   */
  #evictOne(arr) {
    if (arr.length === 0) return null;
    arr.sort((a, b) => {
      const diff = a.accessCount - b.accessCount;
      return diff !== 0 ? diff : a.created - b.created;
    });
    return arr.shift();
  }

  #pruneExpired() {
    const cutoff = Date.now() - MEDIUM_TERM_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    const before = this.#store.mediumTerm.length;
    this.#store.mediumTerm = this.#store.mediumTerm.filter(
      e => e.accessed > cutoff || e.accessCount >= 5
    );
    const pruned = before - this.#store.mediumTerm.length;
    if (pruned > 0) {
      process.stderr.write(`[MemoryTiers] Pruned ${pruned} expired medium-term entries\n`);
    }
  }

  async #save(tierKey) {
    if (!this.#state) return;
    if (tierKey === 'medium-term') {
      await this.#state.write('medium-term', this.#store.mediumTerm);
    } else if (tierKey === 'long-term') {
      await this.#state.write('long-term', this.#store.longTerm);
    }
  }

  async #load() {
    if (!this.#state) return;

    // Short-term is in-memory only -- never persisted
    const mtResult = await this.#state.read('medium-term');
    if (mtResult.success && Array.isArray(mtResult.data)) {
      this.#store.mediumTerm = mtResult.data;
    }

    const ltResult = await this.#state.read('long-term');
    if (ltResult.success && Array.isArray(ltResult.data)) {
      this.#store.longTerm = ltResult.data;
    }
  }
}
