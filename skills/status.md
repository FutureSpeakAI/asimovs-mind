---
name: swarm-status
description: "Show the current status of the Asimov's Mind swarm — active agents, recent improvements, ledger summary, and governance compliance."
user_invocable: true
---

# /swarm-status — Swarm Dashboard

Display the current state of the Asimov's Mind swarm.

## Instructions

Gather and display:

1. **Active agents**: Are any swarm agents currently running?
2. **Recent improvements**: Read the results ledger for recent entries
3. **Codebase health**: Quick test + type check status
4. **Governance**: Quick compliance check (protected zones intact, safety floors respected)

Format as a dashboard:

```
═══ ASIMOV'S MIND — SWARM STATUS ═══

Active Agents: N running, M queued
  - debugger: fixing test X (cycle 3/10)
  - optimizer: measuring startup time

Recent Improvements (last 5):
  [kept]      fix: desktop-tools confirmation gate  (+39 tests)
  [kept]      perf: parallelize startup             (-2.4s)
  [discarded] tune: memory threshold adjustment     (no improvement)

Health:
  Tests: 5064/5064 passing
  Types: clean
  Governance: COMPLIANT

Ledger: N total cycles, M improvements, K discards
```
