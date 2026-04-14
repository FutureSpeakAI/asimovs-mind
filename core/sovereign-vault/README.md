# Sovereign Vault

AES-256-GCM encrypted file storage with Argon2id key derivation. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

**Standalone repo:** [sovereign-vault](https://github.com/FutureSpeakAI/sovereign-vault)

## What It Does

Sovereign Vault encrypts sensitive files organized by category (family, coparenting, finances, legal) using military-grade cryptography. Each category gets its own derived sub-key, so compromising one category's key material doesn't expose others.

### Cryptographic Design

- **Key Derivation:** Argon2id (time=3, memory=64 MiB, parallelism=4) — resistant to GPU/ASIC attacks
- **Encryption:** AES-256-GCM — authenticated encryption with 96-bit nonces
- **Sub-Keys:** BLAKE2b keyed hash per category — deterministic, fast, isolated
- **File Format:** `[2-byte name_len][original_filename][12-byte nonce][AES-GCM ciphertext+tag]`

## Setup

```bash
cd core/sovereign-vault
python -m venv venv
venv\Scripts\pip install -r requirements.txt
```

## CLI Usage

```bash
# Initialize a vault (creates config + category directories)
python cli.py --vault-dir ./my_vault init --password <pw>

# Lock all files in a category
python cli.py --vault-dir ./my_vault lock family --password <pw>

# Unlock a category
python cli.py --vault-dir ./my_vault unlock family --password <pw>

# Check status of all categories
python cli.py --vault-dir ./my_vault status

# Lock everything at once
python cli.py --vault-dir ./my_vault lock-all --password <pw>
```

## Python API

```python
from vault import init_vault, lock_category, unlock_category, lock_all
from pathlib import Path

# Initialize
config = init_vault(Path("./my_vault"), "my_password")

# Lock/unlock individual categories
lock_category(Path("./my_vault"), "finances", "my_password")
unlock_category(Path("./my_vault"), "finances", "my_password")

# Lock everything
lock_all(Path("./my_vault"), "my_password")
```

## Running Tests

```bash
venv\Scripts\python test_vault.py
```

All 22 tests cover: key derivation, encrypt/decrypt round-trips, wrong password rejection, empty files, large binary files, error handling, vault init, category lock/unlock, status reporting, lock-all, and cross-category isolation.

## File Structure

```
friday-sovereign-vault/
├── vault.py          # Core encryption/decryption module
├── cli.py            # Click-based CLI interface
├── test_vault.py     # Comprehensive test suite (22 tests)
├── requirements.txt  # Python dependencies
├── README.md         # This file
└── venv/             # Python virtual environment
```

## Security Notes

- **No password recovery.** If you lose your password, encrypted files are unrecoverable.
- The salt is stored in `.vault_config.json` — this file is NOT secret, but back it up.
- Original files are **deleted** after encryption by default.
- The vault file format includes the original filename, so decryption restores the exact original path.
