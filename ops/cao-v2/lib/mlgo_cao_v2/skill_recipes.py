"""Deterministic role/task recipe compilation into a bound SkillContract.

Compilation happens *before* dispatch and produces the complete, minimal set of
skills a worker will be given.  The worker is never asked to discover, choose,
install or configure anything, and normal canonical skill use never depends on
a runtime skill-loading tool call, because by the time the worker exists the
decision has already been made and digested.

Two design choices carry most of the weight:

* **Conflicts fail closed, never merge.**  Concatenating two contradictory
  instructions and hoping the model picks the right one is the single most
  likely way for a skill stack to quietly disable a control.  So a
  contradiction at the same precedence tier stops compilation, and a
  contradiction across tiers resolves strictly by tier with the loser recorded
  as an explicit exclusion.

* **The result is a value, not a process.**  Identical facts and an identical
  registry revision produce a byte-identical contract with identical reason
  codes, so the contract digest is a meaningful binding for approvals and run
  evidence rather than a timestamped snapshot that never repeats.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from .common import ContractError, PolicyError, iso_now, sha256_json, validate_id
from .skill_cache import FORBIDDEN_OVERRIDE_CLASSES, SkillIntegrityError
from .skills_registry import (
    PRECEDENCE_TIERS,
    RECIPE_FAMILIES,
    TIER_CAO_PROTOCOL,
    TIER_TASK_LOCAL,
    CanonicalSkillRegistry,
    SkillAuthorityConflict,
)

RECIPE_SCHEMA_VERSION = "1.0"
SKILL_CONTRACT_SCHEMA_VERSION = "1.0"

REASON_REQUIRED = "SELECTED_REQUIRED_BY_RECIPE"
REASON_OPTIONAL_SELECTED = "SELECTED_OPTIONAL_CONDITION_MET"
REASON_OPTIONAL_CONDITION_UNMET = "EXCLUDED_OPTIONAL_CONDITION_UNMET"
REASON_EXCLUDED_SKILL_COUNT = "EXCLUDED_MAXIMUM_SKILL_COUNT"
REASON_EXCLUDED_SKILL_BYTES = "EXCLUDED_MAXIMUM_SKILL_BYTES"
REASON_CONSTRAINT_SUPERSEDED = "CONSTRAINT_SUPERSEDED_BY_HIGHER_PRECEDENCE"


class RecipeConflictError(PolicyError):
    """Raised when a recipe cannot be compiled without guessing."""


def new_recipe(
    *,
    recipe_id: str,
    recipe_version: str,
    role: str,
    family: str,
    task_classes: Iterable[str],
    risk_classes: Iterable[str],
    required_skill_ids: Iterable[str],
    optional_skill_ids: Iterable[str] = (),
    maximum_skill_count: int = 6,
    maximum_skill_bytes: int = 128 * 1024,
    selection_conditions: Mapping[str, Iterable[str]] | None = None,
    approval_policy_refs: Iterable[str] = (),
    expected_output_contract: str = "result_packet_v2",
) -> dict[str, Any]:
    """Build one canonical role/task recipe.

    ``selection_conditions`` maps an optional skill id to the task or risk
    classes that justify including it.  Making inclusion conditional on
    declared facts - rather than on a model's judgement at runtime - is what
    makes the resulting selection reproducible.
    """

    validate_id(recipe_id, "recipe_id")
    if family not in RECIPE_FAMILIES:
        raise ContractError(f"unknown canonical recipe family: {family!r}")
    required = sorted({str(s) for s in required_skill_ids})
    optional = sorted({str(s) for s in optional_skill_ids})
    overlap = sorted(set(required) & set(optional))
    if overlap:
        raise ContractError(f"skills cannot be both required and optional: {overlap}")
    if maximum_skill_count < 1 or maximum_skill_bytes < 1:
        raise ContractError("recipe limits must be positive")

    conditions = {
        str(k): sorted({str(v) for v in vals})
        for k, vals in sorted((selection_conditions or {}).items())
    }
    unknown = sorted(set(conditions) - set(optional))
    if unknown:
        raise ContractError(
            f"selection conditions reference skills that are not optional: {unknown}"
        )

    recipe = {
        "schema_version": RECIPE_SCHEMA_VERSION,
        "recipe_id": recipe_id,
        "recipe_version": recipe_version,
        "role": role,
        "family": family,
        "task_classes": sorted({str(t) for t in task_classes}),
        "risk_classes": sorted({str(r) for r in risk_classes}),
        "required_skill_ids": required,
        "optional_skill_ids": optional,
        "maximum_skill_count": int(maximum_skill_count),
        "maximum_skill_bytes": int(maximum_skill_bytes),
        "precedence_rules": [
            {"tier": tier, "label": label} for tier, label in sorted(PRECEDENCE_TIERS.items())
        ],
        "conflict_rules": [
            "SAME_TIER_CONTRADICTION_FAILS_CLOSED",
            "CROSS_TIER_CONTRADICTION_RESOLVES_BY_TIER",
            "NO_LAST_TEXT_WINS_MERGE",
            "PROTECTED_CLASS_OVERRIDE_FAILS_CLOSED",
        ],
        "selection_conditions": conditions,
        "approval_policy_refs": sorted({str(a) for a in approval_policy_refs}),
        "expected_output_contract": expected_output_contract,
    }
    recipe["recipe_digest"] = sha256_json(
        {k: v for k, v in recipe.items() if k != "recipe_digest"}
    )
    return recipe


def _resolve_constraints(
    selected: list[Mapping[str, Any]],
    *,
    task_local_guidance: Mapping[str, Any],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Resolve declared constraints strictly by precedence tier.

    Returns the effective constraint set and the list of superseded assertions.
    A same-tier contradiction raises rather than returning, because there is no
    principled way to choose and choosing arbitrarily would be worse than
    stopping.
    """

    assertions: dict[str, list[dict[str, Any]]] = {}
    for skill in selected:
        for key, value in (skill.get("constraints") or {}).items():
            assertions.setdefault(key, []).append(
                {
                    "skill_id": skill["skill_id"],
                    "tier": int(skill["precedence_tier"]),
                    "value": value,
                }
            )

    for key, value in sorted(task_local_guidance.items()):
        # Task-local guidance is the weakest tier and is explicitly
        # non-authoritative.  It attempting to touch a protected class is a
        # compilation failure, not a quietly ignored line.
        if key in FORBIDDEN_OVERRIDE_CLASSES:
            raise SkillAuthorityConflict(
                f"task-local guidance may not assert the protected constraint class {key!r}"
            )
        assertions.setdefault(key, []).append(
            {"skill_id": "task_local_guidance", "tier": TIER_TASK_LOCAL, "value": value}
        )

    effective: dict[str, Any] = {}
    superseded: list[dict[str, Any]] = []

    for key in sorted(assertions):
        claims = sorted(
            assertions[key], key=lambda c: (c["tier"], str(c["skill_id"]))
        )
        best_tier = claims[0]["tier"]
        top = [c for c in claims if c["tier"] == best_tier]
        distinct = {sha256_json(c["value"]) for c in top}
        if len(distinct) > 1:
            raise RecipeConflictError(
                f"irreconcilable same-precedence conflict on constraint {key!r} at tier "
                f"{best_tier} ({PRECEDENCE_TIERS[best_tier]}) between "
                f"{sorted(c['skill_id'] for c in top)}; recipe compilation fails closed "
                "rather than merging contradictory guidance"
            )
        effective[key] = top[0]["value"]
        for claim in claims:
            if claim["tier"] != best_tier:
                superseded.append(
                    {
                        "constraint": key,
                        "skill_id": claim["skill_id"],
                        "tier": claim["tier"],
                        "winning_tier": best_tier,
                        "winning_skill_id": top[0]["skill_id"],
                        "reason_code": REASON_CONSTRAINT_SUPERSEDED,
                    }
                )

    return dict(sorted(effective.items())), superseded


def compile_skill_contract(
    *,
    registry: CanonicalSkillRegistry,
    cache: Any,
    recipe: Mapping[str, Any],
    project_id: str,
    security_domain_id: str,
    role: str,
    task_class: str,
    risk_class: str,
    work_package_facts: Mapping[str, Any] | None = None,
    task_local_guidance: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Compile one minimal, sealed, digest-bound SkillContract before dispatch.

    Every required skill is resolved through the sealed cache inside this
    project's namespace, which proves the bytes exist and match their pinned
    digests.  A missing or mismatched skill stops compilation here - before any
    model dispatch could occur - rather than surfacing later as a worker that
    silently lacked a control.
    """

    if recipe.get("schema_version") != RECIPE_SCHEMA_VERSION:
        raise ContractError(f"unsupported recipe schema: {recipe.get('schema_version')!r}")
    expected_recipe_digest = sha256_json(
        {k: v for k, v in recipe.items() if k != "recipe_digest"}
    )
    if recipe.get("recipe_digest") != expected_recipe_digest:
        raise ContractError("recipe digest mismatch: the recipe was altered after pinning")

    facts = dict(work_package_facts or {})
    guidance = dict(task_local_guidance or {})
    selection_facts = {task_class, risk_class} | {
        str(v) for v in facts.get("selection_tags", []) or []
    }

    reasons: list[dict[str, Any]] = []
    exclusions: list[dict[str, Any]] = []

    # 1. Required skills: resolved and proven, no exceptions.
    required_records: list[dict[str, Any]] = []
    for skill_id in recipe["required_skill_ids"]:
        record = registry.skill(skill_id)
        _prove_sealed(
            cache=cache,
            record=record,
            project_id=project_id,
            security_domain_id=security_domain_id,
        )
        required_records.append(record)
        reasons.append({"skill_id": skill_id, "reason_code": REASON_REQUIRED})

    # 2. Optional skills: included only when their declared condition is met.
    candidate_optional: list[dict[str, Any]] = []
    for skill_id in recipe["optional_skill_ids"]:
        conditions = set(recipe["selection_conditions"].get(skill_id, []))
        if conditions and not (conditions & selection_facts):
            exclusions.append(
                {
                    "skill_id": skill_id,
                    "reason_code": REASON_OPTIONAL_CONDITION_UNMET,
                    "required_any_of": sorted(conditions),
                }
            )
            continue
        record = registry.skill(skill_id)
        _prove_sealed(
            cache=cache,
            record=record,
            project_id=project_id,
            security_domain_id=security_domain_id,
        )
        candidate_optional.append(record)

    # 3. Enforce the minimal-recipe limits deterministically.
    required_bytes = sum(int(r["byte_count"]) for r in required_records)
    if len(required_records) > int(recipe["maximum_skill_count"]):
        raise RecipeConflictError(
            f"recipe {recipe['recipe_id']!r} requires {len(required_records)} skills but "
            f"permits at most {recipe['maximum_skill_count']}"
        )
    if required_bytes > int(recipe["maximum_skill_bytes"]):
        raise RecipeConflictError(
            f"recipe {recipe['recipe_id']!r} required skills total {required_bytes} bytes "
            f"but the recipe permits at most {recipe['maximum_skill_bytes']}"
        )

    selected = list(required_records)
    running_bytes = required_bytes
    # Stable ordering by (tier, skill_id) makes the truncation point a function
    # of the inputs rather than of dict iteration order.
    for record in sorted(
        candidate_optional, key=lambda r: (int(r["precedence_tier"]), str(r["skill_id"]))
    ):
        if len(selected) >= int(recipe["maximum_skill_count"]):
            exclusions.append(
                {"skill_id": record["skill_id"], "reason_code": REASON_EXCLUDED_SKILL_COUNT}
            )
            continue
        if running_bytes + int(record["byte_count"]) > int(recipe["maximum_skill_bytes"]):
            exclusions.append(
                {"skill_id": record["skill_id"], "reason_code": REASON_EXCLUDED_SKILL_BYTES}
            )
            continue
        selected.append(record)
        running_bytes += int(record["byte_count"])
        reasons.append(
            {"skill_id": record["skill_id"], "reason_code": REASON_OPTIONAL_SELECTED}
        )

    selected.sort(key=lambda r: (int(r["precedence_tier"]), str(r["skill_id"])))

    # 4. Resolve constraints by precedence, failing closed on real conflicts.
    effective_constraints, superseded = _resolve_constraints(
        selected, task_local_guidance=guidance
    )

    # 5. Prove no external skill ended up asserting a protected class.
    for skill in selected:
        if int(skill["precedence_tier"]) > TIER_CAO_PROTOCOL:
            overreach = sorted(set(skill.get("constraints") or {}) & set(FORBIDDEN_OVERRIDE_CLASSES))
            if overreach:
                raise SkillAuthorityConflict(
                    f"skill {skill['skill_id']!r} asserts protected constraint classes "
                    f"{overreach} above its tier"
                )

    contract = {
        "schema_version": SKILL_CONTRACT_SCHEMA_VERSION,
        "project_id": project_id,
        "security_domain_id": security_domain_id,
        "recipe_id": recipe["recipe_id"],
        "recipe_version": recipe["recipe_version"],
        "recipe_digest": recipe["recipe_digest"],
        "registry_revision": registry.registry_revision,
        "role": role,
        "family": recipe["family"],
        "task_class": task_class,
        "risk_class": risk_class,
        "selected_skills": [
            {
                "skill_id": r["skill_id"],
                "bundle_id": r["bundle_id"],
                "bundle_kind": r["bundle_kind"],
                "relative_path": r["relative_path"],
                "content_digest": r["content_digest"],
                "byte_count": int(r["byte_count"]),
                "precedence_tier": int(r["precedence_tier"]),
                "precedence_label": r["precedence_label"],
            }
            for r in selected
        ],
        "selection_reason_codes": sorted(
            reasons, key=lambda x: (str(x["skill_id"]), str(x["reason_code"]))
        ),
        "exclusions": sorted(
            exclusions, key=lambda x: (str(x["skill_id"]), str(x["reason_code"]))
        ),
        "superseded_constraints": sorted(
            superseded, key=lambda x: (str(x["constraint"]), str(x["skill_id"]))
        ),
        "effective_constraints": effective_constraints,
        "total_skill_count": len(selected),
        "total_skill_bytes": running_bytes,
        "maximum_skill_count": int(recipe["maximum_skill_count"]),
        "maximum_skill_bytes": int(recipe["maximum_skill_bytes"]),
        "bundle_refs": sorted(
            {
                (r["bundle_id"], registry.bundle(r["bundle_id"])["content_digest"])
                for r in selected
            }
        ),
        "requires_runtime_skill_loading": False,
        "selected_before_dispatch": True,
    }
    # ``compiled_at`` is deliberately outside the digest: two compilations of
    # the same facts must be byte-identical in everything that binds.
    contract["skill_contract_digest"] = sha256_json(contract)
    contract["compiled_at"] = iso_now()
    return contract


def _prove_sealed(
    *,
    cache: Any,
    record: Mapping[str, Any],
    project_id: str,
    security_domain_id: str,
) -> None:
    """Prove one skill's bytes are sealed, present and digest-correct."""

    resolved = cache.resolve(
        bundle_id=record["bundle_id"],
        project_id=project_id,
        security_domain_id=security_domain_id,
    )
    for entry in resolved["files"]:
        if entry["relative_path"] == record["relative_path"]:
            if entry["content_digest"] != record["content_digest"]:
                raise SkillIntegrityError(
                    f"skill {record['skill_id']!r} digest disagrees with sealed content: "
                    f"registry={record['content_digest']} sealed={entry['content_digest']}"
                )
            return
    raise SkillIntegrityError(
        f"skill {record['skill_id']!r} path {record['relative_path']!r} is absent from "
        f"sealed bundle {record['bundle_id']!r}"
    )


def project_effective_profile(contract: Mapping[str, Any]) -> dict[str, Any]:
    """Derive the disposable profile projection a worker is launched with.

    This projection is never a second source of truth.  It carries the contract
    digest it was derived from and can be thrown away and rebuilt at any time,
    so a drifted or deleted profile is a rebuild rather than an authority
    question.
    """

    projection = {
        "schema_version": "1.0",
        "derived_from_skill_contract_digest": contract["skill_contract_digest"],
        "project_id": contract["project_id"],
        "security_domain_id": contract["security_domain_id"],
        "role": contract["role"],
        # The exact, ordered skill scope handed to the native harness.  Selection
        # already happened; the worker receives a closed list.
        "skills": [s["skill_id"] for s in contract["selected_skills"]],
        "skill_digests": {
            s["skill_id"]: s["content_digest"] for s in contract["selected_skills"]
        },
        "disposable": True,
        "rebuildable_from_contract": True,
    }
    projection["projection_digest"] = sha256_json(projection)
    return projection
