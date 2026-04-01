# Local Sovereignty -- API-Free Operation

*Zero cloud dependency. All intelligence on your machine.*

---

## What This Is

Claude Code can run against local models via Ollama instead of Anthropic's cloud API. When configured this way, there is no Anthropic API involvement at all. The entire Asimov's Mind plugin functions locally. The Privacy Shield becomes unnecessary because there is no cloud to scrub for. The sovereignty promise is fully realized: your data never leaves your machine.

---

## Requirements

### Required

| Component | Purpose | Install |
|-----------|---------|---------|
| **Ollama** | Local model runtime | `https://ollama.ai` or `brew install ollama` |
| **Chat model** | General inference (routing, agents, reasoning) | `ollama pull llama3.1:8b` or `ollama pull codellama:13b` |

### Optional

| Component | Purpose | Install |
|-----------|---------|---------|
| **Embedding model** | Semantic search in memory system | `ollama pull nomic-embed-text` |
| **Whisper** | Voice input via friday-voice | Requires separate Whisper installation |
| **Larger chat model** | Better reasoning on complex tasks | `ollama pull llama3.1:70b` or `ollama pull deepseek-coder:33b` |

Without the embedding model, the memory system falls back to keyword matching. Without Whisper, voice input is unavailable. Without a larger model, complex architecture analysis and multi-file refactoring may produce lower-quality results. The core system works fine with just Ollama and a single chat model.

---

## What Works Locally

| Feature | Local? | Notes |
|---------|--------|-------|
| Sovereign Vault | Yes | AES-256-GCM encryption is purely local. No cloud dependency. |
| P2P Channels | Yes | Encrypted machine-to-machine communication. |
| Federation | Yes | Git-based sync. No cloud APIs involved. |
| Trust Graph | Yes | All trust state is local, encrypted in vault. |
| Memory System | Yes | Knowledge graph, tribal knowledge, vectorless RAG all local. Semantic embeddings require local embedding model. |
| Governance Hooks | Yes | All cLaws enforced locally. HMAC integrity, protected zones, safety floors. |
| Attestation | Yes | Ed25519 signing and verification are local cryptographic operations. |
| Agent Swarm | Depends | All agents run, but output quality depends on local model capability. Specialist agents (architect, debugger) benefit from stronger models. |
| GitScout | Yes | GitHub API search still works (outbound HTTP), but no LLM cloud dependency. |
| Privacy Shield | Unnecessary | There is no cloud model to scrub for. PII never leaves the machine because inference is local. The shield hooks can remain active (they become no-ops when no cloud requests are made) but serve no purpose in local-only mode. |

---

## What Changes

**The primary LLM is local, not Claude.** This is the fundamental shift. Instead of sending prompts to Anthropic's API, Claude Code sends them to Ollama on localhost.

**Agent quality depends on local model capability.** A 7B parameter model handles straightforward tasks well: code formatting, simple refactoring, test fixes, documentation, memory operations, vault management. Complex multi-step reasoning, large-scale architecture analysis, and nuanced code review benefit from larger models (33B+) or cloud routing.

**No API keys required.** There is no Anthropic API key, no usage billing, no rate limits. The only constraint is local hardware (RAM, VRAM, disk).

**No Privacy Shield needed.** The Privacy Shield exists to scrub PII before data goes to cloud models. When there is no cloud model, there is nothing to scrub. The hooks can remain installed without harm (they simply have no cloud requests to intercept), but they are functionally unnecessary.

**Response latency depends on hardware.** Cloud models respond in seconds regardless of prompt size. Local models depend on your GPU/CPU. A 7B model on a modern GPU is fast. A 70B model on CPU-only hardware is slow. Choose the model that fits your hardware.

---

## Setup Path

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.ai/install.sh | sh

# Windows
# Download from https://ollama.ai
```

### 2. Start Ollama and pull a model

```bash
ollama serve                    # Start the runtime (runs on localhost:11434)
ollama pull llama3.1:8b         # Pull a general-purpose model
ollama pull nomic-embed-text    # (Optional) Pull an embedding model
```

### 3. Configure Claude Code to use the local model

Claude Code supports local models via the `--model` flag or environment variables:

```bash
# Via flag
claude --model ollama/llama3.1:8b

# Via environment variable
export CLAUDE_MODEL=ollama/llama3.1:8b
claude
```

### 4. Activate local-only routing

```
/route local-only
```

This verifies Ollama is running, confirms models are available, sets the routing policy to `local_only`, and reports what capabilities are available. From this point forward, no data leaves your machine.

---

## Governance in Local-Only Mode

All governance remains active. The cLaws do not depend on which LLM provides inference. The safety floors, protected zones, HMAC integrity checks, and Sentinel monitoring all function identically whether the model is cloud or local.

The `api_free_capable` safety floor (set to `true` in `governance/safety-floors.json`) guarantees that no plugin feature requires cloud API access. If a future feature were to introduce a hard cloud dependency, it would violate this floor and be rejected.

The `privacy_shield_on_cloud` floor remains true but becomes vacuously satisfied: there are no cloud requests, so the shield is trivially active (it has nothing to do). The `local_model_preferred` floor is trivially satisfied because local is the only option.

---

## When to Switch Back

Local-only mode is the fully sovereign configuration. But sovereignty is a choice, not a cage. If you need:

- **Long-context analysis** (200K+ tokens) that exceeds local model limits
- **Complex architecture reasoning** that benefits from a frontier model
- **Multi-file refactoring** where precision matters more than privacy

You can switch back at any time:

```
/route policy auto              # Let Friday decide per-request
/route policy local_preferred   # Prefer local, fall back to cloud when needed
```

The Privacy Shield reactivates automatically when cloud requests resume.
