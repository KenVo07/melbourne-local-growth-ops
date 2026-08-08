"""Crash-resumable deterministic phase-result controller.

Every side effect is guarded by a durable idempotency operation.  Routine
callbacks never invoke a model.  Only phase gates and semantic exceptions are
queued to an episodic Task Lead, and transport acceptance is not called model
delivery until a nonce acknowledgement is observed.
"""

from __future__ import annotations

import json
import os
import time
import traceback
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, atomic_write_json, file_lock, iso_now, load_json, run, sha256_json, validate_id
from .contracts import validate_phase_packet, validate_result_packet
from .dispatch import submit_phase
from .evidence import cache_key, load_success, record as record_validation, reuse_mode
from .git_executor import changed_paths, commit_task, find_commit_by_operation_id, find_integrated_patch, integrate_commit, write_record
from .http_client import request_json
from .operations import OperationLedger
from .policy import load_policy
from .provenance import create_delivery
from .state_machine import RunStore

EXCEPTION_STATUSES = {"FAIL", "BLOCKED", "PLAN_CONFLICT", "CAPABILITY_ESCALATION_REQUIRED", "ENVIRONMENT_BLOCKED", "MISSING_REQUIRED_CONTEXT"}


def _event_dirs(policy: dict[str, Any], run_id: str) -> tuple[Path, Path, Path]:
    root = Path(policy["state_root"]) / "runs" / run_id / "v2" / "events"
    return root / "incoming", root / "processed", root / ".controller.lock"


def _load_phase_and_charter(policy: dict[str, Any], run_id: str, phase_id: str) -> tuple[dict[str, Any], dict[str, Any], Path]:
    store = RunStore(policy["state_root"], run_id); state = store.load()
    phase_record = state["phases"][phase_id]; phase_path = Path(phase_record["packet_path"])
    phase = load_json(phase_path); charter_path = Path(state["big_tasks"][phase["big_task_id"]]["charter_path"])
    return phase, load_json(charter_path), phase_path


def _validation_once(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], evidence_dir: Path, index: int, command: str) -> dict[str, Any]:
    worktree = Path((phase.get("worktree") or {}).get("path") or policy["repo_root"])
    timeout = int(phase["validation"]["timeout_seconds"]); key, facts = cache_key(worktree, command, policy)
    evidence_path = evidence_dir / f"validation-{index:02d}.json"; mode = reuse_mode(policy)
    ledger = OperationLedger(store.v2_dir); operation_id = f"op-{phase['phase_id']}-validation-{index:02d}"
    inputs = {"phase_id": phase["phase_id"], "command": command, "cache_key": key, "reuse_mode": mode}

    def verify_existing(_: dict[str, Any]) -> dict[str, Any] | None:
        if not evidence_path.is_file(): return None
        value = load_json(evidence_path)
        if value.get("command") != command or value.get("cache_key") != key or value.get("returncode") != 0:
            return None
        return value

    def apply() -> dict[str, Any]:
        cached = load_success(policy["state_root"], key)
        if mode == "enforced" and cached is not None:
            record = {
                "index": index, "command": command, "cache_key": key, "reuse_mode": mode,
                "reused": True, "source_recorded_at": cached.get("recorded_at"), "returncode": 0,
                "stdout": cached.get("stdout", ""), "stderr": cached.get("stderr", ""),
                "completed_at": iso_now(), "phase_reuse_request_ignored": True,
            }
            atomic_write_json(evidence_path, record); return record
        started_wall = iso_now(); started = time.monotonic()
        proc = run(["bash", "-lc", command], cwd=worktree, timeout=timeout, check=False)
        elapsed = time.monotonic() - started
        cache_path = record_validation(state_root=policy["state_root"], key=key, facts=facts, returncode=proc.returncode, stdout=proc.stdout, stderr=proc.stderr, elapsed_seconds=elapsed)
        record = {
            "index": index, "command": command, "started_at": started_wall, "completed_at": iso_now(),
            "elapsed_seconds": elapsed, "cache_key": key, "cache_record": str(cache_path),
            "reuse_mode": mode, "reused": False, "potential_cache_hit": cached is not None,
            "observation_match": None if cached is None else (proc.returncode == cached.get("returncode")),
            "returncode": proc.returncode, "stdout": proc.stdout[-20000:], "stderr": proc.stderr[-20000:],
            "phase_reuse_request_ignored": bool(phase["validation"].get("reuse_evidence_for_sha", False)),
        }
        atomic_write_json(evidence_path, record)
        if proc.returncode != 0: raise PolicyError(f"validation command {index} failed: {command}")
        return record

    record = ledger.execute(operation_id=operation_id, operation_type="validation", inputs=inputs, apply=apply, verify_existing=verify_existing)
    result = record.get("result") or {}
    if result.get("returncode") != 0: raise PolicyError(f"validation operation not proven passing: {operation_id}")
    return result


def _run_validation(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], evidence_dir: Path) -> list[dict[str, Any]]:
    evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    return [_validation_once(policy, store, phase, evidence_dir, index, command) for index, command in enumerate(phase["validation"]["commands"], 1)]


def _task_lead_record(state: dict[str, Any], phase: dict[str, Any]) -> dict[str, Any] | None:
    task_lead_id = (phase.get("task_lead") or {}).get("task_lead_id") or state["big_tasks"].get(phase["big_task_id"], {}).get("task_lead_id")
    return (state.get("task_leads") or {}).get(task_lead_id) if task_lead_id else None


def _notify_task_lead(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], packet: dict[str, Any]) -> dict[str, Any]:
    state = store.load(); lead = _task_lead_record(state, phase)
    if not lead or not lead.get("terminal_id"):
        return {"status": "UNAVAILABLE", "reason": "Task Lead terminal is not registered"}
    payload = "MLGO_PHASE_GATE_PACKET\n" + json.dumps(packet, indent=2, sort_keys=True) + "\nEND_MLGO_PHASE_GATE_PACKET"
    packet_digest = sha256_json(packet); operation_id = f"op-{phase['phase_id']}-notify-{packet_digest[:12]}"; delivery_id = f"dlv-{phase['phase_id']}-{packet_digest[:12]}"
    ledger = OperationLedger(store.v2_dir)

    def sender(message: str) -> dict[str, Any]:
        return request_json(f"{policy['main_cao_api']}/terminals/{lead['terminal_id']}/inbox/messages", method="POST", query={"sender_id": "mlgo-v2-controller", "message": message}, timeout=30)

    def verify_existing(_: dict[str, Any]) -> dict[str, Any] | None:
        path = store.v2_dir / "deliveries" / f"{delivery_id}.json"
        if not path.is_file(): return None
        value = load_json(path)
        return value if value.get("status") in {"MODEL_ACKNOWLEDGED", "MODEL_RESPONSE_OBSERVED"} else None

    def apply() -> dict[str, Any]:
        return create_delivery(store=store, recipient_role="task_lead", terminal_id=lead["terminal_id"], profile=lead["profile"], generation=int(lead.get("generation", 1)), provider=lead["provider"], provider_session_id=lead.get("provider_session_id"), payload=payload, sender=sender, delivery_id=delivery_id)

    return ledger.execute(operation_id=operation_id, operation_type="task_lead_notification", inputs={"packet_digest": packet_digest, "terminal_id": lead["terminal_id"], "generation": lead.get("generation", 1)}, apply=apply, verify_existing=verify_existing)


def _open_exception(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], result: dict[str, Any], reason: str) -> dict[str, Any]:
    digest = sha256_json({"phase_id": phase["phase_id"], "status": result.get("status"), "reason": reason})
    exception_id = f"exc-{phase['phase_id']}-{digest[:12]}"; path = store.v2_dir / "exceptions" / f"{exception_id}.json"
    if path.exists(): return load_json(path)
    record = {"schema_version": "2.1", "exception_id": exception_id, "run_id": phase["run_id"], "big_task_id": phase["big_task_id"], "phase_id": phase["phase_id"], "class": result.get("status") or "HOST_VALIDATION_FAILURE", "reason": reason, "result": result, "authority_required": "task_lead", "created_at": iso_now()}
    atomic_write_json(path, record); store.add_semantic_exception({"exception_id": exception_id, "phase_id": phase["phase_id"], "class": record["class"], "path": str(path)})
    current = store.load()["phases"][phase["phase_id"]]["state"]
    if current not in {"AWAITING_SEMANTIC_DECISION", "BLOCKED", "FAILED", "CANCELLED", "COMPLETE"}:
        store.transition_phase(phase["phase_id"], "AWAITING_SEMANTIC_DECISION", reason=reason, updates={"last_error": reason})
    record["delivery"] = _notify_task_lead(policy, store, phase, {"type": "SEMANTIC_EXCEPTION", **record})
    atomic_write_json(path, record); return record


def _complete_phase(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], result: dict[str, Any], *, commit_record: dict[str, Any] | None = None, integration_record: dict[str, Any] | None = None) -> dict[str, Any]:
    phase_record = store.load()["phases"][phase["phase_id"]]
    if phase_record["state"] != "COMPLETE":
        updates: dict[str, Any] = {"result_status": result["status"]}
        updates["commit_sha"] = (commit_record or {}).get("commit_sha") or phase_record.get("commit_sha")
        updates["integration_sha"] = (integration_record or {}).get("integration_sha") or phase_record.get("integration_sha")
        store.transition_phase(phase["phase_id"], "COMPLETE", reason="deterministic phase gates satisfied", updates=updates)
    packet = {"type": "PHASE_COMPLETE", "run_id": phase["run_id"], "big_task_id": phase["big_task_id"], "phase_id": phase["phase_id"], "result_status": result["status"], "commit": commit_record, "integration": integration_record, "assumptions_confirmed": result.get("assumptions_confirmed", []), "assumptions_invalidated": result.get("assumptions_invalidated", []), "risks": result.get("risks", []), "next_action": result.get("next_action")}
    return _notify_task_lead(policy, store, phase, packet)


def _integrate_if_enabled(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], commit_sha: str) -> dict[str, Any] | None:
    integration = phase.get("integration") or {}
    if not integration.get("enabled", False): return None
    current = store.load()["phases"][phase["phase_id"]]["state"]
    if current in {"COMMITTED", "REVIEWED"}: store.transition_phase(phase["phase_id"], "INTEGRATION_PENDING", reason="integration gate opened")
    operation_id = f"op-{phase['phase_id']}-integrate"; ledger = OperationLedger(store.v2_dir)
    inputs = {"worktree": integration["integration_worktree"], "branch": integration["integration_branch"], "commit_sha": commit_sha}
    def verify_existing(_: dict[str, Any]) -> dict[str, Any] | None: return find_integrated_patch(integration["integration_worktree"], commit_sha)
    def apply() -> dict[str, Any]: return integrate_commit(integration_worktree=integration["integration_worktree"], expected_branch=integration["integration_branch"], commit_sha=commit_sha)
    op = ledger.execute(operation_id=operation_id, operation_type="integration", inputs=inputs, apply=apply, verify_existing=verify_existing)
    if op["status"] != "VERIFIED": raise PolicyError(f"integration outcome is not proven: {op['status']}")
    record = op["result"]; path = store.v2_dir / "packets" / f"{phase['phase_id']}-integration.json"; write_record(path, record)
    current = store.load()["phases"][phase["phase_id"]]["state"]
    if current == "INTEGRATION_PENDING": store.transition_phase(phase["phase_id"], "INTEGRATED", reason="exact task patch integrated", updates={"integration_sha": record["integration_sha"]})
    return record


def _record_review_dispatch_outcome(
    *,
    store: RunStore,
    parent_phase_id: str,
    review_phase_id: str,
    operation_id: str,
    operation: dict[str, Any],
) -> dict[str, Any]:
    """Translate a durable dispatch outcome into truthful phase progress."""

    status = operation.get("status")
    current = store.load()["phases"][parent_phase_id]["state"]
    updates = {
        "review_status": status,
        "review_phase_id": review_phase_id,
        "review_dispatch_operation_id": operation_id,
    }
    if status == "VERIFIED":
        if current in {"COMMITTED", "REVIEW_DISPATCH_RECONCILIATION_REQUIRED"}:
            store.transition_phase(
                parent_phase_id, "REVIEW_PENDING",
                reason="independent review dispatch externally verified",
                updates=updates,
            )
        elif current != "REVIEW_PENDING":
            raise PolicyError(f"verified review dispatch cannot advance phase from {current}")
        return {**operation, "progressed": True, "reconciliation_required": False}

    if status == "UNKNOWN_AFTER_APPLY":
        if current == "COMMITTED":
            store.transition_phase(
                parent_phase_id, "REVIEW_DISPATCH_RECONCILIATION_REQUIRED",
                reason="review dispatch may have applied but is not externally proven",
                updates={**updates, "last_error": "review dispatch requires external reconciliation"},
            )
        elif current != "REVIEW_DISPATCH_RECONCILIATION_REQUIRED":
            raise PolicyError(f"unknown review dispatch cannot be reconciled from phase state {current}")
        return {**operation, "progressed": False, "reconciliation_required": True}

    if status == "FAILED":
        if current in {"COMMITTED", "REVIEW_DISPATCH_RECONCILIATION_REQUIRED"}:
            store.transition_phase(
                parent_phase_id, "BLOCKED",
                reason="review dispatch truthfully failed",
                updates={**updates, "last_error": operation.get("error") or "review dispatch failed"},
            )
        return {**operation, "progressed": False, "reconciliation_required": False, "truthfully_failed": True}

    raise PolicyError(f"review dispatch has no safe progress disposition: {status}")


def _submit_review(policy: dict[str, Any], store: RunStore, phase: dict[str, Any], commit_sha: str, policy_path: str | Path | None = None) -> dict[str, Any]:
    review = phase.get("review") or {}; review_file = review.get("phase_packet_file")
    if not review_file: raise ContractError("review.required=true but review.phase_packet_file is absent")
    template = load_json(review_file); template["parent_phase_id"] = phase["phase_id"]
    prompt = Path(template["prompt_file"]).read_text(encoding="utf-8").replace("${COMMIT_SHA}", commit_sha).replace("${PARENT_PHASE_ID}", phase["phase_id"])
    effective_prompt = store.v2_dir / "packets" / f"{template['phase_id']}-prompt-effective.md"; effective_prompt.write_text(prompt, encoding="utf-8")
    template["prompt_file"] = str(effective_prompt); effective_packet = store.v2_dir / "packets" / f"{template['phase_id']}-phase-effective.json"; atomic_write_json(effective_packet, template)
    operation_id = f"op-{phase['phase_id']}-review-dispatch"; ledger = OperationLedger(store.v2_dir)
    def verify_existing(_: dict[str, Any]) -> dict[str, Any] | None:
        state = store.load(); record = state["phases"].get(template["phase_id"])
        if not record or not record.get("job_path"): return None
        job_path = Path(record["job_path"]); return load_json(job_path) if job_path.is_file() else None
    def apply() -> dict[str, Any]: return submit_phase(phase_path=effective_packet, policy_path=policy_path, shadow=False)
    op = ledger.execute(operation_id=operation_id, operation_type="review_dispatch", inputs={"review_phase_id": template["phase_id"], "commit_sha": commit_sha, "packet_digest": sha256_json(template)}, apply=apply, verify_existing=verify_existing)
    return _record_review_dispatch_outcome(
        store=store, parent_phase_id=phase["phase_id"], review_phase_id=template["phase_id"],
        operation_id=operation_id, operation=op,
    )


def reconcile_review_dispatches(policy: dict[str, Any], run_id: str, policy_path: str | Path | None = None) -> list[dict[str, Any]]:
    """Reconcile review dispatches that may have applied before a crash.

    No new dispatch is attempted while the operation ledger remains
    UNKNOWN_AFTER_APPLY.  The same deterministic operation is re-opened only to
    run its external verifier under the operation-wide lock.
    """

    store = RunStore(policy["state_root"], run_id)
    state = store.load(); outcomes: list[dict[str, Any]] = []
    pending = [phase_id for phase_id, record in state.get("phases", {}).items() if record.get("state") == "REVIEW_DISPATCH_RECONCILIATION_REQUIRED"]
    for phase_id in pending:
        phase, charter, _ = _load_phase_and_charter(policy, run_id, phase_id)
        phase = validate_phase_packet(phase, policy, charter)
        commit_sha = store.load()["phases"][phase_id].get("commit_sha")
        if not commit_sha:
            store.transition_phase(phase_id, "BLOCKED", reason="review-dispatch reconciliation lacks parent commit SHA", updates={"last_error": "missing commit SHA"})
            outcomes.append({"phase_id": phase_id, "status": "FAILED", "reason": "missing commit SHA"})
            continue
        outcome = _submit_review(policy, store, phase, commit_sha, policy_path)
        outcomes.append({"phase_id": phase_id, "status": outcome.get("status"), "progressed": outcome.get("progressed", False), "reconciliation_required": outcome.get("reconciliation_required", False)})
    return outcomes


def process_event(event_path: str | Path, policy_path: str | Path | None = None) -> dict[str, Any]:
    policy = load_policy(policy_path); event = load_json(Path(event_path).resolve())
    if event.get("schema_version") not in {"2.0", "2.1"} or event.get("event_type") != "PHASE_RESULT": raise ContractError("unsupported event")
    run_id = validate_id(event["run_id"], "run_id"); phase_id = validate_id(event["phase_id"], "phase_id"); store = RunStore(policy["state_root"], run_id)
    phase, charter, _ = _load_phase_and_charter(policy, run_id, phase_id); phase = validate_phase_packet(phase, policy, charter); result = validate_result_packet(load_json(event["result_path"]), phase)
    current = store.load()["phases"][phase_id]["state"]
    if current == "RUNNING": store.transition_phase(phase_id, "RESULT_READY", reason="validated result packet received", updates={"result_path": event["result_path"]}); current = "RESULT_READY"
    if result["status"] in EXCEPTION_STATUSES: return {"ok": False, "semantic_exception": _open_exception(policy, store, phase, result, f"worker returned {result['status']}")}

    parent_id = phase.get("parent_phase_id")
    if phase["phase_kind"] == "review":
        if result["status"] != "PASS": return {"ok": False, "semantic_exception": _open_exception(policy, store, phase, result, "independent review did not pass")}
        if not parent_id: raise ContractError("review phase has no parent_phase_id")
        parent_record = store.load()["phases"].get(parent_id) or {}
        if not parent_record.get("commit_sha") or result.get("reviewed_sha") != parent_record["commit_sha"]:
            return {"ok": False, "semantic_exception": _open_exception(policy, store, phase, result, "review does not cover the exact parent commit SHA")}
        current = store.load()["phases"][phase_id]["state"]
        if current == "RESULT_READY": store.transition_phase(phase_id, "REVIEW_PENDING", reason="review result accepted")
        if store.load()["phases"][phase_id]["state"] == "REVIEW_PENDING": store.transition_phase(phase_id, "REVIEWED", reason="independent review passed")
        _complete_phase(policy, store, phase, result)
        parent, parent_charter, _ = _load_phase_and_charter(policy, run_id, parent_id); parent = validate_phase_packet(parent, policy, parent_charter)
        if store.load()["phases"][parent_id]["state"] == "REVIEW_PENDING": store.transition_phase(parent_id, "REVIEWED", reason=f"review phase {phase_id} passed")
        integration = _integrate_if_enabled(policy, store, parent, parent_record["commit_sha"])
        delivery = _complete_phase(policy, store, parent, result, integration_record=integration)
        return {"ok": True, "phase_id": phase_id, "review_pass": True, "parent_delivery": delivery}

    if result["status"] in {"NO_CHANGE", "PASS"} and not phase["write_capable"]:
        delivery = _complete_phase(policy, store, phase, result); return {"ok": True, "phase_id": phase_id, "status": result["status"], "delivery": delivery}
    if result["status"] != "READY_FOR_COMMIT": return {"ok": False, "semantic_exception": _open_exception(policy, store, phase, result, f"unsupported result status: {result['status']}")}

    current = store.load()["phases"][phase_id]["state"]
    if current == "RESULT_READY": store.transition_phase(phase_id, "VALIDATING", reason="host validation starting")
    validation_records = _run_validation(policy, store, phase, Path(phase["evidence_directory"]).resolve())
    current = store.load()["phases"][phase_id]["state"]
    if current == "VALIDATING": store.transition_phase(phase_id, "COMMIT_READY", reason="host validation passed")

    ownership = phase.get("ownership") or {}; actual_paths = changed_paths(Path(phase["worktree"]["path"]).resolve())
    phase_record = store.load()["phases"][phase_id]
    if not phase_record.get("commit_sha") and set(actual_paths) != set(result.get("changed_files") or []):
        return {"ok": False, "semantic_exception": _open_exception(policy, store, phase, result, "worker changed-file report does not match actual worktree diff"), "actual_changed_files": actual_paths}
    ledger = OperationLedger(store.v2_dir); commit_op = f"op-{phase_id}-commit"
    def verify_commit(_: dict[str, Any]) -> dict[str, Any] | None: return find_commit_by_operation_id(phase["worktree"]["path"], commit_op)
    def apply_commit() -> dict[str, Any]: return commit_task(worktree=phase["worktree"]["path"], expected_branch=phase["worktree"]["branch"], allowed_paths=ownership.get("allowed_paths", []), forbidden_paths=ownership.get("forbidden_paths", []), message=f"{phase_id}: {phase['objective'][:120]}", operation_id=commit_op)
    op = ledger.execute(operation_id=commit_op, operation_type="commit", inputs={"worktree": phase["worktree"]["path"], "branch": phase["worktree"]["branch"], "changed_files": result.get("changed_files", []), "ownership": ownership}, apply=apply_commit, verify_existing=verify_commit)
    if op["status"] != "VERIFIED": raise PolicyError(f"commit outcome is not proven: {op['status']}")
    commit_record = op["result"]; write_record(store.v2_dir / "packets" / f"{phase_id}-commit.json", commit_record)
    current = store.load()["phases"][phase_id]["state"]
    if current == "COMMIT_READY": store.transition_phase(phase_id, "COMMITTED", reason="host created exact task commit", updates={"commit_sha": commit_record["commit_sha"]})

    if (phase.get("review") or {}).get("required", False):
        review_dispatch = _submit_review(policy, store, phase, commit_record["commit_sha"], policy_path)
        if review_dispatch.get("reconciliation_required"):
            return {
                "ok": False, "phase_id": phase_id, "commit": commit_record,
                "status": "REVIEW_DISPATCH_RECONCILIATION_REQUIRED",
                "review_dispatch": review_dispatch, "validation": validation_records,
            }
        if review_dispatch.get("truthfully_failed"):
            return {"ok": False, "phase_id": phase_id, "commit": commit_record, "status": "REVIEW_DISPATCH_FAILED", "review_dispatch": review_dispatch, "validation": validation_records}
        return {"ok": True, "phase_id": phase_id, "commit": commit_record, "review_dispatch": review_dispatch, "validation": validation_records}
    integration = _integrate_if_enabled(policy, store, phase, commit_record["commit_sha"])
    delivery = _complete_phase(policy, store, phase, result, commit_record=commit_record, integration_record=integration)
    return {"ok": True, "phase_id": phase_id, "commit": commit_record, "integration": integration, "validation": validation_records, "delivery": delivery}


def process_run_once(run_id: str, policy_path: str | Path | None = None) -> list[dict[str, Any]]:
    policy = load_policy(policy_path); incoming, processed, lock_path = _event_dirs(policy, run_id)
    incoming.mkdir(parents=True, exist_ok=True, mode=0o700); processed.mkdir(parents=True, exist_ok=True, mode=0o700); outcomes: list[dict[str, Any]] = []
    with file_lock(lock_path):
        for reconciliation in reconcile_review_dispatches(policy, run_id, policy_path):
            outcomes.append({"reconciliation": reconciliation})
        for event_file in sorted(incoming.glob("*.json")):
            try:
                outcome = process_event(event_file, policy_path); os.replace(event_file, processed / event_file.name); outcomes.append({"event": event_file.name, "outcome": outcome})
            except Exception as exc:
                atomic_write_json(processed / f"{event_file.stem}.error.json", {"event_path": str(event_file), "error": str(exc), "type": type(exc).__name__, "traceback": traceback.format_exc(), "at": iso_now()})
                os.replace(event_file, processed / f"{event_file.stem}.failed.json"); outcomes.append({"event": event_file.name, "error": str(exc)})
    return outcomes


def run_forever(policy_path: str | Path | None = None, interval: float = 2.0) -> None:
    policy = load_policy(policy_path); state_root = Path(policy["state_root"])
    while True:
        runs = state_root / "runs"
        if runs.exists():
            for run_dir in sorted(runs.iterdir()):
                if (run_dir / "v2" / "state.json").exists():
                    try: process_run_once(run_dir.name, policy_path)
                    except Exception: traceback.print_exc()
        time.sleep(interval)
