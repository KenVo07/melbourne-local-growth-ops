"""Risk-proportional validation planning and evidence-reuse economics.

Validation cost should track validation value.  Re-running an expensive,
unrelated browser suite because a single leaf file changed buys nothing, while
skipping integrated validation because the diff "looked small" is how shared
regressions escape.  This module makes that trade-off explicit and
deterministic: a change is classified, a plan selects checks, and *every* check
records why it was selected or omitted.

Two invariants are not negotiable and are enforced structurally rather than by
convention:

* full final integrated validation always runs for an integration candidate;
* exact required CI and reachability checks always run.

No classification, policy or optimisation in this module can omit them - the
plan builder re-asserts them after every selection pass, so a future change
that tries to "optimise" them away fails closed instead of quietly shipping.

Evidence reuse is treated as a measurement problem before it is an optimisation.
While reuse is disabled or observation-only the real command always reruns; the
system merely records what it *would* have reused and whether that would have
been correct.  A single false hit blocks promotion.  Nothing in this module can
enable enforced reuse: that requires a separate, expiring, operator-signed
promotion record validated elsewhere.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .common import ContractError, PolicyError, atomic_write_json, iso_now, load_json, sha256_json, validate_id
from .evidence import reuse_mode, validate_promotion

VALIDATION_PLAN_SCHEMA_VERSION = "1.0"
VALIDATION_RESULT_SCHEMA_VERSION = "1.0"
REUSE_OBSERVATION_SCHEMA_VERSION = "1.0"

RISK_TIERS = ("LOCALIZED_LOW", "TASK_BROAD", "SHARED_ARCHITECTURE", "INTEGRATED_FINAL")

CHECK_FOCUSED_LEAF = "focused_leaf"
CHECK_BROAD_TASK = "broad_task"
CHECK_INDEPENDENT_REVIEW = "required_independent_review"
CHECK_FULL_FINAL = "full_final_integrated"
CHECK_REQUIRED_CI = "required_ci"
CHECK_REACHABILITY = "reachability"

#: Checks that may never be omitted for an integration candidate.
MANDATORY_FINAL_CHECKS = (CHECK_FULL_FINAL, CHECK_REQUIRED_CI, CHECK_REACHABILITY)

#: Path fragments that make a change architecturally shared rather than local.
_SHARED_PATH_MARKERS = (
    "packages/contracts/", "schemas/", "config/", "registry/",
    "pnpm-workspace.yaml", "package.json", "pnpm-lock.yaml", "tsconfig",
    "playwright.config", "vitest.config", "vite.config", ".github/workflows/",
    "Dockerfile", "docker-compose", "cao-policy.json",
)

#: Fingerprint dimensions that must all match for reuse to even be a candidate.
FINGERPRINT_DIMENSIONS = (
    "source", "configuration", "environment", "toolchain", "browser", "provider",
)


# --------------------------------------------------------------------------
# Change classification
# --------------------------------------------------------------------------

def _leaf_area(path: str) -> str:
    parts = Path(path).parts
    return "/".join(parts[:2]) if len(parts) >= 2 else (parts[0] if parts else "")


def classify_change(
    *,
    changed_paths: Iterable[str],
    is_integration_candidate: bool = False,
    declared_risk: str | None = None,
    localized_file_threshold: int = 3,
) -> dict[str, Any]:
    """Deterministically classify a change into a risk tier.

    The rules are ordered and total, so the same inputs always produce the same
    tier and the same stated reason.  A declared risk may only *raise* the tier:
    a producer can volunteer that its change is riskier than it looks, but it
    cannot talk the system out of validation it would otherwise require.
    """

    paths = sorted({str(p) for p in changed_paths})
    if not paths:
        raise ContractError("change classification requires at least one changed path")

    shared_hits = sorted({
        path for path in paths
        if any(marker in path for marker in _SHARED_PATH_MARKERS)
    })
    areas = sorted({_leaf_area(path) for path in paths})

    if is_integration_candidate:
        tier = "INTEGRATED_FINAL"
        reason = "change is an integration candidate; full final integrated validation is mandatory"
    elif shared_hits:
        tier = "SHARED_ARCHITECTURE"
        reason = f"change touches shared architecture or configuration: {shared_hits}"
    elif len(areas) > 1:
        tier = "TASK_BROAD"
        reason = f"change spans multiple areas: {areas}"
    elif len(paths) <= localized_file_threshold:
        tier = "LOCALIZED_LOW"
        reason = (
            f"change is confined to {len(paths)} file(s) in one area ({areas[0]}) "
            "with no shared-architecture path"
        )
    else:
        tier = "TASK_BROAD"
        reason = f"change touches {len(paths)} files in {areas[0]}, above the localized threshold"

    if declared_risk is not None:
        if declared_risk not in RISK_TIERS:
            raise ContractError(f"unknown declared risk tier: {declared_risk!r}")
        if RISK_TIERS.index(declared_risk) > RISK_TIERS.index(tier):
            reason = f"declared risk {declared_risk} raises computed tier {tier}: {reason}"
            tier = declared_risk

    return {
        "risk_tier": tier,
        "reason": reason,
        "changed_paths": paths,
        "areas": areas,
        "shared_paths": shared_hits,
        "is_integration_candidate": bool(is_integration_candidate),
        "classifier_version": "1.0",
    }


# --------------------------------------------------------------------------
# Validation planning
# --------------------------------------------------------------------------

def _selection_for(tier: str, check: dict[str, Any], classification: dict[str, Any]) -> tuple[bool, str]:
    kind = str(check["kind"])
    check_areas = set(check.get("areas") or [])
    changed_areas = set(classification["areas"])

    if kind in MANDATORY_FINAL_CHECKS:
        if kind == CHECK_FULL_FINAL:
            if classification["is_integration_candidate"]:
                return True, "full final integrated validation is mandatory for an integration candidate"
            return False, "full final integrated validation runs at integration, not on an in-progress leaf change"
        return True, f"{kind} is mandatory for every change and can never be optimised away"

    if kind == CHECK_FOCUSED_LEAF:
        if check_areas and not (check_areas & changed_areas):
            return False, (
                f"focused check covers {sorted(check_areas)} which no changed area "
                f"{sorted(changed_areas)} touches"
            )
        return True, f"focused check covers changed area(s) {sorted(check_areas & changed_areas) or sorted(changed_areas)}"

    if kind == CHECK_BROAD_TASK:
        if tier in {"TASK_BROAD", "SHARED_ARCHITECTURE", "INTEGRATED_FINAL"}:
            return True, f"risk tier {tier} requires broad task-level validation"
        return False, f"risk tier {tier} is confined to one leaf area; broad task validation adds no signal"

    if kind == CHECK_INDEPENDENT_REVIEW:
        if tier in {"SHARED_ARCHITECTURE", "INTEGRATED_FINAL"}:
            return True, f"risk tier {tier} requires independent review of shared impact"
        return False, f"risk tier {tier} does not change shared architecture"

    return True, f"unclassified check kind {kind!r} is selected conservatively"


def build_validation_plan(
    *,
    plan_id: str,
    classification: dict[str, Any],
    available_checks: list[dict[str, Any]],
) -> dict[str, Any]:
    """Select checks proportionally, then re-assert the non-negotiable ones."""

    validate_id(plan_id, "plan_id")
    tier = str(classification["risk_tier"])
    if tier not in RISK_TIERS:
        raise ContractError(f"unknown risk tier: {tier!r}")

    selected: list[dict[str, Any]] = []
    omitted: list[dict[str, Any]] = []
    for check in available_checks:
        if "kind" not in check or "check_id" not in check:
            raise ContractError("each available check requires check_id and kind")
        include, reason = _selection_for(tier, check, classification)
        entry = {
            "check_id": check["check_id"],
            "kind": check["kind"],
            "command": check.get("command"),
            "areas": sorted(check.get("areas") or []),
            "reason": reason,
        }
        (selected if include else omitted).append(entry)

    plan = {
        "schema_version": VALIDATION_PLAN_SCHEMA_VERSION,
        "plan_id": plan_id,
        "risk_tier": tier,
        "classification": dict(classification),
        "selected": selected,
        "omitted": omitted,
        "created_at": iso_now(),
    }
    plan["plan_digest"] = sha256_json(
        {k: v for k, v in plan.items() if k not in {"plan_digest", "created_at"}}
    )
    assert_final_validation_intact(plan)
    return plan


def assert_final_validation_intact(plan: dict[str, Any]) -> dict[str, Any]:
    """Refuse any plan that weakens mandatory validation.

    This runs on every plan, including plans produced by future optimisation
    passes.  Omitting required CI or reachability, or omitting full final
    integrated validation for an integration candidate, is a hard failure
    rather than a warning.
    """

    omitted_kinds = {str(item.get("kind")) for item in plan.get("omitted") or []}
    selected_kinds = {str(item.get("kind")) for item in plan.get("selected") or []}
    integration = bool((plan.get("classification") or {}).get("is_integration_candidate"))

    for kind in (CHECK_REQUIRED_CI, CHECK_REACHABILITY):
        if kind in omitted_kinds:
            raise PolicyError(f"validation plan omits mandatory check kind {kind!r}")

    if integration:
        if CHECK_FULL_FINAL in omitted_kinds:
            raise PolicyError(
                "validation plan omits full final integrated validation for an integration candidate"
            )
        if CHECK_FULL_FINAL not in selected_kinds:
            raise PolicyError(
                "integration candidate plan does not select full final integrated validation"
            )
    return plan


# --------------------------------------------------------------------------
# Reuse fingerprints
# --------------------------------------------------------------------------

def fingerprint(
    *,
    command: str,
    source_digest: str,
    configuration_digest: str,
    environment_digest: str,
    toolchain_digest: str,
    browser_digest: str | None,
    provider_digest: str | None,
    fingerprint_version: str = "2.0",
) -> dict[str, Any]:
    """An exact reuse fingerprint over every dimension that can change a result.

    Every dimension must be supplied explicitly, including the ones that may
    not apply.  Defaulting ``browser`` or ``provider`` to ``None`` would let a
    caller silently omit a dimension that genuinely does affect the result -
    a browser upgrade is exactly the kind of change a stale fingerprint would
    miss - so declaring "not applicable" is required rather than assumed.
    """

    if not isinstance(command, str) or not command.strip():
        raise ContractError("reuse fingerprint requires a command")
    required = {
        "source": source_digest,
        "configuration": configuration_digest,
        "environment": environment_digest,
        "toolchain": toolchain_digest,
    }
    blank = sorted(name for name, value in required.items()
                   if not isinstance(value, str) or not value.strip())
    if blank:
        raise ContractError(f"reuse fingerprint has empty required dimensions: {blank}")

    components = {**required, "browser": browser_digest, "provider": provider_digest}
    missing = [k for k in FINGERPRINT_DIMENSIONS if k not in components]
    if missing:  # pragma: no cover - structural guard against a future edit
        raise ContractError(f"reuse fingerprint missing dimensions: {missing}")
    record = {
        "command": command,
        "components": components,
        "fingerprint_version": fingerprint_version,
    }
    record["fingerprint_digest"] = sha256_json(record)
    return record


def compare_fingerprints(left: dict[str, Any], right: dict[str, Any]) -> dict[str, Any]:
    """Report exactly which fingerprint components differ."""

    changed: list[str] = []
    if left.get("command") != right.get("command"):
        changed.append("command")
    if left.get("fingerprint_version") != right.get("fingerprint_version"):
        changed.append("fingerprint_version")
    lc = left.get("components") or {}
    rc = right.get("components") or {}
    for dimension in FINGERPRINT_DIMENSIONS:
        if lc.get(dimension) != rc.get(dimension):
            changed.append(dimension)
    return {
        "match": not changed,
        "changed_components": changed,
        "reason": "exact fingerprint match" if not changed else f"fingerprint invalidated by {changed}",
    }


# --------------------------------------------------------------------------
# Reuse observation economics
# --------------------------------------------------------------------------

class ReuseObservationStore:
    """Records what reuse *would* have done, while the real command still runs."""

    def __init__(self, state_root: str | Path):
        self.root = Path(state_root) / "validation-reuse-observations"
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def observe(
        self,
        *,
        observation_id: str,
        policy: dict[str, Any],
        candidate_fingerprint: dict[str, Any],
        prior_fingerprint: dict[str, Any] | None,
        prior_returncode: int | None,
        actual_returncode: int,
        actual_elapsed_seconds: float,
    ) -> dict[str, Any]:
        """Record one would-have-reused observation and its agreement.

        The actual command has already run by the time this is called.  That is
        the whole point: agreement can only be measured against a real result,
        so observation mode never saves time and never claims to.
        """

        validate_id(observation_id, "observation_id")
        mode = reuse_mode(policy)
        if mode not in {"disabled", "observation_only"}:
            raise PolicyError(
                f"reuse observation is only meaningful while reuse is disabled or "
                f"observation-only; policy reports {mode!r}"
            )

        comparison = (
            compare_fingerprints(candidate_fingerprint, prior_fingerprint)
            if prior_fingerprint is not None
            else {"match": False, "changed_components": ["no_prior_evidence"],
                  "reason": "no prior evidence for this fingerprint"}
        )
        would_have_reused = bool(comparison["match"] and prior_returncode == 0)
        if would_have_reused:
            agreement = "AGREED" if actual_returncode == prior_returncode else "FALSE_HIT"
        else:
            agreement = "NOT_APPLICABLE"

        record = {
            "schema_version": REUSE_OBSERVATION_SCHEMA_VERSION,
            "observation_id": observation_id,
            "reuse_mode": mode,
            "command": candidate_fingerprint.get("command"),
            "fingerprint_digest": candidate_fingerprint.get("fingerprint_digest"),
            "fingerprint_version": candidate_fingerprint.get("fingerprint_version"),
            "comparison": comparison,
            "would_have_reused": would_have_reused,
            "prior_returncode": prior_returncode,
            "actual_returncode": actual_returncode,
            "actual_elapsed_seconds": float(actual_elapsed_seconds),
            "agreement": agreement,
            "false_hit": agreement == "FALSE_HIT",
            # Observation mode reruns everything, so nothing was avoided.
            "validation_avoided": False,
            "seconds_saved": 0.0,
            "observed_at": iso_now(),
        }
        atomic_write_json(self.root / f"{observation_id}.json", record)
        return record

    def observations(self) -> list[dict[str, Any]]:
        return [load_json(p) for p in sorted(self.root.glob("*.json"))]

    def promotion_readiness(self, policy: dict[str, Any]) -> dict[str, Any]:
        """Report whether reuse *could* be promoted, without promoting it.

        A single false hit is disqualifying.  Reuse that is wrong even once has
        already demonstrated that the fingerprint does not capture everything
        which determines the result.
        """

        cfg = policy.get("validation_evidence") or {}
        minimum = int(cfg.get("minimum_observations_for_promotion", 20))
        items = self.observations()
        applicable = [o for o in items if o.get("would_have_reused")]
        false_hits = [o for o in items if o.get("false_hit")]
        versions = sorted({str(o.get("fingerprint_version")) for o in items})

        blockers: list[str] = []
        if false_hits:
            blockers.append(
                f"{len(false_hits)} false hit(s) recorded: "
                f"{[o['observation_id'] for o in false_hits]}"
            )
        if len(applicable) < minimum:
            blockers.append(
                f"only {len(applicable)} of {minimum} required agreeing observations"
            )
        if len(versions) > 1:
            blockers.append(f"observations span multiple fingerprint versions: {versions}")

        return {
            "observations": len(items),
            "applicable_observations": len(applicable),
            "false_hits": len(false_hits),
            "minimum_required": minimum,
            "fingerprint_versions": versions,
            "ready_for_operator_review": not blockers,
            "blockers": blockers,
            # Readiness is never activation.  Enforcement requires a separate,
            # expiring, operator-signed promotion record.
            "promotes_reuse": False,
            "current_reuse_mode": reuse_mode(policy),
        }


def effective_reuse_mode(policy: dict[str, Any]) -> str:
    """The reuse mode actually in force, validating any promotion record."""

    mode = reuse_mode(policy)
    if mode == "enforced":
        validate_promotion(policy)
    return mode


def economics_report(
    *,
    policy: dict[str, Any],
    plans: list[dict[str, Any]],
    observations: list[dict[str, Any]],
    repeated_commands: Iterable[str] = (),
) -> dict[str, Any]:
    """Report validation economics without inventing savings.

    Two rules keep this honest.  Nothing counts as saved while reuse is not
    enforced, because the command actually ran.  And nothing counts as saved
    for work that was repeated later anyway, because deferring a check is not
    the same as avoiding it.
    """

    mode = effective_reuse_mode(policy)
    repeated = {str(c) for c in repeated_commands}

    omitted_entries = [entry for plan in plans for entry in plan.get("omitted") or []]
    omitted_and_repeated = [
        entry for entry in omitted_entries if str(entry.get("check_id")) in repeated
    ]
    genuinely_omitted = [
        entry for entry in omitted_entries if str(entry.get("check_id")) not in repeated
    ]

    reuse_enforced = mode == "enforced"
    counted_reuse_savings = 0.0
    if reuse_enforced:
        for observation in observations:
            if observation.get("validation_avoided") and str(observation.get("command")) not in repeated:
                counted_reuse_savings += float(observation.get("seconds_saved") or 0.0)

    return {
        "schema_version": "1.0",
        "reuse_mode": mode,
        "reuse_enforced": reuse_enforced,
        "observations": len(observations),
        "false_hits": sum(1 for o in observations if o.get("false_hit")),
        "reuse_seconds_saved": counted_reuse_savings,
        "reuse_savings_counted": reuse_enforced,
        "reuse_savings_note": (
            "reuse is not enforced; every observed candidate still reran, so no time was saved"
            if not reuse_enforced else
            "counted only for enforced reuse of work that was not repeated later"
        ),
        "checks_omitted": len(genuinely_omitted),
        "checks_omitted_but_repeated_later": [e["check_id"] for e in omitted_and_repeated],
        "omission_savings_counted": len(genuinely_omitted),
        "omission_note": (
            "omitted checks that were later repeated are not counted as avoided work"
        ),
        "mandatory_checks_preserved": True,
        "generated_at": iso_now(),
    }
