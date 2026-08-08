"""The single authoritative registry of canonical skills and their precedence.

This registry is deliberately *closed*.  It knows about exactly four external
sources - the fixed canonical engineering stack plus one qualified Security
Pack - and internal CAO protocols.  There is no discovery path, no install
path, and no way for a worker to add to it.  That closure is the difference
between a knowledge contract and a marketplace.

Every skill carries a precedence tier and, optionally, a set of declared
constraints.  Both are registry facts rather than anything parsed out of skill
prose, because a skill that could describe its own authority in its own text
would be able to promote itself.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from .common import ContractError, PolicyError, iso_now, sha256_json, validate_id
from .skill_cache import (
    BUNDLE_KIND_INTERNAL_CAO,
    BUNDLE_KIND_SECURITY_PACK,
    FORBIDDEN_OVERRIDE_CLASSES,
    validate_bundle_manifest,
)

SKILL_REGISTRY_SCHEMA_VERSION = "1.0"

# -- precedence tiers (1 is strongest) --------------------------------------

TIER_HOST_POLICY = 1
TIER_CAO_PROTOCOL = 2
TIER_SECURITY_PACK = 3
TIER_ENGINEERING = 4
TIER_TASK_LOCAL = 5

PRECEDENCE_TIERS = {
    TIER_HOST_POLICY: "HOST_POLICY_AND_AUTHORITY_INVARIANTS",
    TIER_CAO_PROTOCOL: "INTERNAL_CAO_PROTOCOLS",
    TIER_SECURITY_PACK: "FOCUSED_SECURITY_PACK",
    TIER_ENGINEERING: "CANONICAL_ENGINEERING_GUIDANCE",
    TIER_TASK_LOCAL: "TASK_LOCAL_NON_AUTHORITATIVE",
}

#: Bundle kind -> the strongest tier a skill from that kind may claim.  A bundle
#: cannot promote its own skills past this ceiling, which is what stops an
#: external pack from asserting protocol- or policy-level authority.
_TIER_CEILING_BY_KIND = {
    BUNDLE_KIND_INTERNAL_CAO: TIER_CAO_PROTOCOL,
    BUNDLE_KIND_SECURITY_PACK: TIER_SECURITY_PACK,
    "EXTERNAL_ENGINEERING": TIER_ENGINEERING,
}

# -- canonical recipe families ---------------------------------------------

FAMILY_IMPLEMENTATION_BACKEND = "implementation_backend"
FAMILY_DIFFICULT_BUG_DIAGNOSIS = "difficult_bug_diagnosis"
FAMILY_ARCHITECTURE_DESIGN = "architecture_design"
FAMILY_FRONTEND_BUILD = "frontend_build"
FAMILY_FRONTEND_REVIEW = "frontend_review"
FAMILY_SECURITY_SENSITIVE_CHANGE = "security_sensitive_change"
FAMILY_CODE_REVIEW = "code_review"
FAMILY_HANDOFF_RECOVERY = "handoff_recovery"

RECIPE_FAMILIES = (
    FAMILY_IMPLEMENTATION_BACKEND,
    FAMILY_DIFFICULT_BUG_DIAGNOSIS,
    FAMILY_ARCHITECTURE_DESIGN,
    FAMILY_FRONTEND_BUILD,
    FAMILY_FRONTEND_REVIEW,
    FAMILY_SECURITY_SENSITIVE_CHANGE,
    FAMILY_CODE_REVIEW,
    FAMILY_HANDOFF_RECOVERY,
)


class SkillAuthorityConflict(PolicyError):
    """Raised when a skill tries to speak above its station."""


def new_skill_record(
    *,
    skill_id: str,
    bundle_id: str,
    bundle_kind: str,
    relative_path: str,
    content_digest: str,
    byte_count: int,
    precedence_tier: int,
    disciplines: Iterable[str] = (),
    task_classes: Iterable[str] = (),
    constraints: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Register one skill with an explicit tier and declared constraints."""

    validate_id(skill_id, "skill_id")
    validate_id(bundle_id, "bundle_id")
    if precedence_tier not in PRECEDENCE_TIERS:
        raise ContractError(f"unknown precedence tier: {precedence_tier!r}")

    ceiling = _TIER_CEILING_BY_KIND.get(bundle_kind)
    if ceiling is None:
        raise ContractError(f"unknown bundle kind for skill {skill_id!r}: {bundle_kind!r}")
    if precedence_tier < ceiling:
        raise SkillAuthorityConflict(
            f"skill {skill_id!r} from a {bundle_kind} bundle may not claim precedence tier "
            f"{precedence_tier} ({PRECEDENCE_TIERS[precedence_tier]}); the strongest tier "
            f"available to that bundle kind is {ceiling} ({PRECEDENCE_TIERS[ceiling]})"
        )

    declared = dict(constraints or {})
    # A skill from outside the CAO protocol tier may not assert any constraint
    # in a protected class, regardless of what value it asserts.  Checking the
    # class rather than the value is deliberate: "authority = unchanged" is
    # still an assertion of authority.
    if precedence_tier > TIER_CAO_PROTOCOL:
        overreach = sorted(set(declared) & set(FORBIDDEN_OVERRIDE_CLASSES))
        if overreach:
            raise SkillAuthorityConflict(
                f"skill {skill_id!r} at tier {precedence_tier} may not assert protected "
                f"constraint classes: {overreach}"
            )

    record = {
        "skill_id": skill_id,
        "bundle_id": bundle_id,
        "bundle_kind": bundle_kind,
        "relative_path": relative_path,
        "content_digest": content_digest,
        "byte_count": int(byte_count),
        "precedence_tier": int(precedence_tier),
        "precedence_label": PRECEDENCE_TIERS[precedence_tier],
        "disciplines": sorted({str(d) for d in disciplines}),
        "task_classes": sorted({str(t) for t in task_classes}),
        "constraints": dict(sorted(declared.items())),
    }
    record["skill_digest"] = sha256_json(record)
    return record


class CanonicalSkillRegistry:
    """A closed, digest-identified registry of canonical bundles and skills."""

    def __init__(self) -> None:
        self._bundles: dict[str, dict[str, Any]] = {}
        self._skills: dict[str, dict[str, Any]] = {}

    def add_bundle(self, manifest: Mapping[str, Any]) -> dict[str, Any]:
        validate_bundle_manifest(manifest)
        bundle_id = str(manifest["bundle_id"])
        existing = self._bundles.get(bundle_id)
        if existing and existing["content_digest"] != manifest["content_digest"]:
            raise PolicyError(
                f"bundle {bundle_id!r} registered twice with different content digests"
            )
        self._bundles[bundle_id] = dict(manifest)
        return dict(manifest)

    def add_skill(self, record: Mapping[str, Any]) -> dict[str, Any]:
        skill_id = str(record["skill_id"])
        bundle_id = str(record["bundle_id"])
        if bundle_id not in self._bundles:
            raise ContractError(
                f"skill {skill_id!r} references unregistered bundle {bundle_id!r}"
            )
        manifest = self._bundles[bundle_id]
        if skill_id not in manifest["skill_ids"]:
            raise ContractError(
                f"skill {skill_id!r} is not declared by bundle {bundle_id!r}"
            )
        declared_paths = {e["relative_path"] for e in manifest["file_manifest"]}
        if record["relative_path"] not in declared_paths:
            raise ContractError(
                f"skill {skill_id!r} references a path absent from bundle {bundle_id!r}"
            )
        existing = self._skills.get(skill_id)
        if existing and existing["skill_digest"] != record["skill_digest"]:
            raise PolicyError(f"skill {skill_id!r} registered twice with different content")
        self._skills[skill_id] = dict(record)
        return dict(record)

    # -- reads -------------------------------------------------------------

    def skill(self, skill_id: str) -> dict[str, Any]:
        try:
            return dict(self._skills[skill_id])
        except KeyError as exc:
            raise ContractError(f"unknown canonical skill: {skill_id!r}") from exc

    def bundle(self, bundle_id: str) -> dict[str, Any]:
        try:
            return dict(self._bundles[bundle_id])
        except KeyError as exc:
            raise ContractError(f"unknown canonical bundle: {bundle_id!r}") from exc

    def skills(self) -> list[dict[str, Any]]:
        return [dict(v) for _, v in sorted(self._skills.items())]

    def bundles(self) -> list[dict[str, Any]]:
        return [dict(v) for _, v in sorted(self._bundles.items())]

    def security_pack_bundles(self) -> list[dict[str, Any]]:
        return [
            b for b in self.bundles() if b["bundle_kind"] == BUNDLE_KIND_SECURITY_PACK
        ]

    def assert_single_security_pack(self) -> dict[str, Any] | None:
        """Exactly one Security Pack may be active at a time.

        Two packs would reintroduce the same-tier conflict problem the whole
        precedence model exists to avoid, so the constraint is structural.
        """

        packs = [
            b for b in self.security_pack_bundles()
            if b.get("qualification_state") == "QUALIFIED"
        ]
        if len(packs) > 1:
            raise PolicyError(
                "more than one qualified Security Pack is registered: "
                f"{sorted(p['bundle_id'] for p in packs)}"
            )
        return packs[0] if packs else None

    @property
    def registry_revision(self) -> str:
        """A digest over everything that could change a compilation result."""

        return sha256_json(
            {
                "schema_version": SKILL_REGISTRY_SCHEMA_VERSION,
                "bundles": {
                    b["bundle_id"]: b["manifest_digest"] for b in self.bundles()
                },
                "skills": {s["skill_id"]: s["skill_digest"] for s in self.skills()},
            }
        )

    def snapshot(self) -> dict[str, Any]:
        return {
            "schema_version": SKILL_REGISTRY_SCHEMA_VERSION,
            "registry_revision": self.registry_revision,
            "bundle_ids": sorted(self._bundles),
            "skill_ids": sorted(self._skills),
            "generated_at": iso_now(),
        }
