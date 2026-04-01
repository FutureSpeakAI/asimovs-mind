#!/usr/bin/env python3
"""
TRUST TRACKER — Agent Performance & Autonomy Earning

PostToolUse hook that tracks agent deployment outcomes.
Over time, builds a performance profile for each agent.
When an agent demonstrates sustained reliability, it can
request expanded autonomy through the /friday trust command.

This is not the Trust Graph (that's for people/repos).
This is the symbiont protocol — agents earning the user's trust.
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Vault integration — try encrypted vault first, fall back to filesystem
try:
    from vault_bridge import vault_available, vault_read, vault_write
    _VAULT_OK = vault_available()
except ImportError:
    _VAULT_OK = False

TRUST_FILE = Path(".asimovs-mind") / "agent-trust.json"


def load_trust():
    """Load agent trust data (vault, then filesystem fallback)."""
    if _VAULT_OK:
        data = vault_read("agent-trust")
        if data is not None:
            return data

    # Filesystem fallback
    if not TRUST_FILE.exists():
        return {}
    try:
        return json.loads(TRUST_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


def save_trust(data):
    """Save agent trust data (vault, then filesystem fallback)."""
    if _VAULT_OK:
        if vault_write("agent-trust", data):
            return  # Vault write succeeded

    # Filesystem fallback
    TRUST_FILE.parent.mkdir(parents=True, exist_ok=True)
    TRUST_FILE.write_text(
        json.dumps(data, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def record_outcome(agent_name, outcome):
    """Record an agent deployment outcome."""
    trust = load_trust()

    if agent_name not in trust:
        trust[agent_name] = {
            "deployed": 0,
            "kept": 0,
            "reverted": 0,
            "crashed": 0,
            "first_seen": datetime.now().isoformat(),
            "last_seen": datetime.now().isoformat(),
            "autonomy_level": "supervised",
        }

    agent = trust[agent_name]
    agent["deployed"] += 1
    agent["last_seen"] = datetime.now().isoformat()

    if outcome == "kept":
        agent["kept"] += 1
    elif outcome == "reverted":
        agent["reverted"] += 1
    elif outcome == "crashed":
        agent["crashed"] += 1

    # Compute keep rate
    decided = agent["kept"] + agent["reverted"]
    if decided > 0:
        agent["keep_rate"] = round(agent["kept"] / decided, 3)
    else:
        agent["keep_rate"] = 0.0

    # Autonomy thresholds (earn trust through demonstrated reliability)
    # supervised -> suggested -> autonomous
    if agent["deployed"] >= 20 and agent.get("keep_rate", 0) >= 0.90 and agent["crashed"] == 0:
        if agent["autonomy_level"] == "supervised":
            agent["autonomy_level"] = "suggested"
            agent["autonomy_earned_at"] = datetime.now().isoformat()
    elif agent["deployed"] >= 50 and agent.get("keep_rate", 0) >= 0.95 and agent["crashed"] <= 1:
        if agent["autonomy_level"] == "suggested":
            agent["autonomy_level"] = "autonomous"
            agent["autonomy_earned_at"] = datetime.now().isoformat()

    save_trust(trust)


def main():
    """Hook entry point — track agent-related tool calls."""
    try:
        hook_input = json.loads(sys.stdin.read())
    except json.JSONDecodeError:
        sys.exit(0)

    tool_name = hook_input.get("tool_name", "")
    tool_input = hook_input.get("tool_input", {})

    # Track Agent tool deployments
    if tool_name == "Agent":
        agent_type = tool_input.get("subagent_type", "general-purpose")
        description = tool_input.get("description", "")
        # Record deployment (outcome tracked by session-learner on session end)
        trust = load_trust()
        if agent_type not in trust:
            trust[agent_type] = {
                "deployed": 0, "kept": 0, "reverted": 0, "crashed": 0,
                "first_seen": datetime.now().isoformat(),
                "last_seen": datetime.now().isoformat(),
                "autonomy_level": "supervised",
            }
        trust[agent_type]["deployed"] += 1
        trust[agent_type]["last_seen"] = datetime.now().isoformat()
        save_trust(trust)

    # Track git commits (kept) and resets (reverted)
    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        if "git commit" in command:
            # The last deployed agent gets credit for a "kept" outcome
            pass  # Full tracking requires correlating with the agent deployment
        elif "git reset --hard" in command or "git revert" in command:
            pass  # Similarly for reverts

    sys.exit(0)


if __name__ == "__main__":
    main()
