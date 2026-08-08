"""Conservative restart planning and phase-gated execution.

The first safe release may restart only the additive v2 controller without
claiming supervisor continuity.  Main CAO/runtime restart remains blocked while
active resources exist unless an explicit, time-bounded break-glass approval
accepts truthful checkpoint fallback.  Native resume is optional and never
assumed.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import PolicyError, atomic_write_json, iso_now, is_terminal_run_status, load_json, parse_iso, run, utc_now
from .http_client import HTTPError, request_json_value
from .policy import load_policy

CONTROLLER_UNITS = ["mlgo-cao-v2-controller.service"]
CONTROL_PLANE_UNITS = ["mlgo-cao.service", "mlgo-supervisor-watcher.service", "mlgo-cao-v2-controller.service"]
FULL_RUNTIME_UNITS = ["mlgo-cao.service", "mlgo-cao-agy-sidecar.service", "mlgo-supervisor-watcher.service", "mlgo-cao-v2-controller.service"]
TERMINAL_STATUSES = {"completed", "error"}


def _status_is_active(value: object) -> bool: return not is_terminal_run_status(value)


def active_runs(policy: dict[str, Any]) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []; root = Path(policy["state_root"]) / "runs"
    if not root.exists(): return results
    for run_dir in sorted(path for path in root.iterdir() if path.is_dir()):
        legacy_path = run_dir / "state.json"; v2_path = run_dir / "v2" / "state.json"
        legacy = load_json(legacy_path) if legacy_path.exists() else None; v2 = load_json(v2_path) if v2_path.exists() else None
        if legacy is None and v2 is None: continue
        legacy_status = None if legacy is None else legacy.get("run_status") or legacy.get("status"); v2_status = None if v2 is None else v2.get("status")
        if (legacy is not None and _status_is_active(legacy_status)) or (v2 is not None and _status_is_active(v2_status)):
            results.append({"run_id": run_dir.name, "legacy_state_present": legacy is not None, "legacy_status": legacy_status, "v2_state_present": v2 is not None, "v2_status": v2_status, "open_semantic_exceptions": [] if v2 is None else v2.get("open_semantic_exceptions", [])})
    return results


def active_main_terminals(policy: dict[str, Any]) -> dict[str, Any]:
    session = policy.get("main_cao_session", "mlgo-cao"); url = f"{policy['main_cao_api']}/sessions/{session}/terminals"
    try: value = request_json_value(url, timeout=15)
    except HTTPError as exc: return {"status": "UNKNOWN", "session": session, "reason": str(exc), "active": [], "all_records": []}
    if not isinstance(value, list): return {"status": "UNKNOWN", "session": session, "reason": "terminal-list endpoint did not return a JSON array", "active": [], "all_records": []}
    records = [item for item in value if isinstance(item, dict)]; active = []
    for terminal in records:
        status = str(terminal.get("status") or "unknown").lower()
        if status not in TERMINAL_STATUSES:
            active.append({"id": terminal.get("id"), "name": terminal.get("name"), "status": status, "provider": terminal.get("provider"), "agent_profile": terminal.get("agent_profile"), "caller_id": terminal.get("caller_id"), "last_active": terminal.get("last_active"), "health_claim": "terminal record only; model health unproven"})
    return {"status": "KNOWN", "session": session, "reason": None, "active": active, "all_records": records}


def active_bridge_units() -> dict[str, Any]:
    proc = run(["systemctl", "--user", "list-units", "--state=active", "--no-legend", "mlgo-agy-bridge@*.service"], timeout=15, check=False)
    if proc.returncode != 0: return {"status": "UNKNOWN", "reason": proc.stderr.strip() or proc.stdout.strip() or f"systemctl rc={proc.returncode}", "units": []}
    return {"status": "KNOWN", "reason": None, "units": [line.split()[0] for line in proc.stdout.splitlines() if line.split()]}


def active_resources(policy: dict[str, Any]) -> dict[str, Any]:
    terminals = active_main_terminals(policy); bridges = active_bridge_units(); runs = active_runs(policy); unknown = []
    if terminals["status"] != "KNOWN": unknown.append("main_cao_terminals")
    if bridges["status"] != "KNOWN": unknown.append("agy_bridge_units")
    return {"active_runs": runs, "main_cao_terminals": terminals, "agy_bridge_units": bridges, "unknown_checks": unknown, "restart_blocked": bool(runs or terminals["active"] or bridges["units"] or unknown)}


def _validate_break_glass_approval(path: str | Path) -> dict[str, Any]:
    approval_path = Path(path).resolve(); approval = load_json(approval_path)
    required = {"schema_version", "action", "approved", "approved_by", "reason", "issued_at", "expires_at", "acknowledge_active_sessions_will_be_destroyed"}
    missing = sorted(required - approval.keys())
    if missing: raise PolicyError(f"break-glass approval missing fields: {missing}")
    if approval.get("schema_version") != "1.0" or approval.get("action") != "CAO_BREAK_GLASS_RESTART" or approval.get("approved") is not True: raise PolicyError("approval does not authorize CAO_BREAK_GLASS_RESTART")
    if approval.get("acknowledge_active_sessions_will_be_destroyed") is not True: raise PolicyError("approval must acknowledge active sessions will be destroyed")
    if not isinstance(approval.get("approved_by"), str) or not approval["approved_by"].strip(): raise PolicyError("approved_by must be non-empty")
    if not isinstance(approval.get("reason"), str) or len(approval["reason"].strip()) < 10: raise PolicyError("break-glass reason must be at least 10 characters")
    issued = parse_iso(str(approval["issued_at"])); expires = parse_iso(str(approval["expires_at"])); now = utc_now()
    if issued > now or expires <= now or expires <= issued or (expires - issued).total_seconds() > 3600: raise PolicyError("break-glass approval timing is invalid")
    approval["approval_file"] = str(approval_path); return approval


def build_restart_plan(*, policy: dict[str, Any], scope: str, force: bool = False, approval_file: str | Path | None = None) -> dict[str, Any]:
    if scope not in {"controller", "control_plane", "full_runtime"}: raise PolicyError(f"unknown restart scope: {scope}")
    resources = active_resources(policy); approval = None
    units = CONTROLLER_UNITS if scope == "controller" else (CONTROL_PLANE_UNITS if scope == "control_plane" else FULL_RUNTIME_UNITS)
    if force:
        if approval_file is None: raise PolicyError("--force requires an approval file")
        approval = _validate_break_glass_approval(approval_file)
    if scope == "controller":
        blocked = False; continuity = "NOT_APPLICABLE_CONTROLLER_ONLY"
    else:
        blocked = resources["restart_blocked"] and not force
        continuity = "LIVE_PROCESS_REATTACH_REQUIRED" if scope == "control_plane" else "CHECKPOINT_FALLBACK_NEW_GENERATION_REQUIRED_IF_SESSIONS_DIE"
    return {"schema_version": "2.1", "scope": scope, "units": units, "resources": resources, "force": force, "approval": approval, "blocked": blocked, "continuity_requirement": continuity, "native_resume_required_for_release": False, "cache_continuity_claim": "NOT_GUARANTEED", "planned_at": iso_now()}


def guarded_restart(*, policy_path: str | Path | None = None, force: bool = False, approval_file: str | Path | None = None, scope: str = "controller", apply: bool = False) -> dict[str, Any]:
    policy = load_policy(policy_path); plan = build_restart_plan(policy=policy, scope=scope, force=force, approval_file=approval_file)
    if plan["blocked"]: raise PolicyError("active or unknown resources block the requested restart scope")
    maintenance = Path(policy["state_root"]) / "maintenance"; maintenance.mkdir(parents=True, exist_ok=True, mode=0o700); path = maintenance / f"restart-plan-{scope}.json"
    if not apply:
        plan["status"] = "PLAN_ONLY"; atomic_write_json(path, plan); return {**plan, "plan_path": str(path)}
    if scope != "controller" and plan["resources"]["restart_blocked"] and not force:
        raise PolicyError("non-controller restart with active resources requires explicit break-glass approval")
    record = {**plan, "status": "RESTARTING", "started_at": iso_now()}; atomic_write_json(path, record)
    health: dict[str, str] = {}
    for unit in plan["units"]:
        proc = run(["systemctl", "--user", "restart", unit], timeout=120, check=False)
        if proc.returncode != 0:
            record.update({"status": "FAILED", "failed_unit": unit, "stderr": proc.stderr[-4000:], "completed_at": iso_now()}); atomic_write_json(path, record); return record
    for unit in plan["units"]:
        proc = run(["systemctl", "--user", "is-active", unit], timeout=30, check=False); health[unit] = proc.stdout.strip() or proc.stderr.strip()
    record.update({"status": "SERVICES_RESTARTED_MODEL_CONTINUITY_UNVERIFIED" if scope != "controller" else "CONTROLLER_RESTARTED", "unit_health": health, "completed_at": iso_now(), "health_claim": "service readiness only; model continuity requires host-observed nonce handshake"})
    atomic_write_json(path, record); return record
