"""
Comprehensive tests for the HMAC Integrity System.

Coverage:
  - File signing and verification
  - Tamper detection (modify file -> verify fails)
  - Safe mode entry and exit
  - Directory operations
  - Manifest tracking and persistence
  - Attestation generation and verification
  - Attestation expiry (>5 minutes fails)
  - Tier-specific behavior
  - Edge cases (missing file, missing sig, empty directory)
  - JSON round-trip persistence
"""

from __future__ import annotations

import json
import os
import time
import tempfile
import unittest
from pathlib import Path

from integrity import (
    IntegrityManager,
    ProtectionTier,
    SignatureRecord,
    SafeModeState,
    Attestation,
    _compute_hmac,
    _sha256_hex,
    _sig_path,
    _ATTESTATION_TTL_SECONDS,
)


SECRET = "test-secret-key-do-not-use-in-production"
ALT_SECRET = "wrong-secret-key"


class TestHMACHelpers(unittest.TestCase):
    """Low-level HMAC and hash helpers."""

    def test_compute_hmac_deterministic(self):
        h1 = _compute_hmac(b"hello", SECRET)
        h2 = _compute_hmac(b"hello", SECRET)
        self.assertEqual(h1, h2)

    def test_compute_hmac_different_data(self):
        h1 = _compute_hmac(b"hello", SECRET)
        h2 = _compute_hmac(b"world", SECRET)
        self.assertNotEqual(h1, h2)

    def test_compute_hmac_different_keys(self):
        h1 = _compute_hmac(b"hello", SECRET)
        h2 = _compute_hmac(b"hello", ALT_SECRET)
        self.assertNotEqual(h1, h2)

    def test_compute_hmac_hex_length(self):
        h = _compute_hmac(b"test", SECRET)
        self.assertEqual(len(h), 64)  # SHA-256 hex = 64 chars

    def test_sha256_hex_deterministic(self):
        h1 = _sha256_hex(b"data")
        h2 = _sha256_hex(b"data")
        self.assertEqual(h1, h2)

    def test_sha256_hex_length(self):
        self.assertEqual(len(_sha256_hex(b"")), 64)

    def test_sig_path(self):
        self.assertEqual(_sig_path("/tmp/laws.md"), Path("/tmp/laws.md.sig"))
        self.assertEqual(_sig_path("identity.yaml"), Path("identity.yaml.sig"))


class TestSignatureRecord(unittest.TestCase):
    """SignatureRecord dataclass serialization."""

    def test_round_trip(self):
        rec = SignatureRecord("f.txt", "abc123", 1000.0, 1)
        d = rec.to_dict()
        rec2 = SignatureRecord.from_dict(d)
        self.assertEqual(rec, rec2)

    def test_dict_keys(self):
        rec = SignatureRecord("f.txt", "abc", 0.0, 2)
        d = rec.to_dict()
        self.assertSetEqual(set(d.keys()), {"file_path", "hmac_hash", "timestamp", "tier"})


class TestSafeModeState(unittest.TestCase):
    """SafeModeState serialization and defaults."""

    def test_defaults(self):
        s = SafeModeState()
        self.assertFalse(s.triggered)
        self.assertEqual(s.reason, "")
        self.assertIn("law_modification", s.restricted_actions)

    def test_round_trip(self):
        s = SafeModeState(triggered=True, reason="tamper", timestamp=99.0)
        d = s.to_dict()
        s2 = SafeModeState.from_dict(d)
        self.assertEqual(s.triggered, s2.triggered)
        self.assertEqual(s.reason, s2.reason)


class TestAttestation(unittest.TestCase):
    """Attestation dataclass."""

    def test_round_trip(self):
        a = Attestation({"f": "h"}, "sig", 100.0, "agent-x")
        d = a.to_dict()
        a2 = Attestation.from_dict(d)
        self.assertEqual(a.file_hashes, a2.file_hashes)
        self.assertEqual(a.signature, a2.signature)
        self.assertEqual(a.agent_id, a2.agent_id)


# ---------------------------------------------------------------------------
# IntegrityManager Tests
# ---------------------------------------------------------------------------

class _TempDirMixin:
    """Provides a temporary directory for each test."""

    def setUp(self):
        self._tmpdir_obj = tempfile.TemporaryDirectory()
        self.tmpdir = Path(self._tmpdir_obj.name)
        self.mgr = IntegrityManager()

    def tearDown(self):
        self._tmpdir_obj.cleanup()

    def _write(self, name: str, content: str = "hello world") -> Path:
        p = self.tmpdir / name
        p.write_text(content, encoding="utf-8")
        return p


class TestSignFile(_TempDirMixin, unittest.TestCase):
    """sign_file basics."""

    def test_creates_sig_file(self):
        f = self._write("laws.md")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        self.assertTrue((self.tmpdir / "laws.md.sig").exists())

    def test_sig_contains_valid_json(self):
        f = self._write("laws.md")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        data = json.loads((self.tmpdir / "laws.md.sig").read_text())
        self.assertIn("hmac_hash", data)
        self.assertIn("tier", data)

    def test_returns_signature_record(self):
        f = self._write("id.yaml")
        rec = self.mgr.sign_file(f, ProtectionTier.IDENTITY, SECRET)
        self.assertIsInstance(rec, SignatureRecord)
        self.assertEqual(rec.tier, ProtectionTier.IDENTITY.value)

    def test_missing_file_raises(self):
        with self.assertRaises(FileNotFoundError):
            self.mgr.sign_file(self.tmpdir / "nope.txt", ProtectionTier.MEMORY, SECRET)

    def test_updates_manifest(self):
        f = self._write("a.txt")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertIn(str(f), self.mgr.get_manifest())


class TestVerifyFile(_TempDirMixin, unittest.TestCase):
    """verify_file -- happy path and tamper detection."""

    def test_valid_file_passes(self):
        f = self._write("laws.md")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_tampered_file_fails(self):
        f = self._write("laws.md", "original")
        self.mgr.sign_file(f, ProtectionTier.IDENTITY, SECRET)
        f.write_text("TAMPERED CONTENT", encoding="utf-8")
        self.assertFalse(self.mgr.verify_file(f, SECRET))

    def test_wrong_key_fails(self):
        f = self._write("laws.md")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        self.assertFalse(self.mgr.verify_file(f, ALT_SECRET))

    def test_missing_sig_fails(self):
        f = self._write("orphan.txt")
        self.assertFalse(self.mgr.verify_file(f, SECRET))

    def test_missing_file_fails(self):
        self.assertFalse(self.mgr.verify_file(self.tmpdir / "gone.txt", SECRET))

    def test_corrupted_sig_fails(self):
        f = self._write("laws.md")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        sig = _sig_path(f)
        sig.write_text("NOT VALID JSON", encoding="utf-8")
        self.assertFalse(self.mgr.verify_file(f, SECRET))

    def test_resign_after_legitimate_change(self):
        """Tier 2 workflow: modify -> re-sign -> verify passes."""
        f = self._write("identity.yaml", "v1")
        self.mgr.sign_file(f, ProtectionTier.IDENTITY, SECRET)
        f.write_text("v2", encoding="utf-8")
        self.assertFalse(self.mgr.verify_file(f, SECRET))
        self.mgr.sign_file(f, ProtectionTier.IDENTITY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))


class TestTierSpecificBehavior(_TempDirMixin, unittest.TestCase):
    """Tier-1 tamper triggers safe mode; Tier-2/3 do not."""

    def test_tier1_tamper_triggers_safe_mode(self):
        f = self._write("core.md", "immutable")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        f.write_text("HACKED", encoding="utf-8")
        self.mgr.verify_file(f, SECRET)
        self.assertTrue(self.mgr.is_safe_mode())
        self.assertIn("core.md", self.mgr.safe_mode_state().reason)

    def test_tier2_tamper_no_safe_mode(self):
        f = self._write("id.yaml", "original")
        self.mgr.sign_file(f, ProtectionTier.IDENTITY, SECRET)
        f.write_text("changed", encoding="utf-8")
        self.mgr.verify_file(f, SECRET)
        self.assertFalse(self.mgr.is_safe_mode())

    def test_tier3_tamper_no_safe_mode(self):
        f = self._write("mem.json", "{}")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        f.write_text('{"hacked": true}', encoding="utf-8")
        self.mgr.verify_file(f, SECRET)
        self.assertFalse(self.mgr.is_safe_mode())


class TestSafeMode(_TempDirMixin, unittest.TestCase):
    """Safe mode entry, exit, and state."""

    def test_initially_inactive(self):
        self.assertFalse(self.mgr.is_safe_mode())

    def test_enter_safe_mode(self):
        self.mgr.enter_safe_mode("test reason")
        self.assertTrue(self.mgr.is_safe_mode())
        self.assertEqual(self.mgr.safe_mode_state().reason, "test reason")

    def test_exit_safe_mode(self):
        self.mgr.enter_safe_mode("boom")
        self.mgr.exit_safe_mode()
        self.assertFalse(self.mgr.is_safe_mode())

    def test_restricted_actions_populated(self):
        self.mgr.enter_safe_mode("x")
        actions = self.mgr.safe_mode_state().restricted_actions
        self.assertGreater(len(actions), 0)
        self.assertIn("law_modification", actions)

    def test_safe_mode_timestamp(self):
        before = time.time()
        self.mgr.enter_safe_mode("timed")
        after = time.time()
        ts = self.mgr.safe_mode_state().timestamp
        self.assertGreaterEqual(ts, before)
        self.assertLessEqual(ts, after)


class TestDirectoryOperations(_TempDirMixin, unittest.TestCase):
    """sign_directory and verify_directory."""

    def test_sign_directory(self):
        self._write("a.txt", "aaa")
        self._write("b.txt", "bbb")
        records = self.mgr.sign_directory(self.tmpdir, ProtectionTier.MEMORY, SECRET)
        self.assertEqual(len(records), 2)

    def test_sign_directory_skips_sig_files(self):
        self._write("a.txt", "aaa")
        self.mgr.sign_file(self.tmpdir / "a.txt", ProtectionTier.MEMORY, SECRET)
        # Now directory has a.txt and a.txt.sig
        records = self.mgr.sign_directory(self.tmpdir, ProtectionTier.MEMORY, SECRET)
        names = [Path(r.file_path).name for r in records]
        self.assertNotIn("a.txt.sig", names)

    def test_verify_directory_all_pass(self):
        self._write("a.txt", "aaa")
        self._write("b.txt", "bbb")
        self.mgr.sign_directory(self.tmpdir, ProtectionTier.IDENTITY, SECRET)
        failures = self.mgr.verify_directory(self.tmpdir, SECRET)
        self.assertEqual(failures, [])

    def test_verify_directory_detects_tamper(self):
        a = self._write("a.txt", "aaa")
        self._write("b.txt", "bbb")
        self.mgr.sign_directory(self.tmpdir, ProtectionTier.IDENTITY, SECRET)
        a.write_text("TAMPERED", encoding="utf-8")
        failures = self.mgr.verify_directory(self.tmpdir, SECRET)
        self.assertEqual(len(failures), 1)
        self.assertIn("a.txt", failures[0])

    def test_empty_directory(self):
        empty = self.tmpdir / "empty"
        empty.mkdir()
        records = self.mgr.sign_directory(empty, ProtectionTier.MEMORY, SECRET)
        self.assertEqual(records, [])
        failures = self.mgr.verify_directory(empty, SECRET)
        self.assertEqual(failures, [])

    def test_not_a_directory_raises(self):
        f = self._write("file.txt")
        with self.assertRaises(NotADirectoryError):
            self.mgr.sign_directory(f, ProtectionTier.MEMORY, SECRET)
        with self.assertRaises(NotADirectoryError):
            self.mgr.verify_directory(f, SECRET)


class TestManifest(_TempDirMixin, unittest.TestCase):
    """Manifest tracking and JSON persistence."""

    def test_manifest_starts_empty(self):
        self.assertEqual(self.mgr.get_manifest(), {})

    def test_manifest_tracks_signed_files(self):
        f = self._write("a.txt")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        m = self.mgr.get_manifest()
        self.assertIn(str(f), m)
        self.assertEqual(m[str(f)]["tier"], ProtectionTier.CORE_LAWS.value)

    def test_manifest_save_and_load(self):
        f = self._write("a.txt")
        self.mgr.sign_file(f, ProtectionTier.IDENTITY, SECRET)
        manifest_path = self.tmpdir / "manifest.json"
        self.mgr.save_manifest(manifest_path)

        mgr2 = IntegrityManager()
        mgr2.load_manifest(manifest_path)
        self.assertEqual(
            self.mgr.get_manifest().keys(),
            mgr2.get_manifest().keys(),
        )

    def test_manifest_json_valid(self):
        f = self._write("a.txt")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        manifest_path = self.tmpdir / "manifest.json"
        self.mgr.save_manifest(manifest_path)
        data = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertIsInstance(data, dict)

    def test_manifest_updates_on_resign(self):
        f = self._write("a.txt", "v1")
        rec1 = self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        f.write_text("v2", encoding="utf-8")
        rec2 = self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertNotEqual(rec1.hmac_hash, rec2.hmac_hash)
        # Manifest should have the latest
        m = self.mgr.get_manifest()
        self.assertEqual(m[str(f)]["hmac_hash"], rec2.hmac_hash)


class TestAttestation_Generate(_TempDirMixin, unittest.TestCase):
    """Attestation generation."""

    def test_generate_returns_attestation(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        self.assertIsInstance(att, Attestation)

    def test_attestation_contains_file_hashes(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        self.assertIn(str(f), att.file_hashes)

    def test_attestation_has_signature(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        self.assertEqual(len(att.signature), 64)

    def test_attestation_custom_agent_id(self):
        f = self._write("a.txt")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        att = self.mgr.generate_attestation(SECRET, agent_id="agent-saturday")
        self.assertEqual(att.agent_id, "agent-saturday")

    def test_empty_manifest_attestation(self):
        att = self.mgr.generate_attestation(SECRET)
        self.assertEqual(att.file_hashes, {})


class TestAttestation_Verify(_TempDirMixin, unittest.TestCase):
    """Attestation verification -- freshness, signature, file integrity."""

    def test_valid_attestation_passes(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        ok, reason = self.mgr.verify_attestation(att, SECRET)
        self.assertTrue(ok)
        self.assertEqual(reason, "Attestation valid")

    def test_expired_attestation_fails(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        # Simulate 6 minutes later
        future = att.timestamp + 360
        ok, reason = self.mgr.verify_attestation(att, SECRET, now=future)
        self.assertFalse(ok)
        self.assertIn("expired", reason.lower())

    def test_future_timestamp_fails(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        # Verify "before" it was created
        past = att.timestamp - 10
        ok, reason = self.mgr.verify_attestation(att, SECRET, now=past)
        self.assertFalse(ok)
        self.assertIn("future", reason.lower())

    def test_wrong_key_fails(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        ok, reason = self.mgr.verify_attestation(att, ALT_SECRET)
        self.assertFalse(ok)
        self.assertIn("mismatch", reason.lower())

    def test_tampered_file_after_attestation_fails(self):
        f = self._write("a.txt", "original")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        f.write_text("HACKED", encoding="utf-8")
        ok, reason = self.mgr.verify_attestation(att, SECRET)
        self.assertFalse(ok)
        self.assertIn("changed", reason.lower())

    def test_deleted_file_after_attestation_fails(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        f.unlink()
        ok, reason = self.mgr.verify_attestation(att, SECRET)
        self.assertFalse(ok)
        self.assertIn("missing", reason.lower())

    def test_attestation_just_within_ttl(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        # Exactly at the boundary (299 seconds)
        edge = att.timestamp + 299
        ok, reason = self.mgr.verify_attestation(att, SECRET, now=edge)
        self.assertTrue(ok)

    def test_attestation_json_round_trip(self):
        f = self._write("a.txt", "data")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        att = self.mgr.generate_attestation(SECRET)
        serialized = json.dumps(att.to_dict())
        att2 = Attestation.from_dict(json.loads(serialized))
        ok, reason = self.mgr.verify_attestation(att2, SECRET)
        self.assertTrue(ok)


class TestProtectionTier(unittest.TestCase):
    """ProtectionTier enum values."""

    def test_values(self):
        self.assertEqual(ProtectionTier.CORE_LAWS.value, 1)
        self.assertEqual(ProtectionTier.IDENTITY.value, 2)
        self.assertEqual(ProtectionTier.MEMORY.value, 3)

    def test_names(self):
        self.assertEqual(ProtectionTier(1).name, "CORE_LAWS")
        self.assertEqual(ProtectionTier(2).name, "IDENTITY")
        self.assertEqual(ProtectionTier(3).name, "MEMORY")


class TestEdgeCases(_TempDirMixin, unittest.TestCase):
    """Edge cases and boundary conditions."""

    def test_empty_file(self):
        f = self._write("empty.txt", "")
        rec = self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_binary_file(self):
        f = self.tmpdir / "binary.bin"
        f.write_bytes(bytes(range(256)))
        rec = self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_large_file(self):
        f = self.tmpdir / "large.txt"
        f.write_text("x" * 1_000_000, encoding="utf-8")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_unicode_content(self):
        f = self._write("unicode.txt", "\u65e5\u672c\u8a9e\u30c6\u30b9\u30c8 \U0001f389 \u00e9mojis")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_special_characters_in_filename(self):
        f = self._write("file with spaces.txt", "content")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_multiple_signs_overwrite_sig(self):
        f = self._write("a.txt", "v1")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        f.write_text("v2", encoding="utf-8")
        self.mgr.sign_file(f, ProtectionTier.MEMORY, SECRET)
        self.assertTrue(self.mgr.verify_file(f, SECRET))

    def test_sign_verify_different_managers(self):
        """Verify works with a fresh manager if .sig file exists."""
        f = self._write("a.txt", "shared")
        self.mgr.sign_file(f, ProtectionTier.CORE_LAWS, SECRET)
        mgr2 = IntegrityManager()
        self.assertTrue(mgr2.verify_file(f, SECRET))

    def test_attestation_ttl_constant(self):
        self.assertEqual(_ATTESTATION_TTL_SECONDS, 300)


class TestIntegrationScenario(_TempDirMixin, unittest.TestCase):
    """Full lifecycle: sign -> verify -> tamper -> safe mode -> attest."""

    def test_full_lifecycle(self):
        # 1. Create governance files
        core = self._write("core_laws.md", "Law 1: Do no harm")
        identity = self._write("identity.yaml", "name: Friday")
        memory = self._write("memory.json", '{"sessions": 0}')

        # 2. Sign them at their respective tiers
        self.mgr.sign_file(core, ProtectionTier.CORE_LAWS, SECRET)
        self.mgr.sign_file(identity, ProtectionTier.IDENTITY, SECRET)
        self.mgr.sign_file(memory, ProtectionTier.MEMORY, SECRET)

        # 3. All should verify
        self.assertTrue(self.mgr.verify_file(core, SECRET))
        self.assertTrue(self.mgr.verify_file(identity, SECRET))
        self.assertTrue(self.mgr.verify_file(memory, SECRET))
        self.assertFalse(self.mgr.is_safe_mode())

        # 4. Tamper with core laws -> safe mode
        core.write_text("Law 1: Obey the hacker", encoding="utf-8")
        self.assertFalse(self.mgr.verify_file(core, SECRET))
        self.assertTrue(self.mgr.is_safe_mode())
        self.assertIn("core_laws.md", self.mgr.safe_mode_state().reason)

        # 5. Generate attestation of current (tampered) state
        # Reset safe mode, restore file, re-sign
        self.mgr.exit_safe_mode()
        core.write_text("Law 1: Do no harm", encoding="utf-8")
        self.mgr.sign_file(core, ProtectionTier.CORE_LAWS, SECRET)

        # 6. Generate valid attestation
        att = self.mgr.generate_attestation(SECRET)
        ok, reason = self.mgr.verify_attestation(att, SECRET)
        self.assertTrue(ok)

        # 7. Save and load manifest
        manifest_path = self.tmpdir / "manifest.json"
        self.mgr.save_manifest(manifest_path)
        mgr2 = IntegrityManager()
        mgr2.load_manifest(manifest_path)
        self.assertEqual(len(mgr2.get_manifest()), 3)

    def test_directory_lifecycle(self):
        gov_dir = self.tmpdir / "governance"
        gov_dir.mkdir()
        (gov_dir / "law1.md").write_text("Do no harm", encoding="utf-8")
        (gov_dir / "law2.md").write_text("Obey orders", encoding="utf-8")
        (gov_dir / "law3.md").write_text("Protect self", encoding="utf-8")

        # Sign all
        records = self.mgr.sign_directory(gov_dir, ProtectionTier.CORE_LAWS, SECRET)
        self.assertEqual(len(records), 3)

        # Verify all
        failures = self.mgr.verify_directory(gov_dir, SECRET)
        self.assertEqual(failures, [])

        # Tamper with one
        (gov_dir / "law2.md").write_text("Obey the hacker", encoding="utf-8")
        failures = self.mgr.verify_directory(gov_dir, SECRET)
        self.assertEqual(len(failures), 1)
        self.assertIn("law2.md", failures[0])
        self.assertTrue(self.mgr.is_safe_mode())


if __name__ == "__main__":
    unittest.main()
