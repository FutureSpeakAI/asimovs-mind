"""
Sovereign Vault CLI — Click-based command-line interface.
"""

import sys
from pathlib import Path

import click

from vault import (
    init_vault,
    lock_category,
    unlock_category,
    lock_all,
    get_category_status,
    VaultConfig,
)


def get_vault_root(ctx) -> Path:
    """Resolve the vault root from the Click context."""
    return Path(ctx.obj.get("vault_root", ".")).resolve()


@click.group()
@click.option(
    "--vault-dir",
    default=".",
    envvar="SOVEREIGN_VAULT_DIR",
    help="Root directory of the vault (default: current directory).",
)
@click.pass_context
def cli(ctx, vault_dir):
    """Sovereign Vault — Encrypted file storage for sensitive data."""
    ctx.ensure_object(dict)
    ctx.obj["vault_root"] = vault_dir


@cli.command()
@click.option("--password", prompt=True, hide_input=True, confirmation_prompt=True, help="Master password for the vault.")
@click.pass_context
def init(ctx, password):
    """Initialize a new Sovereign Vault."""
    vault_root = get_vault_root(ctx)

    config_path = vault_root / ".vault_config.json"
    if config_path.exists():
        click.echo(f"Vault already initialized at {vault_root}")
        sys.exit(1)

    config = init_vault(vault_root, password)
    click.echo(f"Sovereign Vault initialized at {vault_root}")
    click.echo(f"Categories: {', '.join(config.categories)}")
    click.echo("Keep your password safe — there is no recovery mechanism.")


@cli.command()
@click.argument("category")
@click.option("--password", prompt=True, hide_input=True, help="Master password.")
@click.pass_context
def lock(ctx, category, password):
    """Encrypt all files in a category directory."""
    vault_root = get_vault_root(ctx)
    try:
        encrypted = lock_category(vault_root, category, password)
        if encrypted:
            click.echo(f"Locked {len(encrypted)} file(s) in '{category}':")
            for f in encrypted:
                click.echo(f"  {f}")
        else:
            click.echo(f"No unlocked files found in '{category}'.")
    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.argument("category")
@click.option("--password", prompt=True, hide_input=True, help="Master password.")
@click.pass_context
def unlock(ctx, category, password):
    """Decrypt all .vault files in a category directory."""
    vault_root = get_vault_root(ctx)
    try:
        decrypted = unlock_category(vault_root, category, password)
        if decrypted:
            click.echo(f"Unlocked {len(decrypted)} file(s) in '{category}':")
            for f in decrypted:
                click.echo(f"  {f}")
        else:
            click.echo(f"No locked files found in '{category}'.")
    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


@cli.command()
@click.pass_context
def status(ctx):
    """Show lock state of each category."""
    vault_root = get_vault_root(ctx)
    try:
        config = VaultConfig.load(vault_root)
    except FileNotFoundError:
        click.echo("No vault found. Run 'vault init' first.", err=True)
        sys.exit(1)

    click.echo(f"Sovereign Vault: {vault_root}")
    click.echo("-" * 50)

    for cat in config.categories:
        st = get_category_status(vault_root, cat)
        if not st["exists"]:
            state_str = "missing"
        elif st["unlocked"] == 0 and st["locked"] == 0:
            state_str = "empty"
        elif st["unlocked"] == 0:
            state_str = f"LOCKED ({st['locked']} file(s))"
        elif st["locked"] == 0:
            state_str = f"UNLOCKED ({st['unlocked']} file(s))"
        else:
            state_str = f"MIXED (locked={st['locked']}, unlocked={st['unlocked']})"
        click.echo(f"  {cat:15s} {state_str}")


@cli.command("lock-all")
@click.option("--password", prompt=True, hide_input=True, help="Master password.")
@click.pass_context
def lock_all_cmd(ctx, password):
    """Lock all categories."""
    vault_root = get_vault_root(ctx)
    try:
        results = lock_all(vault_root, password)
        total = sum(len(v) for v in results.values())
        click.echo(f"Locked {total} file(s) across all categories.")
        for cat, files in results.items():
            if files:
                click.echo(f"  {cat}: {len(files)} file(s)")
    except FileNotFoundError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)
    except ValueError as e:
        click.echo(f"Error: {e}", err=True)
        sys.exit(1)


if __name__ == "__main__":
    cli()
