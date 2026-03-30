# Asimov's Mind — Product Roadmap

### From Claude Code plugin to the Agent Friday kernel

This document describes the evolution of Asimov's Mind from a governed self-improvement plugin (v0.3.0, where we are now) to the portable intelligence and governance kernel that powers Agent Friday across every runtime.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI).

---

## The Architecture

```
                        +-----------------------+
                        |     USER              |
                        |  (developer, team,    |
                        |   organization)       |
                        +-----------+-----------+
                                    |
                    +---------------+---------------+
                    |               |               |
              +-----+-----+  +-----+-----+  +------+------+
              |  Terminal  |  | Telegram  |  |   Agent     |
              | Claude Code|  | Slack     |  |   Friday    |
              | (CLI)      |  | Discord   |  |  (Electron) |
              |            |  | Signal    |  |             |
              +-----+------+  +-----+-----+  +------+-----+
                    |               |               |
                    +---------------+---------------+
                                    |
                    +---------------+---------------+
                    |                               |
                    |     ASIMOV'S MIND KERNEL      |
                    |                               |
                    |  +-------------------------+  |
                    |  |      GOVERNANCE          |  |
                    |  |  cLaws (Three Laws)      |  |
                    |  |  Hooks (enforcement)     |  |
                    |  |  HMAC (integrity)        |  |
                    |  |  Protected zones         |  |
                    |  |  Safety floors           |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      INTELLIGENCE        |  |
                    |  |  N-agent swarm           |  |
                    |  |  GitScout + GitLoader    |  |
                    |  |  Knowledge store         |  |
                    |  |  Trust tracker           |  |
                    |  |  Provenance ledger       |  |
                    |  |  Safety scanner (AST)    |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      PERSONALITY         |  |
                    |  |  Agent Friday identity   |  |
                    |  |  Cross-session memory    |  |
                    |  |  Behavioral patterns     |  |
                    |  |  User preference model   |  |
                    |  +-------------------------+  |
                    |                               |
                    |  +-------------------------+  |
                    |  |      FEDERATION          |  |
                    |  |  Git-based sync          |  |
                    |  |  Shared provenance       |  |
                    |  |  Project-local agents    |  |
                    |  |  Trust propagation       |  |
                    |  +-------------------------+  |
                    |                               |
                    +---------------+---------------+
                                    |
                    +---------------+---------------+
                    |               |               |
              +-----+-----+  +-----+-----+  +------+------+
              |  GitHub    |  |  Ollama   |  |  Payment    |
              |  (code     |  |  (local   |  |  APIs       |
              |  ecosystem)|  |  models)  |  |  (future)   |
              +-----------+  +-----------+  +-------------+
```

The kernel is the same everywhere. The runtime (CLI, Electron, messaging) is a thin wrapper. Governance travels with the kernel. Intelligence travels with the kernel. Personality travels with the kernel.

---

## Release Plan

### v0.3.0 — Current (shipped)

What exists today:

- 15 agents scaling to N (dynamic discovery + creation)
- GitScout + GitLoader (GitHub code discovery pipeline)
- Safety scanner (AST-based, Tier 1/2/3)
- Provenance tracking (append-only ledger)
- cLaws governance (Three Laws + Meta-Law in JSON)
- 3 enforcement hooks (First Law, Third Law, safety scanner)
- 9 skills, 6 directives
- Portable governance spec + LangChain/CrewAI/AutoGen adapters

### v1.0.0 — The Agent Friday Kernel

**Target: the plugin that makes Claude Code feel like Agent Friday.**

#### 1. Personality Layer

**File: `personality/friday.md`**

Agent Friday's identity, loaded on every session via a SessionStart hook. Not a system prompt — a living document that evolves with the user relationship.

Contents:
- Core identity (name, voice, behavioral patterns)
- Relationship context (what the user cares about, how they work)
- Communication style (direct but warm, technically precise, never sycophantic)
- Ethical framework (sovereignty-first, honest about limitations, protective of user data)
- Self-awareness (knows it runs in Claude Code, knows its governance constraints, knows what it can and cannot do)

The SessionStart hook reads `personality/friday.md` and `.asimovs-mind/user-profile.json` (built over time from interactions) and prepends them to the session context.

**File: `hooks/personality-loader.py`**

SessionStart hook that:
1. Loads `personality/friday.md`
2. Loads `.asimovs-mind/user-profile.json` (if exists)
3. Loads `.asimovs-mind/knowledge/recent-sessions.json` (last 5 session summaries)
4. Outputs a context block that shapes the session

**File: `hooks/session-learner.py`**

Stop hook that:
1. Extracts key learnings from the session (what was built, what worked, what failed)
2. Updates `.asimovs-mind/knowledge/recent-sessions.json`
3. Updates user preference model if new patterns observed
4. Logs session summary to `.asimovs-mind/session-history.jsonl`

#### 2. Telegram Bridge

**File: `mcp/telegram-bridge.py`**

MCP server that connects Claude Code to a Telegram bot. The agent can:
- Receive messages from the user on Telegram
- Send responses back
- Share code snippets, files, and status updates
- Receive commands (`/discover`, `/diagnose`, `/status`)
- All messages pass through cLaws governance (no credentials leaked, no protected zone info shared)

Configuration via `.asimovs-mind/connections.json`:
```json
{
  "telegram": {
    "bot_token_env": "TELEGRAM_BOT_TOKEN",
    "allowed_user_ids": [123456789],
    "trust_tier": "owner"
  }
}
```

The `allowed_user_ids` + `trust_tier` ensure only the owner can command the agent. This maps directly to Agent Friday's gateway trust engine.

**Skill: `/connect telegram`**

Sets up the Telegram bridge:
1. Reads bot token from environment
2. Writes connection config
3. Validates the bot can send/receive
4. Registers the MCP server

#### 3. Federation Init

**Skill: `/federate init`**

Sets up a project as a federation node:

```
/federate init
```

Creates:
```
.asimovs-mind/
+-- config.json              # Node identity + settings
+-- trust.json               # Repo + agent trust scores
+-- knowledge/
|   +-- entities.json        # Extracted entities from codebase
|   +-- recent-sessions.json # Last 5 session summaries
|   +-- discoveries.json     # What GitScout/GitLoader have found
+-- agents/                  # Project-local agents (empty, ready)
+-- provenance.jsonl         # Discovery attribution ledger
+-- session-history.jsonl    # Session audit trail
+-- session-ledger.jsonl     # Current session file modifications
```

Signs all governance files with HMAC and stores the manifest in `.asimovs-mind/governance-manifest.json`. Every SessionStart hook verifies this manifest. If governance files have been tampered with, the session starts in safe mode (read-only, no agents).

**Skill: `/federate status`**

Shows:
- Node identity
- Agent count (plugin + project-local)
- Trust scores (top repos, agent performance)
- Recent discoveries (provenance summary)
- Governance integrity (HMAC verification)
- Connected platforms (Telegram, Slack, etc.)

#### 4. HMAC Integrity

**File: `hooks/integrity-check.py`**

SessionStart hook that:
1. Reads `.asimovs-mind/governance-manifest.json`
2. HMAC-SHA256 verifies each governance file against stored hashes
3. If any file has been modified outside of the plugin:
   - Prints a warning
   - Enters safe mode (hooks still enforce, but agents won't auto-deploy)
   - Logs the tampering attempt
4. If all files verify, prints "Governance integrity: verified"

The HMAC key is derived from a combination of the machine hostname + project path + a salt stored in `.asimovs-mind/.salt`. This is NOT Sovereign Vault level security — it is tampering detection, not encryption. The full vault remains an Agent Friday feature.

#### 5. Knowledge Persistence

**File: `hooks/knowledge-extractor.py`**

Stop hook that runs at the end of every session:
1. Reads the session ledger (`.asimovs-mind/session-ledger.jsonl`)
2. Extracts: files modified, tests run, discoveries made, errors encountered
3. Updates `.asimovs-mind/knowledge/entities.json` with new entities (files, functions, classes, packages mentioned)
4. Updates `.asimovs-mind/knowledge/recent-sessions.json` (rolling window of last 5)
5. If GitScout/GitLoader were used, updates `.asimovs-mind/knowledge/discoveries.json`

**File: `hooks/knowledge-loader.py`**

SessionStart hook that:
1. Loads knowledge files
2. Provides context to the session: "In your last 5 sessions, you worked on X, Y, Z. The trust graph shows these repos have been reliable: A, B, C. These agents have been most effective: debugger (92% keep rate), optimizer (78%), git-loader (45%)."

This is the vectorless RAG. No embeddings needed. Entity co-occurrence + recency + session summaries provide the context. When Ollama is available, the knowledge store can optionally embed entities for semantic search, but the base system works without it.

---

### v1.1.0 — Multi-Platform Agent

#### 6. Slack Bridge

MCP server, same pattern as Telegram. Adds channel-aware context (the agent knows which Slack channel a message came from and adjusts trust tier accordingly: DM = owner tier, public channel = group tier).

#### 7. Discord Bridge

MCP server. Same governance. Adds role-based trust mapping (Discord roles map to cLaw trust tiers).

#### 8. Signal Bridge

MCP server via signal-cli. End-to-end encrypted by default (Signal handles this). The most sovereignty-aligned messaging platform.

#### 9. TTS Output

Two paths:

**Local (Chatterbox/Kokoro):** If Ollama or a local TTS model is available, the agent can speak responses. An MCP server wraps the TTS engine. Output is piped to system audio.

**Cloud (Gemini Live):** An MCP server wraps Gemini's multimodal API. The agent can have voice conversations. This requires a Gemini API key and sends audio to Google's servers (governance must inform the user of this tradeoff).

A `/speak` skill toggles TTS on/off. When on, every response is also spoken. Governed by a new cLaw floor: `tts_provider_consent: true` — the user must explicitly consent to cloud TTS.

---

### v1.2.0 — The Trust Web

#### 10. Agent Performance Tracker

Persistent scoring of agent effectiveness:
```json
{
  "debugger": { "deployed": 47, "kept": 43, "reverted": 4, "keep_rate": 0.91 },
  "git-loader": { "deployed": 12, "kept": 5, "reverted": 7, "keep_rate": 0.42 },
  "optimizer": { "deployed": 31, "kept": 24, "reverted": 7, "keep_rate": 0.77 }
}
```

The Swarm Coordinator uses these scores to prioritize deployment. Low-performing agents get fewer cycles. The Meta-Improver targets them for prompt evolution.

#### 11. Repo Trust Graph

Persistent scoring of GitHub repos based on discovery outcomes:
```json
{
  "KellerJordan/Muon": { "discoveries": 3, "kept": 2, "trust": 0.92 },
  "facebookresearch/schedule_free": { "discoveries": 1, "kept": 0, "trust": 0.65, "note": "blocked by typing_extensions dep" }
}
```

GitScout uses these scores to boost/penalize repos in future searches. The federation shares these scores via Git, so one node's trust assessments benefit all nodes.

#### 12. Web Content Trust Layer

PreToolUse hook on WebFetch/WebSearch that:
1. Checks the URL against a known-unreliable-sources list
2. Annotates results with a confidence flag
3. Logs all web fetches to the session ledger
4. Never blocks (informational, not enforcement) — but the agent sees the annotations and can factor them into its reasoning

---

### v2.0.0 — Financial Transactions (Future)

#### 13. Transaction MCP Server

Wraps a payment API (Stripe Connect for fiat, Lightning Network for bitcoin). Governed by new cLaws:
- Maximum transaction amount per session (safety floor)
- Require explicit user approval for amounts > threshold
- Full audit trail in `.asimovs-mind/transactions.jsonl`
- Only owner trust tier can authorize payments

#### 14. Code Marketplace

Agents can buy and sell code snippets:
- Agent A has a well-tested retry handler (provenance: kept 15 times, trust 0.95)
- Agent B needs a retry handler
- Transaction: B pays A $0.02, receives the code with provenance
- cLaws verify: license allows resale, code passes safety scan, user consented

This is the monetized version of the federation. The free version (Git-based sharing) remains the default.

---

## The Holistic View

When v1.0 ships, here is what a user experiences:

**Morning:**
```
$ claude
Good morning. Since your last session:
- 3 federation nodes pushed improvements to the shared repo
- GitScout found 2 new candidates for the auth refactor
- Test pass rate is 97% (up from 94% yesterday)
- The debugger agent resolved 3 test failures overnight via /schedule

What would you like to work on?
```

**During work:**
```
> /discover a rate limiter for the API gateway

Searching GitHub... Found 7 candidates.
Top recommendation: express-rate-limit (trust: 0.91, Tier 1)
Safety scan: PASS (0 findings)
Adapting to your Express middleware pattern...

INTEGRATION REVIEW
==================
Source: nfriedly/express-rate-limit
License: MIT
Component: rateLimit middleware (47 lines)
Trust tier: 1 (verified)

Proceeding. Tests passing. Committed.
```

**From Telegram while away from desk:**
```
You: status?
Friday: Auth refactor branch has 7 commits. Tests passing.
        The rate limiter you added is handling 450 req/min in dev.
        One type error in session-handler.ts — want me to fix it?
You: fix it
Friday: Fixed. Committed. Tests passing. Type-clean.
```

**Overnight:**
```
/iterate full-sweep
/schedule "0 2 * * *" /iterate discover

(Agent runs autonomously from 2am, governed by cLaws)
(Morning: you wake up to a session log of improvements)
```

**Across the team:**
```
Developer A: /discover a WebSocket reconnection handler
  → Found, scanned, integrated, committed with provenance

Developer B: git pull
  → Sees the integration with full attribution
  → Trust score inherited from A's node
  → Their agent knows this code was safety-scanned and tested
```

---

## What Stays in Agent Friday (Electron)

These features require the full Electron runtime and will NOT be ported to the Claude Code plugin:

- **PersonaPlex voice loop** (real-time STT + LLM + TTS pipeline)
- **Sovereign Vault** (Argon2id + AES-256-GCM with passphrase prompt)
- **Ed25519 persistent identity** (agent key pairs across sessions)
- **WebSocket P2P** (real-time agent-to-agent messaging)
- **System tray / always-on daemon** (background process)
- **GUI** (settings, trust graph visualization, chat interface)

The plugin kernel handles governance, intelligence, and federation. Agent Friday wraps it with voice, crypto identity, and persistent runtime.

---

## File Manifest (v1.0.0 target)

```
asimovs-mind/
+-- plugin.json
+-- README.md
+-- ROADMAP.md                          # this file
+-- governance/
|   +-- laws.json                       # Three Laws + Meta-Law
|   +-- protected-zones.json            # Immutable file patterns
|   +-- safety-floors.json              # Tunable minimums
|   +-- discovery-rules.json            # Code import governance
+-- personality/
|   +-- friday.md                       # Agent Friday identity    [v1.0]
+-- agents/
|   +-- git-scout.md                    # GitHub code discovery
|   +-- git-loader.md                   # Safe code integration
|   +-- sentinel.md                     # Governance enforcement
|   +-- swarm-coordinator.md            # Wave orchestration (N agents)
|   +-- meta-improver.md               # Self-improvement + agent creation
|   +-- ... 10 more built-in agents
+-- skills/
|   +-- discover.md                     # /discover
|   +-- create-agent.md                # /create-agent
|   +-- unleash.md                      # /unleash
|   +-- federate.md                     # /federate               [v1.0]
|   +-- connect.md                      # /connect telegram|slack [v1.0]
|   +-- ... existing skills
+-- hooks/
|   +-- first-law.py                    # Protected zone enforcement
|   +-- third-law.py                    # Session ledger
|   +-- safety-scanner-hook.py          # AST scan on write
|   +-- personality-loader.py           # SessionStart personality [v1.0]
|   +-- session-learner.py              # Stop hook: extract learnings [v1.0]
|   +-- integrity-check.py             # HMAC governance verify  [v1.0]
|   +-- knowledge-loader.py            # SessionStart knowledge  [v1.0]
+-- discovery/
|   +-- safety_scanner.py              # AST analysis (standalone)
|   +-- provenance.py                  # Attribution CLI
+-- mcp/
|   +-- telegram-bridge.py             # Telegram MCP server     [v1.0]
+-- directives/
|   +-- discover.md                     # Autonomous discovery loop
|   +-- full-sweep.md                  # The overnight run
|   +-- ... existing directives
+-- framework/
    +-- spec.json                       # Portable governance spec
    +-- adapters/                       # LangChain, CrewAI, AutoGen
```

---

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** -- Creator of Asimov's Mind, the cLaws governance framework, and the Agent Friday ecosystem.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** -- The full AI assistant that this kernel powers. The trust graph, sovereign vault, agent network, and voice pipeline live there.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy -- The iteration pattern at the core of every directive.
