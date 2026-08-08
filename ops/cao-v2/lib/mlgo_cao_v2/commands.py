"""Durable provider-neutral Command envelope and outcome reconciliation."""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .common import ContractError, PolicyError, atomic_write_json, file_lock, iso_now, load_json, sha256_json, validate_id
from .leases import ExecutorLeaseStore
from .transport import ObservationState, ReconcileResult, SubmitCertainty, TransportAdapter, TransportSubmitError

COMMAND_SCHEMA_VERSION = "1.0"
COMMAND_STATES = {
    "PREPARED", "DISPATCHING", "NOT_SENT_CONFIRMED", "UNKNOWN_AFTER_SUBMIT",
    "ACCEPTED", "OBSERVED_IN_PROGRESS", "COMPLETED", "RECONCILIATION_REQUIRED",
    "BLOCKED_MANUAL", "FAILED", "CANCELLED",
}
TERMINAL_STATES = {"NOT_SENT_CONFIRMED", "COMPLETED", "BLOCKED_MANUAL", "FAILED", "CANCELLED"}
LEGAL = {
    "PREPARED": {"DISPATCHING", "FAILED", "CANCELLED"},
    "DISPATCHING": {"NOT_SENT_CONFIRMED", "UNKNOWN_AFTER_SUBMIT", "ACCEPTED", "FAILED", "CANCELLED"},
    "UNKNOWN_AFTER_SUBMIT": {"RECONCILIATION_REQUIRED", "ACCEPTED", "OBSERVED_IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED_MANUAL"},
    "RECONCILIATION_REQUIRED": {"ACCEPTED", "OBSERVED_IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "BLOCKED_MANUAL"},
    "ACCEPTED": {"OBSERVED_IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "RECONCILIATION_REQUIRED"},
    "OBSERVED_IN_PROGRESS": {"OBSERVED_IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "RECONCILIATION_REQUIRED"},
    "NOT_SENT_CONFIRMED": set(), "COMPLETED": set(), "BLOCKED_MANUAL": set(), "FAILED": set(), "CANCELLED": set(),
}

FaultHook = Callable[[str, dict[str, Any]], None]


class CommandLedger:
    def __init__(self, run_v2_dir: str | Path):
        self.root = Path(run_v2_dir) / "commands"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.global_lock = self.root / ".commands.lock"
        self.locks = self.root / ".locks"
        self.locks.mkdir(parents=True, exist_ok=True, mode=0o700)

    def path(self, command_id: str) -> Path:
        validate_id(command_id, "command_id")
        return self.root / f"{command_id}.json"

    def lock_path(self, command_id: str) -> Path:
        validate_id(command_id, "command_id")
        return self.locks / f"{command_id}.lock"

    def load(self, command_id: str) -> dict[str, Any] | None:
        path = self.path(command_id)
        return load_json(path) if path.exists() else None

    def prepare(self, envelope: dict[str, Any]) -> dict[str, Any]:
        required = (
            "command_id", "run_id", "task_id", "phase_id", "attempt_id", "command_type", "idempotency_key",
            "request_fingerprint", "expected_pre_state", "registry_digest", "policy_digest",
            "runtime_version", "build_manifest_sha256", "provider_profile_id", "provider_id",
            "account_profile_id", "transport_id", "model", "executor_lease",
        )
        if envelope.get("schema_version") != COMMAND_SCHEMA_VERSION:
            raise ContractError("command schema_version must be 1.0")
        for field in required:
            if field not in envelope:
                raise ContractError(f"command missing {field}")
        command_id = validate_id(str(envelope["command_id"]), "command_id")
        fingerprint = sha256_json({k: envelope[k] for k in sorted(envelope) if k not in {"created_at", "updated_at", "status"}})
        path = self.path(command_id)
        with file_lock(self.global_lock):
            if path.exists():
                existing = load_json(path)
                if existing.get("envelope_digest") != fingerprint:
                    raise PolicyError(f"command ID reused with different envelope: {command_id}")
                return existing
            now = iso_now()
            record = {
                **envelope,
                "status": "PREPARED",
                "envelope_digest": fingerprint,
                # Submission lease is immutable inside the envelope.  The
                # active executor lease may move to a successor only through
                # the explicit reconciliation-claim protocol.
                "active_executor_lease": dict(envelope["executor_lease"]),
                "receipt_id": None,
                "provider_started": False,
                "reconciliation_attempts": 0,
                "observations": [],
                "result": None,
                "last_error": None,
                "created_at": now,
                "updated_at": now,
            }
            atomic_write_json(path, record)
            return record

    def _transition(self, command_id: str, target: str, **updates: Any) -> dict[str, Any]:
        if target not in COMMAND_STATES:
            raise ContractError(f"invalid command state: {target}")
        path = self.path(command_id)
        record = load_json(path)
        current = str(record["status"])
        if target != current and target not in LEGAL.get(current, set()):
            raise PolicyError(f"illegal command transition: {current} -> {target}")
        record.update(updates)
        record["status"] = target
        record["updated_at"] = iso_now()
        atomic_write_json(path, record)
        return record

    def observe_result(self, command_id: str, observation: dict[str, Any], *, final_state: str) -> dict[str, Any]:
        with file_lock(self.lock_path(command_id)):
            record = self.load(command_id)
            if record is None:
                raise ContractError(f"unknown command: {command_id}")
            digest = sha256_json(observation)
            seen = {item.get("digest") for item in record.get("observations", [])}
            if digest in seen:
                return {**record, "duplicate_observation": True}
            observations = list(record.get("observations", []))
            observations.append({"digest": digest, "observed_at": iso_now(), "payload": observation})
            if record["status"] in TERMINAL_STATES:
                # Conflicting late facts never rewrite a terminal command.
                return {**record, "duplicate_observation": False, "late_observation_ignored": True}
            return self._transition(command_id, final_state, observations=observations, result=observation)


class CommandCoordinator:
    def __init__(self, *, ledger: CommandLedger, lease_store: ExecutorLeaseStore, max_reconciliation_attempts: int = 3):
        self.ledger = ledger
        self.lease_store = lease_store
        if not 1 <= int(max_reconciliation_attempts) <= 20:
            raise ContractError("max_reconciliation_attempts must be 1..20")
        self.max_reconciliation_attempts = int(max_reconciliation_attempts)

    def _require_fence(self, command: dict[str, Any]) -> dict[str, Any]:
        lease = command.get("active_executor_lease") or command["executor_lease"]
        return self.lease_store.require(owner_id=lease["owner_id"], epoch=int(lease["epoch"]), token=lease["token"])

    @staticmethod
    def _qualified_capability(command: dict[str, Any], capabilities: dict[str, Any], name: str) -> bool:
        decision = capabilities.get(name)
        if not isinstance(decision, dict):
            return False
        return bool(
            decision.get("enabled") is True
            and decision.get("policy_enabled") is True
            and decision.get("qualification_valid") is True
            and decision.get("maturity") == "QUALIFIED"
            and decision.get("capability") == name
            and decision.get("profile_id") == command.get("provider_profile_id")
            and isinstance(decision.get("qualification_identity_digest"), str)
            and len(decision.get("qualification_identity_digest")) == 64
        )

    def claim_reconciliation(self, command_id: str, *, executor_lease: dict[str, Any]) -> dict[str, Any]:
        """Transfer only local reconciliation authority to a newer epoch.

        This never changes the immutable submission lease in the Command
        envelope and never implies the earlier external request was cancelled.
        """
        self.lease_store.require(
            owner_id=executor_lease["owner_id"],
            epoch=int(executor_lease["epoch"]),
            token=executor_lease["token"],
        )
        with file_lock(self.ledger.lock_path(command_id)):
            record = self.ledger.load(command_id)
            if record is None:
                raise ContractError(f"unknown command: {command_id}")
            if record["status"] in TERMINAL_STATES:
                raise PolicyError("terminal command cannot transfer reconciliation ownership")
            current = record.get("active_executor_lease") or record["executor_lease"]
            if int(executor_lease["epoch"]) <= int(current["epoch"]):
                raise PolicyError("reconciliation claim requires a strictly newer executor epoch")
            return self.ledger._transition(
                command_id, record["status"],
                active_executor_lease={
                    "owner_id": executor_lease["owner_id"],
                    "epoch": int(executor_lease["epoch"]),
                    "token": executor_lease["token"],
                },
                reconciliation_claimed_at=iso_now(),
                previous_executor_epoch=int(current["epoch"]),
            )

    def dispatch(
        self, *, envelope: dict[str, Any], request: dict[str, Any], adapter: TransportAdapter,
        capabilities: dict[str, bool] | None = None, fault_hook: FaultHook | None = None,
    ) -> dict[str, Any]:
        capabilities = dict(capabilities or {})
        command_id = str(envelope["command_id"])
        with file_lock(self.ledger.lock_path(command_id)):
            record = self.ledger.prepare(envelope)
            if sha256_json(request) != record.get("request_fingerprint"):
                raise PolicyError("dispatch request does not match durable Command request_fingerprint")
            if record["status"] in TERMINAL_STATES:
                return {**record, "duplicate": True}
            if record["status"] == "DISPATCHING":
                record = self._recover_dispatching_locked(record)
                if record["status"] in TERMINAL_STATES:
                    return {**record, "duplicate": True}
            if record["status"] in {"UNKNOWN_AFTER_SUBMIT", "RECONCILIATION_REQUIRED", "ACCEPTED", "OBSERVED_IN_PROGRESS"}:
                return self._reconcile_locked(record, adapter=adapter, capabilities=capabilities, fault_hook=fault_hook)
            if record["status"] != "PREPARED":
                raise PolicyError(f"command is not dispatchable: {record['status']}")
            # Host-side fencing check immediately before any possible external send.
            self._require_fence(record)
            record = self.ledger._transition(command_id, "DISPATCHING", transport_crossing="PRE_SUBMIT_FENCE")
            if fault_hook:
                try:
                    fault_hook("before_transport_write", record)
                except Exception as exc:
                    # The adapter has not been entered.  If this executor still
                    # owns the epoch we can prove NOT_SENT.  If the hook replaced
                    # the epoch, the stale executor writes nothing and a successor
                    # can use PRE_SUBMIT_FENCE as the exact no-send boundary.
                    self._require_fence(record)
                    return self.ledger._transition(
                        command_id, "NOT_SENT_CONFIRMED", provider_started=False,
                        last_error=f"pre-submit abort: {exc}",
                    )
            # Re-check after any host-controlled preparation/fault seam.
            self._require_fence(record)
            # From this durable marker onward, a crash/lease replacement must be
            # treated as a possible send.
            record = self.ledger._transition(command_id, "DISPATCHING", transport_crossing="SUBMITTING")
            try:
                result = adapter.submit(record, request)
            except TransportSubmitError as exc:
                self._require_fence(record)
                if exc.certainty == SubmitCertainty.NOT_SENT_CONFIRMED:
                    return self.ledger._transition(command_id, "NOT_SENT_CONFIRMED", provider_started=False, last_error=str(exc))
                record = self.ledger._transition(
                    command_id, "UNKNOWN_AFTER_SUBMIT", receipt_id=exc.receipt_id,
                    provider_started=bool(exc.provider_started), last_error=str(exc),
                )
                return self._reconcile_locked(record, adapter=adapter, capabilities=capabilities, fault_hook=fault_hook)
            except Exception as exc:
                # Generic exceptions at the crossing are ambiguous by default.
                # A stale executor is forbidden to record even this local fact; a
                # successor will derive UNKNOWN_AFTER_SUBMIT from SUBMITTING.
                self._require_fence(record)
                record = self.ledger._transition(command_id, "UNKNOWN_AFTER_SUBMIT", provider_started=False, last_error=str(exc))
                return self._reconcile_locked(record, adapter=adapter, capabilities=capabilities, fault_hook=fault_hook)
            if fault_hook:
                fault_hook("after_transport_submit", {**record, "submit_result": result.__dict__})
            # The request may already exist externally.  Fencing here protects
            # only durable local application; if ownership changed, leave the
            # command at SUBMITTING for successor reconciliation.
            self._require_fence(record)
            if result.certainty == SubmitCertainty.NOT_SENT_CONFIRMED:
                return self.ledger._transition(command_id, "NOT_SENT_CONFIRMED", provider_started=False, last_error=result.error)
            if result.certainty == SubmitCertainty.UNKNOWN_AFTER_SUBMIT:
                record = self.ledger._transition(command_id, "UNKNOWN_AFTER_SUBMIT", receipt_id=result.receipt_id, provider_started=bool(result.provider_started), last_error=result.error)
                return self._reconcile_locked(record, adapter=adapter, capabilities=capabilities, fault_hook=fault_hook)
            if result.certainty != SubmitCertainty.ACCEPTED:
                raise ContractError(f"adapter returned invalid submit certainty: {result.certainty}")
            record = self.ledger._transition(
                command_id, "ACCEPTED", receipt_id=result.receipt_id,
                provider_started=bool(result.provider_started), submit_response=result.response,
            )
            return self._reconcile_locked(record, adapter=adapter, capabilities=capabilities, fault_hook=fault_hook, accepted_observe=True)

    def _recover_dispatching_locked(self, record: dict[str, Any]) -> dict[str, Any]:
        command_id = str(record["command_id"])
        self._require_fence(record)
        if record.get("transport_crossing") == "PRE_SUBMIT_FENCE":
            return self.ledger._transition(
                command_id, "NOT_SENT_CONFIRMED", provider_started=False,
                last_error="recovered pre-submit fenced command",
            )
        return self.ledger._transition(
            command_id, "UNKNOWN_AFTER_SUBMIT",
            last_error="recovered command after possible transport crossing",
        )

    def reconcile(self, command_id: str, *, adapter: TransportAdapter, capabilities: dict[str, bool] | None = None) -> dict[str, Any]:
        capabilities = dict(capabilities or {})
        with file_lock(self.ledger.lock_path(command_id)):
            record = self.ledger.load(command_id)
            if record is None:
                raise ContractError(f"unknown command: {command_id}")
            if record["status"] in TERMINAL_STATES:
                return {**record, "duplicate": True}
            if record["status"] == "DISPATCHING":
                record = self._recover_dispatching_locked(record)
                if record["status"] in TERMINAL_STATES:
                    return record
            return self._reconcile_locked(record, adapter=adapter, capabilities=capabilities)

    def _reconcile_locked(
        self, record: dict[str, Any], *, adapter: TransportAdapter, capabilities: dict[str, bool],
        fault_hook: FaultHook | None = None, accepted_observe: bool = False,
    ) -> dict[str, Any]:
        command_id = str(record["command_id"])
        # A stale executor may inspect external truth but may not apply durable
        # success/failure to this run. Require the current epoch before every
        # host-owned outcome application.
        self._require_fence(record)
        can_lookup = self._qualified_capability(record, capabilities, "ambiguous_outcome_lookup")
        if record["status"] in {"UNKNOWN_AFTER_SUBMIT", "RECONCILIATION_REQUIRED"} and not can_lookup:
            return self.ledger._transition(command_id, "BLOCKED_MANUAL", last_error="ambiguous submit cannot be reconciled by a qualified lookup capability")
        attempts = int(record.get("reconciliation_attempts", 0))
        if attempts >= self.max_reconciliation_attempts:
            return self.ledger._transition(command_id, "BLOCKED_MANUAL", last_error="bounded reconciliation attempts exhausted")
        attempts += 1
        record = self.ledger._transition(command_id, "RECONCILIATION_REQUIRED" if record["status"] in {"UNKNOWN_AFTER_SUBMIT", "RECONCILIATION_REQUIRED"} else record["status"], reconciliation_attempts=attempts)
        if fault_hook:
            fault_hook("before_reconcile", record)
        outcome: ReconcileResult
        if accepted_observe or record["status"] in {"ACCEPTED", "OBSERVED_IN_PROGRESS"}:
            outcome = adapter.observe(record, record.get("receipt_id"))
        else:
            outcome = adapter.reconcile(record)
        if fault_hook:
            fault_hook("after_reconcile", {**record, "reconcile": outcome.__dict__})
        # Observation/lookup may block.  Re-check ownership before applying any
        # receipt, provider-start or outcome fact to durable local state.
        self._require_fence(record)
        if outcome.receipt_id and not record.get("receipt_id"):
            record = self.ledger._transition(command_id, record["status"], receipt_id=outcome.receipt_id)
        if outcome.provider_started is True and not record.get("provider_started"):
            record = self.ledger._transition(command_id, record["status"], provider_started=True)
        if outcome.state == ObservationState.COMPLETED and outcome.exact:
            self._require_fence(record)
            return self.ledger._transition(command_id, "COMPLETED", result=outcome.result, receipt_id=outcome.receipt_id or record.get("receipt_id"), provider_started=bool(record.get("provider_started") or outcome.provider_started))
        if outcome.state == ObservationState.FAILED and outcome.exact:
            self._require_fence(record)
            return self.ledger._transition(command_id, "FAILED", result=outcome.result, last_error=outcome.error, provider_started=bool(record.get("provider_started") or outcome.provider_started))
        if outcome.state == ObservationState.CANCELLED and outcome.exact:
            self._require_fence(record)
            return self.ledger._transition(command_id, "CANCELLED", result=outcome.result, provider_started=bool(record.get("provider_started") or outcome.provider_started))
        if outcome.state == ObservationState.IN_PROGRESS and outcome.exact:
            return self.ledger._transition(command_id, "OBSERVED_IN_PROGRESS", receipt_id=outcome.receipt_id or record.get("receipt_id"), provider_started=bool(record.get("provider_started") or outcome.provider_started))
        if attempts >= self.max_reconciliation_attempts:
            return self.ledger._transition(command_id, "BLOCKED_MANUAL", last_error=outcome.error or "bounded reconciliation attempts exhausted")
        return self.ledger._transition(command_id, "RECONCILIATION_REQUIRED", last_error=outcome.error or "external outcome remains unknown")


def new_command_envelope(
    *, command_id: str, run_id: str, task_id: str, phase_id: str, attempt_id: str, command_type: str,
    request: dict[str, Any], expected_pre_state: dict[str, Any], registry_digest: str,
    policy_digest: str, runtime_version: str, build_manifest_sha256: str,
    provider_profile_id: str, provider_id: str, account_profile_id: str, transport_id: str, model: str,
    executor_lease: dict[str, Any], idempotency_key: str | None = None,
) -> dict[str, Any]:
    for value, label in ((command_id, "command_id"), (run_id, "run_id"), (task_id, "task_id"), (phase_id, "phase_id"), (attempt_id, "attempt_id")):
        validate_id(value, label)
    idem = idempotency_key or f"idem-{sha256_json([run_id, task_id, phase_id, attempt_id, command_type, request])[:32]}"
    return {
        "schema_version": COMMAND_SCHEMA_VERSION,
        "command_id": command_id,
        "run_id": run_id,
        "task_id": task_id,
        "phase_id": phase_id,
        "attempt_id": attempt_id,
        "command_type": command_type,
        "idempotency_key": idem,
        "request_fingerprint": sha256_json(request),
        "expected_pre_state": expected_pre_state,
        "registry_digest": registry_digest,
        "policy_digest": policy_digest,
        "runtime_version": runtime_version,
        "build_manifest_sha256": build_manifest_sha256,
        "provider_profile_id": provider_profile_id,
        "provider_id": provider_id,
        "account_profile_id": account_profile_id,
        "transport_id": transport_id,
        "model": model,
        "executor_lease": {
            "owner_id": executor_lease["owner_id"],
            "epoch": int(executor_lease["epoch"]),
            "token": executor_lease["token"],
        },
        # Stable per immutable Command identity; rebuilding the same envelope
        # after a process crash must not create an ID-reuse mismatch.
        "nonce": sha256_json([run_id, task_id, attempt_id, command_id, idem])[:16],
    }
