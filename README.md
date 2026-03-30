# Asimov's Mind

### Every Claude Code instance becomes a node in a governed, self-improving software hivemind.

A Claude Code plugin that extends autonomous agents with GitHub-scale code discovery, coordinated multi-agent improvement, unified memory, and immutable safety governance. The agent swarm scales to N -- 13 skills, 6 directives, 7 governance hooks, unified memory system. Bounded by Asimov's cLaws, a governance framework that makes unsupervised autonomous operation safe enough to deploy on production code overnight.

Built by [FutureSpeak.AI](https://github.com/FutureSpeakAI). Standing on the shoulders of [Karpathy's autoresearch](https://github.com/karpathy/autoresearch).

---

## We tested this. Here is what happened.

Karpathy's autoresearch introduced a powerful pattern: an LLM agent modifies code, trains for 5 minutes, measures the result, keeps improvements, reverts regressions, and loops. Elegant. But a single ungoverned agent hits limits fast -- it crashes, it degrades, it explores the same dimensions repeatedly.

We took that pattern, added governance, and deployed it across a coordinated swarm. Then we ran controlled experiments comparing ungoverned vs. governed agents on identical hardware and tasks:

| | Ungoverned | Governed Single | Governed Swarm |
|---|:-:|:-:|:-:|
| **Crash rate** | 56% | 22% | 25% |
| **Degradation per step** | 0.035 | 0.018 | 0.011 |
| **Explored architecture** | No | No | Yes |

Governance cut crashes in half. The governed swarm degraded 3x slower during sustained exploration. And the swarm's specialist architect agent was the only one to discover an architectural improvement that generalist agents never even tried.

The data is real. The experiments are reproducible. Paper and code: [asimovs-mind-research](https://github.com/FutureSpeakAI/asimovs-mind-research)

## Install

```bash
# Add the marketplace
claude plugin marketplace add FutureSpeakAI/asimovs-mind

# Install the plugin
claude plugin install asimovs-mind

# Restart Claude Code to activate
```

## See it in action

```bash
/discover a retry mechanism with exponential backoff   # the hivemind moment
/unleash                                               # deploy the full swarm
/iterate fix-tests                                     # autoresearch loop
/onboard                                               # meet Agent Friday
/friday mode creative                                  # switch modes
/remember the auth uses JWT in httpOnly cookies         # teach Friday
/federate init                                         # join the hivemind
/create-agent CSS layout specialist                    # grow the swarm
/breed "code review specialist"                        # spawn a local model
/evolve "You are a helpful assistant..."               # evolve a prompt
/diagnose                                              # codebase health check
/govern verify                                         # governance audit
```

## How it works

We took autoresearch's core loop and extended it in three directions: governance, specialization, and ecosystem-scale discovery.

```
Measure baseline
    |
+-> Plan modification (agent reasoning)
|   |
|   Perform modification
|   |
|   Measure again
|   |
|   Improved? -> git commit -> continue
|   Regressed? -> git revert -> try different approach
|   |
|   Budget or circuit breaker? -> halt
|   |
+-- Loop
```

Every agent runs this loop on its specialty. The Swarm Coordinator deploys agents in parallel waves. The Sentinel watches everyone for governance violations. What Karpathy built for one agent and one file, we run across N agents and the entire GitHub ecosystem.

## Asimov's cLaws

Governance is not a constraint on autonomy. It is what enables autonomy at scale.

The reason autonomous recursive self-improvement has not been deployed widely is trust. Ungoverned agents break things -- our experiments proved it quantitatively. Asimov's cLaws solve this structurally: not guardrails bolted on after the fact, but governance woven into every agent, every action, every integration.

**First Law -- Do No Harm**
> An agent shall not, through action or inaction, cause harm to the codebase, its users, or its data.

Type-check gates. Test gates. Protected zones for credentials and governance files. Circuit breakers that halt after consecutive failures. AST-based safety scanning that blocks dangerous code patterns before they touch your project.

**Second Law -- Obey Protocol**
> An agent shall follow its directive, except where doing so would conflict with the First Law.

Editable surfaces confine each agent to its zone. Budget caps prevent runaway loops. The discovery pipeline must be followed in sequence -- scout, scan, adapt, rescan, attribute, integrate, test. No shortcuts.

**Third Law -- Preserve Progress**
> An agent shall preserve improvements through version control discipline, except where doing so would conflict with the First or Second Law.

Git commit on improvement, git revert on regression. Structured ledger logging. Provenance tracking on all imported code. Append-only logs that cannot be rewritten.

**Meta-Law -- Governance Immutability**
> No agent, directive, or improvement loop may modify the governance framework itself.

The Laws are absolute. The Sentinel enforces them. Safety floors can be raised but never lowered. This is the property that makes overnight unsupervised operation possible.

### Why governance?

Our research quantified what happens without it. Ungoverned agents crashed on 56% of experiments. They started with destructive changes and compounded the damage. Governed agents crashed 22% of the time, took less destructive paths, and recovered faster. The governed swarm degraded at one-third the rate of the ungoverned agent.

Governance is not a tradeoff against performance. It is a precondition for it.

## The Memory

Trust graph. Knowledge graph. Vectorless RAG. One system, three views.

Every session feeds the memory. Every discovery updates trust scores. Every file modification strengthens the knowledge graph. Friday doesn't just act -- it remembers.

**Trust Graph** -- Multi-dimensional scoring of repos and agents, backed by evidence with time decay. When GitScout searches GitHub, it checks memory first. When an imported component breaks tests two weeks later, the trust score drops. Hermeneutic re-evaluation: every score is recomputed from all evidence, not incrementally updated. Drift is impossible.

**Knowledge Graph** -- Entity co-occurrence built from session patterns. Files that change together are related. After 15 sessions, Friday knows which files cluster and checks them first when you report a bug.

**Vectorless RAG** -- Context retrieval without embeddings or vector databases. Relevance is computed from entity matching, co-occurrence, evidence recency, and trust scores. When Ollama is available locally, semantic embeddings layer on top -- but the base system works everywhere with zero dependencies.

**Tribal Knowledge** -- `/remember the payments API rate limits at 100 req/min`. Memories persist in `.asimovs-mind/knowledge/memories.json`, propagate through git, and surface automatically when Friday works on something related. One engineer teaches Friday, the whole team benefits.

## Capability Discovery: The Hivemind

Every Claude Code instance running this plugin can draw from the collective intelligence of open source. GitScout and GitLoader are the mechanism.

**GitScout** searches the GitHub API, checks the memory system first (avoids re-searching, surfaces previous trust data), scores candidates by relevance and trust, and returns ranked recommendations. **GitLoader** fetches the top candidate, runs AST safety analysis, adapts the code to your project's conventions, records provenance, integrates it, and runs verification.

**Trust tiers** ensure proportional caution:

| Tier | Trust | Quarantine | Who qualifies |
|------|:-----:|:----------:|---------------|
| Verified | 0.85+ | None | karpathy, pytorch-labs, huggingface, facebookresearch |
| Community | 0.65+ | 1 test cycle | Open license, multiple contributors, established repos |
| Experimental | 0.50+ | 2 test cycles | Single author, newer repos |
| Untrusted | <0.50 | Blocked | Not integrated |

**Safety scanning** is non-negotiable. The AST analyzer hard-blocks process spawning, network calls at import time, destructive file operations, blocked module imports, and framework monkey-patching. Code that fails Tier 1 analysis is rejected before it can be adapted.

**Provenance** is permanent. Every integration carries an attribution comment (source repo, commit SHA, license, trust scores) and is logged to an append-only ledger. The history cannot be rewritten.

## Agent Friday Lives Here

This is not a generic coding assistant. When you run `/onboard`, you meet Friday -- a personality with opinions, taste, and the ability to earn your trust over time.

Five modes: focus (silent executor), partner (thinks aloud, the default), teacher (explains everything), creative (makes media, takes risks), sentinel (paranoid security). The mode is visible. You control it. The governance does not change.

The Workflow Observer watches your patterns and suggests automation -- but never assumes permission. The Creative agent generates contextual media when the moment calls for it. The unified memory powers all of it -- every session, Friday opens knowing what you worked on last, which repos have been reliable, and which agents perform best.

## The Swarm

The agent swarm scales to N -- The Swarm Coordinator dynamically discovers all agents (plugin + project-local) at the start of every cycle. The Meta-Improver creates new specialists when the swarm has capability gaps. You create them with `/create-agent`. Organized by function, deployed in coordinated waves:

**Discovery** -- GitScout (GitHub search + scoring), GitLoader (fetch + scan + adapt + integrate), Scout (web research + documentation)

**Improvement** -- Debugger (test repair), Optimizer (performance), Evolver (prompt engineering), Breeder (Ollama model evolution), Architect (structural analysis), Creative (contextual media generation)

**Governance** -- Sentinel (cLaw enforcement + violation detection), Auditor (security scanning + dependency auditing)

**Learning** -- Librarian (cross-session memory, CLAUDE.md management), Workflow Observer (pattern recognition, automation proposals)

**Infrastructure** -- Swarm Coordinator (wave orchestration), Documenter (docs sync), Meta-Improver (swarm self-improvement + agent creation, bounded by Meta-Law)

**Your agents** -- `/create-agent CSS layout specialist` writes a new agent to `.asimovs-mind/agents/` in your project. The Coordinator discovers it on the next cycle. The swarm grows to fit the work.

## The Federation

Every developer running this plugin on a shared repo is a node. One node discovers a retry handler via `/discover`, safety-scans it, integrates it, commits with provenance. Every other node pulls those improvements and inherits the trust scores. Agent definitions created via `/create-agent` propagate the same way. Tribal knowledge from `/remember` propagates the same way. The swarm grows across machines.

The governance travels with the code. The HMAC-signed manifest detects tampering. The cLaws are the same on every node. The memory system travels with the federation -- trust scores, knowledge graph, and tribal knowledge all propagate through git.

## Portable Governance

Asimov's cLaws is a specification, not a product. Implement it in any agent framework:

- `framework/adapters/langchain.py`
- `framework/adapters/crewai.py`
- `framework/adapters/autogen.py`

The full spec is in `framework/spec.json`. The governance pattern -- Laws, protected zones, safety floors, Sentinel monitoring -- works anywhere agents need to be trusted.

## Directives

Autoresearch-style improvement loops, each defining an objective, metric, editable surface, budget, and circuit breaker:

| Directive | Target |
|-----------|--------|
| `fix-tests` | Test pass rate |
| `fix-types` | TypeScript strict compliance |
| `optimize-startup` | Initialization time |
| `security-hardening` | OWASP vulnerability count |
| `discover` | Autonomous GitHub code discovery |
| `full-sweep` | Everything (the overnight run) |

## Project Structure

```
asimovs-mind/
+-- plugin.json              # Claude Code plugin manifest (v1.0.0-beta)
+-- .claude-plugin/           # Marketplace wrapper for installation
+-- governance/              # Asimov's cLaws (immutable)
|   +-- laws.json            # Three Laws + Meta-Law
|   +-- protected-zones.json # Untouchable file patterns
|   +-- safety-floors.json   # Minimums that cannot be lowered
|   +-- discovery-rules.json # cLaws extension for code import
+-- personality/             # Agent Friday identity
|   +-- friday.md            # Personality, modes, relationship model
+-- agents/                  # N agents (dynamic discovery + creation)
+-- skills/                  # 13 user-invokable /commands
+-- directives/              # 6 autoresearch-style loops
+-- hooks/                   # 7 governance enforcement hooks
|   +-- first-law.py         # PreToolUse: protected zone enforcement
|   +-- third-law.py         # PostToolUse: session ledger
|   +-- safety-scanner-hook.py # PreToolUse: AST scan on code write
|   +-- personality-loader.py  # SessionStart: loads personality + memory
|   +-- session-learner.py     # Stop: extracts learnings, feeds memory
|   +-- integrity-check.py    # SessionStart: HMAC governance verification
|   +-- trust-tracker.py      # PostToolUse: agent performance tracking
+-- discovery/               # Discovery + memory system
|   +-- safety_scanner.py    # AST-based static analysis
|   +-- provenance.py        # Attribution + tracking CLI
|   +-- memory.py            # Unified trust graph + knowledge graph + RAG
+-- framework/               # Portable governance spec + adapters
```

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** created Asimov's Mind, the cLaws governance framework, the unified memory system, GitScout, GitLoader, and the capability discovery system.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI is the origin of the cLaw governance system, the trust graph, the self-improvement engines, and the GitLoader architecture that this plugin builds upon.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy is the foundation -- the elegant modify-measure-keep/discard loop that started it all. We took the pattern, proved governance improves it, and extended it to ecosystem scale.

## License

MIT
