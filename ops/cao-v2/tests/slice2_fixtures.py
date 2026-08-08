"""Deterministic fixtures shared by the Slice 2 acceptance gates.

Everything here is local and deterministic.  No real provider or model is
contacted, no network call is made, and no host service is touched.  The
"provider" is a counting fake whose external-effect ledger the tests inspect
directly, which is what makes "never repeat completed provider work" a
falsifiable claim rather than an assertion of intent.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from mlgo_cao_v2.commands import CommandCoordinator, CommandLedger, new_command_envelope
from mlgo_cao_v2.common import sha256_json
from mlgo_cao_v2.contract_binding import (
    SLICE2_SCHEMA_NAMES,
    SLICE2_WRITER_FEATURES,
    create_run_contract_binding,
)
from mlgo_cao_v2.leases import ExecutorLeaseStore
from mlgo_cao_v2.operations import OperationLedger
from mlgo_cao_v2.state_machine import RunStore
from mlgo_cao_v2.transport import ObservationState, ReconcileResult, SubmitCertainty, SubmitResult

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "config" / "cao-policy.json"
REGISTRY = ROOT / "registry" / "provider-registry.json"
SCHEMAS = ROOT / "schemas"

RUNTIME_VERSION = "0.4.0-slice2-vnext"
SHA_REGISTRY = "a" * 64
SHA_POLICY = "b" * 64
SHA_SCHEMAS = "c" * 64
SHA_BUILD = "d" * 64

SUPERVISOR_PROFILE = "mlgo-claude-subscription-supervisor"


class CountingProvider:
    """A durable-effect-counting fake transport.

    ``external_effects`` counts side effects that actually crossed the transport
    boundary.  A correct recovery path never increases it a second time for the
    same logical unit of work.
    """

    adapter_id = "slice2-deterministic-fake"

    def __init__(self, *, submit_certainty: str = SubmitCertainty.ACCEPTED,
                 observe_state: str = ObservationState.COMPLETED,
                 reconcile_state: str = ObservationState.COMPLETED, exact: bool = True):
        self.submit_certainty = submit_certainty
        self.observe_state = observe_state
        self.reconcile_state = reconcile_state
        self.exact = exact
        self.submit_count = 0
        self.observe_count = 0
        self.reconcile_count = 0
        self.external_effects = 0
        self.effects_by_command: dict[str, int] = {}

    def _receipt(self, command: dict[str, Any]) -> str:
        return f"receipt-{command.get('command_id')}"

    def submit(self, command, request):
        self.submit_count += 1
        command_id = str(command.get("command_id"))
        if self.submit_certainty != SubmitCertainty.NOT_SENT_CONFIRMED:
            self.external_effects += 1
            self.effects_by_command[command_id] = self.effects_by_command.get(command_id, 0) + 1
        return SubmitResult(
            self.submit_certainty, receipt_id=self._receipt(command), response={"submitted": True},
            provider_started=self.submit_certainty != SubmitCertainty.NOT_SENT_CONFIRMED,
        )

    def observe(self, command, receipt_id):
        self.observe_count += 1
        return ReconcileResult(
            self.observe_state, receipt_id=receipt_id or self._receipt(command),
            result={"receipt": receipt_id or self._receipt(command)}, exact=self.exact, provider_started=True,
        )

    def reconcile(self, command):
        self.reconcile_count += 1
        return ReconcileResult(
            self.reconcile_state, receipt_id=self._receipt(command),
            result={"receipt": self._receipt(command)}, exact=self.exact, provider_started=True,
            error=None if self.exact else "still ambiguous",
        )

    def cancel(self, command, receipt_id):
        return ReconcileResult(ObservationState.CANCELLED, receipt_id=receipt_id, exact=True)

    def cleanup(self, command, receipt_id):
        return {"status": "CLEANED"}


def qualified_capability(name: str = "ambiguous_outcome_lookup", profile_id: str = "fake-builder") -> dict[str, Any]:
    return {
        "enabled": True, "policy_enabled": True, "qualification_valid": True,
        "maturity": "QUALIFIED", "qualification_id": f"qual-{name}",
        "qualification_evidence_sha256": "f" * 64, "qualification_identity_digest": "e" * 64,
        "profile_id": profile_id, "capability": name,
    }


LOOKUP_CAPABILITIES = {"ambiguous_outcome_lookup": qualified_capability()}


def slice2_binding(*, enabled_writers: list[str] | None = None) -> dict[str, Any]:
    files = [{"name": name, "sha256": SHA_SCHEMAS} for name in sorted(SLICE2_SCHEMA_NAMES)]
    files.append({"name": "command.schema.json", "sha256": SHA_SCHEMAS})
    files.sort(key=lambda item: item["name"])
    writers = enabled_writers if enabled_writers is not None else ["run_state", "commands"]
    return create_run_contract_binding(
        runtime_version=RUNTIME_VERSION, build_id="build-slice2-test", build_manifest_sha256=SHA_BUILD,
        registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY,
        schema_bundle_record={"files": files, "digest": sha256_json(files)},
        enabled_writers=writers, minimum_reader_version="0.4.0", minimum_writer_version="0.4.0",
        compatible_writer_ids=["slice2-controller"],
    )


def all_slice2_writers() -> list[str]:
    return ["run_state", "commands", *SLICE2_WRITER_FEATURES]


def command_envelope(*, command_id: str, lease: dict[str, Any], run_id: str = "run-slice2",
                     task_id: str = "task-slice2", phase_id: str = "phase-slice2",
                     request: dict[str, Any] | None = None,
                     command_type: str = "provider.submit") -> tuple[dict[str, Any], dict[str, Any]]:
    payload = request or {"payload": command_id}
    envelope = new_command_envelope(
        command_id=command_id, run_id=run_id, task_id=task_id, phase_id=phase_id, attempt_id="attempt-1",
        command_type=command_type, request=payload, expected_pre_state={"state_version": 1},
        registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY, runtime_version=RUNTIME_VERSION,
        build_manifest_sha256=SHA_BUILD, provider_profile_id="fake-builder", provider_id="fake",
        account_profile_id="fake-account", transport_id="fake-transport", model="fake-model",
        executor_lease=lease,
    )
    return envelope, payload


class Controller:
    """A recreatable controller face over one durable run directory.

    Constructing a new ``Controller`` for the same directory is exactly what a
    process/host restart does: nothing is carried over in memory.
    """

    def __init__(self, state_root: str | Path, run_id: str = "run-slice2", owner_id: str | None = None):
        self.state_root = Path(state_root)
        self.run_id = run_id
        self.run_v2 = self.state_root / "runs" / run_id / "v2"
        self.run_v2.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.leases = ExecutorLeaseStore(self.run_v2)
        # A recreated controller is a *new* executor instance, so it takes a
        # strictly newer epoch exactly as a restarted process would.
        previous = self.leases.load()
        instance = int((previous or {}).get("epoch", 0)) + 1
        self.owner_id = owner_id or f"slice2-controller-{instance}"
        self.lease = self.leases.acquire(self.owner_id, replace=True)
        self.command_ledger = CommandLedger(self.run_v2)
        self.operation_ledger = OperationLedger(self.run_v2, lease_store=self.leases)
        self.coordinator = CommandCoordinator(ledger=self.command_ledger, lease_store=self.leases)
        self.store = RunStore(self.state_root, run_id)

    def initialize(self, *, supervisor_profile: str = SUPERVISOR_PROFILE) -> dict[str, Any]:
        return self.store.initialize(mode="v2_shadow", supervisor_profile=supervisor_profile,
                                     supervisor_account_pool="claude-subscription")
