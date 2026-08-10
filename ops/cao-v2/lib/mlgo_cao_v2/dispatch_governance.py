"""Slice 4: the governance seam a real provider send must pass through.

Slices 2, 3 and 3.5 built ContextEnvelope measurement, atomic budget
reservation/settlement, canonical SkillContract compilation and the
ApprovalBroker/PermissionAdapter authority model, but none of them were
reachable from the actual dispatch path: every one of them only ran inside
its own unit tests.  This module is the missing wiring.  It has two calls:

* :func:`govern_before_send` runs immediately before a real provider call.
  It compiles the minimal SkillContract, measures and caps the complete
  request, reserves budget, and gets an ApprovalBroker decision for the
  dispatch itself - all before anything crosses the transport boundary.  A
  failure here means no provider call happens.
* :func:`settle_after_send` (success), :func:`release_after_not_sent`
  (confirmed no-op) and :func:`hold_after_ambiguous` (uncertain outcome)
  close the reservation opened by ``govern_before_send``, mirroring the
  budget module's certainty-first release semantics rather than optimism.

No provider brand name appears in this module.  Everything it does is driven
by policy data and the registry-selected route; only :mod:`transport`
adapters and registry data may vary per provider.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .approval import new_approval_intent
from .approval_broker import (
    APPROVED_BY_DELEGATION,
    APPROVED_BY_POLICY,
    CLASS_READ_IN_SCOPE,
    CLASS_WRITE_IN_OWNED_SCOPE,
    ApprovalBroker,
    ApprovalStore,
)
from .budgets import BudgetExceeded, BudgetStore, make_budget_policy, make_limit
from .canonical_lock import build_recipes, build_registry, load_lock
from .common import sha256_bytes, sha256_json
from .context_envelope import assert_within_cap, build_context_manifest, component, write_manifest
from .skill_cache import SealedSkillCache
from .skill_recipes import compile_skill_contract

#: One CAO run is one disposable canary project and one disposable security
#: domain in Slice 4.  A future slice may thread an explicit charter-level
#: project/security-domain field through the phase packet; until then this is
#: the one place that mapping is decided, rather than it being re-derived
#: (and risking disagreeing) in several call sites.
def project_and_domain_for_run(run_id: str) -> tuple[str, str]:
    return run_id, run_id


def _slug(label: str, value: str) -> str:
    return f"{label}-{sha256_bytes(value.encode('utf-8'))[:16]}"


_ROLE_BY_PHASE_KIND = {"review": "reviewer", "implementation": "developer", "integration_repair": "developer"}
_TASK_CLASS_BY_PHASE_KIND = {"review": "review", "integration_repair": "debugging"}


def _select_recipe(recipes: dict[str, dict[str, Any]], *, phase_kind: str, objective: str) -> dict[str, Any] | None:
    role = _ROLE_BY_PHASE_KIND.get(phase_kind, "developer")
    task_class = _TASK_CLASS_BY_PHASE_KIND.get(phase_kind, "implementation")
    lowered = objective.lower()
    if "security" in lowered or "vulnerab" in lowered:
        task_class = "security"
    elif "frontend" in lowered or "ui" in lowered:
        task_class = "frontend"
    elif "debug" in lowered or "bug" in lowered:
        task_class = "debugging"
    candidates = [
        r for r in recipes.values()
        if r["role"] == role and task_class in r["task_classes"]
    ]
    if not candidates:
        candidates = [r for r in recipes.values() if r["role"] == role]
    if not candidates:
        return None
    return sorted(candidates, key=lambda r: r["recipe_id"])[0], task_class


class GovernanceBlocked(Exception):
    """Raised by govern_before_send when the dispatch may not proceed.

    Distinguishes a *governed* refusal (budget exhausted, approval denied,
    request over the context cap) from a provider/transport failure: no
    provider call was attempted, so the caller must not treat this the way it
    treats an ambiguous or failed send.
    """

    def __init__(self, reason: str, *, detail: dict[str, Any]):
        self.reason = reason
        self.detail = detail
        super().__init__(reason)


def govern_before_send(
    *,
    phase: dict[str, Any],
    decision: dict[str, Any],
    job: dict[str, Any],
    policy: dict[str, Any],
    prompt_text: str,
    v2_dir: Path,
    job_dir: Path,
    pre_state_facts: dict[str, Any],
) -> dict[str, Any]:
    """Compile the skill contract, cap the context, reserve budget and get an
    ApprovalBroker decision - all before the provider transport is touched.

    Returns a record with everything the caller needs to settle/release the
    reservation afterward.  Raises :class:`GovernanceBlocked` if any gate
    refuses; in that case ``govern_before_send`` has made no reservation that
    needs releasing (evaluate-and-reserve is one atomic step, so a refusal
    never leaves a reservation behind).
    """

    command_id = job["job_id"]
    run_id = phase["run_id"]
    project_id, security_domain_id = project_and_domain_for_run(run_id)

    governance_dir = job_dir / "governance"
    governance_dir.mkdir(parents=True, exist_ok=True, mode=0o700)

    # -- 1. SkillContract: minimal, sealed, digest-bound, compiled before dispatch
    lock = load_lock()
    cache_root = Path(policy.get("skill_cache_root") or (Path(policy["state_root"]) / "canonical-skill-cache-v1"))
    cache = SealedSkillCache(cache_root)
    registry = build_registry(lock)
    recipes = build_recipes(lock)
    selection = _select_recipe(recipes, phase_kind=phase["phase_kind"], objective=phase["objective"])
    skill_contract: dict[str, Any] | None = None
    skill_contract_digest = sha256_json({"no_recipe_matched": True, "phase_kind": phase["phase_kind"]})
    if selection is not None:
        recipe, task_class = selection
        risk_class = recipe["risk_classes"][0]
        skill_contract = compile_skill_contract(
            registry=registry, cache=cache, recipe=recipe,
            project_id=project_id, security_domain_id=security_domain_id,
            role=recipe["role"], task_class=task_class, risk_class=risk_class,
        )
        skill_contract_digest = skill_contract["skill_contract_digest"]
        atomic_path = governance_dir / "skill-contract.json"
        from .common import atomic_write_json
        atomic_write_json(atomic_path, skill_contract)

    # -- 2. ContextEnvelope: measure and cap the complete request before send
    components = [
        component(kind="objective_task", component_id="phase-prompt", text=prompt_text, reducible=False, retention_rank=5),
    ]
    if skill_contract is not None:
        components.append(
            component(
                kind="profile_text",
                component_id="skill-contract",
                items=[s["skill_id"] for s in skill_contract.get("selected_skills", [])],
                reducible=False,
                retention_rank=4,
            )
        )
    manifest = build_context_manifest(
        manifest_id=command_id, run_id=run_id, task_id=phase["phase_id"],
        role_id=phase["phase_kind"], components=components, policy=policy,
    )
    write_manifest(v2_dir, manifest)
    assert_within_cap(manifest)  # raises PolicyError before any send if over cap

    # -- 3. Budget: atomic evaluate-and-reserve, one provider session, before send
    budget_store = BudgetStore(v2_dir, run_id=run_id)
    session_cap = float(
        (policy.get("orchestration") or {}).get("max_real_provider_sessions_per_run", 12)
    )
    budget_policy = make_budget_policy(
        policy_id="slice4-canary-provider-sessions",
        limits=[
            make_limit(
                limit_id="run-provider-sessions",
                scope_kind="run", scope_id=run_id,
                metric="provider_sessions", native_unit="sessions",
                limit_value=session_cap, action="prohibit",
            )
        ],
        enforcement_mode="hard",
    )
    reservation_outcome = budget_store.evaluate_and_reserve(
        command_id=command_id, policy=budget_policy,
        scopes={"run": run_id}, requests=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}],
        actor_role=phase["phase_kind"],
    )
    if not reservation_outcome["reserved"]:
        raise GovernanceBlocked(
            "budget reservation refused",
            detail={"decision": reservation_outcome["decision"]},
        )

    # -- 4. ApprovalBroker: CAO-level authority decision for this dispatch
    write_capable = bool(phase["write_capable"])
    worktree = phase.get("worktree") or {}
    ownership = phase.get("ownership") or {}
    owned_scope_digest = sha256_json(sorted(ownership.get("allowed_paths") or [worktree.get("path") or policy["repo_root"]]))
    pre_state_digest = sha256_json(pre_state_facts)
    operation_class = CLASS_WRITE_IN_OWNED_SCOPE if write_capable else CLASS_READ_IN_SCOPE

    policy_revision = sha256_json({"orchestration": policy.get("orchestration"), "policy_name": policy.get("policy_name")})
    registry_revision = lock["lock_digest"]
    delegation_revision = sha256_json({"phase_id": phase["phase_id"], "attempt": job.get("attempt")})

    store = ApprovalStore(v2_dir / "approvals-root", project_id=project_id, security_domain_id=security_domain_id)
    broker = ApprovalBroker(
        store, policy_revision=policy_revision, registry_revision=registry_revision,
        delegation_revision=delegation_revision,
        delegated_operation_classes=[CLASS_WRITE_IN_OWNED_SCOPE],
        delegated_scope_digests=[owned_scope_digest],
    )
    intent = new_approval_intent(
        approval_request_id=f"req-{command_id}",
        project_id=project_id, security_domain_id=security_domain_id,
        run_id=run_id, work_package_id=phase["big_task_id"], task_id=phase["phase_id"],
        attempt_id=str(job.get("attempt", 1)), command_id=command_id,
        actor_role=phase["phase_kind"], execution_agent_id=decision["selected_profile"],
        provider_profile_id=decision["selected_profile"],
        repo_id=_slug("repo", str(policy["repo_root"])),
        worktree_id=_slug("worktree", str(worktree.get("path") or policy["repo_root"])),
        owned_scope_digest=owned_scope_digest, expected_pre_state_digest=pre_state_digest,
        operation_class=operation_class, operation_name="provider_dispatch_bounded_phase",
        normalized_arguments={"selected_route": decision.get("selected_route")},
        resource_refs=[{"kind": "worktree", "locator": worktree.get("path") or policy["repo_root"]}],
        policy_revision=policy_revision, registry_revision=registry_revision,
        delegation_revision=delegation_revision, skill_contract_digest=skill_contract_digest,
    )
    store.open_request(intent)
    approval_decision = broker.evaluate(
        intent, decision_id=f"dec-{command_id}",
        owned_scope_digest=owned_scope_digest, current_pre_state_digest=pre_state_digest,
    )
    if approval_decision["outcome"] not in (APPROVED_BY_POLICY, APPROVED_BY_DELEGATION):
        budget_store.release(command_id, certainty="NOT_SENT_CONFIRMED")
        raise GovernanceBlocked(
            "approval broker did not approve the dispatch",
            detail={"decision": approval_decision},
        )

    from .common import atomic_write_json
    record = {
        "schema_version": "1.0",
        "command_id": command_id,
        "skill_contract_digest": skill_contract_digest,
        "context_manifest_id": manifest["manifest_id"],
        "context_manifest_bytes": manifest["serialized_request_bytes"],
        "budget_reservation_id": reservation_outcome["reservation"]["reservation_id"],
        "approval_decision_id": approval_decision["decision_id"],
        "approval_outcome": approval_decision["outcome"],
        "project_id": project_id,
        "security_domain_id": security_domain_id,
    }
    atomic_write_json(governance_dir / "governance-record.json", record)
    return record


def settle_after_send(*, v2_dir: Path, run_id: str, command_id: str, native_units: list[dict[str, Any]]) -> dict[str, Any]:
    budget_store = BudgetStore(v2_dir, run_id=run_id)
    settled = [{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}] + list(native_units)
    return budget_store.settle(command_id, settled=settled)


def release_after_not_sent(*, v2_dir: Path, run_id: str, command_id: str) -> dict[str, Any]:
    budget_store = BudgetStore(v2_dir, run_id=run_id)
    return budget_store.release(command_id, certainty="NOT_SENT_CONFIRMED")


def hold_after_ambiguous(*, v2_dir: Path, run_id: str, command_id: str, reason: str) -> dict[str, Any]:
    budget_store = BudgetStore(v2_dir, run_id=run_id)
    return budget_store.hold(command_id, reason=reason)
