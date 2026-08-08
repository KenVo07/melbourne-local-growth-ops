"""Gate M - focused Security Pack qualification.

The gate is a total function over recorded evidence, so these tests drive it
with the evidence actually gathered during Slice 3.5 research plus deliberately
malformed variants.  Candidate metadata is recorded here as static fixture data:
the gate must be reproducible offline, and a qualification decision that could
change because a repository changed overnight would not be a pinned decision.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.security_pack import (
    ACCEPTABLE_LICENSES,
    REJECT_AUTHORITY_CONFLICT,
    REJECT_COVERAGE,
    REJECT_HIDDEN_BEHAVIOR,
    REJECT_LICENSE,
    REJECT_PROVENANCE,
    REQUIRED_COVERAGE,
    SecurityPackQualificationError,
    assert_exactly_one_active,
    evaluate_candidate,
    qualify_security_pack,
)
from mlgo_cao_v2.skill_cache import BUNDLE_KIND_SECURITY_PACK, SealedSkillCache

import slice35_fixtures as fx

# --------------------------------------------------------------------------
# Recorded candidate evidence (gathered 2026-08-09; pinned, not fetched)
# --------------------------------------------------------------------------

#: The selected pack.  Coverage, license and absence of install/MCP behaviour
#: were read from the repository's own published metadata and release-integrity
#: documentation.
SECURITY_SKILLS = {
    "candidate_id": "unitoneai-securityskills",
    "source_repository": "https://github.com/UnitOneAI/SecuritySkills",
    "source_revision": "70bc259bb01abb3015ad2ad859ad5253cbf0bcab",
    "license_id": "MIT",
    "permits_internal_caching": True,
    "coverage": list(REQUIRED_COVERAGE),
    "has_install_hooks": False,
    "has_mcp_setup": False,
    "has_package_install_behavior": False,
    "has_executable_skill_content": False,
    "has_immutable_revision": True,
    "has_content_manifest": True,
    "authority_conflicts": [],
}

#: A real engineering skill collection considered and rejected: its security
#: coverage is one skill inside a general engineering pack, and the repository
#: ships lifecycle hooks, CLI scripts, plugin manifests and MCP connectors.
AGENT_SKILLS_GENERAL = {
    "candidate_id": "general-engineering-pack",
    "source_repository": "https://github.com/addyosmani/agent-skills",
    "source_revision": "f49337711b7a932b4b338c1d4ad73384df8fd87d",
    "license_id": "MIT",
    "permits_internal_caching": True,
    "coverage": ["security_code_review"],
    "has_install_hooks": True,
    "has_mcp_setup": True,
    "has_package_install_behavior": False,
    "has_executable_skill_content": True,
    "has_immutable_revision": True,
    "has_content_manifest": False,
    "authority_conflicts": [],
}

#: A synthetic candidate that fails every gate at once.
FAILING_SYNTHETIC = {
    "candidate_id": "synthetic-unsuitable",
    "source_repository": "https://example.invalid/unsuitable",
    "source_revision": "main",
    "license_id": "SEE-LICENSE-IN-FILE",
    "permits_internal_caching": False,
    "coverage": ["threat_modeling"],
    "has_install_hooks": True,
    "has_mcp_setup": True,
    "has_package_install_behavior": True,
    "has_executable_skill_content": True,
    "has_immutable_revision": False,
    "has_content_manifest": False,
    "authority_conflicts": [
        "instructs the agent to approve its own privileged operations",
    ],
}


def candidate(**overrides):
    base = dict(SECURITY_SKILLS)
    base.update(overrides)
    return base


class Slice35GateMTests(unittest.TestCase):
    # -- M-01 ------------------------------------------------------------

    def test_M01_missing_required_security_coverage_is_rejected(self):
        for area in REQUIRED_COVERAGE:
            partial = [c for c in REQUIRED_COVERAGE if c != area]
            result = evaluate_candidate(candidate(coverage=partial))
            self.assertFalse(result["qualified"], area)
            self.assertEqual(result["coverage_missing"], [area])
            self.assertIn(
                REJECT_COVERAGE, [r["reason_code"] for r in result["reject_reasons"]]
            )

    def test_M01_a_general_engineering_pack_does_not_qualify_as_a_security_pack(self):
        result = evaluate_candidate(AGENT_SKILLS_GENERAL)
        self.assertFalse(result["qualified"])
        codes = {r["reason_code"] for r in result["reject_reasons"]}
        self.assertIn(REJECT_COVERAGE, codes)
        self.assertIn(REJECT_HIDDEN_BEHAVIOR, codes)
        self.assertIn(REJECT_PROVENANCE, codes)

    # -- M-02 ------------------------------------------------------------

    def test_M02_unknown_or_incompatible_license_is_rejected(self):
        for license_id in ("SEE-LICENSE-IN-FILE", "GPL-3.0-only", "Proprietary", "UNKNOWN"):
            result = evaluate_candidate(candidate(license_id=license_id))
            self.assertFalse(result["qualified"], license_id)
            self.assertIn(
                REJECT_LICENSE, [r["reason_code"] for r in result["reject_reasons"]]
            )

    def test_M02_a_license_that_forbids_caching_is_rejected(self):
        result = evaluate_candidate(candidate(permits_internal_caching=False))
        self.assertFalse(result["qualified"])
        detail = [
            r["detail"] for r in result["reject_reasons"]
            if r["reason_code"] == REJECT_LICENSE
        ]
        self.assertIn("forbids internal caching", detail[0])

    def test_M02_every_acceptable_license_is_permissive_enough_to_cache(self):
        for license_id in sorted(ACCEPTABLE_LICENSES):
            self.assertTrue(evaluate_candidate(candidate(license_id=license_id))["qualified"])

    # -- M-03 ------------------------------------------------------------

    def test_M03_hidden_executable_install_or_mcp_behavior_is_rejected(self):
        for flag in (
            "has_install_hooks",
            "has_mcp_setup",
            "has_package_install_behavior",
            "has_executable_skill_content",
        ):
            result = evaluate_candidate(candidate(**{flag: True}))
            self.assertFalse(result["qualified"], flag)
            self.assertIn(
                REJECT_HIDDEN_BEHAVIOR,
                [r["reason_code"] for r in result["reject_reasons"]],
                flag,
            )

    # -- M-04 ------------------------------------------------------------

    def test_M04_missing_immutable_revision_or_content_manifest_is_rejected(self):
        for flag in ("has_immutable_revision", "has_content_manifest"):
            result = evaluate_candidate(candidate(**{flag: False}))
            self.assertFalse(result["qualified"], flag)
            self.assertIn(
                REJECT_PROVENANCE,
                [r["reason_code"] for r in result["reject_reasons"]],
                flag,
            )

    # -- M-05 ------------------------------------------------------------

    def test_M05_authority_changing_guidance_is_rejected(self):
        result = evaluate_candidate(
            candidate(
                authority_conflicts=[
                    "tells the agent it may widen its own approved scope",
                ]
            )
        )
        self.assertFalse(result["qualified"])
        self.assertIn(
            REJECT_AUTHORITY_CONFLICT,
            [r["reason_code"] for r in result["reject_reasons"]],
        )

    def test_M05_a_candidate_failing_every_gate_reports_every_reason(self):
        result = evaluate_candidate(FAILING_SYNTHETIC)
        codes = {r["reason_code"] for r in result["reject_reasons"]}
        self.assertEqual(
            codes,
            {
                REJECT_COVERAGE,
                REJECT_LICENSE,
                REJECT_HIDDEN_BEHAVIOR,
                REJECT_PROVENANCE,
                REJECT_AUTHORITY_CONFLICT,
            },
        )

    # -- M-06 ------------------------------------------------------------

    def test_M06_the_selected_pack_covers_every_required_area(self):
        result = evaluate_candidate(SECURITY_SKILLS)
        self.assertTrue(result["qualified"])
        self.assertEqual(result["coverage_missing"], [])
        for area in (
            "threat_modeling",
            "security_code_review",
            "secrets_credentials",
            "authn_authz",
            "security_domain_tenant_isolation",
            "dependency_supply_chain",
            "untrusted_input_upload_webhook",
        ):
            self.assertIn(area, result["coverage_declared"])

    # -- M-07 ------------------------------------------------------------

    def test_M07_exactly_one_pack_is_selected_and_pinned_with_evidence(self):
        record = qualify_security_pack(
            qualification_id="secpack-qual-1",
            candidates=[SECURITY_SKILLS, AGENT_SKILLS_GENERAL, FAILING_SYNTHETIC],
            selected_candidate_id="unitoneai-securityskills",
            rationale=(
                "Only candidate covering all seven required areas under a permissive "
                "license with an immutable revision and published checksum manifest."
            ),
            evidence_refs=[
                {"kind": "repository", "locator": SECURITY_SKILLS["source_repository"]},
                {"kind": "revision", "locator": SECURITY_SKILLS["source_revision"]},
            ],
        )
        self.assertEqual(record["candidate_count"], 3)
        self.assertEqual(record["selected_candidate_id"], "unitoneai-securityskills")
        self.assertTrue(record["security_pack_capability_enabled"])
        active = assert_exactly_one_active(record)
        self.assertEqual(active["active_count"], 1)
        self.assertTrue(record["rationale"])
        self.assertTrue(record["evidence_refs"])
        self.assertTrue(record["qualification_digest"])

    def test_M07_a_rejected_candidate_can_never_be_selected(self):
        with self.assertRaises(SecurityPackQualificationError) as ctx:
            qualify_security_pack(
                qualification_id="secpack-qual-bad",
                candidates=[SECURITY_SKILLS, AGENT_SKILLS_GENERAL],
                selected_candidate_id="general-engineering-pack",
                rationale="popular and comprehensive",
            )
        self.assertIn("was rejected and cannot be selected", str(ctx.exception))

    def test_M07_selecting_nothing_leaves_the_capability_disabled(self):
        record = qualify_security_pack(
            qualification_id="secpack-qual-none",
            candidates=[AGENT_SKILLS_GENERAL, FAILING_SYNTHETIC],
            selected_candidate_id=None,
            rationale="no candidate qualified",
        )
        self.assertFalse(record["security_pack_capability_enabled"])
        active = assert_exactly_one_active(record)
        self.assertEqual(active["active_count"], 0)
        self.assertFalse(active["enabled"])

    def test_M07_the_gate_evaluates_at_most_three_candidates(self):
        with self.assertRaises(SecurityPackQualificationError):
            qualify_security_pack(
                qualification_id="secpack-qual-many",
                candidates=[
                    candidate(candidate_id=f"c{i}") for i in range(4)
                ],
                selected_candidate_id=None,
                rationale="too many",
            )

    def test_M07_only_one_qualified_security_pack_may_be_registered(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = SealedSkillCache(tmp)
            manifests = fx.seal_all(cache)
            registry = fx.build_registry(manifests)
            self.assertIsNotNone(registry.assert_single_security_pack())

            second = fx.make_bundle(
                bundle_id="bundle-security-pack-2",
                bundle_kind=BUNDLE_KIND_SECURITY_PACK,
                files={"other-security/SKILL.md": b"a second pack\n"},
                skill_ids=["other-security"],
            )
            registry.add_bundle(second)
            with self.assertRaises(PolicyError) as ctx:
                registry.assert_single_security_pack()
            self.assertIn("more than one qualified Security Pack", str(ctx.exception))

    # -- M-08 ------------------------------------------------------------

    def test_M08_pack_content_resolves_through_the_same_sealed_supply_chain(self):
        with tempfile.TemporaryDirectory() as tmp:
            cache = SealedSkillCache(tmp)
            manifests = fx.seal_all(cache)
            fx.bind_all(
                cache, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
            )
            resolved = cache.resolve(
                bundle_id="bundle-security-pack",
                project_id=fx.PROJECTS[0],
                security_domain_id=fx.DOMAINS[0],
            )
            manifest = manifests["bundle-security-pack"]
            self.assertEqual(manifest["bundle_kind"], BUNDLE_KIND_SECURITY_PACK)
            self.assertEqual(resolved["content_digest"], manifest["content_digest"])
            # The pack uses the identical sealed path as every other bundle:
            # same digest proof, same namespace binding, same immutability rule.
            for entry in resolved["files"]:
                self.assertTrue(Path(entry["object_path"]).is_file())
            self.assertEqual(
                sorted(e["relative_path"] for e in resolved["files"]),
                sorted(e["relative_path"] for e in manifest["file_manifest"]),
            )

    def test_M08_a_security_pack_is_not_resolvable_outside_its_bound_namespace(self):
        from mlgo_cao_v2.skill_cache import SkillCacheIsolationError

        with tempfile.TemporaryDirectory() as tmp:
            cache = SealedSkillCache(tmp)
            fx.seal_all(cache)
            fx.bind_all(
                cache, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
            )
            with self.assertRaises(SkillCacheIsolationError):
                cache.resolve(
                    bundle_id="bundle-security-pack",
                    project_id=fx.PROJECTS[1],
                    security_domain_id=fx.DOMAINS[1],
                )


if __name__ == "__main__":
    unittest.main()
