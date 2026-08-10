"""CLI bootstrap consistency for every staged mlgo-v2-* launcher.

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

The same host-stage run that motivated this file also found a second,
unrelated launcher (`mlgo-v2-herdr-preflight`, Slice 1 vintage) with the
identical defect in a different shape: it never set PYTHONPATH at all, and
was never caught because the old installed-verification loop only checked
the executable bit. `AllLaunchersSetTheirOwnPythonPathTest` below is the
generic regression for that class of bug across the *whole* launcher
surface, not just skill-cache - see its docstring for why it is a static
source check rather than one dynamic subprocess test per command name.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parents[1]
LAUNCHER_DIR = SOURCE_ROOT / "bin"
LAUNCHER = LAUNCHER_DIR / "mlgo-v2-skill-cache"
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


def _all_launchers() -> list[Path]:
    return sorted(p for p in LAUNCHER_DIR.glob("mlgo-v2-*") if p.is_file())


class AllLaunchersSetTheirOwnPythonPathTest(unittest.TestCase):
    """No staged CAO CLI launcher may depend on an ambient PYTHONPATH.

    This is a single generic check over every `mlgo-v2-*` launcher rather
    than one dynamic subprocess test per command name, and it is a *static*
    source check rather than an executed one: several launchers gate their
    first argument before ever reaching Python (`mlgo-v2-git` only execs for
    a handful of known subcommands; `--help` never leaves bash), so a purely
    dynamic "run it and see" probe cannot prove resolution for every launcher
    shape without hard-coding each one's private argument vocabulary - which
    is exactly the per-command duplication this test avoids. Asserting every
    launcher's source unconditionally sets PYTHONPATH *before* its first
    `exec python3` covers every dispatch shape uniformly.
    """

    PYTHONPATH_LINE = re.compile(
        r'PYTHONPATH="\$\{MLGO_CAO_V2_LIB:-\$HOME/\.local/lib/mlgo-cao-v2\}:\$\{PYTHONPATH:-\}"'
    )

    def test_every_launcher_exports_the_canonical_pythonpath_before_any_exec(self) -> None:
        launchers = _all_launchers()
        self.assertTrue(launchers, "expected at least one mlgo-v2-* launcher")
        for launcher in launchers:
            with self.subTest(launcher=launcher.name):
                text = launcher.read_text(encoding="utf-8")
                match = self.PYTHONPATH_LINE.search(text)
                self.assertIsNotNone(
                    match,
                    f"{launcher.name} does not set the canonical PYTHONPATH fallback "
                    "(${MLGO_CAO_V2_LIB:-$HOME/.local/lib/mlgo-cao-v2}) before exec'ing "
                    "into mlgo_cao_v2.cli - this is the exact defect shape that shipped "
                    "in both mlgo-v2-skill-cache and mlgo-v2-herdr-preflight.",
                )
                first_exec = text.find("exec python3")
                self.assertNotEqual(first_exec, -1, f"{launcher.name} never execs into python3")
                self.assertLess(
                    match.start(), first_exec,
                    f"{launcher.name} sets PYTHONPATH after its first exec, not before",
                )


class UnconditionalLaunchersResolveWithoutBorrowedEnvironmentTest(unittest.TestCase):
    """Dynamic companion, scoped to launchers that reach Python unconditionally.

    A launcher with no argv[1] gate (no `case` statement) execs into
    `mlgo_cao_v2.cli` for *any* input, including `--help` - exactly the shape
    `mlgo-v2-herdr-preflight` has. For that subset, actually run the staged
    binary with PYTHONPATH/MLGO_CAO_V2_LIB stripped and prove it truly
    resolves, not just that its source looks right.
    """

    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        home = Path(self.tmp.name) / "home"
        staged_lib = home / ".local" / "lib" / "mlgo-cao-v2" / "mlgo_cao_v2"
        staged_bin = home / ".local" / "bin"
        staged_lib.parent.mkdir(parents=True)
        staged_bin.mkdir(parents=True)
        shutil.copytree(SOURCE_ROOT / "lib" / "mlgo_cao_v2", staged_lib)
        for launcher in _all_launchers():
            dest = staged_bin / launcher.name
            shutil.copy2(launcher, dest)
            dest.chmod(0o755)
        self.staged_bin = staged_bin
        self.home = home

    def test_unconditional_launchers_reach_the_shared_cli_with_no_borrowed_path(self) -> None:
        unconditional = [p for p in _all_launchers() if "case " not in p.read_text(encoding="utf-8")]
        self.assertTrue(unconditional, "expected at least one unconditional launcher")
        for launcher in unconditional:
            with self.subTest(launcher=launcher.name):
                result = subprocess.run(
                    [str(self.staged_bin / launcher.name), "--help"],
                    env=_bare_env(HOME=str(self.home)),
                    text=True,
                    capture_output=True,
                )
                self.assertNotIn("ModuleNotFoundError", result.stderr, result.stderr)
                self.assertNotIn("Traceback (most recent call last)", result.stderr, result.stderr)


if __name__ == "__main__":
    unittest.main()
