"""Durable usage ledger with exact session correlation where provider data permits.

Budget enforcement remains warning-only until terminal/session/artifact
correlation is exact.  AGY values are never estimated.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, append_jsonl, atomic_write_json, iso_now, load_json, sha256_file, sha256_json, validate_id


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


# --------------------------------------------------------------------------
# UsageRecord v2 - provider-neutral, native-unit preserving
# --------------------------------------------------------------------------
#
# Providers disagree about what they measure.  One reports prompt/completion
# tokens, another reports percentage allowance, another reports only wall time
# and a currency amount, and several report nothing at all.  UsageRecord v2
# therefore stores a *list of native metrics* rather than a fixed set of token
# columns, and treats "this provider does not expose that number" as a first
# class, recordable fact.
#
# Two things are deliberately impossible here.  Missing metrics are never
# estimated into existence, because an invented token count is
# indistinguishable from a measured one once written down.  And metrics in
# different native units are never collapsed into a single universal
# token/cost equivalent, because that conversion silently encodes a pricing and
# tokenisation model that is not true of every provider and cannot be audited
# afterwards.

USAGE_RECORD_V2_SCHEMA_VERSION = "2.0"

#: A legitimate, recordable value: the provider genuinely does not expose it.
UNAVAILABLE = "UNAVAILABLE"

AVAILABILITY_VALUES = ("MEASURED", "PROVIDER_REPORTED", "UNAVAILABLE", "NOT_APPLICABLE")
CONFIDENCE_VALUES = ("exact", "high", "medium", "low", "unavailable")

#: Metric names that would represent a cross-provider fabrication.
_FABRICATED_METRIC_NAMES = frozenset({
    "universal_tokens", "universal_token_equivalent", "normalized_tokens",
    "token_equivalent", "equivalent_tokens", "universal_cost", "universal_units",
    "normalized_cost_units", "standard_tokens", "blended_tokens",
})


def usage_metric(
    *,
    metric: str,
    native_unit: str,
    value: float | int | None,
    source: str,
    availability: str = "MEASURED",
    confidence: str = "high",
) -> dict[str, Any]:
    """One provider-native measurement, or an explicit statement of absence."""

    if not isinstance(metric, str) or not metric.strip():
        raise ContractError("usage metric requires a name")
    if metric.strip().lower() in _FABRICATED_METRIC_NAMES:
        raise PolicyError(
            f"usage metric {metric!r} is a fabricated cross-provider unit; "
            "record provider-native metrics instead"
        )
    if not isinstance(native_unit, str) or not native_unit.strip():
        raise ContractError("usage metric requires an explicit provider-native unit")
    if availability not in AVAILABILITY_VALUES:
        raise ContractError(f"invalid usage availability: {availability!r}")
    if confidence not in CONFIDENCE_VALUES:
        raise ContractError(f"invalid usage confidence: {confidence!r}")
    if availability in {"UNAVAILABLE", "NOT_APPLICABLE"}:
        if value is not None:
            raise PolicyError(
                f"metric {metric!r} is {availability} and must not carry a value; "
                "missing provider telemetry is never estimated"
            )
        confidence = "unavailable" if availability == "UNAVAILABLE" else confidence
    elif value is None:
        raise ContractError(
            f"metric {metric!r} claims availability {availability} but has no value; "
            f"use availability={UNAVAILABLE} instead"
        )
    if not isinstance(source, str) or not source.strip():
        raise ContractError("usage metric requires an evidence source")
    return {
        "metric": metric.strip(),
        "native_unit": native_unit.strip(),
        "value": value,
        "availability": availability,
        "confidence": confidence,
        "source": source.strip(),
        "estimated": False,
    }


def unavailable_metric(*, metric: str, native_unit: str, source: str) -> dict[str, Any]:
    """Record that a provider does not expose a metric at all."""

    return usage_metric(
        metric=metric, native_unit=native_unit, value=None,
        source=source, availability="UNAVAILABLE", confidence="unavailable",
    )


def normalized_currency_estimate(
    *, currency: str, amount: float, source: str, confidence: str, basis: str
) -> dict[str, Any]:
    """An optional, clearly secondary currency estimate.

    This never replaces a native value.  It is marked as an estimate, carries
    its own source, confidence and basis, and is stored beside the native
    metrics rather than among them.
    """

    if confidence not in CONFIDENCE_VALUES:
        raise ContractError(f"invalid estimate confidence: {confidence!r}")
    if not currency.strip() or not source.strip() or not basis.strip():
        raise ContractError("a normalized estimate requires currency, source and basis")
    return {
        "currency": currency.strip().upper(),
        "amount": float(amount),
        "source": source.strip(),
        "confidence": confidence,
        "basis": basis.strip(),
        "is_estimate": True,
        "secondary": True,
        "replaces_native_values": False,
    }


def new_usage_record_v2(
    *,
    usage_record_id: str,
    run_id: str,
    metrics: list[dict[str, Any]],
    observed_at: str | None = None,
    milestone_id: str | None = None,
    work_package_id: str | None = None,
    task_id: str | None = None,
    role: str | None = None,
    episode_id: str | None = None,
    command_id: str | None = None,
    provider_id: str | None = None,
    provider_profile_id: str | None = None,
    account_profile_id: str | None = None,
    model: str | None = None,
    transport_id: str | None = None,
    correlation: dict[str, Any] | None = None,
    normalized_estimate: dict[str, Any] | None = None,
    source: str = "host_observation",
) -> dict[str, Any]:
    """Build a provider-neutral, extensible UsageRecord."""

    validate_id(usage_record_id, "usage_record_id")
    validate_id(run_id, "run_id")
    if not metrics:
        raise ContractError("UsageRecord v2 requires at least one metric")

    seen: set[tuple[str, str]] = set()
    for metric in metrics:
        for field in ("metric", "native_unit", "availability", "confidence", "source"):
            if field not in metric:
                raise ContractError(f"usage metric missing {field}")
        key = (str(metric["metric"]), str(metric["native_unit"]))
        if key in seen:
            raise ContractError(f"duplicate usage metric {key} in one record")
        seen.add(key)
        if str(metric["metric"]).strip().lower() in _FABRICATED_METRIC_NAMES:
            raise PolicyError(f"fabricated cross-provider metric in UsageRecord: {metric['metric']!r}")

    correlation = dict(correlation or {})
    exact = bool(correlation.get("exact"))
    record = {
        "schema_version": USAGE_RECORD_V2_SCHEMA_VERSION,
        "usage_record_id": usage_record_id,
        "run_id": run_id,
        "milestone_id": milestone_id,
        "work_package_id": work_package_id,
        "task_id": task_id,
        "role": role,
        "episode_id": episode_id,
        "command_id": command_id,
        "provider_id": provider_id,
        "provider_profile_id": provider_profile_id,
        "account_profile_id": account_profile_id,
        "model": model,
        "transport_id": transport_id,
        "metrics": [dict(m) for m in metrics],
        "normalized_estimate": dict(normalized_estimate) if normalized_estimate else None,
        "correlation": correlation,
        "exact_correlation": exact,
        # Only exactly-correlated usage may drive enforcement.  Usage that
        # cannot be tied to a specific command/session is still recorded, but it
        # is not evidence about any particular unit of work.
        "budget_enforcement_eligible": exact,
        "source": source,
        "observed_at": observed_at or iso_now(),
    }
    record["record_digest"] = sha256_json({k: v for k, v in record.items() if k != "record_digest"})
    assert_no_fabricated_universal_metric(record)
    return record


def assert_no_fabricated_universal_metric(record: dict[str, Any]) -> dict[str, Any]:
    """Fail closed on invented cross-provider units or estimated values."""

    for metric in record.get("metrics") or []:
        name = str(metric.get("metric", "")).strip().lower()
        if name in _FABRICATED_METRIC_NAMES:
            raise PolicyError(f"UsageRecord carries a fabricated universal metric: {name}")
        if metric.get("estimated"):
            raise PolicyError(
                f"UsageRecord metric {name!r} is estimated; native metrics are measured or UNAVAILABLE"
            )
        if metric.get("availability") in {"UNAVAILABLE", "NOT_APPLICABLE"} and metric.get("value") is not None:
            raise PolicyError(f"UsageRecord metric {name!r} is unavailable but carries a value")
    estimate = record.get("normalized_estimate")
    if estimate is not None:
        if not estimate.get("is_estimate") or not estimate.get("secondary"):
            raise PolicyError("a normalized currency estimate must be marked as a secondary estimate")
        if estimate.get("replaces_native_values"):
            raise PolicyError("a normalized estimate may never replace native values")
    return record


def native_total(records: list[dict[str, Any]], *, metric: str, native_unit: str) -> dict[str, Any]:
    """Total one metric within one native unit.

    Summation is unit-scoped on purpose.  Adding values that share a metric
    name but not a unit is exactly the fabrication this layer exists to
    prevent, so mixed units are reported rather than silently added.
    """

    total = 0.0
    counted = 0
    unavailable = 0
    other_units: set[str] = set()
    for record in records:
        for item in record.get("metrics") or []:
            if str(item.get("metric")) != metric:
                continue
            unit = str(item.get("native_unit"))
            if unit != native_unit:
                other_units.add(unit)
                continue
            if item.get("availability") in {"UNAVAILABLE", "NOT_APPLICABLE"}:
                unavailable += 1
                continue
            total += float(item.get("value") or 0)
            counted += 1
    return {
        "metric": metric,
        "native_unit": native_unit,
        "total": total,
        "counted": counted,
        "unavailable": unavailable,
        "excluded_other_units": sorted(other_units),
        "complete": unavailable == 0 and not other_units,
    }


def append_usage_record_v2(state_root: str | Path, record: dict[str, Any]) -> Path:
    """Append a UsageRecord v2 to the durable usage ledger."""

    assert_no_fabricated_universal_metric(record)
    if record.get("schema_version") != USAGE_RECORD_V2_SCHEMA_VERSION:
        raise ContractError("unsupported UsageRecord schema for the v2 ledger")
    path = Path(state_root) / "telemetry" / "usage-ledger-v2.jsonl"
    append_jsonl(path, record)
    return path
