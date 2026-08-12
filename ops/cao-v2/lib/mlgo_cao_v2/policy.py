"""Policy loading plus canonical provider-registry compatibility checks."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, load_json, sha256_file
from .registry import (
    compatibility_policy_routes,
    load_registry,
    resolve_registry_path,
    route as registry_route,
    validate_policy_projection,
)

DEFAULT_POLICY_PATH = Path(
    os.environ.get("MLGO_CAO_V2_POLICY", "~/.config/mlgo-cao/cao-policy.json")
).expanduser()


def load_policy(path: str | Path | None = None, *, registry_path: str | Path | None = None) -> dict[str, Any]:
    p = Path(path) if path is not None else DEFAULT_POLICY_PATH
    policy = load_json(p)
    if policy.get("schema_version") != "2.0":
        raise ContractError(f"unsupported policy schema at {p}: {policy.get('schema_version')!r}")
    routes = policy.get("routes")
    if not isinstance(routes, dict) or not routes:
        raise ContractError(f"policy has no routes: {p}")
    rp = resolve_registry_path(policy_path=p, explicit=registry_path)
    registry = load_registry(rp)
    validate_policy_projection(policy, registry)
    for route_id, item in compatibility_policy_routes(registry).items():
        for field in ("provider", "account_pool", "profile", "model", "family", "tier"):
            if field not in item:
                raise ContractError(f"route {route_id!r} missing {field}")
        if not isinstance(item["tier"], int) or not 1 <= item["tier"] <= 5:
            raise ContractError(f"route {route_id!r} has invalid tier")
    policy["_source_path"] = str(p)
    policy["_source_sha256"] = sha256_file(p)
    policy["_registry_path"] = str(rp)
    policy["_registry_sha256"] = registry["_source_sha256"]
    policy["_registry_digest"] = registry["_registry_digest"]
    policy["_registry"] = registry
    return policy


def route(policy: dict[str, Any], route_id: str) -> dict[str, Any]:
    registry = policy.get("_registry")
    if not isinstance(registry, dict):
        # Compatibility for tests/legacy callers constructing policy objects by hand.
        try:
            value = policy["routes"][route_id]
        except KeyError as exc:
            raise PolicyError(f"unknown route: {route_id}") from exc
        return {"route_id": route_id, **value}
    return registry_route(registry, route_id)


def route_ids(policy: dict[str, Any]) -> set[str]:
    registry = policy.get("_registry")
    return set(registry["routes"] if isinstance(registry, dict) else policy["routes"])


def account_pool_for_supervisor(profile: str, policy: dict[str, Any] | None = None) -> str | None:
    registry = policy.get("_registry") if isinstance(policy, dict) else None
    if not isinstance(registry, dict):
        try:
            registry = load_registry(resolve_registry_path(policy_path=(policy or {}).get("_source_path") if isinstance(policy, dict) else None))
        except Exception:
            return None
    item = registry.get("supervisor_profiles", {}).get(profile)
    return item.get("account_pool") if isinstance(item, dict) else None
