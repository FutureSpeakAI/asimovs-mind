# Asimov's Mind

### Every Claude Code instance becomes a node in a governed, self-improving software hivemind.

A Claude Code plugin that extends autonomous agents with GitHub-scale code discovery, coordinated multi-agent improvement, and immutable safety governance. Ships with 15 agents, scales to N -- the swarm grows as new specialists are created by the Meta-Improver or by you via `/create-agent`. Bounded by Asimov's cLaws, a governance framework that makes unsupervised autonomous operation safe enough to deploy on production code overnight.

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
claude plugins add github:FutureSpeakAI/asimovs-mind
```

## See it in action

```bash
/discover a retry mechanism with exponential backoff   # the hivemind moment
/unleash                                               # deploy the full swarm
/iterate fix-tests                                     # autoresearch loop on test failures
/iterate discover                                      # autonomous GitHub code discovery
/breed "code review specialist"                        # evolve a specialized local model
/evolve "You are a helpful assistant..."               # judge-scored prompt improvement
/diagnose                                              # codebase health check
/govern verify                                         # governance compliance audit
```

The `/discover` command is the one that changes things. Your agent searches the entire GitHub ecosystem for solutions, safety-scans candidates with AST analysis, scores them by trust, adapts them to your project's conventions, integrates the best match, runs tests, and records full provenance. One command. Fully autonomous. Fully governed.

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

Every agent runs this loop on its specialty. The Swarm Coordinator deploys agents in parallel waves. The Sentinel watches everyone for governance violations. What Karpathy built for one agent and one file, we run across 14 agents and the entire GitHub ecosystem.

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

## Capability Discovery: The Hivemind

Every Claude Code instance running this plugin can draw from the collective intelligence of open source. GitScout and GitLoader are the mechanism.

**GitScout** searches the GitHub API, scores candidates by relevance and trust, and returns ranked recommendations. **GitLoader** fetches the top candidate, runs AST safety analysis, adapts the code to your project's conventions, records provenance, integrates it, and runs verification.

**Trust tiers** ensure proportional caution:

| Tier | Trust | Quarantine | Who qualifies |
|------|:-----:|:----------:|---------------|
| Verified | 0.85+ | None | karpathy, pytorch-labs, huggingface, facebookresearch |
| Community | 0.65+ | 1 test cycle | Open license, multiple contributors, established repos |
| Experimental | 0.50+ | 2 test cycles | Single author, newer repos |
| Untrusted | <0.50 | Blocked | Not integrated |

**Safety scanning** is non-negotiable. The AST analyzer hard-blocks process spawning, network calls at import time, destructive file operations, blocked module imports, and framework monkey-patching. Code that fails Tier 1 analysis is rejected before it can be adapted.

**Provenance** is permanent. Every integration carries an attribution comment (source repo, commit SHA, license, trust scores) and is logged to an append-only ledger. The history cannot be rewritten.

## The Swarm

Ships with 15 agents, scales to N. The Swarm Coordinator dynamically discovers all agents (plugin + project-local) at the start of every cycle. The Meta-Improver creates new specialists when the swarm has capability gaps. You create them with `/create-agent`. Organized by function, deployed in coordinated waves:

**Discovery** -- GitScout (GitHub search + scoring), GitLoader (fetch + scan + adapt + integrate), Scout (web research + documentation)

**Improvement** -- Debugger (test repair), Optimizer (performance), Evolver (prompt engineering), Breeder (Ollama model evolution), Architect (structural analysis)

**Governance** -- Sentinel (cLaw enforcement + violation detection), Auditor (security scanning + dependency auditing)

**Infrastructure** -- Swarm Coordinator (wave orchestration), Documenter (docs sync), Librarian (cross-session memory), Meta-Improver (swarm self-improvement + agent creation, bounded by Meta-Law)

**Your agents** -- `/create-agent CSS layout specialist` writes a new agent to `.asimovs-mind/agents/` in your project. The Coordinator discovers it on the next cycle. The swarm grows to fit the work.

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
+-- plugin.json              # Claude Code plugin manifest (v0.2.0)
+-- governance/              # Asimov's cLaws (immutable)
|   +-- laws.json            # Three Laws + Meta-Law
|   +-- protected-zones.json # Untouchable file patterns
|   +-- safety-floors.json   # Minimums that cannot be lowered
|   +-- discovery-rules.json # cLaws extension for code import
+-- agents/                  # 15 agents (scales to N)
+-- skills/                  # 9 user-invokable /commands
+-- directives/              # 6 autoresearch-style loops
+-- discovery/               # GitScout + GitLoader tooling
|   +-- safety_scanner.py    # AST-based static analysis
|   +-- provenance.py        # Attribution + tracking CLI
+-- framework/               # Portable governance spec + adapters
```

## Credits

**[FutureSpeak.AI](https://github.com/FutureSpeakAI)** created Asimov's Mind, the cLaws governance framework, GitScout, GitLoader, and the capability discovery system.

**[Agent Friday](https://github.com/FutureSpeakAI/Agent-Friday)** by FutureSpeak.AI is the origin of the cLaw governance system, the self-improvement engines, and the GitLoader architecture that this plugin builds upon.

**[autoresearch](https://github.com/karpathy/autoresearch)** by Andrej Karpathy is the foundation -- the elegant modify-measure-keep/discard loop that started it all. We took the pattern, proved governance improves it, and extended it to ecosystem scale.

## License

MIT
