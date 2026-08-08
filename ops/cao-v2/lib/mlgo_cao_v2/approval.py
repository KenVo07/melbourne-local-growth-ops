"""Immutable ApprovalIntent / ApprovalDecision / ApprovalApplication contracts.

An approval is only ever meaningful relative to the exact authority context it
was asked in.  The failure mode this module exists to prevent is a decision that
outlives that context: a decision issued for project A being replayed against a
synthetically identical project B, a decision issued against policy revision 7
being applied after the policy moved to revision 8, or a decision for one
Command being reused for the next Command that happens to look similar.

Every record therefore carries its bindings *inside the digested content*, and
`revalidate_before_application` re-proves all of them immediately before the
adapter is allowed to touch anything.  There is no code path that applies a
decision without that re-proof.

Nothing in this module decides anything.  Policy evaluation lives in
``approval_broker``; provider mechanics live in ``permission_adapter``.  This
module owns only the shape of the facts and the exactness of their binding, so
that both of those layers are forced to speak in bound, digested terms.
"""

from __future__ import annotations

import copy
from typing import Any, Iterable, Mapping

from .common import (
    ContractError,
    PolicyError,
    iso_now,
    parse_iso,
    sha256_json,
    validate_id,
)

APPROVAL_INTENT_SCHEMA_VERSION = "1.0"
APPROVAL_DECISION_SCHEMA_VERSION = "1.0"
APPROVAL_APPLICATION_SCHEMA_VERSION = "1.0"
APPROVAL_GRANT_SCHEMA_VERSION = "1.0"

# -- decision outcomes ------------------------------------------------------

APPROVED_BY_POLICY = "APPROVED_BY_POLICY"
APPROVED_BY_DELEGATION = "APPROVED_BY_DELEGATION"
DENIED_BY_POLICY = "DENIED_BY_POLICY"
ESCALATED_FOR_AUTHORITY = "ESCALATED_FOR_AUTHORITY"
DECISION_OUTCOMES = (
    APPROVED_BY_POLICY,
    APPROVED_BY_DELEGATION,
    DENIED_BY_POLICY,
    ESCALATED_FOR_AUTHORITY,
)
APPROVING_OUTCOMES = (APPROVED_BY_POLICY, APPROVED_BY_DELEGATION)

# -- authority classes ------------------------------------------------------

AUTHORITY_HOST_POLICY = "HOST_POLICY"
AUTHORITY_TECH_LEAD = "TECH_LEAD"
AUTHORITY_SUPERVISOR = "SUPERVISOR"
AUTHORITY_OPERATOR = "OPERATOR"
AUTHORITY_CLASSES = (
    AUTHORITY_HOST_POLICY,
    AUTHORITY_TECH_LEAD,
    AUTHORITY_SUPERVISOR,
    AUTHORITY_OPERATOR,
)

#: Strictly increasing authority strength.  An escalation naming a level may
#: never be satisfied by anything below it, which is what stops a Tech Lead
#: decision from closing a Supervisor- or operator-level request.
AUTHORITY_RANK = {
    AUTHORITY_HOST_POLICY: 0,
    AUTHORITY_TECH_LEAD: 1,
    AUTHORITY_SUPERVISOR: 2,
    AUTHORITY_OPERATOR: 3,
}

# -- observed application states -------------------------------------------

NOT_REQUIRED = "NOT_REQUIRED"
PREAUTHORIZED = "PREAUTHORIZED"
WAITING_FOR_APPROVAL = "WAITING_FOR_APPROVAL"
APPROVED = "APPROVED"
DENIED = "DENIED"
UNKNOWN_RECONCILIATION_REQUIRED = "UNKNOWN_RECONCILIATION_REQUIRED"
OBSERVED_STATES = (
    NOT_REQUIRED,
    PREAUTHORIZED,
    WAITING_FOR_APPROVAL,
    APPROVED,
    DENIED,
    UNKNOWN_RECONCILIATION_REQUIRED,
)

#: States in which the worker is definitively *not* making progress.  Health
#: reporting derives ``WAITING_FOR_APPROVAL`` from this set and durable CAO
#: state only - never from terminal liveness or provider prompt text.
BLOCKED_STATES = (WAITING_FOR_APPROVAL, UNKNOWN_RECONCILIATION_REQUIRED)

#: Every field whose drift must invalidate a decision before application.  The
#: list is deliberately explicit rather than derived: adding a binding to the
#: intent without adding it here would silently create a replay window.
REVALIDATED_BINDINGS = (
    "project_id",
    "security_domain_id",
    "run_id",
    "work_package_id",
    "task_id",
    "attempt_id",
    "command_id",
    "repo_id",
    "worktree_id",
    "owned_scope_digest",
    "expected_pre_state_digest",
    "operation_class",
    "operation_name",
    "arguments_digest",
    "policy_revision",
    "registry_revision",
    "delegation_revision",
    "skill_contract_digest",
    "executor_epoch",
)


class ApprovalBindingError(PolicyError):
    """Raised when an approval record no longer matches its authority context."""


#: Bookkeeping keys that stores and callers attach *around* a record without
#: changing the fact it states.  They are excluded from every digest so that
#: passing a stored record back through validation is not mistaken for
#: tampering - while any change to a bound field still is.
VOLATILE_KEYS = frozenset({
    "duplicate",
    "duplicate_reason",
    "applied",
    "status",
    "recorded_at",
    "reconciled_at",
    "revoked_at",
    "revocation_reason",
})


def _digest_of(record: Mapping[str, Any], *, exclude: Iterable[str]) -> str:
    skip = set(exclude) | VOLATILE_KEYS
    return sha256_json({k: v for k, v in record.items() if k not in skip})


def normalize_arguments(arguments: Mapping[str, Any] | None) -> dict[str, Any]:
    """Produce the canonical argument form that a decision is bound to.

    Normalization is intentionally shallow-but-total: values are canonicalised
    through the same JSON digest path used everywhere else, and key order is
    irrelevant.  What it must never do is *drop* an argument, because an
    argument the broker did not see is an argument the operator never approved.
    """

    if arguments is None:
        return {}
    if not isinstance(arguments, Mapping):
        raise ContractError("normalized_arguments must be an object")
    out: dict[str, Any] = {}
    for key, value in arguments.items():
        if not isinstance(key, str) or not key.strip():
            raise ContractError("argument names must be non-empty strings")
        out[key.strip()] = copy.deepcopy(value)
    return dict(sorted(out.items()))


def normalize_resource_refs(resource_refs: Iterable[Mapping[str, Any]] | None) -> list[dict[str, Any]]:
    """Canonicalise the exact resources an operation may touch.

    Resources are sorted and de-duplicated so that two intents describing the
    same effect digest identically, which is what makes idempotent re-delivery
    detectable rather than merely likely.
    """

    refs: list[dict[str, Any]] = []
    for ref in resource_refs or []:
        if not isinstance(ref, Mapping):
            raise ContractError("each resource reference must be an object")
        kind = str(ref.get("kind") or "").strip()
        locator = str(ref.get("locator") or "").strip()
        if not kind or not locator:
            raise ContractError("a resource reference requires kind and locator")
        refs.append({"kind": kind, "locator": locator})
    unique = {sha256_json(ref): ref for ref in refs}
    return [unique[key] for key in sorted(unique)]


def namespace_key(*, project_id: str, security_domain_id: str) -> str:
    """The isolation boundary every approval and skill record is filed under.

    Project and security domain are combined into one opaque digest rather than
    a path join so that two projects whose IDs differ only by a separator
    character cannot produce the same namespace.
    """

    validate_id(project_id, "project_id")
    validate_id(security_domain_id, "security_domain_id")
    return sha256_json({"project_id": project_id, "security_domain_id": security_domain_id})


def new_approval_intent(
    *,
    approval_request_id: str,
    project_id: str,
    security_domain_id: str,
    run_id: str,
    work_package_id: str,
    task_id: str,
    attempt_id: str,
    command_id: str,
    actor_role: str,
    execution_agent_id: str,
    provider_profile_id: str | None,
    repo_id: str,
    worktree_id: str,
    owned_scope_digest: str,
    expected_pre_state_digest: str,
    operation_class: str,
    operation_name: str,
    normalized_arguments: Mapping[str, Any] | None,
    resource_refs: Iterable[Mapping[str, Any]] | None,
    policy_revision: str,
    registry_revision: str,
    delegation_revision: str,
    skill_contract_digest: str,
    executor_epoch: int | None = None,
    created_at: str | None = None,
    expires_at: str | None = None,
    idempotency_key: str | None = None,
    one_shot: bool = True,
) -> dict[str, Any]:
    """Build one normalized, host-produced approval intent.

    The intent is produced by the host from facts the host already holds.  It is
    never assembled from worker-supplied prose, because an operation class the
    worker chose for itself is not a constraint on the worker.
    """

    for label, value in (
        ("approval_request_id", approval_request_id),
        ("project_id", project_id),
        ("security_domain_id", security_domain_id),
        ("run_id", run_id),
        ("work_package_id", work_package_id),
        ("task_id", task_id),
        ("attempt_id", attempt_id),
        ("command_id", command_id),
    ):
        validate_id(value, label)

    if not isinstance(operation_class, str) or not operation_class.strip():
        raise ContractError("operation_class must be a non-empty string")
    if not isinstance(operation_name, str) or not operation_name.strip():
        raise ContractError("operation_name must be a non-empty string")

    arguments = normalize_arguments(normalized_arguments)
    refs = normalize_resource_refs(resource_refs)

    intent = {
        "schema_version": APPROVAL_INTENT_SCHEMA_VERSION,
        "approval_request_id": approval_request_id,
        "project_id": project_id,
        "security_domain_id": security_domain_id,
        "namespace_key": namespace_key(
            project_id=project_id, security_domain_id=security_domain_id
        ),
        "run_id": run_id,
        "work_package_id": work_package_id,
        "task_id": task_id,
        "attempt_id": attempt_id,
        "command_id": command_id,
        "actor_role": actor_role,
        "execution_agent_id": execution_agent_id,
        # Provenance only.  The provider profile records *where* an operation
        # would run; it never contributes authority to whether it may run.
        "provider_profile_id": provider_profile_id,
        "repo_id": repo_id,
        "worktree_id": worktree_id,
        "owned_scope_digest": owned_scope_digest,
        "expected_pre_state_digest": expected_pre_state_digest,
        "operation_class": operation_class.strip(),
        "operation_name": operation_name.strip(),
        "normalized_arguments": arguments,
        "arguments_digest": sha256_json(arguments),
        "resource_refs": refs,
        "policy_revision": policy_revision,
        "registry_revision": registry_revision,
        "delegation_revision": delegation_revision,
        "skill_contract_digest": skill_contract_digest,
        "executor_epoch": None if executor_epoch is None else int(executor_epoch),
        "created_at": created_at or iso_now(),
        "expires_at": expires_at,
        "one_shot": bool(one_shot),
    }
    # An idempotency key that did not cover the effect would let two different
    # operations collapse onto one approval, so it is derived from the exact
    # bound effect rather than accepted as an opaque caller-supplied token.
    intent["idempotency_key"] = idempotency_key or sha256_json(
        {
            "namespace_key": intent["namespace_key"],
            "command_id": command_id,
            "operation_class": intent["operation_class"],
            "operation_name": intent["operation_name"],
            "arguments_digest": intent["arguments_digest"],
            "resource_refs": refs,
        }
    )
    intent["request_digest"] = _digest_of(intent, exclude=["request_digest"])
    return intent


def validate_intent(intent: Mapping[str, Any]) -> dict[str, Any]:
    """Reject an intent whose content changed after it was produced."""

    if intent.get("schema_version") != APPROVAL_INTENT_SCHEMA_VERSION:
        raise ContractError(
            f"unsupported ApprovalIntent schema: {intent.get('schema_version')!r}"
        )
    expected = _digest_of(intent, exclude=["request_digest"])
    if intent.get("request_digest") != expected:
        raise ApprovalBindingError(
            "ApprovalIntent digest mismatch: the request was altered after it was produced"
        )
    recomputed_namespace = namespace_key(
        project_id=str(intent.get("project_id")),
        security_domain_id=str(intent.get("security_domain_id")),
    )
    if intent.get("namespace_key") != recomputed_namespace:
        raise ApprovalBindingError("ApprovalIntent namespace key does not match its own scope")
    return dict(intent)


def new_approval_decision(
    *,
    decision_id: str,
    intent: Mapping[str, Any],
    outcome: str,
    authority_class: str,
    reason_codes: Iterable[str],
    approved_operation_constraints: Mapping[str, Any] | None = None,
    one_shot_or_bounded_grant: str = "ONE_SHOT",
    valid_from: str | None = None,
    expires_at: str | None = None,
    required_authority_class: str | None = None,
    decision_event_id: str | None = None,
) -> dict[str, Any]:
    """Build a decision bound to the exact intent it answers."""

    validate_id(decision_id, "decision_id")
    validate_intent(intent)
    if outcome not in DECISION_OUTCOMES:
        raise ContractError(f"unknown approval outcome: {outcome!r}")
    if authority_class not in AUTHORITY_CLASSES:
        raise ContractError(f"unknown authority class: {authority_class!r}")
    if one_shot_or_bounded_grant not in ("ONE_SHOT", "BOUNDED_GRANT"):
        raise ContractError(f"unknown reuse semantics: {one_shot_or_bounded_grant!r}")
    codes = sorted({str(code).strip() for code in reason_codes if str(code).strip()})
    if not codes:
        raise ContractError("an approval decision must record at least one reason code")

    decision = {
        "schema_version": APPROVAL_DECISION_SCHEMA_VERSION,
        "decision_id": decision_id,
        "approval_request_id": intent["approval_request_id"],
        "request_digest": intent["request_digest"],
        "namespace_key": intent["namespace_key"],
        "project_id": intent["project_id"],
        "security_domain_id": intent["security_domain_id"],
        "command_id": intent["command_id"],
        "outcome": outcome,
        "authority_class": authority_class,
        # An escalation must name the authority it needs; a decision that did
        # not name one could be closed by whoever answered first.
        "required_authority_class": required_authority_class,
        "reason_codes": codes,
        "approved_operation_constraints": dict(approved_operation_constraints or {}),
        "one_shot_or_bounded_grant": one_shot_or_bounded_grant,
        "valid_from": valid_from or iso_now(),
        "expires_at": expires_at,
        "policy_revision": intent["policy_revision"],
        "registry_revision": intent["registry_revision"],
        "delegation_revision": intent["delegation_revision"],
        "skill_contract_digest": intent["skill_contract_digest"],
        "decision_event_id": decision_event_id,
        "created_at": iso_now(),
    }
    if outcome == ESCALATED_FOR_AUTHORITY and not required_authority_class:
        raise ContractError("ESCALATED_FOR_AUTHORITY must name the required authority class")
    decision["decision_digest"] = _digest_of(decision, exclude=["decision_digest"])
    return decision


def validate_decision(decision: Mapping[str, Any]) -> dict[str, Any]:
    """Reject a decision whose content changed after it was issued."""

    if decision.get("schema_version") != APPROVAL_DECISION_SCHEMA_VERSION:
        raise ContractError(
            f"unsupported ApprovalDecision schema: {decision.get('schema_version')!r}"
        )
    expected = _digest_of(decision, exclude=["decision_digest"])
    if decision.get("decision_digest") != expected:
        raise ApprovalBindingError(
            "ApprovalDecision digest mismatch: the decision was altered after it was issued"
        )
    return dict(decision)


def satisfies_required_authority(*, required: str | None, offered: str) -> bool:
    """Whether an answering authority is strong enough to close an escalation."""

    if required is None:
        return True
    if required not in AUTHORITY_RANK or offered not in AUTHORITY_RANK:
        raise ContractError("unknown authority class in escalation satisfaction check")
    return AUTHORITY_RANK[offered] >= AUTHORITY_RANK[required]


def revalidate_before_application(
    *,
    intent: Mapping[str, Any],
    decision: Mapping[str, Any],
    current: Mapping[str, Any],
    now: str | None = None,
) -> dict[str, Any]:
    """Re-prove every binding immediately before the adapter is allowed to act.

    This is the single choke point between "a decision exists" and "the host
    does something".  It runs on every application attempt, including retries
    and restart-recovered attempts, because the entire value of binding a
    decision is lost if the bindings are only checked when the decision is
    first created.
    """

    validate_intent(intent)
    validate_decision(decision)

    if decision.get("request_digest") != intent.get("request_digest"):
        raise ApprovalBindingError(
            "decision is not bound to this request: "
            f"decision_request_digest={decision.get('request_digest')} "
            f"intent_request_digest={intent.get('request_digest')}"
        )
    # Namespace is checked separately and first, so a cross-project replay is
    # reported as a cross-project replay rather than as a generic field drift.
    if decision.get("namespace_key") != intent.get("namespace_key"):
        raise ApprovalBindingError("decision namespace does not match the request namespace")

    drift: list[dict[str, Any]] = []
    for field in REVALIDATED_BINDINGS:
        if field not in current:
            continue
        bound = intent.get(field)
        observed = current.get(field)
        if bound != observed:
            drift.append({"field": field, "bound": bound, "observed": observed})

    if drift:
        raise ApprovalBindingError(
            "approval bindings moved before application; the decision is stale: "
            + "; ".join(
                f"{item['field']} bound={item['bound']!r} observed={item['observed']!r}"
                for item in drift
            )
        )

    stamp = now or iso_now()
    for record, label in ((intent, "request"), (decision, "decision")):
        expiry = record.get("expires_at")
        if expiry and parse_iso(stamp) >= parse_iso(str(expiry)):
            raise ApprovalBindingError(f"{label} expired at {expiry} and may not be applied")

    if decision.get("outcome") not in APPROVING_OUTCOMES:
        raise ApprovalBindingError(
            f"decision outcome {decision.get('outcome')!r} does not authorize application"
        )

    return {
        "ok": True,
        "revalidated_at": stamp,
        "approval_request_id": intent["approval_request_id"],
        "decision_id": decision["decision_id"],
        "namespace_key": intent["namespace_key"],
        "checked_bindings": [f for f in REVALIDATED_BINDINGS if f in current],
    }


def new_approval_application(
    *,
    application_id: str,
    decision: Mapping[str, Any],
    adapter_id: str,
    provider_profile_id: str | None,
    observed_state: str,
    provider_observation_ref: Mapping[str, Any] | None = None,
    applied_at: str | None = None,
    verified_at: str | None = None,
    application_event_id: str | None = None,
) -> dict[str, Any]:
    """Record what was actually observed when a decision was applied."""

    validate_id(application_id, "application_id")
    validate_decision(decision)
    if observed_state not in OBSERVED_STATES:
        raise ContractError(f"unknown observed application state: {observed_state!r}")

    application = {
        "schema_version": APPROVAL_APPLICATION_SCHEMA_VERSION,
        "application_id": application_id,
        "decision_id": decision["decision_id"],
        "approval_request_id": decision["approval_request_id"],
        "namespace_key": decision["namespace_key"],
        "project_id": decision["project_id"],
        "security_domain_id": decision["security_domain_id"],
        "command_id": decision["command_id"],
        "adapter_id": adapter_id,
        "provider_profile_id": provider_profile_id,
        "observed_state": observed_state,
        "provider_observation_ref": dict(provider_observation_ref or {}),
        "applied_at": applied_at or iso_now(),
        "verified_at": verified_at,
        "application_event_id": application_event_id,
        # An ambiguous application blocks both execution and resubmission.  It
        # is recorded as a first-class fact rather than an error so that the
        # block itself survives a restart.
        "blocks_execution": observed_state in BLOCKED_STATES,
        "requires_reconciliation": observed_state == UNKNOWN_RECONCILIATION_REQUIRED,
    }
    application["application_digest"] = _digest_of(
        application, exclude=["application_digest"]
    )
    return application


def worker_health_state(
    *,
    applications: Iterable[Mapping[str, Any]],
    execution_progressing: bool,
) -> dict[str, Any]:
    """Derive the truthful worker health state.

    ``RUNNING`` and ``WAITING_FOR_APPROVAL`` are mutually exclusive by
    construction here: a blocked approval observation always wins over a claim
    of progress, because the only way a caller could assert progress while an
    approval is unresolved is by inferring it from something that is not
    evidence (terminal liveness, input acceptance, a prompt string).
    """

    blocking = [
        app for app in applications
        if str(app.get("observed_state")) in BLOCKED_STATES
    ]
    if blocking:
        unknown = [
            app for app in blocking
            if str(app.get("observed_state")) == UNKNOWN_RECONCILIATION_REQUIRED
        ]
        state = UNKNOWN_RECONCILIATION_REQUIRED if unknown else WAITING_FOR_APPROVAL
        return {
            "state": state,
            "running": False,
            "waiting_for_approval": True,
            "blocking_application_ids": sorted(
                str(app.get("application_id")) for app in blocking
            ),
            "derived_from": "qualified_adapter_observation_and_durable_state",
        }
    return {
        "state": "RUNNING" if execution_progressing else "IDLE",
        "running": bool(execution_progressing),
        "waiting_for_approval": False,
        "blocking_application_ids": [],
        "derived_from": "qualified_adapter_observation_and_durable_state",
    }


def new_bounded_grant(
    *,
    grant_id: str,
    decision: Mapping[str, Any],
    operation_class: str,
    resource_refs: Iterable[Mapping[str, Any]],
    argument_constraints: Mapping[str, Any] | None,
    expires_at: str,
    max_uses: int = 1,
) -> dict[str, Any]:
    """Build a bounded, revocable reuse grant.

    Grants are an optimisation only.  Correctness never depends on one existing,
    and every grant is scoped to exactly one namespace, operation class,
    resource set and revision triple so that it cannot widen what the original
    decision authorized.
    """

    validate_id(grant_id, "grant_id")
    validate_decision(decision)
    if decision.get("one_shot_or_bounded_grant") != "BOUNDED_GRANT":
        raise PolicyError("only a decision issued as BOUNDED_GRANT may create a grant")
    if int(max_uses) < 1:
        raise ContractError("a bounded grant must permit at least one use")

    grant = {
        "schema_version": APPROVAL_GRANT_SCHEMA_VERSION,
        "grant_id": grant_id,
        "decision_id": decision["decision_id"],
        "namespace_key": decision["namespace_key"],
        "project_id": decision["project_id"],
        "security_domain_id": decision["security_domain_id"],
        "operation_class": operation_class,
        "resource_refs": normalize_resource_refs(resource_refs),
        "argument_constraints": dict(argument_constraints or {}),
        "policy_revision": decision["policy_revision"],
        "registry_revision": decision["registry_revision"],
        "delegation_revision": decision["delegation_revision"],
        "expires_at": expires_at,
        "max_uses": int(max_uses),
        "uses": 0,
        "revoked": False,
        "created_at": iso_now(),
    }
    grant["grant_digest"] = _digest_of(grant, exclude=["grant_digest", "uses", "revoked"])
    return grant
