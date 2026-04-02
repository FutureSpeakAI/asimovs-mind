/**
 * Friday Event Bus — In-process pub/sub for subsystem coordination
 * Ported from nexus-os context-stream.ts
 */

import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export class FridayEventBus extends EventEmitter {
  #buffer = [];
  #maxBufferSize;
  #maxBufferAgeMs;
  #throttle = new Map();
  #throttleConfig = {};
  #stats = { published: 0, topics: new Set() };

  constructor(config = {}) {
    super();
    this.setMaxListeners(100);
    this.#maxBufferSize = config.maxBufferSize || 2000;
    this.#maxBufferAgeMs = config.maxBufferAgeMs || 4 * 60 * 60 * 1000;
  }

  publish(topic, data) {
    const now = Date.now();
    const minInterval = this.#throttleConfig[topic] || 0;
    const lastEmit = this.#throttle.get(topic) || 0;
    if (now - lastEmit < minInterval) return;
    this.#throttle.set(topic, now);

    const event = {
      id: crypto.randomUUID(),
      topic,
      timestamp: now,
      data
    };

    this.#buffer.push(event);
    this.#prune();
    this.#stats.published++;
    this.#stats.topics.add(topic);

    // --- TUNABLE ---
    // Dispatch to each listener individually so a throwing subscriber never
    // prevents subsequent subscribers from running. EventEmitter.emit() is
    // synchronous and propagates throws, which would silently drop all
    // downstream handlers and the wildcard channel. We iterate manually
    // instead of calling this.emit() directly.
    this.#safeDispatch(topic, event);
    this.#safeDispatch('*', event);
  }

  #safeDispatch(channel, event) {
    const listeners = this.rawListeners(channel);
    for (const listener of listeners) {
      try {
        // rawListeners() returns the wrapper for .once() handlers; call it
        // directly so EventEmitter's internal once-removal still fires.
        listener.call(this, event);
      } catch (err) {
        // Emit 'error' only if someone is listening, otherwise swallow to
        // prevent an uncaught exception from crashing the process.
        if (this.listenerCount('error') > 0) {
          this.emit('error', err);
        }
      }
    }
  }

  recent(topic, limit = 20) {
    const events = topic
      ? this.#buffer.filter(e => e.topic === topic)
      : this.#buffer;
    return events.slice(-limit);
  }

  setThrottle(topic, intervalMs) {
    this.#throttleConfig[topic] = intervalMs;
  }

  get stats() {
    return {
      published: this.#stats.published,
      topicCount: this.#stats.topics.size,
      topics: [...this.#stats.topics],
      bufferSize: this.#buffer.length
    };
  }

  reset() {
    this.#buffer = [];
    this.#throttle.clear();
    this.#stats = { published: 0, topics: new Set() };
    this.removeAllListeners();
  }

  // --- TUNABLE ---
  #prune() {
    const now = Date.now();
    const cutoff = now - this.#maxBufferAgeMs;
    // Walk from the front until we find the first entry that is both within
    // the age window AND within the size cap. One pass, one splice.
    const overSize = Math.max(0, this.#buffer.length - this.#maxBufferSize);
    let dropTo = overSize;
    while (dropTo < this.#buffer.length && this.#buffer[dropTo].timestamp < cutoff) {
      dropTo++;
    }
    if (dropTo > 0) this.#buffer.splice(0, dropTo);
  }
}
