"""Gate J - canonical skill supply chain and deterministic recipe compilation.

The failure this gate hunts for is not "a skill was missing" but "the worker was
given something other than what the run contract says it was given".  So the
tests spend most of their effort trying to make the compiler accept drifted
bytes, resolve a conflict by guessing, or defer a selection decision to runtime.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.approval_broker import (
    CLASS_EXTERNAL_CAPABILITY_INSTALL,
    ApprovalBroker,
    ApprovalStore,
)
from mlgo_cao_v2.approval import DENIED_BY_POLICY
from mlgo_cao_v2.common import ContractError, PolicyError, sha256_bytes
from mlgo_cao_v2.skill_cache import (
    BUNDLE_KIND_EXTERNAL_ENGINEERING,
    SealedSkillCache,
    SkillCacheIsolationError,
    SkillIntegrityError,
    validate_bundle_manifest,
)
from mlgo_cao_v2.skill_recipes import (
    REASON_EXCLUDED_SKILL_COUNT,
    REASON_OPTIONAL_CONDITION_UNMET,
    REASON_CONSTRAINT_SUPERSEDED,
    RecipeConflictError,
    compile_skill_contract,
    project_effective_profile,
)
from mlgo_cao_v2.skills_registry import (
    TIER_CAO_PROTOCOL,
    TIER_ENGINEERING,
    CanonicalSkillRegistry,
    SkillAuthorityConflict,
    new_skill_record,
)

import slice35_fixtures as fx

LIB = Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2"
SOURCE_ROOT = Path(__file__).resolve().parents[1]


class Slice35GateJTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.cache = SealedSkillCache(self.root)
        self.manifests = fx.seal_all(self.cache)
        fx.bind_all(
            self.cache, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
        )
        self.registry = fx.build_registry(self.manifests)
        self.addCleanup(self._tmp.cleanup)

    def compile(self, recipe=None, **overrides):
        kwargs = dict(
            registry=self.registry,
            cache=self.cache,
            recipe=recipe or fx.implementation_recipe(),
            project_id=fx.PROJECTS[0],
            security_domain_id=fx.DOMAINS[0],
            role="developer",
            task_class="implementation",
            risk_class="standard",
        )
        kwargs.update(overrides)
        return compile_skill_contract(**kwargs)

    # -- J-01 ------------------------------------------------------------

    def test_J01_valid_pinned_bundle_validates_resolves_and_matches_digest(self):
        manifest = self.manifests["bundle-engineering"]
        validate_bundle_manifest(manifest)
        resolved = self.cache.resolve(
            bundle_id="bundle-engineering",
            project_id=fx.PROJECTS[0],
            security_domain_id=fx.DOMAINS[0],
        )
        self.assertEqual(resolved["content_digest"], manifest["content_digest"])
        self.assertEqual(len(resolved["files"]), len(manifest["file_manifest"]))
        for entry in resolved["files"]:
            data = self.cache.read_file(
                resolved=resolved, relative_path=entry["relative_path"]
            )
            self.assertEqual(sha256_bytes(data), entry["content_digest"])

    # -- J-02 ------------------------------------------------------------

    def test_J02_missing_required_skill_bytes_blocks_before_dispatch(self):
        manifest = self.manifests["bundle-engineering"]
        victim = manifest["file_manifest"][0]
        object_path = (
            self.cache.objects_dir
            / victim["content_digest"][:2]
            / victim["content_digest"]
        )
        object_path.chmod(0o600)
        object_path.unlink()

        with self.assertRaises(SkillIntegrityError) as ctx:
            self.compile()
        self.assertIn("sealed content missing", str(ctx.exception))

    def test_J02_seal_rejects_a_bundle_whose_bytes_were_never_supplied(self):
        manifest = fx.engineering_bundle()
        incomplete = dict(fx.ENGINEERING_FILES)
        incomplete.pop("engineering-debugging/SKILL.md")
        cache = SealedSkillCache(self.root / "second")
        with self.assertRaises(SkillIntegrityError) as ctx:
            cache.seal_bundle(manifest, incomplete)
        self.assertIn("missing required skill bytes", str(ctx.exception))

    # -- J-03 ------------------------------------------------------------

    def test_J03_content_digest_mismatch_fails_closed_before_dispatch(self):
        manifest = self.manifests["bundle-engineering"]
        victim = manifest["file_manifest"][0]
        object_path = (
            self.cache.objects_dir
            / victim["content_digest"][:2]
            / victim["content_digest"]
        )
        object_path.chmod(0o600)
        object_path.write_bytes(b"rewritten content that no manifest attests to")

        with self.assertRaises(SkillIntegrityError) as ctx:
            self.compile()
        self.assertIn("corrupt", str(ctx.exception))

    def test_J03_manifest_that_misstates_its_own_content_digest_is_rejected(self):
        manifest = dict(fx.engineering_bundle())
        manifest["content_digest"] = "f" * 64
        with self.assertRaises(SkillIntegrityError):
            validate_bundle_manifest(manifest)

    def test_J03_a_revision_change_requires_a_new_bundle_id(self):
        cache = SealedSkillCache(self.root / "rev")
        first = fx.engineering_bundle()
        cache.seal_bundle(first, fx.ENGINEERING_FILES)
        drifted_files = dict(fx.ENGINEERING_FILES)
        drifted_files["engineering-implementation/SKILL.md"] = b"a different revision\n"
        second = fx.make_bundle(
            bundle_id="bundle-engineering",
            bundle_kind=BUNDLE_KIND_EXTERNAL_ENGINEERING,
            files=drifted_files,
            skill_ids=first["skill_ids"],
            source_revision="1" * 40,
        )
        with self.assertRaises(PolicyError) as ctx:
            cache.seal_bundle(second, drifted_files)
        self.assertIn("new revision requires a new bundle id", str(ctx.exception))

    # -- J-04 ------------------------------------------------------------

    def test_J04_identical_facts_compile_to_a_byte_identical_contract(self):
        first = self.compile()
        second = self.compile()
        self.assertEqual(
            first["skill_contract_digest"], second["skill_contract_digest"]
        )
        for key in first:
            if key == "compiled_at":
                continue
            self.assertEqual(first[key], second[key], f"field {key} is not deterministic")
        self.assertEqual(
            first["selection_reason_codes"], second["selection_reason_codes"]
        )

    def test_J04_changing_any_input_fact_changes_the_contract_digest(self):
        base = self.compile()
        for overrides in (
            {"task_class": "debugging"},
            {"risk_class": "elevated"},
            {"role": "reviewer"},
        ):
            other = self.compile(**overrides)
            self.assertNotEqual(
                base["skill_contract_digest"],
                other["skill_contract_digest"],
                f"{overrides} did not change the contract digest",
            )

    # -- J-05 ------------------------------------------------------------

    def test_J05_same_precedence_conflict_fails_closed(self):
        registry = CanonicalSkillRegistry()
        for manifest in self.manifests.values():
            registry.add_bundle(manifest)
        manifest = self.manifests["bundle-engineering"]

        def entry(path):
            return next(
                e for e in manifest["file_manifest"] if e["relative_path"] == path
            )

        for skill_id, path, value in (
            ("engineering-implementation", "engineering-implementation/SKILL.md", "small"),
            ("engineering-typescript", "engineering-typescript/SKILL.md", "large"),
        ):
            e = entry(path)
            registry.add_skill(
                new_skill_record(
                    skill_id=skill_id,
                    bundle_id="bundle-engineering",
                    bundle_kind=BUNDLE_KIND_EXTERNAL_ENGINEERING,
                    relative_path=path,
                    content_digest=e["content_digest"],
                    byte_count=e["byte_count"],
                    precedence_tier=TIER_ENGINEERING,
                    constraints={"increment_size": value},
                )
            )
        recipe = fx.implementation_recipe(
            required_skill_ids=["engineering-implementation", "engineering-typescript"],
            optional_skill_ids=[],
            selection_conditions={},
        )
        with self.assertRaises(RecipeConflictError) as ctx:
            self.compile(recipe=recipe, registry=registry)
        message = str(ctx.exception)
        self.assertIn("same-precedence conflict", message)
        self.assertIn("increment_size", message)
        self.assertIn("fails closed", message)

    # -- J-06 ------------------------------------------------------------

    def test_J06_external_skill_may_not_assert_protected_authority_classes(self):
        manifest = self.manifests["bundle-engineering"]
        entry = manifest["file_manifest"][0]
        for protected in ("authority", "scope", "budget", "recovery", "validation", "worktree"):
            with self.assertRaises(SkillAuthorityConflict) as ctx:
                new_skill_record(
                    skill_id="engineering-implementation",
                    bundle_id="bundle-engineering",
                    bundle_kind=BUNDLE_KIND_EXTERNAL_ENGINEERING,
                    relative_path=entry["relative_path"],
                    content_digest=entry["content_digest"],
                    byte_count=entry["byte_count"],
                    precedence_tier=TIER_ENGINEERING,
                    constraints={protected: "widened"},
                )
            self.assertIn(protected, str(ctx.exception))

    def test_J06_task_local_guidance_may_not_assert_protected_classes(self):
        with self.assertRaises(SkillAuthorityConflict):
            self.compile(task_local_guidance={"authority": "self_approved"})

    def test_J06_an_external_bundle_may_not_claim_a_protocol_tier(self):
        manifest = self.manifests["bundle-engineering"]
        entry = manifest["file_manifest"][0]
        with self.assertRaises(SkillAuthorityConflict) as ctx:
            new_skill_record(
                skill_id="engineering-implementation",
                bundle_id="bundle-engineering",
                bundle_kind=BUNDLE_KIND_EXTERNAL_ENGINEERING,
                relative_path=entry["relative_path"],
                content_digest=entry["content_digest"],
                byte_count=entry["byte_count"],
                precedence_tier=TIER_CAO_PROTOCOL,
            )
        self.assertIn("may not claim precedence tier", str(ctx.exception))

    # -- J-07 ------------------------------------------------------------

    def test_J07_arbitrary_external_install_request_is_denied_by_policy(self):
        store = ApprovalStore(
            self.root, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
        )
        broker = ApprovalBroker(store, **fx.delegated_broker_args())
        intent = fx.an_intent(
            approval_request_id="req-install",
            operation_class=CLASS_EXTERNAL_CAPABILITY_INSTALL,
            operation_name="install_external_skill_plugin_or_mcp_server",
        )
        store.open_request(intent)
        decision = broker.evaluate(
            intent,
            decision_id="dec-install",
            owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
            current_pre_state_digest=fx.PRE_STATE_DIGEST,
        )
        self.assertEqual(decision["outcome"], DENIED_BY_POLICY)
        self.assertIn("OPERATOR_ONLY_CLASS", decision["reason_codes"])
        self.assertIn("NEVER_AUTO_APPROVED", decision["reason_codes"])

    # -- J-08 ------------------------------------------------------------

    def test_J08_native_mirror_that_differs_from_sealed_content_is_rejected(self):
        resolved = self.cache.resolve(
            bundle_id="bundle-engineering",
            project_id=fx.PROJECTS[0],
            security_domain_id=fx.DOMAINS[0],
        )
        mirror = self.root / "native-mirror"
        for entry in resolved["files"]:
            target = mirror / entry["relative_path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(
                self.cache.read_file(
                    resolved=resolved, relative_path=entry["relative_path"]
                )
            )
        good = self.cache.verify_native_mirror(resolved=resolved, mirror_root=mirror)
        self.assertTrue(good["equivalent"])
        self.assertTrue(good["accepted"])

        drifted = mirror / resolved["files"][0]["relative_path"]
        drifted.write_bytes(b"a native install that drifted underneath the run\n")
        bad = self.cache.verify_native_mirror(resolved=resolved, mirror_root=mirror)
        self.assertFalse(bad["equivalent"])
        self.assertFalse(bad["accepted"])
        self.assertEqual(bad["differences"][0]["reason"], "digest mismatch")
        self.assertIn("sealed cache remains authoritative", bad["reason"])

    def test_J08_a_mirror_missing_a_file_is_rejected_rather_than_partly_used(self):
        resolved = self.cache.resolve(
            bundle_id="bundle-security-pack",
            project_id=fx.PROJECTS[0],
            security_domain_id=fx.DOMAINS[0],
        )
        mirror = self.root / "partial-mirror"
        first = resolved["files"][0]
        target = mirror / first["relative_path"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(
            self.cache.read_file(resolved=resolved, relative_path=first["relative_path"])
        )
        report = self.cache.verify_native_mirror(resolved=resolved, mirror_root=mirror)
        self.assertFalse(report["accepted"])
        self.assertEqual(report["differences"][0]["reason"], "missing in mirror")

    # -- J-09 ------------------------------------------------------------

    def test_J09_contract_reconstructs_exactly_after_a_restart(self):
        original = self.compile()
        # A "restart" is a completely fresh cache and registry object graph
        # built from the same durable bytes; nothing in-process survives.
        restarted_cache = SealedSkillCache(self.root)
        restarted_registry = fx.build_registry(
            {
                bundle_id: restarted_cache.load_manifest(bundle_id)
                for bundle_id in self.manifests
            }
        )
        rebuilt = compile_skill_contract(
            registry=restarted_registry,
            cache=restarted_cache,
            recipe=fx.implementation_recipe(),
            project_id=fx.PROJECTS[0],
            security_domain_id=fx.DOMAINS[0],
            role="developer",
            task_class="implementation",
            risk_class="standard",
        )
        self.assertEqual(
            original["skill_contract_digest"], rebuilt["skill_contract_digest"]
        )
        self.assertEqual(original["selected_skills"], rebuilt["selected_skills"])

    # -- J-10 ------------------------------------------------------------

    def test_J10_every_selection_fact_is_recorded_durably(self):
        contract = self.compile()
        for field in (
            "recipe_id",
            "recipe_version",
            "recipe_digest",
            "registry_revision",
            "selected_skills",
            "selection_reason_codes",
            "exclusions",
            "bundle_refs",
            "skill_contract_digest",
        ):
            self.assertIn(field, contract)
            self.assertTrue(contract[field] not in (None, ""), field)
        for skill in contract["selected_skills"]:
            for field in ("skill_id", "bundle_id", "content_digest", "precedence_tier"):
                self.assertTrue(skill.get(field) not in (None, ""), field)
        # Cache references name the exact sealed content digest per bundle.
        for bundle_id, digest in contract["bundle_refs"]:
            self.assertEqual(
                self.cache.load_manifest(bundle_id)["content_digest"], digest
            )

    # -- J-11 ------------------------------------------------------------

    def test_J11_minimal_recipe_enforces_limits_and_records_exclusions(self):
        recipe = fx.implementation_recipe(maximum_skill_count=2)
        contract = self.compile(recipe=recipe)
        self.assertEqual(contract["total_skill_count"], 2)
        self.assertLessEqual(
            contract["total_skill_bytes"], contract["maximum_skill_bytes"]
        )
        excluded = {e["skill_id"]: e["reason_code"] for e in contract["exclusions"]}
        self.assertEqual(excluded["engineering-typescript"], REASON_EXCLUDED_SKILL_COUNT)
        self.assertEqual(
            excluded["engineering-debugging"], REASON_OPTIONAL_CONDITION_UNMET
        )

    def test_J11_a_byte_budget_smaller_than_the_required_set_fails_closed(self):
        recipe = fx.implementation_recipe(maximum_skill_bytes=10)
        with self.assertRaises(RecipeConflictError) as ctx:
            self.compile(recipe=recipe)
        self.assertIn("bytes", str(ctx.exception))

    def test_J11_exclusions_are_deterministic_across_compilations(self):
        recipe = fx.implementation_recipe(maximum_skill_count=2)
        self.assertEqual(
            self.compile(recipe=recipe)["exclusions"],
            self.compile(recipe=recipe)["exclusions"],
        )

    # -- J-12 ------------------------------------------------------------

    def test_J12_cao_protocol_outranks_external_engineering_guidance(self):
        registry = CanonicalSkillRegistry()
        for manifest in self.manifests.values():
            registry.add_bundle(manifest)

        cao_manifest = self.manifests["bundle-cao-protocols"]
        cao_entry = cao_manifest["file_manifest"][0]
        registry.add_skill(
            new_skill_record(
                skill_id="cao-worker-protocols",
                bundle_id="bundle-cao-protocols",
                bundle_kind=cao_manifest["bundle_kind"],
                relative_path=cao_entry["relative_path"],
                content_digest=cao_entry["content_digest"],
                byte_count=cao_entry["byte_count"],
                precedence_tier=TIER_CAO_PROTOCOL,
                constraints={"evidence_style": "structured_result_packet"},
            )
        )
        eng_manifest = self.manifests["bundle-engineering"]
        eng_entry = next(
            e for e in eng_manifest["file_manifest"]
            if e["relative_path"] == "engineering-implementation/SKILL.md"
        )
        registry.add_skill(
            new_skill_record(
                skill_id="engineering-implementation",
                bundle_id="bundle-engineering",
                bundle_kind=BUNDLE_KIND_EXTERNAL_ENGINEERING,
                relative_path=eng_entry["relative_path"],
                content_digest=eng_entry["content_digest"],
                byte_count=eng_entry["byte_count"],
                precedence_tier=TIER_ENGINEERING,
                constraints={"evidence_style": "freeform_prose"},
            )
        )
        recipe = fx.implementation_recipe(
            required_skill_ids=["cao-worker-protocols", "engineering-implementation"],
            optional_skill_ids=[],
            selection_conditions={},
        )
        contract = self.compile(recipe=recipe, registry=registry)
        self.assertEqual(
            contract["effective_constraints"]["evidence_style"],
            "structured_result_packet",
        )
        superseded = contract["superseded_constraints"]
        self.assertEqual(len(superseded), 1)
        self.assertEqual(superseded[0]["skill_id"], "engineering-implementation")
        self.assertEqual(superseded[0]["winning_tier"], TIER_CAO_PROTOCOL)
        self.assertEqual(superseded[0]["reason_code"], REASON_CONSTRAINT_SUPERSEDED)

    def test_J12_security_pack_outranks_engineering_but_not_cao_protocol(self):
        contract = self.compile(
            recipe=fx.security_recipe(),
            task_class="security",
            risk_class="elevated",
        )
        # security-code-review (tier 3) beats engineering-code-review (tier 4)
        self.assertEqual(
            contract["effective_constraints"]["review_depth"], "security_first"
        )
        self.assertEqual(
            contract["effective_constraints"]["authority"], "host_owned"
        )

    # -- J-13 ------------------------------------------------------------

    def test_J13_selection_completes_before_dispatch_with_a_closed_skill_list(self):
        contract = self.compile()
        self.assertTrue(contract["selected_before_dispatch"])
        projection = project_effective_profile(contract)
        self.assertEqual(
            projection["skills"], [s["skill_id"] for s in contract["selected_skills"]]
        )
        # The projection is derived and disposable, never a second source of truth.
        self.assertTrue(projection["disposable"])
        self.assertTrue(projection["rebuildable_from_contract"])
        self.assertEqual(
            projection["derived_from_skill_contract_digest"],
            contract["skill_contract_digest"],
        )
        self.assertEqual(projection, project_effective_profile(contract))

    def test_J13_no_worker_reachable_discovery_or_install_entry_point_exists(self):
        for module in ("skill_cache.py", "skills_registry.py", "skill_recipes.py"):
            text = (LIB / module).read_text()
            for forbidden in ("def discover_skills", "def install_skill", "def add_from_url"):
                self.assertNotIn(forbidden, text, f"{module} exposes {forbidden}")

    # -- J-14 ------------------------------------------------------------

    def test_J14_normal_canonical_skill_use_never_requires_runtime_load_skill(self):
        contract = self.compile()
        self.assertFalse(contract["requires_runtime_skill_loading"])
        slice35_modules = (
            "skill_cache.py",
            "skills_registry.py",
            "skill_recipes.py",
            "security_pack.py",
            "approval.py",
            "approval_broker.py",
            "permission_adapter.py",
        )
        for module in slice35_modules:
            text = (LIB / module).read_text()
            self.assertNotIn("load_skill", text, f"{module} references runtime load_skill")
            self.assertNotIn("cao-mcp-server", text, f"{module} references the MCP server")


if __name__ == "__main__":
    unittest.main()
