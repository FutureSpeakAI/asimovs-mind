# Changelog

All notable changes to Asimov's Mind are documented in this file.

Format based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.1.0] — 2026-04-01 — Neural Binding

The subsystems learn to talk to each other. The system becomes one intelligence.

### Added
- core/wiring.js: 10 cross-subsystem event subscriptions (the nervous system)
- core/session-conductor.js: session lifecycle orchestration with personality-aware greeting
- core/eis.js: Epistemic Independence Score (verification + complexity + correction)
- /help skill: categorized command reference
- /status overhaul: calls 9 MCP tools for rich system health
- session_status MCP tool (uptime, context, greeting, commitments)
- trust_explain MCP tool (natural language trust reasoning)
- Memory auto-extraction from trust/agent/connector/enterprise events
- Memory session buffer (5-min crash recovery flush)
- Memory capacity management (short=100, medium=500, long=1000 with LRU)
- Time-weighted recall (recency 0.4 + relevance 0.6)
- Context graph hydration from vault + cwd detection
- Mother signal bridge (sycophancy_risk → challenge_level mapping)
- Personality versioning (max 20 history snapshots)
- Trust auto-decay on session start (30-day unseen threshold)
- Privacy event emission + transparency in personality loader
- Dashboard: live particle data binding, connection indicator, memory search, clickable subsystem dots, mobile reflow
- GitHub CI (Node 18/20/22), issue templates, PR template, CONTRIBUTING.md, SECURITY.md
- docs/API_REFERENCE.md: complete reference for 92 MCP tools
- test-wiring.js (9 tests), test-session.js (11 tests)
- Bootstrap: Node version check, npm install progress dots, stale port cleanup

### Changed
- Dashboard particles bound to memory entries (color by tier)
- Dashboard orb pulse rate tied to context event activity
- HTTP bridge accepts GET for read-only tools
- Session-learner feeds memory subsystem on session end

---

## [2.0.0] -- 2026-04-01

**Agent Friday Complete.** The governance kernel becomes the full Agent Friday runtime. 17 subsystems, 89 MCP tools, holographic dashboard. Full intelligence port from nexus-os into friday-core.

### Added
- **friday-core MCP server** -- 17 subsystems replacing vault-server, loaded in 4 dependency tiers
- **Core architecture** -- event bus, subsystem registry, state manager, structured logger
- **LLM subsystem** (6 tools) -- 3 providers (Anthropic, OpenRouter, Ollama), intelligence router with 5-factor weighted scoring, 12+ model registry, circuit breaker, budget tracking
- **Memory subsystem** (8 tools) -- 3-tier storage (short/medium/long-term), episodic memory, Ollama nomic-embed-text embeddings with graceful degradation, semantic search with cosine similarity + keyword fallback, Jaccard duplicate detection, consolidation engine
- **Context subsystem** (4 tools) -- knowledge graph with entity-relationship tracking, automatic entity extraction from event bus, context injection for LLM queries, recency-weighted relevance scoring
- **Trust subsystem** (6 tools) -- person-level trust graph with 5 dimensions (reliability, expertise, emotional trust, timeliness, information quality), fuzzy person resolution (exact alias, normalized name, Levenshtein), hermeneutic re-evaluation every 5 observations, 30-day half-life decay, 90-day evidence pruning, 200-person LRU cap
- **Personality subsystem** (6 tools) -- profile with mode/traits/tone/challenge level, calibration engine with 6 adaptive style dimensions, anti-sycophancy detection (agreement streak + positivity bias), keyword sentiment analysis with time-of-day energy modulation, session-based evolution (full uniqueness at 50 sessions)
- **Agent subsystem** (7 tools) -- recursive delegation with trust-tier inheritance, depth limits and per-agent child limits, awareness mesh with DFS deadlock detection, BFS halt propagation with partial result capture, team coordination with shared task lists and context channels
- **Tools subsystem** (4 tools) -- registry with categories and safety levels (read_only/write/destructive), execution delegate with confirmation gates and audit trail
- **Connectors subsystem** (4 + 72 tools) -- 9 connectors with dynamic dispatch via connector_execute: git-devops (20), coding-kit (4), terminal (7), system-mgmt (17), perplexity (4), firecrawl (3), comms-hub (7), powershell (10). All commands use execFileSync/spawn (no shell injection). Auto-detection of available software on PATH.
- **Gateway subsystem** (5 tools) -- trust tier hierarchy (owner > owner_dm > approved_dm > group > public), session management with rolling 10-message context windows, append-only audit log with monthly rotation
- **Briefing subsystem** (3 tools) -- daily briefing from calendar/commitments/activity, meeting prep with attendee trust data and context, meeting intelligence for notes and action items
- **Voice subsystem** (3 tools) -- 6-state machine (IDLE/CONNECTING/ACTIVE/PAUSED/ERROR/RECOVERING), cascading fallback (cloud > personaplex > local > text), health monitoring with escalation levels. No audio capture -- that stays with friday-voice.
- **Enterprise subsystem** (5 tools) -- consent gate with scope (once/session/always) and 8 categories, cloud gate (sovereign-first, requires explicit consent per category), structural confidence scoring for LLM responses, commitment tracker with follow-up suggestions
- **Friday Dashboard** -- Three.js holographic desktop served at `http://localhost:{port}/`. 400-particle field, neural grid, connection lines, glowing central orb with pulse animation. HUD shows vault status, Ollama health, P2P peers, memory stats, trust summary, 17 subsystem status dots. Passphrase gate integrated. Live polling every 5 seconds. Responsive for mobile via Tailscale.
- Generic HTTP tool endpoint: `POST /tool/:toolName` for hook access to any MCP tool

### Changed
- `plugin.json` MCP server renamed from `sovereign-vault` to `friday-core`
- Subsystem registry architecture replaces monolithic vault server
- `index.js` rewritten as tiered subsystem loader (4 dependency tiers)
- 179 tests passing (51 core + 20 integration + 83 plugin + 25 user paths)

---

## [1.0.0] -- 2026-04-01

**Sovereign Forge.** AES-256-GCM encrypted vault, Ed25519 cryptographic identity, P2P protocol, Privacy Shield, Ollama intelligence router. Every sovereignty claim backed by a verifiable mechanism.

### Added
- **Sovereign Vault** MCP server (`mcp/vault-server/`) -- AES-256-GCM encryption for all persistent state, Argon2id key derivation (256MB memory-hard), BLAKE2b sub-key derivation (vault key, HMAC key, identity key), SecureBuffer with guaranteed key zeroing, canary-based passphrase verification, automatic plaintext migration, HTTP bridge for Python hooks
- **Browser-based passphrase entry** at localhost -- passphrase never touches the API transcript
- **Ed25519 identity** -- signing + X25519 exchange keypairs per agent via libsodium, private keys encrypted with identity sub-key
- **cLaw attestation protocol** -- SHA-256 laws hash + timestamp + Ed25519 signature with 5-minute expiry
- **Encrypted P2P communication** -- X25519 ECDH key agreement, AES-256-GCM message encryption with sequence-numbered AAD, Ed25519 ciphertext signing, WebSocket transport, file transfer, trust score exchange, 6-digit safety numbers, pairing codes
- **Privacy Shield** hooks -- PreToolUse scrubs PII from WebFetch/WebSearch (10 categories), PostToolUse rehydrates PII in responses, session-scoped FNV-1a nonces (never persisted)
- **Intelligence Router** -- Ollama health monitoring, 4 routing policies (auto, local_preferred, local_only, cloud_preferred), per-task model recommendations
- **Onboarding** -- 8-question interview (Q8: the mother question), epistemic calibration from attachment signal, anti-sycophancy challenge level per user
- Safety floors: `encryption_at_rest`, `privacy_shield_on_cloud`, `local_model_preferred`, `api_free_capable`, `passphrase_min_words`
- Protected zones extended to vault directory
- Conformance report: Core + Connected certification achieved
- New skills: `/peer`, `/route`, `/friday unlock`
- New directives: `benchmark-sovereign`, `local-sovereignty`
- New hooks: `privacy-shield-scrub`, `privacy-shield-rehydrate`, `vault_bridge`
- Self-bootstrapping: `bootstrap.js` entry point auto-runs npm install before ESM imports
- 174 tests passing (51 unit + 20 integration + 79 validation + 24 user paths)

### Changed
- Personality rewritten: zero aspirational claims, all mechanism-backed
- 6 agents updated with vault awareness
- Federation: public/private state separation, signed trust summaries

### Fixed
- Critical install bug: ESM imports resolved before `ensureDependencies()` could run. `bootstrap.js` is now the entry point, checks for `node_modules`, runs npm install if missing, then dynamically imports `index.js`.

---

## [1.0.0-beta] -- 2026-03-30

**Agent Friday kernel.** Personality, memory, session learning, trust tracking. The personality layer turns the governed swarm into Agent Friday.

### Added
- `personality/friday.md` -- Agent Friday identity: direct, warm, creative, honest about limitations, protective of user data
- `/onboard` skill -- 7-question conversational interview building user profile (communication style, autonomy comfort, anti-patterns)
- `/friday` skill -- mode switching (focus/partner/teacher/creative/sentinel)
- `personality-loader.py` -- SessionStart hook loads personality + user profile + recent session context + federation status
- `session-learner.py` -- Stop hook extracts learnings, updates knowledge store, maintains rolling 5-session memory
- `trust-tracker.py` -- PostToolUse hook tracks agent performance, computes keep rates, earns autonomy (supervised > suggested > autonomous)
- Workflow Observer agent -- watches user patterns across sessions, proposes automations, never assumes permission
- Creative agent -- generates contextual media (haiku, SVG diagrams, code art) as natural personality expression
- `/federate` skill -- init, status, verify, agents commands
- `integrity-check.py` -- SessionStart HMAC verification of governance files
- **Unified memory system** -- trust graph + knowledge graph + vectorless RAG, all encrypted at rest
  - Trust: multi-dimensional scoring with time decay and hermeneutic re-evaluation
  - Knowledge: entity co-occurrence graph from session file modification patterns
  - Recall: vectorless context retrieval via entity matching, co-occurrence, recency, trust scores
- `/remember` skill -- tribal knowledge that persists encrypted in vault and propagates through git
- `ROADMAP.md` -- full product vision from v0.3.0 through v2.0.0

### Fixed
- Skills restructured to `skills/name/SKILL.md` format (was `skills/name.md`)
- Hooks registered in `plugin.json` with proper event bindings
- `.claude-plugin/marketplace.json` added for installability

### Changed
- Plugin bumped to v1.0.0-beta (16 agents, 13 skills, 7 hooks, 6 directives)

---

## [0.3.0] -- 2026-03-29

**N-agent swarm.** Dynamic agent discovery replaces fixed roster. The swarm scales to fit the work.

### Added
- Swarm Coordinator discovers agents dynamically via Glob (plugin agents + project-local `.asimovs-mind/agents/*.md`)
- Meta-Improver can create new specialist agents when the swarm has a capability gap
- `/create-agent` skill -- users spawn custom agents on demand, written to `.asimovs-mind/agents/`

### Changed
- Swarm scales from 14 fixed agents to N (ships with 15, grows to fit the work)
- Plugin bumped to v0.3.0

---

## [0.2.0] -- 2026-03-28

**GitScout + GitLoader.** Autonomous code discovery pipeline from GitHub. The hivemind moment.

### Added
- **GitScout** agent -- searches GitHub for code, scores relevance + trust, returns ranked candidates by trust tier
- **GitLoader** agent -- fetches, safety-scans (AST), adapts, and integrates code under full cLaws governance
- `/discover` skill -- user-facing command for the full discovery pipeline (scout > scan > adapt > test > keep/discard)
- `discover.md` directive -- autonomous discovery loop with circuit breakers
- `safety_scanner.py` -- AST-based static analysis (Tier 1/2/3). Blocks subprocess, eval, exec, network calls, monkey-patching.
- `provenance.py` -- append-only attribution tracking CLI (source repo, license, trust scores, outcome)
- `governance/discovery-rules.json` -- cLaws extension for code import: trust tiers, quarantine protocol, pipeline enforcement

### Changed
- Swarm expanded from 12 to 14 agents
- Three Laws rebranded as Asimov's cLaws throughout
- Plugin bumped to v0.2.0 (14 agents, 8 skills, 6 directives)

---

## [0.1.0] -- 2026-03-27

**Initial governance.** Governed recursive self-improvement for AI agent swarms. Standing on the shoulders of Karpathy's autoresearch.

### Added
- 12 specialized agents: swarm-coordinator, debugger, optimizer, evolver, breeder, auditor, documenter, sentinel, librarian, scout, architect, meta-improver
- Governance framework: Three Laws + Meta-Law with enforcement rules (`governance/laws.json`)
- Protected zones: files agents cannot modify (`governance/protected-zones.json`)
- Safety floors: parameter minimums that cannot be lowered (`governance/safety-floors.json`)
- Portable governance spec (`framework/spec.json`) with LangChain, CrewAI, AutoGen adapters
- Skills: `/unleash`, `/iterate`, `/breed`, `/evolve`, `/diagnose`, `/govern`, `/swarm-status`
- Directives: `fix-tests`, `fix-types`, `optimize-startup`, `security-hardening`, `full-sweep`
- `hooks/first-law.py` -- PreToolUse protected zone enforcement
- `hooks/third-law.py` -- PostToolUse session ledger
- `hooks/safety-scanner-hook.py` -- PreToolUse AST-based safety scanning on code writes

---

[2.1.0]: https://github.com/FutureSpeakAI/asimovs-mind/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/FutureSpeakAI/asimovs-mind/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/FutureSpeakAI/asimovs-mind/compare/v1.0.0-beta...v1.0.0
[1.0.0-beta]: https://github.com/FutureSpeakAI/asimovs-mind/compare/v0.3.0...v1.0.0-beta
[0.3.0]: https://github.com/FutureSpeakAI/asimovs-mind/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/FutureSpeakAI/asimovs-mind/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/FutureSpeakAI/asimovs-mind/releases/tag/v0.1.0
