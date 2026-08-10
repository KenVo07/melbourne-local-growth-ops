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

import json
import os
import re
import subprocess
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
from .common import ContractError, atomic_write_json, atomic_write_text, iso_now, sha256_bytes, sha256_file, sha256_json
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


def build_native_skill_projection(
    *, cache: SealedSkillCache, skill_contract: dict[str, Any],
    project_id: str, security_domain_id: str,
) -> tuple[str, str]:
    """Render the exact, digest-bound instruction bytes a SkillContract selected.

    This is what makes the SkillContract control the provider execution
    context rather than merely document it: the returned text is the *only*
    skill-instruction material a governed child session receives (see
    ``child_provider_transport``), assembled from bytes read straight out of
    the sealed cache - the same bytes the contract's ``content_digest``
    entries already proved. Deterministic ordering (by skill_id) means two
    compilations of the same contract produce byte-identical projections.
    """

    sections: list[str] = []
    for skill in sorted(skill_contract.get("selected_skills", []), key=lambda s: s["skill_id"]):
        resolved = cache.resolve(
            bundle_id=skill["bundle_id"], project_id=project_id, security_domain_id=security_domain_id,
        )
        data = cache.read_file(resolved=resolved, relative_path=skill["relative_path"])
        if sha256_bytes(data) != skill["content_digest"]:
            raise ContractError(
                f"native skill projection: {skill['skill_id']!r} bytes disagree with the "
                "compiled SkillContract's content_digest"
            )
        sections.append(
            f"--- CAO canonical skill: {skill['skill_id']} "
            f"(bundle={skill['bundle_id']} digest={skill['content_digest'][:16]}) ---\n"
            + data.decode("utf-8", errors="replace")
        )
    projection_text = "\n\n".join(sections)
    projection_digest = sha256_bytes(projection_text.encode("utf-8"))
    return projection_text, projection_digest


def scoped_tool_permission_refs(
    *, provider: str, operation_class: str, worktree_path: str,
) -> dict[str, Any]:
    """Translate the dispatch's operation class into each provider's own
    native, non-interactive tool/permission scoping - descriptive
    references carried on the EffectiveProviderRequest, not authority in
    themselves (the ApprovalBroker decision is the authority; this is what
    that decision gets turned into on the provider's own CLI surface).
    """

    if provider == "claude_code":
        if operation_class == CLASS_WRITE_IN_OWNED_SCOPE:
            return {
                "permission_mode": "acceptEdits",
                "allowed_tools": [f"Write({worktree_path}/**)", f"Edit({worktree_path}/**)", "Read", "Glob", "Grep"],
            }
        return {"permission_mode": "default", "allowed_tools": ["Read", "Glob", "Grep"]}
    if provider == "codex":
        sandbox = "workspace-write" if operation_class == CLASS_WRITE_IN_OWNED_SCOPE else "read-only"
        return {"sandbox": sandbox}
    return {}


def build_effective_provider_request(
    *,
    prompt_text: str,
    native_skill_projection_text: str,
    operation_class: str,
    route_identity: dict[str, Any],
    tool_permission_refs: dict[str, Any],
) -> dict[str, Any]:
    """The one canonical CAO-controlled request representation.

    Everything downstream renders from this object and nothing else: the
    ContextEnvelope measures ``rendered_text`` verbatim, and the transport
    sends ``rendered_text`` verbatim - it may not invent, prepend, or append
    any further prompt text of its own.  That is what makes the
    ContextEnvelope's byte count and the bytes actually sent the same
    number, by construction rather than by two independently-written pieces
    of code happening to agree.
    """

    sections: list[str] = []
    if native_skill_projection_text:
        sections.append(
            "The following are CAO-selected canonical skill instructions for "
            "this task. Follow them for guidance on this task only.\n\n"
            + native_skill_projection_text
        )
    sections.append(prompt_text)
    rendered_text = ("\n\n---\n\n".join(sections)) if len(sections) > 1 else sections[0]

    payload = {
        "schema_version": "1.0",
        "rendered_text": rendered_text,
        "operation_class": operation_class,
        "route_identity": dict(route_identity),
        "tool_permission_refs": dict(tool_permission_refs),
    }
    payload["effective_request_digest"] = sha256_json(
        {k: v for k, v in payload.items() if k != "effective_request_digest"}
    )
    return payload


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
    native_skill_projection_text = ""
    native_skill_projection_digest = sha256_bytes(b"")
    if selection is not None:
        recipe, task_class = selection
        risk_class = recipe["risk_classes"][0]
        skill_contract = compile_skill_contract(
            registry=registry, cache=cache, recipe=recipe,
            project_id=project_id, security_domain_id=security_domain_id,
            role=recipe["role"], task_class=task_class, risk_class=risk_class,
        )
        skill_contract_digest = skill_contract["skill_contract_digest"]
        atomic_write_json(governance_dir / "skill-contract.json", skill_contract)

        # The projection is what actually reaches the provider (see
        # child_provider_transport); write it alongside the contract so the
        # exact bytes sent are independently inspectable, not just their digest.
        native_skill_projection_text, native_skill_projection_digest = build_native_skill_projection(
            cache=cache, skill_contract=skill_contract,
            project_id=project_id, security_domain_id=security_domain_id,
        )
        atomic_write_text(governance_dir / "native-skill-projection.txt", native_skill_projection_text)

    # -- 2. Build the one canonical EffectiveProviderRequest, then measure
    # and cap *exactly that*. The transport (child_provider_transport) is
    # required to send ``rendered_text`` verbatim and invent no further
    # prompt text of its own, so this measurement and the bytes actually
    # sent are the same by construction, not by two call sites agreeing.
    write_capable = bool(phase["write_capable"])
    operation_class = CLASS_WRITE_IN_OWNED_SCOPE if write_capable else CLASS_READ_IN_SCOPE
    worktree = phase.get("worktree") or {}
    worktree_path = str(worktree.get("path") or policy["repo_root"])
    tool_permission_refs = scoped_tool_permission_refs(
        provider=str(decision.get("selected_provider") or ""),
        operation_class=operation_class, worktree_path=worktree_path,
    )
    route_identity = {
        "route_id": decision.get("selected_route"),
        "provider_id": decision.get("selected_provider"),
        "profile_id": decision.get("selected_profile"),
    }
    effective_request = build_effective_provider_request(
        prompt_text=prompt_text, native_skill_projection_text=native_skill_projection_text,
        operation_class=operation_class, route_identity=route_identity,
        tool_permission_refs=tool_permission_refs,
    )
    atomic_write_json(governance_dir / "effective-provider-request.json", effective_request)

    components = [
        component(
            kind="objective_task", component_id="effective-provider-request",
            text=effective_request["rendered_text"], reducible=False, retention_rank=5,
        ),
    ]
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
    ownership = phase.get("ownership") or {}
    owned_scope_digest = sha256_json(sorted(ownership.get("allowed_paths") or [worktree.get("path") or policy["repo_root"]]))
    pre_state_digest = sha256_json(pre_state_facts)

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

    record = {
        "schema_version": "1.2",
        "command_id": command_id,
        "skill_contract_digest": skill_contract_digest,
        "skill_contract_path": str(governance_dir / "skill-contract.json") if skill_contract is not None else None,
        "native_skill_projection_digest": native_skill_projection_digest,
        "native_skill_projection_bytes": len(native_skill_projection_text.encode("utf-8")),
        "native_skill_projection_path": str(governance_dir / "native-skill-projection.txt") if native_skill_projection_text else None,
        "effective_provider_request_digest": effective_request["effective_request_digest"],
        "effective_provider_request_path": str(governance_dir / "effective-provider-request.json"),
        "operation_class": operation_class,
        "context_manifest_id": manifest["manifest_id"],
        "context_manifest_bytes": manifest["serialized_request_bytes"],
        "context_manifest_status": manifest["status"],
        "budget_reservation_id": reservation_outcome["reservation"]["reservation_id"],
        "approval_decision_id": approval_decision["decision_id"],
        "approval_outcome": approval_decision["outcome"],
        "approved_operation_constraints": approval_decision.get("approved_operation_constraints"),
        "project_id": project_id,
        "security_domain_id": security_domain_id,
        "owned_scope_digest": owned_scope_digest,
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


# ---------------------------------------------------------------------------
# The live child-provider dispatch path (closes the PermissionAdapter and
# SkillContract-application gaps): govern, then actually launch the real
# provider through child_provider_transport, never bypassed.
#
# Qualification has no self-certification path. There is no function in this
# module a caller can hand an arbitrary evidence hash to. The only way a
# QUALIFIED record is ever written is _record_qualification_from_evidence,
# which computes evidence_sha256 itself from real raw provider output bytes
# it was handed - never from a caller-supplied digest. And provider/wrapper
# identity is measured from the actually-resolved executable (real
# ``--version`` output, real file hash of the installed wrapper script), not
# trusted from a caller-supplied version string.
# ---------------------------------------------------------------------------

def _permission_qualifications_dir(policy: dict[str, Any]) -> Path:
    return Path(policy["state_root"]) / "governance" / "permission-adapter-qualifications"


def load_qualification(*, policy: dict[str, Any], adapter_id: str) -> dict[str, Any] | None:
    path = _permission_qualifications_dir(policy) / f"{adapter_id}.json"
    if not path.is_file():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _record_qualification_from_evidence(
    *, policy: dict[str, Any], adapter: Any, raw_evidence_bytes: bytes,
) -> dict[str, Any]:
    """The only path to a QUALIFIED record: derived entirely from real raw
    provider output bytes this exact adapter identity actually produced."""

    from .permission_adapter import CAP_NATIVE_PREAUTHORIZATION, MATURITY_QUALIFIED, new_adapter_qualification

    identity = adapter.identity()
    evidence_sha256 = sha256_bytes(raw_evidence_bytes)
    qualification = new_adapter_qualification(
        qualification_id=f"qual-{identity['identity_digest'][:16]}",
        identity=identity,
        capabilities={CAP_NATIVE_PREAUTHORIZATION: MATURITY_QUALIFIED},
        evidence_sha256=evidence_sha256,
    )
    path = _permission_qualifications_dir(policy) / f"{adapter.adapter_id}.json"
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write_json(path, qualification)
    return qualification


def resolve_provider_executable(*, registry_profile: dict[str, Any], provider: str) -> Path:
    """Resolve the real, lane-specific launcher the selected route/profile
    actually names - never a bare ``claude``/``codex`` off PATH.

    ``claudeExecutable`` / ``codexExecutable`` in the profile's own
    frontmatter (the same field the legacy backend reads) names one of the
    installed ``mlgo-claude-*`` / ``mlgo-codex-*`` wrapper scripts, which
    themselves pin the correct isolated config/auth root, sanitize
    conflicting environment, and attest the resolved account before
    executing the real binary. Using that wrapper (not the bare provider
    CLI) is what makes the actual provider identity/config correspond to the
    route CAO selected, not merely to whatever happens to be on PATH.
    """

    field = "claudeExecutable" if provider == "claude_code" else "codexExecutable"
    frontmatter = registry_profile.get("frontmatter") or ""
    match = re.search(rf"(?m)^{field}:\s*(\S+)\s*$", frontmatter)
    if not match:
        raise ContractError(
            f"profile {registry_profile.get('profile_id')!r} frontmatter does not declare {field}"
        )
    exe = Path.home() / ".local" / "bin" / match.group(1)
    if not exe.is_file():
        raise ContractError(
            f"profile {registry_profile.get('profile_id')!r} resolves to a missing executable: {exe}"
        )
    return exe


def measure_provider_identity(*, executable_path: Path, env: dict[str, str]) -> dict[str, Any]:
    """Determine provider/wrapper version from the actual launched
    executable and config - never trusted from a caller-supplied string.

    ``provider_version`` comes from actually running the resolved wrapper
    with ``--version`` (the wrapper forwards this straight to the real
    binary after its own auth preflight). ``wrapper_version`` is the SHA-256
    of the exact installed wrapper script bytes, so any edit to the wrapper
    itself - not just a provider CLI upgrade - changes the measured identity.
    """

    proc = subprocess.run(
        [str(executable_path), "--version"], capture_output=True, text=True, timeout=30, env=env, check=False,
    )
    provider_version = (proc.stdout or proc.stderr or "").strip() or f"unknown(exit={proc.returncode})"
    return {
        "provider_version": provider_version,
        "wrapper_version": sha256_file(executable_path),
        "executable_path": str(executable_path),
        "measured_at": iso_now(),
    }


def dispatch_via_child_transport(
    *,
    phase: dict[str, Any],
    decision: dict[str, Any],
    job: dict[str, Any],
    policy: dict[str, Any],
    prompt_text: str,
    v2_dir: Path,
    job_dir: Path,
    pre_state_facts: dict[str, Any],
    provider: str,
    registry: Any,
) -> dict[str, Any]:
    """Govern, then actually dispatch through the real, non-bypassed child
    provider transport - the corrected live path for S4-A/S4-C, using the
    exact executable/config the selected route/profile names.

    Qualification: if this exact measured identity (adapter_id +
    provider_version + wrapper_version + observation-map config, all inside
    ``identity_digest``) has never been qualified, this call proceeds as an
    explicit, evidence-recording qualification ceremony - clearly labeled as
    such in the returned record and in durable evidence - rather than
    silently pretending to already be trusted. Authority to dispatch at all
    comes from the ApprovalBroker decision (independent of this), and
    non-bypass is enforced unconditionally by the transport regardless of
    qualification state; what qualification state controls is only whether
    this call's own outcome is *recorded* as confirming the mechanism.  If a
    qualification exists for a *different* identity (drift: a provider
    upgrade, a changed wrapper), this fails closed rather than silently
    re-ceremonying over it.
    """

    from .approval_broker import ApprovalStore
    from .registry import profile as registry_profile
    from .permission_adapter import CAP_NATIVE_PREAUTHORIZATION, effective_permission_capability
    from .child_provider_transport import ChildProcessTransportAdapter, ClaudeCliPermissionAdapter, CodexCliPermissionAdapter

    prof = registry_profile(registry, decision["selected_profile"])
    executable_path = resolve_provider_executable(registry_profile=prof, provider=provider)
    mlgo_env = {
        **os.environ,
        "MLGO_RUN_ID": phase["run_id"], "MLGO_TASK_ID": phase["phase_id"],
        "MLGO_PROFILE_NAME": decision["selected_profile"], "MLGO_ROLE": phase["phase_kind"],
    }
    identity_facts = measure_provider_identity(executable_path=executable_path, env=mlgo_env)

    adapter_cls = ClaudeCliPermissionAdapter if provider == "claude_code" else CodexCliPermissionAdapter
    adapter = adapter_cls(
        adapter_id=f"cao-child-direct-{provider}",
        provider_profile_id=decision["selected_profile"],
        provider_version=identity_facts["provider_version"],
        wrapper_version=identity_facts["wrapper_version"],
        declared_capabilities=[CAP_NATIVE_PREAUTHORIZATION],
    )
    existing_qualification = load_qualification(policy=policy, adapter_id=adapter.adapter_id)
    capability_state = effective_permission_capability(
        qualification=existing_qualification, current_identity=adapter.identity(),
        capability=CAP_NATIVE_PREAUTHORIZATION, policy_enabled=True,
    )
    if existing_qualification is not None and capability_state["stale"]:
        raise GovernanceBlocked(
            "existing PermissionAdapter qualification is stale for this measured identity "
            "(provider/wrapper drift) - re-qualify explicitly before authority-bearing use",
            detail={"capability_state": capability_state, "existing_qualification": existing_qualification, "identity_facts": identity_facts},
        )
    ceremony_mode = not capability_state["enabled"]

    governance_record = govern_before_send(
        phase=phase, decision=decision, job=job, policy=policy, prompt_text=prompt_text,
        v2_dir=v2_dir, job_dir=job_dir, pre_state_facts=pre_state_facts,
    )

    project_id, security_domain_id = project_and_domain_for_run(phase["run_id"])
    store = ApprovalStore(v2_dir / "approvals-root", project_id=project_id, security_domain_id=security_domain_id)
    full_decision = store.load_decision(governance_record["approval_decision_id"])
    if full_decision is None:
        raise ContractError("approval decision vanished between governance and dispatch")

    worktree = phase.get("worktree") or {}
    worktree_path = str(worktree.get("path") or policy["repo_root"])
    effective_request = json.loads(Path(governance_record["effective_provider_request_path"]).read_text(encoding="utf-8"))

    child_evidence_dir = job_dir / "child-transport"
    child_evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    atomic_write_json(child_evidence_dir / "identity-facts.json", identity_facts)
    transport = ChildProcessTransportAdapter(
        provider=provider, worktree_path=worktree_path, evidence_dir=child_evidence_dir,
        executable_path=executable_path, env=mlgo_env,
    )
    submit_result = transport.submit(
        command={"command_id": job["job_id"]},
        request={
            "approval_decision": full_decision,
            "permission_adapter": adapter,
            "capability_state": capability_state,
            "effective_request": effective_request,
            "ceremony_mode": ceremony_mode,
        },
    )

    qualification = existing_qualification
    if ceremony_mode and not submit_result.response.get("denied") and submit_result.response["observation"]["observed_state"] not in ("UNKNOWN_RECONCILIATION_REQUIRED",):
        raw_stdout_path = child_evidence_dir / "raw-stdout.jsonl"
        qualification = _record_qualification_from_evidence(
            policy=policy, adapter=adapter, raw_evidence_bytes=raw_stdout_path.read_bytes(),
        )

    return {
        "governance_record": governance_record,
        "submit_result": submit_result,
        "adapter_identity": adapter.identity(),
        "capability_state": capability_state,
        "identity_facts": identity_facts,
        "ceremony_mode": ceremony_mode,
        "qualification": qualification,
    }
