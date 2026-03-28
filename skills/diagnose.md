---
name: diagnose
description: "Run a comprehensive self-assessment of the current codebase. Reports test status, type health, performance issues, security concerns, and documentation gaps."
user_invocable: true
---

# /diagnose — Codebase Health Check

Run a comprehensive diagnostic across all dimensions of codebase health.

## Instructions

Run these checks in parallel and compile results:

1. **Tests**: `npm test 2>&1 | tail -5` — count passing/failing
2. **Types**: `npx tsc --noEmit 2>&1 | head -10` — count type errors
3. **Lint**: `npm run lint 2>&1 | tail -5` — count lint warnings/errors
4. **Dependencies**: `npm audit 2>&1 | tail -10` — count vulnerabilities
5. **Bundle**: `npm run build 2>&1 | tail -5` — check build status
6. **Git**: `git status` — check for uncommitted changes
7. **Docs**: Check if README.md and CHANGELOG.md exist and are recent

Compile into a health report:

```
═══ CODEBASE HEALTH REPORT ═══
Tests:        X/Y passing (Z failing)
Types:        clean / N errors
Lint:         clean / N warnings, M errors
Dependencies: N vulnerabilities (H high, M medium, L low)
Build:        passing / failing
Git:          clean / N uncommitted changes
Docs:         up to date / stale

Overall health: EXCELLENT / GOOD / NEEDS ATTENTION / CRITICAL

Recommended actions:
1. <highest priority fix>
2. <second priority>
3. <third priority>
```
