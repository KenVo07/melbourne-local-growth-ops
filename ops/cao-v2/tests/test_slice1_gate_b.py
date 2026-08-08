from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.commands import CommandCoordinator, CommandLedger, new_command_envelope
from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.contract_binding import create_run_contract_binding
from mlgo_cao_v2.leases import ExecutorLeaseStore
from mlgo_cao_v2.operations import OperationLedger
from mlgo_cao_v2.state_machine import RunStore
from mlgo_cao_v2.transport import ObservationState, ReconcileResult, SubmitCertainty, SubmitResult


class FakeAdapter:
    adapter_id = "fake"
    def __init__(self, *, submit_certainty=SubmitCertainty.ACCEPTED, reconcile_state=ObservationState.COMPLETED, observe_state=None, exact=True):
        self.submit_certainty = submit_certainty
        self.reconcile_state = reconcile_state
        self.observe_state = observe_state or reconcile_state
        self.exact = exact
        self.submit_count = 0
        self.reconcile_count = 0
        self.observe_count = 0
        self.external_effects = 0
        self.receipt = "receipt-1"
    def submit(self, command, request):
        self.submit_count += 1
        if self.submit_certainty != SubmitCertainty.NOT_SENT_CONFIRMED:
            self.external_effects += 1
        return SubmitResult(self.submit_certainty, receipt_id=self.receipt, response={"submitted": True}, provider_started=self.submit_certainty != SubmitCertainty.NOT_SENT_CONFIRMED)
    def observe(self, command, receipt_id):
        self.observe_count += 1
        return ReconcileResult(self.observe_state, receipt_id=receipt_id or self.receipt, result={"receipt": self.receipt}, exact=self.exact, provider_started=True)
    def reconcile(self, command):
        self.reconcile_count += 1
        return ReconcileResult(self.reconcile_state, receipt_id=self.receipt, result={"receipt": self.receipt}, exact=self.exact, provider_started=True, error=None if self.exact else "still ambiguous")
    def cancel(self, command, receipt_id):
        return ReconcileResult(ObservationState.CANCELLED, receipt_id=receipt_id, exact=True)
    def cleanup(self, command, receipt_id):
        return {"status": "CLEANED"}


def qualified_capability(name="ambiguous_outcome_lookup", profile_id="fake-builder"):
    return {
        "enabled": True, "policy_enabled": True, "qualification_valid": True,
        "maturity": "QUALIFIED", "qualification_id": "qual-fake",
        "qualification_evidence_sha256": "f" * 64,
        "qualification_identity_digest": "e" * 64,
        "profile_id": profile_id, "capability": name,
    }


def make_env(lease):
    request = {"payload": "slice1"}
    return new_command_envelope(
        command_id="cmd-slice1", run_id="run-slice1", task_id="task-slice1", phase_id="phase-slice1", attempt_id="attempt-1",
        command_type="provider.submit", request=request, expected_pre_state={"state_version": 1},
        registry_digest="a" * 64, policy_digest="b" * 64, runtime_version="0.3.0-slice1-vnext",
        build_manifest_sha256="c" * 64, provider_profile_id="fake-builder", provider_id="fake",
        account_profile_id="fake-account", transport_id="fake-transport", model="fake-model", executor_lease=lease,
    ), request


def make_binding():
    files = [{"name": "command.schema.json", "sha256": "d" * 64}]
    from mlgo_cao_v2.common import sha256_json
    return create_run_contract_binding(
        runtime_version="0.3.0-slice1-vnext", build_id="build-b", build_manifest_sha256="c" * 64,
        registry_digest="a" * 64, policy_digest="b" * 64, schema_bundle_record={"files": files, "digest": sha256_json(files)},
        enabled_writers=["run_state", "commands"], minimum_reader_version="0.3.0", minimum_writer_version="0.3.0",
        compatible_writer_ids=["slice1-controller"],
    )


def writer(binding, lease):
    return {
        "writer_id": "slice1-controller", "writer_version": "0.3.0",
        "registry_digest": binding["registry_digest"], "policy_digest": binding["policy_digest"],
        "schema_bundle_digest": binding["schema_bundle_digest"], "build_manifest_sha256": binding["build_manifest_sha256"],
        "writer_features": ["run_state"], "executor_lease": lease,
    }


class Slice1GateBTests(unittest.TestCase):
    def setup_command(self, td, *, max_attempts=3, adapter=None):
        runv2 = Path(td) / "run-v2"
        leases = ExecutorLeaseStore(runv2)
        lease = leases.acquire("controller-a")
        ledger = CommandLedger(runv2)
        coord = CommandCoordinator(ledger=ledger, lease_store=leases, max_reconciliation_attempts=max_attempts)
        env, request = make_env(lease)
        return runv2, leases, lease, ledger, coord, env, request, adapter or FakeAdapter()

    def test_command_envelope_rebuild_is_stable_and_bare_boolean_capability_is_not_trusted(self):
        with tempfile.TemporaryDirectory() as td:
            _, _, lease, ledger, coord, env, request, adapter = self.setup_command(td)
            env2, _ = make_env(lease)
            self.assertEqual(env["nonce"], env2["nonce"])
            first = ledger.prepare(env)
            second = ledger.prepare(env2)
            self.assertEqual(first["envelope_digest"], second["envelope_digest"])
            # A caller-supplied True is not capability qualification evidence.
            adapter.submit_certainty = SubmitCertainty.UNKNOWN_AFTER_SUBMIT
            out = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": True})
            self.assertEqual(out["status"], "BLOCKED_MANUAL")

    def test_command_request_fingerprint_and_capability_profile_are_bound(self):
        with tempfile.TemporaryDirectory() as td:
            _, _, _, _, coord, env, request, adapter = self.setup_command(td)
            with self.assertRaises(PolicyError):
                coord.dispatch(envelope=env, request={"payload": "different"}, adapter=adapter, capabilities={})
            self.assertEqual(adapter.submit_count, 0)
        with tempfile.TemporaryDirectory() as td:
            adapter = FakeAdapter(submit_certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT)
            _, _, _, _, coord, env, request, _ = self.setup_command(td, adapter=adapter)
            out = coord.dispatch(
                envelope=env, request=request, adapter=adapter,
                capabilities={"ambiguous_outcome_lookup": qualified_capability(profile_id="other-profile")},
            )
            self.assertEqual(out["status"], "BLOCKED_MANUAL")
            self.assertEqual(adapter.submit_count, 1)

    def test_B01_crash_before_transport_write_is_exact_not_sent(self):
        with tempfile.TemporaryDirectory() as td:
            _, _, _, _, coord, env, request, adapter = self.setup_command(td)
            def fault(stage, record):
                if stage == "before_transport_write":
                    raise RuntimeError("crash-before-write")
            out = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()}, fault_hook=fault)
            self.assertEqual(out["status"], "NOT_SENT_CONFIRMED")
            self.assertEqual(adapter.submit_count, 0)
            self.assertFalse(out["provider_started"])

    def test_B02_possible_send_with_lookup_reconciles_without_resubmit(self):
        with tempfile.TemporaryDirectory() as td:
            adapter = FakeAdapter(submit_certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT, reconcile_state=ObservationState.COMPLETED)
            _, _, _, _, coord, env, request, _ = self.setup_command(td, adapter=adapter)
            out = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(out["status"], "COMPLETED")
            self.assertEqual(adapter.submit_count, 1)
            self.assertEqual(adapter.external_effects, 1)
            self.assertEqual(adapter.reconcile_count, 1)

    def test_B03_lookup_without_replay_guarantee_never_resends(self):
        with tempfile.TemporaryDirectory() as td:
            adapter = FakeAdapter(submit_certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT, reconcile_state=ObservationState.UNKNOWN, exact=False)
            _, _, _, _, coord, env, request, _ = self.setup_command(td, max_attempts=3, adapter=adapter)
            out = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability(), "idempotent_replay": {"enabled": False}})
            self.assertEqual(out["status"], "RECONCILIATION_REQUIRED")
            out = coord.reconcile(env["command_id"], adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertIn(out["status"], {"RECONCILIATION_REQUIRED", "BLOCKED_MANUAL"})
            self.assertEqual(adapter.submit_count, 1)

    def test_B04_no_lookup_or_idempotency_blocks_manual(self):
        with tempfile.TemporaryDirectory() as td:
            adapter = FakeAdapter(submit_certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT)
            _, _, _, _, coord, env, request, _ = self.setup_command(td, adapter=adapter)
            out = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={})
            self.assertEqual(out["status"], "BLOCKED_MANUAL")
            self.assertEqual(adapter.submit_count, 1)
            self.assertEqual(adapter.reconcile_count, 0)

    def test_B05_duplicate_result_observation_is_idempotent(self):
        with tempfile.TemporaryDirectory() as td:
            adapter = FakeAdapter(observe_state=ObservationState.IN_PROGRESS)
            _, _, _, ledger, coord, env, request, _ = self.setup_command(td, adapter=adapter)
            out = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(out["status"], "OBSERVED_IN_PROGRESS")
            observation = {"receipt_id": "receipt-1", "result_sha256": "e" * 64}
            first = ledger.observe_result(env["command_id"], observation, final_state="COMPLETED")
            second = ledger.observe_result(env["command_id"], observation, final_state="COMPLETED")
            self.assertEqual(first["status"], "COMPLETED")
            self.assertTrue(second["duplicate_observation"])
            self.assertEqual(len(second["observations"]), 1)

    def test_B06_persistent_ambiguity_is_bounded_and_blocks(self):
        with tempfile.TemporaryDirectory() as td:
            adapter = FakeAdapter(submit_certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT, reconcile_state=ObservationState.UNKNOWN, exact=False)
            _, _, _, _, coord, env, request, _ = self.setup_command(td, max_attempts=2, adapter=adapter)
            first = coord.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(first["status"], "RECONCILIATION_REQUIRED")
            final = coord.reconcile(env["command_id"], adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(final["status"], "BLOCKED_MANUAL")
            self.assertEqual(adapter.submit_count, 1)
            self.assertEqual(final["reconciliation_attempts"], 2)

    def test_B07_new_epoch_fences_old_command_runstore_and_operation_application(self):
        with tempfile.TemporaryDirectory() as td:
            runv2, leases, lease_a, ledger, coord_a, env, request, adapter = self.setup_command(td)
            # Establish a command, then replace the lease before old coordinator applies a late outcome.
            adapter.observe_state = ObservationState.IN_PROGRESS
            out = coord_a.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(out["status"], "OBSERVED_IN_PROGRESS")
            lease_b = leases.acquire("controller-b", replace=True)
            with self.assertRaises(PolicyError):
                coord_a.reconcile(env["command_id"], adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            # vNext RunStore also rejects the old epoch before a durable WAL mutation.
            binding = make_binding()
            state_root = Path(td) / "state"
            run_lease_store = ExecutorLeaseStore(state_root / "runs" / "run-b07" / "v2")
            run_a = run_lease_store.acquire("controller-a")
            store_a = RunStore(state_root, "run-b07", writer_context=writer(binding, run_a), lease_store=run_lease_store)
            initial = store_a.initialize(mode="v2_shadow", supervisor_profile="mlgo-claude-subscription-supervisor", supervisor_account_pool="claude-subscription", run_contract_binding=binding)
            run_lease_store.acquire("controller-b", replace=True)
            with self.assertRaises(PolicyError):
                store_a.set_run_status("ACTIVE", reason="stale")
            self.assertEqual(store_a.load()["state_version"], initial["state_version"])
            # OperationLedger stale executor cannot enter apply.
            effects = []
            ops = OperationLedger(runv2, lease_store=leases)
            with self.assertRaises(PolicyError):
                ops.execute(operation_id="op-b07", operation_type="test", inputs={"x": 1}, apply=lambda: effects.append(1) or {"external_identity": "x"}, verify_existing=lambda rec: None, executor_lease=lease_a)
            self.assertEqual(effects, [])
            ops.prepare(operation_id="op-b07-fail", operation_type="test", inputs={"command_id": env["command_id"]})
            with self.assertRaises(PolicyError):
                ops.fail("op-b07-fail", "stale disposition", executor_lease=lease_a)
            self.assertEqual(ops.load("op-b07-fail")["status"], "PREPARED")
            self.assertEqual(lease_b["epoch"], lease_a["epoch"] + 1)

    def test_B08_lease_loss_immediately_before_send_sends_zero(self):
        with tempfile.TemporaryDirectory() as td:
            _, leases, _, ledger, coord_a, env, request, adapter = self.setup_command(td)
            holder = {}
            def fault(stage, record):
                if stage == "before_transport_write":
                    holder["lease_b"] = leases.acquire("controller-b", replace=True)
            with self.assertRaises(PolicyError):
                coord_a.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()}, fault_hook=fault)
            self.assertEqual(adapter.submit_count, 0)
            coord_b = CommandCoordinator(ledger=ledger, lease_store=leases)
            coord_b.claim_reconciliation(env["command_id"], executor_lease=holder["lease_b"])
            recovered = coord_b.reconcile(env["command_id"], adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(recovered["status"], "NOT_SENT_CONFIRMED")

    def test_B09_already_sent_then_lease_loss_reconciles_without_local_stale_apply(self):
        with tempfile.TemporaryDirectory() as td:
            _, leases, _, ledger, coord_a, env, request, adapter = self.setup_command(td)
            holder = {}
            def fault(stage, record):
                if stage == "after_transport_submit":
                    holder["lease_b"] = leases.acquire("controller-b", replace=True)
            with self.assertRaises(PolicyError):
                coord_a.dispatch(envelope=env, request=request, adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()}, fault_hook=fault)
            self.assertEqual(adapter.submit_count, 1)
            stuck = ledger.load(env["command_id"])
            self.assertEqual(stuck["status"], "DISPATCHING")
            self.assertEqual(stuck["transport_crossing"], "SUBMITTING")
            coord_b = CommandCoordinator(ledger=ledger, lease_store=leases)
            coord_b.claim_reconciliation(env["command_id"], executor_lease=holder["lease_b"])
            final = coord_b.reconcile(env["command_id"], adapter=adapter, capabilities={"ambiguous_outcome_lookup": qualified_capability()})
            self.assertEqual(final["status"], "COMPLETED")
            self.assertEqual(adapter.submit_count, 1)
            self.assertEqual(adapter.external_effects, 1)

    def test_B10_operation_crash_recovery_does_not_repeat_external_effect(self):
        with tempfile.TemporaryDirectory() as td:
            runv2 = Path(td) / "v2"
            ops = OperationLedger(runv2)
            external = {"count": 0, "exists": False}
            def apply():
                external["count"] += 1
                external["exists"] = True
                return {"external_identity": "effect-1"}
            def verify(record):
                return {"external_identity": "effect-1"} if external["exists"] else None
            def crash(stage, record):
                if stage == "after_apply_before_record":
                    raise RuntimeError("injected crash")
            with self.assertRaises(RuntimeError):
                ops.execute(operation_id="op-b10", operation_type="fixture", inputs={"x": 1}, apply=apply, verify_existing=verify, fault_hook=crash)
            recovered = ops.execute(operation_id="op-b10", operation_type="fixture", inputs={"x": 1}, apply=apply, verify_existing=verify)
            self.assertEqual(recovered["status"], "VERIFIED")
            self.assertEqual(external["count"], 1)


if __name__ == "__main__":
    unittest.main()
