"""Durable usage ledger with exact session correlation where provider data permits.

Budget enforcement remains warning-only until terminal/session/artifact
correlation is exact.  AGY values are never estimated.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, append_jsonl, atomic_write_json, iso_now, load_json, sha256_file


def record_prompt_manifest(*, state_root: str | Path, terminal_id: str, provider: str, profile_name: str, profile_path: str | Path, profile_body_bytes: int, skill_catalog_bytes: int, security_prompt_bytes: int, model: str | None, reasoning_effort: str | None, allowed_tools: list[str] | None) -> Path:
    root = Path(state_root) / "telemetry" / "prompt-manifests"; path = root / f"{terminal_id}.json"
    record = {"schema_version": "1.0", "terminal_id": terminal_id, "provider": provider, "profile_name": profile_name, "profile_path": str(profile_path), "profile_sha256": sha256_file(Path(profile_path)), "profile_body_bytes": profile_body_bytes, "skill_catalog_bytes": skill_catalog_bytes, "security_prompt_bytes": security_prompt_bytes, "cao_static_prompt_bytes": profile_body_bytes + skill_catalog_bytes + security_prompt_bytes, "model": model, "reasoning_effort": reasoning_effort, "allowed_tools": allowed_tools, "created_at": iso_now()}
    atomic_write_json(path, record); return path


def append_usage_event(state_root: str | Path, event: dict[str, Any]) -> Path:
    missing = sorted({"provider", "role", "observed_at"} - event.keys())
    if missing: raise ContractError(f"usage event missing fields: {missing}")
    path = Path(state_root) / "telemetry" / "usage-ledger.jsonl"; append_jsonl(path, {"schema_version": "1.1", **event}); return path


def _codex_session_id(path: Path) -> str | None:
    for line in path.read_text(encoding="utf-8").splitlines():
        try: item = json.loads(line)
        except json.JSONDecodeError: continue
        if item.get("type") == "session_meta":
            payload = item.get("payload") or {}
            return payload.get("id") or payload.get("session_id")
        payload = item.get("payload") or {}
        if isinstance(payload, dict) and payload.get("type") == "session_meta": return payload.get("id") or payload.get("session_id")
    return None


def codex_rollout_events(*, rollout_path: str | Path, run_id: str | None, task_id: str | None, role: str, terminal_id: str | None, expected_session_id: str | None = None) -> list[dict[str, Any]]:
    path = Path(rollout_path); observed_session = _codex_session_id(path)
    exact = bool(expected_session_id and observed_session == expected_session_id)
    events: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try: item = json.loads(line)
        except json.JSONDecodeError: continue
        payload = item.get("payload") if isinstance(item, dict) else None
        if not isinstance(payload, dict) or payload.get("type") != "token_count": continue
        usage = ((payload.get("info") or {}).get("last_token_usage") or {})
        events.append({"provider": "codex", "run_id": run_id, "task_id": task_id, "role": role, "terminal_id": terminal_id, "provider_session_id": observed_session, "provider_session_path": str(path), "input_tokens": int(usage.get("input_tokens") or 0), "cached_input_tokens": int(usage.get("cached_input_tokens") or 0), "output_tokens": int(usage.get("output_tokens") or 0), "reasoning_tokens": int(usage.get("reasoning_output_tokens") or 0), "observed_at": item.get("timestamp") or iso_now(), "telemetry_confidence": "high", "exact_correlation": exact, "budget_enforcement_eligible": exact})
    return events


def _claude_session_id(item: dict[str, Any]) -> str | None:
    return item.get("sessionId") or item.get("session_id") or ((item.get("message") or {}).get("sessionId") if isinstance(item.get("message"), dict) else None)


def claude_transcript_events(*, transcript_path: str | Path, run_id: str | None, task_id: str | None, role: str, terminal_id: str | None, expected_session_id: str | None = None) -> list[dict[str, Any]]:
    path = Path(transcript_path); events: list[dict[str, Any]] = []; observed_ids: set[str] = set()
    items: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try: item = json.loads(line)
        except json.JSONDecodeError: continue
        if isinstance(item, dict):
            items.append(item); sid = _claude_session_id(item)
            if sid: observed_ids.add(sid)
    observed_session = next(iter(observed_ids)) if len(observed_ids) == 1 else None
    exact = bool(expected_session_id and observed_session == expected_session_id)
    for item in items:
        message = item.get("message") if isinstance(item, dict) else None; usage = message.get("usage") if isinstance(message, dict) else None
        if not isinstance(usage, dict): continue
        events.append({"provider": "claude", "run_id": run_id, "task_id": task_id, "role": role, "terminal_id": terminal_id, "provider_session_id": observed_session, "provider_session_path": str(path), "input_tokens": int(usage.get("input_tokens") or 0), "cache_read_input_tokens": int(usage.get("cache_read_input_tokens") or 0), "cache_creation_input_tokens": int(usage.get("cache_creation_input_tokens") or 0), "output_tokens": int(usage.get("output_tokens") or 0), "observed_at": item.get("timestamp") or iso_now(), "telemetry_confidence": "high", "exact_correlation": exact, "budget_enforcement_eligible": exact})
    return events


def correlate_registry_usage(*, registry_path: str | Path, role: str, run_id: str | None = None, task_id: str | None = None, terminal_id: str | None = None) -> dict[str, Any]:
    registry = load_json(registry_path); provider = registry.get("provider"); artifact = registry.get("provider_session_artifact"); session_id = registry.get("provider_session_id")
    if provider not in {"codex", "claude_code"}: return {"status": "UNAVAILABLE", "reason": f"provider {provider} has no exact transcript parser", "events": []}
    if not artifact or not session_id: return {"status": "WARNING_ONLY", "reason": "provider session identity or artifact is absent", "events": []}
    path = Path(artifact)
    if not path.is_file(): return {"status": "WARNING_ONLY", "reason": "provider session artifact is not readable", "events": []}
    if provider == "codex": events = codex_rollout_events(rollout_path=path, run_id=run_id or registry.get("run_id"), task_id=task_id, role=role, terminal_id=terminal_id or registry.get("terminal_id"), expected_session_id=session_id)
    else: events = claude_transcript_events(transcript_path=path, run_id=run_id or registry.get("run_id"), task_id=task_id, role=role, terminal_id=terminal_id or registry.get("terminal_id"), expected_session_id=session_id)
    exact = bool(events) and all(event.get("exact_correlation") for event in events)
    return {"status": "EXACT" if exact else "WARNING_ONLY", "provider": provider, "provider_session_id": session_id, "artifact": str(path), "events": events, "count": len(events)}


def enforce_usage_mode(policy: dict[str, Any], correlation: dict[str, Any]) -> str:
    mode = str((policy.get("usage") or {}).get("enforcement_mode", "warning_only"))
    if mode not in {"warning_only", "hard"}: raise PolicyError(f"invalid usage enforcement mode: {mode}")
    if mode == "hard" and correlation.get("status") != "EXACT": raise PolicyError("hard usage enforcement requires exact provider session correlation")
    return mode


def agy_usage_placeholder(*, run_id: str | None, task_id: str | None, role: str, job_id: str, model: str, prompt_bytes: int, elapsed_seconds: float | None) -> dict[str, Any]:
    return {"provider": "agy", "run_id": run_id, "task_id": task_id, "role": role, "job_id": job_id, "model": model, "prompt_bytes": prompt_bytes, "elapsed_seconds": elapsed_seconds, "input_tokens": None, "output_tokens": None, "cached_input_tokens": None, "observed_at": iso_now(), "telemetry_confidence": "unavailable", "exact_correlation": False, "budget_enforcement_eligible": False, "note": "Installed AGY exposes no token counters; values are intentionally not estimated."}


def execution_usage_placeholder(*, provider: str, run_id: str | None, task_id: str | None, phase_id: str | None, role: str, job_id: str, terminal_id: str | None, model: str, prompt_bytes: int, elapsed_seconds: float) -> dict[str, Any]:
    if not isinstance(provider, str) or not provider.strip(): raise ContractError("placeholder provider must be non-empty")
    return {"provider": provider, "run_id": run_id, "task_id": task_id, "phase_id": phase_id, "role": role, "job_id": job_id, "terminal_id": terminal_id, "model": model, "prompt_bytes": prompt_bytes, "elapsed_seconds": elapsed_seconds, "input_tokens": None, "output_tokens": None, "cached_input_tokens": None, "observed_at": iso_now(), "telemetry_confidence": "low", "exact_correlation": False, "budget_enforcement_eligible": False, "note": "Exact token telemetry requires provider session correlation; values are not estimated."}
