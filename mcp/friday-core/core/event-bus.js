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

    this.emit(topic, event);
    this.emit('*', event);
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

  #prune() {
    const now = Date.now();
    while (this.#buffer.length > this.#maxBufferSize) this.#buffer.shift();
    while (this.#buffer.length > 0 && (now - this.#buffer[0].timestamp) > this.#maxBufferAgeMs) {
      this.#buffer.shift();
    }
  }
}
