"""
CLI for the HMAC Integrity System.

Commands:
  integrity sign <file> --tier <tier>
  integrity verify <file>
  integrity sign-dir <dir> --tier <tier>
  integrity verify-dir <dir>
  integrity manifest
  integrity attest
  integrity safe-mode
"""

from __future__ import annotations

import json
import os
import sys

import click

from integrity import IntegrityManager, ProtectionTier, Attestation


def _get_secret() -> str:
    """Read the signing secret from env or prompt."""
    secret = os.environ.get("INTEGRITY_SECRET")
    if not secret:
        secret = click.prompt("Signing secret", hide_input=True)
    return secret


def _tier_from_string(name: str) -> ProtectionTier:
    """Convert a CLI tier name to the enum."""
    mapping = {
        "core": ProtectionTier.CORE_LAWS,
        "core_laws": ProtectionTier.CORE_LAWS,
        "identity": ProtectionTier.IDENTITY,
        "memory": ProtectionTier.MEMORY,
    }
    key = name.lower().replace("-", "_")
    if key not in mapping:
        raise click.BadParameter(
            f"Unknown tier '{name}'. Choose from: core, identity, memory"
        )
    return mapping[key]


# Global manager instance (persisted across commands via manifest)
_MANIFEST_FILE = ".integrity_manifest.json"


def _load_manager() -> IntegrityManager:
    mgr = IntegrityManager()
    if os.path.isfile(_MANIFEST_FILE):
        mgr.load_manifest(_MANIFEST_FILE)
    return mgr


def _save_manager(mgr: IntegrityManager) -> None:
    mgr.save_manifest(_MANIFEST_FILE)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

@click.group()
def cli():
    """HMAC Integrity System — governance file signing & verification."""
    pass


@cli.command()
@click.argument("file", type=click.Path(exists=True))
@click.option("--tier", required=True, help="Protection tier: core, identity, memory")
def sign(file: str, tier: str):
    """Sign a single file."""
    secret = _get_secret()
    mgr = _load_manager()
    t = _tier_from_string(tier)
    record = mgr.sign_file(file, t, secret)
    _save_manager(mgr)
    click.echo(f"Signed: {record.file_path}")
    click.echo(f"  Tier: {ProtectionTier(record.tier).name}")
    click.echo(f"  HMAC: {record.hmac_hash[:16]}...")


@cli.command()
@click.argument("file", type=click.Path(exists=True))
def verify(file: str):
    """Verify a single file against its .sig sidecar."""
    secret = _get_secret()
    mgr = _load_manager()
    ok = mgr.verify_file(file, secret)
    if ok:
        click.secho(f"PASS: {file}", fg="green")
    else:
        click.secho(f"FAIL: {file}", fg="red")
        if mgr.is_safe_mode():
            click.secho(
                f"  SAFE MODE ACTIVE: {mgr.safe_mode_state().reason}", fg="yellow"
            )
    sys.exit(0 if ok else 1)


@cli.command("sign-dir")
@click.argument("directory", type=click.Path(exists=True, file_okay=False))
@click.option("--tier", required=True, help="Protection tier: core, identity, memory")
def sign_dir(directory: str, tier: str):
    """Sign all files in a directory."""
    secret = _get_secret()
    mgr = _load_manager()
    t = _tier_from_string(tier)
    records = mgr.sign_directory(directory, t, secret)
    _save_manager(mgr)
    click.echo(f"Signed {len(records)} file(s) in {directory}")
    for r in records:
        click.echo(f"  {r.file_path}")


@cli.command("verify-dir")
@click.argument("directory", type=click.Path(exists=True, file_okay=False))
def verify_dir(directory: str):
    """Verify all files in a directory."""
    secret = _get_secret()
    mgr = _load_manager()
    failures = mgr.verify_directory(directory, secret)
    if not failures:
        click.secho(f"ALL PASS: {directory}", fg="green")
    else:
        click.secho(f"{len(failures)} FAILURE(S):", fg="red")
        for f in failures:
            click.secho(f"  FAIL: {f}", fg="red")
        if mgr.is_safe_mode():
            click.secho(
                f"  SAFE MODE ACTIVE: {mgr.safe_mode_state().reason}", fg="yellow"
            )
    sys.exit(0 if not failures else 1)


@cli.command()
def manifest():
    """Show the current signature manifest."""
    mgr = _load_manager()
    m = mgr.get_manifest()
    if not m:
        click.echo("No files tracked yet.")
        return
    for fp, rec in m.items():
        tier_name = ProtectionTier(rec["tier"]).name
        click.echo(f"  [{tier_name}] {fp}")
        click.echo(f"    HMAC: {rec['hmac_hash'][:16]}...")


@cli.command()
def attest():
    """Generate a multi-agent attestation."""
    secret = _get_secret()
    mgr = _load_manager()
    att = mgr.generate_attestation(secret)
    click.echo(json.dumps(att.to_dict(), indent=2))


@cli.command("safe-mode")
def safe_mode():
    """Show current safe-mode status."""
    mgr = _load_manager()
    state = mgr.safe_mode_state()
    if state.triggered:
        click.secho("SAFE MODE: ACTIVE", fg="yellow", bold=True)
        click.echo(f"  Reason: {state.reason}")
        click.echo(f"  Restricted: {', '.join(state.restricted_actions)}")
    else:
        click.secho("Safe mode: inactive", fg="green")


if __name__ == "__main__":
    cli()
