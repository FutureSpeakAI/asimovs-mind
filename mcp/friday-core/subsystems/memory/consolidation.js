/**
 * Memory Consolidation — Tier promotion logic
 *
 * Promotes high-confidence medium-term observations to long-term facts
 * using a weighted scoring formula. Like the brain's sleep consolidation:
 * strengthening important memories and pruning redundancy.
 *
 * Scoring signals:
 *   FREQUENCY:      min(accessCount, 10) x 2        max 20
 *   CONFIDENCE:     +3 if confidence >= 0.9
 *   TIME-SPAN:      +5 if span >= 7 days, +3 if >= 3 days
 *   STALENESS:      -5 if not accessed in 14+ days, -2 if 7+ days
 *
 * Ported from nexus-os memory-consolidation.ts -- stripped of LLM-based
 * merging (no LLM dependency in consolidation), cross-episode insights,
 * and friday-profile integration. Kept the pure scoring/promotion logic.
 */

const PROMOTION_SCORE_THRESHOLD = 10;
const PROMOTION_MIN_ACCESS_COUNT = 3;

/**
 * Compute a weighted promotion score for a medium-term memory.
 */
function computePromotionScore(entry) {
  const frequency = Math.min(entry.accessCount || 1, 10) * 2;

  const daySpan = (entry.accessed - entry.created) / (24 * 60 * 60 * 1000);
  const timeSpan = daySpan >= 7 ? 5 : daySpan >= 3 ? 3 : 0;

  const confidenceBonus = entry.confidence >= 0.9 ? 3 : 0;

  const daysSinceAccessed = (Date.now() - entry.accessed) / (24 * 60 * 60 * 1000);
  const stalenessPenalty = daysSinceAccessed > 14 ? -5 : daysSinceAccessed > 7 ? -2 : 0;

  return frequency + timeSpan + confidenceBonus + stalenessPenalty;
}

/**
 * Map medium-term categories to long-term categories.
 */
function mapCategory(mediumCat) {
  switch (mediumCat) {
    case 'preference': return 'preference';
    case 'context': return 'fact';
    case 'pattern': return 'preference';
    default: return 'fact';
  }
}

export class MemoryConsolidation {
  /** @type {import('./tiers.js').MemoryTiers} */
  #tiers;

  /** @type {import('./search.js').SemanticSearchEngine} */
  #search;

  /** @type {boolean} */
  #running = false;

  /**
   * @param {import('./tiers.js').MemoryTiers} tiers
   * @param {import('./search.js').SemanticSearchEngine} search
   */
  constructor(tiers, search) {
    this.#tiers = tiers;
    this.#search = search;
  }

  /**
   * Run a consolidation pass. Returns a report of what was promoted.
   *
   * @returns {{ promoted: Array<{from: object, to: string}>, pruned: string[], skipped: number }}
   */
  async run() {
    if (this.#running) {
      return { promoted: [], pruned: [], skipped: 0, error: 'Already running' };
    }

    this.#running = true;
    console.log('[Consolidation] Starting consolidation pass...');

    try {
      const result = await this.#promoteHighScoring();
      console.log(
        `[Consolidation] Complete: promoted=${result.promoted.length}, ` +
        `pruned=${result.pruned.length}, skipped=${result.skipped}`
      );
      return result;
    } finally {
      this.#running = false;
    }
  }

  /**
   * Score all medium-term entries and return their scores (for diagnostics).
   */
  scoreAll() {
    const mediumTerm = this.#tiers.getMediumTerm();
    return mediumTerm.map(entry => ({
      id: entry.id,
      content: entry.content.slice(0, 80),
      category: entry.category,
      score: computePromotionScore(entry),
      accessCount: entry.accessCount,
      confidence: entry.confidence,
      meetsThreshold: computePromotionScore(entry) >= PROMOTION_SCORE_THRESHOLD
        && entry.accessCount >= PROMOTION_MIN_ACCESS_COUNT,
    }));
  }

  // -- Internal --------------------------------------------------------

  async #promoteHighScoring() {
    const mediumTerm = this.#tiers.getMediumTerm();
    const longTerm = this.#tiers.getLongTerm();
    const longTermContents = longTerm.map(e => e.content);

    const promoted = [];
    const pruned = [];
    let skipped = 0;

    // Score and filter candidates
    const candidates = mediumTerm
      .map(entry => ({ entry, score: computePromotionScore(entry) }))
      .filter(s => s.score >= PROMOTION_SCORE_THRESHOLD && s.entry.accessCount >= PROMOTION_MIN_ACCESS_COUNT)
      .sort((a, b) => b.score - a.score);

    for (const { entry: candidate, score } of candidates) {
      // Check if already captured in long-term (substring overlap)
      const alreadyExists = longTermContents.some(
        lt => lt.toLowerCase().includes(candidate.content.toLowerCase()) ||
              candidate.content.toLowerCase().includes(lt.toLowerCase())
      );

      if (alreadyExists) {
        // Prune from medium-term since it's redundant
        await this.#tiers.forget(candidate.id);
        pruned.push(candidate.id);
        continue;
      }

      // Promote: store directly in long-term
      const category = mapCategory(candidate.category);
      const newEntry = await this.#tiers.store(
        candidate.content,
        category,
        'long',
        Math.max(candidate.confidence, 0.8)
      );

      // Remove from medium-term
      await this.#tiers.forget(candidate.id);

      if (newEntry) {
        promoted.push({
          from: { id: candidate.id, content: candidate.content, score },
          to: newEntry.id,
        });
        console.log(
          `[Consolidation] Promoted (score=${score}): "${candidate.content.slice(0, 60)}" -> long-term (${category})`
        );
      } else {
        // Was a duplicate in long-term (caught by tiers.store)
        skipped++;
      }
    }

    return { promoted, pruned, skipped };
  }
}
