from __future__ import annotations

import io
import os
import tarfile
import tempfile
import unittest
from pathlib import Path

from _wb0_test_support import make_capsule
from mlgo_cao_v2.wb0_common import WB0IntegrityError, WB0SafetyError, sha256_file
from mlgo_cao_v2.wb0_manifest import create_deterministic_tar_gz, safe_extract_tar_gz, verify_release_capsule


class ManifestTest(unittest.TestCase):
    def test_seal_verify_tamper_and_archive_round_trip(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            manifest = verify_release_capsule(capsule)
            self.assertEqual(manifest["safe_posture"]["provider_calls_during_recovery"], 0)
            archive = create_deterministic_tar_gz(capsule, root / "capsule.tar.gz")
            extracted = safe_extract_tar_gz(archive, root / "extract")
            self.assertEqual(verify_release_capsule(extracted)["manifest_digest"], manifest["manifest_digest"])

            target = capsule / "release/lib/mlgo_cao_v2/__init__.py"
            os.chmod(target, 0o600)
            target.write_text("tampered\n")
            os.chmod(target, 0o400)
            with self.assertRaises(WB0IntegrityError):
                verify_release_capsule(capsule)

    def test_deterministic_archive_bytes_repeat(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            first = create_deterministic_tar_gz(capsule, root / "first.tar.gz")
            second = create_deterministic_tar_gz(capsule, root / "second.tar.gz")
            self.assertEqual(sha256_file(first), sha256_file(second))

    def test_archive_path_traversal_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            archive = root / "malicious.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                top = tarfile.TarInfo("capsule")
                top.type = tarfile.DIRTYPE
                tar.addfile(top)
                payload = b"escape"
                member = tarfile.TarInfo("capsule/../../escape")
                member.size = len(payload)
                tar.addfile(member, io.BytesIO(payload))
            with self.assertRaises(WB0SafetyError):
                safe_extract_tar_gz(archive, root / "extract")

    def test_archive_destination_symlink_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            archive = create_deterministic_tar_gz(capsule, root / "capsule.tar.gz")
            outside = root / "outside"
            outside.mkdir()
            os.symlink(outside, root / "extract")
            with self.assertRaises(WB0SafetyError):
                safe_extract_tar_gz(archive, root / "extract")

    def test_open_canary_is_not_a_manifest_secret_but_recovery_will_reject_it(self):
        with tempfile.TemporaryDirectory() as td:
            capsule = make_capsule(Path(td), canary_status="OPEN")
            self.assertEqual(verify_release_capsule(capsule)["secret_scan"]["status"], "PASS")


if __name__ == "__main__":
    unittest.main()
