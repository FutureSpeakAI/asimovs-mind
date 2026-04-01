/**
 * Semantic Search — Vector similarity search over memory entries
 *
 * Maintains an in-memory index of text embeddings and provides cosine
 * similarity search across all indexed memories (long-term, medium-term,
 * episodes). Embeddings are generated via the EmbeddingPipeline (Ollama).
 *
 * When embeddings are unavailable, falls back to keyword matching.
 * No external vector DB needed -- in-memory comparison at our scale.
 *
 * Ported from nexus-os semantic-search.ts -- stripped of Electron, Gemini
 * cloud fallback, and Privacy Shield.
 */

import { EmbeddingPipeline } from './embedding.js';

const MAX_BATCH_SIZE = 100;

/**
 * @typedef {Object} IndexEntry
 * @property {string} id
 * @property {string} text
 * @property {string} type - 'long-term' | 'medium-term' | 'episode'
 * @property {Record<string, unknown>} meta
 * @property {number[]} embedding
 * @property {number} indexedAt
 */

/**
 * @typedef {Object} SearchResult
 * @property {string} id
 * @property {string} text
 * @property {string} type
 * @property {Record<string, unknown>} meta
 * @property {number} score
 */

export class SemanticSearchEngine {
  /** @type {Map<string, IndexEntry>} */
  #entries = new Map();

  /** @type {EmbeddingPipeline} */
  #pipeline;

  /** @type {Array<{id: string, text: string, type: string, meta: object}>} */
  #pendingBatch = [];

  /** @type {ReturnType<typeof setTimeout>|null} */
  #batchTimer = null;

  /** @type {object|null} Namespaced vault state access */
  #state = null;

  constructor(pipeline) {
    this.#pipeline = pipeline;
  }

  /**
   * Initialize: restore cached embeddings from vault, start pipeline.
   * @param {object} state - Namespaced state accessor (read/write)
   */
  async initialize(state) {
    this.#state = state;

    // Restore cached embeddings from vault
    if (state) {
      const result = await state.read('embeddings');
      if (result.success && Array.isArray(result.data)) {
        for (const entry of result.data) {
          this.#entries.set(entry.id, entry);
        }
      }
    }

    // Start the embedding pipeline (probes Ollama)
    await this.#pipeline.start();

    console.log(
      `[SemanticSearch] Loaded ${this.#entries.size} embeddings ` +
      `(local embeddings: ${this.#pipeline.isReady() ? 'ready' : 'unavailable, keyword fallback'})`
    );
  }

  /**
   * Index a single memory entry. Batches for efficiency.
   */
  async index(id, text, type, meta = {}) {
    const existing = this.#entries.get(id);
    if (existing && existing.text === text) return;

    this.#pendingBatch.push({ id, text, type, meta });

    if (this.#pendingBatch.length >= MAX_BATCH_SIZE) {
      await this.#flushBatch();
    } else {
      if (this.#batchTimer) clearTimeout(this.#batchTimer);
      this.#batchTimer = setTimeout(() => this.#flushBatch(), 2000);
    }
  }

  /**
   * Index multiple entries at once (bulk re-index on init).
   */
  async indexBulk(items) {
    const toIndex = items.filter(item => {
      const existing = this.#entries.get(item.id);
      return !existing || existing.text !== item.text;
    });
    if (toIndex.length === 0) return;

    console.log(`[SemanticSearch] Bulk indexing ${toIndex.length} entries...`);

    for (let i = 0; i < toIndex.length; i += MAX_BATCH_SIZE) {
      const batch = toIndex.slice(i, i + MAX_BATCH_SIZE);
      const texts = batch.map(b => b.text);

      try {
        const embeddings = await this.#getEmbeddings(texts);

        for (let j = 0; j < batch.length; j++) {
          const item = batch[j];
          this.#entries.set(item.id, {
            id: item.id,
            text: item.text,
            type: item.type,
            meta: item.meta || {},
            embedding: embeddings ? embeddings[j] || [] : [],
            indexedAt: Date.now(),
          });
        }
      } catch (err) {
        console.warn('[SemanticSearch] Bulk embedding batch failed:', err.message);
      }
    }

    await this.#save();
  }

  /**
   * Remove an entry from the index.
   */
  remove(id) {
    this.#entries.delete(id);
    this.#save().catch(() => {});
  }

  /**
   * Semantic search across all indexed entries.
   * Falls back to keyword matching when embeddings are unavailable.
   */
  async search(query, options = {}) {
    const { maxResults = 10, minScore = 0.3, types } = options;
    if (this.#entries.size === 0) return [];

    // Try vector search first
    const queryEmbedding = await this.#getQueryEmbedding(query);

    if (queryEmbedding) {
      return this.#vectorSearch(queryEmbedding, { maxResults, minScore, types });
    }

    // Fallback: keyword search
    return this.#keywordSearch(query, { maxResults, types });
  }

  /**
   * Vector-based cosine similarity search.
   */
  #vectorSearch(queryEmbedding, { maxResults, minScore, types }) {
    const results = [];

    for (const entry of this.#entries.values()) {
      if (types && !types.includes(entry.type)) continue;
      if (!entry.embedding || entry.embedding.length === 0) continue;

      const score = EmbeddingPipeline.similarity(queryEmbedding, entry.embedding);
      if (score >= minScore) {
        results.push({
          id: entry.id,
          text: entry.text,
          type: entry.type,
          meta: entry.meta,
          score,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Keyword-based fallback search using word overlap scoring.
   */
  #keywordSearch(query, { maxResults, types }) {
    const queryWords = this.#tokenize(query);
    if (queryWords.size === 0) return [];

    const results = [];

    for (const entry of this.#entries.values()) {
      if (types && !types.includes(entry.type)) continue;

      const entryWords = this.#tokenize(entry.text);
      if (entryWords.size === 0) continue;

      let intersection = 0;
      for (const word of queryWords) {
        if (entryWords.has(word)) intersection++;
      }

      if (intersection === 0) continue;

      const union = new Set([...queryWords, ...entryWords]).size;
      const score = intersection / union;

      results.push({
        id: entry.id,
        text: entry.text,
        type: entry.type,
        meta: entry.meta,
        score,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
  }

  /**
   * Tokenize text for keyword matching. Removes stopwords, lowercases.
   */
  #tokenize(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
      'should', 'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for',
      'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
      'before', 'after', 'and', 'but', 'or', 'not', 'no', 'so', 'if',
      'than', 'that', 'this', 'it', 'its', 'they', 'them', 'their',
      'he', 'she', 'his', 'her', 'we', 'us', 'our', 'you', 'your', 'i', 'my', 'me',
    ]);

    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(Boolean);
    return new Set(words.filter(w => !stopWords.has(w) && w.length > 2));
  }

  getCount() {
    return this.#entries.size;
  }

  getStats() {
    const stats = {};
    for (const entry of this.#entries.values()) {
      stats[entry.type] = (stats[entry.type] || 0) + 1;
    }
    return stats;
  }

  // -- Private helpers -------------------------------------------------

  async #getQueryEmbedding(text) {
    if (!this.#pipeline.isReady()) return null;
    try {
      return await this.#pipeline.embed(text);
    } catch {
      return null;
    }
  }

  async #getEmbeddings(texts) {
    if (!this.#pipeline.isReady()) return null;
    return this.#pipeline.embedBatch(texts);
  }

  async #flushBatch() {
    if (this.#pendingBatch.length === 0) return;

    const batch = [...this.#pendingBatch];
    this.#pendingBatch = [];
    if (this.#batchTimer) {
      clearTimeout(this.#batchTimer);
      this.#batchTimer = null;
    }

    const texts = batch.map(b => b.text);

    try {
      const embeddings = await this.#getEmbeddings(texts);

      for (let i = 0; i < batch.length; i++) {
        const item = batch[i];
        this.#entries.set(item.id, {
          id: item.id,
          text: item.text,
          type: item.type,
          meta: item.meta,
          embedding: embeddings ? embeddings[i] || [] : [],
          indexedAt: Date.now(),
        });
      }

      await this.#save();
      console.log(`[SemanticSearch] Indexed ${batch.length} entries`);
    } catch (err) {
      console.warn('[SemanticSearch] Batch embedding failed:', err.message);
      this.#pendingBatch.push(...batch);
    }
  }

  async #save() {
    if (!this.#state) return;
    const data = Array.from(this.#entries.values());
    await this.#state.write('embeddings', data);
  }
}
