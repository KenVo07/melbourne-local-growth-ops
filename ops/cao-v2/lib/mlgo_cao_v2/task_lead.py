"""Start and contact an episodic Frontier Task Lead with truthful health semantics."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .capacity import create_snapshot
from .common import ContractError, PolicyError, atomic_write_json, iso_now, validate_id
from .contracts import load_and_validate
from .http_client import request_json
from .policy import load_policy
from .registry import profile as registry_profile
from .provenance import create_delivery
from .state_machine import RunStore


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
