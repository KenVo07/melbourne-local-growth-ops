"""Gate J (source acceptance) - the canonical bundle lock is the real pin.

Gate J's original cases prove the sealed-cache machinery behaves under drift.
These cases prove the machinery is pointed at something real: that the four
canonical external sources are pinned in tracked, machine-readable source, that
production recipes resolve against those pins rather than fixtures, and that
host staging can populate a cache from the lock alone without ever making a
semantic choice.

The failure being hunted here is "the lock looks complete but does not actually
determine anything" - a floating ref, an invented digest, a recipe still
pointing at a fixture id, or a mirror accepted without proof.
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.canonical_lock import (
    APPROVED_BUNDLE_IDS,
    APPROVED_SOURCE_REPOSITORIES,
    DEFAULT_LOCK_PATH,
    SECURITY_PACK_BUNDLE_ID,
    CanonicalLockError,
    build_recipes,
    build_registry,
    bundle_manifests,
    load_lock,
    population_plan,
)
from mlgo_cao_v2.common import sha256_bytes, sha256_json
from mlgo_cao_v2.skill_cache import (
    BUNDLE_KIND_EXTERNAL_ENGINEERING,
    BUNDLE_KIND_SECURITY_PACK,
    SealedSkillCache,
    SkillIntegrityError,
    validate_bundle_manifest,
)
from mlgo_cao_v2.skill_population import (
    SkillPopulationError,
    bind_namespace,
    populate_cache,
    verify_native_mirror,
)
from mlgo_cao_v2.skill_recipes import compile_skill_contract

import slice35_fixtures as fx

SOURCE_ROOT = Path(__file__).resolve().parents[1]
LOCK_PATH = SOURCE_ROOT / "skills" / "canonical-skill-bundles.lock.json"

PROJECT = "mlgo"
DOMAIN = "mlgo-default"


def write_lock(directory: Path, lock) -> Path:
    path = directory / "lock.json"
    path.write_text(json.dumps(lock, sort_keys=True, separators=(",", ":")))
    return path


class CanonicalLockSourceTests(unittest.TestCase):
    """Facts asserted against the real, tracked lock file."""

    @classmethod
    def setUpClass(cls) -> None:
        cls.lock = load_lock(LOCK_PATH)

    # -- JL-01 -------------------------------------------------------------

    def test_JL01_tracked_lock_exists_at_the_default_production_path(self):
        # The production code must find the lock without being told where it is,
        # otherwise staging would depend on an operator-supplied path.
        self.assertTrue(LOCK_PATH.is_file())
        self.assertEqual(DEFAULT_LOCK_PATH.resolve(), LOCK_PATH.resolve())
        self.assertEqual(load_lock()["lock_digest"], self.lock["lock_digest"])

    def test_JL02_lock_pins_exactly_the_four_approved_sources(self):
        self.assertEqual(
            {b["bundle_id"] for b in self.lock["bundles"]}, set(APPROVED_BUNDLE_IDS)
        )
        self.assertEqual(
            {b["source_repository_or_distribution"] for b in self.lock["bundles"]},
            set(APPROVED_SOURCE_REPOSITORIES),
        )
        self.assertEqual(len(self.lock["bundles"]), 4)

    def test_JL03_every_pin_is_an_exact_immutable_commit_not_a_floating_ref(self):
        for bundle in self.lock["bundles"]:
            revision = bundle["source_revision"]
            self.assertEqual(bundle["source_revision_kind"], "git_commit_sha1")
            self.assertRegex(revision, r"^[0-9a-f]{40}$", bundle["bundle_id"])
            # A tag name may be recorded as human-readable metadata, but it is
            # never the thing that identifies the bytes.
            self.assertNotIn(revision, ("main", "master", "HEAD", "latest"))

    def test_JL04_every_selected_skill_file_has_an_exact_pinned_digest_and_size(self):
        for bundle in self.lock["bundles"]:
            pinned = {e["relative_path"]: e for e in bundle["file_manifest"]}
            self.assertTrue(pinned)
            for skill in bundle["selected_skills"]:
                entry = pinned.get(skill["relative_path"])
                self.assertIsNotNone(entry, skill["skill_id"])
                self.assertRegex(entry["content_digest"], r"^[0-9a-f]{64}$")
                self.assertGreater(entry["byte_count"], 0)
                self.assertEqual(skill["content_digest"], entry["content_digest"])
                self.assertEqual(skill["byte_count"], entry["byte_count"])

    def test_JL05_aggregate_bundle_digest_is_derived_not_asserted(self):
        for bundle in self.lock["bundles"]:
            derived = sha256_json(
                [
                    {
                        "relative_path": e["relative_path"],
                        "content_digest": e["content_digest"],
                        "byte_count": e["byte_count"],
                    }
                    for e in sorted(
                        bundle["file_manifest"], key=lambda e: e["relative_path"]
                    )
                ]
            )
            self.assertEqual(bundle["aggregate_content_digest"], derived)

    def test_JL06_lock_states_its_own_digest(self):
        body = {k: v for k, v in self.lock.items() if k != "lock_digest"}
        self.assertEqual(self.lock["lock_digest"], sha256_json(body))

    # -- production registry / recipes -------------------------------------

    def test_JL07_production_registry_builds_from_the_tracked_lock(self):
        registry = build_registry(self.lock)
        self.assertEqual(len(registry.bundles()), 4)
        self.assertTrue(registry.skills())
        for manifest in registry.bundles():
            validate_bundle_manifest(manifest)

    def test_JL08_every_production_recipe_reference_resolves_to_the_lock(self):
        registry = build_registry(self.lock)
        recipes = build_recipes(self.lock)
        pinned_ids = {s["skill_id"] for s in registry.skills()}
        self.assertTrue(recipes)
        for recipe_id, recipe in recipes.items():
            referenced = set(recipe["required_skill_ids"]) | set(
                recipe["optional_skill_ids"]
            )
            self.assertTrue(referenced, recipe_id)
            dangling = referenced - pinned_ids
            self.assertEqual(dangling, set(), f"{recipe_id} has dangling refs")
            for skill_id in referenced:
                # Resolving proves the id is a real registry fact, not a string.
                registry.skill(skill_id)

    def test_JL09_production_recipes_never_reference_synthetic_fixture_ids(self):
        recipes = build_recipes(self.lock)
        fixture_ids = {
            "engineering-implementation", "engineering-debugging",
            "engineering-typescript", "engineering-frontend-ui",
            "engineering-code-review", "engineering-architecture",
            "security-threat-modeling", "security-code-review",
            "cao-worker-protocols", "cao-handoff-recovery",
        }
        for recipe_id, recipe in recipes.items():
            referenced = set(recipe["required_skill_ids"]) | set(
                recipe["optional_skill_ids"]
            )
            self.assertEqual(
                referenced & fixture_ids, set(), f"{recipe_id} references fixture ids"
            )

    def test_JL10_exactly_one_security_pack_is_qualified(self):
        registry = build_registry(self.lock)
        packs = [
            b for b in registry.bundles()
            if b["bundle_kind"] == BUNDLE_KIND_SECURITY_PACK
        ]
        self.assertEqual(len(packs), 1)
        active = registry.assert_single_security_pack()
        self.assertIsNotNone(active)
        self.assertEqual(active["bundle_id"], SECURITY_PACK_BUNDLE_ID)
        # The Security Pack revision is the one already qualified in Slice 3.5
        # evidence; a silent change here would be an unreviewed re-qualification.
        self.assertEqual(
            active["source_revision"], "70bc259bb01abb3015ad2ad859ad5253cbf0bcab"
        )

    def test_JL11_engineering_bundles_cannot_claim_security_pack_precedence(self):
        for bundle in self.lock["bundles"]:
            if bundle["bundle_id"] == SECURITY_PACK_BUNDLE_ID:
                continue
            self.assertEqual(bundle["bundle_kind"], BUNDLE_KIND_EXTERNAL_ENGINEERING)
            for skill in bundle["selected_skills"]:
                self.assertGreaterEqual(skill["precedence_tier"], 4)

    def test_JL12_lock_carries_no_third_party_bytes(self):
        # Provenance only.  If skill payloads ever leaked into the lock it would
        # become a vendoring path, which the supply-chain design forbids.
        raw = LOCK_PATH.read_text()
        self.assertNotIn("---\nname:", raw)
        for bundle in self.lock["bundles"]:
            for key in ("content", "body", "payload", "text"):
                self.assertNotIn(key, bundle)
            self.assertFalse(bundle["provenance_record"]["upstream_code_executed"])
            self.assertFalse(
                bundle["provenance_record"]["bytes_vendored_into_product_repo"]
            )

    # -- determinism / no semantic choice ----------------------------------

    def test_JL13_population_plan_is_fully_determined_by_the_lock(self):
        plan = population_plan(self.lock)
        self.assertTrue(plan)
        # One entry per pinned file, each naming exactly one revision, one path,
        # one digest and one size.  Nothing to choose between at staging time.
        expected = sum(len(b["file_manifest"]) for b in self.lock["bundles"])
        self.assertEqual(len(plan), expected)
        keys = [(e["bundle_id"], e["relative_path"]) for e in plan]
        self.assertEqual(len(set(keys)), len(keys), "ambiguous duplicate plan targets")
        for entry in plan:
            self.assertRegex(entry["source_revision"], r"^[0-9a-f]{40}$")
            self.assertRegex(entry["expected_content_digest"], r"^[0-9a-f]{64}$")
            self.assertIsInstance(entry["expected_byte_count"], int)
        self.assertEqual(plan, population_plan(load_lock(LOCK_PATH)))

    def test_JL14_manifest_derivation_is_deterministic_across_loads(self):
        # Two independent loads must produce identical manifest digests, or the
        # contract digest would not be a stable binding for run evidence.
        first = bundle_manifests(load_lock(LOCK_PATH))
        second = bundle_manifests(load_lock(LOCK_PATH))
        self.assertEqual(
            {k: v["manifest_digest"] for k, v in first.items()},
            {k: v["manifest_digest"] for k, v in second.items()},
        )
        self.assertEqual(
            build_registry(load_lock(LOCK_PATH)).registry_revision,
            build_registry(load_lock(LOCK_PATH)).registry_revision,
        )


class CanonicalLockRejectionTests(unittest.TestCase):
    """Fault injection against copies of the tracked lock."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.lock = load_lock(LOCK_PATH)

    def load_mutated(self, mutate, *, reseal: bool = True):
        lock = copy.deepcopy(self.lock)
        mutate(lock)
        if reseal:
            lock = fx.reseal_lock(lock)
        return load_lock(write_lock(self.tmp, lock))

    # -- JL-15: floating references ---------------------------------------

    def test_JL15_floating_branch_tag_or_latest_reference_is_rejected(self):
        for floating in ("main", "master", "HEAD", "latest", "v1.2.3",
                         "refs/heads/main", "refs/tags/v1.2.3", "bdf76c7"):
            with self.subTest(revision=floating):
                with self.assertRaises(CanonicalLockError) as ctx:
                    self.load_mutated(
                        lambda lock, r=floating: lock["bundles"][0].update(
                            source_revision=r
                        )
                    )
                self.assertIn("bundle-addy-osmani-agent-skills", str(ctx.exception))

    def test_JL16_non_commit_revision_kind_is_rejected(self):
        # A "discovery" or "range" pin is not a pin.
        for kind in ("git_branch", "semver_range", "discovery", "latest_release"):
            with self.subTest(kind=kind):
                with self.assertRaises(CanonicalLockError):
                    self.load_mutated(
                        lambda lock, k=kind: lock["bundles"][0].update(
                            source_revision_kind=k
                        )
                    )

    # -- JL-17: unapproved sources ----------------------------------------

    def test_JL17_a_fifth_unapproved_source_is_rejected(self):
        def add_fifth(lock):
            extra = copy.deepcopy(lock["bundles"][0])
            extra["bundle_id"] = "bundle-unapproved-marketplace"
            extra["source_repository_or_distribution"] = (
                "https://github.com/example/unapproved-skills"
            )
            lock["bundles"].append(extra)

        with self.assertRaises(CanonicalLockError) as ctx:
            self.load_mutated(add_fifth)
        self.assertIn("not an approved canonical bundle", str(ctx.exception))

    def test_JL18_an_approved_bundle_id_pointed_at_a_new_repository_is_rejected(self):
        # The closed set is over (bundle_id, repository), so a supply-chain
        # substitution that keeps the familiar id is still caught.
        with self.assertRaises(CanonicalLockError) as ctx:
            self.load_mutated(
                lambda lock: lock["bundles"][0].update(
                    source_repository_or_distribution="https://github.com/evil/agent-skills"
                )
            )
        self.assertIn("unapproved source", str(ctx.exception))

    def test_JL19_dropping_an_approved_bundle_is_rejected(self):
        with self.assertRaises(CanonicalLockError) as ctx:
            self.load_mutated(lambda lock: lock["bundles"].pop())
        self.assertIn("missing approved bundles", str(ctx.exception))

    def test_JL20_a_second_qualified_security_pack_is_rejected(self):
        def promote(lock):
            for bundle in lock["bundles"]:
                if bundle["bundle_id"] != SECURITY_PACK_BUNDLE_ID:
                    bundle["bundle_kind"] = BUNDLE_KIND_SECURITY_PACK
                    return

        with self.assertRaises(CanonicalLockError):
            self.load_mutated(promote)

    # -- JL-21: digest / path drift ---------------------------------------

    def test_JL21_an_altered_lock_that_was_not_resealed_is_rejected(self):
        with self.assertRaises(CanonicalLockError) as ctx:
            self.load_mutated(
                lambda lock: lock["bundles"][0]["file_manifest"][0].update(
                    byte_count=1
                ),
                reseal=False,
            )
        self.assertIn("altered after it was pinned", str(ctx.exception))

    def test_JL22_a_resealed_digest_edit_still_fails_the_aggregate_check(self):
        # Resealing the lock hides the edit from the self-digest, so the
        # aggregate derivation has to catch it independently.
        with self.assertRaises(CanonicalLockError) as ctx:
            self.load_mutated(
                lambda lock: lock["bundles"][0]["file_manifest"][0].update(
                    content_digest="0" * 64
                )
            )
        self.assertIn("aggregate digest does not match", str(ctx.exception))

    def test_JL23_a_skill_pointing_at_an_unpinned_path_is_rejected(self):
        with self.assertRaises(CanonicalLockError) as ctx:
            self.load_mutated(
                lambda lock: lock["bundles"][0]["selected_skills"][0].update(
                    relative_path="skills/not-pinned/SKILL.md"
                )
            )
        self.assertIn("absent from", str(ctx.exception))

    def test_JL24_a_malformed_digest_is_rejected(self):
        for bad in ("", "abc", "Z" * 64, "A" * 64):
            with self.subTest(digest=bad):
                with self.assertRaises(CanonicalLockError):
                    self.load_mutated(
                        lambda lock, d=bad: lock["bundles"][0]["file_manifest"][0].update(
                            content_digest=d
                        )
                    )

    def test_JL25_a_recipe_referencing_an_unpinned_skill_is_rejected(self):
        lock = copy.deepcopy(self.lock)
        lock["recipes"][0]["required_skill_ids"] = ["totally-made-up-skill"]
        lock = fx.reseal_lock(lock)
        loaded = load_lock(write_lock(self.tmp, lock))
        with self.assertRaises(CanonicalLockError) as ctx:
            build_recipes(loaded)
        self.assertIn("not pinned by any canonical bundle", str(ctx.exception))


class CanonicalLockContractDriftTests(unittest.TestCase):
    """Drift must invalidate a compiled SkillContract, using real sealing."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.lock = fx.synthetic_lock()
        self.cache = SealedSkillCache(self.tmp / "cache")
        fx.seal_synthetic_lock(self.cache, self.lock)
        bind_namespace(
            cache=self.cache,
            lock=self.lock,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
        )

    def compile(self, lock, recipe_id="recipe-implementation-backend"):
        registry = build_registry(lock)
        recipe = build_recipes(lock)[recipe_id]
        return compile_skill_contract(
            registry=registry,
            cache=self.cache,
            recipe=recipe,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
            role="developer",
            task_class="implementation",
            risk_class="standard",
        )

    def test_JL26_an_undrifted_lock_compiles_a_bound_contract(self):
        contract = self.compile(self.lock)
        self.assertTrue(contract["selected_skills"])
        self.assertFalse(contract["requires_runtime_skill_loading"])
        self.assertTrue(contract["selected_before_dispatch"])
        # Recompilation of identical facts is byte-identical where it binds.
        self.assertEqual(
            contract["skill_contract_digest"],
            self.compile(self.lock)["skill_contract_digest"],
        )

    #: A skill that ``recipe-implementation-backend`` *requires*, so the drift
    #: is guaranteed to be resolved rather than excluded as an unmet optional.
    REQUIRED_SKILL_ID = "addy-incremental-implementation"

    def drift_required_skill(self, mutate_entry, mutate_skill):
        """Apply drift to a required skill and reseal the lock around it."""

        lock = copy.deepcopy(self.lock)
        for bundle in lock["bundles"]:
            target = next(
                (s for s in bundle["selected_skills"]
                 if s["skill_id"] == self.REQUIRED_SKILL_ID),
                None,
            )
            if target is None:
                continue
            entry = next(
                e for e in bundle["file_manifest"]
                if e["relative_path"] == target["relative_path"]
            )
            mutate_entry(entry)
            mutate_skill(target)
            bundle["aggregate_content_digest"] = sha256_json(
                [
                    {
                        "relative_path": e["relative_path"],
                        "content_digest": e["content_digest"],
                        "byte_count": e["byte_count"],
                    }
                    for e in sorted(
                        bundle["file_manifest"], key=lambda e: e["relative_path"]
                    )
                ]
            )
            break
        else:
            self.fail(f"{self.REQUIRED_SKILL_ID} is not in the synthetic lock")
        return load_lock(write_lock(self.tmp, fx.reseal_lock(lock)))

    def test_JL27_one_byte_of_digest_drift_invalidates_the_contract(self):
        drifted = "0" * 63 + "1"
        loaded = self.drift_required_skill(
            lambda entry: entry.update(content_digest=drifted),
            lambda skill: skill.update(content_digest=drifted),
        )
        # The lock is internally consistent, so it loads - and then fails
        # closed against the sealed bytes, which is the point.
        with self.assertRaises(SkillIntegrityError):
            self.compile(loaded)

    def test_JL28_path_drift_invalidates_the_contract(self):
        relocated = "skills/relocated/SKILL.md"
        loaded = self.drift_required_skill(
            lambda entry: entry.update(relative_path=relocated),
            lambda skill: skill.update(relative_path=relocated),
        )
        with self.assertRaises(SkillIntegrityError):
            self.compile(loaded)

    def test_JL29_revision_drift_changes_the_registry_revision(self):
        # A new upstream revision must not be able to masquerade as the pinned
        # one: the registry revision (and therefore the contract) has to move.
        before = build_registry(self.lock).registry_revision
        lock = copy.deepcopy(self.lock)
        lock["bundles"][0]["source_revision"] = "f" * 40
        lock = fx.reseal_lock(lock)
        loaded = load_lock(write_lock(self.tmp, lock))
        self.assertNotEqual(before, build_registry(loaded).registry_revision)
        self.assertNotEqual(
            self.compile(self.lock)["skill_contract_digest"],
            self.compile(loaded)["skill_contract_digest"],
        )


class CachePopulationToolTests(unittest.TestCase):
    """The operator population tool, exercised offline against synthetic bytes."""

    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.lock = fx.synthetic_lock()
        self.contents = fx.synthetic_lock_contents()
        self.cache = SealedSkillCache(self.tmp / "cache")

    def provider(self, overrides=None):
        payload = copy.deepcopy(self.contents)
        if overrides:
            overrides(payload)

        def _provider(bundle):
            return payload[bundle["bundle_id"]]

        return _provider

    def test_JL30_population_seals_every_pinned_bundle(self):
        report = populate_cache(
            cache=self.cache, lock=self.lock, source_provider=self.provider()
        )
        self.assertEqual(report["sealed_count"], len(self.lock["bundles"]))
        self.assertFalse(report["upstream_code_executed"])
        for bundle in self.lock["bundles"]:
            sealed = self.cache.load_manifest(bundle["bundle_id"])
            self.assertIsNotNone(sealed)
            self.assertEqual(
                sealed["content_digest"], bundle["aggregate_content_digest"]
            )

    def test_JL31_population_is_idempotent(self):
        first = populate_cache(
            cache=self.cache, lock=self.lock, source_provider=self.provider()
        )
        second = populate_cache(
            cache=self.cache, lock=self.lock, source_provider=self.provider()
        )
        self.assertEqual(first["sealed_count"], len(self.lock["bundles"]))
        self.assertEqual(second["sealed_count"], 0)
        self.assertEqual(second["already_sealed_count"], len(self.lock["bundles"]))
        self.assertEqual(
            [b["content_digest"] for b in first["bundles"]],
            [b["content_digest"] for b in second["bundles"]],
        )

    def test_JL32_a_digest_mismatch_fails_and_seals_nothing(self):
        def corrupt(payload):
            bundle_id = self.lock["bundles"][-1]["bundle_id"]
            path = next(iter(payload[bundle_id]))
            payload[bundle_id][path] = b"tampered content"

        with self.assertRaises(SkillPopulationError) as ctx:
            populate_cache(
                cache=self.cache,
                lock=self.lock,
                source_provider=self.provider(corrupt),
            )
        self.assertIn("digest mismatch", str(ctx.exception))
        # Atomicity across the whole plan: the *earlier*, valid bundles must not
        # have been sealed, or a failed run would leave a half-populated cache.
        for bundle in self.lock["bundles"]:
            self.assertIsNone(self.cache.load_manifest(bundle["bundle_id"]))

    def test_JL33_a_missing_pinned_file_fails_and_seals_nothing(self):
        def drop(payload):
            bundle_id = self.lock["bundles"][-1]["bundle_id"]
            payload[bundle_id].pop(next(iter(payload[bundle_id])))

        with self.assertRaises(SkillPopulationError) as ctx:
            populate_cache(
                cache=self.cache, lock=self.lock, source_provider=self.provider(drop)
            )
        self.assertIn("missing pinned files", str(ctx.exception))
        for bundle in self.lock["bundles"]:
            self.assertIsNone(self.cache.load_manifest(bundle["bundle_id"]))

    def test_JL34_an_unpinned_extra_file_is_refused(self):
        def add_extra(payload):
            bundle_id = self.lock["bundles"][0]["bundle_id"]
            payload[bundle_id]["skills/smuggled/SKILL.md"] = b"not in the lock"

        with self.assertRaises(SkillPopulationError) as ctx:
            populate_cache(
                cache=self.cache,
                lock=self.lock,
                source_provider=self.provider(add_extra),
            )
        self.assertIn("does not pin", str(ctx.exception))

    def test_JL35_populated_cache_compiles_every_production_recipe(self):
        populate_cache(
            cache=self.cache, lock=self.lock, source_provider=self.provider()
        )
        bind_namespace(
            cache=self.cache,
            lock=self.lock,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
        )
        registry = build_registry(self.lock)
        for recipe_id, recipe in build_recipes(self.lock).items():
            with self.subTest(recipe=recipe_id):
                contract = compile_skill_contract(
                    registry=registry,
                    cache=self.cache,
                    recipe=recipe,
                    project_id=PROJECT,
                    security_domain_id=DOMAIN,
                    role=recipe["role"],
                    task_class=recipe["task_classes"][0],
                    risk_class=recipe["risk_classes"][0],
                )
                self.assertTrue(contract["selected_skills"])

    # -- native mirror ------------------------------------------------------

    def build_mirror(self, root: Path, *, drift: bool = False) -> Path:
        root.mkdir(parents=True, exist_ok=True)
        for bundle in self.lock["bundles"]:
            for skill in bundle["selected_skills"]:
                directory = root / skill["native_mirror_name"]
                directory.mkdir(parents=True, exist_ok=True)
                data = self.contents[bundle["bundle_id"]][skill["relative_path"]]
                (directory / "SKILL.md").write_bytes(data)
        if drift:
            first = self.lock["bundles"][0]["selected_skills"][0]
            (root / first["native_mirror_name"] / "SKILL.md").write_bytes(b"drifted")
        return root

    def prepared_cache(self):
        populate_cache(
            cache=self.cache, lock=self.lock, source_provider=self.provider()
        )
        bind_namespace(
            cache=self.cache,
            lock=self.lock,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
        )

    def test_JL36_an_equivalent_native_mirror_is_accepted_without_mutation(self):
        self.prepared_cache()
        mirror = self.build_mirror(self.tmp / "mirror")
        before = {
            p: sha256_bytes(p.read_bytes()) for p in sorted(mirror.rglob("SKILL.md"))
        }
        report = verify_native_mirror(
            cache=self.cache,
            lock=self.lock,
            mirror_root=mirror,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
        )
        self.assertTrue(report["accepted"])
        self.assertTrue(report["equivalent"])
        self.assertFalse(report["mirror_mutated"])
        after = {
            p: sha256_bytes(p.read_bytes()) for p in sorted(mirror.rglob("SKILL.md"))
        }
        self.assertEqual(before, after, "verification must never write to the mirror")

    def test_JL37_a_drifted_native_mirror_is_rejected_not_repaired(self):
        self.prepared_cache()
        mirror = self.build_mirror(self.tmp / "mirror", drift=True)
        drifted_path = (
            mirror
            / self.lock["bundles"][0]["selected_skills"][0]["native_mirror_name"]
            / "SKILL.md"
        )
        report = verify_native_mirror(
            cache=self.cache,
            lock=self.lock,
            mirror_root=mirror,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
        )
        self.assertFalse(report["accepted"])
        differences = [d for b in report["bundles"] for d in b["differences"]]
        self.assertTrue(differences)
        self.assertIn("digest mismatch", {d["reason"] for d in differences})
        # Rejected, never silently corrected: the drifted bytes are still there.
        self.assertEqual(drifted_path.read_bytes(), b"drifted")

    def test_JL38_a_missing_native_mirror_is_reported_not_created(self):
        self.prepared_cache()
        absent = self.tmp / "no-such-mirror"
        report = verify_native_mirror(
            cache=self.cache,
            lock=self.lock,
            mirror_root=absent,
            project_id=PROJECT,
            security_domain_id=DOMAIN,
        )
        self.assertFalse(report["accepted"])
        self.assertFalse(absent.exists(), "verification must not create the mirror")


class PopulationToolBoundaryTests(unittest.TestCase):
    """The tool must stay a cache utility and nothing more."""

    @staticmethod
    def population_code() -> str:
        """The population module's code, with its prose docstring removed.

        The docstring names the things the tool must not touch, so scanning it
        would flag the very statement of the guarantee being checked.
        """

        source = (
            SOURCE_ROOT / "lib" / "mlgo_cao_v2" / "skill_population.py"
        ).read_text()
        _, _, body = source.partition('"""')
        _, _, code = body.partition('"""')
        return code

    def test_JL39_population_module_never_activates_policy_or_providers(self):
        source = self.population_code()
        for forbidden in (
            "from .policy", "from .profiles", "from .dispatch", "from .routing",
            "from .registry", "from .controller", "from .restart",
            ".config/mlgo-cao",
        ):
            self.assertNotIn(forbidden, source, f"population tool touches {forbidden}")

    def test_JL40_population_module_never_executes_upstream_content(self):
        source = self.population_code()
        for forbidden in ("exec(", "eval(", "importlib", "pip install", "npm install"):
            self.assertNotIn(forbidden, source)
        # Acquisition runs git and nothing else; git is invoked argv-style, so
        # there is no shell for upstream content to reach.
        self.assertIn("subprocess.run", source)
        self.assertNotIn("shell=True", source)
        self.assertIn("--no-recurse-submodules", source)
        self.assertIn("core.hooksPath", source)

    def test_JL42_lock_resolves_in_both_source_and_installed_layouts(self):
        # The installed library lives outside the source tree, so a purely
        # source-relative lock path would leave the staged tool unable to find
        # its own pins.  Both layouts plus an explicit override must resolve.
        from mlgo_cao_v2.canonical_lock import (
            LOCK_FILENAME,
            LOCK_PATH_ENV_VAR,
            STAGED_LOCK_PATH,
            resolve_lock_path,
        )

        self.assertEqual(STAGED_LOCK_PATH.name, LOCK_FILENAME)
        self.assertEqual(DEFAULT_LOCK_PATH.name, LOCK_FILENAME)
        self.assertEqual(
            STAGED_LOCK_PATH.parent,
            Path.home() / ".local" / "share" / "mlgo-cao-v2" / "skills",
        )
        # In this source checkout the source path wins.
        self.assertEqual(resolve_lock_path().resolve(), LOCK_PATH.resolve())
        # An explicit path always wins over discovery.
        self.assertEqual(resolve_lock_path("/tmp/explicit.json"), Path("/tmp/explicit.json"))

        import os as _os
        import unittest.mock as _mock

        with tempfile.TemporaryDirectory() as tmp:
            override = Path(tmp) / "override.json"
            override.write_bytes(LOCK_PATH.read_bytes())
            with _mock.patch.dict(
                _os.environ, {LOCK_PATH_ENV_VAR: str(override)}, clear=False
            ):
                self.assertEqual(resolve_lock_path(), override)
                self.assertEqual(
                    load_lock()["lock_digest"], load_lock(LOCK_PATH)["lock_digest"]
                )

            # An override that does not exist fails closed rather than quietly
            # falling back to a different lock than the operator asked for.
            with _mock.patch.dict(
                _os.environ, {LOCK_PATH_ENV_VAR: str(Path(tmp) / "absent.json")},
                clear=False,
            ):
                with self.assertRaises(CanonicalLockError):
                    resolve_lock_path()

    def test_JL43_installer_stages_the_lock_alongside_the_tool(self):
        # install.sh puts every bin/* on PATH; if it did not also stage the
        # lock, the installed tool would be permanently unable to load its pins.
        installer = (SOURCE_ROOT / "install.sh").read_text()
        self.assertIn('"$src/skills"', installer)

    def test_JL41_carried_dispatch_residuals_remain_unwired(self):
        # This remediation must not wire the two open residuals as a side effect.
        dispatch = (SOURCE_ROOT / "lib" / "mlgo_cao_v2" / "dispatch.py").read_text()
        self.assertNotIn("context_envelope", dispatch)
        self.assertNotIn("budgets", dispatch)


if __name__ == "__main__":
    unittest.main()
