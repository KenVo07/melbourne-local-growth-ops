"""Deterministic synthetic fixtures for the Slice 3.5 gates.

Every byte here is synthetic.  The gates must be reproducible offline, on any
host, with no provider process, no network fetch and no dependency on what
happens to be installed in ``~/.agents/skills``.  Real canonical sources are
pinned by revision in the supply-chain evidence, not exercised by tests.

Provider permission behaviour is likewise fixture-driven: the fake adapters
below emit evidence tokens and the real normalization path maps them, so the
tests exercise the actual adapter contract rather than a mock of it.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from mlgo_cao_v2.approval import (
    new_approval_intent,
    normalize_arguments,
)
from mlgo_cao_v2.approval_broker import (
    CLASS_READ_IN_SCOPE,
    CLASS_WRITE_IN_OWNED_SCOPE,
)
from mlgo_cao_v2.common import sha256_bytes, sha256_json
from mlgo_cao_v2.permission_adapter import (
    CAP_EXPLICIT_DENY,
    CAP_NATIVE_PREAUTHORIZATION,
    CAP_ONE_SHOT_APPROVAL,
    CAP_RECONCILIATION,
    CAP_REMEMBER_STATE_PRESENCE,
    CAP_WAIT_STATE_OBSERVATION,
    MATURITY_QUALIFIED,
    PermissionAdapter,
    new_adapter_qualification,
)
from mlgo_cao_v2.skill_cache import (
    BUNDLE_KIND_EXTERNAL_ENGINEERING,
    BUNDLE_KIND_INTERNAL_CAO,
    BUNDLE_KIND_SECURITY_PACK,
    SealedSkillCache,
    new_bundle_manifest,
)
from mlgo_cao_v2.skill_recipes import new_recipe
from mlgo_cao_v2.skills_registry import (
    FAMILY_IMPLEMENTATION_BACKEND,
    FAMILY_SECURITY_SENSITIVE_CHANGE,
    TIER_CAO_PROTOCOL,
    TIER_ENGINEERING,
    TIER_SECURITY_PACK,
    CanonicalSkillRegistry,
    new_skill_record,
)

POLICY_REVISION = "policy-rev-1"
REGISTRY_REVISION = "registry-rev-1"
DELEGATION_REVISION = "delegation-rev-1"

OWNED_SCOPE_DIGEST = sha256_json(["apps/demo/src", "apps/demo/tests"])
PRE_STATE_DIGEST = sha256_json({"head": "a" * 40, "dirty": False})
SKILL_CONTRACT_DIGEST = sha256_json({"fixture": "skill-contract"})

#: Three synthetic projects that deliberately collide on every identifier that
#: is not the isolation boundary itself.
PROJECTS = ("project-alpha", "project-beta", "project-gamma")
DOMAINS = ("domain-alpha", "domain-beta", "domain-gamma")


# --------------------------------------------------------------------------
# Synthetic skill bundles
# --------------------------------------------------------------------------

def skill_bytes(skill_id: str, body: str) -> bytes:
    """Deterministic synthetic SKILL.md content."""

    return (
        f"---\nname: {skill_id}\ndescription: synthetic fixture skill\n---\n\n{body}\n"
    ).encode("utf-8")


def make_bundle(
    *,
    bundle_id: str,
    bundle_kind: str,
    files: Mapping[str, bytes],
    skill_ids: Iterable[str],
    source_owner: str = "synthetic",
    source_revision: str = "0" * 40,
    version: str = "1.0.0",
    license_id: str = "MIT",
    qualification_state: str = "QUALIFIED",
) -> dict[str, Any]:
    """Build a manifest whose digests are derived from the supplied bytes."""

    file_manifest = [
        {
            "relative_path": path,
            "content_digest": sha256_bytes(data),
            "byte_count": len(data),
        }
        for path, data in sorted(files.items())
    ]
    return new_bundle_manifest(
        bundle_id=bundle_id,
        bundle_kind=bundle_kind,
        source_owner=source_owner,
        source_repository_or_distribution=f"https://example.invalid/{bundle_id}",
        source_revision=source_revision,
        version=version,
        file_manifest=file_manifest,
        skill_ids=skill_ids,
        license_id=license_id,
        license_text_digest=sha256_bytes(b"MIT synthetic license text"),
        provenance_record={
            "acquired_by": "operator_controlled_build_time_import",
            "verified": True,
        },
        compatibility={
            "min_cao_contract_version": "0.4.0",
            "supported_roles": ["developer", "reviewer", "architect"],
        },
        qualification_state=qualification_state,
    )


CAO_FILES = {
    "cao-worker-protocols/SKILL.md": skill_bytes(
        "cao-worker-protocols", "Internal CAO worker protocol. Authority is host-owned."
    ),
    "cao-handoff-recovery/SKILL.md": skill_bytes(
        "cao-handoff-recovery", "Internal CAO handoff and recovery protocol."
    ),
}

ENGINEERING_FILES = {
    "engineering-implementation/SKILL.md": skill_bytes(
        "engineering-implementation", "Incremental implementation guidance."
    ),
    "engineering-debugging/SKILL.md": skill_bytes(
        "engineering-debugging", "Difficult bug diagnosis guidance."
    ),
    "engineering-typescript/SKILL.md": skill_bytes(
        "engineering-typescript", "Type-level design guidance."
    ),
    "engineering-frontend-ui/SKILL.md": skill_bytes(
        "engineering-frontend-ui", "UI and UX design intelligence."
    ),
    "engineering-code-review/SKILL.md": skill_bytes(
        "engineering-code-review", "Code review guidance."
    ),
    "engineering-architecture/SKILL.md": skill_bytes(
        "engineering-architecture", "Architecture and interface design guidance."
    ),
}

SECURITY_FILES = {
    "security-threat-modeling/SKILL.md": skill_bytes(
        "security-threat-modeling", "Threat modeling guidance."
    ),
    "security-code-review/SKILL.md": skill_bytes(
        "security-code-review", "Security-focused code review guidance."
    ),
}


def cao_bundle() -> dict[str, Any]:
    return make_bundle(
        bundle_id="bundle-cao-protocols",
        bundle_kind=BUNDLE_KIND_INTERNAL_CAO,
        files=CAO_FILES,
        skill_ids=["cao-worker-protocols", "cao-handoff-recovery"],
        source_owner="mlgo",
    )


def engineering_bundle() -> dict[str, Any]:
    return make_bundle(
        bundle_id="bundle-engineering",
        bundle_kind=BUNDLE_KIND_EXTERNAL_ENGINEERING,
        files=ENGINEERING_FILES,
        skill_ids=[
            "engineering-implementation",
            "engineering-debugging",
            "engineering-typescript",
            "engineering-frontend-ui",
            "engineering-code-review",
            "engineering-architecture",
        ],
    )


def security_bundle() -> dict[str, Any]:
    return make_bundle(
        bundle_id="bundle-security-pack",
        bundle_kind=BUNDLE_KIND_SECURITY_PACK,
        files=SECURITY_FILES,
        skill_ids=["security-threat-modeling", "security-code-review"],
    )


ALL_FILES = {**CAO_FILES, **ENGINEERING_FILES, **SECURITY_FILES}


def seal_all(cache: SealedSkillCache) -> dict[str, dict[str, Any]]:
    """Seal the three canonical fixture bundles into a cache."""

    manifests = {}
    for manifest, files in (
        (cao_bundle(), CAO_FILES),
        (engineering_bundle(), ENGINEERING_FILES),
        (security_bundle(), SECURITY_FILES),
    ):
        manifests[manifest["bundle_id"]] = cache.seal_bundle(manifest, files)
    return manifests


def bind_all(cache: SealedSkillCache, *, project_id: str, security_domain_id: str) -> None:
    for bundle_id in ("bundle-cao-protocols", "bundle-engineering", "bundle-security-pack"):
        cache.bind_bundle(
            bundle_id=bundle_id,
            project_id=project_id,
            security_domain_id=security_domain_id,
        )


def build_registry(manifests: Mapping[str, Mapping[str, Any]]) -> CanonicalSkillRegistry:
    """Register the fixture bundles with explicit tiers and constraints."""

    registry = CanonicalSkillRegistry()
    for manifest in manifests.values():
        registry.add_bundle(manifest)

    def digest_of(bundle_id: str, path: str) -> tuple[str, int]:
        manifest = manifests[bundle_id]
        for entry in manifest["file_manifest"]:
            if entry["relative_path"] == path:
                return entry["content_digest"], entry["byte_count"]
        raise KeyError(path)

    def add(skill_id, bundle_id, path, tier, disciplines=(), task_classes=(), constraints=None):
        digest, size = digest_of(bundle_id, path)
        registry.add_skill(
            new_skill_record(
                skill_id=skill_id,
                bundle_id=bundle_id,
                bundle_kind=manifests[bundle_id]["bundle_kind"],
                relative_path=path,
                content_digest=digest,
                byte_count=size,
                precedence_tier=tier,
                disciplines=disciplines,
                task_classes=task_classes,
                constraints=constraints,
            )
        )

    add("cao-worker-protocols", "bundle-cao-protocols", "cao-worker-protocols/SKILL.md",
        TIER_CAO_PROTOCOL, ("protocol",), ("implementation", "review"),
        {"authority": "host_owned", "evidence_style": "structured_result_packet"})
    add("cao-handoff-recovery", "bundle-cao-protocols", "cao-handoff-recovery/SKILL.md",
        TIER_CAO_PROTOCOL, ("protocol",), ("handoff",), {"recovery": "checkpoint_bound"})

    add("security-threat-modeling", "bundle-security-pack",
        "security-threat-modeling/SKILL.md", TIER_SECURITY_PACK, ("security",),
        ("security",), {"input_trust": "untrusted_by_default"})
    add("security-code-review", "bundle-security-pack", "security-code-review/SKILL.md",
        TIER_SECURITY_PACK, ("security",), ("security", "review"),
        {"review_depth": "security_first"})

    add("engineering-implementation", "bundle-engineering",
        "engineering-implementation/SKILL.md", TIER_ENGINEERING, ("backend",),
        ("implementation",), {"increment_size": "small"})
    add("engineering-debugging", "bundle-engineering", "engineering-debugging/SKILL.md",
        TIER_ENGINEERING, ("diagnosis",), ("debugging",), {"hypothesis_discipline": "explicit"})
    add("engineering-typescript", "bundle-engineering", "engineering-typescript/SKILL.md",
        TIER_ENGINEERING, ("types",), ("implementation",), {"type_strategy": "infer_first"})
    add("engineering-frontend-ui", "bundle-engineering", "engineering-frontend-ui/SKILL.md",
        TIER_ENGINEERING, ("frontend",), ("frontend",), {"design_source": "token_driven"})
    add("engineering-code-review", "bundle-engineering", "engineering-code-review/SKILL.md",
        TIER_ENGINEERING, ("review",), ("review",), {"review_depth": "correctness_first"})
    add("engineering-architecture", "bundle-engineering",
        "engineering-architecture/SKILL.md", TIER_ENGINEERING, ("architecture",),
        ("architecture",), {"interface_first": True})
    return registry


def implementation_recipe(**overrides: Any) -> dict[str, Any]:
    kwargs: dict[str, Any] = dict(
        recipe_id="recipe-implementation-backend",
        recipe_version="1.0.0",
        role="developer",
        family=FAMILY_IMPLEMENTATION_BACKEND,
        task_classes=["implementation"],
        risk_classes=["standard", "elevated"],
        required_skill_ids=["cao-worker-protocols", "engineering-implementation"],
        optional_skill_ids=["engineering-typescript", "engineering-debugging"],
        selection_conditions={
            "engineering-typescript": ["implementation"],
            "engineering-debugging": ["debugging"],
        },
        maximum_skill_count=4,
        maximum_skill_bytes=64 * 1024,
    )
    kwargs.update(overrides)
    return new_recipe(**kwargs)


def security_recipe(**overrides: Any) -> dict[str, Any]:
    kwargs: dict[str, Any] = dict(
        recipe_id="recipe-security-sensitive",
        recipe_version="1.0.0",
        role="developer",
        family=FAMILY_SECURITY_SENSITIVE_CHANGE,
        task_classes=["security"],
        risk_classes=["elevated", "critical"],
        required_skill_ids=[
            "cao-worker-protocols",
            "security-threat-modeling",
            "security-code-review",
        ],
        optional_skill_ids=["engineering-code-review"],
        selection_conditions={"engineering-code-review": ["review"]},
        maximum_skill_count=5,
        maximum_skill_bytes=64 * 1024,
    )
    kwargs.update(overrides)
    return new_recipe(**kwargs)


# --------------------------------------------------------------------------
# Approval fixtures
# --------------------------------------------------------------------------

def an_intent(
    *,
    approval_request_id: str = "req-1",
    project_id: str = PROJECTS[0],
    security_domain_id: str = DOMAINS[0],
    operation_class: str = CLASS_READ_IN_SCOPE,
    operation_name: str = "read_repository_file",
    arguments: Mapping[str, Any] | None = None,
    command_id: str = "cmd-1",
    task_id: str = "task-1",
    owned_scope_digest: str = OWNED_SCOPE_DIGEST,
    expected_pre_state_digest: str = PRE_STATE_DIGEST,
    policy_revision: str = POLICY_REVISION,
    registry_revision: str = REGISTRY_REVISION,
    delegation_revision: str = DELEGATION_REVISION,
    skill_contract_digest: str = SKILL_CONTRACT_DIGEST,
    executor_epoch: int | None = 1,
    expires_at: str | None = None,
    one_shot: bool = True,
) -> dict[str, Any]:
    return new_approval_intent(
        approval_request_id=approval_request_id,
        project_id=project_id,
        security_domain_id=security_domain_id,
        run_id="run-1",
        work_package_id="wp-1",
        task_id=task_id,
        attempt_id="attempt-1",
        command_id=command_id,
        actor_role="developer",
        execution_agent_id="agent-1",
        provider_profile_id="profile-fixture",
        repo_id="repo-1",
        worktree_id="wt-1",
        owned_scope_digest=owned_scope_digest,
        expected_pre_state_digest=expected_pre_state_digest,
        operation_class=operation_class,
        operation_name=operation_name,
        normalized_arguments=normalize_arguments(arguments or {"path": "apps/demo/src/a.ts"}),
        resource_refs=[{"kind": "file", "locator": "apps/demo/src/a.ts"}],
        policy_revision=policy_revision,
        registry_revision=registry_revision,
        delegation_revision=delegation_revision,
        skill_contract_digest=skill_contract_digest,
        executor_epoch=executor_epoch,
        expires_at=expires_at,
        one_shot=one_shot,
    )


def current_context(intent: Mapping[str, Any], **overrides: Any) -> dict[str, Any]:
    """The observed authority context used for pre-application revalidation."""

    from mlgo_cao_v2.approval import REVALIDATED_BINDINGS

    current = {field: intent.get(field) for field in REVALIDATED_BINDINGS}
    current.update(overrides)
    return current


def delegated_broker_args() -> dict[str, Any]:
    return {
        "policy_revision": POLICY_REVISION,
        "registry_revision": REGISTRY_REVISION,
        "delegation_revision": DELEGATION_REVISION,
        "delegated_operation_classes": [CLASS_WRITE_IN_OWNED_SCOPE],
        "delegated_scope_digests": [OWNED_SCOPE_DIGEST],
    }


# --------------------------------------------------------------------------
# Permission adapter fixtures
# --------------------------------------------------------------------------

#: A deliberately opaque, provider-agnostic token vocabulary.  These strings
#: stand in for whatever a real provider emits; the point of the fixture is that
#: the core never sees them.
FIXTURE_OBSERVATION_MAP = {
    "fixture.permission.not_required": "NOT_REQUIRED",
    "fixture.permission.preauthorized": "PREAUTHORIZED",
    "fixture.permission.awaiting_user": "WAITING_FOR_APPROVAL",
    "fixture.permission.granted": "APPROVED",
    "fixture.permission.refused": "DENIED",
}

#: The same adapter after a provider wording change: the tokens moved, so the
#: old vocabulary must no longer resolve.
FIXTURE_OBSERVATION_MAP_V2 = {
    "fixture.permission.v2.not_required": "NOT_REQUIRED",
    "fixture.permission.v2.preauthorized": "PREAUTHORIZED",
    "fixture.permission.v2.awaiting_user": "WAITING_FOR_APPROVAL",
    "fixture.permission.v2.granted": "APPROVED",
    "fixture.permission.v2.refused": "DENIED",
}

FIXTURE_CAPABILITIES = (
    CAP_NATIVE_PREAUTHORIZATION,
    CAP_ONE_SHOT_APPROVAL,
    CAP_EXPLICIT_DENY,
    CAP_WAIT_STATE_OBSERVATION,
    CAP_RECONCILIATION,
    CAP_REMEMBER_STATE_PRESENCE,
)


def an_adapter(
    *,
    adapter_id: str = "adapter-fixture",
    provider_version: str = "1.0.0",
    wrapper_version: str = "1.0.0",
    observation_map: Mapping[str, str] | None = None,
) -> PermissionAdapter:
    return PermissionAdapter(
        adapter_id=adapter_id,
        provider_profile_id="profile-fixture",
        provider_version=provider_version,
        wrapper_version=wrapper_version,
        observation_map=dict(observation_map or FIXTURE_OBSERVATION_MAP),
        declared_capabilities=FIXTURE_CAPABILITIES,
    )


def a_qualification(adapter: PermissionAdapter, **overrides: Any) -> dict[str, Any]:
    capabilities = {cap: MATURITY_QUALIFIED for cap in adapter.declared_capabilities}
    kwargs: dict[str, Any] = dict(
        qualification_id="qual-fixture",
        identity=adapter.identity(),
        capabilities=capabilities,
        evidence_sha256=sha256_bytes(b"synthetic conformance evidence"),
    )
    kwargs.update(overrides)
    return new_adapter_qualification(**kwargs)


def evidence(token: str, **extra: Any) -> dict[str, Any]:
    return {"token": token, **extra}
