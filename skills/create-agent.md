---
name: create-agent
description: "Create a new specialist agent for the swarm. The agent is automatically discovered by the Swarm Coordinator on the next cycle."
user_invocable: true
---

# /create-agent -- Spawn a New Specialist

Create a new specialist agent that extends the swarm's capabilities. The agent is written as an `.md` file and automatically discovered by the Swarm Coordinator.

## Usage

```
/create-agent <description of what the agent should do>
```

Examples:
- `/create-agent CSS layout specialist that fixes responsive design issues`
- `/create-agent database migration agent for PostgreSQL schema changes`
- `/create-agent API endpoint tester that validates REST contracts`
- `/create-agent dependency updater that safely bumps package versions`

## What happens

1. Parse the description to determine: name, specialty, tools needed, trigger conditions
2. Read the project's codebase to understand conventions and tech stack
3. Generate an agent `.md` file with proper YAML frontmatter and instructions
4. Write it to `.asimovs-mind/agents/<name>.md` (project-local, not plugin-global)
5. Verify governance compliance (the agent must follow all Three Laws)
6. Report the new agent's name and capabilities

## Agent Template

Every created agent gets:
- A clear `when_to_use` field (so the Coordinator knows when to deploy it)
- The Three Laws referenced in its instructions
- A defined editable surface (what files it can touch)
- A measurable success metric
- A circuit breaker condition
- Appropriate tool access (minimal set needed for the job)

## Where agents live

- **Plugin agents** (`${CLAUDE_PLUGIN_ROOT}/agents/`): General-purpose, ship with the plugin. Only the Meta-Improver can add here.
- **Project agents** (`.asimovs-mind/agents/`): Project-specific specialists. Created by `/create-agent` and the Meta-Improver. These are versioned with the project.

## Governance

Created agents inherit all governance constraints:
- They cannot modify protected zones
- They cannot lower safety floors
- They cannot modify governance files
- They are monitored by the Sentinel
- Project-local agents are treated as Tier 2 trust by the Coordinator

## Options

```
/create-agent <description>           # create a project-local agent
/create-agent list                     # list all discovered agents (plugin + project)
/create-agent inspect <name>           # show an agent's full definition
```
