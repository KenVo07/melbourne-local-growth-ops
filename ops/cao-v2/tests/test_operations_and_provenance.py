from __future__ import annotations

import hashlib
import json
import multiprocessing as mp
import tempfile
import time
import unittest
from pathlib import Path

from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.continuity import register_session
from mlgo_cao_v2.controller import _record_review_dispatch_outcome
from mlgo_cao_v2.operations import OperationLedger
from mlgo_cao_v2.provenance import (
    capture_supervisor_decision,
    create_delivery,
    parse_model_artifact_observation,
    record_manual_observation,
    record_model_observation,
    require_model_observation,
)
from mlgo_cao_v2.state_machine import RunStore


def _concurrent_operation_worker(root: str, start: mp.synchronize.Event, queue: mp.Queue) -> None:
    ledger = OperationLedger(root)
    root_path = Path(root)
    external = root_path / "external.json"
    apply_count = root_path / "apply-count.txt"

    def verify(_record):
        return json.loads(external.read_text()) if external.exists() else None

    def apply():
        with apply_count.open("a", encoding="utf-8") as handle:
            handle.write("apply\n")
            handle.flush()
        time.sleep(0.25)
        result = {"external_identity": "shared-effect", "value": 1}
        external.write_text(json.dumps(result), encoding="utf-8")
        return result

    start.wait(5)
    try:
        result = ledger.execute(
            operation_id="op-concurrent",
            operation_type="review_dispatch",
            inputs={"x": 1},
            apply=apply,
            verify_existing=verify,
        )
        queue.put({"status": result["status"], "duplicate": result.get("duplicate", False)})
    except Exception as exc:  # pragma: no cover - returned to parent for assertion
        queue.put({"error": repr(exc)})


class OperationAndProvenanceTest(unittest.TestCase):
    def test_operation_recovers_without_repeating_after_crash(self):
        with tempfile.TemporaryDirectory() as td:
            ledger = OperationLedger(td)
            external = {}
            calls = []

            def apply():
                calls.append(1)
                external["value"] = {"external_identity": "x"}
                return external["value"]

            def verify(_):
                return external.get("value")

            def fault(stage, _record):
                if stage == "after_apply_before_record":
                    raise RuntimeError("crash")

            with self.assertRaises(RuntimeError):
                ledger.execute(operation_id="op-1", operation_type="NOTIFY", inputs={"x": 1}, apply=apply, verify_existing=verify, fault_hook=fault)
            result = ledger.execute(operation_id="op-1", operation_type="NOTIFY", inputs={"x": 1}, apply=apply, verify_existing=verify)
            self.assertEqual(len(calls), 1)
            self.assertEqual(result["status"], "VERIFIED")
            self.assertTrue(result["recovered_after_interruption"])

    def test_unknown_after_apply_is_not_blindly_retried(self):
        with tempfile.TemporaryDirectory() as td:
            ledger = OperationLedger(td)
            calls = []
            result = ledger.execute(
                operation_id="op-2",
                operation_type="PUBLISH",
                inputs={"x": 1},
                apply=lambda: (calls.append(1) or {"external_identity": "x"}),
                verify_existing=lambda _: None,
            )
            self.assertEqual(result["status"], "UNKNOWN_AFTER_APPLY")
            result = ledger.execute(
                operation_id="op-2",
                operation_type="PUBLISH",
                inputs={"x": 1},
                apply=lambda: (calls.append(1) or {}),
                verify_existing=lambda _: None,
            )
            self.assertEqual(len(calls), 1)
            self.assertTrue(result["retry_blocked"])

    def test_operation_is_mutually_exclusive_across_full_boundary(self):
        with tempfile.TemporaryDirectory() as td:
            context = mp.get_context("spawn")
            start = context.Event()
            queue = context.Queue()
            processes = [context.Process(target=_concurrent_operation_worker, args=(td, start, queue)) for _ in range(2)]
            for process in processes:
                process.start()
            start.set()
            for process in processes:
                process.join(10)
                self.assertEqual(process.exitcode, 0)
            results = [queue.get(timeout=2) for _ in processes]
            self.assertFalse(any("error" in result for result in results), results)
            self.assertEqual([line for line in (Path(td) / "apply-count.txt").read_text().splitlines() if line], ["apply"])
            self.assertEqual({result["status"] for result in results}, {"VERIFIED"})
            self.assertEqual(sum(bool(result["duplicate"]) for result in results), 1)

    def setup_store(self, td: str) -> tuple[RunStore, Path]:
        store = RunStore(td, "run-1")
        store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
        rollout = Path(td) / "rollout.jsonl"
        rollout.write_text("", encoding="utf-8")
        register_session(
            store=store,
            profile="mlgo-supervisor",
            generation=1,
            terminal_id="terminal-1",
            provider="codex",
            provider_session_id="session-1",
            provider_session_artifact=str(rollout),
            process_identity={"pid": 1, "process_start_time": "t", "executable": "codex"},
            launch_identity={"profile_digest": "p", "launch_command_digest": "c"},
        )
        return store, rollout

    @staticmethod
    def decision_packet() -> dict[str, object]:
        return {
            "schema_version": "2.1",
            "decision_id": "decision-1",
            "run_id": "run-1",
            "big_task_id": None,
            "supervisor_profile": "mlgo-supervisor",
            "decision_type": "EXCEPTION_DISPOSITION",
            "facts": ["x"],
            "decision": "APPROVE",
            "authority_basis": "operator selection",
            "conditions": [],
            "remaining_risk": [],
            "decided_at": "2099-01-01T00:00:00Z",
            "candidate_sha": None,
            "facts_digest": None,
        }

    def test_transport_success_is_not_model_health(self):
        with tempfile.TemporaryDirectory() as td:
            store, _ = self.setup_store(td)
            rec = create_delivery(
                store=store,
                recipient_role="authoritative_supervisor",
                terminal_id="terminal-1",
                profile="mlgo-supervisor",
                generation=1,
                provider="codex",
                provider_session_id="session-1",
                payload="decide",
                sender=lambda _: {"http_status": 200},
                delivery_id="delivery-1",
            )
            self.assertEqual(rec["status"], "TERMINAL_ACCEPTED")
            with self.assertRaises(PolicyError):
                require_model_observation(store, "delivery-1")

    def test_adapter_parsed_artifact_binds_material_decision(self):
        with tempfile.TemporaryDirectory() as td:
            store, rollout = self.setup_store(td)
            rec = create_delivery(
                store=store,
                recipient_role="authoritative_supervisor",
                terminal_id="terminal-1",
                profile="mlgo-supervisor",
                generation=1,
                provider="codex",
                provider_session_id="session-1",
                payload="decide",
                delivery_id="delivery-2",
            )
            packet = self.decision_packet()
            digest = hashlib.sha256(json.dumps(packet, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
            rollout.write_text(
                json.dumps({"id": "ack-1", "session_id": "session-1", "message": {"text": rec["expected_ack"]}}) + "\n" +
                json.dumps({"id": "response-1", "session_id": "session-1", "message": {"text": f"decision-1 {digest}"}}) + "\n",
                encoding="utf-8",
            )
            ack = parse_model_artifact_observation(store=store, observation_source="provider_rollout", artifact_path=rollout, record_index=1)
            response = parse_model_artifact_observation(store=store, observation_source="provider_rollout", artifact_path=rollout, record_index=2)
            record_model_observation(store=store, delivery_id="delivery-2", ack_observation=ack, response_observation=response)
            envelope = capture_supervisor_decision(store=store, decision_packet=packet, delivery_id="delivery-2")
            provenance = envelope["provenance"]
            self.assertEqual(provenance["observation_trust"], "HOST_PARSED_PROVIDER_ARTIFACT")
            self.assertEqual(provenance["artifact_sha256"], response["artifact_sha256"])
            self.assertEqual(provenance["artifact_record_sha256"], response["artifact_record_sha256"])
            self.assertEqual(provenance["observed_message_id"], "native:response-1")

    def test_terminal_wrapped_ack_is_accepted_only_after_ascii_whitespace_normalization(self):
        with tempfile.TemporaryDirectory() as td:
            store, _ = self.setup_store(td)
            rec = create_delivery(
                store=store,
                recipient_role="authoritative_supervisor",
                terminal_id="terminal-1",
                profile="mlgo-supervisor",
                generation=1,
                provider="codex",
                provider_session_id="session-1",
                payload="decide",
                delivery_id="delivery-wrapped",
            )
            expected = rec["expected_ack"]
            wrapped = "\n".join(expected[index:index + 19] for index in range(0, len(expected), 19))
            event_dir = store.v2_dir / "model-events"
            event_dir.mkdir(parents=True, exist_ok=True)
            event = event_dir / "wrapped-ack.jsonl"
            event.write_text(
                json.dumps({
                    "event_id": "wrapped-ack-1",
                    "run_id": "run-1",
                    "terminal_id": "terminal-1",
                    "profile": "mlgo-supervisor",
                    "generation": 1,
                    "provider": "codex",
                    "provider_session_id": "session-1",
                    "output": wrapped,
                }) + "\n",
                encoding="utf-8",
            )
            observation = parse_model_artifact_observation(
                store=store,
                observation_source="cao_model_event",
                artifact_path=event,
                record_index=1,
            )
            recorded = record_model_observation(
                store=store,
                delivery_id="delivery-wrapped",
                ack_observation=observation,
            )
            self.assertEqual(recorded["status"], "MODEL_ACKNOWLEDGED")
            self.assertEqual(recorded["ack_match_mode"], "ASCII_WHITESPACE_NORMALIZED")

    def test_terminal_wrapped_ack_rejects_non_whitespace_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            store, _ = self.setup_store(td)
            rec = create_delivery(
                store=store,
                recipient_role="authoritative_supervisor",
                terminal_id="terminal-1",
                profile="mlgo-supervisor",
                generation=1,
                provider="codex",
                provider_session_id="session-1",
                payload="decide",
                delivery_id="delivery-mutated",
            )
            mutated = rec["expected_ack"][:-1] + "X"
            event_dir = store.v2_dir / "model-events"
            event_dir.mkdir(parents=True, exist_ok=True)
            event = event_dir / "mutated-ack.jsonl"
            event.write_text(
                json.dumps({
                    "event_id": "mutated-ack-1",
                    "run_id": "run-1",
                    "terminal_id": "terminal-1",
                    "profile": "mlgo-supervisor",
                    "generation": 1,
                    "provider": "codex",
                    "provider_session_id": "session-1",
                    "output": mutated,
                }) + "\n",
                encoding="utf-8",
            )
            observation = parse_model_artifact_observation(
                store=store,
                observation_source="cao_model_event",
                artifact_path=event,
                record_index=1,
            )
            with self.assertRaises(PolicyError):
                record_model_observation(
                    store=store,
                    delivery_id="delivery-mutated",
                    ack_observation=observation,
                )

    def test_arbitrary_caller_artifact_cannot_claim_provider_rollout_trust(self):
        with tempfile.TemporaryDirectory() as td:
            store, _ = self.setup_store(td)
            forged = Path(td) / "forged.jsonl"
            forged.write_text(json.dumps({"id": "forged", "message": {"text": "anything"}}) + "\n")
            with self.assertRaises(PolicyError):
                parse_model_artifact_observation(store=store, observation_source="provider_rollout", artifact_path=forged, record_index=1)

    def test_manual_observation_remains_untrusted_for_material_authority(self):
        with tempfile.TemporaryDirectory() as td:
            store, _ = self.setup_store(td)
            rec = create_delivery(
                store=store,
                recipient_role="authoritative_supervisor",
                terminal_id="terminal-1",
                profile="mlgo-supervisor",
                generation=1,
                provider="codex",
                provider_session_id="session-1",
                payload="decide",
                delivery_id="delivery-manual",
            )
            packet = self.decision_packet()
            record_manual_observation(
                store=store,
                delivery_id="delivery-manual",
                observed_text=rec["expected_ack"],
                response_text="decision-1",
                source_note="operator pasted transcript text",
            )
            with self.assertRaises(PolicyError):
                capture_supervisor_decision(store=store, decision_packet=packet, delivery_id="delivery-manual")

    def test_all_corrected_side_effect_boundaries_share_crash_safe_ledger(self):
        operation_types = ("validation", "commit", "review_dispatch", "integration", "task_lead_notification")
        for operation_type in operation_types:
            with self.subTest(operation_type=operation_type), tempfile.TemporaryDirectory() as td:
                ledger = OperationLedger(td)
                external = {}
                calls = []
                operation_id = f"op-{operation_type.replace('_', '-')}"

                def apply():
                    calls.append(operation_type)
                    external[operation_id] = {"external_identity": f"ext-{operation_type}"}
                    return external[operation_id]

                def verify(_):
                    return external.get(operation_id)

                def fault(stage, _record):
                    if stage == "after_apply_before_record":
                        raise RuntimeError("injected crash")

                with self.assertRaises(RuntimeError):
                    ledger.execute(operation_id=operation_id, operation_type=operation_type, inputs={"boundary": operation_type}, apply=apply, verify_existing=verify, fault_hook=fault)
                recovered = ledger.execute(operation_id=operation_id, operation_type=operation_type, inputs={"boundary": operation_type}, apply=apply, verify_existing=verify)
                self.assertEqual(calls, [operation_type])
                self.assertEqual(recovered["status"], "VERIFIED")
                self.assertTrue(recovered["recovered_after_interruption"])


class ReviewDispatchReconciliationTest(unittest.TestCase):
    def _committed_store(self, td: str) -> RunStore:
        store = RunStore(td, "run-review")
        store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
        store.register_big_task("task-a", "/tmp/charter.json", None)
        store.register_phase({"phase_id": "phase-a", "big_task_id": "task-a", "phase_kind": "implementation"}, "/tmp/phase.json")
        for target in ("ROUTING_PENDING", "ROUTED", "DISPATCHED", "RUNNING", "RESULT_READY", "COMMIT_READY", "COMMITTED"):
            store.transition_phase("phase-a", target, reason="test setup")
        return store

    def test_unknown_review_dispatch_pauses_until_external_reconciliation(self):
        with tempfile.TemporaryDirectory() as td:
            store = self._committed_store(td)
            unknown = _record_review_dispatch_outcome(
                store=store,
                parent_phase_id="phase-a",
                review_phase_id="phase-a-review",
                operation_id="op-phase-a-review-dispatch",
                operation={"status": "UNKNOWN_AFTER_APPLY", "operation_id": "op-phase-a-review-dispatch"},
            )
            self.assertFalse(unknown["progressed"])
            self.assertTrue(unknown["reconciliation_required"])
            self.assertEqual(store.load()["phases"]["phase-a"]["state"], "REVIEW_DISPATCH_RECONCILIATION_REQUIRED")

            verified = _record_review_dispatch_outcome(
                store=store,
                parent_phase_id="phase-a",
                review_phase_id="phase-a-review",
                operation_id="op-phase-a-review-dispatch",
                operation={"status": "VERIFIED", "operation_id": "op-phase-a-review-dispatch", "result": {"job_path": "/tmp/job.json"}},
            )
            self.assertTrue(verified["progressed"])
            self.assertEqual(store.load()["phases"]["phase-a"]["state"], "REVIEW_PENDING")


if __name__ == "__main__":
    unittest.main()
