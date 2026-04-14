# Asimov's Mind -- MCP Tool Reference

Complete reference for all MCP tools exposed by friday-core (Node.js). 91 tools across 18 subsystems.

For the Python core systems MCP server (32 tools), see `mcp-servers/core-mcp/server.py`.
For the Gemini creative MCP server (8 tools), see `mcp-servers/gemini-mcp/README.md`.

---

## Vault (10 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `vault_status` | none | Check vault lock state, subsystem health, Ollama connectivity, and privacy shield status |
| `vault_initialize` | `passphrase` (string, min 8 words/24+ chars) | Initialize a new vault with a passphrase. Creates AES-256-GCM encrypted storage |
| `vault_unlock` | `passphrase` (string) | Unlock an existing vault. Derives keys and verifies canary |
| `vault_lock` | none | Lock the vault and destroy all keys in memory |
| `vault_read` | `key` (string) | Read and decrypt a named state entry from the vault |
| `vault_write` | `key` (string), `data` (any) | Encrypt and persist a named state entry in the vault |
| `vault_append` | `key` (string), `entry` (any) | Append an entry to an array stored in the vault |
| `vault_delete` | `key` (string) | Remove a named state entry from the vault |
| `vault_list` | none | List all encrypted state keys in the vault |
| `vault_export` | none | Export all vault state as decrypted JSON (for backup/migration) |

## Identity (6 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `identity_generate` | `name` (string) | Generate Ed25519 signing + X25519 exchange keypairs, stored encrypted in vault |
| `identity_status` | none | Check if a cryptographic identity exists and is loaded |
| `identity_sign` | `message` (string) | Sign a message with the Ed25519 private key |
| `identity_verify` | `message` (string), `signature` (string, base64), `publicKey` (string, base64) | Verify an Ed25519 signature |
| `attestation_generate` | `laws_text` (string) | Generate a cLaw attestation (laws hash + timestamp + Ed25519 signature) |
| `attestation_verify` | `attestation` (object: lawsHash, timestamp, signature, signerPublicKey), `laws_text` (string) | Verify a peer's cLaw attestation |

## Privacy (4 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `privacy_scrub` | `text` (string) | Scrub PII from text using the Privacy Shield. Returns scrubbed text and stats. Emits `privacy:scrubbed` event |
| `privacy_rehydrate` | `text` (string) | Restore PII in text using stored session mappings |
| `privacy_stats` | none | Get Privacy Shield statistics for this session (scrub counts by category) |
| `privacy_reset` | none | Reset Privacy Shield state and destroy all PII mappings |

## Ollama (1 tool)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `ollama_status` | none | Check Ollama health and list available local models |

## P2P (7 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `peer_listen` | none | Start listening for incoming P2P connections. Returns WebSocket port |
| `peer_connect` | `address` (string, ws://host:port), `peer_name` (string, optional) | Connect to a remote Asimov Agent with encrypted handshake and cLaw attestation |
| `peer_list` | none | List all connected peers and their channel status |
| `peer_send` | `peer_id` (string), `message` (string), `type` (enum: text/transaction/trust/attestation, default text) | Send an encrypted message to a connected peer |
| `peer_send_file` | `peer_id` (string), `file_path` (string), `file_name` (string, optional) | Send an encrypted file to a connected peer |
| `peer_disconnect` | `peer_id` (string) | Close the encrypted channel and destroy session keys |
| `peer_pairing_code` | none | Generate an 8-character pairing code (expires in 5 minutes) |

## LLM (6 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `llm_complete` | `messages` (array of {role, content}), `model` (string, opt), `provider` (string, opt), `systemPrompt` (string, opt), `maxTokens` (number, default 1024), `temperature` (number, opt) | Send a completion request to an LLM. Returns response text, model, usage, latency |
| `llm_stream` | `messages` (array of {role, content}), `model` (string, opt), `provider` (string, opt), `systemPrompt` (string, opt), `maxTokens` (number, default 4096), `temperature` (number, opt) | Stream a completion request. Returns accumulated text from the full stream |
| `llm_status` | none | Show all registered LLM providers, availability, default provider, and router stats |
| `llm_model_list` | `availableOnly` (boolean, default false) | List all models across all providers with capabilities, costs, and availability |
| `llm_route` | `task` (string) | Given a task description, return the recommended model and selection reasoning |
| `llm_set_provider` | `provider` (string: anthropic/ollama/openrouter) | Set the default LLM provider |

## Memory (8 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `memory_store` | `content` (string, max 50,000 chars), `category` (enum: preference/pattern/context/fact, default fact), `tier` (enum: short/medium/long, default short), `confidence` (number 0-1, default 0.5) | Store an observation in memory. Short-term is session-only, medium persists, long is consolidated. Content is capped at 50,000 characters |
| `memory_recall` | `query` (string, non-empty), `limit` (int 1-50, default 5) | Recall relevant memories using semantic search or keyword matching. Query must be non-empty |
| `memory_search` | `query` (string), `tier` (enum: short-term/medium-term/long-term/episode, optional), `limit` (int 1-50, default 10) | Full semantic search across all indexed memories with optional tier filtering |
| `memory_consolidate` | none | Trigger a consolidation pass. Promotes high-scoring medium-term to long-term |
| `memory_status` | none | Memory system statistics: counts per tier, embedding health, episode status, consolidation candidates |
| `memory_episode_start` | `title` (string) | Begin recording an episode (session). Tracks observations until ended |
| `memory_episode_end` | `summary` (string), `topics` (string[], default []), `emotionalTone` (string, default neutral), `keyDecisions` (string[], default []) | End the current episode and store it with summary and metadata |
| `memory_forget` | `id` (string) | Remove a specific memory by ID from any tier |

## Context (4 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `context_snapshot` | `depth` (number 1-5, default 2) | Get current context: recent events, active entities, graph neighborhoods |
| `context_inject` | `query` (string) | Build enriched context block for an LLM prompt based on relevant entities and recent activity |
| `context_add` | `type` (enum: node/edge), `data` (object: id, nodeType, name, metadata for nodes; from, to, relationship, weight for edges) | Add a node or edge to the knowledge graph |
| `context_query` | `pattern` (string), `type` (enum: file/function/person/concept/project, optional) | Query the knowledge graph by name pattern and optional type filter |

## Trust (7 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `trust_person_score` | `identifier` (string) | Get trust scores for a person with fuzzy name resolution. Returns multi-dimensional breakdown |
| `trust_evidence_add` | `identifier` (string), `type` (enum: promise_kept/promise_broken/accurate_info/inaccurate_info/helpful_action/unhelpful_action/emotional_support/user_stated/observed/inferred), `description` (string), `impact` (number -1 to 1), `domain` (string, optional) | Add trust evidence for a person. Drives trust score computation |
| `trust_evidence_list` | `identifier` (string), `limit` (int 1-50, default 10) | List trust evidence for a person, sorted by recency |
| `trust_reevaluate` | `identifier` (string) | Force hermeneutic re-evaluation of all trust dimensions from all evidence |
| `trust_graph_status` | none | Overview of the trust graph: total persons, top trusted, recent interactions, stats |
| `trust_person_resolve` | `identifier` (string), `type` (enum: name/email/handle/phone/nickname, optional) | Resolve an identifier to a person node without modifying trust |
| `trust_explain` | `identifier` (string) | Natural language explanation of trust: score, evidence breakdown, key factors, last seen |

## Personality (6 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `personality_profile` | `updates` (object, optional: name, userName, mode, traits, tone, backstory, identityLine, challengeLevel) | Get or update the agent personality profile. Modes: partner/focus/teacher/creative/sentinel |
| `personality_calibrate` | `action` (enum: view/reset_dimension/reset_all), `dimension` (enum: formality/verbosity/humor/technicalDepth/emotionalWarmth/proactivity, optional) | View or adjust 6 adaptive style dimensions with anti-sycophancy |
| `personality_mood` | none | Get current detected mood and energy level from recent user message analysis |
| `personality_evolve` | none | View personality evolution state and trait development over sessions |
| `personality_self_knowledge` | none | Introspection: identity, calibration, mood, evolution state |
| `personality_sentiment` | `text` (string) | Analyse text for sentiment/mood without updating internal state |

## Agents (7 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `agent_delegate` | `parentTaskId` (string), `agentType` (string), `description` (string), `input` (object, default {}), `trustTier` (enum: local/owner-dm/approved-dm/group/public, optional), `context` (string, optional) | Delegate a sub-task to a child agent with trust-tier inheritance and depth limits |
| `agent_spawn` | `agentType` (string), `description` (string), `input` (object, default {}), `trustTier` (enum, default local) | Spawn a top-level agent with delegation root and mesh registration |
| `agent_halt` | `taskId` (string) | Halt an agent and all descendants. Propagates halt through delegation tree |
| `agent_status` | `taskId` (string) | Get detailed status of an agent: delegation tree, mesh context, children |
| `agent_list_capabilities` | none | List agent types, active agents, delegation stats, mesh status, and active teams |
| `agent_team_create` | `name` (string), `goal` (string), `tasks` (array of {description, priority}, default []) | Create a new agent team with shared goal and task list |
| `agent_team_status` | `teamId` (string, optional) | Get status of a specific team or overview of all teams |

## Tools (4 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `tool_register` | `name` (string), `description` (string), `safety_level` (enum: read_only/write/destructive, default read_only), `category` (enum: code/project/communication/research/meeting/memory/trust/system/automation/task, default system), `params` (object, optional) | Register a new tool dynamically |
| `tool_execute` | `name` (string), `args` (object, optional), `skip_safety` (boolean, default false), `decision_id` (string, optional) | Execute a registered tool by name with safety checks |
| `tool_list` | `category` (string, optional), `safety_level` (string, optional), `source` (string, optional) | List all registered tools with metadata, optionally filtered |
| `tool_safety_check` | `name` (string), `include_audit` (boolean, default false) | Check safety level, category, and recent audit trail for a tool |

## Connectors (4 static tools + up to 65 dynamic connector tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `connector_detect` | `connector_id` (string, optional) | Scan for available software (git, docker, node, python, powershell, etc.) or re-detect a specific connector |
| `connector_list` | `available_only` (boolean, default true), `category` (string, optional: foundation/devops/system/intelligence/communication) | List detected connectors and their tools |
| `connector_execute` | `connector` (string), `tool` (string), `args` (object, default {}) | Execute a tool from a specific connector (git, powershell, perplexity, etc.) |
| `connector_status` | none | Health status of all connectors: availability, tool counts, categories |

## Gateway (5 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `gateway_authenticate` | `channel` (string), `sender_id` (string), `sender_name` (string, optional) | Resolve a sender's trust tier and capability policy. Fails closed to "public" |
| `gateway_session_create` | `channel` (string), `sender_id` (string), `message` (string), `role` (enum: user/assistant, default user) | Create or restore a gateway session for a sender with message history |
| `gateway_session_status` | `channel` (string, optional), `sender_id` (string, optional) | Get status of gateway sessions: active count, message counts, expiry |
| `gateway_audit` | `limit` (int 1-200, default 50), `direction` (enum: in/out, optional) | Query gateway audit log: timestamps, channels, senders, trust tiers |
| `gateway_policy` | `action` (enum: get/pair/revoke/list_paired/list_pending), `tier` (enum: owner/owner_dm/approved_dm/group/public, optional), `code` (string, optional), `identity_id` (string, optional), `pair_tier` (enum, optional) | Manage trust policies: get policy, pair/revoke identities, list paired/pending |

## Briefing (3 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `briefing_daily` | `action` (enum: generate/latest/history/status), `type` (enum: morning/midday/evening, optional), `limit` (int 1-50, default 5, optional), `source_data` (object, optional: calendarEvents, activeCommitments, overdueCommitments, upcomingDeadlines, unrepliedMessages, followUpSuggestions, recentActivity, sessionSummary) | Generate, retrieve, or list daily briefings |
| `briefing_meeting_prep` | `action` (enum: create/start/end/cancel/prep/add_note/list), `meeting_id` (string, optional), `name` (string, optional), `description` (string, optional), `attendees` (string[], optional), `scheduled_start` (string, optional), `scheduled_end` (string, optional), `meeting_url` (string, optional), `note_content` (string, optional), `note_type` (enum: note/action-item/decision/question/insight, optional), `status_filter` (enum: upcoming/active/completed/cancelled, optional), `limit` (int 1-100, default 20, optional) | Manage meeting lifecycle: create, start, end, cancel, prep, add notes, list |
| `briefing_meeting_intel` | `meeting_id` (string), `include_transcript` (boolean, default true, optional) | Analyze meeting content for intelligence: action items, commitments, sentiment |

## Voice (3 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `voice_state` | `action` (enum: get/transition/reset), `target_state` (enum: IDLE/CONNECTING/ACTIVE/PAUSED/ERROR/RECOVERING, optional), `reason` (string, optional) | Query or transition the voice pipeline state machine |
| `voice_health` | `action` (enum: report/status), `check_name` (string, optional), `healthy` (boolean, optional) | Report or query voice pipeline health checks with escalation levels |
| `voice_fallback_status` | `action` (enum: status/set_availability/set_priority/record_failure/start_path), `path` (enum: cloud/local/personaplex/text, optional), `available` (boolean, optional), `reason` (string, optional), `priority` (int 0-99, optional) | Manage voice fallback paths: availability, priority, failure recording |

## Enterprise (5 tools)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `enterprise_consent_check` | `category` (enum: cloud_api/data_sharing/destructive_actions/send_messages/calendar_events/financial_actions/code_execution/browser_automation) | Check if user has consented to a specific action category |
| `enterprise_consent_grant` | `action` (enum: grant/revoke/revoke_all/status/audit), `category` (enum, optional), `scope` (enum: once/session/always, default session, optional), `reason` (string, optional), `limit` (int 1-200, default 50, optional) | Grant/revoke consent, view status, or query audit log |
| `enterprise_cloud_gate` | `action` (enum: check/set_policy/clear_policy/status), `task_category` (enum: code/chat/analysis/creative/tool-use/general, optional), `decision` (enum: allow/deny, optional), `scope` (enum: once/session/always, default session, optional) | Gate cloud API access by task category with policy management |
| `enterprise_confidence` | `content` (string, optional), `tool_calls` (array of {name, input}, optional), `stop_reason` (string, optional), `tool_definitions` (array of {name}, optional), `threshold` (number 0-1, default 0.5, optional) | Assess confidence in an LLM response using structural signals |
| `enterprise_commitment_track` | `action` (enum: add/complete/cancel/snooze/list/status/follow_ups/track_outbound/record_reply/context), `commitment_id` (string, optional), `description` (string, optional), `person_name` (string, optional), `direction` (enum: user_promised/other_promised/mutual, optional), `source` (enum: conversation/email/message/meeting/calendar/manual, optional), `deadline` (number, optional), `confidence` (number 0-1, default 0.8, optional), `notes` (string, optional), `snooze_until` (number, optional), `recipient` (string, optional), `channel` (string, optional), `summary` (string, optional) | Track commitments, deadlines, and follow-ups. Manages full commitment lifecycle |

## Session (1 tool)

| Tool | Parameters | Description |
|------|-----------|-------------|
| `session_status` | none | Get current session status: uptime, working directory context, greeting, pending commitments |

---

## Tool Count Summary

| Subsystem | Tools |
|-----------|-------|
| Vault | 10 |
| Identity | 6 |
| Privacy | 4 |
| Ollama | 1 |
| P2P | 7 |
| LLM | 6 |
| Memory | 8 |
| Context | 4 |
| Trust | 7 |
| Personality | 6 |
| Agents | 7 |
| Tools | 4 |
| Connectors | 4 (+65 dynamic) |
| Gateway | 5 |
| Briefing | 3 |
| Voice | 3 |
| Enterprise | 5 |
| Session | 1 |
| **Total** | **91** |

## HTTP Bridge Endpoints

The HTTP bridge (localhost-only) exposes these direct endpoints in addition to the generic `/tool/:name` route:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Vault status and metadata |
| `/read?key=` | GET | Read a vault key |
| `/write` | POST | Write a vault key |
| `/append` | POST | Append to a vault array |
| `/list` | GET | List vault keys |
| `/scrub` | POST | Scrub PII from text |
| `/rehydrate` | POST | Restore PII in text |
| `/unlock` | GET | Serve passphrase HTML form |
| `/unlock` | POST | Unlock vault with passphrase |
| `/initialize` | POST | Initialize new vault |
| `/tool/:name` | POST | Call any MCP tool with `{ args: {} }` |
| `/tool/:name` | GET | Call any MCP tool with empty args (convenience) |
| `/` | GET | Serve the Agent Friday dashboard |
