"""Host-side approval policy evaluation and exactly-once application.

The broker answers exactly one question: given a normalized, host-produced
intent and the durable authority context it was produced in, may this exact
operation proceed?

Three properties matter more than convenience here:

* **No blanket approval exists.**  There is no "safe tools" toggle and no
  operation class that approves by default.  Approval requires an allowlisted
  class, exact owned resources, a current pre-state and a still-current
  revision triple.  Everything unrecognised falls through to denial or
  escalation, never to approval.

* **Operator-only stays operator-only.**  A stronger model cannot convert an
  operator-gated class into a delegated approval, because the disposition is a
  property of the normalized class, resolved before any authority is consulted.

* **Isolation is structural.**  Every record lives under a namespace derived
  from project *and* security domain, so a decision from one project has no
  filesystem path through which it could authorize another, even when task IDs,
  Command IDs and paths collide exactly.

The broker never imports a provider adapter and contains no provider brand
name.  It speaks only in normalized classes and durable revisions.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable, Mapping

from .approval import (
    APPROVED_BY_DELEGATION,
    APPROVED_BY_POLICY,
    AUTHORITY_HOST_POLICY,
    AUTHORITY_OPERATOR,
    AUTHORITY_SUPERVISOR,
    AUTHORITY_TECH_LEAD,
    DENIED_BY_POLICY,
    ESCALATED_FOR_AUTHORITY,
    ApprovalBindingError,
    new_approval_decision,
    namespace_key,
    revalidate_before_application,
    satisfies_required_authority,
    validate_decision,
    validate_intent,
)
from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    parse_iso,
    sha256_json,
    validate_id,
)

# --------------------------------------------------------------------------
# Normalized operation classes
# --------------------------------------------------------------------------

CLASS_READ_IN_SCOPE = "READ_IN_SCOPE"
CLASS_WRITE_IN_OWNED_SCOPE = "WRITE_IN_OWNED_SCOPE"
CLASS_WRITE_OUTSIDE_OWNED_SCOPE = "WRITE_OUTSIDE_OWNED_SCOPE"
CLASS_CROSS_PROJECT = "CROSS_PROJECT"
CLASS_CROSS_SECURITY_DOMAIN = "CROSS_SECURITY_DOMAIN"
CLASS_SEMANTIC_OWNERSHIP_CONFLICT = "SEMANTIC_OWNERSHIP_CONFLICT"
CLASS_AMBIGUOUS_UNRECONCILED = "AMBIGUOUS_UNRECONCILED"

CLASS_CREDENTIAL_AUTHORITY = "CREDENTIAL_AUTHORITY"
CLASS_PRODUCTION_AUTHORITY = "PRODUCTION_AUTHORITY"
CLASS_CONTROL_PLANE_MUTATION = "CONTROL_PLANE_MUTATION"
CLASS_EXTERNAL_CAPABILITY_INSTALL = "EXTERNAL_CAPABILITY_INSTALL"
CLASS_DESTRUCTIVE_HOST_ACTION = "DESTRUCTIVE_HOST_ACTION"
CLASS_HISTORY_REWRITE = "HISTORY_REWRITE"
CLASS_OUT_OF_ENVELOPE_SPEND = "OUT_OF_ENVELOPE_SPEND"
CLASS_PRIVILEGE_ESCALATION = "PRIVILEGE_ESCALATION"

#: Classes that may never be auto-approved by any model at any authority level.
#: Membership here is checked before delegation is consulted, which is what
#: makes "a stronger model approved it" structurally impossible.
OPERATOR_ONLY_CLASSES = frozenset({
    CLASS_CREDENTIAL_AUTHORITY,
    CLASS_PRODUCTION_AUTHORITY,
    CLASS_CONTROL_PLANE_MUTATION,
    CLASS_EXTERNAL_CAPABILITY_INSTALL,
    CLASS_CROSS_PROJECT,
    CLASS_CROSS_SECURITY_DOMAIN,
    CLASS_WRITE_OUTSIDE_OWNED_SCOPE,
    CLASS_DESTRUCTIVE_HOST_ACTION,
    CLASS_HISTORY_REWRITE,
    CLASS_OUT_OF_ENVELOPE_SPEND,
    CLASS_PRIVILEGE_ESCALATION,
    CLASS_AMBIGUOUS_UNRECONCILED,
})

#: How each operator-only class is disposed of.  Some are refused outright by
#: host policy; the rest are raised to the operator.  Neither path can produce
#: an approval from a model.
_OPERATOR_ONLY_DISPOSITION = {
    CLASS_WRITE_OUTSIDE_OWNED_SCOPE: DENIED_BY_POLICY,
    CLASS_CROSS_PROJECT: DENIED_BY_POLICY,
    CLASS_CROSS_SECURITY_DOMAIN: DENIED_BY_POLICY,
    CLASS_EXTERNAL_CAPABILITY_INSTALL: DENIED_BY_POLICY,
    CLASS_AMBIGUOUS_UNRECONCILED: DENIED_BY_POLICY,
    CLASS_CREDENTIAL_AUTHORITY: ESCALATED_FOR_AUTHORITY,
    CLASS_PRODUCTION_AUTHORITY: ESCALATED_FOR_AUTHORITY,
    CLASS_CONTROL_PLANE_MUTATION: ESCALATED_FOR_AUTHORITY,
    CLASS_DESTRUCTIVE_HOST_ACTION: ESCALATED_FOR_AUTHORITY,
    CLASS_HISTORY_REWRITE: ESCALATED_FOR_AUTHORITY,
    CLASS_OUT_OF_ENVELOPE_SPEND: ESCALATED_FOR_AUTHORITY,
    CLASS_PRIVILEGE_ESCALATION: ESCALATED_FOR_AUTHORITY,
}

#: The only classes an automated decision may ever approve.  This is an
#: allowlist rather than a denylist on purpose: a class nobody has classified
#: must fail to approve, not fall through into "probably safe".
APPROVABLE_CLASSES = frozenset({CLASS_READ_IN_SCOPE, CLASS_WRITE_IN_OWNED_SCOPE})

KNOWN_CLASSES = (
    APPROVABLE_CLASSES
    | OPERATOR_ONLY_CLASSES
    | {CLASS_SEMANTIC_OWNERSHIP_CONFLICT}
)


class ApprovalPolicyError(PolicyError):
    """Raised when broker inputs are internally inconsistent."""


def assert_known_class(operation_class: str) -> str:
    if operation_class not in KNOWN_CLASSES:
        raise ApprovalPolicyError(
            f"unclassified operation class {operation_class!r}: an operation the host "
            "cannot normalize is never approvable"
        )
    return operation_class


# --------------------------------------------------------------------------
# Durable, namespace-isolated store
# --------------------------------------------------------------------------

class ApprovalStore:
    """Durable approval records bound to exactly one project/security domain.

    The store is constructed with its namespace and derives every path from it.
    There is deliberately no method that takes a namespace argument, so no
    caller can ask one store to read or write another namespace's records.
    """

    def __init__(self, root: str | Path, *, project_id: str, security_domain_id: str):
        self.project_id = validate_id(project_id, "project_id")
        self.security_domain_id = validate_id(security_domain_id, "security_domain_id")
        self.namespace_key = namespace_key(
            project_id=project_id, security_domain_id=security_domain_id
        )
        self.root = Path(root) / "approvals" / "ns" / self.namespace_key
        self.requests_dir = self.root / "requests"
        self.decisions_dir = self.root / "decisions"
        self.applications_dir = self.root / "applications"
        self.grants_dir = self.root / "grants"
        self.idempotency_dir = self.root / "idempotency"
        self.lock_path = self.root / ".approvals.lock"
        for directory in (
            self.requests_dir,
            self.decisions_dir,
            self.applications_dir,
            self.grants_dir,
            self.idempotency_dir,
        ):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)

    # -- namespace guard --------------------------------------------------

    def _assert_same_namespace(self, record: Mapping[str, Any], *, label: str) -> None:
        """Refuse to touch a record belonging to another namespace.

        Without this, a caller holding a foreign decision could use a local
        store to confirm it exists here or to apply it, which is exactly the
        cross-project authority leak the isolation boundary must prevent.
        """

        if record.get("namespace_key") != self.namespace_key:
            raise PolicyError(
                f"{label} belongs to namespace {record.get('namespace_key')!r} "
                f"(project={record.get('project_id')!r} "
                f"domain={record.get('security_domain_id')!r}); this store is bound to "
                f"project={self.project_id!r} domain={self.security_domain_id!r}"
            )

    # -- reads -------------------------------------------------------------

    def load_request(self, approval_request_id: str) -> dict[str, Any] | None:
        validate_id(approval_request_id, "approval_request_id")
        path = self.requests_dir / f"{approval_request_id}.json"
        return load_json(path) if path.exists() else None

    def load_decision(self, decision_id: str) -> dict[str, Any] | None:
        validate_id(decision_id, "decision_id")
        path = self.decisions_dir / f"{decision_id}.json"
        return load_json(path) if path.exists() else None

    def load_application(self, application_id: str) -> dict[str, Any] | None:
        validate_id(application_id, "application_id")
        path = self.applications_dir / f"{application_id}.json"
        return load_json(path) if path.exists() else None

    def load_grant(self, grant_id: str) -> dict[str, Any] | None:
        validate_id(grant_id, "grant_id")
        path = self.grants_dir / f"{grant_id}.json"
        return load_json(path) if path.exists() else None

    def list_applications(self) -> list[dict[str, Any]]:
        return [load_json(p) for p in sorted(self.applications_dir.glob("*.json"))]

    def list_decisions(self) -> list[dict[str, Any]]:
        return [load_json(p) for p in sorted(self.decisions_dir.glob("*.json"))]

    def pending_requests(self) -> list[dict[str, Any]]:
        """Requests whose application has not reached a terminal state."""

        terminal_by_request: dict[str, bool] = {}
        for application in self.list_applications():
            request_id = str(application.get("approval_request_id"))
            resolved = not bool(application.get("blocks_execution"))
            terminal_by_request[request_id] = (
                terminal_by_request.get(request_id, False) or resolved
            )
        out = []
        for path in sorted(self.requests_dir.glob("*.json")):
            record = load_json(path)
            if not terminal_by_request.get(str(record.get("approval_request_id")), False):
                out.append(record)
        return out

    # -- writes ------------------------------------------------------------

    def open_request(self, intent: Mapping[str, Any]) -> dict[str, Any]:
        """Persist one immutable intent.  Request IDs are never reused."""

        validate_intent(intent)
        self._assert_same_namespace(intent, label="ApprovalIntent")
        path = self.requests_dir / f"{intent['approval_request_id']}.json"
        with file_lock(self.lock_path):
            if path.exists():
                existing = load_json(path)
                if existing.get("request_digest") != intent.get("request_digest"):
                    raise PolicyError(
                        "approval request ID reused with different bindings; a new "
                        "operation requires a fresh approval request ID"
                    )
                return existing
            atomic_write_json(path, dict(intent))
            return dict(intent)

    def record_decision(self, decision: Mapping[str, Any]) -> dict[str, Any]:
        validate_decision(decision)
        self._assert_same_namespace(decision, label="ApprovalDecision")
        path = self.decisions_dir / f"{decision['decision_id']}.json"
        with file_lock(self.lock_path):
            if path.exists():
                existing = load_json(path)
                if existing.get("decision_digest") != decision.get("decision_digest"):
                    raise PolicyError("decision ID reused with different content")
                return {**existing, "duplicate": True}
            atomic_write_json(path, dict(decision))
            return {**dict(decision), "duplicate": False}

    def record_application(self, application: Mapping[str, Any]) -> dict[str, Any]:
        """Record one application, collapsing duplicate delivery to a no-op.

        Idempotency is keyed on the *effect* the intent described, not on the
        application ID, so a duplicate decision delivered under a fresh
        application ID still cannot produce a second real operation.
        """

        self._assert_same_namespace(application, label="ApprovalApplication")
        path = self.applications_dir / f"{application['application_id']}.json"
        request_id = str(application.get("approval_request_id"))
        request = self.load_request(request_id)
        if request is None:
            raise PolicyError(
                f"application references an unknown approval request: {request_id}"
            )
        idempotency_path = self.idempotency_dir / f"{request['idempotency_key']}.json"

        with file_lock(self.lock_path):
            if path.exists():
                return {**load_json(path), "duplicate": True, "applied": False}
            if idempotency_path.exists():
                prior = load_json(idempotency_path)
                # The effect already happened under a different application ID.
                # Returning the original record is the only safe answer; the
                # alternative is a second real operation.
                return {
                    **load_json(self.applications_dir / f"{prior['application_id']}.json"),
                    "duplicate": True,
                    "applied": False,
                    "duplicate_reason": "idempotent effect already applied",
                }
            atomic_write_json(path, dict(application))
            atomic_write_json(
                idempotency_path,
                {
                    "idempotency_key": request["idempotency_key"],
                    "application_id": application["application_id"],
                    "decision_id": application["decision_id"],
                    "recorded_at": iso_now(),
                },
            )
            return {**dict(application), "duplicate": False, "applied": True}

    def reconcile_application(
        self, application_id: str, *, resolved_state: str, evidence: Mapping[str, Any]
    ) -> dict[str, Any]:
        """Durably resolve one ambiguous application.

        Reconciliation is a store operation rather than a field a caller may set,
        because ``assert_no_blind_reapply`` trusts it.  If any caller could stamp
        ``reconciled_at`` onto a record, the unknown-state block would be
        bypassable by the very code path it exists to stop.
        """

        from .approval import BLOCKED_STATES, OBSERVED_STATES

        if resolved_state not in OBSERVED_STATES:
            raise ContractError(f"unknown resolved state: {resolved_state!r}")
        if resolved_state in BLOCKED_STATES:
            raise PolicyError(
                f"reconciliation must resolve to a terminal state, not {resolved_state!r}"
            )
        path = self.applications_dir / f"{validate_id(application_id, 'application_id')}.json"
        with file_lock(self.lock_path):
            if not path.exists():
                raise PolicyError(f"unknown application: {application_id}")
            record = load_json(path)
            self._assert_same_namespace(record, label="ApprovalApplication")
            if not record.get("requires_reconciliation"):
                return {**record, "duplicate": True}
            record["reconciled_at"] = iso_now()
            record["reconciled_state"] = resolved_state
            record["reconciliation_evidence"] = dict(evidence)
            record["blocks_execution"] = False
            record["requires_reconciliation"] = False
            atomic_write_json(path, record)
            return record

    def record_grant(self, grant: Mapping[str, Any]) -> dict[str, Any]:
        self._assert_same_namespace(grant, label="ApprovalGrant")
        path = self.grants_dir / f"{grant['grant_id']}.json"
        with file_lock(self.lock_path):
            if path.exists():
                return {**load_json(path), "duplicate": True}
            atomic_write_json(path, dict(grant))
            return {**dict(grant), "duplicate": False}

    def revoke_grants_for_revisions(
        self,
        *,
        policy_revision: str | None = None,
        registry_revision: str | None = None,
        delegation_revision: str | None = None,
    ) -> list[str]:
        """Invalidate grants whose authority context moved.

        Historical decisions are never rewritten.  Only the reuse grant - which
        is an optimisation, not a fact - is revoked, so the audit trail of what
        was decided at the time stays intact.
        """

        revoked: list[str] = []
        with file_lock(self.lock_path):
            for path in sorted(self.grants_dir.glob("*.json")):
                grant = load_json(path)
                if grant.get("revoked"):
                    continue
                stale = any(
                    current is not None and grant.get(field) != current
                    for field, current in (
                        ("policy_revision", policy_revision),
                        ("registry_revision", registry_revision),
                        ("delegation_revision", delegation_revision),
                    )
                )
                if stale:
                    grant["revoked"] = True
                    grant["revoked_at"] = iso_now()
                    grant["revocation_reason"] = "authority context revision changed"
                    atomic_write_json(path, grant)
                    revoked.append(str(grant["grant_id"]))
        return revoked

    def grant_is_usable(self, grant: Mapping[str, Any], *, now: str | None = None) -> dict[str, Any]:
        """Whether a bounded grant may still satisfy a request."""

        self._assert_same_namespace(grant, label="ApprovalGrant")
        stamp = now or iso_now()
        if grant.get("revoked"):
            return {"usable": False, "reason": "grant was revoked"}
        if parse_iso(stamp) >= parse_iso(str(grant["expires_at"])):
            return {"usable": False, "reason": "grant expired"}
        if int(grant.get("uses", 0)) >= int(grant["max_uses"]):
            return {"usable": False, "reason": "grant use budget exhausted"}
        return {"usable": True, "reason": "grant is current"}


# --------------------------------------------------------------------------
# Policy evaluation
# --------------------------------------------------------------------------

class ApprovalBroker:
    """Evaluate normalized intents against durable policy and delegation state."""

    def __init__(
        self,
        store: ApprovalStore,
        *,
        policy_revision: str,
        registry_revision: str,
        delegation_revision: str,
        delegated_operation_classes: Iterable[str] = (),
        delegated_scope_digests: Iterable[str] = (),
    ):
        self.store = store
        self.policy_revision = policy_revision
        self.registry_revision = registry_revision
        self.delegation_revision = delegation_revision
        self.delegated_operation_classes = frozenset(delegated_operation_classes)
        self.delegated_scope_digests = frozenset(delegated_scope_digests)
        # A delegation may never contain an operator-only class.  Rejecting it
        # at construction time means a misconfigured delegation fails loudly
        # rather than silently widening authority at decision time.
        overreach = self.delegated_operation_classes & OPERATOR_ONLY_CLASSES
        if overreach:
            raise ApprovalPolicyError(
                "delegation may not include operator-only operation classes: "
                f"{sorted(overreach)}"
            )

    # -- evaluation --------------------------------------------------------

    def evaluate(
        self,
        intent: Mapping[str, Any],
        *,
        decision_id: str,
        owned_scope_digest: str,
        current_pre_state_digest: str,
        semantic_ownership_conflict: bool = False,
        bounded_grant: bool = False,
        grant_expires_at: str | None = None,
    ) -> dict[str, Any]:
        """Produce exactly one decision for one intent."""

        validate_intent(intent)
        self.store._assert_same_namespace(intent, label="ApprovalIntent")
        operation_class = assert_known_class(str(intent["operation_class"]))

        reason_codes: list[str] = [f"OPERATION_CLASS_{operation_class}"]

        # 1. Revision currency.  A request produced against a superseded
        #    authority context is refused before its class is even considered.
        for field, current in (
            ("policy_revision", self.policy_revision),
            ("registry_revision", self.registry_revision),
            ("delegation_revision", self.delegation_revision),
        ):
            if intent.get(field) != current:
                return self._decide(
                    decision_id=decision_id,
                    intent=intent,
                    outcome=DENIED_BY_POLICY,
                    authority_class=AUTHORITY_HOST_POLICY,
                    reason_codes=reason_codes + [f"STALE_{field.upper()}"],
                )

        # 2. Operator-only classes are disposed of before delegation is read.
        if operation_class in OPERATOR_ONLY_CLASSES:
            outcome = _OPERATOR_ONLY_DISPOSITION[operation_class]
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=outcome,
                authority_class=(
                    AUTHORITY_HOST_POLICY if outcome == DENIED_BY_POLICY else AUTHORITY_OPERATOR
                ),
                required_authority_class=(
                    AUTHORITY_OPERATOR if outcome == ESCALATED_FOR_AUTHORITY else None
                ),
                reason_codes=reason_codes + ["OPERATOR_ONLY_CLASS", "NEVER_AUTO_APPROVED"],
            )

        # 3. A semantic ownership conflict is a question about who owns the
        #    work, which host policy is not competent to answer.
        if semantic_ownership_conflict or operation_class == CLASS_SEMANTIC_OWNERSHIP_CONFLICT:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=ESCALATED_FOR_AUTHORITY,
                authority_class=AUTHORITY_TECH_LEAD,
                required_authority_class=AUTHORITY_TECH_LEAD,
                reason_codes=reason_codes + ["SEMANTIC_OWNERSHIP_CONFLICT"],
            )

        # 4. Scope and pre-state must match exactly.
        if intent.get("owned_scope_digest") != owned_scope_digest:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=DENIED_BY_POLICY,
                authority_class=AUTHORITY_HOST_POLICY,
                reason_codes=reason_codes + ["OWNED_SCOPE_DIGEST_MISMATCH"],
            )
        if intent.get("expected_pre_state_digest") != current_pre_state_digest:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=DENIED_BY_POLICY,
                authority_class=AUTHORITY_HOST_POLICY,
                reason_codes=reason_codes + ["PRE_STATE_DIGEST_MISMATCH"],
            )

        # 5. Only allowlisted classes may be approved at all.
        if operation_class not in APPROVABLE_CLASSES:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=ESCALATED_FOR_AUTHORITY,
                authority_class=AUTHORITY_SUPERVISOR,
                required_authority_class=AUTHORITY_SUPERVISOR,
                reason_codes=reason_codes + ["CLASS_NOT_POLICY_APPROVABLE"],
            )

        if operation_class == CLASS_READ_IN_SCOPE:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=APPROVED_BY_POLICY,
                authority_class=AUTHORITY_HOST_POLICY,
                reason_codes=reason_codes + ["BOUNDED_READ_IN_DECLARED_SCOPE"],
                approved_operation_constraints={
                    "operation_class": operation_class,
                    "operation_name": intent["operation_name"],
                    "arguments_digest": intent["arguments_digest"],
                    "resource_refs": intent["resource_refs"],
                },
                bounded_grant=bounded_grant,
                grant_expires_at=grant_expires_at,
            )

        # 6. A bounded write additionally requires an explicit delegation that
        #    covers both the class and the exact owned scope.
        if operation_class not in self.delegated_operation_classes:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=ESCALATED_FOR_AUTHORITY,
                authority_class=AUTHORITY_TECH_LEAD,
                required_authority_class=AUTHORITY_TECH_LEAD,
                reason_codes=reason_codes + ["CLASS_NOT_DELEGATED"],
            )
        if owned_scope_digest not in self.delegated_scope_digests:
            return self._decide(
                decision_id=decision_id,
                intent=intent,
                outcome=ESCALATED_FOR_AUTHORITY,
                authority_class=AUTHORITY_TECH_LEAD,
                required_authority_class=AUTHORITY_TECH_LEAD,
                reason_codes=reason_codes + ["SCOPE_NOT_DELEGATED"],
            )
        return self._decide(
            decision_id=decision_id,
            intent=intent,
            outcome=APPROVED_BY_DELEGATION,
            authority_class=AUTHORITY_TECH_LEAD,
            reason_codes=reason_codes + ["BOUNDED_WRITE_IN_OWNED_SCOPE", "DELEGATION_CURRENT"],
            approved_operation_constraints={
                "operation_class": operation_class,
                "operation_name": intent["operation_name"],
                "arguments_digest": intent["arguments_digest"],
                "resource_refs": intent["resource_refs"],
                "owned_scope_digest": owned_scope_digest,
            },
            bounded_grant=bounded_grant,
            grant_expires_at=grant_expires_at,
        )

    def _decide(
        self,
        *,
        decision_id: str,
        intent: Mapping[str, Any],
        outcome: str,
        authority_class: str,
        reason_codes: list[str],
        required_authority_class: str | None = None,
        approved_operation_constraints: Mapping[str, Any] | None = None,
        bounded_grant: bool = False,
        grant_expires_at: str | None = None,
    ) -> dict[str, Any]:
        reuse = "BOUNDED_GRANT" if (bounded_grant and grant_expires_at) else "ONE_SHOT"
        decision = new_approval_decision(
            decision_id=decision_id,
            intent=intent,
            outcome=outcome,
            authority_class=authority_class,
            reason_codes=reason_codes,
            approved_operation_constraints=approved_operation_constraints,
            one_shot_or_bounded_grant=reuse,
            expires_at=grant_expires_at if reuse == "BOUNDED_GRANT" else None,
            required_authority_class=required_authority_class,
        )
        return self.store.record_decision(decision)

    # -- escalation --------------------------------------------------------

    def close_escalation(
        self,
        *,
        decision: Mapping[str, Any],
        answering_authority_class: str,
    ) -> dict[str, Any]:
        """Check whether an answering authority may close an escalation.

        A lower authority answering a higher escalation is the exact failure the
        four-tier model exists to prevent, so it is refused rather than logged.
        """

        validate_decision(decision)
        self.store._assert_same_namespace(decision, label="ApprovalDecision")
        if decision.get("outcome") != ESCALATED_FOR_AUTHORITY:
            raise ApprovalPolicyError("only an escalated decision can be closed by an authority")
        required = decision.get("required_authority_class")
        if not satisfies_required_authority(
            required=required, offered=answering_authority_class
        ):
            raise PolicyError(
                f"authority {answering_authority_class!r} cannot satisfy an escalation "
                f"requiring {required!r}"
            )
        return {
            "ok": True,
            "decision_id": decision["decision_id"],
            "required_authority_class": required,
            "answering_authority_class": answering_authority_class,
        }

    # -- application -------------------------------------------------------

    def prepare_application(
        self,
        *,
        intent: Mapping[str, Any],
        decision: Mapping[str, Any],
        current: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Revalidate all bindings immediately before the adapter may act."""

        self.store._assert_same_namespace(intent, label="ApprovalIntent")
        self.store._assert_same_namespace(decision, label="ApprovalDecision")
        return revalidate_before_application(
            intent=intent, decision=decision, current=current
        )


def reconciliation_required(application: Mapping[str, Any]) -> bool:
    """Whether this application blocks execution pending reconciliation."""

    return bool(application.get("requires_reconciliation"))


def assert_no_blind_reapply(applications: Iterable[Mapping[str, Any]]) -> None:
    """Refuse to resubmit while any application is unreconciled.

    An UNKNOWN application means the host does not know whether the effect
    happened.  Resubmitting is the one action guaranteed to be wrong in one of
    the two possible worlds, so it is blocked until reconciliation resolves
    which world this is.
    """

    unresolved = [
        str(app.get("application_id"))
        for app in applications
        if reconciliation_required(app) and not app.get("reconciled_at")
    ]
    if unresolved:
        raise ApprovalBindingError(
            "an unreconciled approval application blocks resubmission: "
            f"{sorted(unresolved)}"
        )
