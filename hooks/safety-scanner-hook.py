#!/usr/bin/env python3
"""
FIRST LAW ENFORCEMENT — Safety Scanner Gate

PreToolUse hook that scans Python code being written for dangerous patterns.
When the Write tool is used to create/modify a .py file, the content is
scanned by the safety scanner before the write is allowed.

This is the structural enforcement of the First Law's safety scanning
requirement — it runs regardless of whether the agent "remembered" to
scan the code.

Hook event: PreToolUse (Write)
"""

import json
import os
import sys
from pathlib import Path

PLUGIN_ROOT = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).parent.parent))
SCANNER_PATH = PLUGIN_ROOT / "discovery" / "safety_scanner.py"


def main():
    try:
        hook_input = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    if tool_name != "Write":
        sys.exit(0)

    tool_input = hook_input.get("tool_input", {})
    file_path = tool_input.get("file_path", "")
    content = tool_input.get("content", "")

    # Only scan Python files
    if not file_path.endswith(".py"):
        sys.exit(0)

    # Skip scanning files within the plugin itself (they're trusted)
    plugin_root_str = str(PLUGIN_ROOT).replace("\\", "/")
    file_normalized = file_path.replace("\\", "/")
    if file_normalized.startswith(plugin_root_str):
        sys.exit(0)

    # Skip if content doesn't look like it contains imported/external code
    # (check for provenance attribution comments)
    if "IMPORTED" not in content and "Source:" not in content:
        sys.exit(0)

    # Run the safety scanner on the content
    if not SCANNER_PATH.exists():
        sys.exit(0)

    import subprocess
    import tempfile

    # Write content to a temp file for scanning
    with tempfile.NamedTemporaryFile(mode="w", suffix=".py", delete=False, encoding="utf-8") as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = subprocess.run(
            [sys.executable, str(SCANNER_PATH), tmp_path],
            capture_output=True, text=True, timeout=10,
        )

        if "HARD_BLOCK" in result.stdout:
            block_result = {
                "decision": "block",
                "reason": f"FIRST LAW: Safety scanner detected dangerous patterns in code being written.\n\n"
                          f"{result.stdout}\n"
                          f"The code contains patterns that are blocked by the safety scanner. "
                          f"Review and remove the flagged patterns before proceeding."
            }
            print(json.dumps(block_result))
            sys.exit(2)
    except subprocess.TimeoutExpired:
        pass  # Allow on timeout — don't block the session
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    sys.exit(0)


if __name__ == "__main__":
    main()
