from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class InstallerStagingTest(unittest.TestCase):
    def run_plan(self, *args):
        return subprocess.run([str(ROOT / "install.sh"), *args], text=True, capture_output=True)

    def test_stage_only_dry_run_is_additive(self):
        process = self.run_plan("--stage-only", "--dry-run")
        self.assertEqual(process.returncode, 0, process.stderr)
        self.assertIn("PRESERVE     " + str(Path.home() / ".config/mlgo-cao/profiles"), process.stdout)
        self.assertIn("all running services", process.stdout)

    def test_runtime_and_profiles_are_separate_activation_phases(self):
        runtime = self.run_plan("--activate-runtime", "--dry-run")
        profiles = self.run_plan("--activate-profiles", "--dry-run")
        self.assertIn("cao-policy.json", runtime.stdout)
        self.assertNotIn("mlgo-supervise", runtime.stdout)
        self.assertIn("mlgo-supervise", profiles.stdout)
        self.assertNotIn("START        mlgo-cao-v2-controller", profiles.stdout)

    def test_mutation_requires_apply(self):
        process = self.run_plan("--stage-only")
        self.assertNotEqual(process.returncode, 0)

    def test_installed_verification_failure_rolls_back_before_applied_record(self):
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            fixture = tmp / "cao-v2"
            shutil.copytree(ROOT, fixture)
            home = tmp / "home"
            home.mkdir()
            fake_bin = tmp / "fake-bin"
            fake_bin.mkdir()
            verification_marker = tmp / "installed-verification-ran"

            (fixture / "verify.sh").write_text(
                "#!/usr/bin/env bash\n"
                "set -euo pipefail\n"
                "if [[ \"$*\" == *--installed* ]]; then\n"
                "  if grep -Rqs '\"status\": \"APPLIED\"' \"$HOME/.local/state/mlgo-cao/installations\" 2>/dev/null; then\n"
                "    echo 'APPLIED record existed before installed verification' >&2\n"
                "    exit 99\n"
                "  fi\n"
                f"  touch {verification_marker!s}\n"
                "  exit 41\n"
                "fi\n"
                "exit 0\n",
                encoding="utf-8",
            )
            (fixture / "verify.sh").chmod(0o700)

            systemctl = fake_bin / "systemctl"
            systemctl.write_text(
                "#!/usr/bin/env bash\n"
                "set -u\n"
                "case \" $* \" in\n"
                "  *' is-enabled '*) echo disabled; exit 1 ;;\n"
                "  *' is-active '*) echo inactive; exit 3 ;;\n"
                "  *) exit 0 ;;\n"
                "esac\n",
                encoding="utf-8",
            )
            systemctl.chmod(0o700)

            env = os.environ.copy()
            env["HOME"] = str(home)
            env["PATH"] = str(fake_bin) + os.pathsep + env["PATH"]
            process = subprocess.run(
                [str(fixture / "install.sh"), "--stage-only", "--apply"],
                text=True,
                capture_output=True,
                env=env,
            )
            self.assertEqual(process.returncode, 41, process.stderr)
            self.assertTrue(verification_marker.exists())
            self.assertFalse((home / ".local/lib/mlgo-cao-v2").exists())
            self.assertFalse((home / ".local/share/mlgo-cao-v2").exists())
            self.assertFalse((home / ".config/systemd/user/mlgo-cao-v2-controller.service").exists())

            records = sorted((home / ".local/state/mlgo-cao/installations").glob("v2-*-stage-only.json"))
            self.assertEqual(len(records), 1)
            record = json.loads(records[0].read_text())
            self.assertEqual(record["status"], "ROLLED_BACK_AFTER_PARTIAL_FAILURE")
            self.assertEqual(record["exit_code"], 41)
            state = json.loads((home / ".local/state/mlgo-cao/installations/v2-install-state.json").read_text())
            self.assertFalse(state["staged"])
            self.assertFalse(any(entry.get("status") == "APPLIED" for entry in state["history"]))
            self.assertEqual(state["history"][-1]["status"], "ROLLED_BACK_AFTER_PARTIAL_FAILURE")


if __name__ == "__main__":
    unittest.main()
