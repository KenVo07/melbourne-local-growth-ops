"""Durable idempotency ledger for external and local side effects.

An operation is identified by a deterministic operation ID and input digest.
Recovery first verifies whether the side effect already exists; it never blindly
repeats a commit, integration, dispatch, notification, publication or CI query.

Each operation also owns a process-shared file lock for the *entire*
verify/apply/verify boundary.  Record-level locking alone is insufficient: two
controllers could otherwise both observe a prepared record, both fail the
pre-apply verifier, and concurrently apply the same external side effect.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .common import PolicyError, atomic_write_json, file_lock, iso_now, load_json, sha256_json, validate_id
from .leases import ExecutorLeaseStore

Verifier = Callable[[dict[str, Any]], dict[str, Any] | None]
Applier = Callable[[], dict[str, Any]]
FaultHook = Callable[[str, dict[str, Any]], None]


class OperationLedger:
    def __init__(self, run_v2_dir: str | Path, *, lease_store: ExecutorLeaseStore | None = None):
        self.root = Path(run_v2_dir) / "operations"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = self.root / ".operations.lock"
        self.operation_locks = self.root / ".locks"
        self.operation_locks.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lease_store = lease_store

    def path(self, operation_id: str) -> Path:
        validate_id(operation_id, "operation_id")
        return self.root / f"{operation_id}.json"

    def operation_lock_path(self, operation_id: str) -> Path:
        validate_id(operation_id, "operation_id")
        return self.operation_locks / f"{operation_id}.lock"

    def load(self, operation_id: str) -> dict[str, Any] | None:
        path = self.path(operation_id)
        return load_json(path) if path.exists() else None

    def prepare(self, *, operation_id: str, operation_type: str, inputs: dict[str, Any]) -> dict[str, Any]:
        path = self.path(operation_id)
        digest = sha256_json(inputs)
        with file_lock(self.lock):
            if path.exists():
                existing = load_json(path)
                if existing.get("operation_type") != operation_type or existing.get("input_digest") != digest:
                    raise PolicyError(f"operation ID reused with different inputs: {operation_id}")
                return existing
            record = {
                "schema_version": "1.0", "operation_id": operation_id,
                "operation_type": operation_type, "input_digest": digest,
                "inputs": inputs, "status": "PREPARED", "attempts": 0,
                "external_identity": None, "result": None, "verification": None,
                "created_at": iso_now(), "updated_at": iso_now(),
            }
            atomic_write_json(path, record)
            return record

    def _update(self, operation_id: str, **updates: Any) -> dict[str, Any]:
        path = self.path(operation_id)
        with file_lock(self.lock):
            record = load_json(path)
            record.update(updates)
            record["updated_at"] = iso_now()
            atomic_write_json(path, record)
            return record

    def execute(
        self,
        *,
        operation_id: str,
        operation_type: str,
        inputs: dict[str, Any],
        apply: Applier,
        verify_existing: Verifier,
        fault_hook: FaultHook | None = None,
        executor_lease: dict[str, Any] | None = None,
        command_id: str | None = None,
    ) -> dict[str, Any]:
        """Verify, apply and verify one side effect under one operation lock.

        The per-operation lock is held from the first durable-record read until
        the final verified/unknown outcome is recorded.  A second controller or
        CLI process blocks before it can call either verifier or applier.  Once
        admitted, it sees the first process's durable outcome and therefore
        cannot concurrently repeat the side effect.
        """

        def require_fence() -> None:
            if executor_lease is None:
                return
            if self.lease_store is None:
                raise PolicyError("executor lease supplied but OperationLedger has no lease store")
            self.lease_store.require(owner_id=executor_lease["owner_id"], epoch=int(executor_lease["epoch"]), token=executor_lease["token"])

        if command_id is not None and executor_lease is None:
            raise PolicyError("Command-linked operation requires executor lease fencing")
        lock_path = self.operation_lock_path(operation_id)
        with file_lock(lock_path):
            require_fence()
            bound_inputs = dict(inputs)
            if command_id is not None:
                validate_id(command_id, "command_id")
                bound_inputs.setdefault("command_id", command_id)
            record = self.prepare(operation_id=operation_id, operation_type=operation_type, inputs=bound_inputs)
            if record["status"] == "VERIFIED":
                return {**record, "duplicate": True}
            if record["status"] == "FAILED":
                return {**record, "duplicate": True, "retry_blocked": True}

            # An applied-but-unproven side effect is never blindly repeated.  A
            # later reconciliation may promote it after external verification or
            # an operator may explicitly disposition it.
            if record["status"] == "UNKNOWN_AFTER_APPLY":
                verified = verify_existing(record)
                if verified is None:
                    return {**record, "duplicate": True, "retry_blocked": True}
                require_fence()
                return self._update(
                    operation_id, status="VERIFIED", result=verified,
                    verification={"source": "late_recovery_verifier", "verified_at": iso_now()},
                    recovered_after_interruption=True,
                )

            # This catches a crash after the side effect but before the ledger was
            # updated.  The verifier must inspect external truth using operation
            # identity, exact SHA, terminal/job ID or message acknowledgement.
            verified = verify_existing(record)
            if verified is not None:
                require_fence()
                return self._update(
                    operation_id, status="VERIFIED", result=verified,
                    verification={"source": "recovery_verifier", "verified_at": iso_now()},
                    recovered_after_interruption=True,
                )

            require_fence()
            record = self._update(operation_id, status="APPLYING", attempts=int(record.get("attempts", 0)) + 1)
            if fault_hook:
                fault_hook("before_apply", record)
            result = apply()
            require_fence()
            if fault_hook:
                fault_hook("after_apply_before_record", {**record, "result": result})
            require_fence()
            record = self._update(
                operation_id, status="APPLIED", result=result,
                external_identity=result.get("external_identity") or result.get("commit_sha") or result.get("integration_sha") or result.get("terminal_id") or result.get("message_id"),
            )
            verified = verify_existing(record)
            if verified is None:
                require_fence()
                return self._update(
                    operation_id, status="UNKNOWN_AFTER_APPLY",
                    verification={"source": "post_apply_verifier", "verified_at": iso_now(), "result": "not_proven"},
                )
            if fault_hook:
                fault_hook("after_verify_before_record", {**record, "verification_result": verified})
            require_fence()
            return self._update(
                operation_id, status="VERIFIED", result=verified,
                verification={"source": "post_apply_verifier", "verified_at": iso_now()},
            )

    def fail(self, operation_id: str, error: str, *, executor_lease: dict[str, Any] | None = None) -> dict[str, Any]:
        # Failure disposition is serialized with any in-flight execution of the
        # same operation so it cannot race an applier into an incoherent record.
        # Command-linked operations are part of the fenced vNext application
        # boundary, so a stale executor may not disposition them either.
        with file_lock(self.operation_lock_path(operation_id)):
            record = self.load(operation_id)
            if record is None:
                raise PolicyError(f"unknown operation: {operation_id}")
            if (record.get("inputs") or {}).get("command_id") is not None:
                if executor_lease is None or self.lease_store is None:
                    raise PolicyError("Command-linked operation failure requires executor lease fencing")
                self.lease_store.require(
                    owner_id=executor_lease["owner_id"],
                    epoch=int(executor_lease["epoch"]),
                    token=executor_lease["token"],
                )
            return self._update(operation_id, status="FAILED", error=error)
