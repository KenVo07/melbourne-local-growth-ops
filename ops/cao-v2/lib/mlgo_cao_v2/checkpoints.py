"""Immutable ConversationHandle and immutable vNext checkpoint primitives.

Slice 2 makes *logical replay* the correctness path.  Native provider resume is
an optional optimization that must prove an exact identity handshake; when it is
unavailable, disabled or unqualified the validated compact checkpoint fallback
must remain fully correct on its own.

Both records here are content-addressed and immutable:

* a ``ConversationHandle`` binds every identity the host controls for one
  provider conversation generation.  Any mismatch fails *before* a provider
  send, never after.
* a ``Checkpoint`` binds a normalized state digest, the durable cursors that
  state was taken at, locked decisions, open risks, evidence references and
  predecessor/successor lineage.  Tamper, cursor gaps, identity mismatch and
  unsupported schema versions all fail closed with an exact reason.

Nothing in this module is provider-specific.  Provider identity is carried as
opaque registry identifiers so that any qualified transport adapter can use the
same seam.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    iso_now,
    load_json,
    sha256_json,
    validate_id,
)

CONVERSATION_HANDLE_SCHEMA_VERSION = "1.0"
SUPPORTED_CONVERSATION_HANDLE_SCHEMA_VERSIONS = {"1.0"}

CHECKPOINT_SCHEMA_VERSION = "1.0"
SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS = {"1.0"}

#: Continuity claims a handle may truthfully make.  ``NONE_NEW_GENERATION`` is
#: the only claim a checkpoint fallback successor is ever allowed to make.
CLAIM_NEW_GENERATION = "NONE_NEW_GENERATION"
CLAIM_LIVE_PROCESS_REATTACH = "LIVE_PROCESS_REATTACH"
CLAIM_NATIVE_SESSION_RESUME = "NATIVE_PROVIDER_SESSION_RESUME"
CONTINUITY_CLAIMS = {CLAIM_NEW_GENERATION, CLAIM_LIVE_PROCESS_REATTACH, CLAIM_NATIVE_SESSION_RESUME}

#: Every field here is compared exactly before a provider submission.
HANDLE_IDENTITY_FIELDS = (
    "run_id",
    "role_id",
    "work_package_id",
    "task_id",
    "provider_profile_id",
    "account_profile_id",
    "provider_id",
    "model",
    "reasoning_effort",
    "transport_id",
    "generation",
)

#: Host build/config identities that must also match before a send.
HANDLE_BINDING_FIELDS = (
    "registry_digest",
    "policy_digest",
    "contract_bundle_digest",
    "runtime_version",
    "build_manifest_sha256",
)

#: Provider-native conversation identity, only compared when the handle carries
#: it and the caller supplies an observation for it.
HANDLE_SESSION_FIELDS = (
    "provider_conversation_id",
    "provider_session_id",
    "terminal_id",
)

CURSOR_KINDS = ("state_version", "command_cursor", "operation_cursor", "event_cursor")


def _require_str(value: object, label: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{label} must be a non-empty string")
    return value


def _digest_of(record: dict[str, Any], digest_field: str) -> str:
    return sha256_json({k: v for k, v in record.items() if k != digest_field})


# --------------------------------------------------------------------------
# ConversationHandle
# --------------------------------------------------------------------------


def create_conversation_handle(
    *,
    handle_id: str,
    run_id: str,
    role_id: str,
    work_package_id: str,
    task_id: str,
    provider_profile_id: str,
    account_profile_id: str,
    provider_id: str,
    model: str,
    reasoning_effort: str,
    transport_id: str,
    registry_digest: str,
    policy_digest: str,
    contract_bundle_digest: str,
    runtime_version: str,
    build_manifest_sha256: str,
    generation: int,
    predecessor_handle_id: str | None = None,
    predecessor_handle_digest: str | None = None,
    provider_conversation_id: str | None = None,
    provider_session_id: str | None = None,
    terminal_id: str | None = None,
    host_observation: dict[str, Any] | None = None,
    resume_qualification: dict[str, Any] | None = None,
    session_continuity_claim: str = CLAIM_NEW_GENERATION,
) -> dict[str, Any]:
    """Build one immutable conversation handle.

    The record is content addressed.  Callers never mutate a handle in place;
    a new generation always produces a new handle that names its predecessor.
    """

    validate_id(handle_id, "handle_id")
    validate_id(run_id, "run_id")
    validate_id(task_id, "task_id")
    validate_id(work_package_id, "work_package_id")
    if session_continuity_claim not in CONTINUITY_CLAIMS:
        raise ContractError(f"unknown session continuity claim: {session_continuity_claim!r}")
    if int(generation) < 1:
        raise ContractError("conversation handle generation must be >= 1")
    if generation > 1 and predecessor_handle_id is None:
        raise ContractError("a successor conversation handle must name its predecessor")
    if session_continuity_claim == CLAIM_NATIVE_SESSION_RESUME:
        if not isinstance(resume_qualification, dict) or not resume_qualification.get("qualification_id"):
            raise PolicyError(
                "native session resume claim requires the qualification evidence used to enable it"
            )
        if not (provider_conversation_id or provider_session_id):
            raise PolicyError("native session resume claim requires provider conversation identity")

    record: dict[str, Any] = {
        "schema_version": CONVERSATION_HANDLE_SCHEMA_VERSION,
        "handle_id": handle_id,
        "run_id": run_id,
        "role_id": _require_str(role_id, "role_id"),
        "work_package_id": work_package_id,
        "task_id": task_id,
        "provider_profile_id": _require_str(provider_profile_id, "provider_profile_id"),
        "account_profile_id": _require_str(account_profile_id, "account_profile_id"),
        "provider_id": _require_str(provider_id, "provider_id"),
        "model": _require_str(model, "model"),
        "reasoning_effort": _require_str(reasoning_effort, "reasoning_effort"),
        "transport_id": _require_str(transport_id, "transport_id"),
        "registry_digest": _require_str(registry_digest, "registry_digest"),
        "policy_digest": _require_str(policy_digest, "policy_digest"),
        "contract_bundle_digest": _require_str(contract_bundle_digest, "contract_bundle_digest"),
        "runtime_version": _require_str(runtime_version, "runtime_version"),
        "build_manifest_sha256": _require_str(build_manifest_sha256, "build_manifest_sha256"),
        "generation": int(generation),
        "predecessor_handle_id": predecessor_handle_id,
        "predecessor_handle_digest": predecessor_handle_digest,
        "provider_conversation_id": provider_conversation_id,
        "provider_session_id": provider_session_id,
        "terminal_id": terminal_id,
        "host_observation": host_observation or {},
        "resume_qualification": resume_qualification,
        "session_continuity_claim": session_continuity_claim,
        "cache_continuity_claim": "NOT_GUARANTEED",
        "created_at": iso_now(),
    }
    record["identity_digest"] = sha256_json(
        {field: record[field] for field in HANDLE_IDENTITY_FIELDS + HANDLE_BINDING_FIELDS}
    )
    record["handle_digest"] = _digest_of(record, "handle_digest")
    return record


def validate_conversation_handle(handle: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(handle, dict):
        raise ContractError("conversation handle must be an object")
    version = handle.get("schema_version")
    if version not in SUPPORTED_CONVERSATION_HANDLE_SCHEMA_VERSIONS:
        raise ContractError(f"unsupported conversation handle schema version: {version!r}")
    for field in ("handle_id", "handle_digest", "identity_digest") + HANDLE_IDENTITY_FIELDS + HANDLE_BINDING_FIELDS:
        if field not in handle:
            raise ContractError(f"conversation handle missing {field}")
    if handle["handle_digest"] != _digest_of(handle, "handle_digest"):
        raise ContractError("conversation handle digest mismatch")
    expected_identity = sha256_json(
        {field: handle[field] for field in HANDLE_IDENTITY_FIELDS + HANDLE_BINDING_FIELDS}
    )
    if handle["identity_digest"] != expected_identity:
        raise ContractError("conversation handle identity digest mismatch")
    if handle.get("session_continuity_claim") not in CONTINUITY_CLAIMS:
        raise ContractError("conversation handle carries an unknown continuity claim")
    return handle


def successor_handle(
    predecessor: dict[str, Any],
    *,
    handle_id: str,
    reason: str,
    session_continuity_claim: str = CLAIM_NEW_GENERATION,
    provider_conversation_id: str | None = None,
    provider_session_id: str | None = None,
    terminal_id: str | None = None,
    host_observation: dict[str, Any] | None = None,
    resume_qualification: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Derive exactly one truthful successor generation from a predecessor.

    A successor never inherits the predecessor's provider conversation identity
    unless it is explicitly proving a same-session claim.  Profile, account,
    provider, model and transport are carried forward unchanged: recovery must
    never silently move a run onto a different profile or account.
    """

    validate_conversation_handle(predecessor)
    if session_continuity_claim == CLAIM_NEW_GENERATION and (provider_conversation_id or provider_session_id):
        raise PolicyError(
            "a new-generation successor must not claim the predecessor provider conversation"
        )
    record = create_conversation_handle(
        handle_id=handle_id,
        run_id=predecessor["run_id"],
        role_id=predecessor["role_id"],
        work_package_id=predecessor["work_package_id"],
        task_id=predecessor["task_id"],
        provider_profile_id=predecessor["provider_profile_id"],
        account_profile_id=predecessor["account_profile_id"],
        provider_id=predecessor["provider_id"],
        model=predecessor["model"],
        reasoning_effort=predecessor["reasoning_effort"],
        transport_id=predecessor["transport_id"],
        registry_digest=predecessor["registry_digest"],
        policy_digest=predecessor["policy_digest"],
        contract_bundle_digest=predecessor["contract_bundle_digest"],
        runtime_version=predecessor["runtime_version"],
        build_manifest_sha256=predecessor["build_manifest_sha256"],
        generation=int(predecessor["generation"]) + 1,
        predecessor_handle_id=predecessor["handle_id"],
        predecessor_handle_digest=predecessor["handle_digest"],
        provider_conversation_id=provider_conversation_id,
        provider_session_id=provider_session_id,
        terminal_id=terminal_id,
        host_observation=host_observation,
        resume_qualification=resume_qualification,
        session_continuity_claim=session_continuity_claim,
    )
    record["successor_reason"] = reason
    record["handle_digest"] = _digest_of(record, "handle_digest")
    return record


def assert_handle_authorizes_send(
    handle: dict[str, Any],
    *,
    expected: dict[str, Any],
    observed_session: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fail *before* a provider submission when identity does not match exactly.

    ``expected`` carries the identity the caller believes it is sending for and
    must be complete: a caller cannot weaken the check by omitting an axis.
    ``observed_session`` optionally carries host-observed provider conversation
    identity for a same-session claim.  Everything is compared field by field so
    the durable failure names the exact mismatching field.
    """

    validate_conversation_handle(handle)
    missing = [field for field in HANDLE_IDENTITY_FIELDS if field not in expected]
    if missing:
        raise ContractError(
            f"conversation handle send check requires the complete expected identity; missing {missing}"
        )
    checked: list[str] = []
    for field in HANDLE_IDENTITY_FIELDS + HANDLE_BINDING_FIELDS:
        if field not in expected:
            continue
        checked.append(field)
        want = expected[field]
        got = handle[field]
        if field == "generation":
            want, got = int(want), int(got)
        if want != got:
            raise PolicyError(
                f"conversation handle identity mismatch before provider send: {field} "
                f"(handle={got!r}, expected={want!r})"
            )
    if handle.get("session_continuity_claim") != CLAIM_NEW_GENERATION and observed_session is not None:
        for field in HANDLE_SESSION_FIELDS:
            bound = handle.get(field)
            if bound is None or field not in observed_session:
                continue
            if observed_session[field] != bound:
                raise PolicyError(
                    f"conversation handle session identity mismatch before provider send: {field}"
                )
    return {
        "authorized": True,
        "handle_id": handle["handle_id"],
        "handle_digest": handle["handle_digest"],
        "identity_digest": handle["identity_digest"],
        "session_continuity_claim": handle["session_continuity_claim"],
        "checked_fields": checked,
        "checked_at": iso_now(),
    }


# --------------------------------------------------------------------------
# Checkpoint (vNext)
# --------------------------------------------------------------------------


def normalize_cursors(value: dict[str, Any] | None) -> dict[str, Any]:
    """Normalize durable cursors so checkpoint digests are stable."""

    raw = dict(value or {})
    cursors: dict[str, Any] = {"state_version": int(raw.get("state_version", 0))}
    for kind in ("command_cursor", "operation_cursor", "event_cursor"):
        item = raw.get(kind) or {}
        if not isinstance(item, dict):
            raise ContractError(f"{kind} must be an object")
        cursors[kind] = {
            "count": int(item.get("count", 0)),
            "last_id": item.get("last_id"),
            "available": bool(item.get("available", True)),
        }
    return cursors


def create_checkpoint(
    *,
    checkpoint_id: str,
    run_id: str,
    role_id: str,
    work_package_id: str,
    task_id: str,
    source_generation: int,
    state_schema_version: str,
    normalized_state: dict[str, Any],
    registry_digest: str,
    policy_digest: str,
    contract_bundle_digest: str,
    last_committed_state_version: int,
    cursors: dict[str, Any] | None = None,
    locked_decisions: list[dict[str, Any]] | None = None,
    open_risks: list[dict[str, Any]] | None = None,
    evidence_refs: list[dict[str, Any]] | None = None,
    predecessor_checkpoint_id: str | None = None,
    predecessor_checkpoint_digest: str | None = None,
    conversation_handle_digest: str | None = None,
) -> dict[str, Any]:
    validate_id(checkpoint_id, "checkpoint_id")
    validate_id(run_id, "run_id")
    validate_id(task_id, "task_id")
    validate_id(work_package_id, "work_package_id")
    if not isinstance(normalized_state, dict):
        raise ContractError("checkpoint normalized_state must be an object")
    if (predecessor_checkpoint_id is None) != (predecessor_checkpoint_digest is None):
        raise ContractError("checkpoint lineage is incomplete: predecessor id and digest must be paired")
    record: dict[str, Any] = {
        "schema_version": CHECKPOINT_SCHEMA_VERSION,
        "checkpoint_id": checkpoint_id,
        "run_id": run_id,
        "role_id": _require_str(role_id, "role_id"),
        "work_package_id": work_package_id,
        "task_id": task_id,
        "source_generation": int(source_generation),
        "state_schema_version": _require_str(state_schema_version, "state_schema_version"),
        "normalized_state": normalized_state,
        "normalized_state_digest": sha256_json(normalized_state),
        "registry_digest": _require_str(registry_digest, "registry_digest"),
        "policy_digest": _require_str(policy_digest, "policy_digest"),
        "contract_bundle_digest": _require_str(contract_bundle_digest, "contract_bundle_digest"),
        "last_committed_state_version": int(last_committed_state_version),
        "cursors": normalize_cursors(cursors),
        "locked_decisions": list(locked_decisions or []),
        "open_risks": list(open_risks or []),
        "evidence_refs": list(evidence_refs or []),
        "predecessor_checkpoint_id": predecessor_checkpoint_id,
        "predecessor_checkpoint_digest": predecessor_checkpoint_digest,
        "successor_checkpoint_id": None,
        "conversation_handle_digest": conversation_handle_digest,
        "cache_continuity_claim": "NOT_GUARANTEED",
        "created_at": iso_now(),
    }
    if record["cursors"]["state_version"] == 0:
        record["cursors"]["state_version"] = int(last_committed_state_version)
    record["content_digest"] = _digest_of(record, "content_digest")
    return record


CHECKPOINT_IDENTITY_FIELDS = ("run_id", "role_id", "work_package_id", "task_id")


def validate_checkpoint(
    checkpoint: dict[str, Any],
    *,
    expected_identity: dict[str, Any] | None = None,
    available_cursors: dict[str, Any] | None = None,
    supported_schema_versions: Iterable[str] = SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS,
) -> dict[str, Any]:
    """Fail closed on tamper, cursor gap, identity mismatch or unsupported schema."""

    if not isinstance(checkpoint, dict):
        raise ContractError("checkpoint must be an object")
    version = checkpoint.get("schema_version")
    if version not in set(supported_schema_versions):
        raise ContractError(f"unsupported checkpoint schema version: {version!r}")
    for field in ("checkpoint_id", "content_digest", "normalized_state", "normalized_state_digest", "cursors"):
        if field not in checkpoint:
            raise ContractError(f"checkpoint missing {field}")
    if checkpoint["normalized_state_digest"] != sha256_json(checkpoint["normalized_state"]):
        raise ContractError("checkpoint normalized state digest mismatch: state has been altered")
    if checkpoint["content_digest"] != _digest_of(checkpoint, "content_digest"):
        raise ContractError("checkpoint content digest mismatch: record has been altered")

    predecessor_id = checkpoint.get("predecessor_checkpoint_id")
    predecessor_digest = checkpoint.get("predecessor_checkpoint_digest")
    if (predecessor_id is None) != (predecessor_digest is None):
        raise ContractError("checkpoint lineage is incomplete: predecessor id and digest must be paired")

    if expected_identity:
        for field in CHECKPOINT_IDENTITY_FIELDS:
            if field in expected_identity and expected_identity[field] != checkpoint.get(field):
                raise PolicyError(
                    f"checkpoint identity mismatch: {field} "
                    f"(checkpoint={checkpoint.get(field)!r}, expected={expected_identity[field]!r})"
                )
        for field in ("registry_digest", "policy_digest", "contract_bundle_digest"):
            if field in expected_identity and expected_identity[field] != checkpoint.get(field):
                raise PolicyError(f"checkpoint identity mismatch: {field}")

    cursors = normalize_cursors(checkpoint["cursors"])
    if int(cursors["state_version"]) < int(checkpoint.get("last_committed_state_version", 0)):
        raise ContractError(
            "checkpoint cursor gap: state_version cursor trails the last committed state version"
        )
    if available_cursors is not None:
        available = normalize_cursors(available_cursors)
        if int(available["state_version"]) < int(cursors["state_version"]):
            raise ContractError(
                "checkpoint cursor gap: durable state_version "
                f"{available['state_version']} is behind checkpoint cursor {cursors['state_version']}"
            )
        for kind in ("command_cursor", "operation_cursor", "event_cursor"):
            want = cursors[kind]
            have = available[kind]
            if want["count"] and not have["available"]:
                raise ContractError(
                    f"checkpoint cursor gap: {kind} is no longer available for replay"
                )
            if int(have["count"]) < int(want["count"]):
                raise ContractError(
                    f"checkpoint cursor gap: {kind} durable count {have['count']} "
                    f"is behind checkpoint cursor {want['count']}"
                )
    return checkpoint


def write_checkpoint(path: str | Path, checkpoint: dict[str, Any]) -> Path:
    validate_checkpoint(checkpoint)
    target = Path(path)
    atomic_write_json(target, checkpoint)
    return target


def load_checkpoint(
    path: str | Path,
    *,
    expected_identity: dict[str, Any] | None = None,
    available_cursors: dict[str, Any] | None = None,
    supported_schema_versions: Iterable[str] = SUPPORTED_CHECKPOINT_SCHEMA_VERSIONS,
) -> dict[str, Any]:
    record = load_json(Path(path))
    return validate_checkpoint(
        record,
        expected_identity=expected_identity,
        available_cursors=available_cursors,
        supported_schema_versions=supported_schema_versions,
    )


def link_successor_checkpoint(predecessor: dict[str, Any], successor_id: str) -> dict[str, Any]:
    """Return a *new* predecessor projection naming its successor.

    Historical evidence is never rewritten in place; this returns a derived
    lineage view for readers rather than mutating a stored record.
    """

    validate_checkpoint(predecessor)
    projection = dict(predecessor)
    projection["successor_checkpoint_id"] = successor_id
    projection["projected_from_checkpoint_digest"] = predecessor["content_digest"]
    projection["content_digest"] = _digest_of(projection, "content_digest")
    return projection
