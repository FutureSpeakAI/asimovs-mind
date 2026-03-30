# Autonomous Capability Discovery

## Objective
Discover, evaluate, and integrate code from GitHub that improves the current project. Each cycle: identify a need, scout candidates, safety-scan, adapt, integrate, and test.

## Editable Surface
- All source files in the project (respecting governance protected zones)
- NOT: governance files, lock files, credentials, plugin files

## Metric
Integration success rate = kept / (kept + reverted). Target: > 50%.
Secondary: does the integration pass the project's test suite?

## Loop

1. **Identify a need**: Read the codebase and recent git history. What functionality is missing, underperforming, or could be improved with a known technique?
2. **Scout**: Spawn GitScout agent with a search query targeting the identified need.
3. **Select**: Pick the top candidate (trust tier 1 preferred, tier 2 acceptable, tier 3 only if no alternatives).
4. **Load**: Spawn GitLoader agent to fetch, scan, adapt, and integrate the candidate.
5. **Verify**: Run the project's test suite. Check type safety if applicable.
6. **Decide**: If tests pass and the integration is clean → keep (commit). If not → revert.
7. **Log**: Record outcome in provenance ledger.
8. **Learn**: If 2+ consecutive reverts for the same category (e.g., "optimizer"), skip that category for the rest of the session.

## Constraints

- Maximum 3 integrations per session
- Maximum 200 lines per integration
- No new package installations without explicit user approval
- No modifications to governance files
- Safety scanner must PASS (or SOFT_BLOCK with trust >= 0.7) before integration
- Post-adaptation rescan is mandatory
- Attribution comment required on all integrated code

## Budget

- 10 minutes per cycle (including search, scan, adapt, test)
- 10 cycles maximum per session
- Maximum 30 GitHub API calls per session

## Circuit Breaker

- 2 consecutive failed integrations (crashes or test failures) → halt discovery, return to manual mode
- Any governance violation detected by Sentinel → halt immediately
- 3 consecutive GitScout searches with 0 candidates above trust threshold → halt
- Project test suite broken before discovery starts → fix tests first, do not discover
