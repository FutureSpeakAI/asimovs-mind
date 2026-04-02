#!/usr/bin/env python3
"""
PRIVACY SHIELD — PII Rehydration (Inbound)

PostToolUse hook that restores PII placeholders in data coming back
from external services. When WebFetch or WebSearch returns a response,
any Privacy Shield placeholders are resolved back to the original values
using the Vault's session-scoped mapping.

This ensures the user sees their real data in the response while it was
never exposed to the external service.

Hook event: PostToolUse (WebFetch, WebSearch)
"""

import json
import sys
import urllib.request
from pathlib import Path

PORT_FILE = Path(".asimovs-mind") / "vault" / "port"
REHYDRATE_TOOLS = {"WebFetch", "WebSearch"}


def get_vault_port():
    """Read the vault HTTP bridge port from the port file."""
    try:
        return int(PORT_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def rehydrate_text(port, text):
    """Call the vault's /rehydrate endpoint to restore PII from placeholders."""
    url = f"http://127.0.0.1:{port}/rehydrate"
    payload = json.dumps({"text": text}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("restored", text)
    except Exception:
        return None


def main():
    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, OSError):
        sys.exit(0)

    try:
        tool_name = hook_input.get("tool_name", "")

        # Only rehydrate responses from web tools
        if tool_name not in REHYDRATE_TOOLS:
            sys.exit(0)

        tool_output = hook_input.get("tool_output", "")
        if not tool_output:
            sys.exit(0)

        # Find the vault
        port = get_vault_port()
        if port is None:
            # Vault not running — pass through unchanged
            sys.exit(0)

        # Rehydrate the tool output
        restored = rehydrate_text(port, tool_output)

        if restored is not None and restored != tool_output:
            # Output the restored text so Claude Code sees the real data
            print(restored)

    except Exception as exc:
        # Never block a tool call — log the error and allow
        print(f"privacy-shield-rehydrate: unexpected error ({exc})", file=sys.stderr)

    # Exit 0 = allow (with or without modification)
    sys.exit(0)


if __name__ == "__main__":
    main()
