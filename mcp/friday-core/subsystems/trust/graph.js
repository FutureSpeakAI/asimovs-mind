/**
 * Trust Graph — Person-level trust scoring with hermeneutic re-evaluation
 *
 * Models every person in the user's world with multi-dimensional trust scoring,
 * evidence tracking, person resolution (fuzzy alias matching), and hermeneutic
 * re-evaluation. Each new observation re-evaluates the whole picture.
 *
 * Ported from nexus-os: trust-graph.ts. Stripped Electron, vault crypto, IPC.
 * Uses this.state for persistence, no file I/O.
 */

import crypto from 'node:crypto';

/* -- Constants -- */

const MAX_PERSONS = 200;
const MAX_EVIDENCE_PER_PERSON = 50;
const MAX_COMM_LOG_PER_PERSON = 30;
const MAX_SENTIMENT_PER_PERSON = 20;
const TRUST_FLOOR = 0.3;
const HALF_LIFE_DAYS = 30;
const HALF_LIFE_MS = HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
const RE_EVAL_THRESHOLD = 5;
const EVIDENCE_RETENTION_DAYS = 90;

/* -- Utilities -- */

function normalizeName(name) {
  return name.toLowerCase().trim().replace(/\s+/g, ' ');
}

function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function generateId() {
  return crypto.randomUUID().slice(0, 12);
}

function createPersonNode(primaryName, aliasType = 'name') {
  return {
    id: generateId(),
    primaryName,
    aliases: [{ value: primaryName, type: aliasType, confidence: 1.0 }],
    trust: {
      overall: 0.5,
      reliability: 0.5,
      expertise: [],
      emotionalTrust: 0.5,
      timeliness: 0.5,
      informationQuality: 0.5,
    },
    evidence: [],
    communicationLog: [],
    sentiment: [],
    domains: [],
    relationships: [],
    notes: '',
    firstSeen: Date.now(),
    lastSeen: Date.now(),
    interactionCount: 0,
  };
}

/* -- Overall composite formula (shared) -- */

function computeOverall(trust) {
  const expertiseAvg =
    trust.expertise.length > 0
      ? trust.expertise.reduce((s, e) => s + e.score, 0) / trust.expertise.length
      : 0.5;

  return clamp(
    trust.reliability * 0.3 +
      trust.emotionalTrust * 0.2 +
      trust.timeliness * 0.15 +
      trust.informationQuality * 0.25 +
      expertiseAvg * 0.1,
    0,
    1
  );
}

/* -- Trust label -- */

function trustLabel(score) {
  if (score >= 0.85) return 'very high';
  if (score >= 0.7) return 'high';
  if (score >= 0.55) return 'moderate';
  if (score >= 0.4) return 'developing';
  if (score >= 0.25) return 'low';
  return 'very low';
}

function inferAliasType(identifier) {
  if (identifier.includes('@') && identifier.includes('.')) return 'email';
  if (identifier.startsWith('@')) return 'handle';
  if (/^\+?[\d\s()-]{7,}$/.test(identifier)) return 'phone';
  return 'name';
}

/* ====================================================================
   TRUST GRAPH ENGINE
   ==================================================================== */

export class TrustGraph {
  #persons = [];
  #evidenceCountSinceReEval = new Map();
  #state = null; // subsystem state namespace
  #dirty = false;
  #saveTimer = null;

  /** Initialize from persisted state */
  async initialize(state) {
    this.#state = state;
    const saved = await state.read('graph');
    if (saved) {
      this.#persons = saved.persons || [];
    }
    this.#applyDecay();
    this.#pruneEvidence();
  }

  /** Persist current graph data */
  async save() {
    if (!this.#state) return;
    await this.#state.write('graph', { persons: this.#persons });
    this.#dirty = false;
  }

  #scheduleSave() {
    this.#dirty = true;
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => this.save().catch(() => {}), 2000);
  }

  /* -- Person Resolution (Hermeneutic) -- */

  /**
   * Given an identifier (name, email, handle, etc.), resolve to an existing
   * PersonNode or create a new one.
   *
   * Resolution priority:
   * 1. Exact alias match (case-insensitive)
   * 2. Normalized name match
   * 3. Levenshtein distance <= 2 for names (fuzzy)
   * 4. First-name unique match
   * 5. Create new node (with LRU eviction if at max)
   */
  resolvePerson(identifier, type) {
    if (!identifier || !identifier.trim()) {
      return { person: null, confidence: 0, isNew: false };
    }

    const normalized = normalizeName(identifier);
    const aliasType = type || inferAliasType(identifier);

    // 1. Exact alias match
    for (const person of this.#persons) {
      for (const alias of person.aliases) {
        if (normalizeName(alias.value) === normalized) {
          return { person, confidence: 1.0, isNew: false };
        }
      }
    }

    // 2. Normalized primary name match
    for (const person of this.#persons) {
      if (normalizeName(person.primaryName) === normalized) {
        return { person, confidence: 0.95, isNew: false };
      }
    }

    // 3. Fuzzy name match (Levenshtein <= 2, names only)
    if (aliasType === 'name' || aliasType === 'nickname') {
      let bestMatch = null;
      let bestDistance = Infinity;

      for (const person of this.#persons) {
        const dist = levenshtein(normalized, normalizeName(person.primaryName));
        if (dist <= 2 && dist < bestDistance) {
          bestMatch = person;
          bestDistance = dist;
        }
        for (const alias of person.aliases) {
          if (alias.type === 'name' || alias.type === 'nickname') {
            const aDist = levenshtein(normalized, normalizeName(alias.value));
            if (aDist <= 2 && aDist < bestDistance) {
              bestMatch = person;
              bestDistance = aDist;
            }
          }
        }
      }

      if (bestMatch && bestDistance <= 2) {
        const existingAlias = bestMatch.aliases.find(
          (a) => normalizeName(a.value) === normalized
        );
        if (!existingAlias) {
          bestMatch.aliases.push({
            value: identifier.trim(),
            type: aliasType,
            confidence: bestDistance === 0 ? 1.0 : bestDistance === 1 ? 0.85 : 0.7,
          });
          this.#scheduleSave();
        }
        return {
          person: bestMatch,
          confidence: bestDistance === 0 ? 0.95 : bestDistance === 1 ? 0.8 : 0.65,
          isNew: false,
        };
      }
    }

    // 4. Partial first-name match
    if (aliasType === 'name' && normalized.split(' ').length === 1) {
      const matches = this.#persons.filter((p) => {
        const pFirst = normalizeName(p.primaryName).split(' ')[0];
        return pFirst === normalized;
      });
      if (matches.length === 1) {
        return { person: matches[0], confidence: 0.75, isNew: false };
      }
    }

    // 5. Create new node (LRU eviction)
    if (this.#persons.length >= MAX_PERSONS) {
      this.#persons.sort((a, b) => {
        const scoreDiff = a.interactionCount - b.interactionCount;
        if (scoreDiff !== 0) return scoreDiff;
        return a.lastSeen - b.lastSeen;
      });
      this.#persons.shift();
    }

    const newPerson = createPersonNode(identifier.trim(), aliasType);
    this.#persons.push(newPerson);
    this.#scheduleSave();

    return { person: newPerson, confidence: 1.0, isNew: true };
  }

  /* -- Trust Evidence -- */

  /**
   * Add a piece of trust evidence to a person.
   * Triggers hermeneutic re-evaluation if threshold reached.
   */
  addEvidence(personId, evidence) {
    const person = this.getPersonById(personId);
    if (!person) return;

    const fullEvidence = {
      ...evidence,
      id: generateId(),
      timestamp: Date.now(),
      impact: clamp(evidence.impact, -1, 1),
    };

    person.evidence.push(fullEvidence);
    person.lastSeen = Date.now();
    person.interactionCount++;

    if (evidence.domain && !person.domains.includes(evidence.domain)) {
      person.domains.push(evidence.domain);
    }

    // Cap evidence — favor recency
    if (person.evidence.length > MAX_EVIDENCE_PER_PERSON) {
      person.evidence.sort((a, b) => {
        const ageDiff = b.timestamp - a.timestamp;
        const impactDiff = Math.abs(b.impact) - Math.abs(a.impact);
        return impactDiff * 0.3 + ageDiff * 0.7;
      });
      person.evidence = person.evidence.slice(0, MAX_EVIDENCE_PER_PERSON);
    }

    // Track for re-evaluation threshold
    const count = (this.#evidenceCountSinceReEval.get(personId) || 0) + 1;
    this.#evidenceCountSinceReEval.set(personId, count);

    if (count >= RE_EVAL_THRESHOLD) {
      this.recomputeTrust(personId);
      this.#evidenceCountSinceReEval.set(personId, 0);
    } else {
      this.#quickUpdateTrust(person, fullEvidence);
    }

    this.#scheduleSave();
  }

  /**
   * HERMENEUTIC CIRCLE: Full re-evaluation of ALL trust dimensions
   * from ALL evidence. Weighted by recency (exponential decay) and impact.
   */
  recomputeTrust(personId) {
    const person = this.getPersonById(personId);
    if (!person || person.evidence.length === 0) return;

    const now = Date.now();
    const weighted = person.evidence.map((e) => ({
      ...e,
      weight: Math.pow(0.5, (now - e.timestamp) / HALF_LIFE_MS) * Math.max(0.1, Math.abs(e.impact)),
    }));

    // Reliability: kept vs broken promises
    const promises = weighted.filter(
      (e) => e.type === 'promise_kept' || e.type === 'promise_broken'
    );
    if (promises.length > 0) {
      const kept = promises.filter((e) => e.type === 'promise_kept').reduce((s, e) => s + e.weight, 0);
      const total = promises.reduce((s, e) => s + e.weight, 0);
      person.trust.reliability = clamp(kept / total, 0, 1);
    }

    // Information quality
    const info = weighted.filter(
      (e) => e.type === 'accurate_info' || e.type === 'inaccurate_info'
    );
    if (info.length > 0) {
      const accurate = info.filter((e) => e.type === 'accurate_info').reduce((s, e) => s + e.weight, 0);
      const total = info.reduce((s, e) => s + e.weight, 0);
      person.trust.informationQuality = clamp(accurate / total, 0, 1);
    }

    // Emotional trust
    const emotional = weighted.filter((e) => e.type === 'emotional_support');
    if (emotional.length > 0) {
      const raw =
        emotional.reduce((s, e) => s + (e.impact > 0 ? e.weight : -e.weight), 0) /
        emotional.reduce((s, e) => s + e.weight, 0);
      person.trust.emotionalTrust = clamp((raw + 1) / 2, 0, 1);
    }

    // Timeliness
    const actions = weighted.filter(
      (e) => e.type === 'helpful_action' || e.type === 'unhelpful_action'
    );
    if (actions.length > 0) {
      const helpful = actions.filter((e) => e.type === 'helpful_action').reduce((s, e) => s + e.weight, 0);
      const total = actions.reduce((s, e) => s + e.weight, 0);
      person.trust.timeliness = clamp(helpful / total, 0, 1);
    }

    // Domain expertise
    const domainMap = new Map();
    for (const e of weighted) {
      if (e.domain) {
        const d = domainMap.get(e.domain) || { positive: 0, total: 0, count: 0 };
        d.total += e.weight;
        d.count++;
        if (e.impact > 0) d.positive += e.weight;
        domainMap.set(e.domain, d);
      }
    }
    person.trust.expertise = Array.from(domainMap.entries()).map(([domain, { positive, total, count }]) => ({
      domain,
      score: clamp(positive / total, 0, 1),
      basis: `${count} observations`,
    }));

    // Overall composite
    person.trust.overall = computeOverall(person.trust);
  }

  /** Quick incremental update from a single piece of evidence */
  #quickUpdateTrust(person, evidence) {
    const blend = 0.15;

    switch (evidence.type) {
      case 'promise_kept':
      case 'promise_broken':
        person.trust.reliability = clamp(person.trust.reliability + blend * evidence.impact, 0, 1);
        break;
      case 'accurate_info':
      case 'inaccurate_info':
        person.trust.informationQuality = clamp(person.trust.informationQuality + blend * evidence.impact, 0, 1);
        break;
      case 'emotional_support':
        person.trust.emotionalTrust = clamp(person.trust.emotionalTrust + blend * evidence.impact, 0, 1);
        break;
      case 'helpful_action':
      case 'unhelpful_action':
        person.trust.timeliness = clamp(person.trust.timeliness + blend * evidence.impact, 0, 1);
        break;
    }

    person.trust.overall = computeOverall(person.trust);
  }

  /* -- Communication Tracking -- */

  logCommunication(personId, event) {
    const person = this.getPersonById(personId);
    if (!person) return;

    person.communicationLog.push({ ...event, timestamp: Date.now() });
    person.sentiment.push({
      timestamp: Date.now(),
      score: clamp(event.sentiment, -1, 1),
      context: event.summary,
    });

    if (person.communicationLog.length > MAX_COMM_LOG_PER_PERSON) {
      person.communicationLog = person.communicationLog.slice(-MAX_COMM_LOG_PER_PERSON);
    }
    if (person.sentiment.length > MAX_SENTIMENT_PER_PERSON) {
      person.sentiment = person.sentiment.slice(-MAX_SENTIMENT_PER_PERSON);
    }

    person.lastSeen = Date.now();
    person.interactionCount++;
    this.#scheduleSave();
  }

  /* -- Queries -- */

  getPersonById(id) {
    return this.#persons.find((p) => p.id === id) || null;
  }

  getAllPersons() {
    return [...this.#persons].sort((a, b) => b.lastSeen - a.lastSeen);
  }

  getPersonCount() {
    return this.#persons.length;
  }

  getMostTrusted(limit = 10) {
    return [...this.#persons].sort((a, b) => b.trust.overall - a.trust.overall).slice(0, limit);
  }

  getRecentInteractions(limit = 10) {
    return [...this.#persons].sort((a, b) => b.lastSeen - a.lastSeen).slice(0, limit);
  }

  findByDomain(domain) {
    const normalized = domain.toLowerCase();
    return this.#persons.filter(
      (p) =>
        p.domains.some((d) => d.toLowerCase().includes(normalized)) ||
        p.trust.expertise.some((e) => e.domain.toLowerCase().includes(normalized))
    );
  }

  /* -- Context Generation -- */

  getContextForPerson(personId) {
    const person = this.getPersonById(personId);
    if (!person) return '';

    const lines = [];
    lines.push(`### ${person.primaryName}`);

    const label = trustLabel(person.trust.overall);
    lines.push(`Trust: ${label} (${(person.trust.overall * 100).toFixed(0)}%)`);

    const dims = [];
    if (person.trust.reliability !== 0.5) dims.push(`reliability: ${(person.trust.reliability * 100).toFixed(0)}%`);
    if (person.trust.informationQuality !== 0.5) dims.push(`info quality: ${(person.trust.informationQuality * 100).toFixed(0)}%`);
    if (person.trust.emotionalTrust !== 0.5) dims.push(`emotional: ${(person.trust.emotionalTrust * 100).toFixed(0)}%`);
    if (person.trust.timeliness !== 0.5) dims.push(`timeliness: ${(person.trust.timeliness * 100).toFixed(0)}%`);
    if (dims.length > 0) lines.push(`  [${dims.join(', ')}]`);

    if (person.trust.expertise.length > 0) {
      const expertises = person.trust.expertise
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map((e) => `${e.domain} (${(e.score * 100).toFixed(0)}%)`)
        .join(', ');
      lines.push(`Expertise: ${expertises}`);
    }

    if (person.domains.length > 0 && person.trust.expertise.length === 0) {
      lines.push(`Known domains: ${person.domains.slice(0, 8).join(', ')}`);
    }

    const recentEvidence = [...person.evidence]
      .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
      .slice(0, 3);
    if (recentEvidence.length > 0) {
      lines.push('Key observations:');
      for (const e of recentEvidence) {
        const sign = e.impact > 0 ? '+' : e.impact < 0 ? '-' : '~';
        lines.push(`  ${sign} ${e.description}`);
      }
    }

    if (person.sentiment.length >= 3) {
      const recent = person.sentiment.slice(-5);
      const avg = recent.reduce((s, p) => s + p.score, 0) / recent.length;
      const trend = avg > 0.2 ? 'positive' : avg < -0.2 ? 'negative' : 'neutral';
      lines.push(`Sentiment trend: ${trend}`);
    }

    if (person.notes) {
      lines.push(`Notes: ${person.notes}`);
    }

    const daysSinceFirst = Math.floor((Date.now() - person.firstSeen) / (1000 * 60 * 60 * 24));
    const daysSinceLast = Math.floor((Date.now() - person.lastSeen) / (1000 * 60 * 60 * 24));
    lines.push(`(${person.interactionCount} interactions over ${daysSinceFirst}d, last seen ${daysSinceLast}d ago)`);

    return lines.join('\n');
  }

  getPromptContext() {
    if (this.#persons.length === 0) return '';

    const now = Date.now();
    const scored = this.#persons.map((p) => {
      const daysSinceSeen = (now - p.lastSeen) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-daysSinceSeen / 14);
      const trustVariance = Math.abs(p.trust.overall - 0.5);
      const interactionScore = Math.min(p.interactionCount / 20, 1);
      return {
        person: p,
        relevance: recencyScore * 0.5 + trustVariance * 0.3 + interactionScore * 0.2,
      };
    });

    scored.sort((a, b) => b.relevance - a.relevance);
    const top = scored.slice(0, 15);
    if (top.length === 0) return '';

    const lines = ['KEY PEOPLE:'];
    for (const { person } of top) {
      const label = trustLabel(person.trust.overall);
      const domains = person.domains.slice(0, 3).join(', ');
      const domainsStr = domains ? ` | expertise: ${domains}` : '';
      let note = '';
      if (person.notes) {
        note = ` | note: ${person.notes.slice(0, 80)}`;
      } else if (person.evidence.length > 0) {
        const latest = person.evidence[person.evidence.length - 1];
        if (latest.description.length <= 60) {
          note = ` | latest: ${latest.description}`;
        }
      }
      lines.push(`- ${person.primaryName} (trust: ${label}${domainsStr}${note})`);
    }

    return lines.join('\n');
  }

  /* -- Person Management -- */

  addAlias(personId, alias, type, confidence = 0.9) {
    const person = this.getPersonById(personId);
    if (!person) return false;

    const normalized = normalizeName(alias);
    const existing = person.aliases.find((a) => normalizeName(a.value) === normalized);
    if (existing) {
      existing.confidence = Math.max(existing.confidence, confidence);
      return true;
    }

    person.aliases.push({ value: alias.trim(), type, confidence });
    this.#scheduleSave();
    return true;
  }

  updateNotes(personId, notes) {
    const person = this.getPersonById(personId);
    if (!person) return;
    person.notes = notes;
    this.#scheduleSave();
  }

  linkPersons(personIdA, personIdB, label) {
    const a = this.getPersonById(personIdA);
    const b = this.getPersonById(personIdB);
    if (!a || !b) return;

    if (!a.relationships.find((r) => r.personId === personIdB)) {
      a.relationships.push({ personId: personIdB, label });
    }
    if (!b.relationships.find((r) => r.personId === personIdA)) {
      b.relationships.push({ personId: personIdA, label });
    }
    this.#scheduleSave();
  }

  /** Process person mentions from memory extraction pipeline */
  async processPersonMentions(mentions) {
    for (const mention of mentions) {
      if (!mention.name || !mention.name.trim()) continue;
      const { person } = this.resolvePerson(mention.name, 'name');
      if (!person) continue;

      if (mention.evidenceType && mention.context) {
        this.addEvidence(person.id, {
          type: mention.evidenceType,
          description: mention.context,
          impact: mention.sentiment || 0,
          domain: mention.domains?.[0],
        });
      } else if (mention.context) {
        this.addEvidence(person.id, {
          type: 'observed',
          description: mention.context,
          impact: mention.sentiment || 0,
          domain: mention.domains?.[0],
        });
      }

      if (mention.domains) {
        for (const domain of mention.domains) {
          if (!person.domains.includes(domain)) {
            person.domains.push(domain);
          }
        }
      }

      if (mention.sentiment !== 0) {
        person.sentiment.push({
          timestamp: Date.now(),
          score: clamp(mention.sentiment, -1, 1),
          context: mention.context,
        });
        if (person.sentiment.length > MAX_SENTIMENT_PER_PERSON) {
          person.sentiment = person.sentiment.slice(-MAX_SENTIMENT_PER_PERSON);
        }
      }
    }
    this.#scheduleSave();
  }

  /* -- Maintenance -- */

  #applyDecay() {
    const now = Date.now();
    const msPerDay = 24 * 60 * 60 * 1000;

    for (const person of this.#persons) {
      const daysSinceSeen = (now - person.lastSeen) / msPerDay;
      if (daysSinceSeen < 1) continue;

      const decayFactor = 1 - 0.001 * daysSinceSeen;

      const decayDimension = (current) => {
        if (current <= TRUST_FLOOR) return current;
        return Math.max(TRUST_FLOOR, current * decayFactor);
      };

      person.trust.reliability = decayDimension(person.trust.reliability);
      person.trust.emotionalTrust = decayDimension(person.trust.emotionalTrust);
      person.trust.timeliness = decayDimension(person.trust.timeliness);
      person.trust.informationQuality = decayDimension(person.trust.informationQuality);

      for (const exp of person.trust.expertise) {
        exp.score = decayDimension(exp.score);
      }

      person.trust.overall = computeOverall(person.trust);
    }
  }

  #pruneEvidence() {
    const cutoffMs = EVIDENCE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - cutoffMs;

    for (const person of this.#persons) {
      if (person.evidence.length <= 5) continue;

      const byImpact = [...person.evidence].sort(
        (a, b) => Math.abs(b.impact) - Math.abs(a.impact)
      );
      const keepers = new Set(byImpact.slice(0, 5).map((e) => e.id));

      person.evidence = person.evidence.filter(
        (e) => keepers.has(e.id) || e.timestamp > cutoff
      );
    }
  }

  /** Status summary for debugging */
  getStatus() {
    return {
      personCount: this.#persons.length,
      maxPersons: MAX_PERSONS,
      topByTrust: this.getMostTrusted(5).map((p) => ({
        name: p.primaryName,
        overall: p.trust.overall,
        interactions: p.interactionCount,
      })),
    };
  }
}
