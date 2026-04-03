/**
 * Gateway Audit Log -- Append-only log of all gateway actions.
 *
 * Ported from nexus-os: gateway/audit-log.ts
 * Removed: Electron imports, filesystem WriteStream, app.getPath.
 * Changed: Uses vault-backed state array instead of JSONL files.
 *
 * Every inbound and outbound gateway message is recorded. The log rotates
 * monthly by key prefix. This is a security requirement for forensic
 * evidence on trust-boundary violations.
 */

const MAX_ENTRIES_PER_MONTH = 5000;
const TEXT_TRUNCATE_LENGTH = 500;

export class AuditLog {
  #entries = [];
  #state = null;
  #currentMonth = '';
  // #saveQueued replaced by #saveTimer (see #queueSave)

  async initialize(state) {
    this.#state = state;
    this.#currentMonth = this.#getMonth();

    try {
      const result = await state.read(`audit-${this.#currentMonth}`);
      const saved = result?.success ? result.data : null;
      if (Array.isArray(saved)) {
        this.#entries = saved;
      }
    } catch {
      this.#entries = [];
    }
  }

  // -- Logging methods ------------------------------------------------------

  async log(entry) {
    try {
      const month = this.#getMonth();
      if (month !== this.#currentMonth) {
        // Month rotated; cancel pending timer and flush old month
        this.#cancelPendingSave();
        await this.#save();
        this.#currentMonth = month;
        this.#entries = [];
      }

      const safe = {
        ...entry,
        text: entry.text ? entry.text.slice(0, TEXT_TRUNCATE_LENGTH) : '',
      };
      this.#entries.push(safe);

      if (this.#entries.length > MAX_ENTRIES_PER_MONTH) {
        this.#entries = this.#entries.slice(-MAX_ENTRIES_PER_MONTH);
      }

      this.#queueSave();
    } catch (err) {
      process.stderr.write('[friday:audit] Write failed: ' + (err instanceof Error ? err.message : 'Unknown error') + '\n');
    }
  }

  async logInbound(channel, senderId, trust, text, msgId) {
    await this.log({
      ts: Date.now(),
      dir: 'in',
      channel,
      sender: senderId,
      trust,
      text: text || '',
      msgId,
    });
  }

  async logOutbound(channel, recipientId, text, toolCalls, durationMs) {
    await this.log({
      ts: Date.now(),
      dir: 'out',
      channel,
      recipient: recipientId,
      text: text || '',
      toolCalls,
      durationMs,
    });
  }

  // -- Query methods --------------------------------------------------------

  getEntries(limit = 50, direction) {
    let filtered = this.#entries;
    if (direction) {
      filtered = filtered.filter((e) => e.dir === direction);
    }
    return filtered.slice(-limit);
  }

  getStats() {
    const inbound = this.#entries.filter((e) => e.dir === 'in').length;
    const outbound = this.#entries.filter((e) => e.dir === 'out').length;
    return {
      month: this.#currentMonth,
      totalEntries: this.#entries.length,
      inbound,
      outbound,
    };
  }

  // -- Private helpers ------------------------------------------------------

  #getMonth() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  #saveTimer = null;

  #queueSave() {
    if (this.#saveTimer || !this.#state) return;
    this.#saveTimer = setTimeout(() => {
      this.#saveTimer = null;
      this.#save();
    }, 2000);
  }

  #cancelPendingSave() {
    if (this.#saveTimer) {
      clearTimeout(this.#saveTimer);
      this.#saveTimer = null;
    }
  }

  async #save() {
    try {
      if (this.#state) {
        await this.#state.write(`audit-${this.#currentMonth}`, this.#entries);
      }
    } catch {
      // Best effort
    }
  }
}
