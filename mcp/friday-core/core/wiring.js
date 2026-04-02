/**
 * Cross-Subsystem Event Wiring -- Agent Friday's central nervous system
 *
 * Connects subsystems to each other's events via the shared event bus.
 * Every subscriber is wrapped in try/catch so one broken handler never
 * crashes the bus. This is glue code only -- no business logic lives here.
 *
 * Called once after registry.startAll() completes.
 */

import { EpistemicTracker } from './eis.js';

const LOG_PREFIX = '[wiring]';

function warn(msg, err) {
  process.stderr.write(`${LOG_PREFIX} ${msg}: ${err?.message || err}\n`);
}

/**
 * Wire all cross-subsystem event subscriptions.
 * @param {import('./subsystem.js').SubsystemRegistry} registry
 * @param {import('./event-bus.js').FridayEventBus} eventBus
 */
export function wireSubsystems(registry, eventBus) {

  // -----------------------------------------------------------------------
  // Epistemic Independence Score -- tracks user's critical engagement
  // -----------------------------------------------------------------------
  const epistemicTracker = new EpistemicTracker({ eventBus, logger: { info: (m) => process.stderr.write(`${LOG_PREFIX} ${m}\n`), warn: (m) => process.stderr.write(`${LOG_PREFIX} ${m}\n`) } });

  // Feed LLM interaction completions into the EIS tracker.
  // If no pre-extracted signals object is present, synthesise basic signals
  // from the event payload so the tracker always receives something.
  eventBus.on('llm:request-completed', (event) => {
    try {
      const d = event.data || {};
      const signals = d.signals ?? {
        hadCorrection: false,
        hadVerification: false,
        queryComplexity: d.queryComplexity ?? 1,
        hadRejection: false,
      };
      epistemicTracker.recordInteraction(signals);
    } catch (e) { warn('eis on llm:request-completed', e); }
  });

  // Pass EIS tracker to personality subsystem for score access
  try {
    const personality = registry.get('personality');
    if (personality) personality.epistemicTracker = epistemicTracker;
  } catch (e) { warn('eis personality binding', e); }

  // EIS recommendation feedback loop: when EIS score drops and the tracker
  // recommends a higher challenge level, apply it to the personality profile.
  // --- TUNABLE: CHANGE_THRESHOLD in eis.js controls publish frequency ---
  eventBus.on('eis:updated', (event) => {
    try {
      const recommendation = event.data?.recommendation;
      if (recommendation === 'increase_challenge_level') {
        const personality = registry.get('personality');
        if (personality?.profile) {
          const current = personality.profile.getProfile();
          const newLevel = Math.min(5, (current.challengeLevel ?? 3) + 1);
          personality.profile.setChallengeLevel(newLevel).catch(() => {});
          process.stderr.write(`${LOG_PREFIX} EIS declining — challenge level raised to ${newLevel}\n`);
        }
      }
    } catch (e) { warn('eis:updated feedback loop', e); }
  });

  // -----------------------------------------------------------------------
  // vault:unlocked -> personality loads, memory loads, context loads,
  //                   trust decays, connectors detect
  // Sequence matters: personality first (shapes greeting), then memory, then rest.
  // -----------------------------------------------------------------------
  eventBus.on('vault:unlocked', async (_event) => {
    try { await registry.get('personality')?.start?.(); } catch (e) { warn('personality load on unlock', e); }
    try { await registry.get('memory')?.start?.(); } catch (e) { warn('memory load on unlock', e); }
    try { await registry.get('context')?.start?.(); } catch (e) { warn('context load on unlock', e); }
    try { await registry.get('trust')?.start?.(); } catch (e) { warn('trust load on unlock', e); }
    try { await registry.get('connectors')?.registry?.initialize?.(); } catch (e) { warn('connectors detect on unlock', e); }
  });

  // -----------------------------------------------------------------------
  // vault:locking -> memory consolidates, context saves, everything flushes
  // -----------------------------------------------------------------------
  eventBus.on('vault:locking', async (_event) => {
    try { await registry.get('memory')?.stop?.(); } catch (e) { warn('memory flush on lock', e); }
    try { await registry.get('context')?.stop?.(); } catch (e) { warn('context flush on lock', e); }
    try { await registry.get('trust')?.stop?.(); } catch (e) { warn('trust flush on lock', e); }
    try { await registry.get('personality')?.stop?.(); } catch (e) { warn('personality flush on lock', e); }
  });

  // -----------------------------------------------------------------------
  // memory:stored -> context adds entity, personality notes observation
  // Uses _fromWiring flag to prevent feedback loops.
  // -----------------------------------------------------------------------
  eventBus.on('memory:stored', (event) => {
    if (event.data?._fromWiring) return;

    try {
      const ctx = registry.get('context');
      if (ctx?.graph && event.data?.content) {
        ctx.graph.processEvent(event);
      }
    } catch (e) { warn('context on memory:stored', e); }

    try {
      const personality = registry.get('personality');
      if (personality?.sentiment && event.data?.content) {
        personality.sentiment.analyse(event.data.content);
      }
    } catch (e) { warn('personality on memory:stored', e); }
  });

  // -----------------------------------------------------------------------
  // trust:evidence-added -> gateway refreshes
  // NOTE (ARCH-001): memory storage is handled directly by MemorySubsystem.registerEvents()
  // to avoid double-writing. Do NOT publish memory:store-request here.
  // -----------------------------------------------------------------------
  eventBus.on('trust:evidence-added', (_event) => {
    try {
      registry.get('gateway')?.refresh?.();
    } catch (e) { warn('gateway on trust:evidence-added', e); }
  });

  // -----------------------------------------------------------------------
  // trust:score-updated -> briefing notes for next daily
  // -----------------------------------------------------------------------
  eventBus.on('trust:score-updated', (event) => {
    try {
      const briefing = registry.get('briefing');
      if (briefing?.daily && event.data?.personName) {
        briefing.daily.queueNote?.({
          type: 'trust-change',
          summary: `Trust updated for ${event.data.personName}: ${event.data.overall?.toFixed?.(2) ?? '?'}`,
          timestamp: event.timestamp,
        });
      }
    } catch (e) { warn('briefing on trust:score-updated', e); }
  });

  // -----------------------------------------------------------------------
  // agent:completed -> trust updates agent performance
  // NOTE (ARCH-001): memory storage is handled directly by MemorySubsystem.registerEvents()
  // to avoid double-writing. Do NOT publish memory:store-request here.
  // -----------------------------------------------------------------------
  eventBus.on('agent:completed', (event) => {
    try {
      const trust = registry.get('trust');
      if (trust?.graph && event.data?.agentName && event.data?.success !== undefined) {
        trust.graph.processAgentResult?.(event.data);
      }
    } catch (e) { warn('trust on agent:completed', e); }
  });

  // -----------------------------------------------------------------------
  // privacy:scrubbed -> enterprise logs, update session stats
  // -----------------------------------------------------------------------
  eventBus.on('privacy:scrubbed', (event) => {
    try {
      const enterprise = registry.get('enterprise');
      enterprise?.consent?.logEvent?.('privacy_scrub', {
        categoriesFound: event.data?.categoriesFound || [],
        timestamp: event.timestamp,
      });
    } catch (e) { warn('enterprise on privacy:scrubbed', e); }
  });

  // -----------------------------------------------------------------------
  // connector:detected -> tools registry auto-registers
  // -----------------------------------------------------------------------
  eventBus.on('connector:detected', (event) => {
    try {
      const tools = registry.get('tools');
      if (tools?.started && event.data?.connectorId) {
        tools.refreshConnectorTools?.(event.data.connectorId);
      }
    } catch (e) { warn('tools on connector:detected', e); }
  });

  // -----------------------------------------------------------------------
  // enterprise:commitment-created -> briefing queues for next daily
  // -----------------------------------------------------------------------
  eventBus.on('enterprise:commitment-created', (event) => {
    try {
      const briefing = registry.get('briefing');
      if (briefing?.daily && event.data?.description) {
        briefing.daily.queueNote?.({
          type: 'commitment',
          summary: `New commitment: ${event.data.description} (${event.data.personName || 'unknown'})`,
          timestamp: event.timestamp,
        });
      }
    } catch (e) { warn('briefing on enterprise:commitment-created', e); }
  });

  // -----------------------------------------------------------------------
  // session:end -> memory consolidates, context saves, everything flushes
  // -----------------------------------------------------------------------
  eventBus.on('session:end', async (_event) => {
    try { await registry.get('memory')?.stop?.(); } catch (e) { warn('memory on session:end', e); }
    try { await registry.get('context')?.stop?.(); } catch (e) { warn('context on session:end', e); }
    try { await registry.get('trust')?.stop?.(); } catch (e) { warn('trust on session:end', e); }
    try { await registry.get('personality')?.stop?.(); } catch (e) { warn('personality on session:end', e); }
    try { await registry.get('enterprise')?.stop?.(); } catch (e) { warn('enterprise on session:end', e); }
  });

  // -- Expose tracker for external access ---------------------------------
  return { epistemicTracker };
}
