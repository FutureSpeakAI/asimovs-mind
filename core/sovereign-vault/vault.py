"""
Sovereign Vault — AES-256-GCM Encrypted File Storage
Core encryption/decryption module with Argon2id key derivation.
"""

import json
import os
import hashlib
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from argon2.low_level import hash_secret_raw, Type
from cryptography.hazmat.primitives.ciphers.aead import AESGCM


# === Constants ===
VAULT_EXTENSION = ".vault"
SALT_SIZE = 32
NONCE_SIZE = 12  # 96-bit nonce for AES-GCM
KEY_SIZE = 32    # 256-bit key
ARGON2_TIME_COST = 3
ARGON2_MEMORY_COST = 65536  # 64 MiB
ARGON2_PARALLELISM = 4
DEFAULT_CATEGORIES = ["family", "coparenting", "finances", "legal"]
CONFIG_FILENAME = ".vault_config.json"


@dataclass
class VaultConfig:
    """Configuration for a Sovereign Vault instance."""
    vault_root: str
    salt_hex: str
    categories: list = field(default_factory=lambda: list(DEFAULT_CATEGORIES))
    initialized: bool = True

    @property
    def salt(self) -> bytes:
        return bytes.fromhex(self.salt_hex)

    @property
    def root_path(self) -> Path:
        return Path(self.vault_root)

    @property
    def config_path(self) -> Path:
        return self.root_path / CONFIG_FILENAME

    def save(self) -> None:
        """Persist config to disk."""
        self.config_path.write_text(json.dumps(asdict(self), indent=2), encoding="utf-8")

    @classmethod
    def load(cls, vault_root: Path) -> "VaultConfig":
        """Load config from an existing vault directory."""
        config_path = Path(vault_root) / CONFIG_FILENAME
        if not config_path.exists():
            raise FileNotFoundError(f"No vault config found at {config_path}")
        data = json.loads(config_path.read_text(encoding="utf-8"))
        return cls(**data)


def derive_master_key(password: str, salt: bytes) -> bytes:
    """
    Derive a 256-bit master key from a password using Argon2id.
    """
    return hash_secret_raw(
        secret=password.encode("utf-8"),
        salt=salt,
        time_cost=ARGON2_TIME_COST,
        memory_cost=ARGON2_MEMORY_COST,
        parallelism=ARGON2_PARALLELISM,
        hash_len=KEY_SIZE,
        type=Type.ID,
    )


def derive_sub_key(master_key: bytes, category: str) -> bytes:
    """
    Derive a category-specific 256-bit sub-key from the master key using BLAKE2b.
    """
    return hashlib.blake2b(
        master_key,
        digest_size=KEY_SIZE,
        key=category.encode("utf-8"),
    ).digest()


def encrypt_file(filepath: Path, key: bytes, remove_original: bool = True) -> Path:
    """
    Encrypt a file with AES-256-GCM.

    Returns the path to the encrypted .vault file.
    The original file is removed by default.
    """
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"File not found: {filepath}")
    if filepath.suffix == VAULT_EXTENSION:
        raise ValueError(f"File is already encrypted: {filepath}")

    plaintext = filepath.read_bytes()
    nonce = os.urandom(NONCE_SIZE)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, plaintext, None)

    # Store original filename in a header so we can restore it on decrypt
    original_name = filepath.name.encode("utf-8")
    name_len = len(original_name).to_bytes(2, "big")  # 2 bytes for name length

    vault_path = filepath.with_suffix(filepath.suffix + VAULT_EXTENSION)
    vault_path.write_bytes(name_len + original_name + nonce + ciphertext)

    if remove_original:
        filepath.unlink()

    return vault_path


def decrypt_file(filepath: Path, key: bytes, remove_vault: bool = True) -> Path:
    """
    Decrypt a .vault file with AES-256-GCM.

    Returns the path to the restored original file.
    The .vault file is removed by default.
    """
    filepath = Path(filepath)
    if not filepath.exists():
        raise FileNotFoundError(f"Vault file not found: {filepath}")
    if filepath.suffix != VAULT_EXTENSION:
        raise ValueError(f"Not a vault file: {filepath}")

    raw = filepath.read_bytes()

    # Parse header: 2-byte name length + original filename + 12-byte nonce + ciphertext
    name_len = int.from_bytes(raw[:2], "big")
    original_name = raw[2:2 + name_len].decode("utf-8")
    nonce = raw[2 + name_len:2 + name_len + NONCE_SIZE]
    ciphertext = raw[2 + name_len + NONCE_SIZE:]

    aesgcm = AESGCM(key)
    try:
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    except Exception:
        raise ValueError("Decryption failed — wrong password or corrupted file.")

    original_path = filepath.parent / original_name
    original_path.write_bytes(plaintext)

    if remove_vault:
        filepath.unlink()

    return original_path


def init_vault(vault_root: Path, password: str, categories: Optional[list] = None) -> VaultConfig:
    """
    Initialize a new Sovereign Vault at the given root directory.
    Creates config, salt, and category directories.
    """
    vault_root = Path(vault_root)
    vault_root.mkdir(parents=True, exist_ok=True)

    salt = os.urandom(SALT_SIZE)
    cats = categories or list(DEFAULT_CATEGORIES)

    config = VaultConfig(
        vault_root=str(vault_root.resolve()),
        salt_hex=salt.hex(),
        categories=cats,
    )

    # Create category directories
    for cat in cats:
        (vault_root / cat).mkdir(exist_ok=True)

    config.save()

    # Derive master key to validate password works (also warms the KDF)
    _ = derive_master_key(password, salt)

    return config


def get_category_status(vault_root: Path, category: str) -> dict:
    """
    Get the lock status of files in a category directory.
    Returns counts of locked (.vault) and unlocked files.
    """
    cat_dir = Path(vault_root) / category
    if not cat_dir.exists():
        return {"exists": False, "locked": 0, "unlocked": 0}

    locked = 0
    unlocked = 0
    for f in cat_dir.iterdir():
        if f.is_file():
            if f.suffix == VAULT_EXTENSION:
                locked += 1
            else:
                unlocked += 1

    return {"exists": True, "locked": locked, "unlocked": unlocked}


def lock_category(vault_root: Path, category: str, password: str) -> list:
    """
    Encrypt all unlocked files in a category directory.
    Returns list of encrypted file paths.
    """
    config = VaultConfig.load(vault_root)
    if category not in config.categories:
        raise ValueError(f"Unknown category: {category}")

    master_key = derive_master_key(password, config.salt)
    sub_key = derive_sub_key(master_key, category)

    cat_dir = Path(vault_root) / category
    encrypted = []

    for f in cat_dir.iterdir():
        if f.is_file() and f.suffix != VAULT_EXTENSION:
            vault_path = encrypt_file(f, sub_key)
            encrypted.append(str(vault_path))

    return encrypted


def unlock_category(vault_root: Path, category: str, password: str) -> list:
    """
    Decrypt all .vault files in a category directory.
    Returns list of restored file paths.
    """
    config = VaultConfig.load(vault_root)
    if category not in config.categories:
        raise ValueError(f"Unknown category: {category}")

    master_key = derive_master_key(password, config.salt)
    sub_key = derive_sub_key(master_key, category)

    cat_dir = Path(vault_root) / category
    decrypted = []

    for f in cat_dir.iterdir():
        if f.is_file() and f.suffix == VAULT_EXTENSION:
            original_path = decrypt_file(f, sub_key)
            decrypted.append(str(original_path))

    return decrypted


def lock_all(vault_root: Path, password: str) -> dict:
    """
    Lock all categories. Returns dict of category -> list of encrypted paths.
    """
    config = VaultConfig.load(vault_root)
    results = {}
    for cat in config.categories:
        results[cat] = lock_category(vault_root, cat, password)
    return results
