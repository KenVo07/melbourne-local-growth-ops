"""The tracked canonical bundle lock: the single production source of pins.

The generic sealed-cache machinery in :mod:`skill_cache` can govern any bundle
you hand it.  That is a strength for testing and a gap in production, because a
machine that will govern anything needs to be told exactly what it governs.
This module is that instruction: it reads one tracked, digest-sealed lock file
and turns it into the production registry and recipe set.

Three properties are load-bearing:

* **Pins are immutable revisions, never floating refs.**  ``main``, ``latest``,
  a tag name or any other pointer that can be repointed under us is rejected
  outright.  A tag *name* may be recorded as human-readable ``version``
  metadata, but the thing that identifies the bytes is always a full commit
  SHA-1.

* **The approved source set is closed.**  Exactly four external repositories are
  admissible.  A lock that names a fifth is rejected rather than partially
  loaded, so widening the canonical stack requires editing this file - a
  reviewed change - not just dropping a new entry into data.

* **Population needs no semantic choice.**  Every selected skill names one exact
  relative path with one exact digest and byte count.  There is never a set of
  candidate files to choose between at staging time, which is what makes host
  cache population mechanical rather than a judgement call.

No third-party bytes live in this repository.  The lock carries provenance and
digests; the bytes are acquired by the operator tool and sealed into the
CAO-owned cache, with ``~/.agents/skills`` remaining a verify-only mirror.
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Mapping

from .common import ContractError, PolicyError, load_json, sha256_json
from .skill_cache import (
    BUNDLE_KIND_EXTERNAL_ENGINEERING,
    BUNDLE_KIND_SECURITY_PACK,
    new_bundle_manifest,
)
from .skill_recipes import new_recipe
from .skills_registry import CanonicalSkillRegistry, new_skill_record

LOCK_SCHEMA_VERSION = "1.0"

LOCK_FILENAME = "canonical-skill-bundles.lock.json"

#: Where the tracked lock lives in a source checkout.  Resolved relative to this
#: package so the production path never depends on a caller's working directory.
DEFAULT_LOCK_PATH = Path(__file__).resolve().parents[2] / "skills" / LOCK_FILENAME

#: Where ``install.sh`` stages the same file.  The installed library lives
#: outside the source tree, so the source-relative path does not exist there and
#: the staged copy is the one that resolves.
STAGED_LOCK_PATH = (
    Path.home() / ".local" / "share" / "mlgo-cao-v2" / "skills" / LOCK_FILENAME
)

#: Environment override, so an operator can point the tooling at a specific lock
#: without editing anything.  Checked first.
LOCK_PATH_ENV_VAR = "MLGO_CAO_V2_SKILL_LOCK"


def resolve_lock_path(path: str | Path | None = None) -> Path:
    """Resolve which lock file to load, most explicit source first.

    An explicit argument beats the environment, which beats the source
    checkout, which beats the staged copy.  Every candidate is reported when
    none exist, because "lock not found" is otherwise a maddening error to
    debug across source and installed layouts.
    """

    if path is not None:
        return Path(path)
    override = os.environ.get(LOCK_PATH_ENV_VAR)
    candidates = (
        [Path(override)] if override else [DEFAULT_LOCK_PATH, STAGED_LOCK_PATH]
    )
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise CanonicalLockError(
        "canonical bundle lock not found; looked at: "
        + ", ".join(str(c) for c in candidates)
    )

#: The closed set of admissible external sources.  Widening the canonical stack
#: is a reviewed source change, not a data edit.
APPROVED_SOURCE_REPOSITORIES = frozenset({
    "https://github.com/addyosmani/agent-skills",
    "https://github.com/mattpocock/skills",
    "https://github.com/nextlevelbuilder/ui-ux-pro-max-skill",
    "https://github.com/UnitOneAI/SecuritySkills",
})

APPROVED_BUNDLE_IDS = frozenset({
    "bundle-addy-osmani-agent-skills",
    "bundle-matt-pocock-skills",
    "bundle-ui-ux-pro-max",
    "bundle-unitoneai-security-skills",
})

#: The one bundle kind allowed to carry Security Pack precedence.
SECURITY_PACK_BUNDLE_ID = "bundle-unitoneai-security-skills"

_COMMIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")

#: Pointers that look like a pin but are not one.  Listed explicitly so the
#: error message can say *why* a value was refused rather than only that it
#: failed a regex.
_FLOATING_REF_TOKENS = frozenset({
    "main", "master", "head", "latest", "stable", "release", "trunk", "default",
})


class CanonicalLockError(PolicyError):
    """Raised when the tracked lock is missing, altered or not fully pinned."""


def _require_immutable_revision(bundle_id: str, revision: Any, kind: Any) -> str:
    """Reject anything that is not an exact, immutable commit revision."""

    if not isinstance(revision, str) or not revision:
        raise CanonicalLockError(f"bundle {bundle_id!r} has no source_revision")
    if kind != "git_commit_sha1":
        raise CanonicalLockError(
            f"bundle {bundle_id!r} declares unsupported revision kind {kind!r}; "
            "only 'git_commit_sha1' is an immutable pin"
        )
    lowered = revision.strip().lower()
    if lowered in _FLOATING_REF_TOKENS or lowered.startswith("refs/"):
        raise CanonicalLockError(
            f"bundle {bundle_id!r} is pinned to the floating reference {revision!r}; "
            "canonical bundles must be pinned to an exact immutable commit"
        )
    if not _COMMIT_SHA_RE.fullmatch(lowered):
        raise CanonicalLockError(
            f"bundle {bundle_id!r} revision {revision!r} is not a full 40-character "
            "lowercase commit SHA-1; branch names, tags, ranges and abbreviated "
            "SHAs are all rejected because they can be repointed"
        )
    return lowered


def load_lock(path: str | Path | None = None) -> dict[str, Any]:
    """Load and fully validate the tracked canonical bundle lock.

    Validation is total: schema version, self-digest, closed source set, exact
    revision pinning, per-file digest shape, and the derived aggregate digest
    are all checked before any caller sees the data.  A lock that fails any of
    them raises rather than returning a partially trusted structure.
    """

    lock_path = resolve_lock_path(path)
    if not lock_path.is_file():
        raise CanonicalLockError(f"canonical bundle lock not found: {lock_path}")
    lock = load_json(lock_path)

    if lock.get("lock_schema_version") != LOCK_SCHEMA_VERSION:
        raise CanonicalLockError(
            f"unsupported canonical lock schema: {lock.get('lock_schema_version')!r}"
        )

    # The lock states its own digest, so any edit after pinning is detectable
    # without a second file to keep in sync.
    declared_digest = lock.get("lock_digest")
    expected_digest = sha256_json({k: v for k, v in lock.items() if k != "lock_digest"})
    if declared_digest != expected_digest:
        raise CanonicalLockError(
            "canonical bundle lock digest mismatch: the lock was altered after it was "
            f"pinned (declared={declared_digest} derived={expected_digest})"
        )

    bundles = lock.get("bundles") or []
    if not bundles:
        raise CanonicalLockError("canonical bundle lock declares no bundles")

    seen_ids: set[str] = set()
    for bundle in bundles:
        bundle_id = str(bundle.get("bundle_id") or "")
        if bundle_id in seen_ids:
            raise CanonicalLockError(f"bundle {bundle_id!r} appears twice in the lock")
        seen_ids.add(bundle_id)

        if bundle_id not in APPROVED_BUNDLE_IDS:
            raise CanonicalLockError(
                f"bundle {bundle_id!r} is not an approved canonical bundle; the "
                f"approved set is {sorted(APPROVED_BUNDLE_IDS)}"
            )
        repository = bundle.get("source_repository_or_distribution")
        if repository not in APPROVED_SOURCE_REPOSITORIES:
            raise CanonicalLockError(
                f"bundle {bundle_id!r} names unapproved source {repository!r}; the "
                f"approved set is {sorted(APPROVED_SOURCE_REPOSITORIES)}"
            )

        _require_immutable_revision(
            bundle_id, bundle.get("source_revision"), bundle.get("source_revision_kind")
        )

        expected_kind = (
            BUNDLE_KIND_SECURITY_PACK
            if bundle_id == SECURITY_PACK_BUNDLE_ID
            else BUNDLE_KIND_EXTERNAL_ENGINEERING
        )
        if bundle.get("bundle_kind") != expected_kind:
            raise CanonicalLockError(
                f"bundle {bundle_id!r} declares kind {bundle.get('bundle_kind')!r} "
                f"but must be {expected_kind}"
            )

        file_manifest = bundle.get("file_manifest") or []
        if not file_manifest:
            raise CanonicalLockError(f"bundle {bundle_id!r} pins no files")
        paths = [e.get("relative_path") for e in file_manifest]
        if len(set(paths)) != len(paths):
            raise CanonicalLockError(f"bundle {bundle_id!r} pins a path twice")
        for entry in file_manifest:
            digest = str(entry.get("content_digest") or "")
            if len(digest) != 64 or not all(c in "0123456789abcdef" for c in digest):
                raise CanonicalLockError(
                    f"bundle {bundle_id!r} file {entry.get('relative_path')!r} has no "
                    "exact lowercase sha256 digest"
                )
            if not isinstance(entry.get("byte_count"), int) or entry["byte_count"] < 0:
                raise CanonicalLockError(
                    f"bundle {bundle_id!r} file {entry.get('relative_path')!r} has no "
                    "exact byte count"
                )

        derived_aggregate = sha256_json(
            [
                {
                    "relative_path": e["relative_path"],
                    "content_digest": e["content_digest"],
                    "byte_count": e["byte_count"],
                }
                for e in sorted(file_manifest, key=lambda e: e["relative_path"])
            ]
        )
        if bundle.get("aggregate_content_digest") != derived_aggregate:
            raise CanonicalLockError(
                f"bundle {bundle_id!r} aggregate digest does not match its own file "
                f"manifest: declared={bundle.get('aggregate_content_digest')} "
                f"derived={derived_aggregate}"
            )

        # Every selected skill must name exactly one pinned file.  This is the
        # property that makes host population mechanical: there is never a set
        # of candidate paths to choose from at staging time.
        by_path = {e["relative_path"]: e for e in file_manifest}
        selected = bundle.get("selected_skills") or []
        if not selected:
            raise CanonicalLockError(f"bundle {bundle_id!r} selects no skills")
        for skill in selected:
            rel = skill.get("relative_path")
            pinned = by_path.get(rel)
            if pinned is None:
                raise CanonicalLockError(
                    f"skill {skill.get('skill_id')!r} names path {rel!r} which is absent "
                    f"from bundle {bundle_id!r}'s pinned file manifest"
                )
            if (
                skill.get("content_digest") != pinned["content_digest"]
                or skill.get("byte_count") != pinned["byte_count"]
            ):
                raise CanonicalLockError(
                    f"skill {skill.get('skill_id')!r} digest/size disagrees with the "
                    f"pinned file manifest entry for {rel!r}"
                )

    missing = APPROVED_BUNDLE_IDS - seen_ids
    if missing:
        raise CanonicalLockError(
            f"canonical bundle lock is missing approved bundles: {sorted(missing)}"
        )

    security_packs = [
        b for b in bundles
        if b.get("bundle_kind") == BUNDLE_KIND_SECURITY_PACK
        and b.get("qualification_state") == "QUALIFIED"
    ]
    if len(security_packs) != 1:
        raise CanonicalLockError(
            "exactly one qualified Security Pack must be pinned; found "
            f"{sorted(b['bundle_id'] for b in security_packs)}"
        )

    return lock


def bundle_manifests(lock: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Rebuild the sealed-cache bundle manifests from the lock, deterministically.

    ``acquired_at`` comes from the lock rather than the clock so that two
    machines loading the same lock derive byte-identical manifest digests.
    """

    manifests: dict[str, dict[str, Any]] = {}
    for bundle in lock["bundles"]:
        manifest = new_bundle_manifest(
            bundle_id=bundle["bundle_id"],
            bundle_kind=bundle["bundle_kind"],
            source_owner=bundle["source_owner"],
            source_repository_or_distribution=bundle["source_repository_or_distribution"],
            source_revision=bundle["source_revision"],
            version=bundle["version"],
            file_manifest=bundle["file_manifest"],
            skill_ids=bundle["skill_ids"],
            license_id=bundle["license_id"],
            license_text_digest=bundle["license_text_digest"],
            provenance_record=bundle["provenance_record"],
            compatibility=bundle["compatibility"],
            qualification_state=bundle["qualification_state"],
            acquired_at=bundle["acquired_at"],
        )
        if manifest["content_digest"] != bundle["aggregate_content_digest"]:
            raise CanonicalLockError(
                f"bundle {bundle['bundle_id']!r} sealed content digest disagrees with "
                "the aggregate digest recorded in the lock"
            )
        manifests[manifest["bundle_id"]] = manifest
    return manifests


def build_registry(lock: Mapping[str, Any]) -> CanonicalSkillRegistry:
    """Build the production canonical registry from the tracked lock."""

    registry = CanonicalSkillRegistry()
    manifests = bundle_manifests(lock)
    for manifest in manifests.values():
        registry.add_bundle(manifest)

    for bundle in lock["bundles"]:
        for skill in bundle["selected_skills"]:
            registry.add_skill(
                new_skill_record(
                    skill_id=skill["skill_id"],
                    bundle_id=bundle["bundle_id"],
                    bundle_kind=bundle["bundle_kind"],
                    relative_path=skill["relative_path"],
                    content_digest=skill["content_digest"],
                    byte_count=skill["byte_count"],
                    precedence_tier=skill["precedence_tier"],
                    disciplines=skill.get("disciplines", ()),
                    task_classes=skill.get("task_classes", ()),
                    constraints=skill.get("constraints") or {},
                )
            )

    # Structural, not advisory: two packs would reintroduce the same-tier
    # conflict the precedence model exists to prevent.
    registry.assert_single_security_pack()
    return registry


def build_recipes(lock: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Build the production canonical recipes from the tracked lock."""

    known = {
        skill["skill_id"]
        for bundle in lock["bundles"]
        for skill in bundle["selected_skills"]
    }
    recipes: dict[str, dict[str, Any]] = {}
    for spec in lock["recipes"]:
        referenced = set(spec["required_skill_ids"]) | set(spec.get("optional_skill_ids") or [])
        dangling = sorted(referenced - known)
        if dangling:
            raise CanonicalLockError(
                f"recipe {spec['recipe_id']!r} references skill ids that are not pinned "
                f"by any canonical bundle: {dangling}"
            )
        recipes[spec["recipe_id"]] = new_recipe(
            recipe_id=spec["recipe_id"],
            recipe_version=spec["recipe_version"],
            role=spec["role"],
            family=spec["family"],
            task_classes=spec["task_classes"],
            risk_classes=spec["risk_classes"],
            required_skill_ids=spec["required_skill_ids"],
            optional_skill_ids=spec.get("optional_skill_ids") or (),
            selection_conditions=spec.get("selection_conditions") or {},
            maximum_skill_count=spec["maximum_skill_count"],
            maximum_skill_bytes=spec["maximum_skill_bytes"],
        )
    return recipes


def population_plan(lock: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The complete, ordered set of acquisitions host staging must perform.

    Every entry is fully determined by the lock: one source revision, one exact
    path, one expected digest, one expected size.  Nothing here requires a
    choice, which is the point - staging executes this plan, it does not
    interpret it.
    """

    plan: list[dict[str, Any]] = []
    for bundle in sorted(lock["bundles"], key=lambda b: b["bundle_id"]):
        for entry in sorted(bundle["file_manifest"], key=lambda e: e["relative_path"]):
            plan.append(
                {
                    "bundle_id": bundle["bundle_id"],
                    "source_repository_or_distribution": bundle[
                        "source_repository_or_distribution"
                    ],
                    "source_revision": bundle["source_revision"],
                    "relative_path": entry["relative_path"],
                    "expected_content_digest": entry["content_digest"],
                    "expected_byte_count": entry["byte_count"],
                }
            )
    return plan
