from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from _wb0_test_support import SOURCE_CAO_ROOT
from mlgo_cao_v2.wb0_bootstrap import build_bootstrap_bundle, verify_bootstrap_bundle
from mlgo_cao_v2.wb0_common import WB0IntegrityError, sha256_file


class BootstrapTests(unittest.TestCase):
    def test_build_is_self_contained_and_tamper_evident(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            first = root / "bootstrap-a"
            second = root / "bootstrap-b"
            result = build_bootstrap_bundle(
                source_cao_root=SOURCE_CAO_ROOT, output_directory=first
            )
            self.assertFalse(result["verification"]["provider_code_included"])
            self.assertTrue((first / "bin/mlgo-v2-wb0").is_file())
            build_bootstrap_bundle(source_cao_root=SOURCE_CAO_ROOT, output_directory=second)
            self.assertEqual(
                sha256_file(first / "bootstrap-manifest.json"),
                sha256_file(second / "bootstrap-manifest.json"),
            )
            target = first / "lib/mlgo_cao_v2/wb0_common.py"
            target.chmod(0o644)
            target.write_text(target.read_text() + "\n# tampered\n", encoding="utf-8")
            with self.assertRaises(WB0IntegrityError):
                verify_bootstrap_bundle(first)


if __name__ == "__main__":
    unittest.main()
