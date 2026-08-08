"""Crash-consistent durable run state with legal transition enforcement.

The append-only journal is a write-ahead source of truth.  Every committed
journal record contains the complete resulting snapshot and a digest chain.
The materialized ``state.json`` is a cache that can be deterministically rebuilt
when a process dies after journal fsync but before snapshot replacement.
"""

from __future__ import annotations

import copy
import secrets
from pathlib import Path
from typing import Any

from .contract_binding import assert_writer_compatible, validate_run_contract_binding
from .leases import ExecutorLeaseStore

from .common import (
    ContractError,
    PolicyError,
    append_jsonl,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    read_jsonl,
    sha256_json,
    truncate_file,
    validate_id,
)

STATE_SCHEMA_VERSION = "2.1"
JOURNAL_SCHEMA_VERSION = "1.0"

PHASE_STATES = {
    "CREATED", "ROUTING_PENDING", "ROUTED", "PREFLIGHT_PENDING", "DISPATCHED",
    "RUNNING", "RESULT_READY", "VALIDATING", "COMMIT_READY", "COMMITTED",
    "REVIEW_PENDING", "REVIEW_DISPATCH_RECONCILIATION_REQUIRED", "REVIEWED",
    "INTEGRATION_PENDING", "INTEGRATED", "COMPLETE",
    "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED", "CANCELLED",
}
TERMINAL_PHASE_STATES = {"COMPLETE", "BLOCKED", "FAILED", "CANCELLED"}

RUN_STATES = {
    "INITIALIZED", "ACTIVE", "PAUSED", "PUBLICATION_PENDING", "FINAL_FACTS_READY",
    "FINALIZATION_PENDING", "FINALIZED", "FAILED", "CANCELLED",
}
RUN_TRANSITIONS = {
    "INITIALIZED": {"ACTIVE", "PAUSED", "FAILED", "CANCELLED"},
    "ACTIVE": {"PAUSED", "PUBLICATION_PENDING", "FAILED", "CANCELLED"},
    "PAUSED": {"ACTIVE", "FAILED", "CANCELLED"},
    "PUBLICATION_PENDING": {"ACTIVE", "FINAL_FACTS_READY", "FAILED", "CANCELLED"},
    "FINAL_FACTS_READY": {"ACTIVE", "FINALIZATION_PENDING", "FAILED", "CANCELLED"},
    "FINALIZATION_PENDING": {"FINALIZED", "FAILED"},
    "FINALIZED": set(), "FAILED": set(), "CANCELLED": set(),
}

LEGAL_TRANSITIONS: dict[str, set[str]] = {
    "CREATED": {"ROUTING_PENDING", "CANCELLED"},
    "ROUTING_PENDING": {"ROUTED", "BLOCKED", "FAILED", "CANCELLED"},
    "ROUTED": {"PREFLIGHT_PENDING", "DISPATCHED", "BLOCKED", "CANCELLED"},
    "PREFLIGHT_PENDING": {"DISPATCHED", "BLOCKED", "FAILED", "CANCELLED"},
    "DISPATCHED": {"RUNNING", "BLOCKED", "FAILED", "CANCELLED"},
    "RUNNING": {"RESULT_READY", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED", "CANCELLED"},
    "RESULT_READY": {"VALIDATING", "COMMIT_READY", "REVIEW_PENDING", "INTEGRATION_PENDING", "COMPLETE", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "VALIDATING": {"COMMIT_READY", "REVIEW_PENDING", "INTEGRATION_PENDING", "COMPLETE", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "COMMIT_READY": {"COMMITTED", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "COMMITTED": {"REVIEW_PENDING", "REVIEW_DISPATCH_RECONCILIATION_REQUIRED", "INTEGRATION_PENDING", "COMPLETE", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "REVIEW_DISPATCH_RECONCILIATION_REQUIRED": {"REVIEW_PENDING", "BLOCKED", "FAILED", "CANCELLED"},
    "REVIEW_PENDING": {"REVIEWED", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "REVIEWED": {"INTEGRATION_PENDING", "COMPLETE", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "INTEGRATION_PENDING": {"INTEGRATED", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "INTEGRATED": {"COMPLETE", "AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED"},
    "AWAITING_SEMANTIC_DECISION": {"ROUTING_PENDING", "VALIDATING", "COMMIT_READY", "REVIEW_PENDING", "INTEGRATION_PENDING", "BLOCKED", "FAILED", "CANCELLED"},
    "BLOCKED": {"ROUTING_PENDING", "PREFLIGHT_PENDING", "DISPATCHED", "AWAITING_SEMANTIC_DECISION", "FAILED", "CANCELLED"},
    "FAILED": set(), "CANCELLED": set(), "COMPLETE": set(),
}


class RunStore:
    def __init__(self, state_root: str | Path, run_id: str, *, writer_context: dict[str, Any] | None = None, lease_store: ExecutorLeaseStore | None = None):
        validate_id(run_id, "run_id")
        self.run_id = run_id
        self.run_dir = Path(state_root) / "runs" / run_id
        self.v2_dir = self.run_dir / "v2"
        self.state_path = self.v2_dir / "state.json"
        self.journal_path = self.v2_dir / "journal.jsonl"
        self.lock_path = self.v2_dir / ".state.lock"
        self.writer_context = writer_context
        self.lease_store = lease_store

    def _ensure_layout(self) -> None:
        self.v2_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        for sub in (
            "events/incoming", "events/processed", "jobs", "packets", "task-leads",
            "telemetry", "exceptions", "operations", "provenance", "deliveries",
            "continuity", "finalization", "commands",
        ):
            (self.v2_dir / sub).mkdir(parents=True, exist_ok=True, mode=0o700)

    def _journal_records_unlocked(self, *, repair_partial: bool) -> list[dict[str, Any]]:
        records, trailing = read_jsonl(self.journal_path, allow_trailing_partial=True)
        if trailing is not None:
            if not repair_partial:
                raise ContractError(f"partial trailing journal record: {self.journal_path}")
            truncate_file(self.journal_path, trailing)
        previous_digest: str | None = None
        expected_version = 1
        for record in records:
            if record.get("journal_schema_version") != JOURNAL_SCHEMA_VERSION:
                raise ContractError("unsupported journal record schema")
            if record.get("run_id") != self.run_id:
                raise ContractError("journal run_id mismatch")
            if record.get("state_version") != expected_version:
                raise ContractError(
                    f"journal version gap: expected {expected_version}, got {record.get('state_version')}"
                )
            if record.get("previous_state_digest") != previous_digest:
                raise ContractError(f"journal digest-chain mismatch at version {expected_version}")
            state = record.get("state")
            if not isinstance(state, dict):
                raise ContractError("journal record does not contain a state snapshot")
            digest = sha256_json(state)
            if record.get("state_digest") != digest:
                raise ContractError(f"journal state digest mismatch at version {expected_version}")
            previous_digest = digest
            expected_version += 1
        return records

    def _load_unlocked(self, *, repair: bool = True) -> dict[str, Any]:
        records = self._journal_records_unlocked(repair_partial=repair)
        snapshot = load_json(self.state_path) if self.state_path.exists() else None
        if not records:
            if snapshot is None:
                raise ContractError(f"v2 state does not exist: {self.state_path}")
            raise PolicyError("state snapshot exists without a committed write-ahead journal")
        latest = copy.deepcopy(records[-1]["state"])
        if snapshot is None:
            if not repair:
                raise PolicyError("state snapshot is missing but journal can repair it")
            atomic_write_json(self.state_path, latest)
            snapshot = latest
        snapshot_version = int(snapshot.get("state_version", 0))
        journal_version = int(latest.get("state_version", 0))
        if snapshot_version < journal_version:
            if not repair:
                raise PolicyError("state snapshot trails the committed journal")
            atomic_write_json(self.state_path, latest)
            snapshot = latest
        elif snapshot_version > journal_version:
            raise PolicyError(
                "state snapshot is ahead of the write-ahead journal; manual integrity review required"
            )
        elif sha256_json(snapshot) != sha256_json(latest):
            raise PolicyError("state snapshot and journal disagree at the same state_version")
        if snapshot.get("schema_version") != STATE_SCHEMA_VERSION or snapshot.get("run_id") != self.run_id:
            raise ContractError(f"invalid v2 state: {self.state_path}")
        return snapshot

    def load(self, *, repair: bool = True) -> dict[str, Any]:
        with file_lock(self.lock_path):
            return self._load_unlocked(repair=repair)

    def _require_vnext_writer(self, state: dict[str, Any]) -> None:
        if not state.get("vnext_writers_enabled"):
            return
        binding = state.get("run_contract_binding")
        if not isinstance(binding, dict):
            raise PolicyError("vNext run is missing RunContractBinding")
        validate_run_contract_binding(binding)
        if not isinstance(self.writer_context, dict):
            raise PolicyError("vNext durable mutation requires an explicit compatible writer context")
        assert_writer_compatible(binding, self.writer_context)
        fence = self.writer_context.get("executor_lease")
        if self.lease_store is None or not isinstance(fence, dict):
            raise PolicyError("vNext durable mutation requires executor lease/epoch fencing")
        self.lease_store.require(owner_id=fence["owner_id"], epoch=int(fence["epoch"]), token=fence["token"])

    def _commit_unlocked(
        self,
        state: dict[str, Any],
        event: dict[str, Any],
        *,
        fault_after_journal: bool = False,
    ) -> dict[str, Any]:
        self._require_vnext_writer(state)
        previous_digest: str | None = None
        if self.journal_path.exists():
            records = self._journal_records_unlocked(repair_partial=True)
            if records:
                previous_digest = records[-1]["state_digest"]
        state = copy.deepcopy(state)
        state["state_version"] = int(state.get("state_version", 0)) + 1
        state["updated_at"] = iso_now()
        record = {
            "journal_schema_version": JOURNAL_SCHEMA_VERSION,
            "transaction_id": f"stx-{state['state_version']}-{secrets.token_hex(6)}",
            "run_id": self.run_id,
            "state_version": state["state_version"],
            "at": state["updated_at"],
            "event": event,
            "previous_state_digest": previous_digest,
            "state_digest": sha256_json(state),
            "state": state,
        }
        # WAL first.  If the process stops after this fsync, load() repairs the
        # materialized snapshot from the committed record.
        append_jsonl(self.journal_path, record)
        if fault_after_journal:  # failure-injection seam; never enabled by production callers
            raise RuntimeError("injected crash after journal fsync")
        atomic_write_json(self.state_path, state)
        return state

    def initialize(
        self,
        *,
        mode: str = "v2_shadow",
        supervisor_profile: str,
        supervisor_account_pool: str | None = None,
        run_contract_binding: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        if mode not in {"legacy", "v2_shadow", "v2_enforced"}:
            raise ContractError(f"invalid orchestration mode: {mode}")
        validate_id(supervisor_profile, "supervisor_profile")
        self._ensure_layout()
        with file_lock(self.lock_path):
            if self.state_path.exists() or self.journal_path.exists():
                existing = self._load_unlocked()
                selected = (existing.get("supervisor_selection") or {}).get("profile")
                if selected != supervisor_profile:
                    raise PolicyError(
                        f"authoritative supervisor is immutable for this run: {selected!r} != {supervisor_profile!r}"
                    )
                existing_pool = (existing.get("supervisor_selection") or {}).get("account_pool")
                if supervisor_account_pool is not None and existing_pool not in {None, supervisor_account_pool}:
                    raise PolicyError(
                        "authoritative supervisor account pool is immutable for this run: "
                        f"{existing_pool!r} != {supervisor_account_pool!r}"
                    )
                return existing
            created = iso_now()
            if run_contract_binding is not None:
                validate_run_contract_binding(run_contract_binding)
                if not isinstance(self.writer_context, dict):
                    raise PolicyError("creating a vNext run requires writer_context")
                assert_writer_compatible(run_contract_binding, self.writer_context)
            state = {
                "schema_version": STATE_SCHEMA_VERSION,
                "run_id": self.run_id,
                "orchestration_mode": mode,
                "state_version": 0,
                "status": "INITIALIZED",
                "maintenance_pause": False,
                "supervisor_selection": {
                    "profile": supervisor_profile,
                    "account_pool": supervisor_account_pool,
                    "selected_by": "operator",
                    "selected_at": created,
                    "immutable": True,
                    "generation": 1,
                    "terminal_id": None,
                    "provider": None,
                    "provider_session_id": None,
                },
                "task_leads": {}, "big_tasks": {}, "phases": {},
                "open_semantic_exceptions": [], "last_capacity_snapshot_id": None,
                "recovery": {"status": "NOT_REQUIRED", "checkpoint_fallback_attempts": 0},
                "run_contract_binding": run_contract_binding,
                "vnext_writers_enabled": run_contract_binding is not None,
                "created_at": created, "updated_at": created,
            }
            return self._commit_unlocked(
                state,
                {
                    "type": "STATE_INITIALIZED", "mode": mode,
                    "supervisor_profile": supervisor_profile,
                    "supervisor_account_pool": supervisor_account_pool,
                },
            )

    def repair(self) -> dict[str, Any]:
        with file_lock(self.lock_path):
            state = self._load_unlocked(repair=True)
            return {"ok": True, "run_id": self.run_id, "state_version": state["state_version"], "state_digest": sha256_json(state)}

    def set_run_status(self, target: str, *, reason: str = "") -> dict[str, Any]:
        if target not in RUN_STATES:
            raise ContractError(f"unknown run status: {target}")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            current = state.get("status", "INITIALIZED")
            if target == current:
                return state
            if target not in RUN_TRANSITIONS.get(current, set()):
                raise PolicyError(f"illegal run transition: {current} -> {target}")
            state["status"] = target
            return self._commit_unlocked(state, {"type": "RUN_TRANSITION", "from": current, "to": target, "reason": reason})

    def bind_supervisor_session(self, record: dict[str, Any]) -> dict[str, Any]:
        """Bind host-observed terminal/session identity to the immutable supervisor."""
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            selected = state["supervisor_selection"]
            if record.get("profile") != selected["profile"]:
                raise PolicyError("supervisor session profile does not match immutable selection")
            if int(record.get("generation", 0)) != int(selected["generation"]):
                raise PolicyError("supervisor session generation mismatch")
            terminal_id = validate_id(str(record.get("terminal_id") or ""), "terminal_id")
            existing = selected.get("terminal_id")
            if existing not in {None, terminal_id}:
                raise PolicyError("supervisor terminal is immutable within a generation")
            selected.update({
                "terminal_id": terminal_id,
                "provider": record.get("provider"),
                "provider_session_id": record.get("provider_session_id"),
                "session_registry_path": record.get("registry_path"),
                "session_bound_at": iso_now(),
            })
            return self._commit_unlocked(state, {"type": "SUPERVISOR_SESSION_BOUND", "terminal_id": terminal_id, "generation": selected["generation"]})

    def begin_new_supervisor_generation(self, *, reason: str, checkpoint_path: str) -> dict[str, Any]:
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            selected = state["supervisor_selection"]
            selected["generation"] = int(selected["generation"]) + 1
            selected["terminal_id"] = None
            selected["provider_session_id"] = None
            selected["session_registry_path"] = None
            state["recovery"]["status"] = "CHECKPOINT_FALLBACK_NEW_GENERATION"
            state["recovery"]["checkpoint_path"] = checkpoint_path
            state["recovery"]["reason"] = reason
            return self._commit_unlocked(state, {"type": "SUPERVISOR_NEW_GENERATION", "generation": selected["generation"], "reason": reason, "checkpoint_path": checkpoint_path})

    def register_big_task(self, big_task_id: str, charter_path: str, task_lead_id: str | None) -> dict[str, Any]:
        validate_id(big_task_id, "big_task_id")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            if big_task_id in state["big_tasks"]:
                raise PolicyError(f"big task already exists: {big_task_id}")
            state["big_tasks"][big_task_id] = {
                "status": "CHARTER_APPROVED", "charter_path": charter_path,
                "task_lead_id": task_lead_id, "phase_order": [], "completed_phases": [],
                "created_at": iso_now(),
            }
            previous_status = state.get("status", "INITIALIZED")
            if previous_status == "INITIALIZED":
                state["status"] = "ACTIVE"
            return self._commit_unlocked(state, {"type": "BIG_TASK_REGISTERED", "big_task_id": big_task_id, "run_status_from": previous_status, "run_status_to": state["status"]})

    def bind_task_lead(self, big_task_id: str, task_lead_id: str) -> dict[str, Any]:
        validate_id(big_task_id, "big_task_id"); validate_id(task_lead_id, "task_lead_id")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            if big_task_id not in state["big_tasks"]:
                raise PolicyError(f"big task not registered: {big_task_id}")
            task = state["big_tasks"][big_task_id]
            existing = task.get("task_lead_id")
            if existing not in {None, task_lead_id}:
                raise PolicyError(f"big task already has a different Task Lead: {existing}")
            task["task_lead_id"] = task_lead_id
            return self._commit_unlocked(state, {"type": "TASK_LEAD_BOUND", "big_task_id": big_task_id, "task_lead_id": task_lead_id})

    def register_task_lead(self, task_lead_id: str, record: dict[str, Any]) -> dict[str, Any]:
        validate_id(task_lead_id, "task_lead_id")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            state["task_leads"][task_lead_id] = {**record, "updated_at": iso_now()}
            return self._commit_unlocked(state, {"type": "TASK_LEAD_REGISTERED", "task_lead_id": task_lead_id})

    def register_phase(self, phase: dict[str, Any], packet_path: str) -> dict[str, Any]:
        phase_id = validate_id(phase["phase_id"], "phase_id")
        big_task_id = validate_id(phase["big_task_id"], "big_task_id")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            if phase_id in state["phases"]:
                raise PolicyError(f"phase already exists: {phase_id}")
            if big_task_id not in state["big_tasks"]:
                raise PolicyError(f"big task not registered: {big_task_id}")
            state["phases"][phase_id] = {
                "big_task_id": big_task_id, "phase_kind": phase.get("phase_kind"),
                "write_capable": bool(phase.get("write_capable")),
                "parent_phase_id": phase.get("parent_phase_id"), "state": "CREATED",
                "packet_path": packet_path, "routing_decision_path": None, "job_path": None,
                "result_path": None, "commit_sha": None, "review_status": None,
                "integration_sha": None, "attempt": 0, "last_error": None,
                "created_at": iso_now(), "updated_at": iso_now(),
            }
            state["big_tasks"][big_task_id]["phase_order"].append(phase_id)
            return self._commit_unlocked(state, {"type": "PHASE_REGISTERED", "phase_id": phase_id, "big_task_id": big_task_id})

    def transition_phase(self, phase_id: str, target: str, *, expected_state_version: int | None = None, reason: str = "", updates: dict[str, Any] | None = None) -> dict[str, Any]:
        validate_id(phase_id, "phase_id")
        if target not in PHASE_STATES:
            raise ContractError(f"unknown phase state: {target}")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            if expected_state_version is not None and state["state_version"] != expected_state_version:
                raise PolicyError(f"state version conflict: expected {expected_state_version}, actual {state['state_version']}")
            if phase_id not in state["phases"]:
                raise PolicyError(f"phase not registered: {phase_id}")
            record = state["phases"][phase_id]
            current = record["state"]
            if target == current:
                if updates:
                    record.update(updates)
                    return self._commit_unlocked(state, {"type": "PHASE_REFRESH", "phase_id": phase_id, "state": target, "reason": reason})
                return state
            if target not in LEGAL_TRANSITIONS[current]:
                raise PolicyError(f"illegal phase transition: {phase_id} {current} -> {target}")
            record["state"] = target; record["updated_at"] = iso_now(); record["last_transition_reason"] = reason
            if updates: record.update(updates)
            if target == "COMPLETE":
                big_task = state["big_tasks"][record["big_task_id"]]
                if phase_id not in big_task["completed_phases"]: big_task["completed_phases"].append(phase_id)
            return self._commit_unlocked(state, {"type": "PHASE_TRANSITION", "phase_id": phase_id, "from": current, "to": target, "reason": reason})

    def add_semantic_exception(self, record: dict[str, Any]) -> dict[str, Any]:
        exception_id = validate_id(record["exception_id"], "exception_id")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            if exception_id not in state["open_semantic_exceptions"]: state["open_semantic_exceptions"].append(exception_id)
            return self._commit_unlocked(state, {"type": "SEMANTIC_EXCEPTION_OPENED", **record})

    def close_semantic_exception(self, exception_id: str, disposition: str) -> dict[str, Any]:
        validate_id(exception_id, "exception_id")
        with file_lock(self.lock_path):
            state = self._load_unlocked()
            if exception_id in state["open_semantic_exceptions"]: state["open_semantic_exceptions"].remove(exception_id)
            return self._commit_unlocked(state, {"type": "SEMANTIC_EXCEPTION_CLOSED", "exception_id": exception_id, "disposition": disposition})
