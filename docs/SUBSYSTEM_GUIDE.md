# Agent Friday -- Subsystem Guide

Reference for all 18 subsystems in the friday-core MCP server (v2.3.0). Each entry covers purpose, files, MCP tools, events, vault state, dependencies, and extension points.

---

## Tier 0: Foundation

Tier 0 subsystems have no dependencies and start in parallel.

### 1. Vault

**Purpose:** Encrypted persistent state storage for the entire system. Every other subsystem that persists data does so through the vault. Provides AES-256-GCM encryption, Argon2id key derivation, BLAKE2b sub-key hierarchy, canary-based passphrase verification, plaintext migration, and the Privacy Shield in-memory PII mapping store.

**Files:**
- `subsystems/vault/index.js` -- MCP tool registration, OllamaMonitor instance, registry stats
- `core/vault.js` -- `SovereignVault` class (lifecycle, state CRUD, HMAC, identity, attestation, Privacy Shield state) + re-exports `OllamaMonitor` for backward compatibility
- `core/crypto.js` -- All cryptographic primitives (SecureBuffer, Argon2id, BLAKE2b-KDF, AES-256-GCM, HMAC-SHA256, Ed25519, X25519, P2P message encryption)

**MCP Tools (10):**
| Tool | Description |
|------|-------------|
| `vault_status` | Vault lock state, subsystem health, Ollama connectivity, Privacy Shield status |
| `vault_initialize` | Create new vault with passphrase (>= 8 words) |
| `vault_unlock` | Derive keys, verify canary, publish `vault:unlocked` |
| `vault_lock` | Publish `vault:locking`, destroy all keys |
| `vault_read` | Read and decrypt a state entry |
| `vault_write` | Encrypt and persist a state entry |
| `vault_append` | Append to an encrypted array |
| `vault_delete` | Remove a state entry |
| `vault_list` | List all encrypted keys |
| `vault_export` | Export all state as decrypted JSON |

**Events Published:** `vault:unlocked`, `vault:locking`
**Events Subscribed:** None (other subsystems subscribe to vault events)

**Vault State Keys:** All root-level keys (this is the vault itself)

**Dependencies:** None (Tier 0)

**Extension:** To add a new vault operation, add a method to `SovereignVault` in `core/vault.js` and register a corresponding MCP tool in `subsystems/vault/index.js`.

---

### 2. Identity

**Purpose:** Cryptographic identity for the agent/node. Generates Ed25519 signing keypairs and X25519 key exchange keypairs via libsodium. Private keys are encrypted with the vault's identity sub-key before storage. Enables cLaw attestation (proving governance compliance to peers) and message signing.

**Files:**
- `subsystems/identity/index.js` -- MCP tools + `getCanonicalLaws()` utility

**MCP Tools (6):**
| Tool | Description |
|------|-------------|
| `identity_generate` | Generate signing + exchange keypairs, store encrypted |
| `identity_status` | Check if identity exists and show public keys |
| `identity_sign` | Sign a message with Ed25519 private key |
| `identity_verify` | Verify an Ed25519 signature |
| `attestation_generate` | Create cLaw attestation (SHA-256 laws hash + timestamp + signature) |
| `attestation_verify` | Verify a peer's attestation (hash match, 5-min expiry, signature) |

**Events:** None published or subscribed.

**Vault State Keys:** `agent-identity` (root-level, contains name, created_at, signing keypair, exchange keypair)

**Dependencies:** Vault (for key storage)

---

### 3. Privacy

**Purpose:** PII detection and scrubbing engine. Detects API keys (7 patterns), JWTs, credit card numbers (4 networks), SSNs, emails, phone numbers, public IP addresses, and filesystem paths containing the OS username. Uses FNV-1a hashing with a session-scoped random nonce for deterministic placeholders. Mappings held in memory only.

**Files:**
- `subsystems/privacy/index.js` -- PII patterns, `scrubPii()`, `rehydratePii()`, MCP tools

**MCP Tools (4):**
| Tool | Description |
|------|-------------|
| `privacy_scrub` | Scrub PII from text, return scrubbed text + stats |
| `privacy_rehydrate` | Restore PII placeholders to original values |
| `privacy_stats` | Session scrub statistics by category |
| `privacy_reset` | Destroy all PII mappings and reset nonce |

**Events Published:** `privacy:scrubbed` (when scrubbing finds PII)
**Events Subscribed:** None

**Vault State Keys:** None (in-memory only, destroyed on lock)

**Dependencies:** Vault (for nonce storage and Privacy Shield API)

**Extension:** To add a new PII category, add a regex array to `PII_PATTERNS` in `subsystems/privacy/index.js` and add the category name to the `categoryOrder` array.

---

### 4. Ollama

**Purpose:** Monitors the health of a local Ollama instance. Checks available models via `/api/tags` and loaded models via `/api/ps`. Used by the LLM subsystem for routing decisions.

**Files:**
- `subsystems/ollama/index.js` -- MCP tool registration (uses shared OllamaMonitor from deps)
- `core/ollama-monitor.js` -- `OllamaMonitor` class (extracted from vault.js in v2.2.0)

**MCP Tools (1):**
| Tool | Description |
|------|-------------|
| `ollama_status` | Check Ollama health, list available and loaded models |

**Events:** None.
**Vault State Keys:** None.
**Dependencies:** None (Tier 0)

**Note:** `OllamaMonitor` is a single shared instance created in `index.js` and passed to all subsystems via `deps.ollamaMonitor`. Do not instantiate a second one -- it runs its own polling loop. `core/vault.js` re-exports `OllamaMonitor` for backward compatibility; prefer importing directly from `core/ollama-monitor.js`.

---

## Tier 1

### 5. P2P

**Purpose:** Peer-to-peer encrypted communication between Asimov Agent instances. The full handshake is implemented: X25519 ECDH key agreement, HKDF session key derivation (RFC 5869, SHA-256), AES-256-GCM message encryption with sequence-numbered AAD (anti-replay), Ed25519 ciphertext signing (signature verified before decryption), file transfer, trust score exchange, and pairing codes.

**Handshake flow:**
1. Initiator sends own X25519 exchange public key + Ed25519-signed cLaw attestation
2. Responder verifies attestation, derives session keys, replies with own exchange key + attestation
3. Initiator verifies the ack's Ed25519 signature before processing, then derives session keys
4. HKDF salt = SHA-256 of the sorted pair of exchange public keys; two separate keys derived via info bytes 0x01 / 0x02

**Files:**
- `subsystems/p2p/index.js` -- MCP tools, lifecycle
- `subsystems/p2p/protocol.js` -- `PeerChannel` + `PeerManager` classes (complete handshake, encryption)
- `subsystems/p2p/transport.js` -- `P2PTransport` class (WebSocket server/client, bound to 127.0.0.1)

**MCP Tools (7):**
| Tool | Description |
|------|-------------|
| `peer_listen` | Start WebSocket server, return port |
| `peer_connect` | Connect to remote peer with attestation |
| `peer_list` | List connected peers and channel states |
| `peer_send` | Send encrypted text/transaction/trust/attestation message |
| `peer_send_file` | Send encrypted file |
| `peer_disconnect` | Close channel, destroy session keys |
| `peer_pairing_code` | Generate 8-char pairing code (5-min expiry) |

**Events:** None published/subscribed directly (communicates via transport callbacks).
**Vault State Keys:** None (session keys are ephemeral).
**Dependencies:** Identity subsystem (for attestation generation and key exchange)

---

## Tier 2

### 6. LLM

**Purpose:** Multi-provider LLM routing and inference. Supports three providers (Anthropic, OpenRouter, Ollama), an intelligence router with 5-factor weighted model scoring, a 12+ model registry, circuit breaker, and budget tracking. Routes requests based on task complexity, privacy requirements, latency needs, and cost.

**Files:**
- `subsystems/llm/index.js` -- MCP tools, provider wiring, lifecycle
- `subsystems/llm/client.js` -- `LLMClient` (unified interface across providers)
- `subsystems/llm/router.js` -- `IntelligenceRouter` (task profiling, model selection, budget)
- `subsystems/llm/providers/ollama.js` -- Ollama provider
- `subsystems/llm/providers/anthropic.js` -- Anthropic provider
- `subsystems/llm/providers/openrouter.js` -- OpenRouter provider

**MCP Tools (6):**
| Tool | Description |
|------|-------------|
| `llm_complete` | Send completion request, return text + usage + latency |
| `llm_stream` | Stream a completion, return accumulated text |
| `llm_status` | Show providers, availability, default, router stats |
| `llm_model_list` | List all models with capabilities and costs |
| `llm_route` | Recommend best model for a task description |
| `llm_set_provider` | Set default provider (anthropic/ollama/openrouter) |

**Events Published:** `llm:request-completed` (with signals for EIS tracker)
**Events Subscribed:** `vault:key-updated` (reload API keys), `config:provider-changed`

**Vault State Keys:** `llm:router-state`, `api-keys` (root-level)
**Dependencies:** Vault (API key storage), Ollama (model discovery)

---

### 7. Memory

**Purpose:** 3-tier memory system with semantic search. Short-term (session-only, in-memory), medium-term (persisted in vault), long-term (consolidated insights). Embedding pipeline via Ollama `nomic-embed-text` with graceful degradation to keyword matching. Duplicate detection via content-hash dedup (exact) and Jaccard similarity (near-duplicate). Episodic memory records session-level summaries. Consolidation engine promotes high-scoring medium-term entries to long-term.

**Capacity caps:** short=100, medium=500, long=1000 entries. LRU eviction (oldest + lowest access count) runs when a tier is full.

**Files:**
- `subsystems/memory/index.js` -- MCP tools, auto-extraction events, capacity management
- `subsystems/memory/tiers.js` -- `MemoryTiers` (3-tier CRUD, recall, SHA-256 content-hash dedup)
- `subsystems/memory/embedding.js` -- `EmbeddingPipeline` (Ollama embeddings)
- `subsystems/memory/search.js` -- `SemanticSearchEngine` (cosine similarity + keyword fallback)
- `subsystems/memory/episodic.js` -- `EpisodicMemory` (session episode tracking)
- `subsystems/memory/consolidation.js` -- `MemoryConsolidation` (promotion scoring)

**MCP Tools (8):**
| Tool | Description |
|------|-------------|
| `memory_store` | Store observation with category, tier, confidence |
| `memory_recall` | Recall relevant memories (semantic or keyword) |
| `memory_search` | Full semantic search with tier filtering |
| `memory_consolidate` | Trigger promotion pass (medium -> long) |
| `memory_status` | Tier counts, embedding health, consolidation candidates |
| `memory_episode_start` | Begin recording a session episode |
| `memory_episode_end` | End episode with summary, topics, tone, decisions |
| `memory_forget` | Remove a specific memory by ID |

**Events Published:** `memory:stored`
**Events Subscribed:** `session:end` (clear short-term), `trust:evidence-added`, `agent:completed`, `connector:detected`, `enterprise:commitment-created` (all auto-extract observations)

**Vault State Keys:** `memory:short-term`, `memory:medium-term`, `memory:long-term`, `memory:episodes`, `memory:session-buffer`
**Dependencies:** LLM (for embeddings via Ollama)

---

### 8. Context

**Purpose:** Knowledge graph tracking entities (files, functions, people, concepts, projects) and their relationships (contains, imports, calls, mentions, related). Automatic entity extraction from all event bus events. Context injection builds enriched prompt blocks for LLM queries based on relevant entities and recent activity.

**Files:**
- `subsystems/context/index.js` -- MCP tools, event subscriptions, auto-persist timer
- `subsystems/context/graph.js` -- `ContextGraph` (node/edge CRUD, query, entity extraction)
- `subsystems/context/injector.js` -- `ContextInjector` (snapshot, context block generation)

**MCP Tools (4):**
| Tool | Description |
|------|-------------|
| `context_snapshot` | Current context: recent events, active entities, graph neighborhoods |
| `context_inject` | Build enriched context block for an LLM prompt |
| `context_add` | Add node or edge to knowledge graph |
| `context_query` | Query graph by name pattern and type filter |

**Events Published:** None directly
**Events Subscribed:** `*` (all events for entity extraction), `vault:unlocked` (reload graph), `session:start` (hydrate with cwd info), `memory:stored` (feed content into graph), `session:end` + `vault:locking` (save graph)

**Vault State Keys:** `context:graph`
**Dependencies:** Event bus

---

### 9. Trust

**Purpose:** Person-level trust graph with multi-dimensional scoring across 5 dimensions (reliability, expertise, emotional trust, timeliness, information quality). Fuzzy person resolution via exact alias match, normalized name comparison, and Levenshtein distance. Hermeneutic re-evaluation recomputes all dimensions from all evidence every 5 observations. 30-day half-life decay, 90-day evidence pruning, 200-person LRU cap.

**Files:**
- `subsystems/trust/index.js` -- MCP tools, auto-decay, natural language explainer
- `subsystems/trust/graph.js` -- `TrustGraph` (person resolution, evidence, scoring)

**MCP Tools (7):**
| Tool | Description |
|------|-------------|
| `trust_person_score` | Get trust scores with fuzzy name resolution |
| `trust_evidence_add` | Add trust evidence (10 types, impact -1 to +1) |
| `trust_evidence_list` | List evidence for a person sorted by recency |
| `trust_reevaluate` | Force hermeneutic re-evaluation from all evidence |
| `trust_graph_status` | Overview: total persons, top trusted, recent interactions |
| `trust_person_resolve` | Resolve identifier to person without modifying trust |
| `trust_explain` | Natural language trust explanation |

**Events Published:** `trust:score-updated`, `trust:evidence-added`
**Events Subscribed:** `memory:person_mentions`, `vault:unlocked` (auto-decay)

**Vault State Keys:** `trust:persons`, `trust:evidence`
**Dependencies:** Vault

---

### 10. Personality

**Purpose:** Agent Friday's identity, adaptive communication style, sentiment tracking, and personality evolution. Combines a profile (name, mode, traits, tone, backstory, challenge level), 6 adaptive style dimensions with anti-sycophancy detection, keyword-based mood/energy tracking, and session-based personality maturation. The "mother signal" from onboarding Q8 maps sycophancy risk to challenge level. The `epistemicTracker` (set by `wiring.js`) feeds EIS score into personality -- when EIS drops, the wiring layer raises the challenge level automatically via `eis:updated`.

**Files:**
- `subsystems/personality/index.js` -- MCP tools, mother signal bridge, versioning, EIS tracker hook
- `subsystems/personality/profile.js` -- `PersonalityProfile` (get/update/condense)
- `subsystems/personality/calibration.js` -- `CalibrationEngine` (6 dimensions, anti-sycophancy)
- `subsystems/personality/sentiment.js` -- `SentimentEngine` (keyword mood detection, energy)
- `subsystems/personality/evolution.js` -- `PersonalityEvolution` (trait maturation over sessions)

**MCP Tools (7):**
| Tool | Description |
|------|-------------|
| `personality_profile` | Get or update profile (name, mode, traits, challenge level) |
| `personality_calibrate` | View/reset 6 adaptive dimensions |
| `personality_mood` | Current detected mood and energy level |
| `personality_evolve` | View evolution state and trait development |
| `personality_self_knowledge` | Introspection: identity, calibration, mood, evolution |
| `personality_sentiment` | Analyse text for sentiment without updating state |

**Events Published:** None directly
**Events Subscribed:** `message:user` (sentiment + calibration), `checkin:dismissed/engaged`, `vault:unlocked` (re-apply mother signal)

**Vault State Keys:** `personality:profile`, `personality:calibration`, `personality:sentiment`, `personality:evolution`, `personality:personality-history` (max 20 snapshots)
**Dependencies:** Vault, Memory (for mother signal from user-profile)

---

## Tier 3

### 11. Agents

**Purpose:** Recursive agent delegation with trust-tier inheritance, depth limits, deadlock detection (DFS), halt propagation (BFS) with partial result capture, and team coordination. Agent types: research, coding, analysis, creative, security, summarize, draft-email, orchestrate.

**Files:**
- `subsystems/agents/index.js` -- MCP tools, lifecycle
- `subsystems/agents/delegation.js` -- `DelegationEngine` (tree management, depth/child limits)
- `subsystems/agents/awareness.js` -- `AwarenessMesh` (cross-agent coordination, DFS deadlock)
- `subsystems/agents/teams.js` -- `AgentTeamManager` (shared goals, task lists, context channels)

**MCP Tools (7):**
| Tool | Description |
|------|-------------|
| `agent_delegate` | Delegate sub-task with trust-tier inheritance and depth limits |
| `agent_spawn` | Spawn top-level agent with delegation root |
| `agent_halt` | Halt agent and all descendants, propagate through tree |
| `agent_status` | Detailed status of agent, delegation tree, mesh context |
| `agent_list_capabilities` | Agent types, active agents, delegation stats, mesh status |
| `agent_team_create` | Create team with shared goal and task list |
| `agent_team_status` | Team status or overview of all teams |

**Events Published:** `agent:spawn_requested`, `agent:halt_requested`
**Events Subscribed:** `agent:completed`, `agent:failed` (deregister from mesh, report to delegation)

**Vault State Keys:** `agents:delegation-state`
**Dependencies:** LLM, Memory, Trust

---

### 12. Tools

**Purpose:** Dynamic tool registry with safety-level enforcement (read_only, write, destructive) and execution delegate with confirmation gates and audit trail. Tools can be registered dynamically at runtime.

**Files:**
- `subsystems/tools/index.js` -- MCP tools
- `subsystems/tools/registry.js` -- `ToolRegistry` (registration, filtering, categories)
- `subsystems/tools/delegate.js` -- `ExecutionDelegate` (safety checks, confirmation, audit)

**MCP Tools (4):**
| Tool | Description |
|------|-------------|
| `tool_register` | Register a new tool with safety level and category |
| `tool_execute` | Execute a tool with safety checks |
| `tool_list` | List tools filtered by category/safety/source |
| `tool_safety_check` | Check safety level and audit trail for a tool |

**Events:** None directly.
**Vault State Keys:** None (in-memory registry).
**Dependencies:** Event bus

---

### 13. Connectors

**Purpose:** Dynamic discovery and dispatch for external software connectors. 8 connector modules detect available software on the machine and expose their tools through a unified `connector_execute` dispatch pattern. This avoids registering 72+ individual MCP tools.

**Connector Modules:**
| ID | Label | Category | Tool Count |
|----|-------|----------|-----------|
| `powershell` | PowerShell Bridge | foundation | ~10 |
| `terminal-sessions` | Terminal Sessions | foundation | ~7 |
| `git-devops` | Git & DevOps | devops | ~20 |
| `coding-kit` | Coding Kit | devops | ~4 |
| `system-management` | System Management | system | ~17 |
| `perplexity` | Perplexity AI Search | intelligence | ~4 |
| `firecrawl` | Firecrawl Web Intel | intelligence | ~3 |
| `comms-hub` | Communication Hub | communication | ~7 |

**Files:**
- `subsystems/connectors/index.js` -- MCP tools, module registry
- `subsystems/connectors/registry.js` -- `ConnectorRegistry` (detection, dispatch)
- `subsystems/connectors/*.js` -- 8 connector module files

**MCP Tools (4):**
| Tool | Description |
|------|-------------|
| `connector_detect` | Scan machine for available software |
| `connector_list` | List connectors and their tools |
| `connector_execute` | Execute a tool from a specific connector |
| `connector_status` | Health status across all connectors |

**Events Published:** `connector:detected`
**Dependencies:** Tools (for registry integration), Vault (for API keys)

---

### 14. Gateway

**Purpose:** Trust-gated messaging gateway for external channels (Telegram, Slack, Discord, Signal). Enforces a 5-tier trust hierarchy (owner > owner_dm > approved_dm > group > public). Manages per-sender sessions with rolling 10-message context windows. Append-only audit log with monthly rotation. Fails closed to "public" on any error.

**Files:**
- `subsystems/gateway/index.js` -- MCP tools
- `subsystems/gateway/trust-engine.js` -- `TrustEngine` (tier resolution, rate limiting, pairing)
- `subsystems/gateway/sessions.js` -- `SessionStore` (per-sender message history)
- `subsystems/gateway/audit.js` -- `AuditLog` (inbound/outbound logging)

**MCP Tools (5):**
| Tool | Description |
|------|-------------|
| `gateway_authenticate` | Resolve sender's trust tier and capability policy |
| `gateway_session_create` | Create/restore session, add message to history |
| `gateway_session_status` | List active sessions, message counts, expiry |
| `gateway_audit` | Query audit log with direction filter |
| `gateway_policy` | Manage trust policies: get, pair, revoke, list |

**Events Subscribed:** `system:tick` (prune expired sessions)

**Vault State Keys:** `gateway:trust-policies`, `gateway:sessions`, `gateway:audit`
**Dependencies:** Trust, Vault

---

### 15. Briefing

**Purpose:** Daily briefings (morning/midday/evening), meeting preparation with attendee trust data, and post-meeting intelligence extraction (action items, commitments, sentiment). Briefings are read-only informational outputs; no action is taken without user approval.

**Files:**
- `subsystems/briefing/index.js` -- MCP tools
- `subsystems/briefing/daily.js` -- `DailyBriefingEngine` (generate, history, staleness check)
- `subsystems/briefing/meeting.js` -- `MeetingIntelligence` (lifecycle, notes, prep, intel)

**MCP Tools (3):**
| Tool | Description |
|------|-------------|
| `briefing_daily` | Generate/retrieve/list daily briefings |
| `briefing_meeting_prep` | Meeting lifecycle: create, start, end, cancel, prep, notes, list |
| `briefing_meeting_intel` | Analyze meeting content for action items and insights |

**Events Subscribed:** `commitments:changed` (marks briefings stale)

**Vault State Keys:** `briefing:history`, `briefing:meetings`
**Dependencies:** Memory, Trust, Context

---

### 16. Voice

**Purpose:** Voice pipeline state management and fallback coordination. Manages a 6-state machine (IDLE, CONNECTING, ACTIVE, PAUSED, ERROR, RECOVERING) and cascading fallback paths (cloud > personaplex > local > text). This subsystem does NOT capture audio or synthesize speech; it tracks state for the separate friday-voice Express server.

**Files:**
- `subsystems/voice/index.js` -- MCP tools
- `subsystems/voice/state-machine.js` -- `VoiceStateMachine` (transitions, health)
- `subsystems/voice/fallback.js` -- `VoiceFallbackManager` (path priority, failure recording)

**MCP Tools (3):**
| Tool | Description |
|------|-------------|
| `voice_state` | Query/transition/reset the state machine |
| `voice_health` | Report or query health check status |
| `voice_fallback_status` | Manage fallback paths: availability, priority, failures |

**Events Subscribed:** `voice:request-transition`, `voice:path-availability`

**Vault State Keys:** None (in-memory state).
**Dependencies:** Event bus

---

### 17. Enterprise

**Purpose:** Enterprise safety features. Consent gates require explicit user approval for 8 action categories (with once/session/always scopes). Cloud gates control which task categories can use cloud APIs. Structural confidence scoring detects malformed responses, truncation, and unknown tools. Commitment tracker manages promises, deadlines, follow-up suggestions, and outbound message tracking.

`peekConsent(category)` checks consent state without consuming a `once`-scoped grant, for use when you need to check eligibility before committing to an action. The standard `checkConsent(category)` consumes `once`-scoped grants on read.

**Files:**
- `subsystems/enterprise/index.js` -- MCP tools
- `subsystems/enterprise/consent.js` -- `ConsentTracker` (grant, revoke, audit, peekConsent)
- `subsystems/enterprise/cloud-gate.js` -- `CloudGate` (per-category cloud policies)
- `subsystems/enterprise/confidence.js` -- `assessConfidence()` (structural signal analysis)
- `subsystems/enterprise/commitments.js` -- `CommitmentTracker` (CRUD, follow-ups, outbound)

**MCP Tools (5):**
| Tool | Description |
|------|-------------|
| `enterprise_consent_check` | Check if consent exists for an action category |
| `enterprise_consent_grant` | Grant/revoke consent, view status, query audit |
| `enterprise_cloud_gate` | Gate cloud API access by task category |
| `enterprise_confidence` | Assess confidence in an LLM response |
| `enterprise_commitment_track` | Full commitment lifecycle: add, complete, cancel, snooze, follow-ups |

**Events Published:** `enterprise:commitment-created`
**Events Subscribed:** `memory:commitment_mentions`, `gateway:outbound_message`

**Vault State Keys:** `enterprise:consent`, `enterprise:cloud-policies`, `enterprise:commitments`, `enterprise:outbound`
**Dependencies:** Vault, Event bus

---

### 18. Session

**Purpose:** Session lifecycle status tool. Wraps `SessionConductor` as a proper subsystem so `session_status` is registered through the standard tool pipeline. Reports uptime, current working directory context, the session greeting, and pending commitments.

Added in v2.2.0. Registered at Tier 3 alongside the other late-stage subsystems. The `SessionConductor` is injected after `registry.startAll()` via `setConductor()`, following the same late-injection pattern as `VaultSubsystem.setRegistry()`.

**Files:**
- `subsystems/session/index.js` -- `SessionSubsystem` class, `session_status` tool

**MCP Tools (1):**
| Tool | Description |
|------|-------------|
| `session_status` | Uptime, working directory context, session greeting, pending commitments |

**Events:** None published or subscribed.
**Vault State Keys:** None.
**Dependencies:** SessionConductor (injected post-startup)

---

## Adding a New Subsystem

1. Create `mcp/friday-core/subsystems/<name>/index.js` exporting a class that extends `Subsystem`.

2. Override the lifecycle methods you need:
   - `registerTools(server)` -- call `server.tool(name, description, schema, handler)` for each MCP tool
   - `registerEvents()` -- subscribe to event bus topics
   - `async start()` -- load state from vault, initialize internal state
   - `async stop()` -- persist state to vault, clean up timers

3. Access namespaced vault state via `this.state`, which is a `StateManager` namespace. Keys are stored as `subsystemname:key-name`. The separator is `:` (colon) -- vault key validation rejects `/` and `\` but allows colons. Example:

   ```javascript
   // In your subsystem:
   await this.state.read('my-key');    // reads "mysubsystem:my-key" from vault
   await this.state.write('my-key', data);
   ```

4. Import and register it in `index.js` at the correct tier:

   ```javascript
   import { MySubsystem } from './subsystems/myname/index.js';
   // ...
   registry.register(new MySubsystem(deps), { tier: 3 }); // or tier 0/1/2
   ```

5. If your subsystem needs cross-subsystem event routes (subscribing to another subsystem's events), add them to `core/wiring.js` -- not in your subsystem constructor. Each route must appear exactly once.

6. Update the tool count comment in `index.js` and the subsystem count in the header.

**Tier guidelines:**
- **Tier 0:** No dependencies on other subsystems (vault, crypto, event bus are always available)
- **Tier 1:** Needs identity or another Tier 0 subsystem
- **Tier 2:** Needs vault state loaded (typically needs vault unlock to be useful), or needs Tier 1
- **Tier 3:** Needs multiple lower-tier subsystems, or needs vault-backed state from Tier 2

All subsystems within a tier start in parallel. Within a tier, do not assume any ordering between sibling subsystems.
