"""Host-produced provider capacity snapshots."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any

from .common import ContractError, atomic_write_json, iso_now, load_json, parse_iso, run, sha256_bytes, utc_now
from .policy import account_pool_for_supervisor


def _load_manual_hints(policy: dict[str, Any]) -> dict[str, Any]:
    path = Path(policy.get("capacity", {}).get("manual_hint_path", ""))
    if not str(path) or not path.exists():
        return {}
    try:
        value = load_json(path)
    except Exception:
        return {}
    hints = value.get("hints") if isinstance(value, dict) else None
    return hints if isinstance(hints, dict) else {}


def _manual_hint(policy: dict[str, Any], pool: str) -> dict[str, Any] | None:
    item = _load_manual_hints(policy).get(pool)
    if not isinstance(item, dict):
        return None
    try:
        expires = parse_iso(str(item.get("expires_at")))
    except Exception:
        return None
    if utc_now() > expires:
        return None
    band = item.get("capacity_band")
    if band not in {"abundant", "healthy", "constrained", "protected", "exhausted", "unknown"}:
        return None
    return item


def set_manual_hint(
    policy: dict[str, Any],
    *,
    account_pool: str,
    capacity_band: str,
    ttl_seconds: int,
    reason: str,
    operator_identity: str,
) -> dict[str, Any]:
    allowed_pools = {cfg["account_pool"] for cfg in policy["routes"].values()}
    if account_pool not in allowed_pools:
        raise ContractError(f"unknown account pool: {account_pool}")
    if capacity_band not in {"abundant", "healthy", "constrained", "protected", "exhausted", "unknown"}:
        raise ContractError(f"invalid capacity band: {capacity_band}")
    maximum = int(policy.get("capacity", {}).get("manual_hint_max_ttl_seconds", 86400))
    if not 60 <= ttl_seconds <= maximum:
        raise ContractError(f"manual capacity hint TTL must be 60..{maximum} seconds")
    if not reason.strip() or not operator_identity.strip():
        raise ContractError("reason and operator_identity are required")
    path = Path(policy["capacity"]["manual_hint_path"])
    current = load_json(path) if path.exists() else {"schema_version": "1.0", "hints": {}}
    observed = utc_now()
    record = {
        "account_pool": account_pool,
        "capacity_band": capacity_band,
        "observed_at": observed.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "expires_at": (observed + dt.timedelta(seconds=ttl_seconds)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "reason": reason,
        "operator_identity": operator_identity,
        "source": "manual_operator_hint",
    }
    current.setdefault("hints", {})[account_pool] = record
    current["updated_at"] = record["observed_at"]
    atomic_write_json(path, current)
    return record

def _capacity_band(remaining: int | None, reserve: int | None) -> tuple[str, str]:
    if remaining is None:
        return "unknown", "unknown"
    if reserve is None:
        if remaining >= 60:
            return "abundant", "not_applicable"
        if remaining >= 25:
            return "healthy", "not_applicable"
        if remaining > 0:
            return "constrained", "not_applicable"
        return "exhausted", "not_applicable"
    if remaining <= reserve:
        return "protected", "protected"
    delta = remaining - reserve
    if delta <= 5:
        return "constrained", "near"
    if delta >= 35:
        return "abundant", "clear"
    return "healthy", "clear"


def _load_run_state(policy: dict[str, Any], run_id: str | None) -> dict[str, Any] | None:
    if not run_id:
        return None
    root = Path(policy["state_root"]) / "runs" / run_id
    v2_path = root / "v2" / "state.json"
    legacy_path = root / "state.json"
    if v2_path.exists():
        return load_json(v2_path)
    return load_json(legacy_path) if legacy_path.exists() else None


def _reserve_stage(policy: dict[str, Any], state: dict[str, Any] | None) -> tuple[str, float, list[str]]:
    stages = policy["reserve"]["stages"]
    if not state:
        return "EARLY", 0.0, ["no run state"]
    planning = state.get("planning_metadata") if isinstance(state.get("planning_metadata"), dict) else {}
    declared = str((planning.get("reserve") or {}).get("stage") or planning.get("stage") or "").upper()
    risk_flags = list(planning.get("reserve_risk_flags") or [])
    if declared in stages:
        return declared, 0.0, risk_flags
    phases = state.get("phases") if isinstance(state.get("phases"), dict) else {}
    if phases:
        total = len(phases)
        complete = sum(1 for item in phases.values() if isinstance(item, dict) and item.get("state") == "COMPLETE")
        progress = complete / total if total else 0.0
        if progress < 0.25:
            stage = "EARLY"
        elif progress < 0.60:
            stage = "MID"
        elif progress < 0.90:
            stage = "LATE"
        else:
            stage = "FINAL"
        if state.get("open_semantic_exceptions"):
            risk_flags.append("open_semantic_exception")
        return stage, progress, risk_flags
    return "EARLY", 0.0, risk_flags or ["progress unavailable"]


def _dynamic_reserve(
    policy: dict[str, Any], state: dict[str, Any] | None, supervisor_profile: str | None
) -> tuple[int | None, dict[str, Any]]:
    pool = account_pool_for_supervisor(supervisor_profile or "", policy)
    account_cfg = (policy.get("_registry") or {}).get("accounts", {}).get(pool or "", {})
    if pool is None or not account_cfg.get("percentage_meter", False):
        return None, {"basis": "supervisor pool does not use a percentage meter"}
    stage, progress, risk_flags = _reserve_stage(policy, state)
    cfg = policy["reserve"]
    base = int(cfg["stages"][stage])
    adjustment = int(cfg["risk_adjustment_pct"]) if risk_flags else 0
    final = min(int(cfg["maximum_pct"]), max(int(cfg["minimum_pct"]), base + adjustment))
    return final, {
        "basis": "mlgo-cao-v2 policy",
        "stage": stage,
        "progress_fraction": progress,
        "base_reserve_pct": base,
        "risk_flags": risk_flags,
        "risk_adjustment_pct": adjustment,
        "final_reserve_pct": final,
        "hysteresis_pct": int(cfg["hysteresis_pct"]),
    }


def _reserve_state_path(policy: dict[str, Any], pool: str) -> Path:
    return Path(policy["state_root"]) / "governance" / "reserve-state" / f"{pool}.json"


def _apply_reserve_hysteresis(
    policy: dict[str, Any], *, pool: str, remaining: int | None, reserve: int | None
) -> tuple[str, bool]:
    if remaining is None or reserve is None:
        return "unknown", False
    path = _reserve_state_path(policy, pool)
    previous = load_json(path) if path.exists() else {}
    was_protected = bool(previous.get("protected"))
    hysteresis = int(policy["reserve"]["hysteresis_pct"])
    protected = remaining <= reserve or (was_protected and remaining < reserve + hysteresis)
    atomic_write_json(path, {
        "schema_version": "1.0",
        "account_pool": pool,
        "remaining_pct": remaining,
        "reserve_pct": reserve,
        "hysteresis_pct": hysteresis,
        "protected": protected,
        "observed_at": iso_now(),
    })
    if protected:
        return "protected", True
    if remaining - reserve <= hysteresis:
        return "near", False
    return "clear", False


def create_snapshot(
    policy: dict[str, Any],
    *,
    run_id: str | None = None,
    supervisor_profile: str | None = None,
    gateway_authorized: bool = False,
    output_path: str | Path | None = None,
) -> dict[str, Any]:
    proc = run(["/home/khoa/.local/bin/mlgo-capacity", "probe"], timeout=60)
    try:
        raw = json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise ContractError(f"mlgo-capacity probe returned invalid JSON: {exc}") from exc
    state = _load_run_state(policy, run_id)
    if supervisor_profile is None and isinstance(state, dict):
        selection = state.get("supervisor_selection")
        if isinstance(selection, dict):
            supervisor_profile = selection.get("profile") or selection.get("profile_name")
        if supervisor_profile is None:
            supervisor_profile = state.get("supervisor_profile")
    reserve, reserve_evidence = _dynamic_reserve(policy, state, supervisor_profile)
    supervisor_pool = account_pool_for_supervisor(supervisor_profile or "", policy)

    accounts = raw.get("accounts", {})
    providers = raw.get("providers", {})
    profiles: dict[str, dict[str, Any]] = {}
    registry_accounts = (policy.get("_registry") or {}).get("accounts", {})
    for route_id, route_cfg in policy["routes"].items():
        pool = route_cfg["account_pool"]
        account_cfg = registry_accounts.get(pool, {})
        source_cfg = account_cfg.get("capacity_source") or {"kind": "unknown"}
        kind = source_cfg.get("kind")
        if kind == "percent_account":
            account = accounts.get(source_cfg.get("probe_account"), {})
            remaining = account.get("remaining") if isinstance(account.get("remaining"), int) else None
            applied_reserve = reserve if pool == supervisor_pool else 0
            reserve_status, hysteresis_protected = _apply_reserve_hysteresis(policy, pool=pool, remaining=remaining, reserve=applied_reserve)
            band, _ = _capacity_band(remaining, applied_reserve)
            if hysteresis_protected: band = "protected"
            availability = "available" if remaining is not None and not hysteresis_protected else ("unavailable" if remaining is not None else "unknown")
            confidence = "high" if remaining is not None else "low"
            source = "capacity probe; dynamic supervisor reserve" if pool == supervisor_pool else "capacity probe"
        elif kind == "provider_health_manual_hint":
            status = str(providers.get(source_cfg.get("probe_provider"), "unknown"))
            availability = {"green": "available", "yellow": "degraded", "red": "unavailable"}.get(status, "unknown")
            remaining = None; applied_reserve = None
            hint = _manual_hint(policy, pool); band = hint["capacity_band"] if hint else "unknown"
            reserve_status = "not_applicable"; confidence = "medium" if hint else "low"
            source = f"provider health plus manual hint: {hint['reason']}" if hint else "provider health only; exact allowance unavailable"
        elif kind == "gateway_authorization":
            availability = "available" if gateway_authorized else "policy_locked"
            remaining = None; applied_reserve = None; band = "unknown"; reserve_status = "not_applicable"; confidence = "medium"
            source = "gateway authorization policy; usage is budget-led"
        else:
            availability = "unknown"; remaining = None; applied_reserve = None; band = "unknown"; reserve_status = "unknown"; confidence = "unknown"
            source = "registry account has no qualified capacity source"
        profiles[route_id] = {
            "availability": availability,
            "capacity_band": band,
            "remaining_pct": remaining,
            "reserve_pct": applied_reserve,
            "reserve_status": reserve_status,
            "billing_mode": route_cfg["billing_mode"],
            "gateway_authorized": bool(gateway_authorized and route_cfg.get("gateway")),
            "telemetry_confidence": confidence,
            "evidence_source": source,
        }

    observed = utc_now()
    max_age = int(policy["routing"]["capacity_snapshot_max_age_seconds"])
    canonical = json.dumps(profiles, sort_keys=True, separators=(",", ":")).encode()
    snapshot_id = f"caps-{observed.strftime('%Y%m%dT%H%M%SZ')}-{sha256_bytes(canonical)[:12]}"
    snapshot = {
        "schema_version": "2.0",
        "snapshot_id": snapshot_id,
        "observed_at": observed.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "expires_at": (observed + dt.timedelta(seconds=max_age)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "run_id": run_id,
        "supervisor_profile": supervisor_profile,
        "supervisor_pool": supervisor_pool,
        "reserve_evidence": reserve_evidence,
        "profiles": profiles,
        "raw_probe": raw,
    }
    if output_path is None:
        root = Path(policy["state_root"]) / "governance" / "capacity-snapshots"
        output_path = root / f"{snapshot_id}.json"
    atomic_write_json(Path(output_path), snapshot)
    return snapshot



def load_snapshot(policy: dict[str, Any], snapshot_id: str) -> dict[str, Any]:
    """Load a persisted host snapshot by exact ID.

    Routing proposals are evaluated only against the snapshot the Task Lead
    actually received.  The host never rewrites a proposal to a newer snapshot
    behind the planner's back.
    """
    if not snapshot_id or "/" in snapshot_id or ".." in snapshot_id:
        raise ContractError(f"invalid capacity snapshot ID: {snapshot_id!r}")
    path = Path(policy["state_root"]) / "governance" / "capacity-snapshots" / f"{snapshot_id}.json"
    snapshot = load_json(path)
    if snapshot.get("snapshot_id") != snapshot_id:
        raise ContractError(f"capacity snapshot identity mismatch: {path}")
    return snapshot

def assert_snapshot_fresh(snapshot: dict[str, Any], policy: dict[str, Any]) -> None:
    expires = parse_iso(str(snapshot.get("expires_at")))
    if utc_now() > expires:
        raise ContractError(
            f"capacity snapshot {snapshot.get('snapshot_id')} expired at {snapshot.get('expires_at')}"
        )
