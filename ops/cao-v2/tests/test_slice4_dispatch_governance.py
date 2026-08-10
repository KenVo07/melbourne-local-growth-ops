"""Slice 4 S4-A: the dispatch governance seam, exercised against the real
sealed canonical cache the host already populated.

Unlike the Slice 3.5 gate tests, this module deliberately does *not* use
synthetic fixture bytes: :mod:`dispatch_governance` always resolves the one
tracked production lock (never an injected one - that is the point of the
lock), so proving it actually reaches a compilable SkillContract requires the
real, already-populated sealed cache.  If this host has not populated that
cache (a fresh checkout, or CI without the operator-controlled population
step), these tests skip rather than fail: they prove real-host integration,
not portable unit behaviour, which the rest of the suite already covers.
"""

from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2 import dispatch_governance as dg
from mlgo_cao_v2.approval_broker import APPROVED_BY_DELEGATION, APPROVED_BY_POLICY
from mlgo_cao_v2.budgets import BudgetStore
from mlgo_cao_v2.canonical_lock import load_lock
from mlgo_cao_v2.common import ContractError, PolicyError
from mlgo_cao_v2.skill_cache import SealedSkillCache
from mlgo_cao_v2.skill_population import bind_namespace

REAL_CACHE_ROOT = Path.home() / ".local" / "state" / "mlgo-cao" / "canonical-skill-cache-v1"


def _real_cache_populated() -> bool:
    if not (REAL_CACHE_ROOT / "skill-cache" / "manifests").is_dir():
        return False
    try:
        lock = load_lock()
    except Exception:
        return False
    cache = SealedSkillCache(REAL_CACHE_ROOT)
    return all(cache.load_manifest(b["bundle_id"]) is not None for b in lock["bundles"])


@unittest.skipUnless(
    _real_cache_populated(),
    "requires the operator-populated sealed canonical skill cache on this host",
)
class DispatchGovernanceRealCacheTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.cache_root = self.tmp / "cache"
        shutil.copytree(REAL_CACHE_ROOT, self.cache_root)
        self.lock = load_lock()
        self.cache = SealedSkillCache(self.cache_root)

    def _prepared_run(self, run_id: str) -> tuple[dict, Path, Path]:
        project_id, domain_id = dg.project_and_domain_for_run(run_id)
        bind_namespace(cache=self.cache, lock=self.lock, project_id=project_id, security_domain_id=domain_id)
        v2_dir = self.tmp / "runs" / run_id / "v2"
        job_dir = v2_dir / "jobs" / "job-1"
        job_dir.mkdir(parents=True)
        policy = {
            "state_root": str(self.tmp),
            "repo_root": "/tmp/synthetic-repo",
            "skill_cache_root": str(self.cache_root),
            "orchestration": {"max_real_provider_sessions_per_run": 12},
            "context_envelope": {},
        }
        return policy, v2_dir, job_dir

    def _phase(self, run_id: str, *, write_capable: bool, phase_kind: str = "implementation") -> dict:
        return {
            "run_id": run_id, "big_task_id": "bt-1", "phase_id": "phase-1",
            "phase_kind": phase_kind, "objective": "Implement a small backend fix",
            "write_capable": write_capable,
            "worktree": {"path": "/tmp/synthetic-repo", "branch": "main"},
            "ownership": {"allowed_paths": ["src"], "forbidden_paths": []},
        }

    def test_write_capable_phase_is_governed_and_settles(self):
        policy, v2_dir, job_dir = self._prepared_run("run-govern-a")
        phase = self._phase("run-govern-a", write_capable=True)
        decision = {"selected_profile": "builder-profile", "selected_route": "route-a"}
        job = {"job_id": "job-a", "attempt": 1}

        record = dg.govern_before_send(
            phase=phase, decision=decision, job=job, policy=policy,
            prompt_text="Implement the fix.", v2_dir=v2_dir, job_dir=job_dir,
            pre_state_facts={"branch": "main", "head": "a" * 40},
        )
        self.assertEqual(record["approval_outcome"], APPROVED_BY_DELEGATION)
        self.assertTrue(record["skill_contract_digest"])
        self.assertTrue((job_dir / "governance" / "skill-contract.json").is_file())
        self.assertTrue((v2_dir / "context-envelope").is_dir())

        store = BudgetStore(v2_dir, run_id="run-govern-a")
        reservation = store.load_reservation("job-a")
        self.assertEqual(reservation["status"], "ACTIVE")

        settled = dg.settle_after_send(v2_dir=v2_dir, run_id="run-govern-a", command_id="job-a", native_units=[])
        self.assertEqual(settled["status"], "SETTLED")

    def test_read_only_phase_uses_read_in_scope_and_auto_approves_by_policy(self):
        policy, v2_dir, job_dir = self._prepared_run("run-govern-b")
        phase = self._phase("run-govern-b", write_capable=False)
        decision = {"selected_profile": "reviewer-profile", "selected_route": "route-b"}
        job = {"job_id": "job-b", "attempt": 1}

        record = dg.govern_before_send(
            phase=phase, decision=decision, job=job, policy=policy,
            prompt_text="Review the change.", v2_dir=v2_dir, job_dir=job_dir,
            pre_state_facts={"branch": "main", "head": "b" * 40},
        )
        self.assertEqual(record["approval_outcome"], APPROVED_BY_POLICY)

    def test_exhausted_run_budget_blocks_before_any_provider_send(self):
        policy, v2_dir, job_dir = self._prepared_run("run-govern-c")
        policy["orchestration"]["max_real_provider_sessions_per_run"] = 0
        phase = self._phase("run-govern-c", write_capable=True)
        decision = {"selected_profile": "builder-profile", "selected_route": "route-c"}
        job = {"job_id": "job-c", "attempt": 1}

        with self.assertRaises(dg.GovernanceBlocked) as ctx:
            dg.govern_before_send(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Implement the fix.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "main", "head": "c" * 40},
            )
        self.assertIn("budget", ctx.exception.reason)
        store = BudgetStore(v2_dir, run_id="run-govern-c")
        self.assertIsNone(store.load_reservation("job-c"))

    def test_hold_then_settle_after_ambiguous_send(self):
        policy, v2_dir, job_dir = self._prepared_run("run-govern-d")
        phase = self._phase("run-govern-d", write_capable=True)
        decision = {"selected_profile": "builder-profile", "selected_route": "route-d"}
        job = {"job_id": "job-d", "attempt": 1}
        dg.govern_before_send(
            phase=phase, decision=decision, job=job, policy=policy,
            prompt_text="Implement the fix.", v2_dir=v2_dir, job_dir=job_dir,
            pre_state_facts={"branch": "main", "head": "d" * 40},
        )
        held = dg.hold_after_ambiguous(v2_dir=v2_dir, run_id="run-govern-d", command_id="job-d", reason="PROVIDER_START_UNCERTAIN")
        self.assertEqual(held["status"], "HELD")
        settled = dg.settle_after_send(v2_dir=v2_dir, run_id="run-govern-d", command_id="job-d", native_units=[])
        self.assertEqual(settled["status"], "SETTLED")

    def test_confirmed_not_sent_releases_the_reservation(self):
        policy, v2_dir, job_dir = self._prepared_run("run-govern-e")
        phase = self._phase("run-govern-e", write_capable=True)
        decision = {"selected_profile": "builder-profile", "selected_route": "route-e"}
        job = {"job_id": "job-e", "attempt": 1}
        dg.govern_before_send(
            phase=phase, decision=decision, job=job, policy=policy,
            prompt_text="Implement the fix.", v2_dir=v2_dir, job_dir=job_dir,
            pre_state_facts={"branch": "main", "head": "e" * 40},
        )
        released = dg.release_after_not_sent(v2_dir=v2_dir, run_id="run-govern-e", command_id="job-e")
        self.assertEqual(released["status"], "RELEASED")
        with self.assertRaises(PolicyError):
            dg.settle_after_send(v2_dir=v2_dir, run_id="run-govern-e", command_id="job-e", native_units=[])


if __name__ == "__main__":
    unittest.main()
