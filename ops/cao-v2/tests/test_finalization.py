from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mlgo_cao_v2.common import ContractError, PolicyError
from mlgo_cao_v2.continuity import register_session
from mlgo_cao_v2.finalization import finalize_with_verdict, prepare_final_facts
from mlgo_cao_v2.provenance import (
    capture_supervisor_decision,
    create_delivery,
    parse_model_artifact_observation,
    record_model_observation,
)
from mlgo_cao_v2.state_machine import RunStore


class FinalizationTest(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = Path(self.td.name)
        policy = json.loads((Path(__file__).parents[1] / "config/cao-policy.json").read_text())
        policy["state_root"] = str(self.root / "state")
        self.policy = self.root / "policy.json"
        self.policy.write_text(json.dumps(policy))
        self.run = "final-run"
        self.store = RunStore(policy["state_root"], self.run)
        self.store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
        self.store.set_run_status("ACTIVE", reason="test")
        self.sha = "2" * 40
        self.rollout = self.root / "supervisor-rollout.jsonl"
        self.rollout.write_text("", encoding="utf-8")
        register_session(
            store=self.store,
            profile="mlgo-supervisor",
            generation=1,
            terminal_id="terminal-1",
            provider="codex",
            provider_session_id="session-1",
            provider_session_artifact=str(self.rollout),
            process_identity={"pid": 1, "process_start_time": "t", "executable": "codex"},
            launch_identity={"profile_digest": "p", "launch_command_digest": "c"},
        )

    def tearDown(self):
        self.td.cleanup()

    def envelope(self, name, typ, decision, *, facts_digest=None, candidate_sha=None, profile="mlgo-supervisor"):
        payload = {
            "schema_version": "2.1",
            "decision_id": name,
            "run_id": self.run,
            "big_task_id": None,
            "supervisor_profile": profile,
            "decision_type": typ,
            "facts": ["test facts"],
            "decision": decision,
            "authority_basis": "immutable operator selection",
            "conditions": [],
            "remaining_risk": [],
            "decided_at": "2099-01-01T00:00:00Z",
            "candidate_sha": candidate_sha,
            "facts_digest": facts_digest,
        }
        delivery_id = f"delivery-{name}"
        delivery = create_delivery(
            store=self.store,
            recipient_role="authoritative_supervisor",
            terminal_id="terminal-1",
            profile="mlgo-supervisor",
            generation=1,
            provider="codex",
            provider_session_id="session-1",
            payload=f"decision {name}",
            delivery_id=delivery_id,
        )
        records = [line for line in self.rollout.read_text().splitlines() if line]
        records.extend([
            json.dumps({"id": f"ack-{name}", "session_id": "session-1", "message": {"text": delivery["expected_ack"]}}),
            json.dumps({"id": f"response-{name}", "session_id": "session-1", "message": {"text": name}}),
        ])
        self.rollout.write_text("\n".join(records) + "\n", encoding="utf-8")
        ack_index = len(records) - 1
        response_index = len(records)
        ack = parse_model_artifact_observation(store=self.store, observation_source="provider_rollout", artifact_path=self.rollout, record_index=ack_index)
        response = parse_model_artifact_observation(store=self.store, observation_source="provider_rollout", artifact_path=self.rollout, record_index=response_index)
        record_model_observation(store=self.store, delivery_id=delivery_id, ack_observation=ack, response_observation=response)
        captured = capture_supervisor_decision(store=self.store, decision_packet=payload, delivery_id=delivery_id)
        return Path(captured["path"])

    def records(self):
        review = self.root / "review.json"
        review.write_text(json.dumps({"status": "PASS", "reviewed_sha": self.sha}))
        validation = self.root / "validation.json"
        validation.write_text(json.dumps({"status": "PASS", "candidate_sha": self.sha, "scope": "full_integrated"}))
        publication = self.root / "publication.json"
        publication.write_text(json.dumps({"schema_version": "2.1", "run_id": self.run, "candidate_sha": self.sha, "remote": "origin", "target_branch": "main", "status": "PUBLISHED"}))
        ci = self.root / "ci.json"
        ci.write_text(json.dumps({"schema_version": "2.1", "candidate_sha": self.sha, "required_checks": [{"name": "CI", "allowed_conclusions": ["success"]}], "missing_checks": [], "pending_checks": [], "failed_checks": [], "status": "PASS"}))
        return review, validation, publication, ci

    def test_raw_self_declared_decision_is_rejected(self):
        raw = self.root / "raw.json"
        raw.write_text(json.dumps({"schema_version": "2.1", "run_id": self.run, "supervisor_profile": "mlgo-supervisor"}))
        with self.assertRaises(ContractError):
            finalize_with_verdict(run_id=self.run, final_facts_record=raw, final_verdict=raw, policy_path=self.policy)

    def test_publication_authorization_precedes_final_facts(self):
        review, validation, pub, ci = self.records()
        auth = self.envelope("auth", "PUBLICATION_AUTHORIZATION", "AUTHORIZE_PUBLICATION", candidate_sha=self.sha)
        with patch("mlgo_cao_v2.finalization.verify_reachability", return_value={"remote_sha": self.sha}):
            result = prepare_final_facts(run_id=self.run, integration_worktree=self.root, target_branch="main", expected_sha=self.sha, review_record=review, final_validation_record=validation, publication_authorization=auth, publication_record=pub, remote_ci_record=ci, required_ci_checks=[{"name": "CI", "allowed_conclusions": ["success"]}], policy_path=self.policy)
        self.assertEqual(self.store.load()["status"], "FINAL_FACTS_READY")
        self.assertEqual(result["record"]["candidate_sha"], self.sha)

    def test_final_verdict_must_bind_facts_digest(self):
        review, validation, pub, ci = self.records()
        auth = self.envelope("auth", "PUBLICATION_AUTHORIZATION", "AUTHORIZE_PUBLICATION", candidate_sha=self.sha)
        with patch("mlgo_cao_v2.finalization.verify_reachability", return_value={"remote_sha": self.sha}):
            facts = prepare_final_facts(run_id=self.run, integration_worktree=self.root, target_branch="main", expected_sha=self.sha, review_record=review, final_validation_record=validation, publication_authorization=auth, publication_record=pub, remote_ci_record=ci, required_ci_checks=[{"name": "CI", "allowed_conclusions": ["success"]}], policy_path=self.policy)
        verdict = self.envelope("verdict", "FINAL_VERDICT", "MILESTONE_FINALIZED", facts_digest="f" * 64)
        with self.assertRaises(PolicyError):
            finalize_with_verdict(run_id=self.run, final_facts_record=facts["path"], final_verdict=verdict, policy_path=self.policy)

    def test_happy_two_step_finalization(self):
        review, validation, pub, ci = self.records()
        auth = self.envelope("auth", "PUBLICATION_AUTHORIZATION", "AUTHORIZE_PUBLICATION", candidate_sha=self.sha)
        with patch("mlgo_cao_v2.finalization.verify_reachability", return_value={"remote_sha": self.sha}):
            facts = prepare_final_facts(run_id=self.run, integration_worktree=self.root, target_branch="main", expected_sha=self.sha, review_record=review, final_validation_record=validation, publication_authorization=auth, publication_record=pub, remote_ci_record=ci, required_ci_checks=[{"name": "CI", "allowed_conclusions": ["success"]}], policy_path=self.policy)
        verdict = self.envelope("verdict", "FINAL_VERDICT", "MILESTONE_FINALIZED", facts_digest=facts["record"]["facts_digest"])
        result = finalize_with_verdict(run_id=self.run, final_facts_record=facts["path"], final_verdict=verdict, policy_path=self.policy)
        self.assertEqual(result["record"]["local_integration_sha"], self.sha)
        self.assertEqual(self.store.load()["status"], "FINALIZED")

    def test_wrong_supervisor_provenance_is_rejected(self):
        with self.assertRaises(PolicyError):
            self.envelope("auth", "PUBLICATION_AUTHORIZATION", "AUTHORIZE_PUBLICATION", candidate_sha=self.sha, profile="mlgo-codex-plus-supervisor")

    def test_final_facts_reject_ci_record_for_different_required_set(self):
        review, validation, pub, ci = self.records()
        auth = self.envelope("auth", "PUBLICATION_AUTHORIZATION", "AUTHORIZE_PUBLICATION", candidate_sha=self.sha)
        ci.write_text(json.dumps({"schema_version": "2.1", "candidate_sha": self.sha, "required_checks": [{"name": "Unrelated", "allowed_conclusions": ["success"]}], "missing_checks": [], "pending_checks": [], "failed_checks": [], "status": "PASS"}))
        with patch("mlgo_cao_v2.finalization.verify_reachability", return_value={"remote_sha": self.sha}), self.assertRaises(PolicyError):
            prepare_final_facts(run_id=self.run, integration_worktree=self.root, target_branch="main", expected_sha=self.sha, review_record=review, final_validation_record=validation, publication_authorization=auth, publication_record=pub, remote_ci_record=ci, required_ci_checks=[{"name": "CI", "allowed_conclusions": ["success"]}], policy_path=self.policy)


if __name__ == "__main__":
    unittest.main()
