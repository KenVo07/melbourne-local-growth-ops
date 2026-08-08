"""Complete hard context envelope accounting at the serialized transport boundary.

Every component of the final request that the CAO or its adapter controls is
measured exactly:

* system/control/profile text
* objective/task text
* durable state summary
* selected history
* tool schemas
* tool results
* attachment/evidence excerpts
* transport/adapter wrapper content controlled by CAO

The measured quantity is the *complete serialized request* as it crosses the
transport boundary, not a sum of component estimates - the serialization
overhead of the wrapper is part of the number.

Provider-native token counts are recorded only where a provider actually
reported them.  Provider-internal prompt material and transforms are reported as
``UNAVAILABLE``.  A common token estimate is never fabricated.

If deterministic selection and truncation cannot bring the complete serialized
request within the hard cap, the request is BLOCKED before submission and the
exact reason is written durably.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    canonical_json_bytes,
    iso_now,
    sha256_bytes,
    sha256_json,
    validate_id,
)

CONTEXT_MANIFEST_SCHEMA_VERSION = "1.0"

UNAVAILABLE = "UNAVAILABLE"

STATUS_WITHIN_CAP = "WITHIN_CAP"
STATUS_BLOCKED_OVER_CAP = "BLOCKED_OVER_CAP"

#: Ordered low-to-high retention priority.  Deterministic truncation always
#: sheds the lowest-priority selectable material first, and always in this
#: fixed order, so two hosts produce byte-identical manifests.
COMPONENT_KINDS = (
    "system_control_text",
    "profile_text",
    "objective_task",
    "durable_state_summary",
    "selected_history",
    "tool_schemas",
    "tool_results",
    "attachment_excerpts",
    "adapter_wrapper",
)

#: Components that may never be dropped or truncated: without them the request
#: is not the request the host intended to send.
NON_REDUCIBLE_KINDS = ("system_control_text", "profile_text", "objective_task", "adapter_wrapper")

DEFAULT_POLICY = {
    "hard_cap_bytes": 262144,
    "hard_cap_items": None,
    "minimum_component_bytes": 256,
    "semantic_compression": {"enabled": False, "max_depth": 1, "command_type": "context.semantic_compression"},
}


def envelope_policy(policy: dict[str, Any] | None) -> dict[str, Any]:
    cfg = {k: (dict(v) if isinstance(v, dict) else v) for k, v in DEFAULT_POLICY.items()}
    supplied = (policy or {}).get("context_envelope")
    if isinstance(supplied, dict):
        for key, value in supplied.items():
            if key not in DEFAULT_POLICY:
                continue
            if key == "semantic_compression" and isinstance(value, dict):
                cfg["semantic_compression"].update(value)
            else:
                cfg[key] = value
    if int(cfg["hard_cap_bytes"]) <= 0:
        raise PolicyError("context envelope hard cap must be positive")
    return cfg


def component(
    *,
    kind: str,
    component_id: str,
    text: str | None = None,
    items: list[Any] | None = None,
    reducible: bool | None = None,
    retention_rank: int = 0,
) -> dict[str, Any]:
    """Build one CAO-controlled request component.

    ``retention_rank`` orders reduction *within* a kind; lower ranks are shed
    first.  Reducibility defaults to the kind's policy.
    """

    if kind not in COMPONENT_KINDS:
        raise ContractError(f"unknown context component kind: {kind!r}")
    validate_id(component_id, "component_id")
    if (text is None) == (items is None):
        raise ContractError("a context component carries either text or items, not both")
    if items is not None:
        payload: Any = items
        item_count = len(items)
        raw = canonical_json_bytes(items)
    else:
        payload = text
        item_count = 1
        raw = text.encode("utf-8")
    if reducible is None:
        reducible = kind not in NON_REDUCIBLE_KINDS
    return {
        "kind": kind,
        "component_id": component_id,
        "payload": payload,
        "is_items": items is not None,
        "bytes": len(raw),
        "items": item_count,
        "sha256": sha256_bytes(raw),
        "reducible": bool(reducible),
        "retention_rank": int(retention_rank),
    }


def _serialize(components: list[dict[str, Any]], wrapper: dict[str, Any] | None) -> bytes:
    """Serialize the complete CAO-controlled request exactly once, canonically."""

    body = {
        "components": [
            {"kind": c["kind"], "component_id": c["component_id"], "payload": c["payload"]}
            for c in components
        ],
        "wrapper": wrapper or {},
    }
    return canonical_json_bytes(body)


def _reduce_once(components: list[dict[str, Any]], *, minimum_bytes: int) -> tuple[list[dict[str, Any]], dict[str, Any]] | None:
    """Shed exactly one deterministic increment of reducible material."""

    order = {kind: index for index, kind in enumerate(COMPONENT_KINDS)}
    candidates = [c for c in components if c["reducible"] and c["bytes"] > 0]
    if not candidates:
        return None
    # Deterministic: largest byte cost first, then lowest retention rank, then
    # kind order, then component_id.  No randomness, no wall clock.
    candidates.sort(key=lambda c: (-c["bytes"], c["retention_rank"], order[c["kind"]], c["component_id"]))
    target = candidates[0]
    out: list[dict[str, Any]] = []
    action: dict[str, Any] = {}
    for c in components:
        if c is not target:
            out.append(c)
            continue
        if c["is_items"] and len(c["payload"]) > 1:
            kept = c["payload"][1:]  # oldest/lowest-priority item is dropped first
            out.append(
                component(
                    kind=c["kind"],
                    component_id=c["component_id"],
                    items=kept,
                    reducible=True,
                    retention_rank=c["retention_rank"],
                )
            )
            action = {
                "component_id": c["component_id"],
                "kind": c["kind"],
                "action": "DROP_OLDEST_ITEM",
                "items_before": c["items"],
                "items_after": len(kept),
            }
        elif c["is_items"]:
            action = {
                "component_id": c["component_id"],
                "kind": c["kind"],
                "action": "DROP_COMPONENT",
                "items_before": c["items"],
                "items_after": 0,
            }
        else:
            text = c["payload"]
            keep = max(minimum_bytes, len(text.encode("utf-8")) // 2)
            truncated = text.encode("utf-8")[:keep].decode("utf-8", errors="ignore")
            if len(truncated) >= len(text):
                action = {
                    "component_id": c["component_id"],
                    "kind": c["kind"],
                    "action": "DROP_COMPONENT",
                    "bytes_before": c["bytes"],
                    "bytes_after": 0,
                }
            else:
                out.append(
                    component(
                        kind=c["kind"],
                        component_id=c["component_id"],
                        text=truncated,
                        reducible=True,
                        retention_rank=c["retention_rank"],
                    )
                )
                action = {
                    "component_id": c["component_id"],
                    "kind": c["kind"],
                    "action": "TRUNCATE_TEXT",
                    "bytes_before": c["bytes"],
                    "bytes_after": len(truncated.encode("utf-8")),
                }
    if not action:
        return None
    return out, action


def build_context_manifest(
    *,
    manifest_id: str,
    run_id: str,
    task_id: str,
    role_id: str,
    components: list[dict[str, Any]],
    wrapper: dict[str, Any] | None = None,
    policy: dict[str, Any] | None = None,
    observed_provider_token_counts: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Measure and, if needed, deterministically reduce the complete request."""

    cfg = envelope_policy(policy)
    validate_id(manifest_id, "manifest_id")
    cap_bytes = int(cfg["hard_cap_bytes"])
    cap_items = cfg["hard_cap_items"]
    minimum_bytes = int(cfg["minimum_component_bytes"])

    seen: set[str] = set()
    for c in components:
        if c.get("kind") not in COMPONENT_KINDS:
            raise ContractError("every measured component must declare a known CAO-controlled kind")
        component_id = str(c.get("component_id"))
        if component_id in seen:
            raise ContractError(
                f"duplicate context component_id {component_id!r}: request material would be double counted"
            )
        seen.add(component_id)

    working = list(components)
    reductions: list[dict[str, Any]] = []
    serialized = _serialize(working, wrapper)
    while len(serialized) > cap_bytes or (cap_items is not None and sum(c["items"] for c in working) > int(cap_items)):
        step = _reduce_once(working, minimum_bytes=minimum_bytes)
        if step is None:
            break
        working, action = step
        action["serialized_bytes_before"] = len(serialized)
        serialized = _serialize(working, wrapper)
        action["serialized_bytes_after"] = len(serialized)
        reductions.append(action)

    total_bytes = len(serialized)
    total_items = sum(c["items"] for c in working)
    over_bytes = total_bytes > cap_bytes
    over_items = cap_items is not None and total_items > int(cap_items)
    status = STATUS_BLOCKED_OVER_CAP if (over_bytes or over_items) else STATUS_WITHIN_CAP

    block_reason = None
    if over_bytes:
        block_reason = (
            "complete CAO-controlled serialized request is "
            f"{total_bytes} bytes after deterministic reduction, exceeding the hard cap of {cap_bytes} bytes"
        )
    elif over_items:
        block_reason = (
            f"complete CAO-controlled serialized request carries {total_items} items after deterministic "
            f"reduction, exceeding the hard cap of {cap_items} items"
        )

    observed = dict(observed_provider_token_counts or {})
    manifest: dict[str, Any] = {
        "schema_version": CONTEXT_MANIFEST_SCHEMA_VERSION,
        "manifest_id": manifest_id,
        "run_id": run_id,
        "task_id": task_id,
        "role_id": role_id,
        "status": status,
        "hard_cap_bytes": cap_bytes,
        "hard_cap_items": cap_items,
        "serialized_request_bytes": total_bytes,
        "serialized_request_sha256": sha256_bytes(serialized),
        "total_items": total_items,
        "components": [
            {
                "kind": c["kind"],
                "component_id": c["component_id"],
                "bytes": c["bytes"],
                "items": c["items"],
                "sha256": c["sha256"],
                "reducible": c["reducible"],
                "retention_rank": c["retention_rank"],
            }
            for c in working
        ],
        "measured_component_kinds": sorted({c["kind"] for c in working}),
        "unmeasured_component_kinds": sorted(set(COMPONENT_KINDS) - {c["kind"] for c in working}),
        "reductions": reductions,
        "deterministic_reduction_only": True,
        "semantic_compression_used": False,
        # Only counts a provider actually reported are recorded.  Anything the
        # host cannot observe stays UNAVAILABLE; no common estimate exists.
        "provider_native_token_counts": observed or UNAVAILABLE,
        "provider_internal_prompt_overhead": UNAVAILABLE,
        "provider_internal_transforms": UNAVAILABLE,
        "token_estimation_method": "none; host measures bytes and items only",
        "block_reason": block_reason,
        "measured_at": iso_now(),
    }
    manifest["manifest_digest"] = sha256_json({k: v for k, v in manifest.items() if k != "manifest_digest"})
    manifest["_selected_components"] = working
    return manifest


def assert_within_cap(manifest: dict[str, Any]) -> dict[str, Any]:
    """Fail before submission when the complete serialized request is over cap."""

    if manifest.get("status") != STATUS_WITHIN_CAP:
        raise PolicyError(
            f"context envelope blocked before provider submission: {manifest.get('block_reason')}"
        )
    return manifest


def record_block(run_v2_dir: str | Path, manifest: dict[str, Any]) -> Path:
    """Write the durable, exact reason a request was blocked before send."""

    if manifest.get("status") != STATUS_BLOCKED_OVER_CAP:
        raise ContractError("only a blocked manifest produces a block record")
    root = Path(run_v2_dir) / "context-envelope"
    record = {
        "schema_version": "1.0",
        "manifest_id": manifest["manifest_id"],
        "manifest_digest": manifest["manifest_digest"],
        "run_id": manifest.get("run_id"),
        "task_id": manifest.get("task_id"),
        "status": "BLOCKED_BEFORE_SUBMISSION",
        "serialized_request_bytes": manifest["serialized_request_bytes"],
        "hard_cap_bytes": manifest["hard_cap_bytes"],
        "block_reason": manifest["block_reason"],
        "reductions_attempted": len(manifest.get("reductions") or []),
        "provider_submission_attempted": False,
        "recorded_at": iso_now(),
    }
    path = root / f"block-{manifest['manifest_id']}.json"
    atomic_write_json(path, record)
    return path


def write_manifest(run_v2_dir: str | Path, manifest: dict[str, Any]) -> Path:
    path = Path(run_v2_dir) / "context-envelope" / f"manifest-{manifest['manifest_id']}.json"
    atomic_write_json(path, {k: v for k, v in manifest.items() if not k.startswith("_")})
    return path


class SemanticCompressionDisabled(PolicyError):
    """Semantic compression is not available; deterministic reduction must suffice."""


def semantic_compression_command(
    *,
    manifest: dict[str, Any],
    policy: dict[str, Any] | None,
    envelope_builder: Callable[[dict[str, Any]], dict[str, Any]],
    command_runner: Callable[[dict[str, Any]], dict[str, Any]],
    evidence_refs: list[dict[str, Any]],
    depth: int = 0,
) -> dict[str, Any]:
    """Run bounded semantic compression as a separate, guarded Command.

    Semantic compression is never an implicit part of envelope accounting.  It
    is a distinct bounded Command with:

    * an explicit policy enable (default OFF - fail closed),
    * existing usage/provenance/evidence *references* only (no new artifact,
      CAS, budget or event system),
    * a hard recursion guard so a compression request can never itself trigger
      compression.

    ``envelope_builder`` receives the compression request description and
    returns a Command envelope; ``command_runner`` dispatches it.  Both are
    injected so this module never opens a transport itself.
    """

    cfg = envelope_policy(policy)["semantic_compression"]
    if not cfg.get("enabled"):
        raise SemanticCompressionDisabled(
            "semantic context compression is disabled by policy; the complete serialized request "
            "must fit within the hard cap by deterministic selection or be blocked before submission"
        )
    max_depth = int(cfg.get("max_depth", 1))
    if int(depth) >= max_depth:
        raise PolicyError(
            f"semantic compression recursion guard: depth {depth} reached the configured maximum {max_depth}"
        )
    if not evidence_refs:
        raise PolicyError("semantic compression requires existing durable evidence references")
    for ref in evidence_refs:
        if not isinstance(ref, dict) or not ref.get("kind") or not ref.get("id"):
            raise ContractError("each semantic compression evidence reference needs a kind and id")

    request = {
        "compression_request_id": f"cmp-{manifest['manifest_id']}",
        "manifest_id": manifest["manifest_id"],
        "manifest_digest": manifest["manifest_digest"],
        "serialized_request_bytes": manifest["serialized_request_bytes"],
        "hard_cap_bytes": manifest["hard_cap_bytes"],
        "evidence_refs": evidence_refs,
        "recursion_depth": int(depth),
        "max_recursion_depth": max_depth,
        "semantic_compression_of_compression_forbidden": True,
    }
    envelope = envelope_builder(request)
    if str(envelope.get("command_type") or "") != str(cfg.get("command_type")):
        raise PolicyError("semantic compression must be dispatched as its own bounded Command type")
    outcome = command_runner(envelope)
    return {
        "status": outcome.get("status"),
        "command_id": envelope.get("command_id"),
        "command_type": envelope.get("command_type"),
        "request": request,
        "outcome": outcome,
        "recursion_depth": int(depth),
        "bounded_command": True,
    }
