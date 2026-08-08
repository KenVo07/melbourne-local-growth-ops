"""Artifact retention, approved deletion and tombstones.

There is deliberately no garbage collector in this module and no scheduled
sweep anywhere in the package.  Storage is only ever reclaimed through an
explicit, recorded operator approval, because an autonomous collector cannot
distinguish "no longer referenced" from "not referenced *yet*" during a run
that is still reconciling, and deleting evidence is not a recoverable mistake.

Deletion removes bytes.  It never removes reference truth: the ArtifactRef
survives in a ``TOMBSTONED`` state carrying the original digest, so anything
that cited the artifact remains auditable and any later attempt to read it
fails closed with an exact explanation rather than a bare missing file.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .artifacts import ArtifactStore
from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    sha256_json,
    validate_id,
)

DELETION_APPROVAL_SCHEMA_VERSION = "1.0"
TOMBSTONE_SCHEMA_VERSION = "1.0"

#: Retention classes that an operator approval alone may not override.
PROTECTED_RETENTION_CLASSES = frozenset({"AUDIT", "LEGAL_HOLD"})


def create_deletion_approval(
    *,
    approval_id: str,
    artifact_id: str,
    security_domain_id: str,
    operator_identity: str,
    reason: str,
    override_protected_retention: bool = False,
) -> dict[str, Any]:
    """Build the explicit operator approval that deletion requires."""

    validate_id(approval_id, "approval_id")
    validate_id(artifact_id, "artifact_id")
    validate_id(security_domain_id, "security_domain_id")
    if not operator_identity.strip() or not reason.strip():
        raise ContractError("deletion approval requires operator_identity and reason")
    record = {
        "schema_version": DELETION_APPROVAL_SCHEMA_VERSION,
        "approval_id": approval_id,
        "action": "APPROVE_ARTIFACT_DELETION",
        "artifact_id": artifact_id,
        "security_domain_id": security_domain_id,
        "operator_identity": operator_identity.strip(),
        "reason": reason.strip(),
        "override_protected_retention": bool(override_protected_retention),
        "approved": True,
        "approved_at": iso_now(),
    }
    record["approval_digest"] = sha256_json({k: v for k, v in record.items() if k != "approval_digest"})
    return record


def validate_deletion_approval(approval: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(approval, dict) or approval.get("schema_version") != DELETION_APPROVAL_SCHEMA_VERSION:
        raise ContractError("unsupported artifact deletion approval schema")
    if approval.get("action") != "APPROVE_ARTIFACT_DELETION" or approval.get("approved") is not True:
        raise PolicyError("artifact deletion requires an explicit approved operator record")
    expected = sha256_json({k: v for k, v in approval.items() if k != "approval_digest"})
    if approval.get("approval_digest") != expected:
        raise ContractError("artifact deletion approval digest mismatch")
    return approval


def apply_approved_deletion(
    store: ArtifactStore,
    *,
    artifact_id: str,
    approval: dict[str, Any],
) -> dict[str, Any]:
    """Delete artifact bytes under an approval and leave a tombstone behind."""

    validate_deletion_approval(approval)
    validate_id(artifact_id, "artifact_id")
    if approval.get("artifact_id") != artifact_id:
        raise PolicyError("deletion approval does not cover this artifact")
    if approval.get("security_domain_id") != store.security_domain_id:
        raise PolicyError("deletion approval belongs to a different security domain")

    with file_lock(store.lock_path):
        ref = store.load_ref(artifact_id)
        if ref is None:
            raise ContractError(f"unknown artifact: {artifact_id}")
        if ref.get("deletion_state") == "TOMBSTONED":
            return {
                "tombstone": load_json(store.tombstones_dir / f"{artifact_id}.json"),
                "reference": ref,
                "duplicate": True,
            }
        retention_class = str(ref.get("retention_class"))
        if retention_class in PROTECTED_RETENTION_CLASSES and not approval.get("override_protected_retention"):
            raise PolicyError(
                f"artifact {artifact_id} has protected retention class {retention_class}; "
                "deletion requires an explicit override in the approval record"
            )

        object_path = store.object_path_for_ref(ref)
        # Other references inside the same dedup scope may still share this
        # object.  Bytes are removed only when this reference is the last
        # citation of them; otherwise a deletion for one artifact would
        # silently destroy an unrelated, still-live artifact.
        sharing = _other_refs_sharing_object(store, ref)
        bytes_removed = False
        if not sharing and object_path.exists():
            object_path.unlink()
            bytes_removed = True

        tombstone = {
            "schema_version": TOMBSTONE_SCHEMA_VERSION,
            "artifact_id": artifact_id,
            "security_domain_id": store.security_domain_id,
            "content_hash": ref.get("content_hash"),
            "byte_size": ref.get("byte_size"),
            "kind": ref.get("kind"),
            "classification": ref.get("classification"),
            "retention_class": retention_class,
            "approval_id": approval.get("approval_id"),
            "approval_digest": approval.get("approval_digest"),
            "operator_identity": approval.get("operator_identity"),
            "reason": approval.get("reason"),
            "bytes_removed": bytes_removed,
            "object_shared_with": sharing,
            "original_ref_digest": ref.get("ref_digest"),
            "original_stored_at": ref.get("stored_at"),
            "deleted_at": iso_now(),
        }
        tombstone["tombstone_digest"] = sha256_json(
            {k: v for k, v in tombstone.items() if k != "tombstone_digest"}
        )
        atomic_write_json(store.tombstones_dir / f"{artifact_id}.json", tombstone)

        # Reference truth survives deletion.  The digest, size and producer
        # linkage stay exactly as they were so historical citations remain
        # meaningful; only the lifecycle fields move.
        updated = dict(ref)
        updated["deletion_state"] = "TOMBSTONED"
        updated["export_eligible"] = False
        updated["context_manifest_eligible"] = False
        updated["tombstone_digest"] = tombstone["tombstone_digest"]
        updated["deleted_at"] = tombstone["deleted_at"]
        updated["ref_digest"] = sha256_json({k: v for k, v in updated.items() if k != "ref_digest"})
        atomic_write_json(store.ref_path(artifact_id), updated)
        return {"tombstone": tombstone, "reference": updated, "duplicate": False}


def _other_refs_sharing_object(store: ArtifactStore, ref: dict[str, Any]) -> list[str]:
    artifact_id = ref.get("artifact_id")
    locator = (ref.get("storage_locator") or {}).get("relative_path")
    shared: list[str] = []
    for other in store.list_refs():
        if other.get("artifact_id") == artifact_id:
            continue
        if other.get("deletion_state") == "TOMBSTONED":
            continue
        if (other.get("storage_locator") or {}).get("relative_path") == locator:
            shared.append(str(other.get("artifact_id")))
    return sorted(shared)


def load_tombstone(store: ArtifactStore, artifact_id: str) -> dict[str, Any] | None:
    path = store.tombstones_dir / f"{validate_id(artifact_id, 'artifact_id')}.json"
    return load_json(path) if path.exists() else None


def retention_report(store: ArtifactStore) -> dict[str, Any]:
    """Report retention posture without deleting anything."""

    refs = store.list_refs()
    by_class: dict[str, int] = {}
    for ref in refs:
        key = str(ref.get("retention_class"))
        by_class[key] = by_class.get(key, 0) + 1
    tombstoned = [r["artifact_id"] for r in refs if r.get("deletion_state") == "TOMBSTONED"]
    return {
        "schema_version": "1.0",
        "security_domain_id": store.security_domain_id,
        "total_references": len(refs),
        "by_retention_class": dict(sorted(by_class.items())),
        "tombstoned": sorted(tombstoned),
        "autonomous_gc_enabled": False,
        "deletion_requires_operator_approval": True,
        "generated_at": iso_now(),
    }
