"""RunContractBinding for vNext durable writer compatibility."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, sha256_file, sha256_json

BINDING_SCHEMA_VERSION = "1.0"


def _version_tuple(value: str) -> tuple[int, ...]:
    match = re.match(r"^(\d+)\.(\d+)\.(\d+)", str(value))
    if not match:
        raise ContractError(f"version is not semver-compatible: {value!r}")
    return tuple(int(x) for x in match.groups())


def schema_bundle(schemas_dir: str | Path) -> dict[str, Any]:
    root = Path(schemas_dir)
    items = []
    for path in sorted(root.glob("*.schema.json")):
        items.append({"name": path.name, "sha256": sha256_file(path)})
    if not items:
        raise ContractError("schema bundle is empty")
    return {"files": items, "digest": sha256_json(items)}


def create_run_contract_binding(
    *, runtime_version: str, build_id: str, build_manifest_sha256: str,
    registry_digest: str, policy_digest: str, schema_bundle_record: dict[str, Any],
    enabled_writers: list[str], minimum_reader_version: str, minimum_writer_version: str,
    compatible_writer_ids: list[str],
) -> dict[str, Any]:
    if not enabled_writers:
        raise ContractError("RunContractBinding enabled_writers must be non-empty")
    files = schema_bundle_record.get("files") if isinstance(schema_bundle_record, dict) else None
    digest = schema_bundle_record.get("digest") if isinstance(schema_bundle_record, dict) else None
    if not isinstance(files, list) or not files or digest != sha256_json(files):
        raise ContractError("RunContractBinding requires an exact schema bundle record")
    record = {
        "schema_version": BINDING_SCHEMA_VERSION,
        "runtime_version": runtime_version,
        "build_id": build_id,
        "build_manifest_sha256": build_manifest_sha256,
        "registry_digest": registry_digest,
        "policy_digest": policy_digest,
        "schema_bundle_digest": digest,
        "schema_bundle": {"files": files, "digest": digest},
        "enabled_writers": sorted(set(enabled_writers)),
        "minimum_reader_version": minimum_reader_version,
        "minimum_writer_version": minimum_writer_version,
        "compatible_writer_ids": sorted(set(compatible_writer_ids)),
    }
    record["binding_digest"] = sha256_json(record)
    return record


def validate_run_contract_binding(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("schema_version") != BINDING_SCHEMA_VERSION:
        raise ContractError("unsupported RunContractBinding schema")
    required = (
        "runtime_version", "build_id", "build_manifest_sha256", "registry_digest", "policy_digest",
        "schema_bundle_digest", "schema_bundle", "enabled_writers", "minimum_reader_version", "minimum_writer_version",
        "compatible_writer_ids", "binding_digest",
    )
    for key in required:
        if key not in value:
            raise ContractError(f"RunContractBinding missing {key}")
    check = {k: v for k, v in value.items() if k != "binding_digest"}
    if value["binding_digest"] != sha256_json(check):
        raise ContractError("RunContractBinding digest mismatch")
    bundle = value.get("schema_bundle")
    if not isinstance(bundle, dict) or bundle.get("digest") != value.get("schema_bundle_digest") or bundle.get("digest") != sha256_json(bundle.get("files") or []):
        raise ContractError("RunContractBinding schema bundle digest mismatch")
    _version_tuple(value["minimum_reader_version"])
    _version_tuple(value["minimum_writer_version"])
    return value


def assert_writer_compatible(binding: dict[str, Any], writer: dict[str, Any]) -> None:
    validate_run_contract_binding(binding)
    writer_id = str(writer.get("writer_id") or "")
    if writer_id not in set(binding["compatible_writer_ids"]):
        raise PolicyError(f"writer {writer_id!r} is not compatible with this run")
    if _version_tuple(str(writer.get("writer_version") or "0.0.0")) < _version_tuple(binding["minimum_writer_version"]):
        raise PolicyError("writer version is below RunContractBinding minimum")
    for field in ("registry_digest", "policy_digest", "schema_bundle_digest", "build_manifest_sha256"):
        if writer.get(field) != binding.get(field):
            raise PolicyError(f"writer {field} does not match RunContractBinding")
    requested = set(writer.get("writer_features") or [])
    if not requested.issubset(set(binding["enabled_writers"])):
        raise PolicyError("writer attempts features not enabled by RunContractBinding")


def assert_reader_compatible(binding: dict[str, Any], *, reader_version: str) -> None:
    validate_run_contract_binding(binding)
    if _version_tuple(reader_version) < _version_tuple(binding["minimum_reader_version"]):
        raise PolicyError("reader version is below RunContractBinding minimum")


# --------------------------------------------------------------------------
# Slice 2 schema / writer compatibility
# --------------------------------------------------------------------------

#: Versioned schemas introduced by Slice 2.
SLICE2_SCHEMA_NAMES = (
    "conversation-handle.schema.json",
    "checkpoint-vnext.schema.json",
    "authority-episode.schema.json",
    "semantic-trigger.schema.json",
    "context-manifest.schema.json",
    "tech-lead-execution-state.schema.json",
    "tech-lead-consult-request.schema.json",
    "tech-lead-decision.schema.json",
)

#: Durable writer features introduced by Slice 2.  A run only gains them when a
#: RunContractBinding explicitly enables them, so existing live runs keep their
#: current writer surface until they are deliberately rebound.
SLICE2_WRITER_FEATURES = (
    "conversation_handles",
    "checkpoints_vnext",
    "authority_episodes",
    "authority_decisions",
    "context_manifests",
    "tech_lead_state",
)


def slice2_compatibility(binding: dict[str, Any]) -> dict[str, Any]:
    """Report exactly which Slice 2 schemas and writers a run is bound to."""

    validate_run_contract_binding(binding)
    present = {item["name"] for item in binding["schema_bundle"]["files"]}
    schemas_present = sorted(name for name in SLICE2_SCHEMA_NAMES if name in present)
    writers_enabled = sorted(set(binding["enabled_writers"]) & set(SLICE2_WRITER_FEATURES))
    return {
        "slice2_schemas_present": schemas_present,
        "slice2_schemas_missing": sorted(set(SLICE2_SCHEMA_NAMES) - set(schemas_present)),
        "slice2_schema_bundle_complete": len(schemas_present) == len(SLICE2_SCHEMA_NAMES),
        "slice2_writers_enabled": writers_enabled,
        "slice2_durable_writers_active": bool(writers_enabled),
        "schema_bundle_digest": binding["schema_bundle_digest"],
    }


#: Versioned schemas introduced by Slice 3.
SLICE3_SCHEMA_NAMES = (
    "event.schema.json",
    "event-outbox-intent.schema.json",
    "event-projection-checkpoint.schema.json",
    "artifact-ref.schema.json",
    "artifact-deletion-tombstone.schema.json",
    "usage-record-v2.schema.json",
    "budget-policy.schema.json",
    "budget-reservation.schema.json",
    "budget-decision.schema.json",
    "validation-plan.schema.json",
    "validation-result.schema.json",
)

#: Durable writer features introduced by Slice 3.  As with Slice 2, a run only
#: gains them when a RunContractBinding explicitly enables them, so existing
#: runs keep their current writer surface until deliberately rebound.  The
#: Event projection is deliberately absent: it is a derived read model, not a
#: durable writer, and rebuilding it is always safe.
SLICE3_WRITER_FEATURES = (
    "event_outbox",
    "artifact_refs",
    "artifact_retention",
    "usage_records_v2",
    "budget_reservations",
    "validation_plans",
)


def slice3_compatibility(binding: dict[str, Any]) -> dict[str, Any]:
    """Report exactly which Slice 3 schemas and writers a run is bound to."""

    validate_run_contract_binding(binding)
    present = {item["name"] for item in binding["schema_bundle"]["files"]}
    schemas_present = sorted(name for name in SLICE3_SCHEMA_NAMES if name in present)
    writers_enabled = sorted(set(binding["enabled_writers"]) & set(SLICE3_WRITER_FEATURES))
    return {
        "slice3_schemas_present": schemas_present,
        "slice3_schemas_missing": sorted(set(SLICE3_SCHEMA_NAMES) - set(schemas_present)),
        "slice3_schema_bundle_complete": len(schemas_present) == len(SLICE3_SCHEMA_NAMES),
        "slice3_writers_enabled": writers_enabled,
        "slice3_durable_writers_active": bool(writers_enabled),
        "schema_bundle_digest": binding["schema_bundle_digest"],
    }


def assert_slice3_writer_allowed(binding: dict[str, Any], feature: str) -> dict[str, Any]:
    """Fail closed when a Slice 3 durable writer is not bound for this run."""

    if feature not in SLICE3_WRITER_FEATURES:
        raise ContractError(f"unknown Slice 3 writer feature: {feature!r}")
    compatibility = slice3_compatibility(binding)
    if feature not in compatibility["slice3_writers_enabled"]:
        raise PolicyError(
            f"Slice 3 durable writer {feature!r} is not enabled by this run's RunContractBinding"
        )
    if not compatibility["slice3_schema_bundle_complete"]:
        raise PolicyError(
            "Slice 3 durable writers require the complete Slice 3 schema bundle: "
            f"missing {compatibility['slice3_schemas_missing']}"
        )
    return compatibility


def assert_slice2_writer_allowed(binding: dict[str, Any], feature: str) -> dict[str, Any]:
    """Fail closed when a Slice 2 durable writer is not bound for this run."""

    if feature not in SLICE2_WRITER_FEATURES:
        raise ContractError(f"unknown Slice 2 writer feature: {feature!r}")
    compatibility = slice2_compatibility(binding)
    if feature not in compatibility["slice2_writers_enabled"]:
        raise PolicyError(
            f"Slice 2 durable writer {feature!r} is not enabled by this run's RunContractBinding"
        )
    if not compatibility["slice2_schema_bundle_complete"]:
        raise PolicyError(
            "Slice 2 durable writers require the complete Slice 2 schema bundle: "
            f"missing {compatibility['slice2_schemas_missing']}"
        )
    return compatibility
