"""Durable host executor lease/epoch fencing.

Fencing protects host-controlled submission preconditions and durable local
application. It does not pretend to cancel an already-sent external request.
"""
from __future__ import annotations

import datetime as dt
import secrets
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, atomic_write_json, file_lock, iso_now, load_json, parse_iso, validate_id

LEASE_SCHEMA_VERSION = "1.0"


class ExecutorLeaseStore:
    def __init__(self, run_v2_dir: str | Path):
        self.root = Path(run_v2_dir)
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / "executor-lease.json"
        self.lock = self.root / ".executor-lease.lock"

    def load(self) -> dict[str, Any] | None:
        return load_json(self.path) if self.path.exists() else None

    def acquire(self, owner_id: str, *, ttl_seconds: int = 60, replace: bool = False) -> dict[str, Any]:
        validate_id(owner_id, "executor owner_id")
        if not isinstance(ttl_seconds, int) or ttl_seconds < 1 or ttl_seconds > 3600:
            raise ContractError("executor lease ttl_seconds must be 1..3600")
        now = dt.datetime.now(dt.timezone.utc)
        with file_lock(self.lock):
            current = self.load()
            if current:
                expires = parse_iso(str(current["expires_at"]))
                same_owner = current.get("owner_id") == owner_id
                if expires > now and not same_owner and not replace:
                    raise PolicyError(f"executor lease is owned by {current.get('owner_id')}")
                epoch = int(current.get("epoch", 0)) + (0 if same_owner and expires > now else 1)
            else:
                epoch = 1
            token = secrets.token_hex(16)
            record = {
                "schema_version": LEASE_SCHEMA_VERSION,
                "owner_id": owner_id,
                "epoch": epoch,
                "token": token,
                "acquired_at": iso_now(),
                "expires_at": (now + dt.timedelta(seconds=ttl_seconds)).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            }
            atomic_write_json(self.path, record)
            return record

    def renew(self, *, owner_id: str, epoch: int, token: str, ttl_seconds: int = 60) -> dict[str, Any]:
        with file_lock(self.lock):
            self.require(owner_id=owner_id, epoch=epoch, token=token)
            now = dt.datetime.now(dt.timezone.utc)
            current = self.load() or {}
            current["expires_at"] = (now + dt.timedelta(seconds=ttl_seconds)).replace(microsecond=0).isoformat().replace("+00:00", "Z")
            current["renewed_at"] = iso_now()
            atomic_write_json(self.path, current)
            return current

    def require(self, *, owner_id: str, epoch: int, token: str, allow_expired: bool = False) -> dict[str, Any]:
        current = self.load()
        if not current:
            raise PolicyError("executor lease is absent")
        if current.get("owner_id") != owner_id or int(current.get("epoch", 0)) != int(epoch) or current.get("token") != token:
            raise PolicyError("stale executor lease/epoch fenced")
        if not allow_expired and parse_iso(str(current["expires_at"])) <= dt.datetime.now(dt.timezone.utc):
            raise PolicyError("executor lease expired")
        return current

    def fence(self, record: dict[str, Any]) -> dict[str, Any]:
        return self.require(owner_id=str(record.get("owner_id") or ""), epoch=int(record.get("epoch") or 0), token=str(record.get("token") or ""))
