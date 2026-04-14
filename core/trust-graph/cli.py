"""
Trust Graph CLI — Phase 3.

Click-based command-line interface for the Trust Graph.
"""

import json
import os
import sys

import click

from trust_graph import (
    TrustGraph,
    Evidence,
    EvidenceType,
    TrustDimension,
    _now_iso,
)

DEFAULT_DB = os.path.join(os.path.expanduser("~"), ".friday", "trust_graph.json")


def _get_db_path(ctx: click.Context) -> str:
    return ctx.obj.get("db", DEFAULT_DB) if ctx.obj else DEFAULT_DB


def _load_graph(path: str) -> TrustGraph:
    if os.path.exists(path):
        return TrustGraph.load(path)
    return TrustGraph()


def _save_graph(graph: TrustGraph, path: str) -> None:
    graph.save(path)


@click.group()
@click.option("--db", default=DEFAULT_DB, help="Path to trust graph JSON file.")
@click.pass_context
def trust(ctx: click.Context, db: str) -> None:
    """Trust Graph — person-level credibility model."""
    ctx.ensure_object(dict)
    ctx.obj["db"] = db


@trust.command()
@click.argument("name")
@click.option("--alias", "-a", multiple=True, help="Aliases for this person.")
@click.pass_context
def add(ctx: click.Context, name: str, alias: tuple) -> None:
    """Add a person to the trust graph."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    node = graph.add_person(name, aliases=list(alias))
    _save_graph(graph, path)
    click.echo(f"Added: {node.name} (aliases: {node.aliases})")


@trust.command()
@click.argument("name")
@click.argument("evidence_type", type=click.Choice([e.value for e in EvidenceType]))
@click.argument("magnitude", type=float)
@click.option("--domain", "-d", default=None, help="Domain for expertise evidence.")
@click.option("--notes", "-n", default=None, help="Notes about this evidence.")
@click.pass_context
def evidence(
    ctx: click.Context,
    name: str,
    evidence_type: str,
    magnitude: float,
    domain: str,
    notes: str,
) -> None:
    """Record evidence for a person."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    ev = Evidence(
        type=EvidenceType(evidence_type),
        magnitude=magnitude,
        timestamp=_now_iso(),
        domain=domain,
        notes=notes,
    )
    try:
        node = graph.add_evidence(name, ev)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    _save_graph(graph, path)
    overall = node.scores.get(TrustDimension.OVERALL.value, 0.5)
    click.echo(f"Recorded {evidence_type} (mag={magnitude}) for {node.name}. Overall trust: {overall:.3f}")


@trust.command()
@click.argument("name")
@click.pass_context
def score(ctx: click.Context, name: str) -> None:
    """Show trust scores for a person across all dimensions."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    node = graph.find_person(name)
    if node is None:
        click.echo(f"Person not found: {name}", err=True)
        sys.exit(1)

    click.echo(f"\nTrust Scores for {node.name}")
    click.echo("=" * 40)
    for dim in TrustDimension:
        val = node.scores.get(dim.value, 0.5)
        bar = "#" * int(val * 20)
        label = dim.value.replace("_", " ").title()
        click.echo(f"  {label:<25} {val:.3f}  {bar}")
    click.echo()


@trust.command(name="list")
@click.pass_context
def list_people(ctx: click.Context) -> None:
    """Show all people sorted by overall trust."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    people = graph.get_all_people()
    if not people:
        click.echo("Trust graph is empty.")
        return

    click.echo(f"\n{'Name':<30} {'Overall':>8}  {'Evidence':>8}")
    click.echo("-" * 50)
    for node in people:
        overall = node.scores.get(TrustDimension.OVERALL.value, 0.5)
        click.echo(f"  {node.name:<28} {overall:>8.3f}  {len(node.evidence):>8}")
    click.echo()


@trust.command()
@click.argument("query")
@click.pass_context
def find(ctx: click.Context, query: str) -> None:
    """Fuzzy search for a person."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    node = graph.find_person(query)
    if node is None:
        click.echo(f"No match found for: {query}")
        return
    click.echo(f"Found: {node.name} (aliases: {node.aliases})")


@trust.command()
@click.pass_context
def decay(ctx: click.Context) -> None:
    """Apply time-based decay to all trust scores."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    graph.apply_decay()
    _save_graph(graph, path)
    click.echo("Decay applied to all trust scores.")


@trust.command(name="export")
@click.pass_context
def export_graph(ctx: click.Context) -> None:
    """Export the full trust graph as JSON."""
    path = _get_db_path(ctx)
    graph = _load_graph(path)
    click.echo(json.dumps(graph.to_dict(), indent=2))


if __name__ == "__main__":
    trust()
