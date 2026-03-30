---
name: unleash
description: "Start the full Asimov's Mind agent swarm on the current codebase. Discovers all available agents (plugin + project-local) and deploys them in coordinated waves."
user_invocable: true
---

# /unleash -- Deploy the Swarm

Launch the Asimov's Mind swarm coordinator, which will:

1. **Discover** all available agents (plugin agents + project-local `.asimovs-mind/agents/`)
2. **Diagnose** the codebase (tests, types, performance, security, docs)
3. **Deploy Wave 1** (parallel): Independent agents (diagnosis, scanning, fixing)
4. **Deploy Wave 2** (after Wave 1): Dependent agents (improvement, evolution)
5. **Deploy Wave 3** (after Wave 2): Meta-agents (self-improvement, memory, documentation)
6. **Discovery** (conditional): GitScout + GitLoader if the swarm identifies unmet needs
7. **Synthesize** all results into a comprehensive improvement report

## Usage

```
/unleash              # Full swarm — all agents
/unleash debug        # Debugger swarm only (test fixes + type fixes)
/unleash optimize     # Optimizer swarm (performance + bundle + startup)
/unleash secure       # Security swarm (auditor + sentinel)
/unleash evolve       # Intelligence swarm (evolver + breeder + meta-improver)
```

## Instructions

Spawn the `swarm-coordinator` agent to orchestrate the full swarm. Pass any focus area from the user's arguments. The coordinator will handle wave deployment, parallel execution, and result synthesis.

Before starting, verify governance compliance by reading `governance/laws.json` and `governance/protected-zones.json` from the plugin root directory (`${CLAUDE_PLUGIN_ROOT}`).

Report progress at each wave transition.
