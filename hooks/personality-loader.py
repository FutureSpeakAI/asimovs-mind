#!/usr/bin/env python3
"""
SessionStart hook: loads personality, user profile, and recent session context.

Shapes the session by loading Agent Friday's personality definition, the user's
onboarding profile, recent session history, and federation status. Outputs a
natural-language context block that primes the agent for the session ahead.

Hook event: SessionStart
"""

import json
import os
import sys
from pathlib import Path

# Vault integration — try encrypted vault first, fall back to filesystem
try:
    from vault_bridge import vault_available, vault_read
    _VAULT_OK = vault_available()
except ImportError:
    _VAULT_OK = False

PLUGIN_ROOT = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).parent.parent))
ASIMOVS_DIR = Path(".asimovs-mind")


def load_personality():
    """Load the Agent Friday personality definition."""
    personality_file = PLUGIN_ROOT / "personality" / "friday.md"
    if personality_file.exists():
        return personality_file.read_text(encoding="utf-8")
    return None


def load_user_profile():
    """Load the user's onboarding profile (vault, then filesystem fallback)."""
    if _VAULT_OK:
        data = vault_read("user-profile")
        if data is not None:
            return data

    # Filesystem fallback
    profile_file = ASIMOVS_DIR / "user-profile.json"
    if profile_file.exists():
        try:
            return json.loads(profile_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def load_recent_sessions():
    """Load the last 5 session summaries (vault, then filesystem fallback)."""
    if _VAULT_OK:
        data = vault_read("recent-sessions")
        if data is not None:
            return data

    # Filesystem fallback
    sessions_file = ASIMOVS_DIR / "knowledge" / "recent-sessions.json"
    if sessions_file.exists():
        try:
            return json.loads(sessions_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def load_federation_config():
    """Load federation node config."""
    config_file = ASIMOVS_DIR / "config.json"
    if config_file.exists():
        try:
            return json.loads(config_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return None


def summarize_profile(profile):
    """Create a natural-language summary of the user profile."""
    name = profile.get("name", "Unknown")
    mode = profile.get("mode", "partner")
    prefs = profile.get("preferences", {})

    pref_parts = []
    if prefs.get("language"):
        pref_parts.append(f"language: {prefs['language']}")
    if prefs.get("style"):
        pref_parts.append(f"style: {prefs['style']}")
    if prefs.get("verbosity"):
        pref_parts.append(f"verbosity: {prefs['verbosity']}")
    if prefs.get("focus_areas"):
        areas = prefs["focus_areas"]
        if isinstance(areas, list):
            pref_parts.append(f"focus: {', '.join(areas)}")
        else:
            pref_parts.append(f"focus: {areas}")

    # Include any other top-level string preferences
    skip_keys = {"name", "mode", "preferences", "created", "updated"}
    for key, value in profile.items():
        if key not in skip_keys and isinstance(value, str) and value:
            pref_parts.append(f"{key}: {value}")

    pref_str = "; ".join(pref_parts) if pref_parts else "defaults"
    return name, mode, pref_str


def summarize_last_session(sessions):
    """Summarize the most recent session."""
    if not sessions or not isinstance(sessions, list) or len(sessions) == 0:
        return None

    last = sessions[-1]
    summary = last.get("summary", "")
    files_modified = last.get("files_modified", 0)
    git_commits = last.get("git_commits", 0)

    if summary:
        return summary
    elif files_modified or git_commits:
        return f"{files_modified} files modified, {git_commits} commits"
    return None


def count_agents(config):
    """Count discovered agents from federation config."""
    if not config:
        return 0
    return config.get("agent_count", 0)


def main():
    lines = []

    # Load personality — output it as context for the session
    personality = load_personality()
    if personality:
        lines.append(personality.strip())
        lines.append("")

    # Build the status line
    profile = load_user_profile()
    sessions = load_recent_sessions()
    config = load_federation_config()

    if profile:
        name, mode, prefs = summarize_profile(profile)
        lines.append(f"Agent Friday active. Mode: {mode}.")
        lines.append(f"User: {name}. Preferences: {prefs}.")
    else:
        lines.append("Welcome to Asimov's Mind — Agent Friday's kernel for Claude Code.")
        lines.append("")
        lines.append("First-time setup required:")
        lines.append("  1. Run /friday unlock to initialize the Sovereign Vault (encrypted storage)")
        lines.append("  2. Run /onboard to create your user profile")
        lines.append("  3. You're ready to work!")
        lines.append("")
        lines.append("The vault protects your data with AES-256-GCM encryption. Your passphrase is the only key.")

        # Check if the vault port file exists; if not, warn that the server may still be starting
        vault_port_file = ASIMOVS_DIR / "vault" / "port"
        if not vault_port_file.exists():
            lines.append("")
            lines.append("Note: The vault server is starting up. If /friday unlock doesn't work, wait a moment and try again.")

    # Last session context
    if sessions:
        last_summary = summarize_last_session(sessions)
        if last_summary:
            lines.append(f"Last session: {last_summary}.")

    # Federation status
    if config:
        agent_count = count_agents(config)
        integrity = config.get("governance_integrity", "unknown")
        lines.append(f"Federation: {agent_count} agents discovered, governance integrity {integrity}.")

    # Memory system context — what Friday remembers
    try:
        sys.path.insert(0, str(PLUGIN_ROOT / "discovery"))
        from memory import get_status, get_all_trust
        status = get_status()
        if status.get("total_evidence", 0) > 0:
            trust_data = get_all_trust(min_confidence=0.1)
            high_trust = [(e, t) for e, t in trust_data.items() if t.get("overall", 0) >= 0.8]
            low_trust = [(e, t) for e, t in trust_data.items() if t.get("overall", 0) < 0.5]

            memory_parts = [f"Memory: {status['total_evidence']} observations"]
            if high_trust:
                names = ", ".join(e for e, _ in high_trust[:3])
                memory_parts.append(f"trusted: {names}")
            if low_trust:
                names = ", ".join(e for e, _ in low_trust[:3])
                memory_parts.append(f"caution: {names}")
            if status.get("graph_nodes", 0) > 0:
                memory_parts.append(f"{status['graph_nodes']} entities tracked")

            lines.append(". ".join(memory_parts) + ".")
    except (ImportError, Exception):
        pass  # Memory system not available — skip gracefully

    # Privacy Shield — check if PII was scrubbed in the previous session
    try:
        if _VAULT_OK:
            privacy_data = vault_read("privacy-stats")
            if privacy_data and isinstance(privacy_data, dict):
                scrub_total = privacy_data.get("total", 0)
                if scrub_total > 0:
                    lines.append(f"Privacy Shield: {scrub_total} items scrubbed last session.")
    except Exception:
        pass  # Privacy stats not available — skip gracefully

    output = "\n".join(lines)
    if output.strip():
        print(output)

    sys.exit(0)


if __name__ == "__main__":
    main()
