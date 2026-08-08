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
