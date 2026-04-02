/**
 * Session Conductor -- Orchestrates session start/end lifecycle.
 *
 * Listens for vault:unlocked and vault:locking on the event bus.
 * On start: detects working directory context, checks overdue commitments,
 * checks if the daily briefing is stale, and composes a natural greeting.
 * On end: records a session summary and publishes session:end.
 */

import path from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export class SessionConductor {
  #registry;
  #eventBus;
  #vault;
  #logger;
  #sessionStartTime = null;
  #greeting = null;
  #cwdContext = null;
  #pendingCommitments = [];

  constructor({ registry, eventBus, vault, logger }) {
    this.#registry = registry;
    this.#eventBus = eventBus;
    this.#vault = vault;
    this.#logger = logger;
  }

  wire() {
    this.#eventBus.on('vault:unlocked', () => {
      this.#onSessionStart().catch((err) => this.#logger.error(`Session start failed: ${err?.message || err}`));
    });
    this.#eventBus.on('vault:locking', () => {
      this.#onSessionEnd().catch((err) => this.#logger.error(`Session end failed: ${err?.message || err}`));
    });
  }

  async #onSessionStart() {
    this.#sessionStartTime = Date.now();

    // 1. Detect working directory context
    this.#cwdContext = this.#detectCwd();

    // 2. Check for overdue commitments
    this.#pendingCommitments = this.#checkCommitments();

    // 3. Check if daily briefing is stale
    const briefingStale = this.#checkBriefingStale();

    // 4. Compose greeting
    this.#greeting = this.#composeGreeting(this.#cwdContext, this.#pendingCommitments, briefingStale);

    // 5. Publish session:start
    this.#eventBus.publish('session:start', {
      timestamp: this.#sessionStartTime,
      cwd: this.#cwdContext,
      pendingCommitments: this.#pendingCommitments.length,
      briefingStale,
    });

    this.#logger.info(`Session started in ${this.#cwdContext.projectName}${this.#cwdContext.gitBranch ? ` (${this.#cwdContext.gitBranch})` : ''}`);
  }

  async #onSessionEnd() {
    const duration = this.#sessionStartTime ? Date.now() - this.#sessionStartTime : 0;
    const summary = {
      startedAt: this.#sessionStartTime,
      duration,
      durationMin: Math.round(duration / 60000),
      cwd: this.#cwdContext,
      pendingCommitments: this.#pendingCommitments.length,
    };

    this.#eventBus.publish('session:end', { summary });
    this.#logger.info(`Session ended after ${summary.durationMin}min`);

    // Reset session state so getters do not expose stale data after lock.
    this.#sessionStartTime = null;
    this.#greeting = null;
    this.#cwdContext = null;
    this.#pendingCommitments = [];
  }

  #detectCwd() {
    const projectRoot = process.env.CLAUDE_PROJECT_ROOT || process.cwd();
    let gitBranch = null;
    try {
      gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: projectRoot,
        stdio: 'pipe',
      }).toString().trim();
    } catch { /* not a git repo */ }

    let packageName = null;
    try {
      const raw = readFileSync(path.join(projectRoot, 'package.json'), 'utf-8');
      packageName = JSON.parse(raw).name;
    } catch { /* no package.json */ }

    return {
      projectRoot,
      projectName: packageName || path.basename(projectRoot),
      gitBranch,
    };
  }

  #checkCommitments() {
    try {
      const enterprise = this.#registry.get('enterprise');
      if (enterprise?.commitments) {
        return enterprise.commitments.getOverdueCommitments();
      }
    } catch { /* subsystem not ready */ }
    return [];
  }

  #checkBriefingStale() {
    try {
      const briefing = this.#registry.get('briefing');
      if (briefing?.daily) {
        return briefing.daily.isBriefingStale('morning');
      }
    } catch { /* subsystem not ready */ }
    return true;
  }

  #composeGreeting(cwd, commitments, briefingStale) {
    // Pull personality mode if available
    let mode = 'partner';
    let userName = 'Boss';
    try {
      const personality = this.#registry.get('personality');
      if (personality?.profile) {
        const p = personality.profile.getProfile();
        mode = p.mode || 'partner';
        userName = p.userName || 'Boss';
      }
    } catch { /* use defaults */ }

    // Build context-aware greeting parts
    const parts = [];
    const hour = new Date().getHours();
    const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';

    if (mode === 'focus') {
      parts.push(`Ready. ${cwd.projectName}${cwd.gitBranch ? ` on ${cwd.gitBranch}` : ''}.`);
    } else {
      parts.push(`Good ${timeOfDay}, ${userName}. We're in ${cwd.projectName}${cwd.gitBranch ? ` on ${cwd.gitBranch}` : ''}.`);
    }

    if (commitments.length > 0) {
      const count = commitments.length;
      parts.push(`${count} overdue commitment${count !== 1 ? 's' : ''} need${count === 1 ? 's' : ''} attention.`);
    }

    if (briefingStale && mode !== 'focus') {
      parts.push('Daily briefing is stale. Want me to generate a fresh one?');
    }

    return parts.join(' ');
  }

  get greeting() { return this.#greeting; }
  get cwdContext() { return this.#cwdContext; }
  get pendingCommitments() { return this.#pendingCommitments; }
  get uptime() { return this.#sessionStartTime ? Date.now() - this.#sessionStartTime : 0; }
}
