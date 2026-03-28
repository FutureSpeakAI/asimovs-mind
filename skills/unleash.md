---
name: unleash
description: "Start the full Asimov's Mind agent swarm on the current codebase. Deploys all 12 agents in coordinated waves to diagnose, fix, optimize, and improve."
user_invocable: true
---

# /unleash — Deploy the Swarm

Launch the Asimov's Mind swarm coordinator, which will:

1. **Diagnose** the codebase (tests, types, performance, security, docs)
2. **Deploy Wave 1** (parallel): Debugger + Optimizer + Auditor + Sentinel
3. **Deploy Wave 2** (after Wave 1): Evolver + Documenter + Architect
4. **Deploy Wave 3** (after Wave 2): Breeder + Librarian + Meta-Improver
5. **Synthesize** all results into a comprehensive improvement report

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
