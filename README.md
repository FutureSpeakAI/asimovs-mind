# Asimov's Mind

### Governed Recursive Self-Improvement for AI Agent Swarms

A Claude Code plugin that deploys a swarm of 14 specialized AI agents to autonomously debug, optimize, and improve any codebase -- bounded by **Asimov's cLaws**, a governance framework that makes autonomous AI agents safe, accountable, and effective.

With **GitScout** and **GitLoader**, your agent can search the entire GitHub ecosystem for solutions, safety-scan them with AST analysis, and integrate them into your project -- turning Claude Code into a node of a software hivemind.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI). Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch).

---

## Install

```bash
claude plugins add github:FutureSpeakAI/asimovs-mind
```

That's it. The swarm is ready.

## Quick Start

```bash
# Search GitHub for code and integrate it safely
/discover a retry mechanism with exponential backoff

# Deploy the full swarm on your codebase
/unleash

# Run a specific improvement loop
/iterate fix-tests

# Breed a specialized local model
/breed "code review specialist"

# Evolve a system prompt
/evolve "You are a helpful assistant..."

# Check codebase health
/diagnose

# View governance rules
/govern
```

## Capability Discovery: GitScout + GitLoader

The discovery system lets your agent search GitHub for existing solutions and safely integrate them. Instead of writing everything from scratch, your agent stands on the shoulders of the open-source community.

Type `/discover a SOAP optimizer for PyTorch` and the pipeline runs: GitScout searches GitHub, scores by relevance + trust, GitLoader fetches the code, the safety scanner runs AST analysis, the adapter extracts and transforms the component, provenance is recorded, tests are run, and the result is kept or reverted.

**Trust Tiers:** Verified repos (known authors, MIT license) integrate directly. Community repos get 1 quarantine test cycle. Experimental repos get 2. Untrusted repos are blocked.

**Safety Scanner:** AST-based static analysis that HARD_BLOCKs process spawning, network calls at import time, destructive file operations, and blocked imports. SOFT_BLOCKs unsafe deserialization and global state mutation.

**Provenance:** Every integration gets an immutable attribution comment (source repo, license, trust scores) and is logged to an append-only provenance ledger.

## The Swarm

14 specialized agents that work in parallel waves:

| Agent | Role | Capability |
|-------|------|------------|
| **Swarm Coordinator** | Brain | Diagnoses, prioritizes, deploys agents in waves |
| **GitScout** | Discovery | Searches GitHub for code, scores relevance + trust |
| **GitLoader** | Integration | Fetches, safety-scans, adapts, and integrates code |
| **Debugger** | Test Fixer | Autonomous test repair and type error resolution |
| **Optimizer** | Performance | Startup parallelization, async I/O, memory leaks |
| **Evolver** | Prompt Engineer | Iterative prompt improvement via judge-scored evolution |
| **Breeder** | Model Factory | Creates specialized Ollama models via Modelfile evolution |
| **Auditor** | Security | OWASP Top 10 scanning, dependency auditing |
| **Documenter** | Documentation | Keeps docs in sync with code changes |
| **Sentinel** | Governance | Monitors all agents for law compliance |
| **Librarian** | Memory | Cross-session learning, CLAUDE.md management |
| **Scout** | Research | Web search, documentation lookup, tech discovery |
| **Architect** | Architecture | Structural analysis, refactoring plans |
| **Meta-Improver** | Self-Improvement | Improves the swarm itself (bounded recursion) |

## Asimov's cLaws

The governance framework at the heart of Asimov's Mind. Three Laws plus a Meta-Law that constrain every agent, every action, every integration. They cannot be bypassed, overridden, or optimized away.

**First Law -- Do No Harm**
> An agent shall not, through action or inaction, cause harm to the codebase, its users, or its data.

Enforced by: type-check gates, test gates, protected zones, circuit breakers, and the **safety scanner** (AST analysis that blocks dangerous patterns in discovered code before it touches your project).

**Second Law -- Obey Protocol**
> An agent shall follow its directive and human instructions, except where doing so would conflict with the First Law.

Enforced by: editable surfaces, budget caps, pipeline order enforcement, constraint compliance.

**Third Law -- Preserve Progress**
> An agent shall preserve its improvements through version control discipline, except where doing so would conflict with the First or Second Law.

Enforced by: git commit on improve, git revert on regress, structured ledger logging, **provenance tracking** for all imported code.

**Meta-Law -- Governance Immutability**
> No agent, directive, or improvement loop may modify the governance framework itself.

Enforced by: governance files in protected zones, Sentinel monitoring, safety floors that can be raised but never lowered.

## How It Works

The core pattern comes from [autoresearch](https://github.com/karpathy/autoresearch): treat code improvement as an iterative experiment.

```
Load directive (program.md)
    ↓
Measure baseline metric
    ↓
┌─→ Plan modification (LLM decides what to change)
│   ↓
│   Execute modification
│   ↓
│   Measure metric again
│   ↓
│   Improved? → git commit → continue
│   Regressed? → git revert → try different approach
│   ↓
│   Budget exhausted? → stop
│   Circuit breaker? → halt
│   ↓
└── Otherwise → loop
```

Each agent runs this loop on its specialty. The Swarm Coordinator deploys agents in parallel waves. The Sentinel watches everyone for governance violations.

## Directives

Autoresearch-style `program.md` files that define improvement loops:

| Directive | What it optimizes |
|-----------|-------------------|
| `fix-tests.md` | Test pass rate |
| `fix-types.md` | TypeScript strict compliance |
| `optimize-startup.md` | App initialization time |
| `security-hardening.md` | OWASP vulnerability count |
| `discover.md` | Autonomous capability discovery from GitHub |
| `full-sweep.md` | Everything (the overnight run) |

Create your own by following the directive format in any `.md` file.

## Portable Governance

The governance framework is not limited to Claude Code. Adapters are provided for:

- **LangChain** — `framework/adapters/langchain.py`
- **CrewAI** — `framework/adapters/crewai.py`
- **AutoGen** — `framework/adapters/autogen.py`

The full specification is in `framework/spec.json` — implement it in any agent system.

## Project Structure

```
asimovs-mind/
├── plugin.json              # Claude Code plugin manifest (v0.2.0)
├── governance/              # Asimov's cLaws (immutable safety bounds)
│   ├── laws.json            # Three Laws + Meta-Law definitions
│   ├── protected-zones.json # Files no agent may modify
│   ├── safety-floors.json   # Parameter minimums that can't be lowered
│   └── discovery-rules.json # cLaws extension for code discovery
├── agents/                  # 14 specialized swarm agents
│   ├── git-scout.md         # GitHub code discovery
│   └── git-loader.md        # Safe code integration
├── skills/                  # User-invokable /commands
│   └── discover.md          # /discover -- capability discovery
├── directives/              # Autoresearch-style improvement loops
│   └── discover.md          # Autonomous discovery loop
├── discovery/               # Discovery tools (by FutureSpeak.AI)
│   ├── safety_scanner.py    # AST-based code safety analysis
│   └── provenance.py        # Attribution and tracking CLI
└── framework/               # Portable governance for other systems
    ├── spec.json            # Full cLaws specification
    └── adapters/            # LangChain, CrewAI, AutoGen adapters
```

## Research

Asimov's Mind is backed by empirical research. We ran controlled experiments comparing ungoverned vs. governed AI agents doing autonomous ML research:

- **Governance halved crash rates** (56% ungoverned vs 22% governed)
- **Governed swarm degraded 3x slower** during cumulative exploration
- **Specialist agents explored dimensions generalists ignored**

Paper and experiment code: [asimovs-mind-research](https://github.com/FutureSpeakAI/asimovs-mind-research)

## Credits

- **[FutureSpeak.AI](https://github.com/FutureSpeakAI)** -- Creator of Asimov's Mind, the cLaws governance framework, GitScout, GitLoader, and the capability discovery system
- **[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI -- The original cLaw governance system, self-improvement engines, and GitLoader architecture that inspired this plugin
- **[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy -- The core iteration pattern (modify, measure, keep or discard)

## License

MIT
