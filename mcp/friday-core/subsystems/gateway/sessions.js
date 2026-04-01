/**
 * Gateway Session Management -- Per-sender conversation context.
 *
 * Ported from nexus-os: gateway/session-store.ts
 * Removed: Electron imports, singleton export.
 * Added: vault-backed persistence via state manager.
 *
 * Maintains a rolling window of recent messages per sender so Claude has
 * conversational context across gateway exchanges. This is distinct from
 * the 3-tier memory system:
 *   SessionStore = ephemeral conversation buffer (last N messages per sender)
 *   Memory system = persistent facts, observations, episodes
 */

const MAX_MESSAGES_PER_SENDER = 10;
const SESSION_EXPIRY_MS = 4 * 60 * 60 * 1000; // 4 hours

export class SessionStore {
  #sessions = new Map();
  #state = null;

  async initialize(state) {
    this.#state = state;
    try {
      const saved = await state.get('sessions');
      if (saved && typeof saved === 'object') {
        for (const [key, session] of Object.entries(saved)) {
          this.#sessions.set(key, session);
        }
      }
    } catch {
      // Fresh start
    }
  }

  // -- Session access -------------------------------------------------------

  #getSession(channel, senderId) {
    const key = `${channel}:${senderId}`;
    let session = this.#sessions.get(key);
    if (!session) {
      session = { senderId, channel, messages: [], lastActivity: Date.now() };
      this.#sessions.set(key, session);
    }
    return session;
  }

  // -- Message tracking -----------------------------------------------------

  addUserMessage(channel, senderId, text) {
    const session = this.#getSession(channel, senderId);
    session.messages.push({ role: 'user', content: text, timestamp: Date.now() });
    this.#trim(session);
    session.lastActivity = Date.now();
    this.#queueSave();
  }

  addAssistantMessage(channel, senderId, text) {
    const session = this.#getSession(channel, senderId);
    session.messages.push({ role: 'assistant', content: text, timestamp: Date.now() });
    this.#trim(session);
    session.lastActivity = Date.now();
    this.#queueSave();
  }

  // -- History retrieval ----------------------------------------------------

  getHistory(channel, senderId) {
    const key = `${channel}:${senderId}`;
    const session = this.#sessions.get(key);
    if (!session) return [];
    if (Date.now() - session.lastActivity > SESSION_EXPIRY_MS) {
      this.#sessions.delete(key);
      return [];
    }
    return session.messages.map((m) => ({ role: m.role, content: m.content }));
  }

  // -- Session management ---------------------------------------------------

  clearSession(channel, senderId) {
    this.#sessions.delete(`${channel}:${senderId}`);
    this.#queueSave();
  }

  pruneExpired() {
    const now = Date.now();
    let pruned = 0;
    for (const [key, session] of this.#sessions) {
      if (now - session.lastActivity > SESSION_EXPIRY_MS) {
        this.#sessions.delete(key);
        pruned++;
      }
    }
    if (pruned > 0) this.#queueSave();
    return pruned;
  }

  getActiveCount() {
    return this.#sessions.size;
  }

  listSessions() {
    const result = [];
    for (const [key, session] of this.#sessions) {
      result.push({
        key,
        channel: session.channel,
        senderId: session.senderId,
        messageCount: session.messages.length,
        lastActivity: session.lastActivity,
        expired: Date.now() - session.lastActivity > SESSION_EXPIRY_MS,
      });
    }
    return result;
  }

  // -- Private helpers ------------------------------------------------------

  #trim(session) {
    if (session.messages.length > MAX_MESSAGES_PER_SENDER) {
      session.messages = session.messages.slice(-MAX_MESSAGES_PER_SENDER);
    }
  }

  #saveQueued = false;

  #queueSave() {
    if (this.#saveQueued || !this.#state) return;
    this.#saveQueued = true;
    setTimeout(async () => {
      this.#saveQueued = false;
      try {
        const data = {};
        for (const [key, session] of this.#sessions) {
          data[key] = session;
        }
        await this.#state.set('sessions', data);
      } catch {
        // Best effort
      }
    }, 2000);
  }
}
