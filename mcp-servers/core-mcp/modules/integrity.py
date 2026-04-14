"""
HMAC Integrity System — Phase 7 of Agent Friday's Core Systems
HMAC-SHA256 signing and verification for governance files.
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


class ProtectionTier(Enum):
    CORE_LAWS = 1
    IDENTITY = 2
    MEMORY = 3


@dataclass
class SignatureRecord:
    file_path: str
    hmac_hash: str
    timestamp: float
    tier: int

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SignatureRecord":
        return cls(file_path=d["file_path"], hmac_hash=d["hmac_hash"],
                   timestamp=d["timestamp"], tier=d["tier"])


@dataclass
class SafeModeState:
    triggered: bool = False
    reason: str = ""
    timestamp: float = 0.0
    restricted_actions: list[str] = field(default_factory=lambda: [
        "personality_override", "memory_write", "law_modification", "external_api_calls",
    ])

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "SafeModeState":
        return cls(**d)


def _compute_hmac(data: bytes, secret_key: str) -> str:
    return hmac.new(key=secret_key.encode("utf-8"), msg=data, digestmod=hashlib.sha256).hexdigest()


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sig_path(filepath: str | Path) -> Path:
    p = Path(filepath)
    return p.parent / (p.name + ".sig")


_ATTESTATION_TTL_SECONDS = 300


class IntegrityManager:
    def __init__(self) -> None:
        self._safe_mode = SafeModeState()
        self._manifest: dict[str, SignatureRecord] = {}

    def sign_file(self, filepath: str | Path, tier: ProtectionTier, secret_key: str) -> SignatureRecord:
        filepath = Path(filepath)
        if not filepath.is_file():
            raise FileNotFoundError(f"Cannot sign — file not found: {filepath}")
        data = filepath.read_bytes()
        mac = _compute_hmac(data, secret_key)
        now = time.time()
        record = SignatureRecord(file_path=str(filepath), hmac_hash=mac, timestamp=now, tier=tier.value)
        sig_file = _sig_path(filepath)
        sig_file.write_text(json.dumps(record.to_dict(), indent=2), encoding="utf-8")
        self._manifest[str(filepath)] = record
        return record

    def verify_file(self, filepath: str | Path, secret_key: str) -> bool:
        filepath = Path(filepath)
        sig_file = _sig_path(filepath)
        if not filepath.is_file() or not sig_file.is_file():
            return False
        try:
            record = SignatureRecord.from_dict(json.loads(sig_file.read_text(encoding="utf-8")))
        except (json.JSONDecodeError, KeyError):
            return False
        data = filepath.read_bytes()
        expected = _compute_hmac(data, secret_key)
        ok = hmac.compare_digest(expected, record.hmac_hash)
        if not ok and record.tier == ProtectionTier.CORE_LAWS.value:
            self.enter_safe_mode(f"Tier-1 Core Laws tamper detected: {filepath}")
        if str(filepath) in self._manifest and not ok:
            self._manifest[str(filepath)].hmac_hash = "TAMPERED"
        return ok

    def enter_safe_mode(self, reason: str) -> None:
        self._safe_mode = SafeModeState(triggered=True, reason=reason, timestamp=time.time())

    def exit_safe_mode(self) -> None:
        self._safe_mode = SafeModeState()

    def is_safe_mode(self) -> bool:
        return self._safe_mode.triggered

    def safe_mode_state(self) -> SafeModeState:
        return self._safe_mode

    def get_manifest(self) -> dict[str, dict]:
        return {fp: rec.to_dict() for fp, rec in self._manifest.items()}

    def save_manifest(self, filepath: str | Path) -> None:
        Path(filepath).write_text(json.dumps(self.get_manifest(), indent=2), encoding="utf-8")

    def load_manifest(self, filepath: str | Path) -> None:
        data = json.loads(Path(filepath).read_text(encoding="utf-8"))
        self._manifest = {fp: SignatureRecord.from_dict(rec) for fp, rec in data.items()}
