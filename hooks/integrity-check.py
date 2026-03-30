#!/usr/bin/env python3
"""
SessionStart hook: HMAC verification of governance files.

Verifies that governance files have not been tampered with by computing
HMAC-SHA256 hashes and comparing against the signed manifest created
during federation initialization. This is tampering DETECTION — it
alerts the user but does not prevent session start.

Hook event: SessionStart
"""

import hashlib
import hmac
import json
import os
import platform
import sys
from pathlib import Path

ASIMOVS_DIR = Path(".asimovs-mind")
MANIFEST_FILE = ASIMOVS_DIR / "governance-manifest.json"
SALT_FILE = ASIMOVS_DIR / ".salt"
PLUGIN_ROOT = Path(os.environ.get("CLAUDE_PLUGIN_ROOT", Path(__file__).parent.parent))


def derive_hmac_key():
    """Derive the HMAC key from hostname + project path + salt."""
    hostname = platform.node()
    project_path = str(Path.cwd().resolve())

    salt = ""
    if SALT_FILE.exists():
        try:
            salt = SALT_FILE.read_text(encoding="utf-8").strip()
        except OSError:
            pass

    key_material = f"{hostname}:{project_path}:{salt}"
    return hashlib.sha256(key_material.encode("utf-8")).digest()


def compute_file_hmac(file_path, key):
    """Compute HMAC-SHA256 for a file."""
    try:
        content = file_path.read_bytes()
        return hmac.new(key, content, hashlib.sha256).hexdigest()
    except OSError:
        return None


def main():
    # If no manifest exists, not yet federated — skip silently
    if not MANIFEST_FILE.exists():
        sys.exit(0)

    try:
        manifest = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        # Can't read manifest — skip rather than block
        sys.exit(0)

    files = manifest.get("files", {})
    if not files:
        sys.exit(0)

    key = derive_hmac_key()
    mismatches = []

    for relative_path, expected_hash in files.items():
        # Governance files are relative to the plugin root
        file_path = PLUGIN_ROOT / relative_path
        if not file_path.exists():
            mismatches.append((relative_path, "file missing"))
            continue

        actual_hash = compute_file_hmac(file_path, key)
        if actual_hash is None:
            mismatches.append((relative_path, "unreadable"))
            continue

        if not hmac.compare_digest(actual_hash, expected_hash):
            mismatches.append((relative_path, "hash mismatch"))

    if mismatches:
        for name, reason in mismatches:
            print(f"WARNING: Governance file {name} has been modified externally ({reason}). Safe mode recommended.")
    else:
        print("Governance integrity: verified")

    sys.exit(0)


if __name__ == "__main__":
    main()
