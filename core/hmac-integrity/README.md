# HMAC Integrity System

HMAC-SHA256 governance file signing and verification. If someone tampers with Friday's core laws, personality, or memory files, this system detects it and degrades to safe mode rather than running compromised. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

**Standalone repo:** [agent-fridays-hmac-integrity](https://github.com/FutureSpeakAI/agent-fridays-hmac-integrity)

## Architecture

Three protection tiers based on Asimov's cLaws design:

| Tier | Name | Behavior on Tamper |
|------|------|--------------------|
| 1 | **Core Laws** | HMAC-verified against compiled source. Tampering triggers **safe mode**. |
| 2 | **Identity** | Signed after legitimate changes. External modification detected and flagged. |
| 3 | **Memory** | Signed after saves, diffed on startup. External changes surfaced to user. |

## Features

- **HMAC-SHA256 signing** of any file using `hashlib`
- **Sidecar .sig files** (JSON: hash, timestamp, tier, file_path)
- **Sign-on-save**: re-sign after legitimate modifications
- **Verify-on-load**: check signature before using any governance file
- **Tamper detection**: pinpoints which file was modified
- **Safe mode degradation**: reduces capabilities rather than crashing
- **Signature manifest**: tracks all signed files and their current state
- **Multi-agent attestation**: generate a signed snapshot (file hashes + HMAC + timestamp) that another agent can verify within a 5-minute window

## Quick Start

```bash
pip install -r requirements.txt

# Sign a file
export INTEGRITY_SECRET="your-secret-key"
python cli.py sign governance/core_laws.md --tier core

# Verify a file
python cli.py verify governance/core_laws.md

# Sign entire directory
python cli.py sign-dir governance/ --tier core

# Verify entire directory
python cli.py verify-dir governance/

# View manifest
python cli.py manifest

# Generate attestation
python cli.py attest

# Check safe mode status
python cli.py safe-mode
```

## Python API

```python
from integrity import IntegrityManager, ProtectionTier

mgr = IntegrityManager()

# Sign
mgr.sign_file("laws.md", ProtectionTier.CORE_LAWS, "secret")

# Verify (returns True/False)
mgr.verify_file("laws.md", "secret")

# Directory operations
mgr.sign_directory("governance/", ProtectionTier.CORE_LAWS, "secret")
failures = mgr.verify_directory("governance/", "secret")

# Safe mode
mgr.is_safe_mode()        # False
# ... tamper with Tier-1 file, verify fails ...
mgr.is_safe_mode()        # True
mgr.safe_mode_state()     # SafeModeState(triggered=True, reason="...", ...)

# Multi-agent attestation
att = mgr.generate_attestation("secret")
ok, reason = mgr.verify_attestation(att, "secret")

# Manifest persistence
mgr.save_manifest("manifest.json")
mgr.load_manifest("manifest.json")
```

## Testing

```bash
python -m pytest test_integrity.py -v
```

68 tests covering signing, verification, tamper detection, safe mode, directory operations, manifest persistence, attestation generation/verification/expiry, tier-specific behavior, and edge cases.

## How It Connects

This is the final layer in Agent Friday's 7-system core:

1. **Cognitive Memory** — what Friday remembers
2. **Epistemic Score** — whether the user is growing or becoming dependent
3. **Personality Evolution** — Friday's 30-trait adaptive personality
4. **Privacy Shield** — PII detection and masking
5. **Sovereign Vault** — encrypted storage with per-category access
6. **Trust Graph** — multi-dimensional trust scoring
7. **HMAC Integrity** ← *this system* — ensures none of the above can be silently corrupted
