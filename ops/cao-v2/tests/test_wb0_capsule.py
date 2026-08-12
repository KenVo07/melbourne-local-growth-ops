from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from _wb0_test_support import SOURCE_CAO_ROOT, populate_capsule_payload
from mlgo_cao_v2.wb0_capsule import capture_golden_capsule, validate_capture_spec
from mlgo_cao_v2.wb0_common import WB0SafetyError
from mlgo_cao_v2.wb0_manifest import verify_release_capsule


class CapsuleCaptureTest(unittest.TestCase):
    def _git(self, repo: Path, *args: str) -> str:
        proc = subprocess.run(
            ["git", "-C", str(repo), *args],
            text=True,
            capture_output=True,
            check=True,
        )
        return proc.stdout.strip()

    def _fixture(self, root: Path) -> tuple[Path, Path, dict]:
        repo = root / "repo"
        repo.mkdir()
        self._git(repo, "init", "-q")
        self._git(repo, "config", "user.name", "WB0 Test")
        self._git(repo, "config", "user.email", "wb0@example.invalid")
        source_file = repo / "ops/cao-v2/runtime.py"
        source_file.parent.mkdir(parents=True)
        source_file.write_text("VALUE = 1\n")
        self._git(repo, "add", ".")
        self._git(repo, "commit", "-qm", "fixture")
        commit = self._git(repo, "rev-parse", "HEAD")

        payload = root / "inventory/payload"
        populate_capsule_payload(payload)
        bootstrap = payload / "bootstrap"

        entries = [
            (repo / "ops/cao-v2", "release/evidence/source/ops/cao-v2", "tracked_source", "clean tracked source"),
            (payload / "release/lib", "release/lib", "installed_runtime", "exact installed Python runtime"),
            (payload / "release/bin", "release/bin", "runtime_launcher", "exact installed CAO launchers"),
            (payload / "release/share/registry", "release/share/registry", "runtime_registry", "provider registry"),
            (payload / "release/share/schemas", "release/share/schemas", "runtime_schema", "runtime schemas"),
            (payload / "release/share/examples", "release/share/examples", "runtime_example", "runtime examples"),
            (payload / "release/share/profile-sources", "release/share/profile-sources", "runtime_profile_source", "profile sources"),
            (payload / "release/share/skills/canonical-skill-bundles.lock.json", "release/share/skills/canonical-skill-bundles.lock.json", "skill_lock", "active canonical lock"),
            (payload / "config", "config", "non_secret_config", "non-secret config"),
            (payload / "services", "services", "service_definition", "service definitions"),
            (payload / "skills/lock/canonical-skill-bundles.lock.json", "skills/lock/canonical-skill-bundles.lock.json", "skill_lock", "evidence canonical lock"),
            (payload / "skills/sealed/skill-cache", "skills/sealed/skill-cache", "sealed_skill", "sealed skill objects and manifests"),
            (payload / "skills/native-mirror", "skills/native-mirror", "native_skill_mirror", "canonical native mirror evidence"),
            (payload / "recovery/state-seed", "recovery/state-seed", "recovery_state_seed", "control state seed"),
            (bootstrap, "bootstrap", "recovery_tool", "self-contained WB-0 bootstrap"),
        ]
        spec = {
            "schema_version": "1.0",
            "release_id": "fixture-release",
            "source_commit": commit,
            "source_checkout": str(repo),
            "runtime_version": "fixture",
            "created_at": "2026-08-10T00:00:00Z",
            "entries": [
                {
                    "source": str(source),
                    "destination": destination,
                    "category": category,
                    "required": True,
                    "allow_symlink": False,
                    "description": description,
                }
                for source, destination, category, description in entries
            ],
            "state_contract": {
                "golden_state_is_immutable": True,
                "reverse_migration_allowed": False,
                "state_schema_id": "mlgo-cao-v2-control-state",
                "state_schema_version": "2.1",
                "writable_recovery_clone_required": True,
            },
            "skill_contract": {
                "sealed_bytes_required": True,
                "canonical_lock_required": True,
                "mirror_must_be_digest_equivalent": True,
                "new_skill_sources_allowed": False,
            },
        }
        return repo, source_file, spec

    def test_explicit_clean_git_capture_is_non_destructive_and_recovery_ready(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _, source_file, spec = self._fixture(root)
            before = source_file.read_bytes()
            output = root / "golden"
            result = capture_golden_capsule(spec=spec, output_directory=output)
            self.assertFalse(result["live_host_mutated"])
            self.assertEqual(source_file.read_bytes(), before)
            manifest = verify_release_capsule(output)
            self.assertEqual(manifest["source_commit"], spec["source_commit"])
            self.assertEqual(manifest["skill_verification"]["selected_skill_count"], 1)
            self.assertTrue((output / "release/lib/mlgo_cao_v2").is_dir())
            self.assertTrue((output / "release/bin/mlgo-v2").is_file())

    def test_tracked_source_must_be_inside_verified_checkout_and_canonical_path(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            repo, _, spec = self._fixture(root)
            unrelated = root / "unrelated-staging/ops/cao-v2"
            unrelated.mkdir(parents=True)
            (unrelated / "runtime.py").write_text("VALUE = 999\n")
            tracked = next(
                entry for entry in spec["entries"]
                if entry["destination"] == "release/evidence/source/ops/cao-v2"
            )
            tracked["source"] = str(unrelated)
            with self.assertRaises(WB0SafetyError):
                validate_capture_spec(spec)
            tracked["source"] = str(repo)
            with self.assertRaises(WB0SafetyError):
                validate_capture_spec(spec)

            # A lexical path inside the verified checkout must not be allowed to
            # escape through a symlink to unrelated staging bytes.
            escape = repo / "staged-source"
            escape.symlink_to(unrelated, target_is_directory=True)
            tracked["source"] = str(escape)
            tracked["destination"] = "release/evidence/source/extra"
            with self.assertRaises(WB0SafetyError):
                validate_capture_spec(spec)

    def test_secret_store_filename_fails_capture(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _, _, spec = self._fixture(root)
            config_source = Path(
                next(entry["source"] for entry in spec["entries"] if entry["destination"] == "config")
            )
            (config_source / ".env").write_text("NOT_A_REAL_SECRET=fixture\n")
            with self.assertRaises(WB0SafetyError):
                capture_golden_capsule(spec=spec, output_directory=root / "bad")

    def test_relative_symlink_that_escapes_capsule_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            _, _, spec = self._fixture(root)
            config_entry = next(
                entry for entry in spec["entries"] if entry["destination"] == "config"
            )
            source = Path(config_entry["source"])
            os.symlink("../../outside", source / "escape")
            config_entry["allow_symlink"] = True
            with self.assertRaises(WB0SafetyError):
                capture_golden_capsule(spec=spec, output_directory=root / "bad-symlink")


if __name__ == "__main__":
    unittest.main()
