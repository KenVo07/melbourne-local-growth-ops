"""Asynchronous phase submission and provider execution."""

from __future__ import annotations

import argparse
import json
import os
import shlex
import subprocess
import sys
import traceback
import time
from pathlib import Path
from typing import Any

from . import canary_scope
from .capacity import load_snapshot
from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    atomic_write_text,
    file_lock,
    iso_now,
    load_json,
    run,
    sha256_file,
    sha256_json,
    validate_id,
)
from .contracts import (
    extract_result_packet,
    load_and_validate,
    result_packet_instructions,
    validate_phase_packet,
    validate_result_packet,
)
from .http_client import HTTPError, request_json
from .completion import (
    HerdrPreflightError,
    ModelOutputIncomplete,
    capture_stable_result,
    cleanup_retained_terminal,
    preflight_herdr_boundary,
)
from .git_executor import snapshot as git_snapshot
from .policy import load_policy, route
from .registry import profile as registry_profile
from .transport import SubmitCertainty, adapter_for_route
from .preflight import verify_worktree
from .prompt_accounting import record_dispatch_prompt
from .routing import decide_route
from .state_machine import RunStore
from .usage import agy_usage_placeholder, append_usage_event, execution_usage_placeholder



_ACTIVE_EXECUTION_STATES = {"DISPATCHED", "RUNNING"}

def _active_execution_counts(policy: dict[str, Any], *, run_id: str, big_task_id: str) -> dict[str, int]:
    counts = {"global_writers": 0, "task_writers": 0, "route_groups": {}, "opus_phases": 0}
    runs_root = Path(policy["state_root"]) / "runs"
    if not runs_root.exists():
        return counts
    for state_path in runs_root.glob("*/v2/state.json"):
        try:
            state = load_json(state_path)
        except Exception:
            continue
        state_run_id = state.get("run_id")
        for record in (state.get("phases") or {}).values():
            if not isinstance(record, dict) or record.get("state") not in _ACTIVE_EXECUTION_STATES:
                continue
            if record.get("write_capable"):
                counts["global_writers"] += 1
                if state_run_id == run_id and record.get("big_task_id") == big_task_id:
                    counts["task_writers"] += 1
                selected_route = record.get("selected_route")
                if selected_route:
                    try:
                        group = route(policy, selected_route).get("concurrency_group")
                        if group:
                            counts["route_groups"][group] = int(counts["route_groups"].get(group, 0)) + 1
                    except Exception:
                        pass
            if int(record.get("selected_tier") or 0) >= 5:
                counts["opus_phases"] += 1
    return counts

def _concurrency_rejection(phase: dict[str, Any], decision: dict[str, Any], charter: dict[str, Any], policy: dict[str, Any]) -> str | None:
    counts = _active_execution_counts(
        policy, run_id=phase["run_id"], big_task_id=phase["big_task_id"]
    )
    if phase["write_capable"]:
        if counts["global_writers"] >= int(policy["orchestration"]["max_parallel_write_phases"]):
            return "global write-phase concurrency limit reached"
        if counts["task_writers"] >= int(charter["delegation_envelope"]["max_parallel_writers"]):
            return "big-task write-phase concurrency limit reached"
        group = route(policy, decision["selected_route"]).get("concurrency_group")
        if group:
            limits = policy["orchestration"].get("route_concurrency_limits") or {}
            limit = limits.get(group)
            if limit is None:
                raise PolicyError(f"route concurrency group has no configured limit: {group}")
            if int(counts["route_groups"].get(group, 0)) >= int(limit):
                return f"route concurrency limit reached: {group}"
    if int(decision["selected_tier"]) >= 5 and counts["opus_phases"] >= int(policy["orchestration"]["max_parallel_opus_phases"]):
        return "Opus concurrency limit reached"
    return None

def _run_dir(policy: dict[str, Any], run_id: str) -> Path:
    return Path(policy["state_root"]) / "runs" / run_id


def _v2_dir(policy: dict[str, Any], run_id: str) -> Path:
    return _run_dir(policy, run_id) / "v2"


def _load_charter(phase: dict[str, Any], policy: dict[str, Any]) -> tuple[dict[str, Any], Path]:
    state = RunStore(policy["state_root"], phase["run_id"]).load()
    try:
        charter_path = Path(state["big_tasks"][phase["big_task_id"]]["charter_path"])
    except KeyError as exc:
        raise ContractError("phase's big task is not registered in v2 state") from exc
    return load_and_validate(charter_path, "charter", policy), charter_path


def _create_worktree_if_needed(phase: dict[str, Any], policy: dict[str, Any]) -> None:
    if not phase["write_capable"]:
        return
    wt = phase["worktree"]
    path = Path(wt["path"])
    if path.exists():
        return
    if not wt.get("create_if_missing", False):
        raise ContractError(f"worktree does not exist and create_if_missing=false: {path}")
    proc = run([
        "/home/khoa/.local/bin/mlgo-worktree",
        "create",
        phase["phase_id"],
        wt["base_ref"],
    ], cwd=policy["repo_root"], timeout=120)
    created: dict[str, str] = {}
    for line in proc.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            created[key.strip()] = value.strip().strip("'\"")
    created_path = Path(created.get("WORKTREE", "")).expanduser().resolve() if created.get("WORKTREE") else None
    created_branch = created.get("BRANCH")
    if created_path != path.resolve() or created_branch != wt["branch"]:
        raise ContractError(
            "mlgo-worktree created a different binding than the phase packet: "
            f"created path={created_path}, branch={created_branch!r}; "
            f"expected path={path.resolve()}, branch={wt['branch']!r}"
        )
    if not path.exists():
        raise ContractError(
            f"mlgo-worktree create completed but expected path does not exist: {path}"
        )


def submit_phase(
    *,
    phase_path: str | Path,
    policy_path: str | Path | None = None,
    shadow: bool = False,
) -> dict[str, Any]:
    policy = load_policy(policy_path)
    phase_raw = load_json(phase_path)
    charter, _ = _load_charter(phase_raw, policy)
    phase = validate_phase_packet(phase_raw, policy, charter)
    proposal = load_and_validate(
        phase["routing_proposal_file"], "routing", policy, charter=charter
    )
    snapshot = load_snapshot(policy, proposal["capacity_snapshot_id"])
    # The Task Lead must have seen the exact snapshot used for routing.  A stale
    # or missing snapshot requires a new planner proposal instead of a silent
    # host rewrite.
    v2 = _v2_dir(policy, phase["run_id"])
    builder_family = None
    execution_role = "reviewer" if phase["phase_kind"] == "review" else "builder"
    if execution_role == "reviewer":
        parent_id = phase.get("parent_phase_id")
        parent_record = RunStore(policy["state_root"], phase["run_id"]).load()["phases"].get(parent_id, {})
        parent_route = parent_record.get("selected_route")
        if not parent_route:
            raise ContractError("review phase parent has no selected builder route")
        builder_family = route(policy, parent_route)["family"]
    decision = decide_route(
        proposal, charter, snapshot, policy,
        builder_provider_family=builder_family,
        execution_role=execution_role,
    )
    decision_path = v2 / "packets" / f"{phase['phase_id']}-routing-decision.json"
    atomic_write_json(decision_path, decision)

    store = RunStore(policy["state_root"], phase["run_id"])
    state_before = store.load()
    if phase["phase_id"] not in state_before["phases"] and phase["phase_kind"] in {"implementation", "integration_repair"}:
        existing_implementation = sum(
            1 for item in state_before["phases"].values()
            if item.get("big_task_id") == phase["big_task_id"]
            and item.get("phase_kind") in {"implementation", "integration_repair"}
        )
        if existing_implementation >= int(charter["delegation_envelope"]["max_phases"]):
            raise PolicyError("phase count exceeds the approved Delegation Envelope")
    try:
        store.register_phase(phase, str(Path(phase_path).resolve()))
    except PolicyError as exc:
        if "already exists" not in str(exc):
            raise
    current = store.load()["phases"][phase["phase_id"]]["state"]
    if current == "COMPLETE":
        return {"ok": True, "duplicate": True, "phase_id": phase["phase_id"], "state": current}
    if current in {"CREATED", "BLOCKED", "AWAITING_SEMANTIC_DECISION"}:
        store.transition_phase(
            phase["phase_id"], "ROUTING_PENDING",
            reason="routing proposal validated" if current == "CREATED" else "approved phase retry/replan",
            updates={"packet_path": str(Path(phase_path).resolve()), "last_error": None},
        )
        current = "ROUTING_PENDING"
    if decision["decision"] != "ROUTE_SELECTED":
        if current == "ROUTING_PENDING":
            store.transition_phase(
                phase["phase_id"],
                "BLOCKED",
                reason=decision["decision"],
                updates={"routing_decision_path": str(decision_path)},
            )
        return {"ok": False, "decision": decision, "decision_path": str(decision_path)}
    if current == "ROUTING_PENDING":
        store.transition_phase(
            phase["phase_id"],
            "ROUTED",
            reason="host routing decision selected an eligible route",
            updates={
                "routing_decision_path": str(decision_path),
                "selected_route": decision["selected_route"],
                "selected_provider": decision["selected_provider"],
                "selected_account_pool": decision["selected_account_pool"],
                "selected_tier": decision["selected_tier"],
            },
        )

    if shadow:
        return {
            "ok": True,
            "shadow": True,
            "phase_id": phase["phase_id"],
            "decision": decision,
            "decision_path": str(decision_path),
        }

    # Process/service liveness grants no execution authority. Real provider
    # dispatch requires an explicit, time-bounded canary scope naming this
    # run_id; a caller requesting non-shadow dispatch (including the
    # controller, which always requests real dispatch for review phases)
    # without an active authorizing scope is downgraded to a safe
    # observe-only outcome instead of emitting a real provider call.
    if not canary_scope.is_authorized(policy, run_id=phase["run_id"]):
        return {
            "ok": True,
            "shadow": True,
            "posture": canary_scope.posture(policy),
            "reason": "no_active_canary_scope",
            "phase_id": phase["phase_id"],
            "decision": decision,
            "decision_path": str(decision_path),
        }

    _create_worktree_if_needed(phase, policy)
    if phase["write_capable"]:
        wt = phase["worktree"]
        current = store.load()["phases"][phase["phase_id"]]["state"]
        if current == "ROUTED":
            store.transition_phase(phase["phase_id"], "PREFLIGHT_PENDING", reason="host preflight starting")
        preflight = verify_worktree(
            wt["path"],
            expected_branch=wt["branch"],
            require_clean=wt["require_clean"],
            evidence_directory=phase["evidence_directory"],
            working_directory=wt["path"],
        )
        preflight_path = v2 / "packets" / f"{phase['phase_id']}-preflight.json"
        atomic_write_json(preflight_path, {"schema_version": "2.0", "at": iso_now(), **preflight})
    dispatch_lock = Path(policy["state_root"]) / "governance" / ".v2-dispatch.lock"
    with file_lock(dispatch_lock):
        rejection = _concurrency_rejection(phase, decision, charter, policy)
        if rejection:
            current = store.load()["phases"][phase["phase_id"]]["state"]
            if current not in {"BLOCKED", "FAILED", "CANCELLED", "COMPLETE"}:
                store.transition_phase(
                    phase["phase_id"], "BLOCKED",
                    reason=f"CONCURRENCY_LIMIT: {rejection}",
                    updates={"last_error": rejection},
                )
            return {"ok": False, "decision": "BLOCKED_BY_CONCURRENCY", "reason": rejection}

        phase_record = store.load()["phases"][phase["phase_id"]]
        existing_job_path = phase_record.get("job_path")
        if existing_job_path and Path(existing_job_path).is_file():
            existing_job = load_json(existing_job_path)
            return {
                "ok": True, "shadow": False, "duplicate": True,
                "phase_id": phase["phase_id"], "job_id": existing_job["job_id"],
                "job_path": existing_job_path, "systemd_unit": existing_job.get("systemd_unit"),
                "decision": decision, "job_status": existing_job.get("status"),
            }
        attempt = int(phase_record.get("attempt", 0)) + 1
        job_key = sha256_json({
            "phase_packet": phase, "routing_decision": decision, "attempt": attempt,
        })[:12]
        job_id = f"phase-{phase['phase_id']}-a{attempt}-{job_key}"
        job_dir = v2 / "jobs" / job_id
        job_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        unit = f"mlgo-cao-v2-{job_id}"[:240]
        job = {
            "schema_version": "2.1", "job_id": job_id, "run_id": phase["run_id"],
            "big_task_id": phase["big_task_id"], "phase_id": phase["phase_id"],
            "phase_packet_path": str(Path(phase_path).resolve()),
            "routing_decision_path": str(decision_path), "route": decision,
            "status": "QUEUED", "attempt": attempt, "systemd_unit": unit,
            "idempotency_key": job_key, "created_at": iso_now(), "updated_at": iso_now(),
        }
        job_path = job_dir / "job.json"
        atomic_write_json(job_path, job)
        current = store.load()["phases"][phase["phase_id"]]["state"]
        if current in {"ROUTED", "PREFLIGHT_PENDING"}:
            store.transition_phase(phase["phase_id"], "DISPATCHED", reason="phase job queued", updates={"job_path": str(job_path), "attempt": attempt})
        command = ["/home/khoa/.local/bin/mlgo-v2-dispatch", "run-job", "--job-file", str(job_path)]
        # A deterministic unit name makes a lost systemd-run response recoverable.
        active = run(["systemctl", "--user", "show", unit, "--property=LoadState", "--value"], timeout=15, check=False)
        if active.returncode == 0 and active.stdout.strip() not in {"", "not-found"}:
            proc_stdout = "existing deterministic unit"
        else:
            proc = run([
                "systemd-run", "--user", "--collect", "--unit", unit,
                "--property=UMask=0077", "--property=NoNewPrivileges=yes", *command,
            ], timeout=30)
            proc_stdout = proc.stdout.strip()
    return {
        "ok": True,
        "shadow": False,
        "phase_id": phase["phase_id"],
        "job_id": job_id,
        "job_path": str(job_path),
        "systemd_unit": unit,
        "decision": decision,
        "systemd_output": proc_stdout,
    }


def _task_prompt(phase: dict[str, Any], decision: dict[str, Any]) -> str:
    prompt = Path(phase["prompt_file"]).read_text(encoding="utf-8")
    header = f"""MLGO CAO v2 bounded phase execution

Run ID: {phase['run_id']}
Big task: {phase['big_task_id']}
Phase: {phase['phase_id']}
Kind: {phase['phase_kind']}
Objective: {phase['objective']}
Selected route: {decision['selected_route']}
Selected model: {decision['selected_model']}

Operate only inside the assigned phase boundary.  Challenge stale assumptions
with PLAN_CONFLICT or CAPABILITY_ESCALATION_REQUIRED instead of expanding scope.
Do not stage, commit, merge, publish, edit durable run state, or manage callbacks.
The deterministic host owns those operations.
"""
    return header + "\n\n" + prompt.strip() + "\n\n" + result_packet_instructions(phase) + "\n"


def _execute_provider(
    phase: dict[str, Any], decision: dict[str, Any], policy: dict[str, Any], prompt: str
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    """Execute one bounded phase through the registry-selected transport.

    Lightweight callers/tests that supply the pre-Slice-1 policy shape retain
    the exact 0.2.5 compatibility path.  Loaded production policy always carries
    the validated canonical registry and takes the provider-neutral path.
    """
    worktree = phase.get("worktree") or {}
    registry = policy.get("_registry")
    if not isinstance(registry, dict):
        # Compatibility seam for existing callers during per-run migration.
        endpoint = policy["agy_sidecar_api"] if decision["selected_provider_api"] == "sidecar" else policy["main_cao_api"]
        selected_provider = str(decision["selected_provider"])
        body = {
            "provider": "antigravity_cli" if selected_provider == "agy" else selected_provider,
            "agent": decision["selected_profile"],
            "prompt": prompt,
            "teardown": False,
            "timeout": float(max(300, phase["validation"]["timeout_seconds"])),
            "working_directory": worktree.get("path") or policy["repo_root"],
            "model": None if selected_provider == "agy" else decision["selected_model"],
            "workspace_root": worktree.get("path") if phase["write_capable"] else None,
            "expected_branch": worktree.get("branch") if phase["write_capable"] else None,
            "require_clean_worktree": bool(worktree.get("require_clean")) if phase["write_capable"] else False,
            "evidence_directory": phase["evidence_directory"],
            "env_vars": None,
        }
        response = request_json(
            endpoint.rstrip("/") + "/terminals/run-step", method="POST", body=body,
            timeout=float(body["timeout"]) + 240.0,
        )
        terminal_id = response.get("terminal_id")
        if not isinstance(terminal_id, str) or not terminal_id:
            raise ContractError("CAO run-step settled without returning a terminal_id")
        return response, endpoint, {
            "provider_session_id": response.get("provider_session_id") or response.get("session_id") or response.get("rollout_id"),
            "provider_session_artifact": response.get("transcript_path") or response.get("rollout_path"),
            "response_message_id": response.get("message_id") or response.get("last_message_id"),
            "raw_response_keys": sorted(response.keys()),
            "run_step_request_sha256": sha256_json(body),
            "run_step_teardown": False,
            "requested_provider": body["provider"],
            "requested_profile": body["agent"],
            "requested_model": body["model"],
            "provider_api": decision["selected_provider_api"],
            "cao_endpoint": endpoint,
            "compatibility_projection": True,
        }

    selected_route = decision.get("selected_route")
    if not selected_route:
        # Old decision packets can be read during migration, but selection is
        # still resolved from the canonical registry rather than a brand map.
        matches = []
        for route_id, item in registry["routes"].items():
            if item.get("execution_profile_id") != decision.get("selected_profile"):
                continue
            if item.get("provider_id") != decision.get("selected_provider"):
                continue
            matches.append(route_id)
        if len(matches) != 1:
            raise ContractError("legacy routing decision cannot be resolved uniquely in canonical registry")
        selected_route = matches[0]
    route_cfg = route(policy, str(selected_route))
    transport_cfg = registry["transports"][route_cfg["transport_id"]]
    provider_cfg = registry["providers"][route_cfg["provider_id"]]
    adapter = adapter_for_route(registry, route_cfg, policy)
    # Preserve the existing dispatch-level request seam used by deterministic
    # tests while the actual adapter remains transport-only.
    if hasattr(adapter, "_request"):
        adapter._request = request_json  # type: ignore[attr-defined]
    endpoint = getattr(adapter, "endpoint", None)
    if not isinstance(endpoint, str) or not endpoint:
        raise ContractError("selected transport adapter exposes no authoritative CAO endpoint")
    body = {
        "provider": provider_cfg["runtime_provider"],
        "agent": decision["selected_profile"],
        "prompt": prompt,
        "teardown": False,
        "timeout": float(max(300, phase["validation"]["timeout_seconds"])),
        "working_directory": worktree.get("path") or policy["repo_root"],
        "model": decision["selected_model"] if transport_cfg.get("include_model", True) else None,
        "workspace_root": worktree.get("path") if phase["write_capable"] else None,
        "expected_branch": worktree.get("branch") if phase["write_capable"] else None,
        "require_clean_worktree": bool(worktree.get("require_clean")) if phase["write_capable"] else False,
        "evidence_directory": phase["evidence_directory"],
        "env_vars": None,
    }
    submitted = adapter.submit({"command_id": "legacy-compat-transport"}, body)
    if submitted.certainty != SubmitCertainty.ACCEPTED or not isinstance(submitted.response, dict):
        raise ContractError(f"CAO transport did not produce an accepted response: {submitted.certainty}")
    response = submitted.response
    terminal_id = response.get("terminal_id")
    if not isinstance(terminal_id, str) or not terminal_id:
        raise ContractError("CAO run-step settled without returning a terminal_id")
    metadata = {
        "provider_session_id": response.get("provider_session_id") or response.get("session_id") or response.get("rollout_id"),
        "provider_session_artifact": response.get("transcript_path") or response.get("rollout_path"),
        "response_message_id": response.get("message_id") or response.get("last_message_id"),
        "raw_response_keys": sorted(response.keys()),
        "run_step_request_sha256": sha256_json(body),
        "run_step_teardown": False,
        "requested_provider": body["provider"],
        "requested_profile": body["agent"],
        "requested_model": body["model"],
        "transport_id": route_cfg["transport_id"],
        "transport_adapter_id": transport_cfg["adapter_id"],
        "cao_endpoint": endpoint,
    }
    return response, endpoint, metadata

def _terminal_id_from_http_error(exc: HTTPError) -> str | None:
    payload = exc.payload
    candidates: list[Any] = [payload]
    while candidates:
        value = candidates.pop()
        if isinstance(value, dict):
            terminal_id = value.get("terminal_id")
            if isinstance(terminal_id, str) and terminal_id:
                return terminal_id
            candidates.extend(value.values())
        elif isinstance(value, list):
            candidates.extend(value)
    return None


def run_job(job_file: str | Path, policy_path: str | Path | None = None) -> dict[str, Any]:
    policy = load_policy(policy_path)
    job_path = Path(job_file).resolve()
    job = load_json(job_path)
    phase = load_json(job["phase_packet_path"])
    charter, _ = _load_charter(phase, policy)
    phase = validate_phase_packet(phase, policy, charter)
    decision = load_json(job["routing_decision_path"])
    job_dir = job_path.parent
    completion_dir = job_dir / "completion"
    store = RunStore(policy["state_root"], phase["run_id"])
    run_state = store.load()
    if run_state.get("vnext_writers_enabled"):
        raise PolicyError(
            "legacy run_job provider path is disabled for RunContractBinding vNext runs; "
            "use the fenced durable Command transport path"
        )
    if job.get("status") == "RESULT_WRITTEN" and job.get("result_path") and Path(job["result_path"]).is_file():
        return {**job, "duplicate": True}

    terminal_id: str | None = None
    endpoint: str | None = None
    cleanup_record: dict[str, Any] | None = None
    provider_metadata: dict[str, Any] = {}
    model_observed = False
    pre_provider_failure = True

    try:
        current = store.load()["phases"][phase["phase_id"]]["state"]
        if current == "DISPATCHED":
            store.transition_phase(phase["phase_id"], "RUNNING", reason="provider execution started")
        elif current != "RUNNING":
            raise PolicyError(f"phase is not dispatchable: {current}")
        job.update(
            {
                "status": "RUNNING",
                "started_at": iso_now(),
                "updated_at": iso_now(),
                "actual_call_consumed": False,
                "provider_start_state": "NOT_STARTED",
                "completion_state": "NOT_STARTED",
            }
        )
        atomic_write_json(job_path, job)

        prompt_text = _task_prompt(phase, decision)
        read_only_workspace = Path(
            (phase.get("worktree") or {}).get("path") or policy["repo_root"]
        ).resolve()
        read_only_before = git_snapshot(read_only_workspace) if not phase["write_capable"] else None
        prompt_file = job_dir / "effective-prompt.md"
        atomic_write_text(prompt_file, prompt_text)
        prompt_manifest = record_dispatch_prompt(
            state_root=policy["state_root"],
            job_id=job["job_id"],
            selected_profile=decision["selected_profile"],
            provider=decision["selected_provider"],
            model=decision["selected_model"],
            effective_task_prompt=prompt_file,
            profile_source_dir=policy["profile_source_dir"],
        )
        job["prompt_manifest"] = str(prompt_manifest)
        atomic_write_json(job_path, job)

        # Defense in depth.  The runtime-canary script performs this check before
        # reserving a live call; dispatch repeats it immediately before the CAO
        # run-step boundary for main-CAO/Herdr providers.
        route_cfg = route(policy, decision["selected_route"])
        transport_cfg = policy["_registry"]["transports"][route_cfg["transport_id"]]
        if transport_cfg.get("requires_herdr_preflight", False):
            preflight_record = preflight_herdr_boundary(policy)
            atomic_write_json(job_dir / "herdr-preflight.json", preflight_record)
        pre_provider_failure = False

        execution_started = time.monotonic()
        run_step_response, endpoint, provider_metadata = _execute_provider(
            phase, decision, policy, prompt_text
        )
        execution_elapsed = time.monotonic() - execution_started
        terminal_id = str(run_step_response["terminal_id"])
        model_observed = True
        provider_metadata.update({
            "terminal_id": terminal_id,
            "observed_at": iso_now(),
            "routing_decision_sha256": sha256_json(decision),
        })
        provider_boundary_path = completion_dir / "provider-execution-boundary.json"
        atomic_write_json(provider_boundary_path, provider_metadata)
        job.update(
            {
                "terminal_id": terminal_id,
                "actual_call_consumed": True,
                "provider_start_state": "PROVIDER_RESPONSE_OBSERVED",
                "completion_state": "SEMANTIC_SETTLED_RESULT_PENDING",
                "run_step_response_path": str(completion_dir / "run-step-response.json"),
                "provider_execution_boundary_path": str(provider_boundary_path),
                "updated_at": iso_now(),
            }
        )
        atomic_write_json(job_path, job)

        provider_cfg = policy["_registry"]["providers"][route_cfg["provider_id"]]
        if provider_cfg.get("usage_mode") == "unavailable":
            usage_event = agy_usage_placeholder(
                run_id=phase["run_id"],
                task_id=phase["big_task_id"],
                role=phase["phase_kind"],
                job_id=job["job_id"],
                model=decision["selected_model"],
                prompt_bytes=len(prompt_text.encode("utf-8")),
                elapsed_seconds=execution_elapsed,
            )
            usage_event["phase_id"] = phase["phase_id"]
            usage_event["terminal_id"] = terminal_id
        else:
            usage_event = execution_usage_placeholder(
                provider=route_cfg["provider_id"],
                run_id=phase["run_id"],
                task_id=phase["big_task_id"],
                phase_id=phase["phase_id"],
                role=phase["phase_kind"],
                job_id=job["job_id"],
                terminal_id=terminal_id,
                model=decision["selected_model"],
                prompt_bytes=len(prompt_text.encode("utf-8")),
                elapsed_seconds=execution_elapsed,
            )
        usage_event["enforcement_mode"] = (policy.get("usage") or {}).get(
            "enforcement_mode", "warning_only"
        )
        usage_event["exact_correlation"] = bool(
            provider_metadata.get("provider_session_id")
            and provider_metadata.get("provider_session_artifact")
        )
        usage_event["hard_budget_eligible"] = bool(
            usage_event["exact_correlation"] and usage_event["enforcement_mode"] == "hard"
        )
        usage_path = append_usage_event(policy["state_root"], usage_event)
        job["usage_event_path"] = str(usage_path)
        job["usage_event_observed"] = True
        atomic_write_json(job_path, job)

        result: dict[str, Any]
        capture: dict[str, Any]
        capture_error: Exception | None = None
        try:
            result, capture = capture_stable_result(
                endpoint=endpoint,
                terminal_id=terminal_id,
                phase=phase,
                decision=decision,
                policy=policy,
                evidence_directory=completion_dir,
                run_step_response=run_step_response,
                run_step_metadata=provider_metadata,
            )
            authoritative_raw_path = Path(capture["authoritative_raw_path"])
            atomic_write_text(job_dir / "raw-output.txt", authoritative_raw_path.read_text(encoding="utf-8"))
        except Exception as exc:  # cleanup must run after evidence capture on every post-model path
            capture_error = exc
            best = completion_dir / "best-last-output.txt"
            if not best.is_file():
                best = completion_dir / "best-full-output.txt"
            if best.is_file():
                atomic_write_text(job_dir / "raw-output.txt", best.read_text(encoding="utf-8"))
            raise
        finally:
            try:
                cleanup_record = cleanup_retained_terminal(
                    endpoint=endpoint,
                    terminal_id=terminal_id,
                    evidence_directory=completion_dir,
                    policy=policy,
                )
                job["terminal_cleanup"] = cleanup_record
                atomic_write_json(job_path, job)
            except Exception as cleanup_exc:
                cleanup_record = {
                    "status": "CLEANUP_FAILED",
                    "terminal_id": terminal_id,
                    "error": str(cleanup_exc),
                }
                job["terminal_cleanup"] = cleanup_record
                atomic_write_json(job_path, job)
                if capture_error is None:
                    raise

        if read_only_before is not None:
            read_only_after = git_snapshot(read_only_workspace)
            for field in ("branch", "head", "status_porcelain", "diff_name_status"):
                if read_only_after[field] != read_only_before[field]:
                    raise PolicyError(
                        f"read-only phase mutated repository state ({field}); raw provider output is preserved"
                    )

        result["provider_session_id"] = result.get("provider_session_id") or provider_metadata.get(
            "provider_session_id"
        )
        result["provider_session_artifact"] = provider_metadata.get("provider_session_artifact")
        result["host_observed_response_message_id"] = provider_metadata.get("response_message_id")
        result["host_observed_response_sha256"] = capture["authoritative_raw_sha256"]
        result["host_requested_model"] = capture.get("host_requested_model")
        result["host_execution_boundary_sha256"] = capture.get("host_execution_boundary_sha256")
        result["host_observed_result_block_sha256"] = capture[
            "authoritative_result_block_sha256"
        ]
        result["terminal_metadata_sha256"] = capture["terminal_metadata_sha256"]
        result["completion_capture_path"] = str(completion_dir / "completion-capture.json")
        result["cao_terminal_id"] = terminal_id
        result["model"] = decision["selected_model"]
        result_path = job_dir / "result.json"
        atomic_write_json(result_path, result)
        event = {
            "schema_version": "2.1",
            "event_id": f"result-{job['job_id']}",
            "event_type": "PHASE_RESULT",
            "run_id": phase["run_id"],
            "big_task_id": phase["big_task_id"],
            "phase_id": phase["phase_id"],
            "job_id": job["job_id"],
            "result_path": str(result_path),
            "created_at": iso_now(),
        }
        event_path = (
            _v2_dir(policy, phase["run_id"])
            / "events"
            / "incoming"
            / f"{event['event_id']}.json"
        )
        atomic_write_json(event_path, event)
        job.update(
            {
                "status": "RESULT_WRITTEN",
                "completion_state": "RESULT_PACKET_STABLE",
                "result_path": str(result_path),
                "terminal_id": terminal_id,
                "actual_call_consumed": True,
                "updated_at": iso_now(),
            }
        )
        atomic_write_json(job_path, job)
        return job
    except Exception as exc:
        if terminal_id is None and isinstance(exc, HTTPError):
            terminal_id = _terminal_id_from_http_error(exc)
            if terminal_id:
                job["terminal_id"] = terminal_id
                job["provider_start_state"] = "START_RECONCILIATION_REQUIRED"
        if isinstance(exc, ModelOutputIncomplete):
            outcome = "MODEL_OUTPUT_INCOMPLETE"
            contract_outcome = exc.contract_outcome
            status = "MODEL_OUTPUT_INCOMPLETE"
        elif pre_provider_failure or isinstance(exc, HerdrPreflightError):
            outcome = "FAILED_BEFORE_PROVIDER_START"
            contract_outcome = "PRE_PROVIDER_DEPENDENCY_FAILURE"
            status = "FAILED"
        elif model_observed:
            outcome = "POST_MODEL_CONTRACT_FAILURE"
            contract_outcome = "POST_MODEL_CONTRACT_FAILURE"
            status = "FAILED"
        else:
            outcome = "START_RECONCILIATION_REQUIRED"
            contract_outcome = "PROVIDER_START_UNCERTAIN"
            status = "FAILED"
        actual_consumed = bool(model_observed or job.get("usage_event_observed"))
        error_path = job_dir / "error.json"
        error_record = {
            "error": str(exc),
            "type": type(exc).__name__,
            "traceback": traceback.format_exc(),
            "at": iso_now(),
            "outcome": outcome,
            "contract_outcome": contract_outcome,
            "actual_call_consumed": actual_consumed,
            "terminal_id": terminal_id,
            "completion_evidence_path": str(completion_dir) if completion_dir.exists() else None,
            "terminal_cleanup": cleanup_record,
            "precise_parser_rejection": (
                exc.precise_rejection if isinstance(exc, ModelOutputIncomplete) else None
            ),
            "parser_rejection_history": (
                exc.parser_rejections if isinstance(exc, ModelOutputIncomplete) else []
            ),
        }
        atomic_write_json(error_path, error_record)
        try:
            current = store.load()["phases"][phase["phase_id"]]["state"]
            if current not in {"FAILED", "BLOCKED", "COMPLETE", "CANCELLED"}:
                store.transition_phase(
                    phase["phase_id"],
                    "FAILED",
                    reason=f"dispatch job failed: {contract_outcome}: {exc}",
                    updates={
                        "last_error": str(exc),
                        "last_error_outcome": contract_outcome,
                        "actual_call_consumed": actual_consumed,
                    },
                )
        except Exception:
            pass
        job.update(
            {
                "status": status,
                "outcome": outcome,
                "contract_outcome": contract_outcome,
                "actual_call_consumed": actual_consumed,
                "terminal_id": terminal_id,
                "error_path": str(error_path),
                "completion_state": outcome,
                "updated_at": iso_now(),
            }
        )
        atomic_write_json(job_path, job)
        raise
