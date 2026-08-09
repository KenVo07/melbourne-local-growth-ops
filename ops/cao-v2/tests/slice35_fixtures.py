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


# --------------------------------------------------------------------------
# Synthetic canonical-lock fixtures
# --------------------------------------------------------------------------
#
# The tracked lock at ops/cao-v2/skills/canonical-skill-bundles.lock.json pins
# real upstream bytes, which the gates deliberately do not fetch.  So the
# fault-injection cases below build a lock with the *same shape*, the same
# approved bundle ids, repositories and real pinned revisions, but synthetic
# file content whose digests we can therefore both seal and corrupt offline.
#
# Structural facts (which sources are admissible, that pins must be immutable,
# that exactly one Security Pack exists) are asserted against the real tracked
# lock; only byte-level drift injection uses these.

SYNTHETIC_LOCK_ACQUIRED_AT = "2026-08-10T00:00:00Z"

_SYNTHETIC_BUNDLE_SPECS = (
    (
        "bundle-addy-osmani-agent-skills",
        "EXTERNAL_ENGINEERING",
        "addyosmani",
        "https://github.com/addyosmani/agent-skills",
        "bdf76c7c6b7b3b3e01bb15c9fdc42ac5351855c1",
        "0.6.6",
        TIER_ENGINEERING,
        (("addy-incremental-implementation", "skills/incremental-implementation/SKILL.md"),
         ("addy-code-review-and-quality", "skills/code-review-and-quality/SKILL.md")),
    ),
    (
        "bundle-matt-pocock-skills",
        "EXTERNAL_ENGINEERING",
        "mattpocock",
        "https://github.com/mattpocock/skills",
        "6acc160e4e0cd062dbbbd7a1b26ae92855edf07e",
        "v1.2.3",
        TIER_ENGINEERING,
        (("matt-implement", "skills/engineering/implement/SKILL.md"),
         ("matt-code-review", "skills/engineering/code-review/SKILL.md")),
    ),
    (
        "bundle-ui-ux-pro-max",
        "EXTERNAL_ENGINEERING",
        "nextlevelbuilder",
        "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
        "abb7f2fd5a083fa1ff55c326a963ff0d95c33f99",
        "v2.14.1",
        TIER_ENGINEERING,
        (("uiux-ui-ux-pro-max", ".claude/skills/ui-ux-pro-max/SKILL.md"),),
    ),
    (
        "bundle-unitoneai-security-skills",
        "SECURITY_PACK",
        "UnitOneAI",
        "https://github.com/UnitOneAI/SecuritySkills",
        "70bc259bb01abb3015ad2ad859ad5253cbf0bcab",
        "UNVERSIONED_AT_PIN",
        TIER_SECURITY_PACK,
        (("sec-threat-modeling", "skills/appsec/threat-modeling/SKILL.md"),
         ("sec-secure-code-review", "skills/appsec/secure-code-review/SKILL.md")),
    ),
)

_SYNTHETIC_LOCK_RECIPES = (
    {
        "recipe_id": "recipe-implementation-backend",
        "recipe_version": "1.0.0",
        "role": "developer",
        "family": FAMILY_IMPLEMENTATION_BACKEND,
        "task_classes": ["implementation"],
        "risk_classes": ["standard", "elevated"],
        "required_skill_ids": ["addy-incremental-implementation", "matt-implement"],
        "optional_skill_ids": ["addy-code-review-and-quality"],
        "selection_conditions": {"addy-code-review-and-quality": ["review"]},
        "maximum_skill_count": 4,
        "maximum_skill_bytes": 65536,
    },
    {
        "recipe_id": "recipe-security-sensitive-change",
        "recipe_version": "1.0.0",
        "role": "developer",
        "family": FAMILY_SECURITY_SENSITIVE_CHANGE,
        "task_classes": ["security"],
        "risk_classes": ["elevated", "critical"],
        "required_skill_ids": ["sec-threat-modeling", "sec-secure-code-review"],
        "optional_skill_ids": [],
        "selection_conditions": {},
        "maximum_skill_count": 4,
        "maximum_skill_bytes": 65536,
    },
)


def synthetic_lock_contents() -> dict[str, dict[str, bytes]]:
    """The synthetic bytes each synthetic bundle pins, keyed by bundle id."""

    return {
        bundle_id: {
            path: skill_bytes(skill_id, f"synthetic canonical content for {skill_id}")
            for skill_id, path in skills
        }
        for bundle_id, _, _, _, _, _, _, skills in _SYNTHETIC_BUNDLE_SPECS
    }


def synthetic_lock() -> dict[str, Any]:
    """A structurally real, byte-synthetic canonical bundle lock."""

    contents = synthetic_lock_contents()
    bundles = []
    for (
        bundle_id, kind, owner, repository, revision, version, tier, skills
    ) in _SYNTHETIC_BUNDLE_SPECS:
        files = contents[bundle_id]
        file_manifest = sorted(
            (
                {
                    "relative_path": path,
                    "content_digest": sha256_bytes(data),
                    "byte_count": len(data),
                }
                for path, data in files.items()
            ),
            key=lambda e: e["relative_path"],
        )
        selected = sorted(
            (
                {
                    "skill_id": skill_id,
                    "relative_path": path,
                    "content_digest": sha256_bytes(files[path]),
                    "byte_count": len(files[path]),
                    "precedence_tier": tier,
                    "disciplines": ["synthetic"],
                    "task_classes": ["implementation"],
                    "constraints": {},
                    "native_mirror_name": path.rsplit("/", 2)[-2],
                }
                for skill_id, path in skills
            ),
            key=lambda s: s["skill_id"],
        )
        bundles.append(
            {
                "bundle_id": bundle_id,
                "bundle_kind": kind,
                "display_name": bundle_id,
                "source_owner": owner,
                "source_repository_or_distribution": repository,
                "source_revision": revision,
                "source_revision_kind": "git_commit_sha1",
                "version": version,
                "version_ref": "UNVERSIONED_AT_PIN",
                "license_id": "MIT",
                "license_relative_path": "LICENSE",
                "license_text_digest": sha256_bytes(b"MIT synthetic license text"),
                "license_byte_count": 26,
                "acquired_at": SYNTHETIC_LOCK_ACQUIRED_AT,
                "provenance_record": {"acquired_by": "synthetic_fixture", "verified": True},
                "compatibility": {
                    "min_cao_contract_version": "0.4.0",
                    "supported_roles": ["developer", "reviewer", "architect"],
                },
                "qualification_state": "QUALIFIED",
                "native_mirror_root": "~/.agents/skills",
                "skill_ids": sorted(s["skill_id"] for s in selected),
                "selected_skills": selected,
                "file_manifest": file_manifest,
                "total_byte_count": sum(e["byte_count"] for e in file_manifest),
                "aggregate_content_digest": sha256_json(file_manifest),
            }
        )

    bundles.sort(key=lambda b: b["bundle_id"])
    lock = {
        "lock_schema_version": "1.0",
        "lock_id": "mlgo-cao-v2-canonical-skill-bundles",
        "description": "synthetic fixture lock",
        "generated_at": SYNTHETIC_LOCK_ACQUIRED_AT,
        "approved_source_repositories": sorted(
            b["source_repository_or_distribution"] for b in bundles
        ),
        "approved_bundle_ids": sorted(b["bundle_id"] for b in bundles),
        "security_pack_bundle_id": "bundle-unitoneai-security-skills",
        "security_pack_required_coverage": ["threat_modeling"],
        "bundles": bundles,
        "recipes": [dict(r) for r in _SYNTHETIC_LOCK_RECIPES],
    }
    return reseal_lock(lock)


def reseal_lock(lock: Mapping[str, Any]) -> dict[str, Any]:
    """Recompute a lock's self-digest after a fixture mutated it.

    Fault-injection tests use this to prove that drift is caught by *content*
    checks rather than only by the self-digest: a mutation that is resealed
    still has to be rejected somewhere else.
    """

    body = {k: v for k, v in lock.items() if k != "lock_digest"}
    return {**body, "lock_digest": sha256_json(body)}


def seal_synthetic_lock(cache: SealedSkillCache, lock: Mapping[str, Any]) -> None:
    """Seal and bind every synthetic-lock bundle into one namespace."""

    from mlgo_cao_v2.canonical_lock import bundle_manifests

    contents = synthetic_lock_contents()
    for bundle_id, manifest in bundle_manifests(lock).items():
        cache.seal_bundle(manifest, contents[bundle_id])


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
