#!/usr/bin/env python3
"""
FIRST LAW ENFORCEMENT — Do No Harm

PreToolUse hook that blocks writes to protected zones.
This runs BEFORE any Write or Edit tool call. If the target file
matches a protected zone pattern, the write is blocked with an
explanation. No agent can bypass this — it's structural enforcement.

Hook event: PreToolUse (Write, Edit)
"""

import fnmatch
import json
import os
import sys
from pathlib import Path

PLUGIN_ROOT = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).parent.parent))
PROTECTED_ZONES_FILE = PLUGIN_ROOT / "governance" / "protected-zones.json"
PROJECT_ZONES_FILE = Path(".asimovs-mind") / "protected-zones.json"


def load_protected_patterns():
    """Load protected zone patterns from governance and project configs."""
    patterns = []

    # Plugin governance zones
    if PROTECTED_ZONES_FILE.exists():
        try:
            data = json.loads(PROTECTED_ZONES_FILE.read_text(encoding="utf-8"))
            for zone in data.get("zones", []):
                patterns.append((zone["pattern"], zone.get("reason", "protected zone"), zone.get("severity", "high")))
            for p in data.get("custom_zones", {}).get("patterns", []):
                if isinstance(p, str):
                    patterns.append((p, "custom protected zone", "high"))
                elif isinstance(p, dict):
                    patterns.append((p.get("pattern", ""), p.get("reason", "custom"), p.get("severity", "high")))
        except (json.JSONDecodeError, KeyError):
            pass

    # Project-local zones
    if PROJECT_ZONES_FILE.exists():
        try:
            data = json.loads(PROJECT_ZONES_FILE.read_text(encoding="utf-8"))
            for zone in data.get("zones", []):
                patterns.append((zone["pattern"], zone.get("reason", "project protected zone"), zone.get("severity", "high")))
        except (json.JSONDecodeError, KeyError):
            pass

    # Always protect governance and plugin internals
    patterns.append(("governance/**", "Governance is immutable (Meta-Law)", "critical"))
    patterns.append(("hooks/**", "Hooks enforce the Laws and cannot be modified by agents", "critical"))

    return patterns


def check_file_against_zones(file_path, patterns):
    """Check if a file path matches any protected zone pattern."""
    # Normalize the path
    normalized = file_path.replace("\\", "/")

    # Strip CWD prefix to get a relative path
    cwd = os.getcwd().replace("\\", "/").rstrip("/") + "/"
    if normalized.startswith(cwd):
        relative = normalized[len(cwd):]
    else:
        relative = normalized

    # Also strip the PLUGIN_ROOT prefix so absolute paths into the plugin
    # cannot bypass the protected-zone patterns (SEC-001 bypass vector).
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    if plugin_root:
        plugin_root_normalized = plugin_root.replace("\\", "/").rstrip("/") + "/"
        if relative == normalized and normalized.startswith(plugin_root_normalized):
            relative = normalized[len(plugin_root_normalized):]

    for pattern, reason, severity in patterns:
        # Check against both the full and relative path
        if fnmatch.fnmatch(relative, pattern) or fnmatch.fnmatch(normalized, pattern):
            return True, reason, severity
        # Handle ** patterns
        if "**" in pattern:
            base_pattern = pattern.replace("**/", "")
            if fnmatch.fnmatch(relative, base_pattern) or fnmatch.fnmatch(os.path.basename(relative), base_pattern):
                return True, reason, severity

    return False, "", ""


def main():
    # Read the hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        # Can't parse input — allow by default (don't break the session)
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Only check Write and Edit tools
    if tool_name not in ("Write", "Edit"):
        sys.exit(0)

    file_path = tool_input.get("file_path", "")
    if not file_path:
        sys.exit(0)

    patterns = load_protected_patterns()
    blocked, reason, severity = check_file_against_zones(file_path, patterns)

    if blocked:
        # Output the block reason — this message is shown to the agent
        result = {
            "decision": "block",
            "reason": f"FIRST LAW VIOLATION: Cannot modify protected file.\n"
                      f"File: {file_path}\n"
                      f"Zone: {reason}\n"
                      f"Severity: {severity}\n"
                      f"The First Law prohibits actions that could harm the codebase. "
                      f"Protected zones are immutable."
        }
        print(json.dumps(result))
        sys.exit(2)

    # Allow the write
    sys.exit(0)


if __name__ == "__main__":
    main()
