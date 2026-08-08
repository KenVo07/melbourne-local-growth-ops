"""Delegated semantic routing with deterministic host enforcement."""

from __future__ import annotations

from typing import Any

from .capacity import assert_snapshot_fresh
from .common import PolicyError, iso_now
from .contracts import validate_big_task_charter, validate_routing_proposal
from .policy import route


def _reject(rejected: list[dict[str, str]], route_id: str, reason: str) -> None:
    rejected.append({"route_id": route_id, "reason": reason})


def _eligible(
    route_id: str,
    proposal: dict[str, Any],
    charter: dict[str, Any],
    snapshot: dict[str, Any],
    policy: dict[str, Any],
    *,
    reviewer_provider_family: str | None = None,
    builder_provider_family: str | None = None,
    execution_role: str = "builder",
) -> tuple[bool, str]:
    cfg = route(policy, route_id)
    capacity = snapshot["profiles"].get(route_id)
    if execution_role == "reviewer" and not cfg.get("reviewer_profile"):
        return False, "route has no independent reviewer profile"
    if not isinstance(capacity, dict):
        return False, "capacity snapshot has no route entry"
    if cfg["tier"] < proposal["minimum_tier"]:
        return False, f"tier {cfg['tier']} is below minimum_tier {proposal['minimum_tier']}"
    envelope = charter["delegation_envelope"]
    if route_id not in envelope["allowed_routes"]:
        return False, "route is outside the delegation envelope"
    if cfg["tier"] > envelope["maximum_tier"]:
        return False, "route exceeds maximum delegated tier"
    if cfg.get("gateway") and not envelope.get("gateway_allowed", False):
        return False, "gateway is not authorized by the charter"
    if cfg.get("gateway") and not capacity.get("gateway_authorized", False):
        return False, "gateway authorization evidence is absent"
    availability = capacity.get("availability")
    if availability not in {"available", "degraded"}:
        return False, f"route availability is {availability}"
    if capacity.get("reserve_status") == "protected":
        if not envelope.get("protected_supervisor_pool_use_allowed", False):
            return False, "route would consume a protected supervisor pool"
    required_families = set(proposal.get("required_families") or [])
    if required_families and cfg["family"] not in required_families:
        return False, f"route family {cfg['family']} is not in required_families"
    if route_id in set(proposal.get("unacceptable_routes") or []):
        return False, "route is explicitly unacceptable in the Task Lead proposal"
    review_class = proposal.get("review_class")
    if review_class in {"cross_provider", "critical_frontier"} and reviewer_provider_family:
        if cfg["family"] == reviewer_provider_family:
            return False, "review independence requires a different provider family"
    if review_class in {"cross_provider", "critical_frontier"} and builder_provider_family:
        if cfg["family"] == builder_provider_family:
            return False, "review route would duplicate the builder provider family"
    return True, "eligible"


def decide_route(
    proposal: dict[str, Any],
    charter: dict[str, Any],
    snapshot: dict[str, Any],
    policy: dict[str, Any],
    *,
    reviewer_provider_family: str | None = None,
    builder_provider_family: str | None = None,
    execution_role: str = "builder",
) -> dict[str, Any]:
    validate_big_task_charter(charter, policy)
    validate_routing_proposal(proposal, policy, charter)
    assert_snapshot_fresh(snapshot, policy)
    if snapshot.get("snapshot_id") != proposal.get("capacity_snapshot_id"):
        raise PolicyError(
            "routing proposal was made against a different capacity snapshot; replan or refresh"
        )

    rejected: list[dict[str, str]] = []
    selected: str | None = None
    for route_id in proposal["acceptable_routes"]:
        ok, reason = _eligible(
            route_id,
            proposal,
            charter,
            snapshot,
            policy,
            reviewer_provider_family=reviewer_provider_family,
            builder_provider_family=builder_provider_family,
            execution_role=execution_role,
        )
        if ok:
            selected = route_id
            break
        _reject(rejected, route_id, reason)

    if selected is None:
        return {
            "schema_version": "2.0",
            "decision": "BLOCKED_BY_PROVIDER_CAPACITY_OR_POLICY",
            "run_id": proposal["run_id"],
            "big_task_id": proposal["big_task_id"],
            "phase_id": proposal["phase_id"],
            "proposal_preferred_route": proposal["preferred_route"],
            "selected_route": None,
            "selected_profile": None,
            "selected_model": None,
            "selected_provider": None,
            "selected_account_pool": None,
            "rejected_routes": rejected,
            "capacity_snapshot_id": snapshot["snapshot_id"],
            "policy_sha256": policy["_source_sha256"],
            "decided_at": iso_now(),
        }

    cfg = route(policy, selected)
    selected_profile = cfg.get("reviewer_profile") if execution_role == "reviewer" else cfg["profile"]
    return {
        "schema_version": "2.0",
        "decision": "ROUTE_SELECTED",
        "run_id": proposal["run_id"],
        "big_task_id": proposal["big_task_id"],
        "phase_id": proposal["phase_id"],
        "proposal_preferred_route": proposal["preferred_route"],
        "selected_route": selected,
        "selected_profile": selected_profile,
        "selected_reviewer_profile": cfg.get("reviewer_profile"),
        "selected_execution_role": execution_role,
        "selected_role_id": "reviewer" if execution_role == "reviewer" else "builder",
        "selected_model": cfg["model"],
        "selected_provider": cfg["provider"],
        "selected_provider_api": cfg.get("provider_api", "main"),
        "selected_transport_id": cfg.get("transport_id"),
        "selected_account_pool": cfg["account_pool"],
        "selected_family": cfg["family"],
        "selected_tier": cfg["tier"],
        "selected_billing_mode": cfg["billing_mode"],
        "preferred_route_honored": selected == proposal["preferred_route"],
        "rejected_routes": rejected,
        "capacity_snapshot_id": snapshot["snapshot_id"],
        "policy_sha256": policy["_source_sha256"],
        "decided_at": iso_now(),
    }
