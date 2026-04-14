"""
Privacy Shield CLI — Command-line interface for PII scanning and scrubbing.
"""

import sys
import click
from shield import (
    scan_text, scrub_text, PIICategory,
    allowlist_add as _allowlist_add,
    allowlist_show as _allowlist_show,
    allowlist_remove as _allowlist_remove,
    allowlist_clear as _allowlist_clear,
)


def _category_summary(matches) -> dict[str, int]:
    """Count matches by category."""
    counts: dict[str, int] = {}
    for m in matches:
        name = m.category.name
        counts[name] = counts.get(name, 0) + 1
    return counts


@click.group()
def cli():
    """Privacy Shield — Detect and mask PII before it leaves your machine."""
    pass


@cli.command()
@click.argument("file", type=click.Path(exists=True))
def scan(file):
    """Scan a file and report PII found."""
    with open(file, "r", encoding="utf-8") as f:
        text = f.read()
    
    matches = scan_text(text)
    
    if not matches:
        click.echo("No PII detected.")
        return
    
    click.echo(f"Found {len(matches)} PII match(es):\n")
    for m in matches:
        preview = m.original[:40] + ("..." if len(m.original) > 40 else "")
        click.echo(f"  [{m.category.name}] \"{preview}\" at position {m.start}-{m.end}")
    
    click.echo(f"\nSummary: {_category_summary(matches)}")


@cli.command()
@click.argument("file", type=click.Path(exists=True))
@click.option("--output", "-o", type=click.Path(), default=None, help="Output file (default: stdout)")
def scrub(file, output):
    """Scrub PII from a file."""
    with open(file, "r", encoding="utf-8") as f:
        text = f.read()
    
    scrubbed, matches = scrub_text(text)
    
    if output:
        with open(output, "w", encoding="utf-8") as f:
            f.write(scrubbed)
        click.echo(f"Scrubbed {len(matches)} PII match(es) -> {output}")
    else:
        click.echo(scrubbed)


@cli.command("scrub-text")
@click.argument("text", required=False)
def scrub_text_cmd(text):
    """Scrub PII from a text argument or stdin."""
    if text is None:
        text = sys.stdin.read()
    
    scrubbed, matches = scrub_text(text)
    click.echo(scrubbed)
    
    if matches:
        click.echo(f"\n--- Scrubbed {len(matches)} PII match(es) ---", err=True)


@cli.group()
def allowlist():
    """Manage the PII allowlist."""
    pass


@allowlist.command("add")
@click.argument("value")
def allowlist_add_cmd(value):
    """Add a value to the allowlist."""
    _allowlist_add(value)
    click.echo(f"Added to allowlist: {value}")


@allowlist.command("remove")
@click.argument("value")
def allowlist_remove_cmd(value):
    """Remove a value from the allowlist."""
    _allowlist_remove(value)
    click.echo(f"Removed from allowlist: {value}")


@allowlist.command("show")
def allowlist_show_cmd():
    """Show all allowlisted values."""
    items = _allowlist_show()
    if not items:
        click.echo("Allowlist is empty.")
        return
    click.echo(f"Allowlist ({len(items)} items):")
    for item in items:
        click.echo(f"  {item}")


@allowlist.command("clear")
def allowlist_clear_cmd():
    """Clear the entire allowlist."""
    _allowlist_clear()
    click.echo("Allowlist cleared.")


if __name__ == "__main__":
    cli()
