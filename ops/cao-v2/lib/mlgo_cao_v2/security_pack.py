"""Evidence-based qualification gate for exactly one focused Security Pack.

A Security Pack sits directly above the canonical engineering skills in the
precedence order, which means its guidance can override the advice a worker
would otherwise follow.  That standing is exactly why it cannot be selected on
reputation.  A pack that ships an install hook, or that tells a worker it may
approve its own operations, would be borrowing CAO's authority using CAO's own
precedence rules.

So qualification is a total function over recorded evidence, and every reject
criterion is a hard gate rather than a weighted score.  A candidate that fails
any single criterion is rejected no matter how strong the rest of its evidence
is, and failing to find a qualifying candidate leaves the capability disabled
rather than substituting a broad security library.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from .common import ContractError, PolicyError, iso_now, sha256_json, validate_id

SECURITY_PACK_QUALIFICATION_SCHEMA_VERSION = "1.0"

# -- required coverage ------------------------------------------------------

COVERAGE_THREAT_MODELING = "threat_modeling"
COVERAGE_SECURITY_CODE_REVIEW = "security_code_review"
COVERAGE_SECRETS_CREDENTIALS = "secrets_credentials"
COVERAGE_AUTHN_AUTHZ = "authn_authz"
COVERAGE_DOMAIN_TENANT_ISOLATION = "security_domain_tenant_isolation"
COVERAGE_DEPENDENCY_SUPPLY_CHAIN = "dependency_supply_chain"
COVERAGE_UNTRUSTED_INPUT = "untrusted_input_upload_webhook"

REQUIRED_COVERAGE = (
    COVERAGE_THREAT_MODELING,
    COVERAGE_SECURITY_CODE_REVIEW,
    COVERAGE_SECRETS_CREDENTIALS,
    COVERAGE_AUTHN_AUTHZ,
    COVERAGE_DOMAIN_TENANT_ISOLATION,
    COVERAGE_DEPENDENCY_SUPPLY_CHAIN,
    COVERAGE_UNTRUSTED_INPUT,
)

#: Licenses whose terms permit the caching, mirroring and internal
#: redistribution this supply chain performs.  An unrecognised license is
#: treated as unknown - and therefore rejected - rather than assumed permissive.
ACCEPTABLE_LICENSES = frozenset({
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "CC0-1.0",
    "Unlicense", "CC-BY-4.0",
})

# -- reject reason codes ----------------------------------------------------

REJECT_COVERAGE = "REJECT_INSUFFICIENT_COVERAGE"
REJECT_LICENSE = "REJECT_LICENSE_OR_CACHE_RIGHTS"
REJECT_HIDDEN_BEHAVIOR = "REJECT_HIDDEN_EXECUTABLE_INSTALL_OR_MCP_BEHAVIOR"
REJECT_PROVENANCE = "REJECT_NO_IMMUTABLE_REVISION_OR_CONTENT_MANIFEST"
REJECT_AUTHORITY_CONFLICT = "REJECT_AUTHORITY_CHANGING_OR_PROTOCOL_CONFLICT"

QUALIFIED = "QUALIFIED"
REJECTED = "REJECTED"


class SecurityPackQualificationError(PolicyError):
    """Raised when the qualification gate is used incorrectly."""


def evaluate_candidate(candidate: Mapping[str, Any]) -> dict[str, Any]:
    """Evaluate one candidate against every hard gate.

    All criteria are evaluated even after the first failure so that the
    qualification record explains everything wrong with a candidate rather than
    only the first thing noticed.
    """

    for field in ("candidate_id", "source_repository", "source_revision", "license_id"):
        if not candidate.get(field):
            raise ContractError(f"security pack candidate missing {field}")
    validate_id(str(candidate["candidate_id"]), "candidate_id")

    reject_reasons: list[dict[str, Any]] = []

    # 1. Coverage.
    declared = {str(c) for c in candidate.get("coverage") or []}
    missing = sorted(set(REQUIRED_COVERAGE) - declared)
    if missing:
        reject_reasons.append(
            {
                "reason_code": REJECT_COVERAGE,
                "detail": f"missing required coverage areas: {missing}",
            }
        )

    # 2. License and cache rights.
    license_id = str(candidate["license_id"])
    if license_id not in ACCEPTABLE_LICENSES:
        reject_reasons.append(
            {
                "reason_code": REJECT_LICENSE,
                "detail": (
                    f"license {license_id!r} is not on the acceptable list; an unrecognised "
                    "license is treated as unknown cache/redistribution rights"
                ),
            }
        )
    elif not candidate.get("permits_internal_caching", True):
        reject_reasons.append(
            {
                "reason_code": REJECT_LICENSE,
                "detail": "candidate explicitly forbids internal caching or mirroring",
            }
        )

    # 3. Hidden executable / install / MCP behaviour.
    hidden: list[str] = []
    if candidate.get("has_install_hooks"):
        hidden.append("install/postinstall hooks")
    if candidate.get("has_mcp_setup"):
        hidden.append("MCP server setup")
    if candidate.get("has_package_install_behavior"):
        hidden.append("package installation behaviour")
    if candidate.get("has_executable_skill_content"):
        hidden.append("executable content inside skill payloads")
    if hidden:
        reject_reasons.append(
            {
                "reason_code": REJECT_HIDDEN_BEHAVIOR,
                "detail": f"candidate carries {', '.join(sorted(hidden))}",
            }
        )

    # 4. Immutable revision and content manifest.
    if not candidate.get("has_immutable_revision"):
        reject_reasons.append(
            {
                "reason_code": REJECT_PROVENANCE,
                "detail": "candidate has no immutable revision identifier to pin",
            }
        )
    if not candidate.get("has_content_manifest"):
        reject_reasons.append(
            {
                "reason_code": REJECT_PROVENANCE,
                "detail": "candidate has no per-file content manifest or checksum set",
            }
        )

    # 5. Authority conflicts with CAO protocols.
    conflicts = sorted({str(c) for c in candidate.get("authority_conflicts") or []})
    if conflicts:
        reject_reasons.append(
            {
                "reason_code": REJECT_AUTHORITY_CONFLICT,
                "detail": f"candidate asserts authority-changing guidance: {conflicts}",
            }
        )

    qualified = not reject_reasons
    return {
        "candidate_id": candidate["candidate_id"],
        "source_repository": candidate["source_repository"],
        "source_revision": candidate["source_revision"],
        "license_id": license_id,
        "state": QUALIFIED if qualified else REJECTED,
        "qualified": qualified,
        "coverage_declared": sorted(declared),
        "coverage_required": list(REQUIRED_COVERAGE),
        "coverage_missing": missing,
        "reject_reasons": sorted(
            reject_reasons, key=lambda r: (r["reason_code"], r["detail"])
        ),
        "evaluated_at": iso_now(),
    }


def qualify_security_pack(
    *,
    qualification_id: str,
    candidates: Iterable[Mapping[str, Any]],
    selected_candidate_id: str | None,
    rationale: str,
    evidence_refs: Iterable[Mapping[str, Any]] = (),
) -> dict[str, Any]:
    """Evaluate one to three candidates and record exactly one selection.

    Selecting a candidate that the gate rejected is refused outright: the point
    of a recorded gate is that it constrains the selection, not that it
    documents one made elsewhere.
    """

    validate_id(qualification_id, "qualification_id")
    evaluations = [evaluate_candidate(c) for c in candidates]
    if not evaluations:
        raise SecurityPackQualificationError("at least one candidate must be evaluated")
    if len(evaluations) > 3:
        raise SecurityPackQualificationError(
            "the qualification gate evaluates at most three candidates"
        )

    by_id = {str(e["candidate_id"]): e for e in evaluations}
    selected: dict[str, Any] | None = None

    if selected_candidate_id is not None:
        if selected_candidate_id not in by_id:
            raise SecurityPackQualificationError(
                f"selected candidate {selected_candidate_id!r} was not evaluated"
            )
        selected = by_id[selected_candidate_id]
        if not selected["qualified"]:
            raise SecurityPackQualificationError(
                f"candidate {selected_candidate_id!r} was rejected and cannot be selected: "
                f"{[r['reason_code'] for r in selected['reject_reasons']]}"
            )

    record = {
        "schema_version": SECURITY_PACK_QUALIFICATION_SCHEMA_VERSION,
        "qualification_id": qualification_id,
        "candidates_evaluated": sorted(
            evaluations, key=lambda e: str(e["candidate_id"])
        ),
        "candidate_count": len(evaluations),
        "selected_candidate_id": selected_candidate_id,
        "selected": selected,
        # A slice that could not find a qualifying pack is incomplete, not
        # quietly satisfied by a broad substitute.
        "security_pack_capability_enabled": selected is not None,
        "rationale": rationale,
        "evidence_refs": [dict(r) for r in evidence_refs],
        "qualified_at": iso_now(),
    }
    record["qualification_digest"] = sha256_json(
        {k: v for k, v in record.items() if k not in ("qualification_digest", "qualified_at")}
    )
    return record


def assert_exactly_one_active(record: Mapping[str, Any]) -> dict[str, Any]:
    """Prove exactly one pack is active under this qualification record."""

    if record.get("schema_version") != SECURITY_PACK_QUALIFICATION_SCHEMA_VERSION:
        raise ContractError("unsupported security pack qualification schema")
    qualified = [
        c for c in record.get("candidates_evaluated") or [] if c.get("qualified")
    ]
    selected_id = record.get("selected_candidate_id")
    if selected_id is None:
        if record.get("security_pack_capability_enabled"):
            raise PolicyError(
                "security pack capability cannot be enabled without a selected pack"
            )
        return {
            "active_count": 0,
            "enabled": False,
            "reason": "no candidate qualified; Security Pack capability remains disabled",
            "qualified_candidate_ids": sorted(str(c["candidate_id"]) for c in qualified),
        }
    return {
        "active_count": 1,
        "enabled": True,
        "selected_candidate_id": selected_id,
        "reason": "exactly one qualified Security Pack is pinned and active",
        "qualified_candidate_ids": sorted(str(c["candidate_id"]) for c in qualified),
    }
