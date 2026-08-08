"""State-bound authority requests, decisions and exactly-once application.

Every authority request binds the exact revisions it was asked against:

* run/task state revision (state version),
* context manifest digest,
* checkpoint digest,
* delegation/charter revision,
* the requested authority mode and scope.

A decision may be applied only if all of those still hold.  If anything moved
while the request was in flight the decision is recorded as ``STALE_DECISION``
with zero state mutation and zero worker/provider dispatch, and any reconsult
must use a fresh request ID.

Mode semantics are hard boundaries, not conventions:

* ``CONSULT`` is advice.  The Tech Lead retains authority.  A CONSULT response
  can never be applied as a binding decision.
* ``ADJUDICATE`` is a bounded binding decision strictly inside the delegated
  scope, applied exactly once under a compare-and-set on the state version.
* ``ESCALATE`` is outside the Tech Lead's delegated scope.  It is never
  converted locally into a decision; only durable escalation facts are written.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

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

CONSULT_REQUEST_SCHEMA_VERSION = "1.0"
DECISION_SCHEMA_VERSION = "1.0"

MODE_CONSULT = "CONSULT"
MODE_ADJUDICATE = "ADJUDICATE"
MODE_ESCALATE = "ESCALATE"
AUTHORITY_MODES = (MODE_CONSULT, MODE_ADJUDICATE, MODE_ESCALATE)

APPLIED = "APPLIED"
ADVISORY_RECORDED = "ADVISORY_RECORDED"
ESCALATION_RECORDED = "ESCALATION_RECORDED"
STALE_DECISION = "STALE_DECISION"

BINDING_FIELDS = (
    "state_revision",
    "context_manifest_digest",
    "checkpoint_digest",
    "delegation_revision",
    "charter_revision",
)


def new_authority_request(
    *,
    request_id: str,
    run_id: str,
    task_id: str,
    big_task_id: str,
    requester_role: str,
    authority_role: str,
    mode: str,
    requested_scope: list[str],
    state_revision: int,
    context_manifest_digest: str,
    checkpoint_digest: str,
    delegation_revision: str,
    charter_revision: str,
    delegated_scope: list[str],
    question: str,
    evidence_refs: list[dict[str, Any]] | None = None,
    episode_id: str | None = None,
    supersedes_request_id: str | None = None,
) -> dict[str, Any]:
    validate_id(request_id, "request_id")
    validate_id(run_id, "run_id")
    validate_id(task_id, "task_id")
    if mode not in AUTHORITY_MODES:
        raise ContractError(f"unknown authority mode: {mode!r}")
    if not requested_scope:
        raise ContractError("an authority request must state its requested scope")
    if mode == MODE_ADJUDICATE and not set(requested_scope).issubset(set(delegated_scope)):
        raise PolicyError(
            "ADJUDICATE may not be requested outside the delegated scope: "
            f"{sorted(set(requested_scope) - set(delegated_scope))}"
        )
    if mode == MODE_ESCALATE and set(requested_scope).issubset(set(delegated_scope)):
        raise PolicyError("ESCALATE is only for decisions outside the Tech Lead delegated scope")
    record = {
        "schema_version": CONSULT_REQUEST_SCHEMA_VERSION,
        "request_id": request_id,
        "run_id": run_id,
        "task_id": task_id,
        "big_task_id": big_task_id,
        "requester_role": requester_role,
        "authority_role": authority_role,
        "mode": mode,
        "requested_scope": sorted(set(requested_scope)),
        "delegated_scope": sorted(set(delegated_scope)),
        "state_revision": int(state_revision),
        "context_manifest_digest": context_manifest_digest,
        "checkpoint_digest": checkpoint_digest,
        "delegation_revision": delegation_revision,
        "charter_revision": charter_revision,
        "question": question,
        "evidence_refs": list(evidence_refs or []),
        "episode_id": episode_id,
        "supersedes_request_id": supersedes_request_id,
        "authority_retained_by": "tech_lead" if mode == MODE_CONSULT else None,
        "created_at": iso_now(),
    }
    record["binding_digest"] = sha256_json({field: record[field] for field in BINDING_FIELDS})
    record["request_digest"] = sha256_json({k: v for k, v in record.items() if k != "request_digest"})
    return record


def new_decision(
    *,
    decision_id: str,
    request: dict[str, Any],
    outcome: str,
    applied_scope: list[str] | None = None,
    rationale_digest: str | None = None,
    advice: str | None = None,
    decided_by: str | None = None,
) -> dict[str, Any]:
    """Build the authority response bound to the exact request it answers."""

    validate_id(decision_id, "decision_id")
    for field in ("request_id", "mode") + BINDING_FIELDS:
        if field not in request:
            raise ContractError(f"authority request missing {field}")
    mode = request["mode"]
    scope = sorted(set(applied_scope if applied_scope is not None else request["requested_scope"]))
    record = {
        "schema_version": DECISION_SCHEMA_VERSION,
        "decision_id": decision_id,
        "request_id": request["request_id"],
        "run_id": request.get("run_id"),
        "task_id": request.get("task_id"),
        "mode": mode,
        "outcome": outcome,
        "advice": advice,
        "applied_scope": scope,
        "requested_scope": list(request["requested_scope"]),
        "state_revision": int(request["state_revision"]),
        "context_manifest_digest": request["context_manifest_digest"],
        "checkpoint_digest": request["checkpoint_digest"],
        "delegation_revision": request["delegation_revision"],
        "charter_revision": request["charter_revision"],
        "request_binding_digest": request["binding_digest"],
        "rationale_digest": rationale_digest,
        "decided_by": decided_by or request.get("authority_role"),
        "binding": mode == MODE_ADJUDICATE,
        "authority_retained_by": "tech_lead" if mode == MODE_CONSULT else None,
        "created_at": iso_now(),
    }
    record["decision_digest"] = sha256_json({k: v for k, v in record.items() if k != "decision_digest"})
    return record


def validate_decision(decision: dict[str, Any]) -> dict[str, Any]:
    """Reject a decision whose content was altered after it was issued."""

    if decision.get("schema_version") != DECISION_SCHEMA_VERSION:
        raise ContractError(f"unsupported decision schema version: {decision.get('schema_version')!r}")
    if "decision_digest" not in decision:
        raise ContractError("decision missing decision_digest")
    volatile = {"status", "applied_at_state_revision", "observed_revisions", "application_result",
                "state_mutations", "worker_dispatches", "recorded_at", "duplicate", "applied"}
    check = {k: v for k, v in decision.items() if k not in volatile and k != "decision_digest"}
    if decision["decision_digest"] != sha256_json(check):
        raise PolicyError("decision digest mismatch: the response was altered after it was issued")
    return decision


class StaleDecision(PolicyError):
    """The bound revisions moved before the response arrived."""


class DecisionLedger:
    """Durable, immutable authority records with exactly-once application."""

    def __init__(self, run_v2_dir: str | Path):
        self.root = Path(run_v2_dir) / "authority"
        self.requests_dir = self.root / "requests"
        self.decisions_dir = self.root / "decisions"
        self.escalations_dir = self.root / "escalations"
        for directory in (self.requests_dir, self.decisions_dir, self.escalations_dir):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.lock = self.root / ".authority.lock"

    # -- storage -----------------------------------------------------------

    def request_path(self, request_id: str) -> Path:
        validate_id(request_id, "request_id")
        return self.requests_dir / f"{request_id}.json"

    def decision_path(self, decision_id: str) -> Path:
        validate_id(decision_id, "decision_id")
        return self.decisions_dir / f"{decision_id}.json"

    def load_request(self, request_id: str) -> dict[str, Any] | None:
        path = self.request_path(request_id)
        return load_json(path) if path.exists() else None

    def load_decision(self, decision_id: str) -> dict[str, Any] | None:
        path = self.decision_path(decision_id)
        return load_json(path) if path.exists() else None

    def open_request(self, request: dict[str, Any]) -> dict[str, Any]:
        """Persist one immutable request.  Request IDs are never reused."""

        path = self.request_path(request["request_id"])
        with file_lock(self.lock):
            if path.exists():
                existing = load_json(path)
                if existing.get("request_digest") != request.get("request_digest"):
                    raise PolicyError(
                        "authority request ID reused with different bound revisions; "
                        "a reconsult must use a fresh request ID"
                    )
                return existing
            atomic_write_json(path, request)
            return request

    # -- application -------------------------------------------------------

    def _record_stale(
        self,
        decision: dict[str, Any],
        *,
        reason: str,
        observed: dict[str, Any],
    ) -> dict[str, Any]:
        record = {
            "schema_version": DECISION_SCHEMA_VERSION,
            "decision_id": decision["decision_id"],
            "request_id": decision["request_id"],
            "status": STALE_DECISION,
            "reason": reason,
            "bound_revisions": {field: decision.get(field) for field in BINDING_FIELDS},
            "observed_revisions": observed,
            "state_mutations": 0,
            "worker_dispatches": 0,
            "provider_dispatches": 0,
            "requires_fresh_request_id": True,
            "recorded_at": iso_now(),
        }
        atomic_write_json(self.decisions_dir / f"{decision['decision_id']}.stale.json", record)
        return record

    def record_consult(self, decision: dict[str, Any]) -> dict[str, Any]:
        """Store advisory output.  Advice never mutates state by itself."""

        validate_decision(decision)
        if decision.get("mode") != MODE_CONSULT:
            raise ContractError("record_consult accepts only CONSULT responses")
        path = self.decision_path(decision["decision_id"])
        with file_lock(self.lock):
            if path.exists():
                return {**load_json(path), "duplicate": True}
            record = {
                **decision,
                "status": ADVISORY_RECORDED,
                "binding": False,
                "authority_retained_by": "tech_lead",
                "state_mutations": 0,
                "worker_dispatches": 0,
                "recorded_at": iso_now(),
            }
            atomic_write_json(path, record)
            return record

    def record_escalation(self, decision_or_request: dict[str, Any], *, facts: dict[str, Any]) -> dict[str, Any]:
        """Store durable escalation facts for project/milestone authority."""

        request_id = decision_or_request.get("request_id")
        validate_id(str(request_id), "request_id")
        path = self.escalations_dir / f"{request_id}.json"
        with file_lock(self.lock):
            if path.exists():
                return {**load_json(path), "duplicate": True}
            record = {
                "schema_version": "1.0",
                "request_id": request_id,
                "run_id": decision_or_request.get("run_id"),
                "task_id": decision_or_request.get("task_id"),
                "status": ESCALATION_RECORDED,
                "mode": MODE_ESCALATE,
                "requested_scope": decision_or_request.get("requested_scope"),
                "delegated_scope": decision_or_request.get("delegated_scope"),
                "bound_revisions": {
                    field: decision_or_request.get(field) for field in BINDING_FIELDS
                },
                "facts": facts,
                "locally_converted_to_decision": False,
                "state_mutations": 0,
                "worker_dispatches": 0,
                "recorded_at": iso_now(),
            }
            atomic_write_json(path, record)
            return record

    def apply_decision(
        self,
        decision: dict[str, Any],
        *,
        current_state_revision: int,
        current_delegation_revision: str,
        current_charter_revision: str,
        current_context_manifest_digest: str | None = None,
        current_checkpoint_digest: str | None = None,
        applier: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Apply exactly one valid ADJUDICATE decision under a state CAS."""

        for field in ("decision_id", "request_id", "mode") + BINDING_FIELDS:
            if field not in decision:
                raise ContractError(f"decision missing {field}")

        validate_decision(decision)
        request = self.load_request(decision["request_id"])
        if request is None:
            raise PolicyError(f"decision references an unknown authority request: {decision['request_id']}")
        if decision.get("request_binding_digest") != request.get("binding_digest"):
            raise PolicyError("decision is not bound to the exact revisions of its request")
        # A response may never claim a stronger authority mode than the request
        # that was actually asked; relabelling advice is not adjudication.
        if decision["mode"] != request["mode"]:
            raise PolicyError(
                f"decision mode {decision['mode']!r} does not match the authority mode requested "
                f"({request['mode']!r}); advisory output cannot be relabelled as binding"
            )

        mode = decision["mode"]
        if mode == MODE_CONSULT:
            raise PolicyError(
                "a CONSULT response is advisory and cannot be applied as a binding ADJUDICATE decision"
            )
        if mode == MODE_ESCALATE:
            raise PolicyError(
                "an ESCALATE response cannot be locally converted into a bounded decision; "
                "record durable escalation facts for project/milestone authority instead"
            )
        if mode != MODE_ADJUDICATE:
            raise ContractError(f"unknown authority mode: {mode!r}")

        # Scope: never beyond what was requested, never beyond what was delegated.
        applied = set(decision.get("applied_scope") or [])
        requested = set(request.get("requested_scope") or [])
        delegated = set(request.get("delegated_scope") or [])
        if not applied:
            raise ContractError("an ADJUDICATE decision must state the scope it applies to")
        if not applied.issubset(requested):
            raise PolicyError(
                f"ADJUDICATE decision exceeds the requested scope: {sorted(applied - requested)}"
            )
        if not applied.issubset(delegated):
            raise PolicyError(
                f"ADJUDICATE decision exceeds the delegated scope: {sorted(applied - delegated)}"
            )

        observed = {
            "state_revision": int(current_state_revision),
            "delegation_revision": current_delegation_revision,
            "charter_revision": current_charter_revision,
            "context_manifest_digest": current_context_manifest_digest,
            "checkpoint_digest": current_checkpoint_digest,
        }

        with file_lock(self.lock):
            path = self.decision_path(decision["decision_id"])
            if path.exists():
                # Duplicate delivery of an already-applied decision is a no-op.
                return {**load_json(path), "duplicate": True, "applied": False}
            previous_stale = self.stale_record(decision["decision_id"])
            if previous_stale is not None:
                # A decision that was once stale stays stale forever, even if the
                # bound revisions happen to look current again later.
                raise PolicyError(
                    f"decision {decision['decision_id']!r} was already recorded STALE_DECISION; "
                    "a reconsult must use a fresh request ID and a fresh decision"
                )

            if int(decision["state_revision"]) != int(current_state_revision):
                return self._record_stale(
                    decision,
                    reason=(
                        "run state advanced from the bound revision "
                        f"{decision['state_revision']} to {current_state_revision} before the response arrived"
                    ),
                    observed=observed,
                )
            if decision["delegation_revision"] != current_delegation_revision:
                return self._record_stale(
                    decision,
                    reason="delegation revision changed before the response arrived",
                    observed=observed,
                )
            if decision["charter_revision"] != current_charter_revision:
                return self._record_stale(
                    decision,
                    reason="charter revision changed before the response arrived",
                    observed=observed,
                )
            if (
                current_context_manifest_digest is not None
                and decision["context_manifest_digest"] != current_context_manifest_digest
            ):
                return self._record_stale(
                    decision,
                    reason="bound context manifest changed before the response arrived",
                    observed=observed,
                )
            if (
                current_checkpoint_digest is not None
                and decision["checkpoint_digest"] != current_checkpoint_digest
            ):
                return self._record_stale(
                    decision,
                    reason="bound checkpoint changed before the response arrived",
                    observed=observed,
                )

            result = applier(decision) if applier is not None else {"applied": True}
            record = {
                **decision,
                "status": APPLIED,
                "applied_at_state_revision": int(current_state_revision),
                "observed_revisions": observed,
                "application_result": result,
                "state_mutations": 1,
                "recorded_at": iso_now(),
            }
            atomic_write_json(path, record)
            return {**record, "duplicate": False, "applied": True}

    def stale_record(self, decision_id: str) -> dict[str, Any] | None:
        path = self.decisions_dir / f"{decision_id}.stale.json"
        return load_json(path) if path.exists() else None
