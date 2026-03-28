# Asimov's Mind

### Governed Recursive Self-Improvement for AI Agent Swarms

A Claude Code plugin that deploys a swarm of 12 specialized AI agents to autonomously debug, optimize, and improve any codebase — bounded by Asimov's Three Laws of Robotics as cryptographic-strength safety constraints.

Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch). Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI).

---

## Install

```bash
claude plugins add github:FutureSpeakAI/asimovs-mind
```

That's it. The swarm is ready.

## Quick Start

```bash
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

## The Swarm

12 specialized agents that work in parallel waves:

| Agent | Role | Capability |
|-------|------|------------|
| **Swarm Coordinator** | Brain | Diagnoses, prioritizes, deploys agents in waves |
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

## The Three Laws

Safety constraints that cannot be bypassed, overridden, or optimized away:

**First Law — Do No Harm**
> An agent shall not, through action or inaction, cause harm to the codebase, its users, or its data.

Enforced by: type-check gates, test gates, protected zones, circuit breakers.

**Second Law — Obey Directives**
> An agent shall follow its directive and human instructions, except where doing so would conflict with the First Law.

Enforced by: editable surfaces, budget caps, constraint compliance.

**Third Law — Preserve Improvements**
> An agent shall preserve its improvements through version control discipline, except where doing so would conflict with the First or Second Law.

Enforced by: git commit on improve, git revert on regress, structured ledger logging.

**Meta-Law — Governance Immutability**
> No agent, directive, or improvement loop may modify the governance framework itself.

Enforced by: governance files in protected zones, Sentinel monitoring.

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
├── plugin.json              # Claude Code plugin manifest
├── governance/              # The Three Laws (immutable safety bounds)
│   ├── laws.json            # Law definitions and enforcement rules
│   ├── protected-zones.json # Files no agent may modify
│   └── safety-floors.json   # Parameter minimums that can't be lowered
├── agents/                  # 12 specialized swarm agents
├── skills/                  # User-invokable /commands
├── directives/              # Autoresearch-style improvement loops
└── framework/               # Portable governance for other systems
    ├── spec.json            # Full governance specification
    └── adapters/            # LangChain, CrewAI, AutoGen adapters
```

## Credits

- **[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy — the core iteration pattern
- **[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI — the cLaw governance system and self-improvement engines

## License

MIT
