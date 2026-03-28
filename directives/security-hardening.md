# Security Hardening — OWASP Top 10 Remediation

## Objective
Eliminate security vulnerabilities identified by the Auditor agent.

## Editable Surface
- src/**/*.ts
- src/**/*.tsx

## Metric
Number of security findings — lower is better.

## Loop
1. Run the Auditor agent to scan for vulnerabilities
2. Pick the highest-severity finding
3. Apply the fix (input validation, output encoding, auth check, etc.)
4. Re-run the security scan to verify the finding is resolved
5. Run tests to ensure no regressions
6. If finding resolved and tests pass: commit. If not: revert.

## Constraints
- Never disable security features to "fix" a finding
- Never remove authentication or authorization checks
- Never expose error details to end users
- Never store secrets in source code

## Budget
5 minutes per cycle, 15 cycles

## Circuit Breaker
- Tests fail
- New vulnerabilities introduced
- Authentication/authorization weakened
