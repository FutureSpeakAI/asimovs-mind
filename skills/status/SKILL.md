---
name: status
description: "Show Agent Friday's full system status -- vault, memory, trust, personality, privacy, connectors, and more."
user_invocable: true
---

# /status -- Agent Friday System Status

Display a comprehensive, synthesized system status by calling MCP tools.

## Instructions

When the user runs `/status`, call the following MCP tools in parallel and synthesize the results into a compact status block:

1. `vault_status` -- vault state (locked/unlocked), subsystem health, uptime
2. `session_status` -- working directory context, greeting, uptime, pending commitments
3. `memory_status` -- tier counts (short, medium, long), episode status, embedding health
4. `trust_graph_status` -- person count, average trust score
5. `personality_profile` -- current mode, challenge level
6. `ollama_status` -- health, available models
7. `connector_status` -- detected connectors and categories
8. `privacy_stats` -- scrub counts for this session (by category)
9. `peer_list` -- connected P2P peers

If a tool call fails or returns empty data, skip that line gracefully. Do not error out.

Synthesize the results into a compact block like this:

```
Vault: unlocked (3h 12m). Memory: 47 entries (12 long, 23 med, 12 short).
Trust: 23 people (avg 0.71). Personality: partner, challenge 4/5. EIS: 72/100.
Ollama: healthy (llama3.2). Connectors: git, docker, node, python.
Privacy: 7 scrubbed (4 email, 2 key, 1 phone). P2P: 1 peer.
Commitments: 2 pending (1 overdue). Context: asimovs-mind (master, JS/Python).
```

### Formatting rules

- **Line 1 -- Vault + Memory**: Vault lock state with session uptime from `session_status`. Memory totals from `memory_status` tiers.
- **Line 2 -- Trust + Personality + EIS**: Person count and average trust from `trust_graph_status`. Mode and challenge level from `personality_profile`. If an epistemic independence score (EIS) is available in the personality data, include it.
- **Line 3 -- Ollama + Connectors**: Health status and model names from `ollama_status`. List detected connector names from `connector_status` (only the available ones).
- **Line 4 -- Privacy + P2P**: Scrub counts by category from `privacy_stats`. Peer count from `peer_list`.
- **Line 5 -- Commitments + Context**: Pending and overdue commitment counts from `session_status`. Working directory, branch, and detected languages from `session_status` cwd context.

Keep the output concise. No headers, no decoration. Just the status lines.
