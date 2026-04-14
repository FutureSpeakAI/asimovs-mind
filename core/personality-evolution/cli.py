"""
CLI for the Personality Evolution System.
Usage: python cli.py <command> [args]
"""

import argparse
import sys
from pathlib import Path

from personality import PersonalityEngine, Trait, VisualDimension

DEFAULT_PROFILE = "personality_profile.json"


def get_engine(filepath: str) -> PersonalityEngine:
    path = Path(filepath)
    if path.exists():
        return PersonalityEngine.load(path)
    return PersonalityEngine()


def cmd_show(args: argparse.Namespace) -> None:
    engine = get_engine(args.profile)
    print(engine.get_personality_summary())


def cmd_visuals(args: argparse.Namespace) -> None:
    engine = get_engine(args.profile)
    visuals = engine.get_visual_dimensions()
    maturity = engine.maturity
    print(f"Maturity: {maturity:.1%}")
    print()
    for dim, val in visuals.items():
        if dim == VisualDimension.HUE:
            print(f"  {dim.value:12s}  {val:7.1f}\u00b0")
        else:
            print(f"  {dim.value:12s}  {val:7.3f}")


def cmd_style(args: argparse.Namespace) -> None:
    engine = get_engine(args.profile)
    style = engine.get_style()
    print(f"Maturity: {engine.maturity:.1%}")
    print()
    for key, val in style.items():
        bar = "\u2588" * int(val * 20)
        print(f"  {key:30s}  {val:.3f}  {bar}")


def cmd_session(args: argparse.Namespace) -> None:
    engine = get_engine(args.profile)
    old_maturity = engine.maturity
    new_maturity = engine.record_session()
    engine.save(args.profile)
    print(f"Session recorded. Count: {engine.profile.session_count}")
    print(f"Maturity: {old_maturity:.1%} \u2192 {new_maturity:.1%}")


def cmd_set(args: argparse.Namespace) -> None:
    engine = get_engine(args.profile)
    try:
        trait = Trait(args.trait.lower())
    except ValueError:
        print(f"Unknown trait: {args.trait}")
        print(f"Available: {', '.join(t.value for t in Trait)}")
        sys.exit(1)

    value = float(args.value)
    if not 0.0 <= value <= 1.0:
        print("Value must be between 0 and 1.")
        sys.exit(1)

    engine.set_trait(trait, value)
    engine.save(args.profile)
    effective = engine.get_trait(trait)
    print(f"Set {trait.value} = {value:.2f}  (effective at {engine.maturity:.0%} maturity: {effective:.2f})")


def cmd_sycophancy(args: argparse.Namespace) -> None:
    engine = get_engine(args.profile)
    syc = engine.profile.sycophancy
    print("Anti-Sycophancy Tracker")
    print(f"  Agreement streak:      {syc.agreement_streak}")
    print(f"  Positivity bias:       {syc.positivity_bias:.3f}")
    print(f"  Contradiction count:   {syc.contradiction_count}")
    print(f"  Pushback count:        {syc.pushback_count}")
    print(f"  Total interactions:    {syc.total_interactions}")
    print(f"  Circuit breaker fires: {len(syc.circuit_breaker_events)}")
    if syc.should_fire():
        print("\n  \u26a0  CIRCUIT BREAKER TRIGGERED \u2014 sycophancy threshold reached")
    else:
        print(f"\n  Status: OK (streak {syc.agreement_streak}/8, bias {syc.positivity_bias:.2f}/0.85)")


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="personality",
        description="Agent Friday Personality Evolution System",
    )
    parser.add_argument(
        "--profile", "-p",
        default=DEFAULT_PROFILE,
        help=f"Path to profile JSON (default: {DEFAULT_PROFILE})",
    )

    sub = parser.add_subparsers(dest="command")

    sub.add_parser("show", help="Show current traits and maturity")
    sub.add_parser("visuals", help="Show current visual dimensions")
    sub.add_parser("style", help="Show current adaptive style")
    sub.add_parser("session", help="Record a new session")
    sub.add_parser("sycophancy", help="Show anti-sycophancy tracker stats")

    set_parser = sub.add_parser("set", help="Set a trait value")
    set_parser.add_argument("trait", help="Trait name")
    set_parser.add_argument("value", type=float, help="Value 0-1")

    args = parser.parse_args()

    commands = {
        "show": cmd_show,
        "visuals": cmd_visuals,
        "style": cmd_style,
        "session": cmd_session,
        "set": cmd_set,
        "sycophancy": cmd_sycophancy,
    }

    if args.command in commands:
        commands[args.command](args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
