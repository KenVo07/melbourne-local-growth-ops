"""Slice 4 gap closure (round 4): truthful provider_start_state /
actual_call_consumed on the synchronous child-transport leg of
dispatch.run_job, and correct release/hold/settle classification when an
exception interrupts a real dispatch at each of the three possible points.

Pure unit tests: dispatch_via_child_transport is monkeypatched to simulate
each interruption point deterministically, with a real BudgetStore
reservation pre-seeded exactly as a real govern_before_send call would have
left one, so release/hold/settle are exercised for real.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mlgo_cao_v2 import dispatch
from mlgo_cao_v2.budgets import BudgetStore, make_budget_policy, make_limit
from mlgo_cao_v2.common import atomic_write_json


class FakeStore:
    def __init__(self):
        self.transitions = []

    def transition_phase(self, phase_id, target, *, reason="", updates=None):
        self.transitions.append((phase_id, target, reason, updates))
        return {}


class ChildTransportCrashRecoveryTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.run_id = "run-crash"
        self.v2_dir = self.tmp / "runs" / self.run_id / "v2"
        self.job_dir = self.v2_dir / "jobs" / "job-1"
        self.job_dir.mkdir(parents=True)
        self.job_path = self.job_dir / "job.json"
        self.job = {"job_id": "cmd-crash-1", "attempt": 1}
        atomic_write_json(self.job_path, self.job)
        self.phase = {"run_id": self.run_id, "phase_id": "phase-1", "big_task_id": "bt-1"}
        self.decision = {"selected_provider": "claude_code", "selected_profile": "p"}
        self.policy = {"state_root": str(self.tmp), "_registry": {}}
        self.store = FakeStore()

        # Seed a real reservation exactly as govern_before_send would have.
        self.budget_store = BudgetStore(self.v2_dir, run_id=self.run_id)
        budget_policy = make_budget_policy(
            policy_id="test", enforcement_mode="hard",
            limits=[make_limit(limit_id="l", scope_kind="run", scope_id=self.run_id, metric="provider_sessions", native_unit="sessions", limit_value=12, action="prohibit")],
        )
        outcome = self.budget_store.evaluate_and_reserve(
            command_id=self.job["job_id"], policy=budget_policy, scopes={"run": self.run_id},
            requests=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}],
        )
        self.assertTrue(outcome["reserved"])

    def _run(self):
        return dispatch._run_job_via_child_transport(
            phase=self.phase, decision=self.decision, job=dict(self.job), job_path=self.job_path,
            job_dir=self.job_dir, policy=self.policy, store=self.store,
            prompt_text="x", v2_dir=self.v2_dir, pre_state_facts={},
        )

    def test_exception_before_any_start_marker_releases_not_sent(self):
        def boom(**kwargs):
            raise RuntimeError("failed before governance ever ran")

        with patch("mlgo_cao_v2.dispatch.dispatch_via_child_transport", side_effect=boom):
            with self.assertRaises(RuntimeError):
                self._run()

        job = json.loads(self.job_path.read_text())
        self.assertEqual(job["provider_start_state"], "NOT_STARTED")
        self.assertFalse(job["actual_call_consumed"])
        reservation = self.budget_store.load_reservation(self.job["job_id"])
        self.assertEqual(reservation["status"], "RELEASED")

    def test_exception_after_start_attempted_but_before_evidence_holds_ambiguous(self):
        child_dir = self.job_dir / "child-transport"

        def boom(**kwargs):
            # Simulates a crash exactly between "process launched" and
            # "output captured" - the durable marker exists, the evidence
            # file does not.
            child_dir.mkdir(parents=True, exist_ok=True)
            atomic_write_json(child_dir / "provider-start-attempted.json", {"attempted_at": "now"})
            raise RuntimeError("interrupted mid-send")

        with patch("mlgo_cao_v2.dispatch.dispatch_via_child_transport", side_effect=boom):
            with self.assertRaises(RuntimeError):
                self._run()

        job = json.loads(self.job_path.read_text())
        self.assertEqual(job["provider_start_state"], "START_RECONCILIATION_REQUIRED")
        self.assertFalse(job["actual_call_consumed"])
        reservation = self.budget_store.load_reservation(self.job["job_id"])
        self.assertEqual(reservation["status"], "HELD")

    def test_exception_after_real_evidence_captured_settles_not_holds(self):
        child_dir = self.job_dir / "child-transport"

        def boom(**kwargs):
            # Real provider evidence was captured; something failed only
            # afterward (e.g. parsing). Capacity was genuinely spent.
            child_dir.mkdir(parents=True, exist_ok=True)
            atomic_write_json(child_dir / "provider-start-attempted.json", {"attempted_at": "now"})
            (child_dir / "raw-stdout.jsonl").write_text('{"type": "result"}\n')
            raise RuntimeError("failed after real evidence was captured")

        with patch("mlgo_cao_v2.dispatch.dispatch_via_child_transport", side_effect=boom):
            with self.assertRaises(RuntimeError):
                self._run()

        job = json.loads(self.job_path.read_text())
        self.assertEqual(job["provider_start_state"], "PROVIDER_RESPONSE_OBSERVED")
        self.assertTrue(job["actual_call_consumed"])
        reservation = self.budget_store.load_reservation(self.job["job_id"])
        self.assertEqual(reservation["status"], "SETTLED")

    def test_never_finishes_actual_call_consumed_true_with_provider_start_state_not_started(self):
        """The literal invariant asked for: these two fields must never
        disagree in that specific way, across every path this module can
        take."""
        for scenario in ("before", "start-attempted", "evidence"):
            with self.subTest(scenario=scenario):
                tmp = tempfile.TemporaryDirectory()
                self.addCleanup(tmp.cleanup)
                root = Path(tmp.name)
                v2_dir = root / "runs" / "r" / "v2"
                job_dir = v2_dir / "jobs" / "j"
                job_dir.mkdir(parents=True)
                job_path = job_dir / "job.json"
                job = {"job_id": f"cmd-{scenario}", "attempt": 1}
                atomic_write_json(job_path, job)
                budget_store = BudgetStore(v2_dir, run_id="r")
                budget_policy = make_budget_policy(
                    policy_id="t", enforcement_mode="hard",
                    limits=[make_limit(limit_id="l", scope_kind="run", scope_id="r", metric="provider_sessions", native_unit="sessions", limit_value=12, action="prohibit")],
                )
                budget_store.evaluate_and_reserve(
                    command_id=job["job_id"], policy=budget_policy, scopes={"run": "r"},
                    requests=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}],
                )

                def boom(**kwargs):
                    child_dir = job_dir / "child-transport"
                    if scenario in ("start-attempted", "evidence"):
                        child_dir.mkdir(parents=True, exist_ok=True)
                        atomic_write_json(child_dir / "provider-start-attempted.json", {})
                    if scenario == "evidence":
                        (child_dir / "raw-stdout.jsonl").write_text("{}\n")
                    raise RuntimeError("boom")

                with patch("mlgo_cao_v2.dispatch.dispatch_via_child_transport", side_effect=boom):
                    with self.assertRaises(RuntimeError):
                        dispatch._run_job_via_child_transport(
                            phase={"run_id": "r", "phase_id": "p", "big_task_id": "bt"},
                            decision=self.decision, job=dict(job), job_path=job_path, job_dir=job_dir,
                            policy={"state_root": str(root), "_registry": {}}, store=FakeStore(),
                            prompt_text="x", v2_dir=v2_dir, pre_state_facts={},
                        )
                final = json.loads(job_path.read_text())
                self.assertFalse(
                    final["actual_call_consumed"] and final["provider_start_state"] == "NOT_STARTED",
                    f"invariant violated for scenario={scenario}: {final}",
                )


if __name__ == "__main__":
    unittest.main()
