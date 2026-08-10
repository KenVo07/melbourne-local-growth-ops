"""Global canary-scope authority gate.

Process liveness (the controller/service being started, by systemd or
otherwise) grants no execution authority. Real provider dispatch is only
permitted while an explicit, time-bounded, disposable canary scope is open
and the run attempting to dispatch is named inside it. Absent an active
scope, the global posture is v2_shadow: observe/reconcile only.

This module is provider-neutral: it knows nothing about any specific
provider/vendor. Provider mechanics stay in adapters/registry data.
"""

from __future__ import annotations

import datetime as dt
from pathlib import Path
from typing import Any

from .common import (
    MLGOError,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    parse_iso,
    utc_now,
    validate_id,
)

SCHEMA_VERSION = "1.0"
POSTURE_SHADOW = "v2_shadow"
POSTURE_CANARY = "canary"


class CanaryScopeError(MLGOError):
    pass


def _scope_path(policy: dict[str, Any]) -> Path:
    return Path(policy["state_root"]) / "governance" / "canary-scope.json"


def _lock_path(policy: dict[str, Any]) -> Path:
    return Path(policy["state_root"]) / "governance" / ".canary-scope.lock"


def _read_raw(policy: dict[str, Any]) -> dict[str, Any] | None:
    path = _scope_path(policy)
    if not path.is_file():
        return None
    try:
        return load_json(path)
    except Exception:
        # A corrupt/unreadable scope file must never be interpreted as an
        # open canary. Fail closed to shadow.
        return None


def active_scope(policy: dict[str, Any]) -> dict[str, Any] | None:
    """Return the currently active canary scope, or None if posture is shadow.

    Expiry is evaluated on every read so a stale scope can never grant
    authority merely because nothing has explicitly closed it yet.
    """
    raw = _read_raw(policy)
    if raw is None or raw.get("status") != "OPEN":
        return None
    try:
        expires_at = parse_iso(raw["expires_at"])
    except Exception:
        return None
    if utc_now() >= expires_at:
        return None
    return raw


def posture(policy: dict[str, Any]) -> str:
    return POSTURE_CANARY if active_scope(policy) is not None else POSTURE_SHADOW


def is_authorized(policy: dict[str, Any], *, run_id: str) -> bool:
    """Whether the given run_id may perform real provider dispatch right now."""
    scope = active_scope(policy)
    if scope is None:
        return False
    return run_id in scope.get("run_ids", [])


def open_scope(
    policy: dict[str, Any],
    *,
    scope_id: str,
    run_ids: list[str],
    ttl_seconds: int,
    reason: str,
    opened_by: str,
) -> dict[str, Any]:
    if ttl_seconds <= 0 or ttl_seconds > 24 * 3600:
        raise CanaryScopeError("canary scope ttl_seconds must be in (0, 86400]")
    if not run_ids:
        raise CanaryScopeError("canary scope requires at least one explicit run_id")
    validate_id(scope_id, "scope_id")
    for rid in run_ids:
        validate_id(rid, "run_id")
    path = _scope_path(policy)
    with file_lock(_lock_path(policy)):
        existing = active_scope(policy)
        if existing is not None and existing.get("scope_id") != scope_id:
            raise CanaryScopeError(
                f"a different canary scope is already open: {existing.get('scope_id')}"
            )
        opened_at = utc_now()
        expires_at = opened_at + dt.timedelta(seconds=ttl_seconds)
        record = {
            "schema_version": SCHEMA_VERSION,
            "scope_id": scope_id,
            "status": "OPEN",
            "run_ids": sorted(set(run_ids)),
            "reason": reason,
            "opened_by": opened_by,
            "opened_at": iso_now(),
            "expires_at": expires_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }
        atomic_write_json(path, record)
    return record


def close_scope(policy: dict[str, Any], *, reason: str) -> dict[str, Any]:
    """Restore safe shadow posture. Idempotent: closing with nothing open is a no-op."""
    path = _scope_path(policy)
    with file_lock(_lock_path(policy)):
        raw = _read_raw(policy)
        if raw is None or raw.get("status") != "OPEN":
            return {"ok": True, "already_closed": True}
        raw = dict(raw)
        raw["status"] = "CLOSED"
        raw["closed_at"] = iso_now()
        raw["close_reason"] = reason
        atomic_write_json(path, raw)
    return {"ok": True, "already_closed": False, "scope": raw}


def status(policy: dict[str, Any]) -> dict[str, Any]:
    scope = active_scope(policy)
    raw = _read_raw(policy)
    return {
        "posture": POSTURE_CANARY if scope else POSTURE_SHADOW,
        "active_scope": scope,
        "last_known_record": raw,
    }
