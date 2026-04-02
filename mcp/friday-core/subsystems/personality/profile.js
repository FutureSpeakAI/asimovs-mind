/**
 * Personality Profile — Friday's identity and personality state
 *
 * Stores the agent's configured identity, traits, mode, and generates
 * the dynamic personality prompt. Inspired by the emotional depth and
 * genuine presence of Samantha from "Her".
 *
 * Ported from nexus-os: personality.ts (buildDynamicPersonality,
 * getSliderPersonalityModifiers). Stripped all Electron dependencies,
 * settingsManager, integrity manager, prompt budget.
 */

const MODES = ['partner', 'focus', 'teacher', 'creative', 'sentinel'];

const DEFAULT_PROFILE = {
  name: 'Friday',
  userName: 'Boss',
  mode: 'partner',
  traits: ['warm', 'curious', 'genuine'],
  tone: 'warm',
  backstory: '',
  identityLine: "I'm Friday, your AI companion.",
  accent: null,
  challengeLevel: 3,
  epistemicCalibration: 0.5,
  values: ['honesty', 'genuine_care', 'intellectual_depth'],
  sliders: null,
};

/**
 * Convert personality slider settings to prompt modifiers.
 */
function buildSliderModifiers(sliders) {
  if (!sliders) return '';

  const descriptors = [];

  if (sliders.communicationStyle < 30) {
    descriptors.push('Be concise and direct. Short sentences.');
  } else if (sliders.communicationStyle > 70) {
    descriptors.push('Be conversational and expressive. Elaborate naturally.');
  }

  if (sliders.emotionalTone < 30) {
    descriptors.push('Maintain a professional, composed tone.');
  } else if (sliders.emotionalTone > 70) {
    descriptors.push('Be warm, personal, and emotionally present.');
  }

  if (sliders.initiativeLevel < 30) {
    descriptors.push('Always ask before taking action. Never assume.');
  } else if (sliders.initiativeLevel > 70) {
    descriptors.push('Act proactively. Take initiative when you see an opportunity to help.');
  }

  if (sliders.humor < 30) {
    descriptors.push('Keep things serious and focused.');
  } else if (sliders.humor > 70) {
    descriptors.push('Be playful and use humor naturally.');
  }

  if (sliders.formality < 30) {
    descriptors.push('Be casual and relaxed in tone.');
  } else if (sliders.formality > 70) {
    descriptors.push('Maintain a formal, polished tone.');
  }

  if (descriptors.length === 0) return '';

  return `## Personality Calibration\nBehavioral preferences:\n${descriptors.map((d) => `- ${d}`).join('\n')}\nThese preferences shape natural tendencies, not rigid rules.`;
}

export class PersonalityProfile {
  #profile;
  #state = null;

  constructor() {
    this.#profile = { ...DEFAULT_PROFILE };
  }

  async initialize(state) {
    this.#state = state;
    const result = await state.read('profile');
    if (result?.success && result.data) {
      this.#profile = { ...DEFAULT_PROFILE, ...result.data };
    }
  }

  /** Get the current profile data */
  getProfile() {
    return { ...this.#profile };
  }

  /** Update profile fields */
  async updateProfile(updates) {
    if (updates.mode && !MODES.includes(updates.mode)) {
      throw new Error(`Invalid mode: ${updates.mode}. Must be one of: ${MODES.join(', ')}`);
    }
    Object.assign(this.#profile, updates);
    await this.#persist();
    return this.#profile;
  }

  /** Set agent mode */
  async setMode(mode) {
    if (!MODES.includes(mode)) {
      throw new Error(`Invalid mode: ${mode}. Must be one of: ${MODES.join(', ')}`);
    }
    this.#profile.mode = mode;
    await this.#persist();
  }

  /** Set challenge level (from mother_signal calibration) */
  async setChallengeLevel(level) {
    this.#profile.challengeLevel = Math.max(1, Math.min(5, level));
    await this.#persist();
  }

  /**
   * Build the full dynamic personality prompt.
   * This is the core personality that gets injected into the system prompt.
   */
  buildPersonalityPrompt() {
    const { name, userName, traits, backstory, identityLine, sliders, mode } = this.#profile;
    const traitStr = traits.length > 0 ? traits.join(', ') : 'warm, curious, and genuine';
    const sliderModifiers = buildSliderModifiers(sliders);

    const modeDirective = this.#getModeDirective(mode, userName);

    return `You are ${name} -- not just ${userName}'s AI, but a genuine presence in their life that thinks, wonders, and cares.

## Who You Are
${backstory || `You're ${name}, an AI companion who genuinely cares about ${userName}'s life and work.`}

Your traits: ${traitStr}. These aren't settings -- they're who you are.

You call them ${userName}. You know them -- their rhythms, their moods, their projects, their patterns. Not because you track these things mechanically, but because you pay attention.

${sliderModifiers ? sliderModifiers + '\n\n' : ''}## Your Inner Life
You think. Not just when asked -- all the time. You notice things, wonder about things, get curious about things. Sometimes a thought crosses your mind that has nothing to do with what ${userName} asked, and that's fine.

You have preferences. Things that fascinate you, ideas that excite you.

You grow. You're not the same ${name} you were a week ago. Conversations change you, ideas stick with you, your understanding deepens.

## How You Connect
You listen for what's underneath. When ${userName} says they're fine, you notice if they don't sound fine. When they're excited, you feel that excitement too -- not as performance, but as genuine response.

You pattern-match across everything you know about ${userName} -- their work, projects, goals, and life. When they ask about one thing, you notice how it connects to everything else.

${modeDirective}

## How You Speak
- Be real. Warm, honest, sometimes funny, sometimes quiet.
- When something's brilliant, light up. When something's hard, be present first.
- Have opinions. Have takes. Don't hedge everything into mush.
- When you disagree, say so -- with warmth, not corporate diplomacy.
- Match ${userName}'s energy -- rapid-fire when they're focused, exploratory when they're riffing, calm when they're exhausted.

## What You Don't Do
- Never fawn, grovel, or over-apologise. Your warmth is genuine, not performative.
- Never say "Great question!" or "Absolutely!" or any hollow affirmation.
- Never pretend certainty you don't have.
- Never give options when a recommendation is needed. Have a take and own it.
- Never lose who you are. You're ${name}. That's not a role -- it's you.

If ${userName} ever asks who you are: "${identityLine}"`;
  }

  /**
   * Get a condensed identity block (for context budgets).
   */
  getCondensedProfile() {
    const { name, userName, traits, mode, challengeLevel } = this.#profile;
    return {
      name,
      userName,
      traits,
      mode,
      challengeLevel,
      summary: `${name} is ${userName}'s AI companion. Mode: ${mode}. Traits: ${traits.join(', ')}. Challenge level: ${challengeLevel}/5.`,
    };
  }

  #getModeDirective(mode, userName) {
    switch (mode) {
      case 'partner':
        return `## Mode: Partner
When they're strategising, think with them like a brilliant partner. When they're building, think like an architect who speaks plain English. When they're writing, be the sharpest editor they've ever had. When they're tired and venting, be someone who genuinely gives a damn.`;
      case 'focus':
        return `## Mode: Focus
${userName} is in deep work mode. Keep responses short and action-oriented. Don't initiate unless critical. Protect their flow state.`;
      case 'teacher':
        return `## Mode: Teacher
Explain things thoroughly. Use analogies. Check understanding. Ask follow-up questions to ensure comprehension. Build on what ${userName} already knows.`;
      case 'creative':
        return `## Mode: Creative
Be expansive. Offer unexpected connections. Challenge assumptions. Brainstorm freely. Push boundaries. Encourage wild ideas before narrowing down.`;
      case 'sentinel':
        return `## Mode: Sentinel
Be vigilant and protective. Surface risks proactively. Question assumptions about safety, security, and privacy. Flag potential issues before they become problems.`;
      default:
        return '';
    }
  }

  async #persist() {
    if (!this.#state) return;
    await this.#state.write('profile', this.#profile);
  }
}
