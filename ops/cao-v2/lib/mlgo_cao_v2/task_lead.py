"""Start and contact an episodic Frontier Task Lead with truthful health semantics.

Slice 2 makes the Tech Lead an active coordinator rather than a context-poor
relay: ``TechLeadExecutionState`` is a compact but *complete* normalized view of
the work package, and it survives process/host loss through the same immutable
checkpoint primitives the Supervisor uses.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .capacity import create_snapshot
from .checkpoints import create_checkpoint, normalize_cursors, validate_checkpoint
from .common import ContractError, PolicyError, atomic_write_json, iso_now, sha256_json, validate_id
from .contracts import load_and_validate
from .http_client import request_json
from .policy import load_policy
from .registry import profile as registry_profile
from .provenance import create_delivery
from .state_machine import RunStore

TECH_LEAD_STATE_SCHEMA_VERSION = "1.0"

TECH_LEAD_STATE_SECTIONS = (
    "task_graph",
    "ownership",
    "evidence_refs",
    "decisions",
    "risks",
    "dependencies",
)


def start_task_lead(*, run_id: str, big_task_id: str, task_lead_id: str, charter_path: str | Path, profile: str, main_session: str = "mlgo-cao", supervisor_terminal_id: str | None = None, policy_path: str | Path | None = None, recovery_checkpoint: str | Path | None = None, gateway_authorized: bool = False) -> dict[str, Any]:
    policy = load_policy(policy_path); validate_id(run_id, "run_id"); validate_id(big_task_id, "big_task_id"); validate_id(task_lead_id, "task_lead_id")
    profile_cfg = registry_profile(policy["_registry"], profile)
    if profile_cfg.get("role_id") != "tech_lead": raise ContractError(f"profile is not a Tech Lead profile: {profile}")
    charter = load_and_validate(charter_path, "charter", policy)
    if charter.get("run_id") != run_id or charter.get("big_task_id") != big_task_id: raise ContractError("charter identity does not match Task Lead request")
    if profile_cfg.get("gateway") and (not gateway_authorized or not charter["delegation_envelope"].get("gateway_allowed", False)):
        raise PolicyError("gateway Tech Lead requires charter permission and explicit runtime authorization")
    store = RunStore(policy["state_root"], run_id); state = store.load(); existing = state.get("task_leads", {}).get(task_lead_id)
    if existing and recovery_checkpoint is None: raise PolicyError("existing Task Lead generation may be replaced only from a durable checkpoint")
    generation = int((existing or {}).get("generation", 0)) + 1
    snapshot = create_snapshot(policy, run_id=run_id, gateway_authorized=gateway_authorized)
    snapshot_path = Path(policy["state_root"]) / "governance" / "capacity-snapshots" / f"{snapshot['snapshot_id']}.json"
    prompt = f"""Start Frontier Task Lead episode for big task {big_task_id} in run {run_id}.

Read the approved charter at:
{Path(charter_path).resolve()}

Use the durable v2 directory:
{store.v2_dir}

Plan progressively and emit compact durable packets. Use this exact host capacity snapshot:
{snapshot_path}

Prefer Gemini when sufficient. Do not process routine callbacks, Git operations,
leases, retries, capacity probing or state transitions.
"""
    if recovery_checkpoint is not None: prompt += f"\nRecover truthfully from Task Lead checkpoint:\n{Path(recovery_checkpoint).resolve()}\n"
    terminal = request_json(
        f"{policy['main_cao_api']}/sessions/{main_session}/terminals", method="POST",
        query={"agent_profile": profile, "provider": policy["_registry"]["providers"][profile_cfg["provider_id"]]["runtime_provider"], "working_directory": policy["repo_root"], "caller_id": supervisor_terminal_id, "defer_init": "true", "model": profile_cfg["model"]},
        body={"initial_message": prompt, "initial_message_orchestration_type": "assign"}, timeout=60,
    )
    terminal_id = validate_id(str(terminal.get("id") or ""), "terminal_id")
    record = {
        "schema_version": "2.1", "task_lead_id": task_lead_id, "big_task_id": big_task_id,
        "profile": profile, "provider": profile_cfg["provider_id"], "model": profile_cfg["model"],
        "terminal_id": terminal_id, "provider_session_id": terminal.get("provider_session_id") or terminal.get("session_id"),
        "session_name": terminal.get("session_name") or main_session, "generation": generation,
        "status": "STARTING_UNVERIFIED", "health_claim": "terminal created; model-level handshake pending",
        "charter_path": str(Path(charter_path).resolve()),
        "recovery_checkpoint": str(Path(recovery_checkpoint).resolve()) if recovery_checkpoint else None,
        "started_at": iso_now(), "updated_at": iso_now(),
    }
    if big_task_id not in store.load()["big_tasks"]: store.register_big_task(big_task_id, str(Path(charter_path).resolve()), task_lead_id)
    else: store.bind_task_lead(big_task_id, task_lead_id)
    store.register_task_lead(task_lead_id, record)
    path = store.v2_dir / "task-leads" / f"{task_lead_id}.json"; atomic_write_json(path, record)

    def sender(message: str) -> dict[str, Any]:
        return request_json(f"{policy['main_cao_api']}/terminals/{terminal_id}/inbox/messages", method="POST", query={"sender_id": "mlgo-v2-task-lead-launch", "message": message}, timeout=30)
    handshake = create_delivery(store=store, recipient_role="task_lead", terminal_id=terminal_id, profile=profile, generation=generation, provider=profile_cfg["provider_id"], provider_session_id=record.get("provider_session_id"), payload="MLGO Task Lead launch health challenge. Acknowledge only; do not plan until the next explicit packet.", sender=sender, delivery_id=f"dlv-{task_lead_id}-g{generation}-launch")
    record["launch_handshake_delivery_id"] = handshake["delivery_id"]; atomic_write_json(path, record)
    return {"record": record, "record_path": str(path), "terminal": terminal, "handshake": handshake}


def notify_supervisor(*, run_id: str, big_task_id: str, packet_path: str | Path, supervisor_terminal_id: str, policy_path: str | Path | None = None) -> dict[str, Any]:
    policy = load_policy(policy_path); store = RunStore(policy["state_root"], run_id); state = store.load(); selected = state["supervisor_selection"]
    if selected.get("terminal_id") and selected["terminal_id"] != supervisor_terminal_id: raise PolicyError("notification target is not the bound authoritative supervisor terminal")
    packet = json.loads(Path(packet_path).read_text(encoding="utf-8")); payload = "MLGO_BIG_TASK_PACKET\n" + json.dumps(packet, indent=2, sort_keys=True) + "\nEND_MLGO_BIG_TASK_PACKET"
    def sender(message: str) -> dict[str, Any]:
        return request_json(f"{policy['main_cao_api']}/terminals/{supervisor_terminal_id}/inbox/messages", method="POST", query={"sender_id": f"task-lead:{big_task_id}", "message": message}, timeout=30)
    return create_delivery(store=store, recipient_role="authoritative_supervisor", terminal_id=supervisor_terminal_id, profile=selected["profile"], generation=int(selected.get("generation", 1)), provider=str(selected.get("provider") or policy["supervisor_profiles"][selected["profile"]]["provider"]), provider_session_id=selected.get("provider_session_id"), payload=payload, sender=sender)


# --------------------------------------------------------------------------
# TechLeadExecutionState
# --------------------------------------------------------------------------


def _sorted_records(value: object, *, key: str, label: str) -> list[dict[str, Any]]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ContractError(f"{label} must be a list")
    out: list[dict[str, Any]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ContractError(f"each {label} entry must be an object")
        if not item.get(key):
            raise ContractError(f"each {label} entry needs {key}")
        out.append({k: item[k] for k in sorted(item)})
    out.sort(key=lambda item: str(item[key]))
    return out


def normalize_tech_lead_execution_state(value: dict[str, Any]) -> dict[str, Any]:
    """Produce the canonical, digest-stable Tech Lead execution state.

    Normalization is total and deterministic so that a checkpoint digest taken
    on one process equals the digest recomputed on a recreated process.
    """

    if not isinstance(value, dict):
        raise ContractError("TechLeadExecutionState must be an object")
    for field in ("run_id", "big_task_id", "task_id", "task_lead_id"):
        if not value.get(field):
            raise ContractError(f"TechLeadExecutionState missing {field}")

    task_graph = _sorted_records(value.get("task_graph"), key="task_id", label="task_graph")
    known = {item["task_id"] for item in task_graph}
    for item in task_graph:
        if not item.get("status"):
            raise ContractError("each task_graph entry needs a status")
        depends = item.get("depends_on") or []
        if not isinstance(depends, list):
            raise ContractError("task_graph depends_on must be a list")
        unknown = sorted(set(map(str, depends)) - known)
        if unknown:
            raise ContractError(f"task_graph references unknown dependencies: {unknown}")
        item["depends_on"] = sorted(map(str, depends))

    ownership_raw = value.get("ownership") or {}
    if not isinstance(ownership_raw, dict):
        raise ContractError("ownership must be an object")
    ownership = {
        "workers": _sorted_records(ownership_raw.get("workers"), key="worker_id", label="ownership.workers"),
        "files": sorted({str(x) for x in (ownership_raw.get("files") or [])}),
        "worktrees": _sorted_records(ownership_raw.get("worktrees"), key="worktree_id", label="ownership.worktrees"),
    }

    normalized = {
        "schema_version": TECH_LEAD_STATE_SCHEMA_VERSION,
        "run_id": value["run_id"],
        "big_task_id": value["big_task_id"],
        "task_id": value["task_id"],
        "task_lead_id": value["task_lead_id"],
        "generation": int(value.get("generation", 1)),
        "task_graph": task_graph,
        "ownership": ownership,
        "evidence_refs": _sorted_records(value.get("evidence_refs"), key="id", label="evidence_refs"),
        "decisions": _sorted_records(value.get("decisions"), key="decision_id", label="decisions"),
        "risks": _sorted_records(value.get("risks"), key="risk_id", label="risks"),
        "dependencies": _sorted_records(value.get("dependencies"), key="dependency_id", label="dependencies"),
        "delegation_revision": str(value.get("delegation_revision") or ""),
        "charter_revision": str(value.get("charter_revision") or ""),
        "cursors": normalize_cursors(value.get("cursors")),
        "last_committed_state_version": int(value.get("last_committed_state_version", 0)),
        "completed_task_ids": sorted({item["task_id"] for item in task_graph if str(item.get("status")) == "COMPLETE"}),
    }
    if not normalized["delegation_revision"] or not normalized["charter_revision"]:
        raise ContractError("TechLeadExecutionState must bind a delegation and charter revision")
    normalized["state_digest"] = sha256_json({k: v for k, v in normalized.items() if k != "state_digest"})
    return normalized


def create_tech_lead_checkpoint(
    *,
    checkpoint_id: str,
    execution_state: dict[str, Any],
    registry_digest: str,
    policy_digest: str,
    contract_bundle_digest: str,
    predecessor_checkpoint: dict[str, Any] | None = None,
    conversation_handle_digest: str | None = None,
) -> dict[str, Any]:
    normalized = normalize_tech_lead_execution_state(execution_state)
    predecessor_id = predecessor_digest = None
    if predecessor_checkpoint is not None:
        validate_checkpoint(predecessor_checkpoint)
        predecessor_id = predecessor_checkpoint["checkpoint_id"]
        predecessor_digest = predecessor_checkpoint["content_digest"]
    return create_checkpoint(
        checkpoint_id=checkpoint_id,
        run_id=normalized["run_id"],
        role_id="tech_lead",
        work_package_id=normalized["big_task_id"],
        task_id=normalized["task_id"],
        source_generation=normalized["generation"],
        state_schema_version=TECH_LEAD_STATE_SCHEMA_VERSION,
        normalized_state=normalized,
        registry_digest=registry_digest,
        policy_digest=policy_digest,
        contract_bundle_digest=contract_bundle_digest,
        last_committed_state_version=normalized["last_committed_state_version"],
        cursors=normalized["cursors"],
        locked_decisions=normalized["decisions"],
        open_risks=[r for r in normalized["risks"] if str(r.get("status", "OPEN")).upper() == "OPEN"],
        evidence_refs=normalized["evidence_refs"],
        predecessor_checkpoint_id=predecessor_id,
        predecessor_checkpoint_digest=predecessor_digest,
        conversation_handle_digest=conversation_handle_digest,
    )


def restore_tech_lead_execution_state(
    checkpoint: dict[str, Any],
    *,
    expected_identity: dict[str, Any] | None = None,
    available_cursors: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Rebuild the complete Tech Lead state from an immutable checkpoint.

    Recovery is complete or it fails.  A partially restored Tech Lead would be
    exactly the context-poor relay this slice exists to remove.
    """

    validate_checkpoint(
        checkpoint,
        expected_identity=expected_identity,
        available_cursors=available_cursors,
    )
    if checkpoint.get("role_id") != "tech_lead":
        raise PolicyError("checkpoint does not belong to a Tech Lead")
    if checkpoint.get("state_schema_version") != TECH_LEAD_STATE_SCHEMA_VERSION:
        raise ContractError(
            f"unsupported Tech Lead state schema version: {checkpoint.get('state_schema_version')!r}"
        )
    restored = normalize_tech_lead_execution_state(checkpoint["normalized_state"])
    if restored["state_digest"] != checkpoint["normalized_state"].get("state_digest"):
        raise ContractError("restored Tech Lead state does not match the checkpointed state digest")
    for section in TECH_LEAD_STATE_SECTIONS:
        if section not in restored:
            raise ContractError(f"restored Tech Lead state is incomplete: missing {section}")
    return restored


def tech_lead_replay_plan(execution_state: dict[str, Any]) -> dict[str, Any]:
    """Decide what a recovered Tech Lead must and must not redo."""

    normalized = normalize_tech_lead_execution_state(execution_state)
    completed = list(normalized["completed_task_ids"])
    incomplete = [
        item["task_id"]
        for item in normalized["task_graph"]
        if item["task_id"] not in set(completed)
    ]
    return {
        "run_id": normalized["run_id"],
        "task_id": normalized["task_id"],
        "completed_task_ids": completed,
        "incomplete_task_ids": incomplete,
        "replay_task_ids": [],
        "reconcile_task_ids": incomplete,
        "completed_work_replay_forbidden": True,
        "planned_at": iso_now(),
    }


def project_legacy_task_lead_checkpoint(legacy: dict[str, Any]) -> dict[str, Any]:
    """Read a historical Task Lead checkpoint as a vNext execution-state view.

    The historical record is never rewritten.  This is a read-only projection
    that names exactly which vNext sections the legacy schema could not carry,
    so a recovered Tech Lead knows what it does *not* know.
    """

    if not isinstance(legacy, dict):
        raise ContractError("legacy Task Lead checkpoint must be an object")
    version = str(legacy.get("schema_version") or "")
    if not version.startswith("2."):
        raise ContractError(f"unsupported legacy Task Lead checkpoint schema: {version!r}")
    for field in ("run_id", "big_task_id", "task_lead_id"):
        if not legacy.get(field):
            raise ContractError(f"legacy Task Lead checkpoint missing {field}")

    completed = [p for p in [legacy.get("completed_phase")] if p]
    remaining = [str(p) for p in (legacy.get("remaining_phase_map") or [])]
    task_graph = [{"task_id": str(p), "status": "COMPLETE", "depends_on": []} for p in completed]
    previous = list(completed)
    for phase in remaining:
        task_graph.append({"task_id": phase, "status": "PENDING", "depends_on": [str(p) for p in previous]})
        previous = [phase]

    risks = [
        {"risk_id": f"legacy-risk-{index + 1}", "status": "OPEN", "summary": str(item)}
        for index, item in enumerate(legacy.get("unresolved_risks") or [])
    ]
    evidence = [
        {"id": f"legacy-result-{index + 1}", "kind": "result_packet", "reference": str(item)}
        for index, item in enumerate(legacy.get("accepted_result_packets") or [])
    ]
    projection = {
        "run_id": legacy["run_id"],
        "big_task_id": legacy["big_task_id"],
        "task_id": legacy.get("completed_phase") or legacy["big_task_id"],
        "task_lead_id": legacy["task_lead_id"],
        "generation": int(legacy.get("generation", 1)),
        "task_graph": task_graph,
        "ownership": {"workers": [], "files": [], "worktrees": []},
        "evidence_refs": evidence,
        "decisions": [],
        "risks": risks,
        "dependencies": [],
        "delegation_revision": "legacy-projection",
        "charter_revision": "legacy-projection",
        "cursors": {"state_version": 0},
        "last_committed_state_version": 0,
    }
    normalized = normalize_tech_lead_execution_state(projection)
    return {
        "projection_schema_version": "1.0",
        "source_schema_version": version,
        "source_digest": sha256_json(legacy),
        "source_record_rewritten": False,
        "execution_state": normalized,
        # Honest gaps: the legacy schema simply does not carry these facts.
        "unavailable_sections": ["ownership", "decisions", "dependencies", "cursors"],
        "projected_at": iso_now(),
    }
