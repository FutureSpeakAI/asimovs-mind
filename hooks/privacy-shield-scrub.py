#!/usr/bin/env python3
"""
PRIVACY SHIELD — PII Scrubbing (Outbound)

PreToolUse hook that scrubs PII from data leaving the local machine.
When WebFetch or WebSearch is called, the tool input is sent to the
Vault's Privacy Shield engine for scrubbing. Any detected PII
(emails, API keys, SSNs, credit cards, phone numbers, IP addresses,
filesystem paths containing the username) is replaced with
deterministic session-scoped placeholders before the request goes out.

The Vault stores the mapping so PostToolUse can rehydrate the response.

Hook event: PreToolUse (WebFetch, WebSearch)
"""

import json
import sys
import urllib.request
from pathlib import Path

PORT_FILE = Path(".asimovs-mind") / "vault" / "port"
SCRUB_TOOLS = {"WebFetch", "WebSearch"}


def get_vault_port():
    """Read the vault HTTP bridge port from the port file."""
    try:
        return int(PORT_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def scrub_text(port, text):
    """Call the vault's /scrub endpoint to replace PII with placeholders."""
    url = f"http://127.0.0.1:{port}/scrub"
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
            return data.get("scrubbed", text)
    except Exception:
        return None


def scrub_value(port, value):
    """Recursively scrub string values within a dict, list, or string."""
    if isinstance(value, str):
        result = scrub_text(port, value)
        return (result, result != value) if result is not None else (value, False)
    if isinstance(value, dict):
        changed = False
        out = {}
        for k, v in value.items():
            scrubbed, did_change = scrub_value(port, v)
            out[k] = scrubbed
            changed = changed or did_change
        return out, changed
    if isinstance(value, list):
        changed = False
        out = []
        for item in value:
            scrubbed, did_change = scrub_value(port, item)
            out.append(scrubbed)
            changed = changed or did_change
        return out, changed
    return value, False


def main():
    # Read hook input from stdin
    try:
        hook_input = json.loads(sys.stdin.read())
    except (json.JSONDecodeError, OSError):
        sys.exit(0)

    try:
        tool_name = hook_input.get("tool_name", "")

        # Only scrub outbound web tools
        if tool_name not in SCRUB_TOOLS:
            sys.exit(0)

        tool_input = hook_input.get("tool_input", {})
        if not tool_input:
            sys.exit(0)

        # Find the vault
        port = get_vault_port()
        if port is None:
            # Vault not running — pass through unchanged
            sys.exit(0)

        # Scrub all string values in tool_input
        scrubbed_input, changed = scrub_value(port, tool_input)

        if changed:
            # Output the modified tool_input so Claude Code uses the scrubbed version
            try:
                print(json.dumps(scrubbed_input))
            except (TypeError, ValueError):
                pass  # Serialization failed — pass through unchanged

    except Exception as exc:
        # Never block a tool call — log the error and allow
        print(f"privacy-shield-scrub: unexpected error ({exc})", file=sys.stderr)

    # Exit 0 = allow (with or without modification)
    sys.exit(0)


if __name__ == "__main__":
    main()
