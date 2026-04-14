#!/usr/bin/env python3
"""
Epistemic Score CLI
===================
Command-line interface for recording interactions and viewing epistemic metrics.

Usage:
    python cli.py record [flags]       Record an interaction
    python cli.py score                Show current scores
    python cli.py trend [--window N]   Show trend direction
    python cli.py report               Full human-readable report
    python cli.py history              Show interaction history
"""

import argparse
import json
import sys
from pathlib import Path

from epistemic import (
    DelegationType,
    EpistemicScore,
    InteractionRecord,
)

DEFAULT_DATA_FILE = Path("epistemic_data.json")


def get_scorer(data_file: Path) -> EpistemicScore:
    """Load existing data or create a new scorer."""
    if data_file.exists():
        return EpistemicScore.load(data_file)
    return EpistemicScore()


def cmd_record(args: argparse.Namespace) -> None:
    """Record a new interaction."""
    scorer = get_scorer(args.data_file)

    delegation = None
    if args.appropriate:
        delegation = DelegationType.APPROPRIATE.value
    elif args.abdication:
        delegation = DelegationType.ABDICATION.value

    record = InteractionRecord(
        user_initiated_solution=args.initiated,
        ai_challenged=args.challenged,
        new_concept_applied=args.applied,
        complexity_level=args.complexity,
        delegation_type=delegation,
        notes=args.notes or "",
    )

    scorer.record_interaction(record)
    scorer.save(args.data_file)

    print(f"Recorded interaction #{len(scorer.interactions)}")
    print(f"  Initiated solution: {record.user_initiated_solution}")
    print(f"  Challenged AI:      {record.ai_challenged}")
    print(f"  Applied concept:    {record.new_concept_applied}")
    print(f"  Complexity:         {record.complexity_level}/5")
    if delegation:
        print(f"  Delegation:         {delegation}")
    if record.notes:
        print(f"  Notes:              {record.notes}")


def cmd_score(args: argparse.Namespace) -> None:
    """Display current metric scores."""
    scorer = get_scorer(args.data_file)
    if not scorer.interactions:
        print("No interactions recorded yet.")
        return

    scores = scorer.compute_scores()
    print(f"\nEpistemic Scores ({len(scorer.interactions)} interactions):\n")
    for key, value in scores.items():
        label = key.replace("_", " ").title()
        print(f"  {label:<30} {value:.4f}")

    if scorer.check_dependency_alert():
        print("\n⚠️  DEPENDENCY ALERT: Overall score below 0.4")


def cmd_trend(args: argparse.Namespace) -> None:
    """Show the current trend."""
    scorer = get_scorer(args.data_file)
    if not scorer.interactions:
        print("No interactions recorded yet.")
        return

    trend = scorer.get_trend(window=args.window)
    print(f"Trend (window={args.window}): {trend.value}")


def cmd_report(args: argparse.Namespace) -> None:
    """Print the full epistemic report."""
    scorer = get_scorer(args.data_file)
    print(scorer.get_report())


def cmd_history(args: argparse.Namespace) -> None:
    """Show interaction history."""
    scorer = get_scorer(args.data_file)
    if not scorer.interactions:
        print("No interactions recorded yet.")
        return

    for i, rec in enumerate(scorer.interactions, 1):
        flags = []
        if rec.user_initiated_solution:
            flags.append("initiated")
        if rec.ai_challenged:
            flags.append("challenged")
        if rec.new_concept_applied:
            flags.append("applied")
        if rec.delegation_type:
            flags.append(f"deleg:{rec.delegation_type}")

        flag_str = ", ".join(flags) if flags else "none"
        ts = rec.timestamp[:19]  # trim to seconds
        print(f"  [{i:>3}] {ts}  complexity={rec.complexity_level}  [{flag_str}]")
        if rec.notes:
            print(f"        {rec.notes}")


def main():
    parser = argparse.ArgumentParser(
        description="Epistemic Score — track cognitive independence from AI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--data-file", type=Path, default=DEFAULT_DATA_FILE,
        help="Path to the JSON data file (default: epistemic_data.json)",
    )

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    # ── record ────────────────────────────────────────────────────
    rec = subparsers.add_parser("record", help="Record an interaction")
    rec.add_argument("--initiated", "-i", action="store_true",
                     help="User initiated the solution")
    rec.add_argument("--challenged", "-c", action="store_true",
                     help="User challenged the AI")
    rec.add_argument("--applied", "-a", action="store_true",
                     help="User applied a previously learned concept")
    rec.add_argument("--complexity", "-x", type=int, default=1,
                     choices=[1, 2, 3, 4, 5], help="Complexity level (1-5)")
    rec.add_argument("--appropriate", action="store_true",
                     help="Mark delegation as appropriate")
    rec.add_argument("--abdication", action="store_true",
                     help="Mark delegation as abdication")
    rec.add_argument("--notes", "-n", type=str, default="",
                     help="Optional notes about the interaction")
    rec.set_defaults(func=cmd_record)

    # ── score ─────────────────────────────────────────────────────
    sc = subparsers.add_parser("score", help="Show current scores")
    sc.set_defaults(func=cmd_score)

    # ── trend ─────────────────────────────────────────────────────
    tr = subparsers.add_parser("trend", help="Show trend direction")
    tr.add_argument("--window", "-w", type=int, default=10,
                    help="Number of recent interactions to analyze (default: 10)")
    tr.set_defaults(func=cmd_trend)

    # ── report ────────────────────────────────────────────────────
    rp = subparsers.add_parser("report", help="Full epistemic report")
    rp.set_defaults(func=cmd_report)

    # ── history ───────────────────────────────────────────────────
    hi = subparsers.add_parser("history", help="Show interaction history")
    hi.set_defaults(func=cmd_history)

    args = parser.parse_args()
    if args.command is None:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
