"""Validation evidence fingerprints and conservative reuse policy.

Reuse is globally disabled by default.  Observation-only mode records potential
hits but still reruns the command.  Enforced reuse requires an explicit,
time-bounded promotion record proving a completed false-hit evaluation.
"""

from __future__ import annotations

import hashlib
import json
import os
import platform
from pathlib import Path
from typing import Any

from .common import PolicyError, atomic_write_json, iso_now, load_json, parse_iso, run, sha256_file, utc_now


def _command_output(command: list[str], cwd: Path) -> str | None:
    proc = run(command, cwd=cwd, timeout=30, check=False)
    if proc.returncode != 0:
        return None
    return proc.stdout.strip().splitlines()[0][:500] if proc.stdout.strip() else ""


def _file_digests(wt: Path, names: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for name in names:
        path = wt / name
        if path.is_file():
            out[name] = sha256_file(path)
    return out


def environment_fingerprint(worktree: str | Path, policy: dict[str, Any] | None = None) -> dict[str, Any]:
    wt = Path(worktree).resolve()
    cfg = (policy or {}).get("validation_evidence") or {}
    env_names = cfg.get("environment_variables") or [
        "NODE_ENV", "CI", "PLAYWRIGHT_BROWSERS_PATH", "TZ", "LANG", "LC_ALL",
    ]
    config_files = cfg.get("configuration_files") or [
        "pnpm-lock.yaml", "package-lock.json", "yarn.lock", "uv.lock", "poetry.lock",
        "Cargo.lock", "package.json", "pnpm-workspace.yaml", "playwright.config.ts",
        "playwright.config.js", "vitest.config.ts", "vite.config.ts", "tsconfig.json",
    ]
    return {
        "platform": platform.platform(), "machine": platform.machine(),
        "python": platform.python_version(),
        "node": _command_output(["node", "--version"], wt),
        "pnpm": _command_output(["pnpm", "--version"], wt),
        "git": _command_output(["git", "--version"], wt),
        "playwright": _command_output(["npx", "playwright", "--version"], wt),
        "browser_runtime_hint": os.environ.get("PLAYWRIGHT_BROWSERS_PATH"),
        "environment": {name: os.environ.get(name) for name in sorted(set(env_names))},
        "configuration_files": _file_digests(wt, list(config_files)),
        "fingerprint_version": "2.0",
    }


def workspace_digest(worktree: str | Path) -> str:
    wt = Path(worktree).resolve()
    head = run(["git", "-C", str(wt), "rev-parse", "HEAD"]).stdout.strip()
    status = run(["git", "-C", str(wt), "status", "--porcelain=v1", "--untracked-files=all"]).stdout
    h = hashlib.sha256(); h.update(head.encode()); h.update(status.encode())
    for line in status.splitlines():
        if len(line) < 4: continue
        raw = line[3:]
        if " -> " in raw: raw = raw.split(" -> ", 1)[1]
        path = wt / raw; h.update(raw.encode())
        if path.is_file() and not path.is_symlink(): h.update(path.read_bytes())
        elif path.is_symlink(): h.update(str(path.readlink()).encode())
    return h.hexdigest()


def cache_key(worktree: str | Path, command: str, policy: dict[str, Any] | None = None) -> tuple[str, dict[str, Any]]:
    facts = {
        "workspace_digest": workspace_digest(worktree), "command": command,
        "environment": environment_fingerprint(worktree, policy),
    }
    encoded = json.dumps(facts, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest(), facts


def load_success(state_root: str | Path, key: str) -> dict[str, Any] | None:
    path = Path(state_root) / "validation-cache" / f"{key}.json"
    if not path.is_file(): return None
    try: value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError): return None
    return value if value.get("returncode") == 0 and value.get("cache_key") == key else None


def record(*, state_root: str | Path, key: str, facts: dict[str, Any], returncode: int, stdout: str, stderr: str, elapsed_seconds: float) -> Path:
    path = Path(state_root) / "validation-cache" / f"{key}.json"
    atomic_write_json(path, {
        "schema_version": "2.0", "cache_key": key, **facts, "returncode": returncode,
        "stdout": stdout[-20000:], "stderr": stderr[-20000:],
        "elapsed_seconds": elapsed_seconds, "recorded_at": iso_now(),
    })
    return path


def reuse_mode(policy: dict[str, Any]) -> str:
    mode = str((policy.get("validation_evidence") or {}).get("reuse_mode", "disabled"))
    if mode not in {"disabled", "observation_only", "enforced"}:
        raise PolicyError(f"invalid validation evidence reuse mode: {mode}")
    if mode == "enforced":
        validate_promotion(policy)
    return mode


def validate_promotion(policy: dict[str, Any]) -> dict[str, Any]:
    cfg = policy.get("validation_evidence") or {}
    raw = cfg.get("promotion_record")
    if not raw:
        raise PolicyError("enforced evidence reuse requires a promotion record")
    record = load_json(raw)
    if record.get("schema_version") != "1.0" or record.get("action") != "PROMOTE_VALIDATION_EVIDENCE_REUSE":
        raise PolicyError("invalid validation evidence promotion record")
    if record.get("approved") is not True or int(record.get("false_hits", -1)) != 0:
        raise PolicyError("validation reuse promotion requires explicit approval and zero false hits")
    minimum = int(cfg.get("minimum_observations_for_promotion", 20))
    if int(record.get("observations", 0)) < minimum:
        raise PolicyError("validation reuse promotion observation floor not met")
    if parse_iso(str(record.get("expires_at"))) <= utc_now():
        raise PolicyError("validation reuse promotion record has expired")
    if record.get("fingerprint_version") != "2.0":
        raise PolicyError("validation reuse promotion covers a different fingerprint version")
    return record
