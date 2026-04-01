"""
Vault Bridge — Python utility for hooks to read/write through the Sovereign Vault MCP Server.

The vault server exposes an HTTP bridge on localhost. The port is written to
.asimovs-mind/vault/port. This module provides simple functions that hooks can
import to swap filesystem I/O for encrypted vault storage, with graceful
fallback when the vault is unavailable or locked.

Stdlib only — no pip dependencies.
"""

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import URLError

_port_cache = None


def _find_port_file():
    """Locate .asimovs-mind/vault/port, searching cwd and parent dirs."""
    search = Path.cwd()
    for _ in range(10):  # Walk up at most 10 levels
        candidate = search / ".asimovs-mind" / "vault" / "port"
        if candidate.exists():
            return candidate
        parent = search.parent
        if parent == search:
            break
        search = parent
    return None


def _get_port():
    """Read and cache the vault HTTP bridge port."""
    global _port_cache
    if _port_cache is not None:
        return _port_cache

    port_file = _find_port_file()
    if port_file is None:
        return None

    try:
        port_str = port_file.read_text(encoding="utf-8").strip()
        port = int(port_str)
        _port_cache = port
        return port
    except (OSError, ValueError):
        return None


def _base_url():
    """Return the base URL for the vault HTTP bridge, or None."""
    port = _get_port()
    if port is None:
        return None
    return f"http://127.0.0.1:{port}"


def _get(path):
    """Issue a GET request to the vault bridge. Returns parsed JSON or None."""
    base = _base_url()
    if base is None:
        return None
    try:
        req = Request(f"{base}{path}", method="GET")
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, OSError, json.JSONDecodeError, ValueError):
        return None


def _post(path, payload):
    """Issue a POST request to the vault bridge. Returns parsed JSON or None."""
    base = _base_url()
    if base is None:
        return None
    try:
        body = json.dumps(payload).encode("utf-8")
        req = Request(
            f"{base}{path}",
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(req, timeout=5) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (URLError, OSError, json.JSONDecodeError, ValueError):
        return None


# --- Public API ---


def vault_available():
    """Return True if the vault server is reachable and unlocked."""
    try:
        status = _get("/status")
        if status is None:
            return False
        return status.get("vault") == "unlocked"
    except Exception:
        return False


def vault_status():
    """Return vault status dict, or None on failure."""
    try:
        return _get("/status")
    except Exception:
        return None


def vault_read(key):
    """Read and decrypt a named key from the vault. Returns the data or None."""
    try:
        from urllib.parse import quote
        result = _get(f"/read?key={quote(key, safe='')}")
        if result is None:
            return None
        if result.get("success"):
            return result.get("data")
        return None
    except Exception:
        return None


def vault_write(key, data):
    """Encrypt and persist data under the given key. Returns True on success."""
    try:
        result = _post("/write", {"key": key, "data": data})
        if result is None:
            return False
        return result.get("success", False)
    except Exception:
        return False


def vault_append(key, entry):
    """Append an entry to an array stored under the given key. Returns True on success."""
    try:
        result = _post("/append", {"key": key, "entry": entry})
        if result is None:
            return False
        return result.get("success", False)
    except Exception:
        return False
