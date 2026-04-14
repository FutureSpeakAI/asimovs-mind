"""
CLI for Cognitive Memory System.

Usage:
    python cli.py add <content> [--tier short|medium|long] [--confidence 0.5]
    python cli.py find <query>
    python cli.py promote
    python cli.py consolidate
    python cli.py stats
    python cli.py episodes
"""

from __future__ import annotations

import click

from memory import CognitiveMemory, MemoryTier

DEFAULT_PATH = "memory.json"


def _load() -> CognitiveMemory:
    from pathlib import Path

    p = Path(DEFAULT_PATH)
    if p.exists():
        return CognitiveMemory.load(p)
    return CognitiveMemory()


def _save(mem: CognitiveMemory) -> None:
    mem.save(DEFAULT_PATH)


@click.group()
def cli() -> None:
    """Cognitive Memory — 3-tier memory with deduplication & consolidation."""


@cli.command()
@click.argument("content")
@click.option(
    "--tier",
    type=click.Choice(["short", "medium", "long"], case_sensitive=False),
    default="short",
    help="Memory tier (default: short).",
)
@click.option("--confidence", type=float, default=0.5, help="Confidence score 0-1.")
@click.option("--source", type=str, default=None, help="Source attribution.")
def add(content: str, tier: str, confidence: float, source: str | None) -> None:
    """Add a memory entry."""
    mem = _load()
    entry = mem.add(content, tier=MemoryTier(tier), confidence=confidence, source=source)
    _save(mem)
    click.echo(f"Added [{entry.tier.value}] (conf={entry.confidence:.2f}, occ={entry.occurrences}): {entry.content}")


@cli.command()
@click.argument("query")
@click.option("--tier", type=click.Choice(["short", "medium", "long"], case_sensitive=False), default=None)
def find(query: str, tier: str | None) -> None:
    """Search memory entries."""
    mem = _load()
    t = MemoryTier(tier) if tier else None
    results = mem.find(query, tier=t)
    if not results:
        click.echo("No matches found.")
        return
    for entry in results:
        click.echo(f"  [{entry.tier.value}] (conf={entry.confidence:.2f}, occ={entry.occurrences}) {entry.content}")


@cli.command()
def promote() -> None:
    """Run promotion cycle (medium → long)."""
    mem = _load()
    promoted = mem.promote()
    _save(mem)
    click.echo(f"Promoted {len(promoted)} entries to long-term.")
    for e in promoted:
        click.echo(f"  → {e.content}")


@cli.command()
def consolidate() -> None:
    """Run full consolidation cycle."""
    mem = _load()
    results = mem.consolidate()
    _save(mem)
    click.echo("Consolidation complete:")
    click.echo(f"  Dedup short:  {results['dedup_short']} removed")
    click.echo(f"  Dedup medium: {results['dedup_medium']} removed")
    click.echo(f"  Dedup long:   {results['dedup_long']} removed")
    click.echo(f"  Promoted:     {results['promoted']}")
    click.echo(f"  Demoted:      {results['demoted']}")


@cli.command()
def stats() -> None:
    """Show memory statistics."""
    mem = _load()
    s = mem.get_stats()
    click.echo(f"Short-term:  {s['short']}")
    click.echo(f"Medium-term: {s['medium']}")
    click.echo(f"Long-term:   {s['long']}")
    click.echo(f"Total:       {s['total']}")
    click.echo(f"Episodes:    {s['episodes']}")
    click.echo(f"Last consolidation: {s['last_consolidation'] or 'never'}")


@cli.command()
@click.option("--limit", type=int, default=10, help="Number of recent episodes.")
def episodes(limit: int) -> None:
    """Show recent episodes."""
    mem = _load()
    eps = mem.get_episodes(limit=limit)
    if not eps:
        click.echo("No episodes recorded.")
        return
    for ep in eps:
        click.echo(f"\n[{ep.timestamp}] {ep.summary}")
        if ep.topics:
            click.echo(f"  Topics: {', '.join(ep.topics)}")
        click.echo(f"  Tone: {ep.emotional_tone}")
        if ep.key_decisions:
            click.echo(f"  Decisions: {', '.join(ep.key_decisions)}")


if __name__ == "__main__":
    cli()
