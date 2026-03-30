#!/usr/bin/env python3
"""
Stop hook: extracts session learnings and updates knowledge store.

Reads the session ledger (written by third-law.py during the session), extracts
key metrics (files modified, git operations, discoveries), creates a summary,
and persists it to both the rolling recent-sessions store and the append-only
full history. Clears the session ledger for the next session.

Hook event: Stop
"""

import json
import os
import sys
from datetime import datetime
from pathlib import Path

ASIMOVS_DIR = Path(".asimovs-mind")
LEDGER_FILE = ASIMOVS_DIR / "session-ledger.jsonl"
RECENT_SESSIONS_FILE = ASIMOVS_DIR / "knowledge" / "recent-sessions.json"
FULL_HISTORY_FILE = ASIMOVS_DIR / "session-history.jsonl"
MAX_RECENT_SESSIONS = 5


def read_ledger():
    """Read all entries from the session ledger."""
    entries = []
    if not LEDGER_FILE.exists():
        return entries

    try:
        with open(LEDGER_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        entries.append(json.loads(line))
                    except json.JSONDecodeError:
                        continue
    except OSError:
        pass

    return entries


def extract_metrics(entries):
    """Extract key metrics from ledger entries."""
    files_modified = set()
    git_commits = 0
    git_operations = []
    discoveries = 0

    for entry in entries:
        event = entry.get("event", "")

        if event == "file_modified":
            file_path = entry.get("file", "")
            if file_path:
                # Normalize to just the filename/relative path for readability
                files_modified.add(file_path)

        elif event == "git_operation":
            command = entry.get("command", "")
            git_operations.append(command)
            if "git commit" in command:
                git_commits += 1

        elif event == "discovery":
            discoveries += 1

    return files_modified, git_commits, git_operations, discoveries


def build_summary(files_modified, git_commits, discoveries):
    """Build a human-readable summary of the session."""
    parts = []

    if files_modified:
        # Pick representative files (up to 3 for the summary text)
        sample = sorted(files_modified)[:3]
        sample_str = ", ".join(os.path.basename(f) for f in sample)
        if len(files_modified) > 3:
            sample_str += f" (+{len(files_modified) - 3} more)"
        parts.append(f"Worked on {sample_str}")

    if git_commits:
        parts.append(f"{git_commits} commit{'s' if git_commits != 1 else ''}")

    if discoveries:
        parts.append(f"{discoveries} discovery{'ies' if discoveries != 1 else 'y'}")

    if not parts:
        return "Session with no recorded file changes."

    return ". ".join(parts) + "."


def create_session_record(files_modified, git_commits, discoveries):
    """Create the session summary object."""
    key_files = sorted(files_modified)[:10]  # Cap at 10 key files

    summary = build_summary(files_modified, git_commits, discoveries)

    return {
        "timestamp": datetime.now().isoformat(),
        "files_modified": len(files_modified),
        "git_commits": git_commits,
        "discoveries": discoveries,
        "key_files": key_files,
        "summary": summary,
    }


def update_recent_sessions(record):
    """Append to recent sessions, keeping only the last N."""
    sessions = []

    if RECENT_SESSIONS_FILE.exists():
        try:
            sessions = json.loads(RECENT_SESSIONS_FILE.read_text(encoding="utf-8"))
            if not isinstance(sessions, list):
                sessions = []
        except (json.JSONDecodeError, OSError):
            sessions = []

    sessions.append(record)

    # Keep only the last MAX_RECENT_SESSIONS
    sessions = sessions[-MAX_RECENT_SESSIONS:]

    # Ensure the knowledge directory exists
    RECENT_SESSIONS_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(RECENT_SESSIONS_FILE, "w", encoding="utf-8") as f:
        json.dump(sessions, f, indent=2, ensure_ascii=False)


def append_to_history(record):
    """Append to the full session history (append-only JSONL)."""
    FULL_HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(FULL_HISTORY_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


def clear_ledger():
    """Clear the session ledger for the next session."""
    if LEDGER_FILE.exists():
        try:
            LEDGER_FILE.unlink()
        except OSError:
            # If we can't delete, truncate instead
            try:
                with open(LEDGER_FILE, "w", encoding="utf-8") as f:
                    pass
            except OSError:
                pass


def main():
    try:
        entries = read_ledger()

        if not entries:
            # Nothing to record — empty session
            sys.exit(0)

        files_modified, git_commits, git_operations, discoveries = extract_metrics(entries)
        record = create_session_record(files_modified, git_commits, discoveries)

        # Persist the session record
        update_recent_sessions(record)
        append_to_history(record)

        # Clear the ledger for the next session
        clear_ledger()

    except Exception:
        # Never block session end — exit cleanly no matter what
        pass

    sys.exit(0)


if __name__ == "__main__":
    main()
