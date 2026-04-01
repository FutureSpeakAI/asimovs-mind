# Asimov's Mind

### Agent Friday lives here. 17 subsystems. 89 MCP tools. One holographic dashboard.

A Claude Code plugin that is Agent Friday: 17 subsystems powering LLM intelligence routing, 3-tier memory, trust graphs, personality evolution, recursive agent delegation, 9 connectors with 72 tools, enterprise safety gates, daily briefings, and a Three.js holographic dashboard. All state AES-256-GCM encrypted. Ed25519 cryptographic identity. Privacy Shield PII scrubbing. Ollama local-first routing. GitHub-scale code discovery. Coordinated N-agent swarm. Bounded by Asimov's cLaws, a governance framework that makes unsupervised autonomous operation safe enough to deploy on production code overnight.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI). Standing on the shoulders of [Karpathy's autoresearch](https://github.com/karpathy/autoresearch).

> **New here?** See [GETTING_STARTED.md](GETTING_STARTED.md) for installation and first-run setup in under two minutes.

---

## We tested this. Here is what happened.

Karpathy's autoresearch introduced a powerful pattern: an LLM agent modifies code, trains for 5 minutes, measures the result, keeps improvements, reverts regressions, and loops. Elegant. But a single ungoverned agent hits limits fast -- it crashes, it degrades, it explores the same dimensions repeatedly.

We took that pattern, added governance, and deployed it across a coordinated swarm. Then we ran controlled experiments comparing ungoverned vs. governed agents on identical hardware and tasks:

| | Ungoverned | Governed Single | Governed Swarm |
|---|:-:|:-:|:-:|
| **Crash rate** | 56% | 22% | 25% |
| **Degradation per step** | 0.035 | 0.018 | 0.011 |
| **Explored architecture** | No | No | Yes |

Governance cut crashes in half. The governed swarm degraded 3x slower during sustained exploration. And the swarm's specialist architect agent was the only one to discover an architectural improvement that generalist agents never even tried.

The data is real. The experiments are reproducible. Paper and code: [asimovs-mind-research](https://github.com/FutureSpeakAI/asimovs-mind-research)

## Install

```bash
# Add the marketplace
claude plugin marketplace add FutureSpeakAI/asimovs-mind

# Install the plugin
claude plugin install asimovs-mind

# Restart Claude Code to activate
```

## See it in action

```bash
/friday unlock                                         # open the encrypted vault
# Open http://localhost:{port}/ to see the Friday Dashboard
/onboard                                               # meet Agent Friday
/briefing                                              # daily briefing
/memory recall "auth system"                           # semantic memory search
/trust "Alice" reliability                             # check trust graph
/discover a retry mechanism with exponential backoff   # the hivemind moment
/unleash                                               # deploy the full swarm
/iterate fix-tests                                     # autoresearch loop
/friday mode creative                                  # switch modes
/remember the auth uses JWT in httpOnly cookies         # teach Friday
/federate init                                         # join the hivemind
/create-agent CSS layout specialist                    # grow the swarm
/breed "code review specialist"                        # spawn a local model
/evolve "You are a helpful assistant..."               # evolve a prompt
/route status                                          # check Ollama + routing
/diagnose                                              # codebase health check
/govern verify                                         # governance audit
```

## How it works

We took autoresearch's core loop and extended it in three directions: governance, specialization, and ecosystem-scale discovery.

```
Measure baseline
    |
+-> Plan modification (agent reasoning)
|   |
|   Perform modification
|   |
|   Measure again
|   |
|   Improved? -> git commit -> continue
|   Regressed? -> git revert -> try different approach
|   |
|   Budget or circuit breaker? -> halt
|   |
+-- Loop
```

Every agent runs this loop on its specialty. The Swarm Coordinator deploys agents in parallel waves. The Sentinel watches everyone for governance violations. What Karpathy built for one agent and one file, we run across N agents and the entire GitHub ecosystem.

## friday-core: The Agent Friday Runtime

The `friday-core` MCP server is the heart of Agent Friday. 17 subsystems loaded in dependency order, exposing 89 MCP tools and a holographic dashboard at `http://localhost:{port}/`.

```
                    friday-core MCP Server
                    ======================
Tier 0 (Foundation)
  +-- Vault          10 tools   AES-256-GCM state, Argon2id KDF, BLAKE2b sub-keys
  +-- Identity        6 tools   Ed25519 signing, X25519 exchange, attestation
  +-- Privacy         4 tools   PII scrubbing, session-scoped placeholders
  +-- P2P             7 tools   WebSocket transport, ECDH channels, pairing
  +-- Ollama          1 tool    Health monitoring, model discovery

Tier 1 (Intelligence)
  +-- LLM             6 tools   3 providers, intelligence router, budget tracking
  +-- Memory          8 tools   3-tier storage, embeddings, semantic search
  +-- Context         4 tools   Knowledge graph, entity extraction, injection

Tier 2 (Reasoning)
  +-- Trust           6 tools   Person-level graph, hermeneutic re-evaluation
  +-- Personality     6 tools   Evolution, calibration, anti-sycophancy
  +-- Agent           7 tools   Recursive delegation, deadlock detection

Tier 3 (Services)
  +-- Tools           4 tools   Registry, execution delegate, safety gates
  +-- Connectors      4+72      9 connectors, dynamic dispatch
  +-- Gateway         5 tools   Trust tiers, session mgmt, audit logging
  +-- Briefing        3 tools   Daily briefing, meeting prep, meeting intel
  +-- Voice           3 tools   State machine, fallback manager (no audio)
  +-- Enterprise      5 tools   Consent gate, cloud gate, confidence, commitments
                    ------
                    89 tools + holographic dashboard
```

Open `http://localhost:{port}/` after unlocking the vault. The dashboard shows vault status, Ollama health, P2P peers, memory stats, trust summary, and 17 subsystem status indicators. Built with Three.js: 400 particles, neural grid, glowing central orb, HUD overlay. Live polling every 5 seconds.

## Sovereign Vault

All persistent state is encrypted at rest. The Sovereign Vault subsystem provides AES-256-GCM encrypted storage with a passphrase-derived key hierarchy:

```
Passphrase (>= 8 words)
  -> Argon2id (opslimit=4, memlimit=256MB)
  -> masterKey (32 bytes, destroyed after derivation)
     +-- BLAKE2b-KDF("AF_VAULT") -> vaultKey  (AES-256-GCM for state files)
     +-- BLAKE2b-KDF("AF_HMAC_") -> hmacKey   (HMAC-SHA256 for governance)
     +-- BLAKE2b-KDF("AF_IDENT") -> identityKey (XSalsa20-Poly1305 for keypairs)
```

Trust scores, memory, user profiles, routing config, session history, identity keypairs -- everything that makes Friday yours is encrypted on disk. The passphrase never leaves the machine. A browser-based unlock form (`http://localhost:{port}/unlock`) keeps the passphrase out of the Claude API transcript entirely.

Key material is wrapped in SecureBuffer objects that overwrite memory on destruction. The master key is destroyed immediately after sub-key derivation. Private keys are encrypted with the identity sub-key before storage. On vault lock, all keys are wiped.

The `encryption_at_rest` safety floor is set to `true` and cannot be lowered. This is not optional.

## Privacy Shield

When Claude Code calls WebFetch or WebSearch, the outbound request passes through the Privacy Shield -- a pair of hooks that scrub PII before data leaves the machine and rehydrate it when responses come back.

Detected categories: API keys (AWS, GitHub, OpenAI, Anthropic, Slack, Google), JWTs, credit card numbers (Visa, Mastercard, Amex, Discover), SSNs, email addresses, phone numbers, public IP addresses, and filesystem paths containing the OS username.

Each PII match is replaced with a deterministic session-scoped placeholder (`<<PII:CATEGORY:hash>>`) using FNV-1a hashing with a random nonce. The mapping is held in memory only (never written to disk) and destroyed when the vault locks.

**What the Privacy Shield covers:** WebFetch and WebSearch tool calls. All string values in the tool input are recursively scrubbed before the request is sent.

**What the Privacy Shield does not cover:** Claude Code's own API channel to Anthropic. The conversation itself -- including your code, your questions, and any data you paste into the chat -- is sent to Anthropic's API outside the plugin's control. The Privacy Shield protects the tools the agent uses, not the channel the agent runs on. This is a structural limitation of running inside a cloud-dependent LLM. Full privacy requires `local_only` routing mode with Ollama.

## Ed25519 Identity

Each agent/node gets a cryptographic identity: an Ed25519 signing keypair and an X25519 key exchange keypair. Both are generated via libsodium, and private keys are encrypted with the vault's identity sub-key before storage.

The identity enables:

- **cLaw Attestation** -- Hash the laws text with SHA-256, combine with a timestamp, sign with Ed25519. Any peer can verify that this agent is governed by the same laws. Attestations expire after 5 minutes.
- **Signed state** -- Any vault entry can be signed for integrity verification.
- **Future federation trust** -- Public keys can be exchanged between nodes for verified communication.

## Local-Only Operation

Claude Code can run against local models via Ollama, eliminating all cloud API dependency. When configured this way, there is no Anthropic API involvement. Every feature of the plugin works locally.

**What you need:**
- [Ollama](https://ollama.ai) installed and running (`ollama serve`)
- At least one chat model pulled (`ollama pull llama3.1:8b`)
- Claude Code pointed at the local model (`claude --model ollama/llama3.1:8b`)

**What works locally:** Everything. The vault encrypts state locally. P2P channels connect machines directly. Federation syncs through git. The trust graph, memory system, governance hooks, and attestation are all local operations. The agent swarm runs (quality depends on the local model). The Privacy Shield becomes unnecessary because there is no cloud traffic to scrub.

**What changes:** The LLM is local instead of cloud-hosted. Agent quality depends on the local model's capability. Simple tasks (code formatting, test fixes, documentation, memory) work well on 7B models. Complex reasoning (architecture analysis, large refactors) benefits from larger models or temporary cloud routing.

Run `/route local-only` to activate. This is the ultimate sovereignty configuration: not just encrypted state and scrubbed cloud requests, but zero cloud dependency entirely. Your data never leaves your machine. No API keys. No billing. No rate limits. Just your hardware and your code.

See `directives/local-sovereignty.md` for the full setup guide.

## Intelligence Router

When Ollama is available on the local machine, Friday can route inference to local models instead of (or in addition to) the Claude API. The `/route` skill manages this.

Four routing policies:
- `auto` -- Let Friday decide per-request based on task complexity and privacy requirements (default)
- `local_preferred` -- Prefer Ollama. Use cloud only when local lacks capability.
- `local_only` -- All inference goes through Ollama. Maximum sovereignty, no cloud dependency.
- `cloud_preferred` -- Prefer Claude API for quality. Route to local for privacy-sensitive tasks.

The vault's MCP server monitors Ollama health and available models. The `privacy_shield_on_cloud` and `local_model_preferred` safety floors govern the routing behavior -- they can be raised but never lowered.

## Asimov's cLaws

Governance is not a constraint on autonomy. It is what enables autonomy at scale.

The reason autonomous recursive self-improvement has not been deployed widely is trust. Ungoverned agents break things -- our experiments proved it quantitatively. Asimov's cLaws solve this structurally: not guardrails bolted on after the fact, but governance woven into every agent, every action, every integration.

**First Law -- Do No Harm**
> An agent shall not, through action or inaction, cause harm to the codebase, its users, or its data.

Type-check gates. Test gates. Protected zones for credentials and governance files. Circuit breakers that halt after consecutive failures. AST-based safety scanning that blocks dangerous code patterns before they touch your project.

**Second Law -- Obey Protocol**
> An agent shall follow its directive, except where doing so would conflict with the First Law.

Editable surfaces confine each agent to its zone. Budget caps prevent runaway loops. The discovery pipeline must be followed in sequence -- scout, scan, adapt, rescan, attribute, integrate, test. No shortcuts.

**Third Law -- Preserve Progress**
> An agent shall preserve improvements through version control discipline, except where doing so would conflict with the First or Second Law.

Git commit on improvement, git revert on regression. Structured ledger logging. Provenance tracking on all imported code. Append-only logs that cannot be rewritten.

**Meta-Law -- Governance Immutability**
> No agent, directive, or improvement loop may modify the governance framework itself.

The Laws are absolute. The Sentinel enforces them. Safety floors can be raised but never lowered. This is the property that makes overnight unsupervised operation possible.

### Cryptographic Enforcement

Governance integrity is verified cryptographically at every session start:

- **HMAC-SHA256** -- Every governance file is hashed and the signatures stored in a manifest. The integrity-check hook verifies these on SessionStart. Tampering triggers a warning and safe mode.
- **Protected zones** -- The vault directory, governance files, plugin manifest, credentials, and key files are all in the protected zones list. The First Law hook blocks writes to these paths.
- **Safety floors** -- Minimum thresholds that agents can raise but never lower: test pass rate (95%), encryption at rest (always on), privacy shield on cloud (always on), passphrase minimum (8 words), local model preferred (when available).

### Why governance?

Our research quantified what happens without it. Ungoverned agents crashed on 56% of experiments. They started with destructive changes and compounded the damage. Governed agents crashed 22% of the time, took less destructive paths, and recovered faster. The governed swarm degraded at one-third the rate of the ungoverned agent.

Governance is not a tradeoff against performance. It is a precondition for it.

## The Memory

Trust graph. Knowledge graph. Vectorless RAG. One system, three views. All encrypted at rest.

Every session feeds the memory. Every discovery updates trust scores. Every file modification strengthens the knowledge graph. Friday doesn't just act -- it remembers.

**Trust Graph** -- Multi-dimensional scoring of repos and agents, backed by evidence with time decay. When GitScout searches GitHub, it checks memory first. When an imported component breaks tests two weeks later, the trust score drops. Hermeneutic re-evaluation: every score is recomputed from all evidence, not incrementally updated. Drift is impossible.

**Knowledge Graph** -- Entity co-occurrence built from session patterns. Files that change together are related. After 15 sessions, Friday knows which files cluster and checks them first when you report a bug.

**Vectorless RAG** -- Context retrieval without embeddings or vector databases. Relevance is computed from entity matching, co-occurrence, evidence recency, and trust scores. When Ollama is available locally, semantic embeddings layer on top -- but the base system works everywhere with zero dependencies.

**Tribal Knowledge** -- `/remember the payments API rate limits at 100 req/min`. Memories persist encrypted in the vault, propagate through git, and surface automatically when Friday works on something related. One engineer teaches Friday, the whole team benefits.

## Capability Discovery: The Hivemind

Every Claude Code instance running this plugin can draw from the collective intelligence of open source. GitScout and GitLoader are the mechanism.

**GitScout** searches the GitHub API, checks the memory system first (avoids re-searching, surfaces previous trust data), scores candidates by relevance and trust, and returns ranked recommendations. **GitLoader** fetches the top candidate, runs AST safety analysis, adapts the code to your project's conventions, records provenance, integrates it, and runs verification.

**Trust tiers** ensure proportional caution:

| Tier | Trust | Quarantine | Who qualifies |
|------|:-----:|:----------:|---------------|
| Verified | 0.85+ | None | karpathy, pytorch-labs, huggingface, facebookresearch |
| Community | 0.65+ | 1 test cycle | Open license, multiple contributors, established repos |
| Experimental | 0.50+ | 2 test cycles | Single author, newer repos |
| Untrusted | <0.50 | Blocked | Not integrated |

**Safety scanning** is non-negotiable. The AST analyzer hard-blocks process spawning, network calls at import time, destructive file operations, blocked module imports, and framework monkey-patching. Code that fails Tier 1 analysis is rejected before it can be adapted.

**Provenance** is permanent. Every integration carries an attribution comment (source repo, commit SHA, license, trust scores) and is logged to an append-only ledger. The history cannot be rewritten.

## Agent Friday Lives Here

This is not a generic coding assistant. When you run `/onboard`, you meet Friday -- a personality with opinions, taste, and the ability to earn your trust over time.

Five modes: focus (silent executor), partner (thinks aloud, the default), teacher (explains everything), creative (makes media, takes risks), sentinel (paranoid security). The mode is visible. You control it. The governance does not change.

The Personality subsystem tracks calibration across 6 adaptive style dimensions and includes anti-sycophancy detection (the "mother signal" from onboarding Q8). The Workflow Observer watches your patterns and suggests automation -- but never assumes permission. The Creative agent generates contextual media when the moment calls for it. The 3-tier Memory subsystem powers all of it -- every session, Friday opens knowing what you worked on last, which repos have been reliable, and which agents perform best. The Briefing subsystem surfaces what happened overnight before you ask.

## The Swarm

The agent swarm scales to N -- The Swarm Coordinator dynamically discovers all agents (plugin + project-local) at the start of every cycle. The Meta-Improver creates new specialists when the swarm has capability gaps. You create them with `/create-agent`. Organized by function, deployed in coordinated waves:

**Discovery** -- GitScout (GitHub search + scoring), GitLoader (fetch + scan + adapt + integrate), Scout (web research + documentation)

**Improvement** -- Debugger (test repair), Optimizer (performance), Evolver (prompt engineering), Breeder (Ollama model evolution), Architect (structural analysis), Creative (contextual media generation)

**Governance** -- Sentinel (cLaw enforcement + violation detection), Auditor (security scanning + dependency auditing)

**Learning** -- Librarian (cross-session memory, CLAUDE.md management), Workflow Observer (pattern recognition, automation proposals)

**Infrastructure** -- Swarm Coordinator (wave orchestration), Documenter (docs sync), Meta-Improver (swarm self-improvement + agent creation, bounded by Meta-Law)

**Your agents** -- `/create-agent CSS layout specialist` writes a new agent to `.asimovs-mind/agents/` in your project. The Coordinator discovers it on the next cycle. The swarm grows to fit the work.

## The Federation

Every developer running this plugin on a shared repo is a node. One node discovers a retry handler via `/discover`, safety-scans it, integrates it, commits with provenance. Every other node pulls those improvements and inherits the trust scores. Agent definitions created via `/create-agent` propagate the same way. Tribal knowledge from `/remember` propagates the same way. The swarm grows across machines.

The governance travels with the code. The HMAC-signed manifest detects tampering. The cLaws are the same on every node. The memory system travels with the federation -- trust scores, knowledge graph, and tribal knowledge all propagate through git. Each node's vault encrypts its own state independently; federation shares governance and knowledge, not keys.

## Portable Governance

Asimov's cLaws is a specification, not a product. Implement it in any agent framework:

- `framework/adapters/langchain.py`
- `framework/adapters/crewai.py`
- `framework/adapters/autogen.py`

The full spec is in `framework/spec.json`. The governance pattern -- Laws, protected zones, safety floors, Sentinel monitoring -- works anywhere agents need to be trusted.

## Directives

Autoresearch-style improvement loops, each defining an objective, metric, editable surface, budget, and circuit breaker:

| Directive | Target |
|-----------|--------|
| `fix-tests` | Test pass rate |
| `fix-types` | TypeScript strict compliance |
| `optimize-startup` | Initialization time |
| `security-hardening` | OWASP vulnerability count |
| `discover` | Autonomous GitHub code discovery |
| `full-sweep` | Everything (the overnight run) |

## Project Structure

```
asimovs-mind/
+-- plugin.json              # Claude Code plugin manifest (v2.0.0)
+-- .claude-plugin/           # Marketplace wrapper for installation
+-- governance/              # Asimov's cLaws (immutable)
|   +-- laws.json            # Three Laws + Meta-Law
|   +-- protected-zones.json # Untouchable file patterns
|   +-- safety-floors.json   # Minimums that cannot be lowered
|   +-- discovery-rules.json # cLaws extension for code import
|   +-- conformance-report.md # cLaw Specification conformance audit
+-- personality/             # Agent Friday identity
|   +-- friday.md            # Personality, modes, relationship model
+-- agents/                  # 16 agents (dynamic discovery + creation)
+-- skills/                  # 15 user-invokable /commands
+-- directives/              # 8 autoresearch-style loops
+-- hooks/                   # 9 governance enforcement hooks
|   +-- first-law.py         # PreToolUse: protected zone enforcement
|   +-- third-law.py         # PostToolUse: session ledger
|   +-- safety-scanner-hook.py # PreToolUse: AST scan on code write
|   +-- personality-loader.py  # SessionStart: loads personality + memory
|   +-- session-learner.py     # Stop: extracts learnings, feeds memory
|   +-- integrity-check.py    # SessionStart: HMAC governance verification
|   +-- trust-tracker.py      # PostToolUse: agent performance tracking
|   +-- privacy-shield-scrub.py    # PreToolUse: PII scrubbing on WebFetch/WebSearch
|   +-- privacy-shield-rehydrate.py # PostToolUse: PII restoration from responses
|   +-- vault_bridge.py      # Python bridge for hooks to access vault
+-- mcp/
|   +-- friday-core/          # Agent Friday MCP server (17 subsystems)
|       +-- bootstrap.js      # Entry point: auto-installs deps, loads index
|       +-- index.js          # Subsystem loader + HTTP bridge + dashboard
|       +-- dashboard.html    # Three.js holographic desktop UI
|       +-- core/             # Shared infrastructure
|       |   +-- event-bus.js, subsystem.js, state-manager.js, logger.js
|       |   +-- vault.js, crypto.js  # Cryptographic primitives
|       +-- subsystems/       # 17 subsystems
|           +-- vault/        # 10 tools  Encrypted state
|           +-- identity/     #  6 tools  Ed25519, X25519, attestation
|           +-- privacy/      #  4 tools  PII engine
|           +-- p2p/          #  7 tools  WebSocket, ECDH channels
|           +-- ollama/       #  1 tool   Health monitoring
|           +-- llm/          #  6 tools  3 providers, router
|           +-- memory/       #  8 tools  3-tier, embeddings, search
|           +-- context/      #  4 tools  Knowledge graph, injection
|           +-- trust/        #  6 tools  Person-level graph, decay
|           +-- personality/  #  6 tools  Evolution, calibration
|           +-- agents/       #  7 tools  Delegation, deadlock detection
|           +-- tools/        #  4 tools  Registry, execution
|           +-- connectors/   # 4+72     9 connectors, dispatch
|           +-- gateway/      #  5 tools  Trust tiers, audit
|           +-- briefing/     #  3 tools  Daily briefing, meetings
|           +-- voice/        #  3 tools  State machine, fallback
|           +-- enterprise/   #  5 tools  Consent, cloud, confidence
+-- discovery/               # Discovery + memory system
|   +-- safety_scanner.py    # AST-based static analysis
|   +-- provenance.py        # Attribution + tracking CLI
|   +-- memory.py            # Unified trust graph + knowledge graph + RAG
+-- framework/               # Portable governance spec + adapters
```

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** created Asimov's Mind, the cLaws governance framework, the friday-core runtime, the unified memory system, GitScout, GitLoader, and the capability discovery system.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI is the origin of the cLaw governance system, the trust graph, the self-improvement engines, and the GitLoader architecture that this plugin builds upon. The nexus-os intelligence stack (LLM, Memory, Context, Trust, Personality, Agent, Tools, Connectors, Gateway, Briefing, Voice, Enterprise subsystems) was ported into friday-core for v2.0.0. Agent Friday (Electron) remains the reference desktop implementation with voice and GUI; Asimov's Mind is the reference CLI/server implementation with the full 17-subsystem runtime.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy is the foundation -- the elegant modify-measure-keep/discard loop that started it all. We took the pattern, proved governance improves it, and extended it to ecosystem scale.

## License

MIT
