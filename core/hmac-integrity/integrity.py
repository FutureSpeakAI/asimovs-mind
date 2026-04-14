"""
HMAC Integrity System — Phase 7 of Agent Friday's Core Systems

HMAC-SHA256 signing and verification for governance files.
Three protection tiers based on Asimov's cLaws design:
  Tier 1 — Core Laws: HMAC-verified against compiled source. Tampering triggers safe mode.
  Tier 2 — Identity: Signed after legitimate changes. External modification detected and flagged.
  Tier 3 — Memory: Signed after saves, diffed on startup. External changes surfaced to user.

If verification fails, the agent degrades to safe mode rather than crashing.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from dataclasses import dataclass, field, asdict
from enum import Enum
from pathlib import Path
from typing import Optional


# ---------------------------------------------------------------------------
# Enums & Data Classes
# ---------------------------------------------------------------------------

class ProtectionTier(Enum):
    """Three tiers of governance-file protection."""
    CORE_LAWS = 1   # Immutable laws — tampering triggers safe mode
    IDENTITY  = 2   # Personality / identity — signed after legitimate edits
    MEMORY    = 3   # Working memory — signed after saves, diffed on startup


@dataclass
class SignatureRecord:
    """Stored alongside each signed file as a .sig sidecar."""
    file_path: str
    hmac_hash: str
    timestamp: float
    tier: int          # ProtectionTier.value

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SignatureRecord":
        return cls(
            file_path=d["file_path"],
            hmac_hash=d["hmac_hash"],
            timestamp=d["timestamp"],
            tier=d["tier"],
        )


@dataclass
class SafeModeState:
    """Tracks whether the agent has entered safe mode."""
    triggered: bool = False
    reason: str = ""
    timestamp: float = 0.0
    restricted_actions: list[str] = field(default_factory=lambda: [
        "personality_override",
        "memory_write",
        "law_modification",
        "external_api_calls",
    ])

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SafeModeState":
        return cls(**d)


@dataclass
class Attestation:
    """Cross-agent attestation: a signed snapshot of all governance file hashes."""
    file_hashes: dict[str, str]   # {filepath: sha256_hex}
    signature: str                 # HMAC of the canonical payload
    timestamp: float
    agent_id: str = "agent-friday"

    def to_dict(self) -> dict:
        return {
            "file_hashes": self.file_hashes,
            "signature": self.signature,
            "timestamp": self.timestamp,
            "agent_id": self.agent_id,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Attestation":
        return cls(
            file_hashes=d["file_hashes"],
            signature=d["signature"],
            timestamp=d["timestamp"],
            agent_id=d.get("agent_id", "agent-friday"),
        )


# ---------------------------------------------------------------------------
# HMAC Helpers
# ---------------------------------------------------------------------------

def _compute_hmac(data: bytes, secret_key: str) -> str:
    """Compute HMAC-SHA256 and return the hex digest."""
    return hmac.new(
        key=secret_key.encode("utf-8"),
        msg=data,
        digestmod=hashlib.sha256,
    ).hexdigest()


def _sha256_hex(data: bytes) -> str:
    """Plain SHA-256 hex digest (used inside attestations)."""
    return hashlib.sha256(data).hexdigest()


def _sig_path(filepath: str | Path) -> Path:
    """Return the .sig sidecar path for a given file."""
    p = Path(filepath)
    return p.parent / (p.name + ".sig")


# ---------------------------------------------------------------------------
# IntegrityManager
# ---------------------------------------------------------------------------

_ATTESTATION_TTL_SECONDS = 300  # 5 minutes


class IntegrityManager:
    """
    Signs and verifies governance files using HMAC-SHA256.

    Usage:
        mgr = IntegrityManager()
        mgr.sign_file("laws.md", ProtectionTier.CORE_LAWS, "my-secret")
        ok = mgr.verify_file("laws.md", "my-secret")
    """

    def __init__(self) -> None:
        self._safe_mode = SafeModeState()
        self._manifest: dict[str, SignatureRecord] = {}  # filepath -> record

    # ---- signing ----------------------------------------------------------

    def sign_file(
        self,
        filepath: str | Path,
        tier: ProtectionTier,
        secret_key: str,
    ) -> SignatureRecord:
        """Sign a single file and write a .sig sidecar."""
        filepath = Path(filepath)
        if not filepath.is_file():
            raise FileNotFoundError(f"Cannot sign — file not found: {filepath}")

        data = filepath.read_bytes()
        mac = _compute_hmac(data, secret_key)
        now = time.time()

        record = SignatureRecord(
            file_path=str(filepath),
            hmac_hash=mac,
            timestamp=now,
            tier=tier.value,
        )

        # Write sidecar
        sig_file = _sig_path(filepath)
        sig_file.write_text(json.dumps(record.to_dict(), indent=2), encoding="utf-8")

        # Update in-memory manifest
        self._manifest[str(filepath)] = record
        return record

    def sign_directory(
        self,
        dirpath: str | Path,
        tier: ProtectionTier,
        secret_key: str,
    ) -> list[SignatureRecord]:
        """Sign every file in *dirpath* (non-recursive, skips .sig files)."""
        dirpath = Path(dirpath)
        if not dirpath.is_dir():
            raise NotADirectoryError(f"Not a directory: {dirpath}")

        records: list[SignatureRecord] = []
        for child in sorted(dirpath.iterdir()):
            if child.is_file() and child.suffix != ".sig":
                records.append(self.sign_file(child, tier, secret_key))
        return records

    # ---- verification -----------------------------------------------------

    def verify_file(self, filepath: str | Path, secret_key: str) -> bool:
        """
        Verify a file against its .sig sidecar.

        Returns True if the file is intact, False if tampered or missing sig.
        On Tier-1 failure, automatically enters safe mode.
        """
        filepath = Path(filepath)
        sig_file = _sig_path(filepath)

        if not filepath.is_file():
            return False
        if not sig_file.is_file():
            return False

        try:
            record = SignatureRecord.from_dict(
                json.loads(sig_file.read_text(encoding="utf-8"))
            )
        except (json.JSONDecodeError, KeyError):
            return False

        data = filepath.read_bytes()
        expected = _compute_hmac(data, secret_key)
        ok = hmac.compare_digest(expected, record.hmac_hash)

        if not ok and record.tier == ProtectionTier.CORE_LAWS.value:
            self.enter_safe_mode(
                f"Tier-1 Core Laws tamper detected: {filepath}"
            )

        # Update manifest status
        if str(filepath) in self._manifest:
            if not ok:
                self._manifest[str(filepath)].hmac_hash = "TAMPERED"

        return ok

    def verify_directory(
        self, dirpath: str | Path, secret_key: str,
    ) -> list[str]:
        """
        Verify all files in a directory.

        Returns a list of filepaths that FAILED verification.
        """
        dirpath = Path(dirpath)
        if not dirpath.is_dir():
            raise NotADirectoryError(f"Not a directory: {dirpath}")

        failures: list[str] = []
        for child in sorted(dirpath.iterdir()):
            if child.is_file() and child.suffix != ".sig":
                if not self.verify_file(child, secret_key):
                    failures.append(str(child))
        return failures

    # ---- safe mode --------------------------------------------------------

    def enter_safe_mode(self, reason: str) -> None:
        """Activate safe mode — reduced capabilities, not a crash."""
        self._safe_mode = SafeModeState(
            triggered=True,
            reason=reason,
            timestamp=time.time(),
        )

    def exit_safe_mode(self) -> None:
        """Manually exit safe mode after the issue is resolved."""
        self._safe_mode = SafeModeState()

    def is_safe_mode(self) -> bool:
        return self._safe_mode.triggered

    def safe_mode_state(self) -> SafeModeState:
        return self._safe_mode

    # ---- manifest ---------------------------------------------------------

    def get_manifest(self) -> dict[str, dict]:
        """Return all tracked files with their signature records."""
        return {fp: rec.to_dict() for fp, rec in self._manifest.items()}

    def save_manifest(self, filepath: str | Path) -> None:
        """Persist the manifest to a JSON file."""
        Path(filepath).write_text(
            json.dumps(self.get_manifest(), indent=2),
            encoding="utf-8",
        )

    def load_manifest(self, filepath: str | Path) -> None:
        """Load a manifest from a JSON file."""
        data = json.loads(Path(filepath).read_text(encoding="utf-8"))
        self._manifest = {
            fp: SignatureRecord.from_dict(rec) for fp, rec in data.items()
        }

    # ---- multi-agent attestation ------------------------------------------

    def generate_attestation(
        self,
        secret_key: str,
        agent_id: str = "agent-friday",
    ) -> Attestation:
        """
        Build an attestation of all files in the manifest.

        The attestation contains SHA-256 hashes of every tracked file
        plus an HMAC-SHA256 signature of the canonical payload.
        """
        file_hashes: dict[str, str] = {}
        for fp in sorted(self._manifest.keys()):
            p = Path(fp)
            if p.is_file():
                file_hashes[fp] = _sha256_hex(p.read_bytes())

        now = time.time()

        # Canonical payload: sorted JSON of hashes + timestamp
        payload = json.dumps(
            {"file_hashes": file_hashes, "timestamp": now, "agent_id": agent_id},
            sort_keys=True,
        ).encode("utf-8")

        sig = _compute_hmac(payload, secret_key)

        return Attestation(
            file_hashes=file_hashes,
            signature=sig,
            timestamp=now,
            agent_id=agent_id,
        )

    def verify_attestation(
        self,
        attestation: Attestation,
        secret_key: str,
        now: Optional[float] = None,
    ) -> tuple[bool, str]:
        """
        Verify an attestation from another agent.

        Returns (valid: bool, reason: str).
        Checks:
          1. Timestamp freshness (< 5 minutes old)
          2. HMAC signature matches
          3. File hashes match current files on disk
        """
        current_time = now if now is not None else time.time()

        # 1. Freshness
        age = current_time - attestation.timestamp
        if age > _ATTESTATION_TTL_SECONDS:
            return False, f"Attestation expired ({age:.0f}s old, limit {_ATTESTATION_TTL_SECONDS}s)"

        if age < 0:
            return False, "Attestation timestamp is in the future"

        # 2. Signature
        payload = json.dumps(
            {
                "file_hashes": attestation.file_hashes,
                "timestamp": attestation.timestamp,
                "agent_id": attestation.agent_id,
            },
            sort_keys=True,
        ).encode("utf-8")

        expected_sig = _compute_hmac(payload, secret_key)
        if not hmac.compare_digest(expected_sig, attestation.signature):
            return False, "HMAC signature mismatch"

        # 3. File hashes
        for fp, expected_hash in attestation.file_hashes.items():
            p = Path(fp)
            if not p.is_file():
                return False, f"File missing: {fp}"
            actual_hash = _sha256_hex(p.read_bytes())
            if actual_hash != expected_hash:
                return False, f"File changed since attestation: {fp}"

        return True, "Attestation valid"
