/**
 * Personality Evolution — Track trait-based visual and behavioral evolution
 *
 * Maps agent personality traits and session history to evolution parameters.
 * The evolution is gradual: early sessions are mostly standard, but over
 * weeks of use the personality drifts toward a configuration unique to this
 * specific agent's personality.
 *
 * Maturity factor: Math.min(sessionCount / 50, 1) -- full uniqueness at ~50 sessions.
 *
 * Ported from nexus-os: personality-evolution.ts. Stripped settingsManager,
 * Electron IPC. Pure computation + state persistence.
 */

/* -- Trait -> Parameter Mapping Tables -- */

const TRAIT_HUE_MAP = {
  warm: 30, empathetic: 25, caring: 20, nurturing: 15, passionate: 0,
  confident: 45, bold: 50, energetic: 55, enthusiastic: 60,
  calm: 120, balanced: 110, grounded: 100, steady: 130, patient: 140,
  analytical: 200, sharp: 210, precise: 195, logical: 220, intellectual: 230,
  creative: 270, mysterious: 280, deep: 260, intuitive: 290, spiritual: 300,
  playful: 320, witty: 330, humorous: 340, charming: 310, mischievous: 350,
  direct: 190, honest: 170, loyal: 150, protective: 35, curious: 240, wise: 250,
};

const TRAIT_ENERGY_MAP = {
  energetic: 1.8, enthusiastic: 1.7, playful: 1.6, dynamic: 1.5,
  witty: 1.4, bold: 1.3, passionate: 1.3,
  balanced: 1.0, direct: 1.0, honest: 1.0,
  calm: 0.7, steady: 0.6, patient: 0.5, serene: 0.5,
};

const TRAIT_COMPLEXITY_MAP = {
  creative: 0.8, mysterious: 0.7, deep: 0.7, complex: 0.9,
  playful: 0.6, mischievous: 0.7, curious: 0.6,
  analytical: 0.5, intellectual: 0.5, precise: 0.4,
  calm: 0.2, steady: 0.2, grounded: 0.3, simple: 0.1,
};

const TRAIT_WARMTH_MAP = {
  warm: 1.8, empathetic: 1.7, caring: 1.6, nurturing: 1.5,
  passionate: 1.4, enthusiastic: 1.3,
  balanced: 1.0, direct: 0.9,
  analytical: 0.7, sharp: 0.7, logical: 0.6,
  reserved: 0.6, stoic: 0.5,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function averageFromMap(traits, map) {
  let sum = 0;
  let count = 0;
  for (const trait of traits) {
    if (trait in map) {
      sum += map[trait];
      count++;
    }
  }
  return count > 0 ? sum / count : null;
}

export class PersonalityEvolution {
  #state = null;
  #evolutionState = null;

  async initialize(state) {
    this.#state = state;
    const result = await state.read('evolution');
    if (result?.success && result.data) {
      this.#evolutionState = result.data;
    }
  }

  /**
   * Compute the evolution state from agent traits and session count.
   */
  computeEvolution(traits, sessionCount) {
    const normalizedTraits = traits.map((t) => t.toLowerCase().trim());

    const primaryHue = averageFromMap(normalizedTraits, TRAIT_HUE_MAP) ?? 200;
    const secondaryHue = (primaryHue + 150) % 360;
    const particleSpeed = averageFromMap(normalizedTraits, TRAIT_ENERGY_MAP) ?? 1.0;
    const cubeFragmentation = averageFromMap(normalizedTraits, TRAIT_COMPLEXITY_MAP) ?? 0.4;
    const coreScale = 0.8 + (1.0 - cubeFragmentation) * 0.7;

    const hasDepthTraits = normalizedTraits.some((t) =>
      ['deep', 'intellectual', 'wise', 'analytical', 'curious', 'intuitive'].includes(t)
    );
    const dustDensity = hasDepthTraits ? 1.5 : 1.0;
    const glowIntensity = averageFromMap(normalizedTraits, TRAIT_WARMTH_MAP) ?? 1.0;

    return {
      sessionCount,
      primaryHue,
      secondaryHue,
      particleSpeed: clamp(particleSpeed, 0.5, 2.0),
      cubeFragmentation: clamp(cubeFragmentation, 0, 1),
      coreScale: clamp(coreScale, 0.8, 1.5),
      dustDensity: clamp(dustDensity, 0.5, 2.0),
      glowIntensity: clamp(glowIntensity, 0.5, 2.0),
    };
  }

  /**
   * Get the maturity factor (0-1) based on session count.
   * 0 sessions = no evolution. 50+ sessions = full evolution.
   */
  getMaturityFactor(sessionCount) {
    return Math.min(sessionCount / 50, 1);
  }

  /**
   * Increment the session count and recompute evolution state.
   * Call once per session start.
   */
  async incrementSession(traits) {
    const currentCount = this.#evolutionState?.sessionCount ?? 0;
    const newState = this.computeEvolution(traits, currentCount + 1);
    this.#evolutionState = newState;

    if (this.#state) {
      await this.#state.write('evolution', newState);
    }

    return newState;
  }

  /** Get current evolution state (or null if never computed) */
  getEvolutionState() {
    return this.#evolutionState ? { ...this.#evolutionState } : null;
  }

  /** Get a self-description of the evolution for the agent */
  getSelfDescription() {
    if (!this.#evolutionState) return 'No evolution data yet.';

    const s = this.#evolutionState;
    const maturity = this.getMaturityFactor(s.sessionCount);
    const parts = [];

    parts.push(`Session ${s.sessionCount} (maturity: ${(maturity * 100).toFixed(0)}%)`);

    if (maturity > 0.2) {
      if (s.particleSpeed > 1.3) parts.push('High energy personality');
      else if (s.particleSpeed < 0.7) parts.push('Calm, measured personality');

      if (s.cubeFragmentation > 0.6) parts.push('Complex, multifaceted');
      else if (s.cubeFragmentation < 0.3) parts.push('Clear, straightforward');

      if (s.glowIntensity > 1.3) parts.push('Deeply warm presence');
      else if (s.glowIntensity < 0.7) parts.push('Reserved, analytical presence');
    }

    return parts.join(' | ');
  }
}
