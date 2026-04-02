#!/usr/bin/env python3
"""
provenance.py — Append-only attribution tracking for code discoveries.

CLI usage:
  python provenance.py log --record-id ID --repo REPO --component NAME --license SPDX \
                           --scout-trust 0.9 --scanner-trust 0.95
  python provenance.py outcome --record-id ID --result kept|reverted --reason "why"
  python provenance.py history
  python provenance.py check-license SPDX_ID
"""

import argparse
import json
import os
import sys
from datetime import datetime
from pathlib import Path

# Provenance log lives in the PROJECT, not the plugin
# This ensures each project has its own discovery history
LOG_FILENAME = ".asimovs-mind-provenance.jsonl"

ALLOWED_LICENSES = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause",
    "ISC", "CC-BY-4.0", "Unlicense", "0BSD",
}
COPYLEFT_LICENSES = {
    "GPL-2.0-only", "GPL-3.0-only", "GPL-2.0-or-later", "GPL-3.0-or-later",
    "LGPL-2.1-only", "LGPL-3.0-only", "AGPL-3.0-only",
}


def get_log_path():
    """Find the provenance log in the current project."""
    cwd = Path.cwd()
    # Walk up to find a git root
    d = cwd
    while d != d.parent:
        if (d / ".git").exists():
            return d / LOG_FILENAME
        d = d.parent
    # Fallback to cwd
    return cwd / LOG_FILENAME


def append_record(record: dict):
    """Append a record to the provenance log."""
    log_path = get_log_path()
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except OSError as exc:
        print(f"ERROR: Could not write provenance log {log_path}: {exc}", file=sys.stderr)
        sys.exit(1)
    return log_path


def cmd_log(args):
    """Log a candidate/integration record."""
    record = {
        "record_id": args.record_id,
        "timestamp": datetime.now().isoformat(),
        "stage": "candidate",
        "repo": args.repo,
        "component": args.component,
        "license": args.license,
        "scout_trust": args.scout_trust,
        "scanner_trust": args.scanner_trust,
    }
    path = append_record(record)
    print(f"Logged candidate {args.record_id} -> {path}")


def cmd_outcome(args):
    """Log an experiment outcome."""
    record = {
        "record_id": args.record_id,
        "timestamp": datetime.now().isoformat(),
        "stage": "outcome",
        "result": args.result,
        "reason": args.reason,
    }
    path = append_record(record)
    print(f"Logged outcome {args.record_id}: {args.result} -> {path}")


def cmd_history(args):
    """Display the provenance log."""
    log_path = get_log_path()
    if not log_path.exists():
        print("No provenance history found.")
        return

    records = []
    try:
        raw = log_path.read_text(encoding="utf-8")
    except OSError as exc:
        print(f"ERROR: Could not read provenance log {log_path}: {exc}", file=sys.stderr)
        return

    for line in raw.strip().split("\n"):
        if line.strip():
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue

    if not records:
        print("Provenance log is empty.")
        return

    # Group by record_id
    groups = {}
    for r in records:
        rid = r.get("record_id", "unknown")
        if rid not in groups:
            groups[rid] = []
        groups[rid].append(r)

    print(f"Discovery History ({len(groups)} records)")
    print("=" * 60)
    for rid, entries in groups.items():
        candidate = next((e for e in entries if e.get("stage") == "candidate"), {})
        outcome = next((e for e in entries if e.get("stage") == "outcome"), None)

        repo = candidate.get("repo", "unknown")
        component = candidate.get("component", "unknown")
        license_id = candidate.get("license", "unknown")
        result = outcome.get("result", "pending") if outcome else "pending"
        reason = outcome.get("reason", "") if outcome else ""

        status_icon = {"kept": "[KEPT]", "reverted": "[REVERTED]", "pending": "[PENDING]"}.get(result, f"[{result}]")

        print(f"\n{status_icon} {rid}")
        print(f"  Repo: {repo}")
        print(f"  Component: {component}")
        print(f"  License: {license_id}")
        print(f"  Trust: scout={candidate.get('scout_trust', '?')} scanner={candidate.get('scanner_trust', '?')}")
        if reason:
            print(f"  Reason: {reason}")


def cmd_check_license(args):
    """Check if a license SPDX is compatible."""
    spdx = args.spdx_id.strip()

    if spdx in ALLOWED_LICENSES:
        print(f"COMPATIBLE: {spdx} is fully compatible")
        sys.exit(0)
    elif spdx in COPYLEFT_LICENSES:
        print(f"COPYLEFT: {spdx} is copyleft — may impose restrictions")
        sys.exit(1)
    elif not spdx or spdx.lower() in ("none", "null", "no-license"):
        print(f"BLOCKED: No license — cannot legally use this code")
        sys.exit(2)
    else:
        print(f"UNKNOWN: '{spdx}' is not recognized — treating as blocked")
        sys.exit(2)


def main():
    parser = argparse.ArgumentParser(description="Asimov's Mind — Provenance Tracker")
    sub = parser.add_subparsers(dest="command")

    # log command
    log_p = sub.add_parser("log", help="Log a candidate integration")
    log_p.add_argument("--record-id", required=True)
    log_p.add_argument("--repo", required=True)
    log_p.add_argument("--component", required=True)
    log_p.add_argument("--license", required=True)
    log_p.add_argument("--scout-trust", type=float, required=True)
    log_p.add_argument("--scanner-trust", type=float, required=True)

    # outcome command
    out_p = sub.add_parser("outcome", help="Log an experiment outcome")
    out_p.add_argument("--record-id", required=True)
    out_p.add_argument("--result", required=True, choices=["kept", "reverted"])
    out_p.add_argument("--reason", default="")

    # history command
    sub.add_parser("history", help="Display provenance history")

    # check-license command
    lic_p = sub.add_parser("check-license", help="Check license compatibility")
    lic_p.add_argument("spdx_id")

    args = parser.parse_args()
    if args.command == "log":
        cmd_log(args)
    elif args.command == "outcome":
        cmd_outcome(args)
    elif args.command == "history":
        cmd_history(args)
    elif args.command == "check-license":
        cmd_check_license(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
