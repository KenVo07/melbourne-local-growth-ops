"""CLI bootstrap consistency: the installed mlgo-v2-skill-cache launcher.

The Slice 3.5 canonical-bundle lock work shipped a Python entrypoint that
guessed its own PYTHONPATH from `__file__`, one directory too shallow. Every
unit test imported `mlgo_cao_v2` directly with PYTHONPATH already set by the
test runner, so the guess was never exercised and the bug reached a real
host-stage run before it was caught.

`mlgo-v2-skill-cache` is now a thin bash launcher identical in shape to every
other staged CAO command (`mlgo-v2-capacity`, `mlgo-v2-route`, ...): it sets
`PYTHONPATH` from `${MLGO_CAO_V2_LIB:-$HOME/.local/lib/mlgo-cao-v2}` and execs
`python3 -m mlgo_cao_v2.cli`. All argument parsing and command logic live in
`cli.py`. These tests invoke the real launcher script as a subprocess, in an
environment the test does not pre-seed with PYTHONPATH, so a regression of the
same shape (an entrypoint that only works because something upstream already
set the path) fails here instead of at the next host-stage gate.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = SOURCE_ROOT / "bin" / "mlgo-v2-skill-cache"
LOCK_PATH = SOURCE_ROOT / "skills" / "canonical-skill-bundles.lock.json"


def _bare_env(**extra: str) -> dict[str, str]:
    """A minimal environment with no PYTHONPATH/MLGO_CAO_V2_LIB leakage.

    Only PATH (so `env`/`python3`/`bash` resolve) and whatever the test
    explicitly asks for are present - nothing is inherited that could launder
    a broken default path resolution into an accidental pass.
    """

    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin")}
    env.update(extra)
    return env


class InstalledLauncherWithoutOverrideTest(unittest.TestCase):
    """The real installed launcher, with no MLGO_CAO_V2_LIB, must resolve itself."""

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name) / "home"
        staged_lib = home / ".local" / "lib" / "mlgo-cao-v2" / "mlgo_cao_v2"
        staged_bin = home / ".local" / "bin"
        staged_lib.parent.mkdir(parents=True)
        staged_bin.mkdir(parents=True)
        # Mirror exactly what install.sh --stage-only puts on a real host:
        # the package under lib/mlgo-cao-v2/mlgo_cao_v2, the launcher under
        # bin/, nothing else on the path that could resolve the package.
        shutil.copytree(SOURCE_ROOT / "lib" / "mlgo_cao_v2", staged_lib)
        shutil.copy2(LAUNCHER, staged_bin / "mlgo-v2-skill-cache")
        (staged_bin / "mlgo-v2-skill-cache").chmod(0o755)
        self.home = home
        self.staged_launcher = staged_bin / "mlgo-v2-skill-cache"

    def run_launcher(self, *args: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [str(self.staged_launcher), *args],
            env=_bare_env(HOME=str(self.home)),
            text=True,
            capture_output=True,
        )

    def test_plan_succeeds_via_the_default_installed_path_alone(self) -> None:
        result = self.run_launcher("plan", "--lock", str(LOCK_PATH))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("ModuleNotFoundError", result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("lock_digest", payload)
        self.assertFalse(payload["requires_semantic_choice_at_staging_time"])

    def test_without_a_staged_package_or_override_the_launcher_fails_closed(self) -> None:
        # Same HOME shape, but no package staged under it at all - proves the
        # success above is really coming from the staged lib, not some other
        # ambient path.
        empty_home = Path(self.tmp.name) / "empty-home"
        empty_home.mkdir()
        result = subprocess.run(
            [str(self.staged_launcher), "plan", "--lock", str(LOCK_PATH)],
            env=_bare_env(HOME=str(empty_home)),
            text=True,
            capture_output=True,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("ModuleNotFoundError", result.stderr)


class SourceTreeExplicitOverrideTest(unittest.TestCase):
    """MLGO_CAO_V2_LIB is preserved as an explicit override, not a default guess."""

    def test_source_lib_override_resolves_from_an_unrelated_home(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            # HOME deliberately has nothing under .local - only the explicit
            # override can make this succeed.
            unrelated_home = Path(td) / "not-the-real-home"
            unrelated_home.mkdir()
            result = subprocess.run(
                [str(LAUNCHER), "plan", "--lock", str(LOCK_PATH)],
                env=_bare_env(
                    HOME=str(unrelated_home),
                    MLGO_CAO_V2_LIB=str(SOURCE_ROOT / "lib"),
                ),
                text=True,
                capture_output=True,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertIn("lock_digest", payload)

    def test_populate_and_verify_mirror_run_through_the_same_launcher(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            cache_root = Path(td) / "cache"
            unrelated_home = Path(td) / "not-the-real-home"
            unrelated_home.mkdir()
            env = _bare_env(HOME=str(unrelated_home), MLGO_CAO_V2_LIB=str(SOURCE_ROOT / "lib"))

            populate = subprocess.run(
                [
                    str(LAUNCHER), "populate",
                    "--lock", str(LOCK_PATH),
                    "--cache-root", str(cache_root),
                    "--project", "mlgo-cli-launcher-test",
                    "--security-domain", "mlgo-cli-launcher-test",
                ],
                env=env, text=True, capture_output=True,
            )
            self.assertEqual(populate.returncode, 0, populate.stderr)
            self.assertTrue(cache_root.exists())

            mirror = subprocess.run(
                [
                    str(LAUNCHER), "verify-mirror",
                    "--lock", str(LOCK_PATH),
                    "--cache-root", str(cache_root),
                    "--mirror-root", str(Path(td) / "no-such-mirror"),
                    "--project", "mlgo-cli-launcher-test",
                    "--security-domain", "mlgo-cli-launcher-test",
                ],
                env=env, text=True, capture_output=True,
            )
            # A missing mirror is a legitimate NOT-READY result, not a crash:
            # the launcher must still resolve its own package and produce a
            # normal report.
            payload = json.loads(mirror.stdout)
            self.assertIn("accepted", payload)
            self.assertNotIn("ModuleNotFoundError", mirror.stderr)


class TopLevelPassthroughTest(unittest.TestCase):
    """Anything other than plan/populate/verify-mirror passes straight through."""

    def test_help_reaches_the_shared_cli_without_a_traceback(self) -> None:
        result = subprocess.run(
            [str(LAUNCHER), "--help"],
            env=_bare_env(MLGO_CAO_V2_LIB=str(SOURCE_ROOT / "lib")),
            text=True,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
