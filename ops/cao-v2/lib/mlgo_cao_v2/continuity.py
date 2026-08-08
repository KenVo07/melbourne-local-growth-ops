"""Capability-gated supervisor session continuity.

Recovery paths are deliberately distinct and truthfully labelled:

* LIVE_PROCESS_REATTACH keeps the same provider process/conversation.
* NATIVE_PROVIDER_SESSION_RESUME starts a new local process for the same
  provider-native conversation when an adapter proves that capability.
* CHECKPOINT_FALLBACK_NEW_GENERATION starts a new supervisor conversation and
  never claims session continuity.

Provider prompt-cache continuity is never claimed by this module.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, atomic_write_json, file_lock, iso_now, load_json, parse_iso, sha256_json, utc_now, validate_id
from .provenance import require_model_observation
from .state_machine import RunStore

PATH_LIVE = "LIVE_PROCESS_REATTACH"
PATH_NATIVE = "NATIVE_PROVIDER_SESSION_RESUME"
PATH_CHECKPOINT = "CHECKPOINT_FALLBACK_NEW_GENERATION"
PATHS = {PATH_LIVE, PATH_NATIVE, PATH_CHECKPOINT}


def registry_path(store: RunStore) -> Path:
    path = store.v2_dir / "continuity" / "supervisor-session.json"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def register_session(
    *,
    store: RunStore,
    profile: str,
    generation: int,
    terminal_id: str,
    provider: str,
    provider_session_id: str | None,
    provider_session_artifact: str | None,
    process_identity: dict[str, Any],
    launch_identity: dict[str, Any],
) -> dict[str, Any]:
    validate_id(profile, "profile"); validate_id(terminal_id, "terminal_id")
    state = store.load(); selected = state["supervisor_selection"]
    if profile != selected["profile"] or int(generation) != int(selected["generation"]):
        raise PolicyError("session registry does not match immutable supervisor profile/generation")
    record = {
        "schema_version": "1.0", "run_id": store.run_id, "role": "authoritative_supervisor",
        "profile": profile, "generation": generation, "terminal_id": terminal_id,
        "provider": provider, "provider_session_id": provider_session_id,
        "provider_session_artifact": provider_session_artifact,
        "process_identity": process_identity, "launch_identity": launch_identity,
        "profile_digest": launch_identity.get("profile_digest"),
        "launch_command_digest": launch_identity.get("launch_command_digest"),
        "continuity_status": "LIVE_UNVERIFIED", "last_handshake_delivery_id": None,
        "cache_continuity_claim": "NOT_GUARANTEED",
        "created_at": iso_now(), "updated_at": iso_now(),
    }
    path = registry_path(store); lock = path.parent / ".continuity.lock"
    with file_lock(lock):
        if path.exists():
            existing = load_json(path)
            immutable = ("run_id", "profile", "generation", "terminal_id", "provider")
            if any(existing.get(k) != record.get(k) for k in immutable):
                raise PolicyError("attempted to replace a live supervisor session identity in-place")
            record["created_at"] = existing.get("created_at", record["created_at"])
        atomic_write_json(path, record)
    store.bind_supervisor_session({**record, "registry_path": str(path)})
    return {**record, "path": str(path)}


def load_registry(store: RunStore) -> dict[str, Any]:
    path = registry_path(store)
    if not path.exists():
        raise ContractError("supervisor continuity registry is absent")
    record = load_json(path)
    if record.get("run_id") != store.run_id:
        raise ContractError("continuity registry run_id mismatch")
    return record


def provider_capability(policy: dict[str, Any], provider: str, path: str) -> dict[str, Any]:
    continuity = policy.get("continuity") or {}
    capabilities = continuity.get("provider_capabilities") or {}
    provider_cfg = capabilities.get(provider) or {}
    cfg = provider_cfg.get(path) or {}
    return {
        "enabled": bool(cfg.get("enabled", False)),
        "adapter": cfg.get("adapter"),
        "release_required": bool(cfg.get("release_required", False)),
        "reason": cfg.get("reason"),
    }


def plan_recovery(
    *,
    store: RunStore,
    policy: dict[str, Any],
    live_process_evidence: dict[str, Any] | None,
    native_session_evidence: dict[str, Any] | None,
    checkpoint_path: str | None,
    fallback_approval: dict[str, Any] | None,
) -> dict[str, Any]:
    registry = load_registry(store)
    provider = registry["provider"]
    options: list[dict[str, Any]] = []

    live_cfg = provider_capability(policy, provider, PATH_LIVE)
    live_identity_match = False
    if live_process_evidence:
        expected = registry.get("process_identity") or {}
        live_identity_match = all(
            live_process_evidence.get(key) == expected.get(key)
            for key in ("pid", "process_start_time", "executable")
            if expected.get(key) is not None
        ) and live_process_evidence.get("terminal_id") == registry.get("terminal_id")
    options.append({
        "path": PATH_LIVE, "capability_enabled": live_cfg["enabled"],
        "identity_evidence_matches": live_identity_match,
        "requires_model_handshake": True,
        "eligible": bool(live_cfg["enabled"] and live_identity_match),
    })

    native_cfg = provider_capability(policy, provider, PATH_NATIVE)
    native_identity_match = bool(
        native_session_evidence
        and registry.get("provider_session_id")
        and native_session_evidence.get("provider_session_id") == registry.get("provider_session_id")
    )
    options.append({
        "path": PATH_NATIVE, "capability_enabled": native_cfg["enabled"],
        "session_identity_matches": native_identity_match,
        "requires_model_handshake": True,
        "eligible": bool(native_cfg["enabled"] and native_identity_match),
        "release_required": native_cfg["release_required"],
    })

    attempts = int((store.load().get("recovery") or {}).get("checkpoint_fallback_attempts", 0))
    checkpoint_eligible = bool(
        checkpoint_path and fallback_approval and _valid_fallback_approval(store, fallback_approval)
        and attempts < int((policy.get("continuity") or {}).get("checkpoint_fallback_max_attempts", 1))
    )
    options.append({
        "path": PATH_CHECKPOINT, "capability_enabled": True,
        "checkpoint_present": bool(checkpoint_path), "operator_authorized": bool(fallback_approval),
        "attempts_used": attempts, "maximum_attempts": int((policy.get("continuity") or {}).get("checkpoint_fallback_max_attempts", 1)),
        "requires_new_generation": True, "eligible": checkpoint_eligible,
    })

    selected = next((item["path"] for item in options if item["eligible"]), None)
    return {
        "schema_version": "1.0", "run_id": store.run_id,
        "selected_path": selected, "options": options,
        "status": "RECOVERY_PATH_SELECTED" if selected else "SUPERVISOR_SESSION_LOST_PAUSED",
        "cache_continuity_claim": "NOT_GUARANTEED", "planned_at": iso_now(),
    }


def _valid_fallback_approval(store: RunStore, approval: dict[str, Any]) -> bool:
    if approval.get("schema_version") != "1.0" or approval.get("action") != PATH_CHECKPOINT:
        return False
    if approval.get("run_id") != store.run_id or approval.get("approved") is not True:
        return False
    issued = parse_iso(str(approval.get("issued_at")))
    expires = parse_iso(str(approval.get("expires_at")))
    now = utc_now()
    return issued <= now < expires and expires > issued and (expires - issued).total_seconds() <= 3600


def complete_same_session_recovery(
    *,
    store: RunStore,
    policy: dict[str, Any],
    path: str,
    delivery_id: str,
    recovery_facts: dict[str, Any],
) -> dict[str, Any]:
    if path not in {PATH_LIVE, PATH_NATIVE}:
        raise ContractError("same-session completion applies only to reattach or native resume")
    registry = load_registry(store)
    capability = provider_capability(policy, registry["provider"], path)
    if not capability["enabled"]:
        raise PolicyError(f"continuity capability is not enabled for {registry['provider']}: {path}")
    observation = require_model_observation(store, delivery_id, require_response=False, material_authority=True)
    expected_observation = {
        "recipient_role": "authoritative_supervisor",
        "profile": registry["profile"],
        "generation": registry["generation"],
        "terminal_id": registry["terminal_id"],
        "provider": registry["provider"],
    }
    for key, expected in expected_observation.items():
        if observation.get(key) != expected:
            raise PolicyError(f"recovery handshake provenance mismatch: {key}")
    expected_session = registry.get("provider_session_id")
    if expected_session and observation.get("provider_session_id") != expected_session:
        raise PolicyError("recovery handshake provider session does not match registry")
    if recovery_facts.get("terminal_id") != registry.get("terminal_id"):
        raise PolicyError("recovery facts terminal does not match continuity registry")
    if recovery_facts.get("provider") != registry.get("provider"):
        raise PolicyError("recovery facts provider does not match continuity registry")
    if path == PATH_LIVE:
        expected_process = registry.get("process_identity") or {}
        observed_process = recovery_facts.get("process_identity") or {}
        for key in ("pid", "process_start_time", "executable"):
            if expected_process.get(key) is not None and observed_process.get(key) != expected_process.get(key):
                raise PolicyError(f"live-process reattach identity mismatch: {key}")
    if path == PATH_NATIVE:
        if not expected_session or recovery_facts.get("provider_session_id") != expected_session:
            raise PolicyError("native resume did not prove the same provider session identity")
    record = {
        "schema_version": "1.0", "run_id": store.run_id, "path": path,
        "status": f"{path}_VERIFIED", "delivery_id": delivery_id,
        "recovery_facts": recovery_facts,
        "provider_session_id": registry.get("provider_session_id"),
        "cache_continuity_claim": "NOT_GUARANTEED", "completed_at": iso_now(),
    }
    out = store.v2_dir / "continuity" / f"recovery-{iso_now().replace(':','').replace('-','')}.json"
    atomic_write_json(out, record)
    registry["continuity_status"] = record["status"]
    registry["last_handshake_delivery_id"] = delivery_id
    registry["updated_at"] = iso_now()
    atomic_write_json(registry_path(store), registry)
    return {**record, "path_record": str(out)}


def begin_checkpoint_fallback(
    *,
    store: RunStore,
    policy: dict[str, Any],
    checkpoint_path: str,
    approval: dict[str, Any],
    reason: str,
) -> dict[str, Any]:
    if not _valid_fallback_approval(store, approval):
        raise PolicyError("checkpoint fallback requires a valid time-bounded operator approval")
    path = Path(checkpoint_path).resolve()
    if not path.is_file():
        raise ContractError(f"checkpoint does not exist: {path}")
    state = store.load(); attempts = int((state.get("recovery") or {}).get("checkpoint_fallback_attempts", 0))
    maximum = int((policy.get("continuity") or {}).get("checkpoint_fallback_max_attempts", 1))
    if attempts >= maximum:
        raise PolicyError("checkpoint fallback attempt ceiling reached")
    updated = store.begin_new_supervisor_generation(reason=reason, checkpoint_path=str(path))
    # Increment the bounded attempt counter in a separate legal state commit.
    with file_lock(store.lock_path):
        current = store._load_unlocked()  # internal host operation under the same package boundary
        current["recovery"]["checkpoint_fallback_attempts"] = attempts + 1
        current["recovery"]["approval_digest"] = sha256_json(approval)
        current = store._commit_unlocked(current, {"type": "CHECKPOINT_FALLBACK_ATTEMPT", "attempt": attempts + 1, "checkpoint_path": str(path)})
    return {
        "schema_version": "1.0", "run_id": store.run_id,
        "path": PATH_CHECKPOINT, "status": "NEW_GENERATION_AUTHORIZED",
        "generation": current["supervisor_selection"]["generation"],
        "attempt": attempts + 1, "maximum_attempts": maximum,
        "checkpoint_path": str(path), "cache_continuity_claim": "NOT_GUARANTEED",
        "authorized_at": iso_now(),
    }


# --------------------------------------------------------------------------
# Slice 2: logical replay is the correctness path
# --------------------------------------------------------------------------

#: Command states whose provider work is finished.  Recovery never repeats these.
COMPLETED_COMMAND_STATES = {"COMPLETED", "CANCELLED", "FAILED"}
#: Command states that confirm nothing crossed the transport boundary.
NOT_SENT_COMMAND_STATES = {"NOT_SENT_CONFIRMED"}


def durable_cursors(*, store: RunStore, command_ledger: Any = None, operation_ledger: Any = None) -> dict[str, Any]:
    """Report the cursors that are actually available for replay right now."""

    state = store.load()
    def _cursor(root: Path | None) -> dict[str, Any]:
        if root is None or not root.exists():
            return {"count": 0, "last_id": None, "available": False}
        ids = sorted(path.stem for path in root.glob("*.json"))
        return {"count": len(ids), "last_id": ids[-1] if ids else None, "available": True}

    return {
        "state_version": int(state.get("state_version", 0)),
        "command_cursor": _cursor(getattr(command_ledger, "root", None)),
        "operation_cursor": _cursor(getattr(operation_ledger, "root", None)),
        "event_cursor": {"count": 0, "last_id": None, "available": False},
    }


def logical_replay_plan(*, store: RunStore, command_ledger: Any, operation_ledger: Any = None) -> dict[str, Any]:
    """Classify every durable Command/Operation fact for a recovering controller.

    The plan is derived only from durable authoritative facts.  Completed
    provider work is never scheduled for repetition; incomplete work is
    scheduled for reconciliation, which observes external truth rather than
    resubmitting.
    """

    state = store.load()
    commands: list[dict[str, Any]] = []
    root = getattr(command_ledger, "root", None)
    if root is not None and Path(root).exists():
        for path in sorted(Path(root).glob("*.json")):
            commands.append(load_json(path))

    completed: list[str] = []
    reconcile: list[str] = []
    resumable: list[str] = []
    blocked: list[str] = []
    for record in commands:
        command_id = str(record.get("command_id"))
        status = str(record.get("status"))
        if status in COMPLETED_COMMAND_STATES:
            completed.append(command_id)
        elif status in NOT_SENT_COMMAND_STATES:
            resumable.append(command_id)
        elif status == "BLOCKED_MANUAL":
            blocked.append(command_id)
        else:
            reconcile.append(command_id)

    operations: list[dict[str, Any]] = []
    op_root = getattr(operation_ledger, "root", None)
    if op_root is not None and Path(op_root).exists():
        for path in sorted(Path(op_root).glob("*.json")):
            operations.append(load_json(path))
    verified_ops = [str(o.get("operation_id")) for o in operations if o.get("status") == "VERIFIED"]
    unresolved_ops = [
        str(o.get("operation_id"))
        for o in operations
        if o.get("status") in {"PREPARED", "APPLYING", "APPLIED", "UNKNOWN_AFTER_APPLY"}
    ]

    return {
        "schema_version": "1.0",
        "run_id": store.run_id,
        "state_version": int(state.get("state_version", 0)),
        "authoritative_source": "durable_state_journal_plus_command_and_operation_facts",
        "completed_command_ids": sorted(completed),
        "reconcile_command_ids": sorted(reconcile),
        "resubmittable_command_ids": sorted(resumable),
        "blocked_command_ids": sorted(blocked),
        "verified_operation_ids": sorted(verified_ops),
        "unresolved_operation_ids": sorted(unresolved_ops),
        "replay_command_ids": [],
        "completed_provider_work_replay_forbidden": True,
        "native_resume_required": False,
        "cursors": durable_cursors(store=store, command_ledger=command_ledger, operation_ledger=operation_ledger),
        "planned_at": iso_now(),
    }


def reconcile_logical_state(
    *,
    store: RunStore,
    coordinator: Any,
    command_ledger: Any,
    adapter: Any,
    capabilities: dict[str, Any] | None = None,
    operation_ledger: Any = None,
    executor_lease: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Drive incomplete Commands to a durable outcome without repeating work.

    Only observation/reconciliation is performed.  This function never submits
    a Command that already crossed the transport boundary, and never re-runs a
    Command whose provider work is durably complete.
    """

    plan = logical_replay_plan(store=store, command_ledger=command_ledger, operation_ledger=operation_ledger)
    outcomes: dict[str, str] = {}
    for command_id in plan["reconcile_command_ids"]:
        if executor_lease is not None:
            record = command_ledger.load(command_id)
            active = (record or {}).get("active_executor_lease") or {}
            if any(active.get(field) != executor_lease.get(field) for field in ("owner_id", "epoch", "token")):
                coordinator.claim_reconciliation(command_id, executor_lease=executor_lease)
        outcome = coordinator.reconcile(command_id, adapter=adapter, capabilities=capabilities or {})
        outcomes[command_id] = str(outcome.get("status"))
    return {
        **plan,
        "reconciled": outcomes,
        "resubmitted_command_ids": [],
        "completed_work_repeated": 0,
        "reconciled_at": iso_now(),
    }


def build_successor_after_loss(
    *,
    predecessor_handle: dict[str, Any],
    handle_id: str,
    policy: dict[str, Any],
    native_session_evidence: dict[str, Any] | None = None,
    native_capability: dict[str, Any] | None = None,
    reason: str = "process or host loss",
) -> dict[str, Any]:
    """Select the truthful successor conversation for a recovering role.

    Native provider resume is taken only when an effective, qualified capability
    *and* an exact provider conversation handshake are both present.  Otherwise
    the successor is a new generation that makes no session-continuity claim at
    all, and the checkpoint fallback path carries correctness.
    """

    from .checkpoints import (  # local import keeps module import order simple
        CLAIM_NATIVE_SESSION_RESUME,
        CLAIM_NEW_GENERATION,
        successor_handle,
    )

    capability = native_capability or {}
    provider = predecessor_handle["provider_id"]
    policy_capability = provider_capability(policy, provider, PATH_NATIVE)
    native_effective = bool(capability.get("enabled")) and bool(policy_capability["enabled"])

    handshake_exact = False
    handshake_reason = "no provider conversation handshake was observed"
    if native_session_evidence:
        expected = {
            field: predecessor_handle.get(field)
            for field in ("provider_id", "provider_profile_id", "account_profile_id", "model", "transport_id",
                          "provider_conversation_id", "provider_session_id")
        }
        mismatches = [
            field
            for field, want in expected.items()
            if want is not None and native_session_evidence.get(field) != want
        ]
        handshake_exact = not mismatches
        handshake_reason = "exact handshake" if handshake_exact else f"handshake mismatch: {sorted(mismatches)}"

    if native_effective and handshake_exact:
        record = successor_handle(
            predecessor_handle,
            handle_id=handle_id,
            reason=reason,
            session_continuity_claim=CLAIM_NATIVE_SESSION_RESUME,
            provider_conversation_id=predecessor_handle.get("provider_conversation_id"),
            provider_session_id=predecessor_handle.get("provider_session_id"),
            terminal_id=native_session_evidence.get("terminal_id"),
            host_observation=dict(native_session_evidence),
            resume_qualification=capability,
        )
        selected_path = PATH_NATIVE
    else:
        record = successor_handle(
            predecessor_handle,
            handle_id=handle_id,
            reason=reason,
            session_continuity_claim=CLAIM_NEW_GENERATION,
        )
        selected_path = PATH_CHECKPOINT

    return {
        "selected_path": selected_path,
        "handle": record,
        "native_resume_capability_effective": native_effective,
        "native_handshake_exact": handshake_exact,
        "native_handshake_reason": handshake_reason,
        "session_continuity_claim": record["session_continuity_claim"],
        "provider_resubmission_required": False,
        "cache_continuity_claim": "NOT_GUARANTEED",
        "selected_at": iso_now(),
    }


def project_legacy_session_record(record: dict[str, Any], *, handle_id: str, policy_digest: str,
                                  registry_digest: str, contract_bundle_digest: str,
                                  runtime_version: str, build_manifest_sha256: str,
                                  account_profile_id: str, transport_id: str, model: str,
                                  reasoning_effort: str = "medium",
                                  work_package_id: str = "legacy", task_id: str = "legacy") -> dict[str, Any]:
    """Read a historical supervisor continuity record as a ConversationHandle view.

    The stored record is left byte-for-byte untouched.  The projection makes no
    continuity claim the legacy record did not already prove, and it never
    claims a resume capability.
    """

    from .checkpoints import CLAIM_LIVE_PROCESS_REATTACH, CLAIM_NEW_GENERATION, create_conversation_handle

    if not isinstance(record, dict) or record.get("schema_version") != "1.0":
        raise ContractError("unsupported legacy supervisor continuity record schema")
    status = str(record.get("continuity_status") or "")
    claim = CLAIM_LIVE_PROCESS_REATTACH if status == "LIVE_PROCESS_REATTACH_VERIFIED" else CLAIM_NEW_GENERATION
    handle = create_conversation_handle(
        handle_id=handle_id,
        run_id=str(record["run_id"]),
        role_id=str(record.get("role") or "authoritative_supervisor"),
        work_package_id=work_package_id,
        task_id=task_id,
        provider_profile_id=str(record["profile"]),
        account_profile_id=account_profile_id,
        provider_id=str(record["provider"]),
        model=model,
        reasoning_effort=reasoning_effort,
        transport_id=transport_id,
        registry_digest=registry_digest,
        policy_digest=policy_digest,
        contract_bundle_digest=contract_bundle_digest,
        runtime_version=runtime_version,
        build_manifest_sha256=build_manifest_sha256,
        generation=1,
        provider_conversation_id=None if claim == CLAIM_NEW_GENERATION else record.get("provider_session_id"),
        provider_session_id=None if claim == CLAIM_NEW_GENERATION else record.get("provider_session_id"),
        terminal_id=None if claim == CLAIM_NEW_GENERATION else record.get("terminal_id"),
        host_observation={"process_identity": record.get("process_identity") or {},
                          "launch_identity": record.get("launch_identity") or {}},
        session_continuity_claim=claim,
    )
    return {
        "projection_schema_version": "1.0",
        "source_schema_version": record["schema_version"],
        "source_digest": sha256_json(record),
        "source_record_rewritten": False,
        "conversation_handle": handle,
        "native_resume_claimed": False,
        "projected_at": iso_now(),
    }
