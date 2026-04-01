---
name: route
description: "Intelligence router for local and cloud model selection. Manages Ollama integration, routing policies, and model recommendations."
user_invocable: true
---

# /route -- Intelligence Router

Manage how Friday routes inference between local models (Ollama) and cloud models (Claude API). Check model health, set routing policies, and get recommendations for which model fits a given task.

## Usage

```
/route status                          # Show Ollama health, models, routing stats
/route policy <policy>                 # Set routing policy
/route recommend <task_description>    # Recommend best model for a task
```

## Instructions

### `/route status`

Check the health and availability of local inference via Ollama, and display current routing configuration.

1. Call the `ollama_status` MCP tool to check whether Ollama is running and which models are available
2. Read routing config from vault via `vault_read("routing-config")` (if vault is unlocked)
3. If vault is locked or config doesn't exist, use defaults: `{ "policy": "auto", "stats": { "local_requests": 0, "cloud_requests": 0, "local_failures": 0 } }`

Display:

```
=== INTELLIGENCE ROUTER ===

Ollama:
  Status: running | stopped | unreachable
  Endpoint: http://localhost:11434
  Models Available:
    - llama3.1:8b (4.7 GB)
    - codellama:13b (7.4 GB)
    - mistral:7b (4.1 GB)
  [or "No models pulled. Run 'ollama pull <model>' to get started."]

Routing Policy: auto
  auto           -- Use local when available, fall back to cloud
  local_preferred -- Prefer local, use cloud only when local lacks capability
  local_only     -- Never route to cloud (requests fail if Ollama is down)
  cloud_preferred -- Prefer cloud, use local for privacy-sensitive tasks

Stats (this session):
  Local requests:  N
  Cloud requests:  N
  Local failures:  N
  Routing ratio:   N% local / N% cloud
```

If Ollama is not running:

```
=== INTELLIGENCE ROUTER ===

Ollama:
  Status: stopped
  To start: run 'ollama serve' in a terminal
  To install: https://ollama.ai

Routing Policy: auto (falling back to cloud while Ollama is unavailable)
```

### `/route policy <policy>`

Set the routing policy that governs how inference requests are distributed.

Valid policies:
- `local_preferred` -- Prefer Ollama models. Use cloud only when the local model lacks the capability (e.g., tool use, very long context). Best for privacy and cost.
- `local_only` -- All inference goes through Ollama. Requests fail if Ollama is unavailable. Maximum sovereignty, no cloud dependency.
- `cloud_preferred` -- Prefer Claude API for quality. Route to local only for privacy-sensitive tasks (when Privacy Shield flags PII that shouldn't leave the machine).
- `auto` -- Let Friday decide per-request based on task complexity, privacy requirements, and model availability. This is the default.

Implementation:

1. Validate the policy argument is one of the four valid values
2. If invalid, show the valid options and exit
3. Read current config from vault: `vault_read("routing-config")`
4. Update the policy field
5. Write back to vault: `vault_write("routing-config", updated_config)`
6. Confirm the change:

```
Routing policy set to: local_preferred
Local models will be preferred. Cloud is used only when local lacks capability.
```

### `/route recommend <task_description>`

Analyze a task description and recommend the best model for it.

1. Call `ollama_status` MCP tool to get available local models
2. Parse the task description for signals:
   - **Privacy-sensitive** (PII, credentials, personal data) -- strongly prefer local
   - **Code generation** -- prefer models with code training (codellama, deepseek-coder)
   - **Long context** (large file analysis, multi-file review) -- prefer cloud (Claude) for 200K context
   - **Simple tasks** (formatting, renaming, short summaries) -- prefer local to save cost
   - **Complex reasoning** (architecture decisions, debugging, multi-step analysis) -- prefer cloud
   - **Creative writing** (documentation, commit messages, comments) -- either works
3. Read current routing policy from vault
4. Factor in policy constraints (e.g., local_only means cloud is never recommended)

Display:

```
Task: "refactor the auth module to use JWT"

Recommendation: cloud (Claude)
Reason: Complex refactoring across multiple files benefits from long context
        and strong reasoning. No PII detected in task description.

Alternative: codellama:13b (local)
Tradeoff: Lower cost, full privacy, but may need more guidance on multi-file changes.

Current policy: auto (recommendation follows policy)
```

Or for a privacy-sensitive task:

```
Task: "analyze the user database export for duplicates"

Recommendation: llama3.1:8b (local)
Reason: Task involves user data. Privacy Shield would flag PII for scrubbing.
        Running locally keeps all data on your machine.

Alternative: cloud (Claude) with Privacy Shield
Tradeoff: Better analysis quality, but PII will be scrubbed before sending.
          Some context may be lost in scrubbing.

Current policy: local_preferred (recommendation aligns with policy)
```

### `/route local-only`

Switch to fully local, API-free operation. This is a guided command that sets `local_only` routing policy and verifies the local infrastructure is ready.

1. Call `ollama_status` MCP tool to check whether Ollama is running
2. If Ollama is not running, display an error and stop:

```
Ollama is not running. Cannot switch to local-only mode.

To start Ollama:
  1. Install: https://ollama.ai
  2. Run: ollama serve
  3. Pull a model: ollama pull llama3.1:8b
  4. Try again: /route local-only
```

3. If Ollama is running, check available models
4. If no models are pulled, display an error and stop:

```
Ollama is running but has no models. Pull at least one chat model:

  ollama pull llama3.1:8b       # Good general-purpose model
  ollama pull codellama:13b     # Strong for code tasks
  ollama pull deepseek-coder:6.7b  # Lightweight code model

Then try again: /route local-only
```

5. If Ollama is running and models are available:
   - Read current config from vault: `vault_read("routing-config")`
   - Set policy to `local_only`
   - Write back to vault: `vault_write("routing-config", updated_config)`
   - Report capabilities:

```
=== LOCAL-ONLY MODE ACTIVATED ===

Routing policy: local_only
All intelligence stays on your machine. No data leaves. No API keys required.

The Privacy Shield is unnecessary because there is no cloud to protect against.

Available locally:
  Chat models:
    - llama3.1:8b (4.7 GB)
    - codellama:13b (7.4 GB)
  Embedding models:
    - nomic-embed-text (274 MB)

Capability report:
  Vault encryption:          YES (AES-256-GCM, fully local)
  P2P channels:              YES (encrypted, machine-to-machine)
  Federation:                YES (git-based, no cloud needed)
  Trust graph:               YES (all local state)
  Memory system:             YES (knowledge graph, tribal knowledge)
  Governance hooks:          YES (all cLaws enforced locally)
  Attestation:               YES (Ed25519 signing, local)
  Privacy Shield:            UNNECESSARY (no cloud traffic)
  Agent quality:             DEPENDS ON MODEL (complex tasks may need a more capable model)

[or if no embedding model is found:]
  Note: No embedding model detected. Semantic search in the memory
  system will fall back to keyword matching. Pull nomic-embed-text
  for richer retrieval: ollama pull nomic-embed-text
```

6. If complex reasoning or architecture tasks are anticipated, add a note:

```
Tip: Local models handle most tasks well. For complex architecture
analysis or large-scale refactoring, consider temporarily switching
to a larger model or cloud routing: /route policy auto
```

## Routing Config Schema

The routing config is stored in the vault under the key `routing-config`:

```json
{
  "policy": "auto",
  "stats": {
    "local_requests": 0,
    "cloud_requests": 0,
    "local_failures": 0,
    "last_local_model": null,
    "last_request_at": null
  },
  "model_preferences": {
    "code": "codellama:13b",
    "general": "llama3.1:8b",
    "embedding": "nomic-embed-text"
  },
  "updated_at": "ISO timestamp"
}
```

## Governance

The intelligence router respects safety floors:
- `privacy_shield_on_cloud`: When routing to cloud, PII scrubbing is mandatory
- `local_model_preferred`: When set to true and Ollama is available, local is the default choice
- The router never sends data to cloud in `local_only` mode, even if the local model fails
