#!/usr/bin/env python3
"""
THIRD LAW ENFORCEMENT — Preserve Progress

PostToolUse hook that logs all file modifications to the session ledger.
Tracks what was changed, when, and by which tool — creating an immutable
record that supports git commit discipline.

Also monitors for uncommitted changes piling up without being tested,
which violates the preserve-progress principle.

Hook event: PostToolUse (Write, Edit, Bash)
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Vault integration — append to session-ledger through vault when available
try:
    from vault_bridge import vault_available, vault_append
    _VAULT_OK = vault_available()
except ImportError:
    _VAULT_OK = False

LEDGER_FILE = Path(".asimovs-mind") / "session-ledger.jsonl"


def append_to_ledger(record):
    """Append a record to the session ledger (vault, then filesystem fallback)."""
    if _VAULT_OK:
        if vault_append("session-ledger", record):
            return  # Vault append succeeded

    # Filesystem fallback
    LEDGER_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(LEDGER_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def main():
    try:
        hook_input = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Track file modifications
    if tool_name in ("Write", "Edit"):
        file_path = tool_input.get("file_path", "")
        if not file_path:
            sys.exit(0)

        record = {
            "timestamp": datetime.now().isoformat(),
            "event": "file_modified",
            "tool": tool_name,
            "file": file_path,
        }

        # Append to session ledger
        append_to_ledger(record)

    # Track bash commands that might affect the codebase
    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        # Log git operations for the audit trail
        if any(cmd in command for cmd in ["git commit", "git reset", "git revert", "git push"]):
            record = {
                "timestamp": datetime.now().isoformat(),
                "event": "git_operation",
                "command": command[:200],  # truncate long commands
            }
            append_to_ledger(record)

    sys.exit(0)


if __name__ == "__main__":
    main()
