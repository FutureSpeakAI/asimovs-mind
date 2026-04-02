/**
 * Embedding Pipeline — Local vector embedding via Ollama /api/embed
 *
 * Generates embeddings for memory entries using a locally running Ollama
 * instance. Prefers nomic-embed-text, falls back to all-minilm.
 * Degrades gracefully if Ollama is unavailable (returns null, never crashes).
 *
 * Ported from nexus-os embedding-pipeline.ts — stripped of Electron,
 * Gemini cloud fallback, and Privacy Shield (those live in other subsystems).
 */

const OLLAMA_ENDPOINT = 'http://localhost:11434';
const PREFERRED_MODEL = 'nomic-embed-text';
const FALLBACK_MODEL = 'all-minilm';
const CHECK_TIMEOUT_MS = 5_000;
const EMBED_TIMEOUT_MS = 30_000;

export class EmbeddingPipeline {
  #model = null;
  #ready = false;

  // -- Lifecycle -------------------------------------------------------

  // --- TUNABLE ---
  async start() {
    this.#ready = false;
    this.#model = null;

    try {
      // Single /api/tags fetch: both availability check and model discovery
      // in one round-trip instead of two sequential HTTP calls.
      const model = await this.#findEmbeddingModel();
      if (!model) {
        process.stderr.write('[friday:embedding] No embedding model found (or Ollama unavailable) — embeddings disabled\n');
        return;
      }

      this.#model = model;
      this.#ready = true;
      process.stderr.write(`[EmbeddingPipeline] Ready with model: ${model}\n`);
    } catch (err) {
      process.stderr.write('[friday:embedding] Start failed: ' + err.message + '\n');
      this.#ready = false;
      this.#model = null;
    }
  }

  stop() {
    this.#ready = false;
    this.#model = null;
  }

  isReady() {
    return this.#ready;
  }

  get modelName() {
    return this.#model;
  }

  // -- Single embedding ------------------------------------------------

  async embed(text) {
    if (!this.#ready || !this.#model) return null;

    try {
      const response = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.#model, input: text }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });

      if (!response.ok) {
        process.stderr.write('[friday:embedding] Embed failed (' + response.status + ')\n');
        return null;
      }

      const data = await response.json();
      if (!data.embeddings || data.embeddings.length === 0) return null;
      return data.embeddings[0];
    } catch (err) {
      process.stderr.write('[friday:embedding] Embed error: ' + err.message + '\n');
      return null;
    }
  }

  // -- Batch embedding -------------------------------------------------

  async embedBatch(texts) {
    if (!this.#ready || !this.#model) return null;
    if (texts.length === 0) return [];

    try {
      const response = await fetch(`${OLLAMA_ENDPOINT}/api/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.#model, input: texts }),
        signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
      });

      if (!response.ok) {
        process.stderr.write('[friday:embedding] EmbedBatch failed (' + response.status + ')\n');
        return null;
      }

      const data = await response.json();
      return data.embeddings || null;
    } catch (err) {
      process.stderr.write('[friday:embedding] EmbedBatch error: ' + err.message + '\n');
      return null;
    }
  }

  // -- Cosine similarity (pure math, no Ollama needed) -----------------

  static similarity(vecA, vecB) {
    if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }

  // -- Private: Ollama probing -----------------------------------------

  async #findEmbeddingModel() {
    try {
      const res = await fetch(`${OLLAMA_ENDPOINT}/api/tags`, {
        method: 'GET',
        signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
      });
      if (!res.ok) return null;

      const data = await res.json();
      if (!Array.isArray(data.models)) return null;

      const names = data.models.map(m => m.name);

      if (names.some(n => n.startsWith(PREFERRED_MODEL))) return PREFERRED_MODEL;
      if (names.some(n => n.startsWith(FALLBACK_MODEL))) return FALLBACK_MODEL;
      if (names.length > 0) return names[0];

      return null;
    } catch {
      return null;
    }
  }
}
