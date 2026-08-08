"""Canonical provider/profile/account/route/capability registry.

The registry is the tracked source of execution identity.  Legacy policy route
and supervisor-profile maps remain compatibility projections and are verified
against this source before use.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, canonical_json_bytes, load_json, sha256_bytes, sha256_file, sha256_json, validate_id
from .roles import normalize_role

REGISTRY_SCHEMA_VERSION = "1.0"
MATURITY_ORDER = {"DECLARED": 1, "OBSERVED": 2, "QUALIFIED": 3}
DEFAULT_REGISTRY_PATH = Path(os.environ.get("MLGO_CAO_V2_REGISTRY", "~/.local/share/mlgo-cao-v2/registry/provider-registry.json")).expanduser()


def _semantic_registry(value: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in value.items() if not str(k).startswith("_")}


def registry_digest(value: dict[str, Any]) -> str:
    return sha256_bytes(canonical_json_bytes(_semantic_registry(value)))


def resolve_registry_path(*, policy_path: str | Path | None = None, explicit: str | Path | None = None) -> Path:
    if explicit is not None:
        return Path(explicit).expanduser().resolve()
    env = os.environ.get("MLGO_CAO_V2_REGISTRY")
    if env:
        return Path(env).expanduser().resolve()
    if policy_path is not None:
        policy = Path(policy_path).resolve()
        candidates = (
            policy.parent / "provider-registry.json",
            policy.parent.parent / "registry" / "provider-registry.json",
        )
        for candidate in candidates:
            if candidate.is_file():
                return candidate
    return DEFAULT_REGISTRY_PATH.resolve()


def validate_registry(value: dict[str, Any]) -> dict[str, Any]:
    if value.get("schema_version") != REGISTRY_SCHEMA_VERSION:
        raise ContractError(f"unsupported provider registry schema: {value.get('schema_version')!r}")
    for key in ("registry_version", "roles", "providers", "accounts", "transports", "profiles", "routes"):
        if not value.get(key):
            raise ContractError(f"provider registry missing {key}")
    profiles = value["profiles"]
    routes = value["routes"]
    for name, item in profiles.items():
        validate_id(name, "profile_id")
        if item.get("profile_id") != name:
            raise ContractError(f"profile identity mismatch: {name}")
        role = normalize_role(item.get("role_id", ""))
        if role != item.get("role_id"):
            raise ContractError(f"profile {name} role is not canonical: {item.get('role_id')!r}")
        for field, collection in (("provider_id", "providers"), ("account_profile_id", "accounts"), ("transport_id", "transports")):
            ref = item.get(field)
            if ref not in value[collection]:
                raise ContractError(f"profile {name} references unknown {field}: {ref!r}")
        account = value["accounts"][item["account_profile_id"]]
        if account.get("provider_id") != item.get("provider_id"):
            raise ContractError(f"profile {name} account/provider mismatch")
        if not isinstance(item.get("declared_capabilities"), list):
            raise ContractError(f"profile {name} missing declared_capabilities")
    for route_id, item in routes.items():
        validate_id(route_id, "route_id")
        if item.get("route_id") != route_id:
            raise ContractError(f"route identity mismatch: {route_id}")
        profile_id = item.get("execution_profile_id") or item.get("profile")
        if profile_id not in profiles:
            raise ContractError(f"route {route_id} references unknown execution profile {profile_id!r}")
        execution_profile = profiles[profile_id]
        for route_field, profile_field in (("provider_id", "provider_id"), ("account_pool", "account_profile_id"), ("transport_id", "transport_id"), ("model", "model")):
            if item.get(route_field) != execution_profile.get(profile_field):
                raise ContractError(
                    f"route {route_id} {route_field} does not match execution profile {profile_id}"
                )
        reviewer = item.get("reviewer_profile")
        if reviewer is not None and reviewer not in profiles:
            raise ContractError(f"route {route_id} references unknown reviewer profile {reviewer!r}")
        if item.get("transport_id") not in value["transports"]:
            raise ContractError(f"route {route_id} references unknown transport")
    supervisors = value.get("supervisor_profiles") or {}
    for supervisor_id, supervisor in supervisors.items():
        if supervisor_id not in profiles or profiles[supervisor_id].get("role_id") != "supervisor":
            raise ContractError(f"supervisor projection references non-supervisor profile: {supervisor_id}")
        if supervisor.get("account_pool") != profiles[supervisor_id].get("account_profile_id"):
            raise ContractError(f"supervisor projection account drift: {supervisor_id}")
    declarations = value.get("capability_declarations", [])
    seen: set[tuple[str, str]] = set()
    for item in declarations:
        if item.get("schema_version") != "1.0" or item.get("maturity") not in MATURITY_ORDER:
            raise ContractError("invalid capability declaration")
        key = (str(item.get("provider_profile_id")), str(item.get("capability")))
        if key in seen:
            raise ContractError(f"duplicate capability declaration: {key}")
        seen.add(key)
        if key[0] not in profiles or key[1] not in profiles[key[0]]["declared_capabilities"]:
            raise ContractError(f"capability declaration not backed by profile: {key}")
    return value


def load_registry(path: str | Path) -> dict[str, Any]:
    p = Path(path).expanduser().resolve()
    value = validate_registry(load_json(p))
    value["_source_path"] = str(p)
    value["_source_sha256"] = sha256_file(p)
    value["_registry_digest"] = registry_digest(value)
    return value


def profile(registry: dict[str, Any], profile_id: str) -> dict[str, Any]:
    try:
        item = registry["profiles"][profile_id]
    except KeyError as exc:
        raise PolicyError(f"unknown provider profile: {profile_id}") from exc
    return {"profile_id": profile_id, **item}


def route(registry: dict[str, Any], route_id: str) -> dict[str, Any]:
    try:
        item = registry["routes"][route_id]
    except KeyError as exc:
        raise PolicyError(f"unknown route: {route_id}") from exc
    out = {**item}
    out.setdefault("profile", out.get("execution_profile_id"))
    out.setdefault("provider", out.get("provider_id"))
    return out


def compatibility_policy_routes(registry: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for route_id, item in sorted(registry["routes"].items()):
        out = {k: v for k, v in item.items() if k not in {"route_id", "provider_id", "execution_profile_id", "transport_id", "concurrency_group"}}
        out["profile"] = item.get("execution_profile_id") or item.get("profile")
        out["provider"] = item.get("provider_id") or item.get("provider")
        transport = registry["transports"][item["transport_id"]]
        provider_api = transport.get("legacy_provider_api")
        if provider_api not in {"main", "sidecar"}:
            raise ContractError(f"transport {item['transport_id']} lacks valid legacy_provider_api compatibility metadata")
        out["provider_api"] = provider_api
        result[route_id] = out
    return result


def compatibility_supervisor_profiles(registry: dict[str, Any]) -> dict[str, Any]:
    return {k: dict(v) for k, v in sorted(registry.get("supervisor_profiles", {}).items())}


def compatibility_profile_specs(registry: dict[str, Any]) -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "profiles": {
            name: {"frontmatter": item["frontmatter"], "body": item["body"]}
            for name, item in sorted(registry["profiles"].items())
        },
    }


def validate_policy_projection(policy: dict[str, Any], registry: dict[str, Any]) -> None:
    if policy.get("routes") != compatibility_policy_routes(registry):
        raise ContractError("policy routes drift from canonical provider registry projection")
    if policy.get("supervisor_profiles") != compatibility_supervisor_profiles(registry):
        raise ContractError("policy supervisor_profiles drift from canonical provider registry projection")


def capability_identity(registry: dict[str, Any], *, profile_id: str, capability: str) -> dict[str, Any]:
    p = profile(registry, profile_id)
    if capability not in p.get("declared_capabilities", []):
        raise PolicyError(f"profile {profile_id} does not declare capability {capability}")
    transport_id = p["transport_id"]
    transport = registry["transports"][transport_id]
    identity = {
        "registry_digest": registry.get("_registry_digest") or registry_digest(registry),
        "profile_id": profile_id,
        "profile_digest": sha256_json({k: v for k, v in p.items() if k != "profile_id"}),
        "provider_id": p["provider_id"],
        "account_profile_id": p["account_profile_id"],
        "model": p["model"],
        "transport_id": transport_id,
        "transport_adapter_id": transport["adapter_id"],
        "transport_config_digest": sha256_json(transport),
        "capability": capability,
    }
    identity["identity_digest"] = sha256_json(identity)
    return identity


def make_qualification(
    registry: dict[str, Any], *, profile_id: str, capability: str,
    evidence_sha256: str, qualified_at: str, qualification_id: str,
) -> dict[str, Any]:
    identity = capability_identity(registry, profile_id=profile_id, capability=capability)
    return {
        "schema_version": "1.0",
        "qualification_id": qualification_id,
        "provider_profile_id": profile_id,
        "capability": capability,
        "maturity": "QUALIFIED",
        "identity": identity,
        "identity_digest": identity["identity_digest"],
        "evidence_sha256": evidence_sha256,
        "qualified_at": qualified_at,
    }


def effective_capability(
    registry: dict[str, Any], *, profile_id: str, capability: str,
    policy: dict[str, Any], qualification: dict[str, Any] | None = None,
    required_maturity: str = "QUALIFIED",
) -> dict[str, Any]:
    if required_maturity not in MATURITY_ORDER:
        raise ContractError(f"invalid required capability maturity: {required_maturity}")
    p = profile(registry, profile_id)
    declared = capability in p.get("declared_capabilities", [])
    maturity = "DECLARED" if declared else None
    reason = "capability is not declared by the profile"
    qualification_valid = False
    qualification_stale = False
    if qualification is not None:
        if qualification.get("provider_profile_id") != profile_id or qualification.get("capability") != capability:
            raise PolicyError("capability qualification identity mismatch")
        if qualification.get("maturity") not in MATURITY_ORDER:
            raise ContractError("qualification has invalid maturity")
        current = capability_identity(registry, profile_id=profile_id, capability=capability)
        if qualification.get("identity_digest") != current["identity_digest"]:
            qualification_stale = True
            reason = "qualification is stale after registry/profile/transport/config drift"
            maturity = "DECLARED"
        else:
            qualification_valid = True
            maturity = qualification["maturity"]
            reason = "qualification identity matches current registry"
    activation = (policy.get("capability_activation") or {}).get(capability, {})
    enabled = bool(activation.get("enabled", False))
    sufficient = bool(maturity and MATURITY_ORDER[maturity] >= MATURITY_ORDER[required_maturity])
    effective = bool(declared and sufficient and enabled and (required_maturity != "QUALIFIED" or qualification_valid))
    if qualification_stale:
        reason = "qualification is stale after registry/profile/transport/config drift"
    elif not enabled:
        reason = "policy activation is disabled"
    elif not sufficient:
        reason = f"capability maturity {maturity or 'NONE'} is below required {required_maturity}"
    return {
        "profile_id": profile_id,
        "capability": capability,
        "declared": declared,
        "maturity": maturity,
        "required_maturity": required_maturity,
        "qualification_valid": qualification_valid,
        "qualification_id": qualification.get("qualification_id") if qualification_valid and qualification else None,
        "qualification_evidence_sha256": qualification.get("evidence_sha256") if qualification_valid and qualification else None,
        "qualification_identity_digest": qualification.get("identity_digest") if qualification_valid and qualification else None,
        "policy_enabled": enabled,
        "enabled": effective,
        "reason": reason,
    }
