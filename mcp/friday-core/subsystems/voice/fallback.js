/**
 * Voice Fallback Manager -- Cascading fallback for voice paths.
 *
 * Ported from nexus-os: voice/voice-fallback-manager.ts + voice-health-monitor.ts
 * Removed: Electron, WebSocket management, AudioCapture, Whisper, TTS, Ollama,
 *          Gemini, speechSynthesis, transcriptionPipeline, settingsManager.
 * Changed: Pure state tracking (no hardware). friday-voice handles actual I/O.
 *
 * Voice paths, ordered richest to simplest:
 *   cloud       -- Gemini WebSocket (bidirectional audio, highest quality)
 *   personaplex -- PersonaPlex local full-duplex (GPU-accelerated)
 *   local       -- Whisper STT + Ollama LLM + TTS (offline)
 *   text        -- No voice at all (universal floor, never fails)
 *
 * This module tracks which path is active, what's been attempted, and cascades
 * through fallbacks on failure. It does NOT touch audio hardware.
 */

// -- Default priorities -------------------------------------------------------

const DEFAULT_PRIORITIES = {
  personaplex: 0,
  cloud: 1,
  local: 2,
  text: 99,
};

// -- Escalation levels (from health monitor) ----------------------------------

const ESCALATION_THRESHOLDS = { silent: 1, subtle: 2, visible: 3 };

function getEscalationLevel(failures) {
  if (failures >= ESCALATION_THRESHOLDS.visible) return 'visible';
  if (failures >= ESCALATION_THRESHOLDS.subtle) return 'subtle';
  return 'silent';
}

// -- Fallback Manager ---------------------------------------------------------

export class VoiceFallbackManager {
  #currentPath = null;
  #attemptedPaths = new Set();
  #pathErrors = [];
  #priorities = { ...DEFAULT_PRIORITIES };
  #switching = false;
  #pathAvailability = new Map();
  #eventBus = null;

  // Health monitor state
  #healthChecks = new Map(); // name -> { consecutiveFailures, lastCheckAt }

  initialize(eventBus) {
    this.#eventBus = eventBus;
  }

  // -- Path queries -----------------------------------------------------------

  getCurrentPath() {
    return this.#currentPath;
  }

  isSwitching() {
    return this.#switching;
  }

  getAttemptedPaths() {
    return [...this.#attemptedPaths];
  }

  getPathErrors() {
    return [...this.#pathErrors];
  }

  // -- Availability management ------------------------------------------------

  setPathAvailability(path, available, reason) {
    this.#pathAvailability.set(path, { available, reason });
  }

  getAvailability() {
    const configs = [];
    for (const path of ['personaplex', 'cloud', 'local', 'text']) {
      const info = this.#pathAvailability.get(path) || { available: path === 'text', reason: path === 'text' ? undefined : 'Not probed' };
      configs.push({
        path,
        available: info.available,
        reason: info.reason,
        priority: this.#priorities[path],
      });
    }
    configs.sort((a, b) => a.priority - b.priority);
    return configs;
  }

  // -- Path lifecycle ---------------------------------------------------------

  startPath(path) {
    this.#currentPath = path;
    this.#attemptedPaths.clear();
    this.#pathErrors = [];
    this.#switching = false;
    if (this.#eventBus) {
      this.#eventBus.emit('voice:path-started', { path });
    }
    return true;
  }

  recordPathFailure(path, error) {
    this.#attemptedPaths.add(path);
    this.#pathErrors.push({ path, error, at: Date.now() });

    if (this.#eventBus) {
      this.#eventBus.emit('voice:path-failed', { path, error });
    }

    // Find next available path
    const configs = this.getAvailability();
    for (const config of configs) {
      if (this.#attemptedPaths.has(config.path)) continue;
      if (!config.available) {
        this.#attemptedPaths.add(config.path);
        this.#pathErrors.push({ path: config.path, error: config.reason || 'unavailable', at: Date.now() });
        continue;
      }
      return { nextPath: config.path, exhausted: false };
    }

    // All exhausted
    this.#currentPath = 'text';
    if (this.#eventBus) {
      this.#eventBus.emit('voice:all-paths-exhausted', { errors: this.#pathErrors });
    }
    return { nextPath: 'text', exhausted: true };
  }

  notifyPathActive(path) {
    this.#currentPath = path;
    this.#attemptedPaths.clear();
    this.#pathErrors = [];
  }

  // -- Priority management ----------------------------------------------------

  setPathPriority(path, priority) {
    this.#priorities[path] = priority;
  }

  getPriorities() {
    return { ...this.#priorities };
  }

  // -- Health tracking --------------------------------------------------------

  recordHealthCheck(checkName, healthy) {
    let entry = this.#healthChecks.get(checkName);
    if (!entry) {
      entry = { consecutiveFailures: 0, lastCheckAt: null };
      this.#healthChecks.set(checkName, entry);
    }

    entry.lastCheckAt = Date.now();

    if (healthy) {
      const wasUnhealthy = entry.consecutiveFailures > 0;
      entry.consecutiveFailures = 0;
      if (wasUnhealthy && this.#eventBus) {
        this.#eventBus.emit('voice:health-recovered', { checkName });
      }
    } else {
      entry.consecutiveFailures++;
      const level = getEscalationLevel(entry.consecutiveFailures);
      if (this.#eventBus) {
        this.#eventBus.emit('voice:health-check-failed', {
          checkName,
          consecutiveFailures: entry.consecutiveFailures,
          escalationLevel: level,
        });
      }
    }
  }

  getHealthReport() {
    const report = {};
    for (const [name, entry] of this.#healthChecks) {
      report[name] = {
        healthy: entry.consecutiveFailures === 0,
        consecutiveFailures: entry.consecutiveFailures,
        lastCheckAt: entry.lastCheckAt,
        escalationLevel: getEscalationLevel(entry.consecutiveFailures),
      };
    }
    return report;
  }

  // -- Reset ------------------------------------------------------------------

  reset() {
    this.#currentPath = null;
    this.#attemptedPaths.clear();
    this.#pathErrors = [];
    this.#switching = false;
    this.#healthChecks.clear();
  }

  // -- Full snapshot ----------------------------------------------------------

  getSnapshot() {
    return {
      currentPath: this.#currentPath,
      attemptedPaths: [...this.#attemptedPaths],
      pathErrors: this.#pathErrors.map((e) => ({
        path: e.path,
        error: e.error,
        time: new Date(e.at).toISOString(),
      })),
      switching: this.#switching,
      priorities: { ...this.#priorities },
      availability: this.getAvailability(),
      healthReport: this.getHealthReport(),
    };
  }
}
