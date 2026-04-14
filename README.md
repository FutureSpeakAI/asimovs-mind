# Asimov's Mind

### A governed AI agent architecture with encrypted memory, evolving personality, trust modeling, and a holographic 3D desktop. 18 subsystems. 91+ MCP tools. 7 core Python systems. Built on the shoulders of giants.

---

**Asimov's Mind** is the overarching AI agent architecture.
**Agent Friday** is the AI persona that runs on it.
**Friday Desktop** is the holographic 3D desktop OS interface.

This monorepo bundles the complete ecosystem. Each major component also exists as a standalone repo under the [FutureSpeakAI](https://github.com/FutureSpeakAI) GitHub organization (49 repos and growing).

Built by **Stephen C. Webster** / **[FutureSpeak.AI](https://github.com/FutureSpeakAI)**

[Discord](https://discord.gg/f2VM6qNk) | [GitHub Org](https://github.com/FutureSpeakAI) | [Research](https://github.com/FutureSpeakAI/asimovs-mind-research) | [Changelog](CHANGELOG.md)

> **New here?** Run `setup.sh` (Mac/Linux) or `setup.bat` (Windows) and you're up in two minutes.

---

## What This Is

Asimov's Mind is not a chatbot wrapper. It is a complete AI agent runtime with:

- **Encrypted state** -- every piece of data AES-256-GCM encrypted at rest, passphrase-derived keys via Argon2id, key material zeroed after use
- **Persistent identity** -- Ed25519 signing keypairs and X25519 key exchange, cryptographic attestation of governance compliance
- **Evolving personality** -- 30 traits with a 50-session maturity ramp; Friday starts generic and becomes uniquely yours
- **Trust modeling** -- 5-dimension person-level credibility scores with hermeneutic re-evaluation (the agent re-interprets past evidence when new evidence arrives)
- **Anti-sycophancy** -- agreement-streak detection and positivity-bias monitoring backed by the Epistemic Independence Score; when independence declines, challenge level increases
- **Cognitive memory** -- 3-tier architecture (short/medium/long-term) with consolidation, episodic recall, and semantic search
- **Governance** -- Asimov's cLaws compiled into the runtime, HMAC-SHA256 signed, verified before every session
- **Privacy** -- PII detection and scrubbing across 9 categories before data leaves your machine
- **Holographic desktop** -- Three.js 3D scene with 13 evolution structures, mood-reactive animation, MediaPipe hand/face tracking
- **Encrypted P2P** -- federated communication between Agent Friday instances via WebSocket + ECDH + Ed25519

Friday remembers what you worked on last session. It knows which repos have been reliable and which agents perform best. It detects when it's telling you what you want to hear and pushes back. It coordinates a swarm of specialist agents that grows to fit the work. And every piece of state is encrypted on your machine.

---

## Quick Start

```bash
# Clone
git clone https://github.com/FutureSpeakAI/asimovs-mind.git
cd asimovs-mind

# One-command setup (creates venv, installs all deps, builds UI)
./setup.sh          # Mac/Linux
setup.bat           # Windows

# Configure API keys
cp templates/env.example .env
# Edit .env with your Anthropic key (required) and Gemini key (optional)

# Install as Claude Code plugin
claude plugin add .

# First session
/friday unlock              # initialize the encrypted vault
/onboard                    # 8-question interview — meet Agent Friday
/status                     # system health dashboard
```

Open `http://localhost:{port}/` for the holographic dashboard and browser-based passphrase entry.

See **[GETTING_STARTED.md](GETTING_STARTED.md)** for the full walkthrough.

---

## Architecture

```
asimovs-mind/
│
├── core/                    7 standalone Python systems (350+ tests)
│   ├── sovereign-vault/     AES-256-GCM + Argon2id encryption
│   ├── privacy-shield/      PII detection across 9 categories
│   ├── trust-graph/         5-dimension person-level credibility
│   ├── cognitive-memory/    3-tier memory with consolidation
│   ├── personality-evolution/ 30-trait evolution with anti-sycophancy
│   ├── epistemic-score/     6-metric independence tracking
│   └── hmac-integrity/      HMAC-SHA256 governance protection
│
├── mcp/friday-core/         Node.js MCP server (18 subsystems, 91 tools)
│   ├── core/                Vault, crypto, event bus, session conductor, EIS
│   ├── subsystems/          18 subsystem directories
│   └── test/                442 tests (0 failures)
│
├── mcp-servers/             Python MCP servers (FastMCP)
│   ├── core-mcp/            Wraps all 7 core systems (32 tools)
│   └── gemini-mcp/          Gemini creative: image, TTS, video, music (8 tools)
│
├── interfaces/desktop/      Friday Desktop OS
│   ├── server.py            Flask backend
│   ├── ui_parts/            Modular React components
│   └── vibe-mode/           Three.js 3D: 13 structures, mood system, audio-reactive
│
├── tools/career-ops/        AI job search pipeline (A-F scoring, CV gen, portal scanning)
├── hooks/                   10 Python governance hooks
├── skills/                  17 slash commands
├── agents/                  16 specialist agent definitions
├── governance/              cLaws, protected zones, safety floors
└── templates/               Setup templates + .env.example
```

### The friday-core MCP Server

The Node.js MCP server loads 18 subsystems in dependency order, exposing 91 MCP tools (plus ~65 dynamic connector tools) and a holographic dashboard.

```
Tier 0 (Foundation)
  ├── Vault          10 tools   AES-256-GCM state, Argon2id KDF, BLAKE2b sub-keys
  ├── Identity        6 tools   Ed25519 signing, X25519 exchange, attestation
  ├── Privacy         4 tools   PII scrubbing, session-scoped placeholders
  └── Ollama          1 tool    Local LLM health monitoring

Tier 1 (Transport)
  └── P2P             7 tools   WebSocket transport, ECDH channels, pairing

Tier 2 (Intelligence)
  ├── LLM             6 tools   3 providers, intelligence router, budget tracking
  ├── Memory          8 tools   3-tier storage, embeddings, semantic search
  ├── Context         4 tools   Knowledge graph, entity extraction, injection
  ├── Trust           7 tools   Person-level graph, hermeneutic re-evaluation
  └── Personality     7 tools   Evolution, calibration, anti-sycophancy

Tier 3 (Services)
  ├── Agents          7 tools   Recursive delegation, deadlock detection, teams
  ├── Tools           4 tools   Registry, execution delegate, safety gates
  ├── Connectors    4+~65       8 connectors, dynamic dispatch
  ├── Gateway         5 tools   Trust tiers, session mgmt, audit logging
  ├── Briefing        3 tools   Daily briefing, meeting prep, meeting intel
  ├── Voice           3 tools   State machine, fallback manager
  ├── Enterprise      5 tools   Consent gate, cloud gate, confidence, commitments
  └── Session         1 tool    Uptime, cwd context, greeting, commitments
                   ──────
                   91 tools + holographic dashboard
```

10 Python hooks enforce governance at the Claude Code level. 17 slash commands provide the user-facing interface. Full architecture documentation: **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**

---

## The 7 Core Systems

Each core system is a standalone Python module with its own test suite, CLI, and README. They can be used independently or composed through the unified MCP server.

| System | Description | Tests | Standalone Repo |
|--------|-------------|:-----:|-----------------|
| **Sovereign Vault** | AES-256-GCM encryption with Argon2id KDF (time_cost=3, 64 MiB, parallelism=4) | 20+ | [sovereign-vault](https://github.com/FutureSpeakAI/sovereign-vault) |
| **Privacy Shield** | PII detection and masking across 9 categories with FNV-1a hashing | 50+ | [privacy-shield](https://github.com/FutureSpeakAI/privacy-shield) |
| **Trust Graph** | 5-dimension person-level credibility with hermeneutic re-evaluation | 50+ | [trust-graph](https://github.com/FutureSpeakAI/trust-graph) |
| **Cognitive Memory** | 3-tier memory (short/medium/long) with Jaccard dedup and consolidation | 50+ | [agent-fridays-cognitive-memory](https://github.com/FutureSpeakAI/agent-fridays-cognitive-memory) |
| **Personality Evolution** | 30-trait engine with 50-session maturity ramp and anti-sycophancy | 50+ | [agent-fridays-personality-evolution-engine](https://github.com/FutureSpeakAI/agent-fridays-personality-evolution-engine) |
| **Epistemic Score** | 6-metric measurement of whether AI makes users smarter or more dependent | 50+ | [epistemic-score](https://github.com/FutureSpeakAI/epistemic-score) |
| **HMAC Integrity** | HMAC-SHA256 signing/verification for governance files (3 protection tiers) | 68 | [agent-fridays-hmac-integrity](https://github.com/FutureSpeakAI/agent-fridays-hmac-integrity) |

Run tests: `cd core/<system> && python -m pytest test_*.py`

---

## Friday Desktop -- The Holographic Interface

A 3D desktop OS built with Flask, React, and Three.js. The interface evolves visually as Friday's personality matures.

**11 Workspaces:** Home, Career, Wiki, Co-Parent, FutureSpeak, Family, Studio, Trust, System, Code, News

**13 3D Evolution Structures** -- each a named mathematical visualization that unlocks as the personality matures through 50 sessions:

| # | Structure | Name | Geometry |
|---|-----------|------|----------|
| 1 | CUBES | Genesis Lattice | Floating cube grid with organic breathing |
| 2 | ICOSAHEDRON | Sacred Sphere | Nested geodesic wireframes |
| 3 | NETWORK | Shannon Network | Self-organizing node physics |
| 4 | DOME | Geodesic Cathedral | Hemispherical vault with abyss |
| 5 | ASTROLABE | Lovelace Astrolabe | Nested rotating rings |
| 6 | TESSERACT | Von Neumann Tesseract | 4D hypercube projection |
| 7 | QUANTUM | Dirac Probability | Wave-deformed rainbow rings |
| 8 | MANDELBROT | Mandelbrot Set | 3D fractal landscape |
| 9 | MOBIUS | Turing Mobius | Flowing parametric strip |
| 10 | GRID | Ocean of Light | Infinite wave-plane |
| 11 | CABLES | Fibonacci Nerve | Spiral tube network |
| 12 | NONE | Transcendence | Matrix rain |
| 13 | EDEN | Giga Earth / REZ | Box tunnel with boss fight geometry |

**Mood System:** 6 mood states (neutral, focused, creative, warm, alert, melancholy) that shift scene colors, bloom intensity, and animation speed. The mood is driven by personality sentiment analysis with anti-sycophancy guardrails.

**Audio-Reactive Engine:** Emotional arc orchestration through synthesized audio -- low/mid/high frequency bands drive structure animation. Built on research from [asimovs-radio](https://github.com/FutureSpeakAI/asimovs-radio).

**Hand/Face Tracking:** MediaPipe integration for gesture-based interaction with the 3D scene. The holographic scene originated from a Gemini-powered desktop project and was adapted for the Agent Friday ecosystem.

```bash
cd interfaces/desktop
python build_ui.py     # Assemble UI from parts
python server.py       # Start at http://localhost:3000
```

---

## Asimov's cLaws

The governance system that makes unsupervised autonomy safe. Inspired by Isaac Asimov's Three Laws of Robotics and adapted for real AI agent systems.

**First Law -- Do No Harm.** Protected zones block writes to governance files, credentials, and vault state. AST safety scanning blocks dangerous code patterns before they reach your project.

**Second Law -- Obey Protocol.** Directives define editable surfaces, budgets, and circuit breakers. The discovery pipeline enforces a mandatory sequence: scout, scan, adapt, test, keep/discard.

**Third Law -- Preserve Progress.** Git commit on improvement, git revert on regression. Append-only session ledger. Provenance tracking on all imported code.

**Meta-Law -- Governance Immutability.** No agent can modify the governance framework. Safety floors can be raised but never lowered. HMAC-SHA256 integrity verification runs at every session start.

The cLaws are compiled into binary constraints, not prompt instructions. They are HMAC-SHA256 signed and verified before every action. An agent cannot override them even if instructed to.

**Research results:** Ungoverned agents crash 56% of the time. Governed agents crash 22%. The governed swarm degrades 3x slower. Paper and code: [asimovs-mind-research](https://github.com/FutureSpeakAI/asimovs-mind-research).

The cLaws framework is also available as a standalone, framework-agnostic governance system: [Asimovs-cLaws-framework](https://github.com/FutureSpeakAI/Asimovs-cLaws-framework).

---

## Key Innovations

### Trust Graph with Hermeneutic Re-evaluation

The trust graph doesn't just accumulate evidence -- it re-interprets past evidence in light of new information. When a new observation arrives for a person, the system re-evaluates all prior evidence with the updated context. This mirrors how human trust works: a single betrayal recolors everything that came before.

5 trust dimensions: reliability, information quality, emotional trust, timeliness, domain expertise. Fuzzy person resolution via exact alias matching, normalized name matching, and Levenshtein distance. 30-day half-life decay. Standalone: [trust-graph](https://github.com/FutureSpeakAI/trust-graph).

### 50-Session Personality Maturity Ramp

Friday starts generic. Over 50 sessions, personality traits emerge and strengthen based on interaction patterns. By session 50, the personality is fully unique to your working relationship. Visual parameters in the holographic desktop evolve in parallel -- the 3D scene literally looks different at session 50 than at session 1.

30 traits mapped to 4 visual dimensions. Anti-sycophancy calibration via the "mother question" in onboarding. Standalone: [agent-fridays-personality-evolution-engine](https://github.com/FutureSpeakAI/agent-fridays-personality-evolution-engine).

### Anti-Sycophancy Circuit Breaker

Most AI assistants agree with you too much. Friday monitors agreement streaks and positivity bias. When sycophantic patterns are detected, the challenge level increases automatically. This is backed by the Epistemic Independence Score -- a running metric that measures whether the AI is making you smarter or more dependent.

6 cognitive metrics: independence, question complexity, knowledge transfer, critical thinking, self-correction, delegation. Standalone: [anti-sycophancy](https://github.com/FutureSpeakAI/anti-sycophancy) and [epistemic-score](https://github.com/FutureSpeakAI/epistemic-score).

### Multi-Agent Attestation via Ed25519 Signatures

Every Agent Friday instance has a unique Ed25519 identity. When agents communicate over the encrypted P2P network, they sign cLaw attestations -- cryptographic proof that their governance is intact. An agent with tampered governance cannot forge a valid attestation. The signature is verified before any data exchange.

### Encrypted P2P Federation

Agent Friday instances communicate over WebSocket with X25519 ECDH key agreement, HKDF-derived session keys, AES-256-GCM message encryption, and Ed25519 ciphertext signing. Signature is verified before decryption (no oracle attacks). Sequence-numbered AAD prevents replay.

---

## MCP Servers

### Core MCP (Python / FastMCP)

Wraps all 7 core Python systems into 32 MCP tools. Useful for running the core systems without the full friday-core Node.js stack.

```bash
cd mcp-servers/core-mcp
pip install -r requirements.txt
claude mcp add friday-core-py -- python server.py
```

### Gemini MCP (Python / FastMCP)

8 creative tools via Google's Gemini API:

| Tool | Capability |
|------|-----------|
| `gemini_generate_image` | Text-to-image (Imagen, Flash fallback) |
| `gemini_generate_text` | Creative text generation |
| `gemini_describe_image` | Vision analysis of image files |
| `gemini_text_to_speech` | TTS with 8 voices (Gemini 2.5 Flash Preview TTS) |
| `gemini_creative_remix` | Style transfer on existing images |
| `gemini_generate_code_art` | p5.js generative art from description |
| `gemini_generate_video` | Veo video generation (async) |
| `gemini_generate_music` | Lyria music generation (full tracks or clips) |

```bash
claude mcp add friday-gemini -- python mcp-servers/gemini-mcp/server.py
```

---

## Career-Ops Pipeline

AI-powered job search pipeline. Evaluate offers with A-F scoring across 10 weighted dimensions, generate ATS-optimized CVs with keyword injection, scan 45+ company portals via Playwright, batch process with sub-agents, and track applications.

Recommends not applying below 4.0/5.0. Supports interview prep with STAR story framework.

```bash
cd tools/career-ops
npm install            # Playwright for PDF generation
node doctor.mjs        # Verify setup
```

Adapted from [career-os](https://github.com/FutureSpeakAI/career-os). User data lives in gitignored directories. See [DATA_CONTRACT.md](tools/career-ops/DATA_CONTRACT.md).

---

## Security

v2.2.0 was a full security audit. v2.3.0 continued with 50 autonomous improvement cycles. Seven vulnerability classes closed:

- **Path traversal** -- vault keys validated against strict allowlist
- **Governance bypass** -- absolute paths normalized before protected-zone checks
- **HTTP bridge** -- bearer token auth on write endpoints, body size cap, tool whitelist
- **P2P** -- loopback-only binding, signature-before-decrypt, HKDF key derivation
- **XSS** -- all user inputs HTML-escaped, Content Security Policy header
- **Hook auth** -- bearer token on all authenticated requests
- **Dead code** -- 160 KB removed

442 tests across the MCP server. Zero failures. Full details: **[SECURITY.md](SECURITY.md)**

---

## See It in Action

```bash
/friday unlock                 # open the encrypted vault
/onboard                       # meet Agent Friday (8-question interview)
/status                        # system health (calls 9 MCP tools)
/briefing                      # daily briefing
/memory recall "auth system"   # semantic memory search
/trust "Alice" reliability     # check trust graph
/discover a retry mechanism    # the hivemind moment
/unleash                       # deploy the full agent swarm
/iterate fix-tests             # autoresearch loop
/remember the auth uses JWT    # teach Friday
/create-agent CSS specialist   # grow the swarm
/peer listen                   # start encrypted P2P
/help                          # categorized command reference
```

---

## Prerequisites

| Requirement | Minimum | What it's for |
|------------|---------|---------------|
| Python | 3.10+ | Core systems, MCP servers, Desktop OS, hooks |
| Node.js | 18+ | Claude Code plugin (friday-core MCP server) |
| Claude Code | Latest | Plugin host |
| Anthropic API key | Required | Claude Code |
| Gemini API key | Optional | Image gen, TTS, video, music |
| Ollama | Optional | Local-only operation (zero cloud dependency) |

---

## Documentation

| Document | What it covers |
|----------|---------------|
| [GETTING_STARTED.md](GETTING_STARTED.md) | Installation, first-run setup, troubleshooting |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system architecture, data flow, event wiring, security model |
| [docs/SUBSYSTEM_GUIDE.md](docs/SUBSYSTEM_GUIDE.md) | Deep dive into each of the 18 subsystems |
| [docs/HOOKS_GUIDE.md](docs/HOOKS_GUIDE.md) | All 10 Python hooks: triggers, behavior, vault bridge |
| [docs/SKILLS_GUIDE.md](docs/SKILLS_GUIDE.md) | All 17 slash commands: usage, MCP tools called |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Complete MCP tool reference (91 tools, all parameters) |
| [ROADMAP.md](ROADMAP.md) | Product roadmap from v0.1.0 through v3.0.0 |
| [CHANGELOG.md](CHANGELOG.md) | Version history (Keep a Changelog format) |
| [CONTRIBUTING.md](CONTRIBUTING.md) | How to add connectors, subsystems, and skills |
| [SECURITY.md](SECURITY.md) | Security model, known limitations, vulnerability reporting |
| [governance/conformance-report.md](governance/conformance-report.md) | cLaw Specification conformance audit |

---

## Standalone Repos

Every major component exists as a standalone repo under [github.com/FutureSpeakAI](https://github.com/FutureSpeakAI). This monorepo bundles them into a unified ecosystem, but each can be used independently.

### Core Systems

| Component | Standalone Repo | Description |
|-----------|----------------|-------------|
| Sovereign Vault | [sovereign-vault](https://github.com/FutureSpeakAI/sovereign-vault) | Passphrase-only encryption with Argon2id KDF |
| Privacy Shield | [privacy-shield](https://github.com/FutureSpeakAI/privacy-shield) | Strip PII from LLM prompts, restore in responses |
| Trust Graph | [trust-graph](https://github.com/FutureSpeakAI/trust-graph) | Personal hermeneutic trust model, 5 dimensions |
| Cognitive Memory | [agent-fridays-cognitive-memory](https://github.com/FutureSpeakAI/agent-fridays-cognitive-memory) | 3-tier cognitive memory with consolidation |
| Personality Evolution | [agent-fridays-personality-evolution-engine](https://github.com/FutureSpeakAI/agent-fridays-personality-evolution-engine) | Trait engine with maturity ramp |
| Epistemic Score | [epistemic-score](https://github.com/FutureSpeakAI/epistemic-score) | Measure AI's effect on user independence |
| HMAC Integrity | [agent-fridays-hmac-integrity](https://github.com/FutureSpeakAI/agent-fridays-hmac-integrity) | HMAC-SHA256 signing for governance files |
| Anti-Sycophancy | [anti-sycophancy](https://github.com/FutureSpeakAI/anti-sycophancy) | Runtime circuit breaker, 6 adaptive dimensions |

### Governance and Research

| Component | Standalone Repo | Description |
|-----------|----------------|-------------|
| cLaws Framework | [Asimovs-cLaws-framework](https://github.com/FutureSpeakAI/Asimovs-cLaws-framework) | Framework-agnostic AI governance with cryptographic attestation |
| Research | [asimovs-mind-research](https://github.com/FutureSpeakAI/asimovs-mind-research) | ML experiments: governed vs ungoverned agents |
| Radio Research | [asimovs-radio-research](https://github.com/FutureSpeakAI/asimovs-radio-research) | 150 experiments on emotional arc orchestration |

### Agent Systems

| Component | Standalone Repo | Description |
|-----------|----------------|-------------|
| Trust Graph Engine | [agent-fridays-trust-graph-engine](https://github.com/FutureSpeakAI/agent-fridays-trust-graph-engine) | Multi-dimensional trust scoring for AI agents |
| Intelligence Router | [agent-fridays-intelligence-router](https://github.com/FutureSpeakAI/agent-fridays-intelligence-router) | Task-aware LLM routing with circuit breakers |
| Context Graph | [agent-fridays-context-graph](https://github.com/FutureSpeakAI/agent-fridays-context-graph) | Real-time context awareness with event correlation |
| Orchestration | [agent-fridays-orchestration-framework](https://github.com/FutureSpeakAI/agent-fridays-orchestration-framework) | Trust-aware multi-agent orchestration |
| Commitment Tracker | [agent-fridays-commitment-tracker](https://github.com/FutureSpeakAI/agent-fridays-commitment-tracker) | Promise tracking with hermeneutic re-evaluation |
| Integrity Engine | [agent-fridays-integrity-engine](https://github.com/FutureSpeakAI/agent-fridays-integrity-engine) | Asimov-inspired core laws with HMAC signing |
| Hardware Profiler | [agent-fridays-hardware-profiler](https://github.com/FutureSpeakAI/agent-fridays-hardware-profiler) | GPU/VRAM detection, 5-tier model recommendations |
| Self-Improvement Kit | [agent-fridays-self-improvement-kit](https://github.com/FutureSpeakAI/agent-fridays-self-improvement-kit) | Controlled self-modification with rollback |
| Predictive Engine | [agent-fridays-predictive-engine](https://github.com/FutureSpeakAI/agent-fridays-predictive-engine) | Proactive suggestions from ambient signals |
| Meeting Intelligence | [agent-fridays-meeting-intelligence](https://github.com/FutureSpeakAI/agent-fridays-meeting-intelligence) | Meeting lifecycle: transcription, summaries, action items |

### Interfaces and Tools

| Component | Standalone Repo | Description |
|-----------|----------------|-------------|
| Asimov's Radio | [asimovs-radio](https://github.com/FutureSpeakAI/asimovs-radio) | Emotional arc orchestration through music |
| Career OS | [career-os](https://github.com/FutureSpeakAI/career-os) | AI career advancement with web dashboard |
| Gemini Bridge | [claude-gemini-bridge](https://github.com/FutureSpeakAI/claude-gemini-bridge) | Bridge Gemini Live voice to Claude Code |
| Pixel Office | [agent-fridays-pixel-office](https://github.com/FutureSpeakAI/agent-fridays-pixel-office) | Pixel office environment |
| Socratic Forge | [the-socratic-forge](https://github.com/FutureSpeakAI/the-socratic-forge) | Self-healing autonomous software development |
| PageIndex RAG | [agent-fridays-pageindex-rag](https://github.com/FutureSpeakAI/agent-fridays-pageindex-rag) | Vectorless reasoning-based RAG (98.7% accuracy) |
| GitNexus | [agent-fridays-gitnexus](https://github.com/FutureSpeakAI/agent-fridays-gitnexus) | Client-side code knowledge graph with Graph RAG |
| Global Intel Monitor | [agent-fridays-global-intelligence-monitor](https://github.com/FutureSpeakAI/agent-fridays-global-intelligence-monitor) | Real-time geopolitical monitoring dashboard |

Browse all 49 repos: **[github.com/FutureSpeakAI](https://github.com/FutureSpeakAI)**

---

## Credits and Acknowledgments

This project is open source, built on the shoulders of giants. Credit where it's due:

### People

**Stephen C. Webster / [FutureSpeak.AI](https://github.com/FutureSpeakAI)** -- Creator of Asimov's Mind, the cLaws governance framework, Agent Friday, the Sovereign Vault, the trust graph, the personality evolution system, the epistemic independence score, Friday Desktop, and the 49-repo FutureSpeakAI ecosystem.

**[Andrej Karpathy](https://github.com/karpathy)** -- [autoresearch](https://github.com/karpathy/autoresearch) is the foundation. The modify-measure-keep/discard loop that started the governed self-improvement pattern. We proved governance improves it and extended it to ecosystem scale.

**[Isaac Asimov](https://en.wikipedia.org/wiki/Isaac_Asimov)** -- The Three Laws of Robotics (1942) inspired the cLaws governance framework. Asimov asked the question 80 years before the field caught up: how do you make autonomous agents safe? The cLaws are our operational answer.

**[Claude Opus 4.6](https://anthropic.com)** by Anthropic -- Powers the intelligence behind Agent Friday and co-authored significant portions of the codebase, documentation, and research.

### Technology

**[Three.js](https://threejs.org/)** -- The 3D rendering engine behind the holographic desktop. The vibe-mode scene with 13 evolution structures, post-processing, and audio-reactive animation is built entirely on Three.js.

**[MediaPipe](https://mediapipe.dev/)** (Google) -- Hand and face tracking for gesture-based interaction with the 3D desktop. The holographic scene with MediaPipe integration was adapted from a Gemini-powered desktop project.

**[Flask](https://flask.palletsprojects.com/)** (Pallets Projects) -- Backend for Friday Desktop.

**[React](https://react.dev/)** (Meta) -- Frontend framework for the desktop interface.

**[libsodium](https://doc.libsodium.org/) / [sodium-native](https://github.com/sodium-friends/sodium-native)** -- All cryptographic primitives: Ed25519, X25519, AES-256-GCM, Argon2id, BLAKE2b, HKDF, SecureBuffer.

**[FastMCP](https://github.com/jlowin/fastmcp)** -- The Python MCP framework wrapping the core systems.

**[Ollama](https://ollama.ai/)** -- Local LLM inference for sovereign, zero-cloud operation.

**[Playwright](https://playwright.dev/)** (Microsoft) -- Browser automation for career-ops portal scanning and PDF generation.

**[Tailwind CSS](https://tailwindcss.com/)** -- Styling in the desktop interface.

**[Addy Osmani](https://github.com/addyosmani)** -- [agent-skills](https://github.com/addyosmani/agent-skills) informed Agent Friday's best practices framework.

### Adapted Projects

Several components in this ecosystem were adapted from or inspired by other open-source projects. The `agent-fridays-*` repos under [FutureSpeakAI](https://github.com/FutureSpeakAI) include forks and adaptations of tools from the broader AI agent community. Each repo's own README documents its specific lineage and attribution.

---

## Part of the Asimov Federation

The Asimov Federation is a network of governed AI agents sharing improvements, knowledge, and trust across machines through git. Every Agent Friday instance can join the federation, exchange cryptographically signed trust summaries, and discover improvements made by other instances -- all under the same cLaws governance.

---

## License

MIT

---

*Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI). Join us on [Discord](https://discord.gg/f2VM6qNk).*
