from __future__ import annotations

import subprocess
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.git_executor import commit_task, integrate_commit
from mlgo_cao_v2.preflight import verify_worktree
from mlgo_cao_v2.state_machine import RunStore


def git(path: Path, *args: str) -> str:
    return subprocess.run(["git", "-C", str(path), *args], text=True, capture_output=True, check=True).stdout.strip()


class StateGitTest(unittest.TestCase):
    def test_legal_state_transition_is_enforced(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = RunStore(tmp, "run-1")
            store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
            store.register_big_task("task-a", "/tmp/charter.json", "lead-a")
            store.register_phase({"phase_id": "phase-1", "big_task_id": "task-a"}, "/tmp/phase.json")
            store.transition_phase("phase-1", "ROUTING_PENDING", reason="test")
            with self.assertRaises(PolicyError):
                store.transition_phase("phase-1", "COMPLETE", reason="illegal shortcut")

    def test_preflight_commit_and_integration(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            git(root, "init", "-b", "main")
            git(root, "config", "user.email", "test@example.invalid")
            git(root, "config", "user.name", "Test")
            (root / "README.md").write_text("base\n")
            git(root, "add", "README.md")
            git(root, "commit", "-m", "base")
            task = Path(tmp) / "task"
            integration = Path(tmp) / "integration"
            git(root, "worktree", "add", "-b", "task/one", str(task), "main")
            git(root, "worktree", "add", "-b", "integration", str(integration), "main")
            evidence = Path(tmp) / "evidence"
            result = verify_worktree(task, expected_branch="task/one", require_clean=True, evidence_directory=evidence, working_directory=task)
            self.assertEqual(result["branch"], "task/one")
            (task / "src").mkdir()
            (task / "src" / "a.txt").write_text("change\n")
            record = commit_task(worktree=task, expected_branch="task/one", allowed_paths=["src"], forbidden_paths=[], message="phase")
            integrated = integrate_commit(integration_worktree=integration, expected_branch="integration", commit_sha=record["commit_sha"])
            self.assertTrue((integration / "src" / "a.txt").exists())
            self.assertEqual(git(integration, "rev-parse", "HEAD"), integrated["integration_sha"])

    def test_ownership_violation_blocks_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"
            root.mkdir()
            git(root, "init", "-b", "main")
            git(root, "config", "user.email", "test@example.invalid")
            git(root, "config", "user.name", "Test")
            (root / "a.txt").write_text("base\n")
            git(root, "add", "a.txt")
            git(root, "commit", "-m", "base")
            (root / "a.txt").write_text("bad\n")
            with self.assertRaises(PolicyError):
                commit_task(worktree=root, expected_branch="main", allowed_paths=["src"], forbidden_paths=[], message="bad")


    def test_supervisor_selection_is_immutable(self):
        with tempfile.TemporaryDirectory() as td:
            store = RunStore(Path(td), "run-immutable")
            state = store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
            self.assertEqual(state["supervisor_selection"]["profile"], "mlgo-supervisor")
            with self.assertRaises(PolicyError):
                store.initialize(
                    mode="v2_shadow",
                    supervisor_profile="mlgo-codex-plus-supervisor",
                )

    def test_wal_repairs_snapshot_after_crash_boundary(self):
        with tempfile.TemporaryDirectory() as td:
            store = RunStore(td, "run-wal")
            store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
            with self.assertRaises(RuntimeError):
                with __import__("mlgo_cao_v2.common", fromlist=["file_lock"]).file_lock(store.lock_path):
                    state = store._load_unlocked()
                    store._commit_unlocked(state, {"type": "FAILURE_INJECTION"}, fault_after_journal=True)
            repaired = store.load()
            self.assertEqual(repaired["state_version"], 2)
            self.assertEqual(store.repair()["state_version"], 2)

    def test_snapshot_ahead_of_journal_fails_closed(self):
        import json
        with tempfile.TemporaryDirectory() as td:
            store = RunStore(td, "run-ahead")
            state = store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
            state["state_version"] = 99
            store.state_path.write_text(json.dumps(state))
            with self.assertRaises(PolicyError):
                store.load()

    def test_commit_operation_id_recovers_same_commit(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "repo"; root.mkdir()
            git(root, "init", "-b", "main"); git(root, "config", "user.email", "test@example.invalid"); git(root, "config", "user.name", "Test")
            (root / "a.txt").write_text("base\n"); git(root, "add", "a.txt"); git(root, "commit", "-m", "base")
            (root / "a.txt").write_text("change\n")
            first = commit_task(worktree=root, expected_branch="main", allowed_paths=["a.txt"], forbidden_paths=[], message="phase", operation_id="op-commit-1")
            second = commit_task(worktree=root, expected_branch="main", allowed_paths=["a.txt"], forbidden_paths=[], message="phase", operation_id="op-commit-1")
            self.assertEqual(first["commit_sha"], second["commit_sha"])
            self.assertTrue(second.get("recovered"))


    def test_trailing_partial_wal_record_is_truncated_and_repaired(self):
        with tempfile.TemporaryDirectory() as td:
            store=RunStore(td,"partial-run")
            store.initialize(mode="v2_shadow",supervisor_profile="mlgo-supervisor")
            committed_size=store.journal_path.stat().st_size
            with store.journal_path.open("ab") as handle:
                handle.write(b'{"journal_schema_version":"1.0","state_version":')
                handle.flush()
            self.assertGreater(store.journal_path.stat().st_size,committed_size)
            state=store.load()
            self.assertEqual(state["run_id"],"partial-run")
            self.assertEqual(store.journal_path.stat().st_size,committed_size)


if __name__ == "__main__":
    unittest.main()
