"""Host-owned semantic trigger classification and episodic authority ledger.

The Supervisor is *episodic*: it is contacted only when the host has already
decided, deterministically, that a genuine semantic decision is required.  This
module owns that decision.  It performs no model call and imports nothing that
can reach a provider, so a "hidden semantic call" cannot originate here.

Classification is intentionally narrow and evidence-driven.  A trigger class is
allowed only when the host supplies the exact structured evidence that class
requires; nothing is inferred from free text.  Everything else - polling,
routine callbacks, lifecycle transitions, Git mechanics, notifications,
deterministic accounting/routing and ordinary bounded test-failure handling - is
model-free by construction.

The default policy posture is shadow-only: episodes are recorded as durable
facts and never enforced against a live run until host enforcement is
separately proven.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    sha256_json,
    validate_id,
)

SEMANTIC_TRIGGER_SCHEMA_VERSION = "1.0"
AUTHORITY_EPISODE_SCHEMA_VERSION = "1.0"

#: Narrow allow-list.  Anything not named here is model-free.
TRIGGER_PROJECT_ARCHITECTURE = "PROJECT_OR_MILESTONE_ARCHITECTURE"
TRIGGER_MATERIAL_DECOMPOSITION = "MATERIAL_DECOMPOSITION"
TRIGGER_DIFFICULT_PLANNING = "EXPLICIT_DIFFICULT_OR_AMBIGUOUS_PLANNING"
TRIGGER_UNUSUAL_ERROR = "UNUSUAL_ERROR_AFTER_BOUNDED_ATTEMPTS"
TRIGGER_AUTHORITY_EXCEPTION = "AUTHORITY_SCOPE_RISK_OR_BUDGET_EXCEPTION"
TRIGGER_END_OF_TASK_CHALLENGE = "END_OF_TASK_SEMANTIC_CHALLENGE"

ALLOWED_TRIGGER_CLASSES = (
    TRIGGER_PROJECT_ARCHITECTURE,
    TRIGGER_MATERIAL_DECOMPOSITION,
    TRIGGER_DIFFICULT_PLANNING,
    TRIGGER_UNUSUAL_ERROR,
    TRIGGER_AUTHORITY_EXCEPTION,
    TRIGGER_END_OF_TASK_CHALLENGE,
)

#: Explicitly model-free event classes.  These never produce an episode.
NON_SEMANTIC_EVENT_CLASSES = (
    "POLLING",
    "NORMAL_CALLBACK",
    "LIFECYCLE_TRANSITION",
    "GIT_MECHANICS",
    "NOTIFICATION",
    "DETERMINISTIC_ACCOUNTING",
    "DETERMINISTIC_ROUTING",
    "BOUNDED_TEST_FAILURE_HANDLING",
)

ENFORCEMENT_SHADOW_ONLY = "shadow_only"
ENFORCEMENT_LIVE = "live"

EPISODE_OPEN = "OPEN"
EPISODE_RESOLVED = "RESOLVED"
EPISODE_PAUSED_ESCALATED = "PAUSED_ESCALATED"

DEFAULT_POLICY = {
    "enforcement_mode": ENFORCEMENT_SHADOW_ONLY,
    "allowed_trigger_classes": list(ALLOWED_TRIGGER_CLASSES),
    "bounded_attempt_floor": 3,
    "max_open_episodes_per_task": 3,
    "max_episodes_per_task": 6,
    "end_of_task_challenge_required_risk_tiers": ["HIGH", "CRITICAL"],
}


def trigger_policy(policy: dict[str, Any] | None) -> dict[str, Any]:
    cfg = dict(DEFAULT_POLICY)
    supplied = (policy or {}).get("semantic_triggers")
    if isinstance(supplied, dict):
        cfg.update({k: v for k, v in supplied.items() if k in DEFAULT_POLICY})
    mode = str(cfg["enforcement_mode"])
    if mode not in {ENFORCEMENT_SHADOW_ONLY, ENFORCEMENT_LIVE}:
        raise PolicyError(f"invalid semantic trigger enforcement mode: {mode!r}")
    unknown = sorted(set(cfg["allowed_trigger_classes"]) - set(ALLOWED_TRIGGER_CLASSES))
    if unknown:
        raise PolicyError(f"semantic trigger policy names unknown trigger classes: {unknown}")
    return cfg


class NonSemantic(dict):
    """A deterministic, model-free classification result."""


def _evidence_ids(event: dict[str, Any]) -> list[str]:
    refs = event.get("evidence_refs") or []
    if not isinstance(refs, list):
        raise ContractError("evidence_refs must be a list")
    out: list[str] = []
    for ref in refs:
        if isinstance(ref, str):
            out.append(ref)
        elif isinstance(ref, dict) and ref.get("id"):
            out.append(str(ref["id"]))
        else:
            raise ContractError("each evidence reference needs an id")
    return sorted(set(out))


def _requires(event: dict[str, Any], field: str, expected: object = True) -> bool:
    return event.get(field) == expected


def classify_event(event: dict[str, Any], policy: dict[str, Any] | None = None) -> dict[str, Any]:
    """Deterministically decide whether an event needs semantic authority.

    Returns either a ``semantic-trigger`` record or a :class:`NonSemantic`
    result.  This function is total, side-effect free and never calls a model.
    """

    cfg = trigger_policy(policy)
    if not isinstance(event, dict):
        raise ContractError("event must be an object")
    event_class = str(event.get("event_class") or "")
    if not event_class:
        raise ContractError("event_class is required for deterministic classification")

    if event_class in NON_SEMANTIC_EVENT_CLASSES:
        return NonSemantic(
            {
                "semantic_authority_required": False,
                "event_class": event_class,
                "reason": "event class is deterministic and model-free by policy",
                "classified_at": iso_now(),
            }
        )

    if event_class not in ALLOWED_TRIGGER_CLASSES:
        return NonSemantic(
            {
                "semantic_authority_required": False,
                "event_class": event_class,
                "reason": "event class is not in the allowed semantic trigger allow-list",
                "classified_at": iso_now(),
            }
        )

    if event_class not in set(cfg["allowed_trigger_classes"]):
        return NonSemantic(
            {
                "semantic_authority_required": False,
                "event_class": event_class,
                "reason": "trigger class is disabled by the active semantic trigger policy",
                "classified_at": iso_now(),
            }
        )

    # Each allowed class demands its own explicit, host-supplied evidence.  A
    # near miss on any predicate is model-free, not a trigger.
    reason: str | None = None
    if event_class in (TRIGGER_PROJECT_ARCHITECTURE, TRIGGER_MATERIAL_DECOMPOSITION):
        scope = str(event.get("decision_scope") or "")
        if scope not in {"project", "milestone"}:
            reason = "architecture/decomposition trigger requires a project or milestone decision scope"
        elif not _requires(event, "materially_affects_locked_architecture"):
            reason = "decomposition is not declared to materially affect the locked architecture"
    elif event_class == TRIGGER_DIFFICULT_PLANNING:
        if not _requires(event, "planning_difficulty_declared"):
            reason = "difficult/ambiguous planning must be explicitly declared by the host contract"
    elif event_class == TRIGGER_UNUSUAL_ERROR:
        attempts = int(event.get("bounded_attempts_used", 0))
        floor = int(cfg["bounded_attempt_floor"])
        if str(event.get("error_class") or "") != "UNUSUAL":
            reason = "error is classified as ordinary and is handled by bounded deterministic retry"
        elif attempts < floor:
            reason = f"bounded normal attempts are not exhausted ({attempts}/{floor})"
    elif event_class == TRIGGER_AUTHORITY_EXCEPTION:
        kind = str(event.get("exception_kind") or "")
        if kind not in {"authority", "scope", "risk", "budget"}:
            reason = "authority exception requires an explicit authority/scope/risk/budget kind"
    elif event_class == TRIGGER_END_OF_TASK_CHALLENGE:
        tier = str(event.get("risk_tier") or "")
        required = set(cfg["end_of_task_challenge_required_risk_tiers"])
        if not _requires(event, "task_complete"):
            reason = "end-of-task challenge requires a completed task"
        elif tier not in required:
            reason = f"risk policy does not require a semantic challenge at risk tier {tier!r}"

    if reason is not None:
        return NonSemantic(
            {
                "semantic_authority_required": False,
                "event_class": event_class,
                "reason": reason,
                "classified_at": iso_now(),
            }
        )

    evidence_ids = _evidence_ids(event)
    if not evidence_ids:
        return NonSemantic(
            {
                "semantic_authority_required": False,
                "event_class": event_class,
                "reason": "a semantic trigger requires at least one durable evidence reference",
                "classified_at": iso_now(),
            }
        )

    dedupe_source = {
        "run_id": event.get("run_id"),
        "task_id": event.get("task_id"),
        "trigger_class": event_class,
        "subject_id": event.get("subject_id"),
    }
    record = {
        "schema_version": SEMANTIC_TRIGGER_SCHEMA_VERSION,
        "trigger_class": event_class,
        "run_id": event.get("run_id"),
        "task_id": event.get("task_id"),
        "subject_id": event.get("subject_id"),
        "decision_scope": event.get("decision_scope"),
        "initiator": str(event.get("initiator") or "host"),
        "evidence_ids": evidence_ids,
        "dedupe_key": sha256_json(dedupe_source),
        "enforcement_mode": cfg["enforcement_mode"],
        "semantic_authority_required": True,
        "classified_by": "host_deterministic_classifier",
        "classified_at": iso_now(),
    }
    record["trigger_digest"] = sha256_json({k: v for k, v in record.items() if k != "trigger_digest"})
    return record


class EpisodeLedger:
    """Durable episode facts with coalescing and a bounded episode ceiling."""

    def __init__(self, run_v2_dir: str | Path, *, policy: dict[str, Any] | None = None):
        self.root = Path(run_v2_dir) / "authority" / "episodes"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = self.root / ".episodes.lock"
        self.index_path = self.root / "index.json"
        self.policy = trigger_policy(policy)

    # -- internals ---------------------------------------------------------

    def _index(self) -> dict[str, Any]:
        if not self.index_path.exists():
            return {"schema_version": "1.0", "by_dedupe_key": {}, "by_task": {}}
        return load_json(self.index_path)

    def path(self, episode_id: str) -> Path:
        validate_id(episode_id, "episode_id")
        return self.root / f"{episode_id}.json"

    def load(self, episode_id: str) -> dict[str, Any] | None:
        path = self.path(episode_id)
        return load_json(path) if path.exists() else None

    def list_for_task(self, task_id: str) -> list[dict[str, Any]]:
        index = self._index()
        return [
            record
            for record in (self.load(eid) for eid in index.get("by_task", {}).get(task_id, []))
            if record is not None
        ]

    # -- API ---------------------------------------------------------------

    def record_event(
        self,
        event: dict[str, Any],
        *,
        episode_id: str | None = None,
        authority_role: str = "authoritative_supervisor",
        authority_mode: str = "CONSULT",
        budget_decision: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Classify one host event and open, coalesce or decline an episode."""

        trigger = classify_event(event, {"semantic_triggers": self.policy})
        if not trigger.get("semantic_authority_required"):
            return {
                "episode": None,
                "episode_opened": False,
                "semantic_authority_required": False,
                "semantic_calls_requested": 0,
                "trigger": dict(trigger),
            }

        task_id = str(event.get("task_id") or "")
        validate_id(task_id, "task_id")
        dedupe_key = trigger["dedupe_key"]

        with file_lock(self.lock):
            index = self._index()
            by_key = index.setdefault("by_dedupe_key", {})
            by_task = index.setdefault("by_task", {})

            existing_id = by_key.get(dedupe_key)
            if existing_id:
                existing = self.load(existing_id)
                if existing is None:
                    raise ContractError(f"episode index references a missing record: {existing_id}")
                if existing["status"] == EPISODE_OPEN:
                    # Repeated unresolved trigger keys coalesce; the duplicate is
                    # an audit no-op that never opens a second episode and never
                    # requests a second semantic call.
                    existing["coalesced_event_count"] = int(existing.get("coalesced_event_count", 0)) + 1
                    existing["coalesced_evidence_ids"] = sorted(
                        set(existing.get("coalesced_evidence_ids", [])) | set(trigger["evidence_ids"])
                    )
                    existing["updated_at"] = iso_now()
                    atomic_write_json(self.path(existing_id), existing)
                    return {
                        "episode": existing,
                        "episode_opened": False,
                        "coalesced": True,
                        "duplicate_no_op": True,
                        "semantic_authority_required": True,
                        "semantic_calls_requested": 0,
                        "trigger": trigger,
                    }

            task_episodes = by_task.setdefault(task_id, [])
            open_count = 0
            for eid in task_episodes:
                record = self.load(eid)
                if record and record.get("status") == EPISODE_OPEN:
                    open_count += 1
            maximum_total = int(self.policy["max_episodes_per_task"])
            maximum_open = int(self.policy["max_open_episodes_per_task"])
            if len(task_episodes) >= maximum_total or open_count >= maximum_open:
                # A required semantic decision beyond the configured ceiling must
                # pause and escalate.  It is never silently continued without
                # authority.
                escalation_id = episode_id or f"epi-{dedupe_key[:16]}-{len(task_episodes) + 1}"
                escalation = {
                    "schema_version": AUTHORITY_EPISODE_SCHEMA_VERSION,
                    "episode_id": escalation_id,
                    "run_id": trigger.get("run_id"),
                    "task_id": task_id,
                    "trigger_class": trigger["trigger_class"],
                    "trigger_digest": trigger["trigger_digest"],
                    "dedupe_key": dedupe_key,
                    "evidence_ids": trigger["evidence_ids"],
                    "initiator": trigger["initiator"],
                    "authority_role": authority_role,
                    "authority_mode": "ESCALATE",
                    "budget_decision": budget_decision,
                    "enforcement_mode": self.policy["enforcement_mode"],
                    "status": EPISODE_PAUSED_ESCALATED,
                    "outcome": "EPISODE_LIMIT_EXCEEDED_PAUSED_FOR_HIGHER_AUTHORITY",
                    "limit_kind": "max_episodes_per_task" if len(task_episodes) >= maximum_total else "max_open_episodes_per_task",
                    "episodes_used": len(task_episodes),
                    "open_episodes": open_count,
                    "maximum_episodes": maximum_total,
                    "maximum_open_episodes": maximum_open,
                    "coalesced_event_count": 0,
                    "coalesced_evidence_ids": [],
                    "created_at": iso_now(),
                    "updated_at": iso_now(),
                }
                escalation["episode_digest"] = sha256_json(
                    {k: v for k, v in escalation.items() if k != "episode_digest"}
                )
                atomic_write_json(self.path(escalation_id), escalation)
                task_episodes.append(escalation_id)
                by_key.setdefault(dedupe_key, escalation_id)
                atomic_write_json(self.index_path, index)
                return {
                    "episode": escalation,
                    "episode_opened": False,
                    "paused": True,
                    "escalated": True,
                    "silently_continued": False,
                    "semantic_authority_required": True,
                    "semantic_calls_requested": 0,
                    "trigger": trigger,
                }

            new_id = episode_id or f"epi-{dedupe_key[:16]}-{len(task_episodes) + 1}"
            validate_id(new_id, "episode_id")
            if self.path(new_id).exists():
                raise PolicyError(f"episode record already exists and is immutable: {new_id}")
            record = {
                "schema_version": AUTHORITY_EPISODE_SCHEMA_VERSION,
                "episode_id": new_id,
                "run_id": trigger.get("run_id"),
                "task_id": task_id,
                "trigger_class": trigger["trigger_class"],
                "trigger_digest": trigger["trigger_digest"],
                "dedupe_key": dedupe_key,
                "evidence_ids": trigger["evidence_ids"],
                "initiator": trigger["initiator"],
                "authority_role": authority_role,
                "authority_mode": authority_mode,
                "budget_decision": budget_decision,
                "enforcement_mode": self.policy["enforcement_mode"],
                "status": EPISODE_OPEN,
                "outcome": None,
                "coalesced_event_count": 0,
                "coalesced_evidence_ids": [],
                "created_at": iso_now(),
                "updated_at": iso_now(),
            }
            record["episode_digest"] = sha256_json(
                {k: v for k, v in record.items() if k != "episode_digest"}
            )
            atomic_write_json(self.path(new_id), record)
            task_episodes.append(new_id)
            by_key[dedupe_key] = new_id
            atomic_write_json(self.index_path, index)
            return {
                "episode": record,
                "episode_opened": True,
                "coalesced": False,
                "semantic_authority_required": True,
                # Shadow-only records the need for exactly one semantic call; it
                # does not itself perform one.
                "semantic_calls_requested": 1,
                "live_enforced": self.policy["enforcement_mode"] == ENFORCEMENT_LIVE,
                "trigger": trigger,
            }

    def resolve(self, episode_id: str, *, outcome: str, decision_id: str | None = None) -> dict[str, Any]:
        with file_lock(self.lock):
            record = self.load(episode_id)
            if record is None:
                raise PolicyError(f"unknown episode: {episode_id}")
            if record["status"] != EPISODE_OPEN:
                return {**record, "duplicate_resolution": True}
            record["status"] = EPISODE_RESOLVED
            record["outcome"] = outcome
            record["decision_id"] = decision_id
            record["resolved_at"] = iso_now()
            record["updated_at"] = iso_now()
            atomic_write_json(self.path(episode_id), record)
            return record

    def counters(self, task_id: str) -> dict[str, Any]:
        records = self.list_for_task(task_id)
        return {
            "task_id": task_id,
            "episodes": len(records),
            "open": sum(1 for r in records if r["status"] == EPISODE_OPEN),
            "resolved": sum(1 for r in records if r["status"] == EPISODE_RESOLVED),
            "paused_escalated": sum(1 for r in records if r["status"] == EPISODE_PAUSED_ESCALATED),
            "semantic_calls_requested": sum(1 for r in records if r["status"] != EPISODE_PAUSED_ESCALATED),
        }
