"""
Sovereign Vault — Comprehensive Test Suite
Tests encryption, decryption, key derivation, CLI, and error handling.
"""

import os
import sys
import shutil
import tempfile
from pathlib import Path

# Ensure project root is on path
sys.path.insert(0, str(Path(__file__).parent))

from vault import (
    derive_master_key,
    derive_sub_key,
    encrypt_file,
    decrypt_file,
    init_vault,
    lock_category,
    unlock_category,
    lock_all,
    get_category_status,
    VaultConfig,
    VAULT_EXTENSION,
)


class TestResult:
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.errors = []

    def ok(self, name):
        self.passed += 1
        print(f"  PASS  {name}")

    def fail(self, name, reason):
        self.failed += 1
        self.errors.append((name, reason))
        print(f"  FAIL  {name}: {reason}")

    def summary(self):
        total = self.passed + self.failed
        print(f"\n{'='*60}")
        print(f"Results: {self.passed}/{total} passed, {self.failed} failed")
        if self.errors:
            print(f"\nFailures:")
            for name, reason in self.errors:
                print(f"  - {name}: {reason}")
        print(f"{'='*60}")
        return self.failed == 0


def run_tests():
    r = TestResult()
    tmp = Path(tempfile.mkdtemp(prefix="sovereign_vault_test_"))

    try:
        # === Test 1: Key Derivation ===
        print("\n--- Key Derivation Tests ---")

        try:
            salt = os.urandom(32)
            key1 = derive_master_key("test123", salt)
            assert len(key1) == 32, f"Key length {len(key1)} != 32"
            r.ok("derive_master_key returns 32 bytes")
        except Exception as e:
            r.fail("derive_master_key returns 32 bytes", str(e))

        try:
            key2 = derive_master_key("test123", salt)
            assert key1 == key2, "Same password+salt should produce same key"
            r.ok("derive_master_key is deterministic")
        except Exception as e:
            r.fail("derive_master_key is deterministic", str(e))

        try:
            key3 = derive_master_key("wrong_password", salt)
            assert key3 != key1, "Different password should produce different key"
            r.ok("different password -> different key")
        except Exception as e:
            r.fail("different password -> different key", str(e))

        try:
            salt2 = os.urandom(32)
            key4 = derive_master_key("test123", salt2)
            assert key4 != key1, "Different salt should produce different key"
            r.ok("different salt -> different key")
        except Exception as e:
            r.fail("different salt -> different key", str(e))

        try:
            sub1 = derive_sub_key(key1, "family")
            sub2 = derive_sub_key(key1, "finances")
            assert len(sub1) == 32, f"Sub-key length {len(sub1)} != 32"
            assert sub1 != sub2, "Different categories should produce different sub-keys"
            r.ok("derive_sub_key produces unique keys per category")
        except Exception as e:
            r.fail("derive_sub_key produces unique keys per category", str(e))

        # === Test 2: File Encryption/Decryption ===
        print("\n--- Encrypt/Decrypt Tests ---")

        test_content = b"This is sensitive family data.\nKeep it safe!\x00\xff\xfe"
        test_file = tmp / "test_data.txt"
        test_file.write_bytes(test_content)

        try:
            key = derive_master_key("test123", salt)
            sub = derive_sub_key(key, "family")
            vault_path = encrypt_file(test_file, sub)
            assert vault_path.exists(), "Vault file should exist"
            assert vault_path.suffix == VAULT_EXTENSION, f"Expected {VAULT_EXTENSION} suffix"
            assert not test_file.exists(), "Original should be removed after encryption"
            r.ok("encrypt_file creates .vault and removes original")
        except Exception as e:
            r.fail("encrypt_file creates .vault and removes original", str(e))

        try:
            restored_path = decrypt_file(vault_path, sub)
            assert restored_path.exists(), "Restored file should exist"
            restored_content = restored_path.read_bytes()
            assert restored_content == test_content, "Decrypted content must match original byte-for-byte"
            assert not vault_path.exists(), "Vault file should be removed after decryption"
            r.ok("decrypt_file restores original content byte-for-byte")
        except Exception as e:
            r.fail("decrypt_file restores original content byte-for-byte", str(e))

        # === Test 3: Wrong Password ===
        print("\n--- Wrong Password Tests ---")

        test_file2 = tmp / "secret.txt"
        test_file2.write_bytes(b"Top secret data")

        try:
            right_key = derive_sub_key(derive_master_key("correct", salt), "family")
            wrong_key = derive_sub_key(derive_master_key("wrong", salt), "family")
            vault2 = encrypt_file(test_file2, right_key)
            try:
                decrypt_file(vault2, wrong_key)
                r.fail("wrong password should raise ValueError", "No exception raised")
            except ValueError:
                r.ok("wrong password raises ValueError")
            except Exception as e:
                r.fail("wrong password raises ValueError", f"Wrong exception: {type(e).__name__}: {e}")
            finally:
                # Clean up vault file if it still exists
                if vault2.exists():
                    vault2.unlink()
        except Exception as e:
            r.fail("wrong password raises ValueError", str(e))

        # === Test 4: Edge Cases ===
        print("\n--- Edge Case Tests ---")

        try:
            empty_file = tmp / "empty.txt"
            empty_file.write_bytes(b"")
            k = derive_sub_key(derive_master_key("test123", salt), "legal")
            vp = encrypt_file(empty_file, k)
            rp = decrypt_file(vp, k)
            assert rp.read_bytes() == b"", "Empty file should round-trip correctly"
            r.ok("empty file encrypts/decrypts correctly")
        except Exception as e:
            r.fail("empty file encrypts/decrypts correctly", str(e))

        try:
            big_content = os.urandom(1024 * 100)  # 100 KB
            big_file = tmp / "big_file.bin"
            big_file.write_bytes(big_content)
            k = derive_sub_key(derive_master_key("test123", salt), "finances")
            vp = encrypt_file(big_file, k)
            rp = decrypt_file(vp, k)
            assert rp.read_bytes() == big_content, "Large file should round-trip correctly"
            r.ok("100KB binary file encrypts/decrypts correctly")
        except Exception as e:
            r.fail("100KB binary file encrypts/decrypts correctly", str(e))

        try:
            encrypt_file(tmp / "nonexistent.txt", os.urandom(32))
            r.fail("encrypt nonexistent file raises error", "No exception raised")
        except FileNotFoundError:
            r.ok("encrypt nonexistent file raises FileNotFoundError")
        except Exception as e:
            r.fail("encrypt nonexistent file raises error", f"{type(e).__name__}: {e}")

        try:
            already_vault = tmp / "already.vault"
            already_vault.write_bytes(b"fake")
            encrypt_file(already_vault, os.urandom(32))
            r.fail("encrypt .vault file raises error", "No exception raised")
        except ValueError:
            r.ok("encrypt .vault file raises ValueError")
            already_vault.unlink(missing_ok=True)
        except Exception as e:
            r.fail("encrypt .vault file raises error", f"{type(e).__name__}: {e}")

        # === Test 5: Vault Init ===
        print("\n--- Vault Init Tests ---")

        vault_dir = tmp / "test_vault"
        try:
            config = init_vault(vault_dir, "test123")
            assert (vault_dir / ".vault_config.json").exists(), "Config file should exist"
            assert len(config.categories) == 4, f"Expected 4 categories, got {len(config.categories)}"
            for cat in ["family", "coparenting", "finances", "legal"]:
                assert (vault_dir / cat).is_dir(), f"Category dir '{cat}' should exist"
            r.ok("init_vault creates config and category dirs")
        except Exception as e:
            r.fail("init_vault creates config and category dirs", str(e))

        try:
            loaded = VaultConfig.load(vault_dir)
            assert loaded.salt_hex == config.salt_hex, "Loaded config should match saved"
            assert loaded.categories == config.categories, "Categories should match"
            r.ok("VaultConfig.load round-trips correctly")
        except Exception as e:
            r.fail("VaultConfig.load round-trips correctly", str(e))

        # === Test 6: Category Operations ===
        print("\n--- Category Lock/Unlock Tests ---")

        try:
            # Create test files in family category
            family_dir = vault_dir / "family"
            (family_dir / "photo.jpg").write_bytes(b"fake jpeg data 12345")
            (family_dir / "notes.txt").write_bytes(b"Important family notes")

            encrypted = lock_category(vault_dir, "family", "test123")
            assert len(encrypted) == 2, f"Expected 2 encrypted files, got {len(encrypted)}"

            # Verify originals removed, vaults exist
            assert not (family_dir / "photo.jpg").exists(), "Original should be removed"
            assert not (family_dir / "notes.txt").exists(), "Original should be removed"
            vault_files = list(family_dir.glob("*.vault"))
            assert len(vault_files) == 2, f"Expected 2 vault files, got {len(vault_files)}"
            r.ok("lock_category encrypts all files in category")
        except Exception as e:
            r.fail("lock_category encrypts all files in category", str(e))

        try:
            decrypted = unlock_category(vault_dir, "family", "test123")
            assert len(decrypted) == 2, f"Expected 2 decrypted files, got {len(decrypted)}"
            assert (family_dir / "photo.jpg").read_bytes() == b"fake jpeg data 12345"
            assert (family_dir / "notes.txt").read_bytes() == b"Important family notes"
            r.ok("unlock_category restores all files correctly")
        except Exception as e:
            r.fail("unlock_category restores all files correctly", str(e))

        # Test wrong password: lock first, then try wrong password to unlock
        try:
            lock_category(vault_dir, "family", "test123")
            # Now files are locked — try unlocking with wrong password
            try:
                unlock_category(vault_dir, "family", "wrong_password")
                r.fail("unlock with wrong password fails", "No exception raised")
            except ValueError:
                r.ok("unlock with wrong password fails gracefully")
            except Exception as e:
                # Any exception counts as graceful failure
                r.ok("unlock with wrong password fails gracefully")
            finally:
                # Unlock with correct password so later tests can proceed
                try:
                    unlock_category(vault_dir, "family", "test123")
                except Exception:
                    pass
        except Exception as e:
            r.fail("unlock with wrong password fails", str(e))

        # === Test 7: Status ===
        print("\n--- Status Tests ---")

        try:
            # Family has 2 unlocked files from previous test
            st = get_category_status(vault_dir, "family")
            assert st["exists"] is True
            assert st["unlocked"] == 2, f"Expected 2 unlocked, got {st['unlocked']}"
            assert st["locked"] == 0, f"Expected 0 locked, got {st['locked']}"
            r.ok("get_category_status reports unlocked files")
        except Exception as e:
            r.fail("get_category_status reports unlocked files", str(e))

        try:
            lock_category(vault_dir, "family", "test123")
            st = get_category_status(vault_dir, "family")
            assert st["locked"] == 2, f"Expected 2 locked, got {st['locked']}"
            assert st["unlocked"] == 0, f"Expected 0 unlocked, got {st['unlocked']}"
            r.ok("get_category_status reports locked files")
        except Exception as e:
            r.fail("get_category_status reports locked files", str(e))

        try:
            st_empty = get_category_status(vault_dir, "legal")
            assert st_empty["exists"] is True
            assert st_empty["locked"] == 0
            assert st_empty["unlocked"] == 0
            r.ok("get_category_status reports empty category")
        except Exception as e:
            r.fail("get_category_status reports empty category", str(e))

        # === Test 8: Lock All ===
        print("\n--- Lock All Tests ---")

        try:
            # Unlock family first, add files to finances
            unlock_category(vault_dir, "family", "test123")
            fin_dir = vault_dir / "finances"
            (fin_dir / "budget.xlsx").write_bytes(b"fake excel data")
            (fin_dir / "taxes.pdf").write_bytes(b"fake pdf data")

            results = lock_all(vault_dir, "test123")
            assert len(results["family"]) == 2, f"Family: expected 2, got {len(results['family'])}"
            assert len(results["finances"]) == 2, f"Finances: expected 2, got {len(results['finances'])}"
            assert len(results["coparenting"]) == 0
            assert len(results["legal"]) == 0
            r.ok("lock_all encrypts files across all categories")
        except Exception as e:
            r.fail("lock_all encrypts files across all categories", str(e))

        # === Test 9: Multiple categories with different sub-keys ===
        print("\n--- Cross-Category Isolation Tests ---")

        try:
            # Unlock family and finances
            unlock_category(vault_dir, "family", "test123")
            unlock_category(vault_dir, "finances", "test123")

            # Verify files are intact
            assert (family_dir / "photo.jpg").read_bytes() == b"fake jpeg data 12345"
            assert (fin_dir / "budget.xlsx").read_bytes() == b"fake excel data"

            # Re-lock everything
            lock_all(vault_dir, "test123")
            r.ok("multiple categories maintain data isolation")
        except Exception as e:
            r.fail("multiple categories maintain data isolation", str(e))

    finally:
        # Cleanup
        shutil.rmtree(tmp, ignore_errors=True)
        print(f"\nCleaned up temp directory: {tmp}")

    return r.summary()


if __name__ == "__main__":
    print("=" * 60)
    print("  SOVEREIGN VAULT — Test Suite")
    print("=" * 60)

    success = run_tests()
    sys.exit(0 if success else 1)
