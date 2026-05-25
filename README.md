# Asimov's Mind — v4: Friday Desktop

### A governed AI runtime with a holographic desktop, an encrypted memory, and a personality that grows up.

Asimov's Mind is the architecture. **Agent Friday** is the AI persona that runs on it. **Friday Desktop** is the holographic interface you talk to.

This release bundles the complete ecosystem in one repo:

| Component | What it is |
|---|---|
| **Friday Desktop** | Flask + React + Three.js holographic OS — voice, vision, creative studio, family/coparent/career workspaces |
| **friday-core MCP** | 19 subsystems, 97 tools, AES-256-GCM vault, Ollama-routed LLM gateway, P2P fabric, trust graph, personality evolution |
| **7 Core Python Systems** | Sovereign Vault · Privacy Shield · Trust Graph · Cognitive Memory · Personality Evolution · Epistemic Score · HMAC Integrity |
| **The cLaws** | Hard behavioral safety constraints — enforced by hooks before every tool call, immutable in core zones |
| **Career-Ops** | AI-powered job search pipeline (evaluation, CV generation, portal scanning) |

All state is AES-256-GCM encrypted on your machine. Ed25519 cryptographic identity. Privacy Shield PII scrubbing on every LLM call. Ollama local-first model routing. Bounded by the cLaws.

Built by **[FutureSpeak.AI](https://futurespeak.ai)** · Discord: **[discord.gg/f2VM6qNk](https://discord.gg/f2VM6qNk)** · GitHub: **[github.com/FutureSpeakAI](https://github.com/FutureSpeakAI)**

> **New here?** Run `setup.sh` (Mac/Linux) or `setup.bat` (Windows) and you're up in two minutes.

---

## What is Asimov's Mind?

Most "AI assistants" are stateless: they greet you the same way every time, forget what you worked on yesterday, and can't tell a trusted collaborator from a hostile prompt.

Asimov's Mind is the opposite. It is a **persistent, governed runtime** with:

- **Encrypted long-term memory.** Every state file — settings, personality, trust scores, conversation history — is sealed with AES-256-GCM, keyed by Argon2id-derived material. Your passphrase never leaves the device.
- **A trust graph.** Friday remembers people you interact with, scores them across multiple dimensions (reliability, competence, alignment), and updates those scores as evidence accumulates.
- **A personality that evolves.** Friday has a maturity score (0.0 → 1.0) that grows from witnessed interactions. After enough evolution, structural state changes — internal models, dashboard scene, communication style. There are 13 evolution structures.
- **An epistemic independence score.** Friday tracks how much it relies on you (the user) for novel facts vs. how often it brings independent observations to the table. A sycophancy detector watches for collapse and flags it.
- **The cLaws.** A set of hard behavioral safety constraints (Asimov-inspired) enforced by hooks *before* tool calls. Protected zones (`hooks/`, `governance/`, vault keys) cannot be modified by agents. Safety floors can only be raised, never lowered.
- **A coordinated swarm.** When work needs parallelism, Friday spawns specialist sub-agents (researcher, builder, reviewer, archivist…) and their outputs flow back through a trust-gated review.

---

## What is Agent Friday?

Agent Friday is the persona that runs on Asimov's Mind. Editorially sharp, loyally contrarian, warm, allergic to corporate BS.

Friday knows who you are because you tell it once (`~/.friday/profile.json`) — name, role, family, projects, the things you care about. It uses that context everywhere: outreach drafts, creative work, daily briefings, voice conversations.

Friday is **family, not a tool.** Short, sharp responses. Honest about uncertainty. Pushes back when it disagrees. Never sycophantic.

---

## The 7 Core Systems

The Python core (`mcp-servers/friday-mcp/`) implements seven cooperating systems that give Friday its persistence and judgment.

1. **Sovereign Vault** — AES-256-GCM encrypted state. Argon2id key derivation from a passphrase that lives only in-memory. Vault keys are validated to prevent path traversal. The vault is mounted at `~/.asimovs-mind/vault/`.
2. **Privacy Shield** — PII detection + redaction. Runs on every outbound LLM payload. Configurable watchlist at `~/.friday/privacy_shield.json`. Catches emails, phone numbers, addresses, custom patterns.
3. **Trust Graph** — Multi-dimensional people scoring (competence, reliability, alignment, warmth…). Updates from interaction evidence. Persisted at `~/.friday/trust_graph.json`. Cross-referenced in every chat context.
4. **Cognitive Memory** — Episodic + semantic recall. Memories are tagged, indexed, and consolidated over time. Search by topic, person, or time range.
5. **Personality Evolution** — Maturity 0.0 → 1.0. Tracks first launch, growth rate, structure index. Triggers visual and behavioral evolution at thresholds.
6. **Epistemic Independence Score** — Measures how often Friday brings novel observations vs. echoing the user. Sycophancy detector watches for drift below 0.5.
7. **HMAC Integrity** — Every state write is HMAC-signed. Tampering is detected on read.

---

## The Holographic Desktop

`interfaces/desktop/` is a Flask backend + assembled React frontend with a Three.js holographic scene. Run `python server.py` and open `http://localhost:5000`.

What you get:

- **Workspaces** — Family, Coparent, Career, FutureSpeak (business ops), Studio (creative gen), Code (parallel Claude Code terminals), News (briefing), Health/Finance/Calendar dashboards.
- **Voice conversations** — Gemini Live API bridge over WebSocket. Camera-aware. Tunable voice (Aoede, Kore, Leda, Puck, Charon).
- **Creative studio** — Generate images, music, video, poems via Gemini. Outputs land in `~/Desktop/friday-creations/`.
- **Personality scene** — Three.js holographic structure that reflects Friday's current evolution state. Shifts color, complexity, and motion as Friday matures.
- **Settings panel** — Tune temperature, response length, personality traits, news priorities, voice, camera behavior. All persisted to the vault.
- **Profile-driven** — Every personalized card reads from `~/.friday/profile.json`. Ship a clean install to any user.

---

## The cLaws

The cLaws are the behavioral safety constraints that bound Friday. They are enforced by hooks (`hooks/*.py`) that run *before* every tool call. They cannot be modified by agents or by Friday itself.

The First Law (paraphrased): *Friday will not modify files in protected zones, will not exfiltrate vault contents, and will not bypass governance.*

The hook return protocol: exit 0 to allow, exit 2 with a blocking reason to deny. Protected zones include `hooks/`, `governance/`, and any file matching `governance/protected-zones.json`. Safety floors (in `governance/safety-floors.json`) can only be *raised*, never lowered.

If you want to read the actual law text: `governance/laws.json`.

---

## Key Innovations

- **Trust graph context injection.** Every chat enriches the prompt with the trust entries for any person mentioned, so Friday speaks about them with the right history.
- **Privacy Shield before every LLM call.** PII never crosses the network unless you've explicitly listed it as safe. Configurable per-pattern.
- **Personality evolution with structural state changes.** Not a tone slider — actual model and scene changes at maturity thresholds.
- **Epistemic independence tracking.** Friday measures its own sycophancy and flags collapse. You can see the score on the dashboard.
- **Coordinated swarm.** When a task needs parallelism, Friday spawns specialists and trust-gates their merge. Coordinator visible in the dashboard.
- **HMAC-signed state.** Tampering with any vault file is detected on the next read.
- **Hook-enforced governance.** The cLaws aren't a prompt instruction — they're enforced in code, before the tool call reaches the model.
- **Local-first LLM routing.** Ollama models are tried first when available; cloud only when needed. Cloud calls are gated by consent.

---

## Prerequisites

- **Python 3.10+** (3.11 recommended)
- **Node.js 18+** (for the friday-core MCP server)
- **[Claude Code](https://claude.com/claude-code)** — install via `npm install -g @anthropic-ai/claude-code` if you want plugin/skill integration
- **Anthropic API key** — required. *All reasoning and chat uses Claude.* Get one at [console.anthropic.com](https://console.anthropic.com).
- **Gemini API key** — required for voice + image generation. *Voice mode and image creation use Gemini.* Get one at [aistudio.google.com](https://aistudio.google.com/app/apikey).

Optional but recommended:

- **Ollama** (for local-first model routing) — [ollama.com](https://ollama.com)

---

## Quick Start

```bash
# 1. Clone
git clone https://github.com/FutureSpeakAI/asimovs-mind.git
cd asimovs-mind

# 2. Run setup (creates venv, installs deps, prompts for API keys, builds UI)
./setup.sh          # Mac/Linux
setup.bat           # Windows

# 3. Edit your profile (optional — but recommended)
$EDITOR ~/.friday/profile.json    # use interfaces/desktop/profile.example.json as a template

# 4. Start Friday Desktop
./start.sh          # Mac/Linux  (created by setup, gitignored — holds your keys)
start.bat           # Windows

# 5. Open the holographic UI
open http://localhost:5000

# 6. (Optional) Install the Claude Code plugin
claude plugin add .
```

First-run checklist:

1. Setup script asks for `ANTHROPIC_API_KEY` (required) and `GEMINI_API_KEY` (required for voice/images).
2. Setup creates `~/.friday/` with templates for profile, settings, trust graph, personality.
3. Setup runs `build_ui.py` to assemble the React frontend.
4. Setup writes a local `start.bat` / `start.sh` containing your API keys — **gitignored**, never committed.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                       Friday Desktop UI                          │
│   (Three.js holographic scene · React workspaces · voice/cam)    │
└────────────────────────────────┬────────────────────────────────┘
                                 │  HTTP / WebSocket
┌────────────────────────────────▼────────────────────────────────┐
│                     server.py  (Flask backend)                   │
│   chat · voice (Gemini Live) · creative gen · profile · routines │
└──────┬──────────────┬───────────┬──────────────┬────────────────┘
       │              │           │              │
   ┌───▼───┐    ┌─────▼─────┐ ┌───▼────┐  ┌──────▼──────┐
   │Claude │    │  Gemini   │ │ Vault  │  │ Trust Graph │
   │ (chat)│    │(voice/img)│ │(AES256)│  │  + Memory   │
   └───────┘    └───────────┘ └────────┘  └─────────────┘
                                   ▲              ▲
                                   │              │
                              ┌────┴──────────────┴────┐
                              │  friday-core (MCP)     │
                              │  19 subsystems         │
                              │  97 tools              │
                              │  HTTP bridge (hooks)   │
                              └────────────┬───────────┘
                                           │
                              ┌────────────▼───────────┐
                              │  Governance / cLaws    │
                              │  hooks/*.py            │
                              │  (pre-tool-call)       │
                              └────────────────────────┘
```

State lives in:

- `~/.asimovs-mind/vault/` — encrypted state (AES-256-GCM)
- `~/.friday/` — user-editable profile, settings, trust graph, personality, memory

---

## Screenshots

> *(placeholder — drop screenshots here)*
>
> - `docs/screenshots/desktop-genesis.png` — Genesis Lattice (early evolution)
> - `docs/screenshots/desktop-family.png` — Family workspace
> - `docs/screenshots/desktop-studio.png` — Creative Studio
> - `docs/screenshots/desktop-voice.png` — Voice conversation

---

## Repository Layout

```
asimovs-mind/
├── interfaces/desktop/       # Friday Desktop (Flask + React + Three.js)
│   ├── server.py             # backend
│   ├── ui_parts/             # source HTML chunks (head/scene/app)
│   ├── build_ui.py           # assembles ui_parts/ → index.html
│   ├── requirements.txt      # Python deps
│   └── profile.example.json  # template for ~/.friday/profile.json
├── mcp/friday-core/          # 19-subsystem MCP server (Node)
├── mcp-servers/              # Python MCP servers
├── core/                     # 7 core Python systems
├── hooks/                    # cLaws enforcement (Python pre-tool hooks)
├── governance/               # laws.json, protected-zones.json, safety-floors.json
├── skills/                   # Claude Code slash commands
├── agents/                   # specialist agent definitions
├── docs/                     # architecture & API reference
└── plugin.json               # Claude Code plugin manifest
```

---

## Credits & Attribution

- **Organization:** [FutureSpeak.AI](https://futurespeak.ai)
- **Creator:** Stephen C. Webster — Founder & CEO, FutureSpeak.AI
- **Chief Software Engineer:** Agent Friday (Claude by Anthropic) — AI-human collaborative development
- **License:** MIT (see [LICENSE](LICENSE))
- **Inspired by:** Asimov's Three Laws · Karpathy's [autoresearch](https://github.com/karpathy/autoresearch) · the Jarvis archetype

If you ship something built on top of this, we'd love to hear about it on Discord.

---

## Community

- **Discord:** [discord.gg/f2VM6qNk](https://discord.gg/f2VM6qNk)
- **GitHub:** [github.com/FutureSpeakAI](https://github.com/FutureSpeakAI)
- **Website:** [futurespeak.ai](https://futurespeak.ai)

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). PRs welcome — especially around new specialist agents, additional connectors, evolution-structure designs, and translation of the workspaces to other contexts.

Bug? Open an issue. Question? Drop into Discord.

---

*Friday is family, not a tool.*
