---
name: govern
description: "View, verify, and manage Asimov's Mind governance rules. Shows the Three Laws, protected zones, safety floors, and compliance status."
user_invocable: true
---

# /govern — Governance Dashboard

Display and verify the Asimov's Mind governance framework.

## Usage

```
/govern              # Show full governance status
/govern laws         # Show the Three Laws
/govern zones        # Show protected zones
/govern floors       # Show safety floors
/govern verify       # Run full compliance check
/govern add-zone <pattern> # Add a project-specific protected zone
```

## Instructions

Read the governance files from `${CLAUDE_PLUGIN_ROOT}/governance/`:

1. **laws.json** — The Three Laws + Meta-Law with enforcement rules
2. **protected-zones.json** — Files and patterns no agent may modify
3. **safety-floors.json** — Minimum values for tunable parameters

For `/govern verify`, spawn the Sentinel agent to run a full compliance check.

For `/govern add-zone`, update the `custom_zones.patterns` array in `protected-zones.json`. NEVER modify the core `zones` array — only the `custom_zones` section is user-editable.

Display governance information in a clear, readable format. The laws are the foundation of trust — present them with appropriate gravity.
