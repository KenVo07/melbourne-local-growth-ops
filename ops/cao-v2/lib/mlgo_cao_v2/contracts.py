"""Durable packet validation and result extraction.

The JSON Schema files are supplied for editor/tooling integration.  Runtime
validation here intentionally covers the load-bearing invariants without adding
a third-party jsonschema dependency to operator machines.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

from .common import ContractError, bounded_text, ensure_absolute, load_json, safe_relative_path, validate_id, validate_sha
from .policy import route_ids

RESULT_START = "MLGO_RESULT_PACKET"
RESULT_END = "END_MLGO_RESULT_PACKET"
AGY_START = "AGY_RESULT_PACKET"
AGY_END = "END_AGY_RESULT_PACKET"

RESULT_STATUSES = {
    "READY_FOR_COMMIT",
    "NO_CHANGE",
    "PASS",
    "FAIL",
    "BLOCKED",
    "PLAN_CONFLICT",
    "CAPABILITY_ESCALATION_REQUIRED",
    "ENVIRONMENT_BLOCKED",
    "MISSING_REQUIRED_CONTEXT",
}

PHASE_KINDS = {"implementation", "review", "analysis", "validation", "integration_repair"}
REVIEW_CLASSES = {"none", "routine_independent", "cross_provider", "critical_frontier"}

# Concrete semantic fallback for a completed phase that requires no follow-up.
# The template itself uses JSON null so copying the template remains invalid;
# providers must replace it with this or another specific non-empty action.
NO_FURTHER_ACTION = "No further action; host may close this phase."


class ResultPacketExtractionError(ContractError):
    """No valid result packet was found; exact candidate rejections are preserved."""

    def __init__(
        self,
        message: str,
        *,
        candidate_count: int,
        rejections: list[dict[str, Any]],
    ) -> None:
        self.candidate_count = candidate_count
        self.rejections = rejections
        super().__init__(message)


def _require_dict(value: object, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ContractError(f"{label} must be an object")
    return value


def _require_list(value: object, label: str, *, nonempty: bool = False) -> list[Any]:
    if not isinstance(value, list):
        raise ContractError(f"{label} must be an array")
    if nonempty and not value:
        raise ContractError(f"{label} must not be empty")
    return value


def validate_big_task_charter(value: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    if value.get("schema_version") != "2.0":
        raise ContractError("big task charter schema_version must be 2.0")
    validate_id(value.get("run_id", ""), "run_id")
    validate_id(value.get("big_task_id", ""), "big_task_id")
    bounded_text(value.get("outcome"), label="outcome", maximum=4096)
    for field in ("acceptance", "in_scope", "out_of_scope"):
        items = _require_list(value.get(field), field, nonempty=(field == "acceptance"))
        for item in items:
            bounded_text(item, label=f"{field} item", maximum=2048)
    for item in _require_list(value.get("constraints", []), "constraints"):
        bounded_text(item, label="constraint", maximum=2048)
    if value.get("risk_class") not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
        raise ContractError("risk_class must be LOW, MEDIUM, HIGH or CRITICAL")
    if value.get("budget_class", "medium") not in {"small", "medium", "large", "critical"}:
        raise ContractError("invalid budget_class")
    bounded_text(value.get("completion_boundary"), label="completion_boundary", maximum=4096)
    if value.get("rollback_boundary") is not None:
        bounded_text(value.get("rollback_boundary"), label="rollback_boundary", maximum=4096)

    envelope = _require_dict(value.get("delegation_envelope"), "delegation_envelope")
    allowed = _require_list(envelope.get("allowed_routes"), "delegation_envelope.allowed_routes", nonempty=True)
    if len(allowed) != len(set(allowed)):
        raise ContractError("delegation_envelope.allowed_routes must be unique")
    unknown = sorted(set(allowed) - route_ids(policy))
    if unknown:
        raise ContractError(f"delegation envelope contains unknown routes: {unknown}")
    maximum_tier = envelope.get("maximum_tier")
    if not isinstance(maximum_tier, int) or not 1 <= maximum_tier <= 5:
        raise ContractError("delegation_envelope.maximum_tier must be 1..5")
    above = sorted(rid for rid in allowed if int(policy["routes"][rid]["tier"]) > maximum_tier)
    if above:
        raise ContractError(f"allowed routes exceed delegation maximum_tier: {above}")
    for boolean_field in ("gateway_allowed", "protected_supervisor_pool_use_allowed"):
        if not isinstance(envelope.get(boolean_field, False), bool):
            raise ContractError(f"delegation_envelope.{boolean_field} must be boolean")
    if not envelope.get("gateway_allowed", False) and any(policy["routes"][rid].get("gateway") for rid in allowed):
        raise ContractError("delegation envelope includes gateway route while gateway_allowed=false")
    max_phases = envelope.get("max_phases")
    if not isinstance(max_phases, int) or not 1 <= max_phases <= 8:
        raise ContractError("delegation_envelope.max_phases must be 1..8")
    max_writers = envelope.get("max_parallel_writers")
    global_max = int(policy["orchestration"]["max_parallel_write_phases"])
    if not isinstance(max_writers, int) or not 1 <= max_writers <= global_max:
        raise ContractError(f"delegation_envelope.max_parallel_writers must be 1..{global_max}")
    for item in _require_list(envelope.get("supervisor_approval_triggers"), "delegation_envelope.supervisor_approval_triggers"):
        bounded_text(item, label="supervisor approval trigger", maximum=512)

    review_policy = _require_dict(value.get("review_policy"), "review_policy")
    if review_policy.get("default_class") not in REVIEW_CLASSES:
        raise ContractError("review_policy.default_class is invalid")
    if not isinstance(review_policy.get("critical_requires_cross_provider"), bool):
        raise ContractError("review_policy.critical_requires_cross_provider must be boolean")
    return value


def validate_routing_proposal(
    value: dict[str, Any], policy: dict[str, Any], charter: dict[str, Any] | None = None
) -> dict[str, Any]:
    if value.get("schema_version") != "2.0":
        raise ContractError("routing proposal schema_version must be 2.0")
    validate_id(value.get("run_id", ""), "run_id")
    validate_id(value.get("big_task_id", ""), "big_task_id")
    validate_id(value.get("phase_id", ""), "phase_id")
    preferred = value.get("preferred_route")
    acceptable = _require_list(value.get("acceptable_routes"), "acceptable_routes", nonempty=True)
    if len(acceptable) != len(set(acceptable)):
        raise ContractError("acceptable_routes must be unique")
    unacceptable = _require_list(value.get("unacceptable_routes", []), "unacceptable_routes")
    if len(unacceptable) != len(set(unacceptable)):
        raise ContractError("unacceptable_routes must be unique")
    known = route_ids(policy)
    unknown = sorted(({preferred} | set(acceptable) | set(unacceptable)) - known)
    if unknown:
        raise ContractError(f"routing proposal contains unknown routes: {unknown}")
    if preferred not in acceptable:
        raise ContractError("preferred_route must also appear in acceptable_routes")
    overlap = sorted(set(acceptable) & set(unacceptable))
    if overlap:
        raise ContractError(f"routes cannot be both acceptable and unacceptable: {overlap}")
    if acceptable[0] != preferred:
        raise ContractError("preferred_route must be the first acceptable route")
    minimum_tier = value.get("minimum_tier")
    if not isinstance(minimum_tier, int) or not 1 <= minimum_tier <= 5:
        raise ContractError("minimum_tier must be 1..5")
    for rid in acceptable:
        tier = int(policy["routes"][rid]["tier"])
        if tier < minimum_tier:
            raise ContractError(
                f"acceptable route {rid} has tier {tier}, below minimum_tier {minimum_tier}"
            )
    if value.get("review_class") not in REVIEW_CLASSES:
        raise ContractError(f"invalid review_class: {value.get('review_class')!r}")
    _require_list(value.get("routing_reason"), "routing_reason", nonempty=True)
    _require_list(value.get("escalation_conditions"), "escalation_conditions")
    if charter is not None:
        if value["run_id"] != charter["run_id"] or value["big_task_id"] != charter["big_task_id"]:
            raise ContractError("routing proposal does not match big task charter identity")
        envelope = charter["delegation_envelope"]
        allowed_routes = set(envelope["allowed_routes"])
        outside = sorted(set(acceptable) - allowed_routes)
        if outside:
            raise ContractError(f"routing proposal exceeds delegation envelope: {outside}")
        if minimum_tier > int(envelope["maximum_tier"]):
            raise ContractError("routing proposal minimum_tier exceeds delegation envelope")
        if any(policy["routes"][rid].get("gateway") for rid in acceptable) and not envelope.get("gateway_allowed", False):
            raise ContractError("routing proposal includes gateway route but charter forbids gateway")
    characteristics = _require_dict(value.get("phase_characteristics"), "phase_characteristics")
    allowed_characteristics = {
        "difficulty": {"low", "ordinary", "difficult", "very_difficult", "critical"},
        "importance": {"low", "medium", "high", "critical"},
        "ambiguity": {"low", "medium", "high", "critical"},
        "reversibility": {"easy", "moderate", "hard", "irreversible"},
        "phase_maturity": {"exploratory", "foundation", "stable_foundation", "repetitive", "integration", "final_validation"},
    }
    for field, allowed_values in allowed_characteristics.items():
        if characteristics.get(field) not in allowed_values:
            raise ContractError(f"invalid phase_characteristics.{field}")
    families = _require_list(value.get("required_families", []), "required_families")
    known_families = {v.get("family") for v in (policy.get("_registry") or {}).get("providers", {}).values()} or {cfg.get("family") for cfg in policy["routes"].values()}
    if any(item not in known_families for item in families):
        raise ContractError("required_families contains an invalid family")
    for field in ("routing_reason", "escalation_conditions", "deescalation_conditions"):
        for item in _require_list(value.get(field, []), field, nonempty=(field == "routing_reason")):
            bounded_text(item, label=f"{field} item", maximum=512)
    if value.get("expected_budget_class", "medium") not in {"tiny", "small", "medium", "large", "critical"}:
        raise ContractError("invalid expected_budget_class")
    validate_id(value.get("capacity_snapshot_id", ""), "capacity_snapshot_id")
    ordinary = (
        characteristics.get("difficulty") in {"low", "ordinary"}
        and characteristics.get("ambiguity") in {"low", "medium"}
        and characteristics.get("phase_maturity") in {"stable_foundation", "repetitive", "final_validation"}
    )
    preferred_family = policy["routes"][preferred]["family"]
    preferred_families = set(policy["routing"].get("ordinary_phase_preferred_families") or [])
    require_nonpreferred_justification = bool(
        policy["routing"].get("ordinary_phase_nonpreferred_justification_required", True)
    )
    if (
        ordinary
        and preferred_families
        and preferred_family not in preferred_families
        and require_nonpreferred_justification
        and not str(value.get("frontier_justification") or "").strip()
    ):
        raise ContractError("ordinary phase skips the policy-preferred provider family without frontier_justification")
    return value


def validate_phase_packet(
    value: dict[str, Any], policy: dict[str, Any], charter: dict[str, Any] | None = None
) -> dict[str, Any]:
    if value.get("schema_version") != "2.0":
        raise ContractError("phase packet schema_version must be 2.0")
    for key in ("run_id", "big_task_id", "phase_id"):
        validate_id(value.get(key, ""), key)
    if value.get("phase_kind") not in PHASE_KINDS:
        raise ContractError(f"invalid phase_kind: {value.get('phase_kind')!r}")
    bounded_text(value.get("objective"), label="objective", maximum=4096)
    if not isinstance(value.get("write_capable"), bool):
        raise ContractError("write_capable must be boolean")
    prompt = ensure_absolute(value.get("prompt_file", ""), "prompt_file")
    routing = ensure_absolute(value.get("routing_proposal_file", ""), "routing_proposal_file")
    evidence = ensure_absolute(value.get("evidence_directory", ""), "evidence_directory")
    if not prompt.is_file():
        raise ContractError(f"prompt_file does not exist: {prompt}")
    if not routing.is_file():
        raise ContractError(f"routing_proposal_file does not exist: {routing}")
    if value["write_capable"]:
        wt = _require_dict(value.get("worktree"), "worktree")
        ensure_absolute(wt.get("path", ""), "worktree.path")
        bounded_text(wt.get("branch"), label="worktree.branch", maximum=256)
        bounded_text(wt.get("base_ref"), label="worktree.base_ref", maximum=256)
        ownership = _require_dict(value.get("ownership"), "ownership")
        allowed = _require_list(ownership.get("allowed_paths"), "ownership.allowed_paths", nonempty=True)
        for item in allowed:
            safe_relative_path(item)
        for item in _require_list(ownership.get("forbidden_paths", []), "ownership.forbidden_paths"):
            safe_relative_path(item)
    validation = _require_dict(value.get("validation"), "validation")
    commands = _require_list(validation.get("commands"), "validation.commands")
    if len(commands) > 20:
        raise ContractError("validation.commands exceeds 20")
    timeout = validation.get("timeout_seconds")
    if not isinstance(timeout, int) or not 1 <= timeout <= 14400:
        raise ContractError("validation.timeout_seconds must be 1..14400")
    result = _require_dict(value.get("result_contract"), "result_contract")
    statuses = set(_require_list(result.get("allowed_statuses"), "result_contract.allowed_statuses", nonempty=True))
    invalid = sorted(statuses - RESULT_STATUSES)
    if invalid:
        raise ContractError(f"invalid result statuses: {invalid}")
    for item in _require_list(value.get("stop_conditions"), "stop_conditions"):
        bounded_text(item, label="stop condition", maximum=512)
    if value.get("rollback_boundary") is not None:
        bounded_text(value.get("rollback_boundary"), label="rollback_boundary", maximum=2048)
    review = _require_dict(value.get("review", {}), "review")
    if not isinstance(review.get("required", False), bool):
        raise ContractError("review.required must be boolean")
    if review.get("required"):
        review_file = ensure_absolute(review.get("phase_packet_file", ""), "review.phase_packet_file")
        if not review_file.is_file():
            raise ContractError(f"review phase packet does not exist: {review_file}")
    integration = _require_dict(value.get("integration", {}), "integration")
    if not isinstance(integration.get("enabled", False), bool):
        raise ContractError("integration.enabled must be boolean")
    if integration.get("enabled"):
        ensure_absolute(integration.get("integration_worktree", ""), "integration.integration_worktree")
        bounded_text(integration.get("integration_branch"), label="integration.integration_branch", maximum=256)
    task_lead = _require_dict(value.get("task_lead", {}), "task_lead")
    if task_lead.get("task_lead_id") is not None:
        validate_id(task_lead.get("task_lead_id"), "task_lead.task_lead_id")
    if value.get("parent_phase_id") is not None:
        validate_id(value.get("parent_phase_id"), "parent_phase_id")
    if value["phase_kind"] == "review":
        if value["write_capable"]:
            raise ContractError("review phases must be read-only by default; use integration_repair for bounded repairs")
        if not set(result["allowed_statuses"]) & {"PASS", "FAIL", "BLOCKED"}:
            raise ContractError("review phase must allow PASS/FAIL/BLOCKED")
        if value.get("parent_phase_id") is None:
            raise ContractError("review phase requires parent_phase_id")
    if value["write_capable"] and "READY_FOR_COMMIT" not in statuses:
        raise ContractError("write-capable phase must allow READY_FOR_COMMIT")
    if charter is not None:
        if value["run_id"] != charter["run_id"] or value["big_task_id"] != charter["big_task_id"]:
            raise ContractError("phase packet does not match big task charter identity")
    evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
    return value


def validate_result_packet(value: dict[str, Any], phase: dict[str, Any] | None = None) -> dict[str, Any]:
    if value.get("schema_version") != "2.0":
        raise ContractError("result packet schema_version must be 2.0")
    for key in ("run_id", "big_task_id", "phase_id"):
        validate_id(value.get(key, ""), key)
    status = value.get("status")
    if status not in RESULT_STATUSES:
        raise ContractError(f"invalid result status: {status!r}")
    for field in (
        "changed_files",
        "verification",
        "assumptions_confirmed",
        "assumptions_invalidated",
        "risks",
        "evidence",
    ):
        items = _require_list(value.get(field, []), field)
        for item in items:
            if field == "changed_files":
                safe_relative_path(item)
            else:
                bounded_text(item, label=f"{field} item", maximum=4096)
    bounded_text(value.get("next_action"), label="next_action", maximum=4096)
    if value.get("commit_sha") not in {None, ""}:
        raise ContractError("builder/reviewer result packets must not claim a commit_sha; the host records commits")
    if phase is not None:
        for key in ("run_id", "big_task_id", "phase_id"):
            if value[key] != phase[key]:
                raise ContractError(f"result packet {key} does not match phase packet")
        allowed = set(phase["result_contract"]["allowed_statuses"])
        if status not in allowed:
            raise ContractError(f"result status {status} not allowed for phase")
        if not phase["write_capable"] and value["changed_files"]:
            raise ContractError("read-only phase reported changed files")
        if phase["write_capable"] and status == "READY_FOR_COMMIT" and not value["changed_files"]:
            raise ContractError("READY_FOR_COMMIT requires at least one changed file")
        if phase.get("phase_kind") == "review" and status == "PASS":
            validate_sha(str(value.get("reviewed_sha") or ""), "reviewed_sha")
    return value


def validate_capacity_snapshot(value: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    if value.get("schema_version") != "2.0":
        raise ContractError("capacity snapshot schema_version must be 2.0")
    validate_id(value.get("snapshot_id", ""), "snapshot_id")
    bounded_text(value.get("observed_at"), label="observed_at", maximum=128)
    bounded_text(value.get("expires_at"), label="expires_at", maximum=128)
    profiles = _require_dict(value.get("profiles"), "profiles")
    missing = sorted(route_ids(policy) - set(profiles))
    if missing:
        raise ContractError(f"capacity snapshot is missing routes: {missing}")
    for route_id, record in profiles.items():
        if route_id not in route_ids(policy):
            raise ContractError(f"capacity snapshot contains unknown route: {route_id}")
        item = _require_dict(record, f"profiles.{route_id}")
        if item.get("availability") not in {"available", "degraded", "unavailable", "unknown", "policy_locked"}:
            raise ContractError(f"invalid availability for {route_id}")
        if item.get("capacity_band") not in {"abundant", "healthy", "constrained", "protected", "exhausted", "unknown"}:
            raise ContractError(f"invalid capacity_band for {route_id}")
        if item.get("reserve_status") not in {"clear", "near", "protected", "not_applicable", "unknown"}:
            raise ContractError(f"invalid reserve_status for {route_id}")
    return value


def load_and_validate(path: str | Path, kind: str, policy: dict[str, Any], *, charter: dict[str, Any] | None = None, phase: dict[str, Any] | None = None) -> dict[str, Any]:
    value = load_json(path)
    if kind == "charter":
        return validate_big_task_charter(value, policy)
    if kind == "routing":
        return validate_routing_proposal(value, policy, charter)
    if kind == "phase":
        return validate_phase_packet(value, policy, charter)
    if kind == "result":
        return validate_result_packet(value, phase)
    if kind == "capacity":
        return validate_capacity_snapshot(value, policy)
    raise ContractError(f"unknown contract kind: {kind}")


def _normalize_terminal_wrapped_json(body: str) -> tuple[str, list[dict[str, Any]]]:
    """Undo only terminal wrapping that occurs *inside* JSON string tokens.

    Newlines outside strings remain intact JSON whitespace.  A non-whitespace
    repaint row therefore remains visible to the JSON parser and cannot be
    silently deleted.  Inside a JSON string, CAO/terminal hard wrapping is
    represented by a physical CR/LF followed by row indentation; those bytes
    are removed without adding punctuation, quotes, keys or values.
    """

    before_sha = hashlib.sha256(body.encode("utf-8")).hexdigest()
    out: list[str] = []
    in_string = False
    escaped = False
    i = 0
    removed = 0
    while i < len(body):
        ch = body[i]
        if ch in "\r\n":
            newline_start = i
            if ch == "\r" and i + 1 < len(body) and body[i + 1] == "\n":
                i += 2
            else:
                i += 1
            if in_string:
                while i < len(body) and body[i] in " \t":
                    i += 1
                removed += i - newline_start
                escaped = False
                continue
            out.append("\n")
            escaped = False
            continue
        out.append(ch)
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        i += 1
    normalized = "".join(out)
    transformations: list[dict[str, Any]] = []
    if normalized != body:
        transformations.append(
            {
                "kind": "REMOVE_TERMINAL_WRAP_BYTES_INSIDE_JSON_STRINGS",
                "removed_bytes": removed,
                "before_sha256": before_sha,
                "after_sha256": hashlib.sha256(normalized.encode("utf-8")).hexdigest(),
            }
        )
    return normalized, transformations


def _marked_candidates(
    text: str,
    start: str,
    end: str,
    *,
    provider: str | None = None,
) -> list[dict[str, Any]]:
    """Return complete marker pairs newest-to-oldest without editing bodies."""

    if provider == "claude_code" and start == RESULT_START:
        opening = re.compile(
            rf"(?m)^(?P<indent>[ \t]*)(?:(?P<claude>●)[ \t]+)?{re.escape(start)}[ \t]*$"
        )
    else:
        opening = re.compile(rf"(?m)^(?P<indent>[ \t]*){re.escape(start)}[ \t]*$")
    closing = re.compile(rf"(?m)^[ \t]*{re.escape(end)}[ \t]*$")
    values: list[dict[str, Any]] = []
    for match in opening.finditer(text):
        close = closing.search(text, match.end())
        if close is None:
            continue
        body = text[match.end():close.start()].strip("\r\n")
        values.append(
            {
                "start_offset": match.start(),
                "end_offset": close.end(),
                "opening_line": match.group(0),
                "opening_prefix": (
                    "CLAUDE_ASSISTANT_BULLET" if match.groupdict().get("claude") else "NONE"
                ),
                "body": body,
                "marked_block": text[match.start():close.end()],
            }
        )
    return list(reversed(values))


def _last_marked_block(text: str, start: str, end: str) -> str | None:
    """Compatibility helper: newest exact marker pair, with no provider chrome."""

    candidates = _marked_candidates(text, start, end)
    return candidates[0]["body"] if candidates else None


def extract_result_packet_with_provenance(
    text: str,
    phase: dict[str, Any],
    *,
    provider: str | None = None,
) -> tuple[dict[str, Any], str, dict[str, Any]]:
    """Validate the newest valid candidate while retaining rejected candidates.

    Complete marker pairs are evaluated newest-to-oldest.  Invalid prompt
    templates, malformed JSON and identity/status mismatches do not prevent a
    later/older valid candidate from being considered.  Claude's known
    assistant-response bullet is accepted only on the opening marker line.
    """

    candidates = _marked_candidates(text, RESULT_START, RESULT_END, provider=provider)
    rejected: list[dict[str, Any]] = []
    for newest_index, candidate in enumerate(candidates):
        raw_body = str(candidate["body"])
        parsed_body = raw_body
        transformations: list[dict[str, Any]] = []
        parse_mode = "STRICT_JSON"
        try:
            value = json.loads(parsed_body)
        except json.JSONDecodeError as strict_exc:
            parsed_body, transformations = _normalize_terminal_wrapped_json(raw_body)
            parse_mode = "TERMINAL_WRAP_INSIDE_JSON_STRINGS"
            try:
                value = json.loads(parsed_body)
            except json.JSONDecodeError as normalized_exc:
                rejected.append(
                    {
                        "candidate_newest_index": newest_index,
                        "start_offset": candidate["start_offset"],
                        "opening_prefix": candidate["opening_prefix"],
                        "raw_body_sha256": hashlib.sha256(raw_body.encode("utf-8")).hexdigest(),
                        "normalized_body_sha256": hashlib.sha256(parsed_body.encode("utf-8")).hexdigest(),
                        "error": (
                            "MLGO_RESULT_PACKET body is not JSON after syntax-aware terminal-wrap "
                            f"normalization: {normalized_exc}"
                        ),
                        "strict_error": str(strict_exc),
                        "transformations": transformations,
                    }
                )
                continue
        if not isinstance(value, dict):
            rejected.append(
                {
                    "candidate_newest_index": newest_index,
                    "start_offset": candidate["start_offset"],
                    "opening_prefix": candidate["opening_prefix"],
                    "error": "MLGO_RESULT_PACKET body must be a JSON object",
                }
            )
            continue
        status = value.get("status")
        if isinstance(status, str) and status.strip().lower().startswith("one of:"):
            rejected.append(
                {
                    "candidate_newest_index": newest_index,
                    "start_offset": candidate["start_offset"],
                    "opening_prefix": candidate["opening_prefix"],
                    "error": "PROMPT_RESULT_CONTRACT_TEMPLATE_REJECTED",
                    "raw_body_sha256": hashlib.sha256(raw_body.encode("utf-8")).hexdigest(),
                }
            )
            continue
        try:
            packet = validate_result_packet(value, phase)
        except ContractError as exc:
            rejected.append(
                {
                    "candidate_newest_index": newest_index,
                    "start_offset": candidate["start_offset"],
                    "opening_prefix": candidate["opening_prefix"],
                    "error": str(exc),
                    "raw_body_sha256": hashlib.sha256(raw_body.encode("utf-8")).hexdigest(),
                    "normalized_body_sha256": hashlib.sha256(parsed_body.encode("utf-8")).hexdigest(),
                    "transformations": transformations,
                }
            )
            continue
        provenance = {
            "candidate_count": len(candidates),
            "selected_candidate_newest_index": newest_index,
            "selected_start_offset": candidate["start_offset"],
            "selected_end_offset": candidate["end_offset"],
            "opening_line": candidate["opening_line"],
            "opening_prefix": candidate["opening_prefix"],
            "raw_body_sha256": hashlib.sha256(raw_body.encode("utf-8")).hexdigest(),
            "parsed_body_sha256": hashlib.sha256(parsed_body.encode("utf-8")).hexdigest(),
            "marked_block_sha256": hashlib.sha256(str(candidate["marked_block"]).encode("utf-8")).hexdigest(),
            "parse_mode": parse_mode,
            "transformations": transformations,
            "rejected_newer_candidates": rejected,
        }
        return packet, str(candidate["marked_block"]), provenance

    agy_candidates = _marked_candidates(text, AGY_START, AGY_END)
    if agy_candidates:
        agy_candidate = agy_candidates[0]
        agy = str(agy_candidate["body"])
        fields: dict[str, str] = {}
        current_key: str | None = None
        list_values: dict[str, list[str]] = {}
        for raw in agy.splitlines():
            line = raw.rstrip()
            if re.match(r"^[A-Za-z_][A-Za-z0-9_]*\s*:", line):
                key, value = line.split(":", 1)
                current_key = key.strip().lower()
                value = value.strip()
                if value:
                    fields[current_key] = value
                else:
                    list_values.setdefault(current_key, [])
            elif line.lstrip().startswith("-") and current_key:
                list_values.setdefault(current_key, []).append(line.lstrip()[1:].strip())
        packet = {
            "schema_version": "2.0",
            "run_id": phase["run_id"],
            "big_task_id": phase["big_task_id"],
            "phase_id": phase["phase_id"],
            "status": fields.get("status", "BLOCKED"),
            "changed_files": list_values.get("changed_files", []),
            "verification": list_values.get("verification", []),
            "assumptions_confirmed": list_values.get("assumptions", []),
            "assumptions_invalidated": [],
            "risks": list_values.get("risks", []),
            "next_action": fields.get("next_action", "Task Lead must inspect the preserved output."),
            "commit_sha": None,
            "reviewed_sha": None,
            "evidence": [],
            "provider_session_id": None,
            "cao_terminal_id": None,
            "model": None,
        }
        validated = validate_result_packet(packet, phase)
        return validated, str(agy_candidate["marked_block"]), {
            "candidate_count": len(agy_candidates),
            "selected_candidate_newest_index": 0,
            "opening_prefix": "NONE",
            "parse_mode": "LEGACY_AGY",
            "transformations": [],
            "rejected_newer_candidates": rejected,
        }

    if candidates:
        detail = "; ".join(str(item.get("error")) for item in rejected[:4])
        raise ResultPacketExtractionError(
            f"no valid MLGO_RESULT_PACKET candidate: {detail}",
            candidate_count=len(candidates),
            rejections=rejected,
        )
    raise ResultPacketExtractionError(
        "model output contains no complete MLGO_RESULT_PACKET or AGY_RESULT_PACKET",
        candidate_count=0,
        rejections=[],
    )


def extract_result_packet_with_block(
    text: str,
    phase: dict[str, Any],
    *,
    provider: str | None = None,
) -> tuple[dict[str, Any], str]:
    packet, marked, _ = extract_result_packet_with_provenance(
        text, phase, provider=provider
    )
    return packet, marked

def extract_result_packet(
    text: str, phase: dict[str, Any], *, provider: str | None = None
) -> dict[str, Any]:
    """Extract a JSON v2 packet or normalize the legacy AGY envelope."""

    packet, _ = extract_result_packet_with_block(text, phase, provider=provider)
    return packet


def result_packet_instructions(phase: dict[str, Any]) -> str:
    """Render a provider-usable result contract whose copied template is invalid.

    ``status`` remains an explicit invalid choice placeholder. ``next_action`` is
    JSON null in the template, which the validator rejects. The provider must
    replace both values. For a terminal PASS/NO_CHANGE with no follow-up, the
    contract supplies one concrete semantically meaningful sentence.
    """

    allowed_statuses = list(phase["result_contract"]["allowed_statuses"])
    allowed = ", ".join(allowed_statuses)
    review_pass_note = (
        "For a review phase with status PASS, set reviewed_sha to the exact full "
        "40-character lowercase Git SHA reviewed; otherwise leave reviewed_sha null. "
        if phase.get("phase_kind") == "review"
        else "Leave reviewed_sha null unless the phase contract explicitly requires a reviewed SHA. "
    )
    write_note = (
        "For READY_FOR_COMMIT, changed_files must list every changed relative path and must not be empty. "
        if phase.get("write_capable")
        else "This phase is read-only, so changed_files must remain an empty array. "
    )
    return f"""
End your final response with exactly one JSON result packet between these markers:

{RESULT_START}
{{
  "schema_version": "2.0",
  "run_id": {json.dumps(phase['run_id'])},
  "big_task_id": {json.dumps(phase['big_task_id'])},
  "phase_id": {json.dumps(phase['phase_id'])},
  "status": "one of: {allowed}",
  "changed_files": [],
  "verification": [],
  "assumptions_confirmed": [],
  "assumptions_invalidated": [],
  "risks": [],
  "next_action": null,
  "commit_sha": null,
  "reviewed_sha": null,
  "evidence": [],
  "provider_session_id": null,
  "cao_terminal_id": null,
  "model": null
}}
{RESULT_END}

Replace the status placeholder with exactly one allowed concrete status: {allowed}.
Replace next_action=null with one specific non-empty sentence describing the next host or operator action.
If status is PASS or NO_CHANGE and no follow-up is required, use exactly: {NO_FURTHER_ACTION}
{write_note}{review_pass_note}
Do not copy either placeholder literally. Do not omit required fields.
Do not place prose after the end marker.
""".strip()
