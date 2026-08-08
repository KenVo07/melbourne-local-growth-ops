"""Gate I - proportional validation and evidence-reuse economics.

The interesting failure mode here is not "validation was too slow" but
"optimisation quietly removed the check that would have caught the bug".  These
tests therefore spend most of their effort trying to weaken mandatory
validation through every available seam, and trying to get the system to claim
a saving it did not earn.
"""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.common import ContractError, PolicyError
from mlgo_cao_v2.validation_policy import (
    CHECK_BROAD_TASK,
    CHECK_FOCUSED_LEAF,
    CHECK_FULL_FINAL,
    CHECK_INDEPENDENT_REVIEW,
    CHECK_REACHABILITY,
    CHECK_REQUIRED_CI,
    ReuseObservationStore,
    assert_final_validation_intact,
    build_validation_plan,
    classify_change,
    compare_fingerprints,
    economics_report,
    effective_reuse_mode,
    fingerprint,
)

LIB = Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2"


def available_checks():
    return [
        {"check_id": "leaf-billing", "kind": CHECK_FOCUSED_LEAF,
         "command": "pnpm test billing", "areas": ["apps/billing"]},
        {"check_id": "leaf-marketing", "kind": CHECK_FOCUSED_LEAF,
         "command": "pnpm test marketing", "areas": ["apps/marketing"]},
        {"check_id": "leaf-browser", "kind": CHECK_FOCUSED_LEAF,
         "command": "pnpm e2e browser", "areas": ["apps/storefront"]},
        {"check_id": "task-suite", "kind": CHECK_BROAD_TASK, "command": "pnpm test"},
        {"check_id": "independent-review", "kind": CHECK_INDEPENDENT_REVIEW, "command": None},
        {"check_id": "final-integrated", "kind": CHECK_FULL_FINAL, "command": "pnpm check"},
        {"check_id": "required-ci", "kind": CHECK_REQUIRED_CI, "command": "ci required"},
        {"check_id": "reachability", "kind": CHECK_REACHABILITY, "command": "reachability probe"},
    ]


def base_policy(mode="observation_only"):
    return {"validation_evidence": {"reuse_mode": mode, "minimum_observations_for_promotion": 3}}


def a_fingerprint(**overrides):
    values = {
        "command": "pnpm test billing",
        "source_digest": "src-1", "configuration_digest": "cfg-1",
        "environment_digest": "env-1", "toolchain_digest": "tool-1",
        "browser_digest": "browser-1", "provider_digest": "provider-1",
    }
    values.update(overrides)
    return fingerprint(**values)


class Slice3GateITests(unittest.TestCase):

    # -- I-01 ------------------------------------------------------------
    def test_I01_localized_low_risk_change_selects_focused_checks_with_reasons(self):
        classification = classify_change(
            changed_paths=["apps/billing/src/total.ts", "apps/billing/src/total.test.ts"],
        )
        self.assertEqual(classification["risk_tier"], "LOCALIZED_LOW")
        self.assertIn("confined to", classification["reason"])

        plan = build_validation_plan(plan_id="plan-i01", classification=classification,
                                     available_checks=available_checks())
        selected = {item["check_id"] for item in plan["selected"]}
        omitted = {item["check_id"] for item in plan["omitted"]}

        self.assertIn("leaf-billing", selected)
        # Unrelated expensive leaf checks are not ritualistically repeated.
        self.assertIn("leaf-marketing", omitted)
        self.assertIn("leaf-browser", omitted)
        self.assertIn("task-suite", omitted)
        self.assertIn("independent-review", omitted)

        # Mandatory checks still run even for the smallest change.
        self.assertIn("required-ci", selected)
        self.assertIn("reachability", selected)

        # Every decision, in both directions, carries a deterministic reason.
        for entry in plan["selected"] + plan["omitted"]:
            self.assertTrue(entry["reason"].strip(), entry["check_id"])
        self.assertIn("apps/marketing", next(
            e["reason"] for e in plan["omitted"] if e["check_id"] == "leaf-marketing"))

        # Determinism: identical inputs produce an identical plan digest.
        again = build_validation_plan(plan_id="plan-i01", classification=classification,
                                      available_checks=available_checks())
        self.assertEqual(plan["plan_digest"], again["plan_digest"])

    # -- I-02 ------------------------------------------------------------
    def test_I02_shared_architecture_change_selects_broad_checks_and_review(self):
        classification = classify_change(
            changed_paths=["apps/billing/src/total.ts", "packages/contracts/src/schema.ts"],
        )
        self.assertEqual(classification["risk_tier"], "SHARED_ARCHITECTURE")
        self.assertIn("packages/contracts/src/schema.ts", classification["shared_paths"])

        plan = build_validation_plan(plan_id="plan-i02", classification=classification,
                                     available_checks=available_checks())
        selected = {item["check_id"] for item in plan["selected"]}
        self.assertIn("task-suite", selected)
        self.assertIn("independent-review", selected)
        self.assertIn("required-ci", selected)
        self.assertIn("reachability", selected)

        # A config-only change is shared too.
        config_change = classify_change(changed_paths=["playwright.config.ts"])
        self.assertEqual(config_change["risk_tier"], "SHARED_ARCHITECTURE")

        # A declared risk may raise the tier but never lower it.
        raised = classify_change(changed_paths=["apps/billing/src/total.ts"],
                                 declared_risk="SHARED_ARCHITECTURE")
        self.assertEqual(raised["risk_tier"], "SHARED_ARCHITECTURE")
        lowered = classify_change(
            changed_paths=["apps/billing/src/total.ts", "packages/contracts/src/schema.ts"],
            declared_risk="LOCALIZED_LOW")
        self.assertEqual(lowered["risk_tier"], "SHARED_ARCHITECTURE")

    # -- I-03 ------------------------------------------------------------
    def test_I03_integration_candidate_always_runs_full_final_ci_and_reachability(self):
        classification = classify_change(
            changed_paths=["apps/billing/src/total.ts"], is_integration_candidate=True)
        self.assertEqual(classification["risk_tier"], "INTEGRATED_FINAL")

        plan = build_validation_plan(plan_id="plan-i03", classification=classification,
                                     available_checks=available_checks())
        selected = {item["check_id"] for item in plan["selected"]}
        for required in ("final-integrated", "required-ci", "reachability"):
            self.assertIn(required, selected)

        # Even a trivial one-file integration candidate gets the full gate.
        trivial = build_validation_plan(
            plan_id="plan-i03b",
            classification=classify_change(changed_paths=["README.md"],
                                           is_integration_candidate=True),
            available_checks=available_checks())
        self.assertIn("final-integrated", {i["check_id"] for i in trivial["selected"]})

        # Attempts to optimise the mandatory checks away fail closed.
        weakened = {**plan,
                    "selected": [i for i in plan["selected"] if i["kind"] != CHECK_FULL_FINAL],
                    "omitted": plan["omitted"] + [{"check_id": "final-integrated",
                                                   "kind": CHECK_FULL_FINAL,
                                                   "reason": "optimised away"}]}
        with self.assertRaises(PolicyError):
            assert_final_validation_intact(weakened)

        for kind, check_id in ((CHECK_REQUIRED_CI, "required-ci"),
                               (CHECK_REACHABILITY, "reachability")):
            dropped = {**plan,
                       "selected": [i for i in plan["selected"] if i["kind"] != kind],
                       "omitted": plan["omitted"] + [{"check_id": check_id, "kind": kind,
                                                      "reason": "optimised away"}]}
            with self.assertRaises(PolicyError):
                assert_final_validation_intact(dropped)

        # A plan builder can never emit such a plan in the first place.
        no_final = [c for c in available_checks() if c["kind"] != CHECK_FULL_FINAL]
        with self.assertRaises(PolicyError):
            build_validation_plan(plan_id="plan-i03c", classification=classification,
                                  available_checks=no_final)

    # -- I-04 ------------------------------------------------------------
    def test_I04_observation_only_records_the_candidate_but_still_reruns(self):
        with tempfile.TemporaryDirectory() as td:
            store = ReuseObservationStore(td)
            policy = base_policy("observation_only")
            fp = a_fingerprint()

            observation = store.observe(
                observation_id="obs-i04", policy=policy,
                candidate_fingerprint=fp, prior_fingerprint=fp,
                prior_returncode=0, actual_returncode=0, actual_elapsed_seconds=42.0,
            )

            self.assertTrue(observation["would_have_reused"])
            self.assertEqual(observation["agreement"], "AGREED")
            self.assertFalse(observation["false_hit"])
            # The real command ran, so nothing was avoided and nothing was saved.
            self.assertFalse(observation["validation_avoided"])
            self.assertEqual(observation["seconds_saved"], 0.0)
            self.assertEqual(observation["reuse_mode"], "observation_only")

            # Observation is meaningless once reuse is actually enforced.
            with self.assertRaises(PolicyError):
                store.observe(observation_id="obs-i04b",
                              policy={"validation_evidence": {"reuse_mode": "enforced"}},
                              candidate_fingerprint=fp, prior_fingerprint=fp,
                              prior_returncode=0, actual_returncode=0, actual_elapsed_seconds=1.0)

    # -- I-05 ------------------------------------------------------------
    def test_I05_changing_any_fingerprint_dimension_invalidates_reuse_exactly(self):
        base = a_fingerprint()
        cases = {
            "source": a_fingerprint(source_digest="src-2"),
            "configuration": a_fingerprint(configuration_digest="cfg-2"),
            "environment": a_fingerprint(environment_digest="env-2"),
            "toolchain": a_fingerprint(toolchain_digest="tool-2"),
            "browser": a_fingerprint(browser_digest="browser-2"),
            "provider": a_fingerprint(provider_digest="provider-2"),
        }
        for dimension, changed in cases.items():
            comparison = compare_fingerprints(base, changed)
            self.assertFalse(comparison["match"], dimension)
            self.assertEqual(comparison["changed_components"], [dimension])
            self.assertIn(dimension, comparison["reason"])

        self.assertTrue(compare_fingerprints(base, a_fingerprint())["match"])
        self.assertIn("command", compare_fingerprints(
            base, a_fingerprint(command="pnpm test other"))["changed_components"])

        with tempfile.TemporaryDirectory() as td:
            store = ReuseObservationStore(td)
            observation = store.observe(
                observation_id="obs-i05", policy=base_policy(),
                candidate_fingerprint=cases["browser"], prior_fingerprint=base,
                prior_returncode=0, actual_returncode=0, actual_elapsed_seconds=1.0,
            )
            self.assertFalse(observation["would_have_reused"])
            self.assertEqual(observation["comparison"]["changed_components"], ["browser"])

        # Every dimension must be declared explicitly, including inapplicable
        # ones: omitting browser/provider is a hard error, not a silent None.
        with self.assertRaises(TypeError):
            fingerprint(command="c", source_digest="s", configuration_digest="c",
                        environment_digest="e", toolchain_digest="t")
        not_applicable = fingerprint(
            command="c", source_digest="s", configuration_digest="c",
            environment_digest="e", toolchain_digest="t",
            browser_digest=None, provider_digest=None)
        self.assertIsNone(not_applicable["components"]["browser"])

        # An empty required dimension is refused rather than fingerprinted.
        for blank in ("source_digest", "configuration_digest",
                      "environment_digest", "toolchain_digest"):
            with self.assertRaises(ContractError, msg=blank):
                a_fingerprint(**{blank: "  "})

    # -- I-06 ------------------------------------------------------------
    def test_I06_a_single_false_hit_blocks_promotion_and_reuse_stays_disabled(self):
        with tempfile.TemporaryDirectory() as td:
            store = ReuseObservationStore(td)
            policy = base_policy("observation_only")
            fp = a_fingerprint()

            for index in range(3):
                store.observe(observation_id=f"obs-good-{index}", policy=policy,
                              candidate_fingerprint=fp, prior_fingerprint=fp,
                              prior_returncode=0, actual_returncode=0,
                              actual_elapsed_seconds=1.0)
            self.assertTrue(store.promotion_readiness(policy)["ready_for_operator_review"])

            # A deliberate false hit: the fingerprint matched, but the real rerun
            # disagreed with the evidence that would have been reused.
            false_hit = store.observe(
                observation_id="obs-false-hit", policy=policy,
                candidate_fingerprint=fp, prior_fingerprint=fp,
                prior_returncode=0, actual_returncode=1, actual_elapsed_seconds=1.0,
            )
            self.assertTrue(false_hit["false_hit"])
            self.assertEqual(false_hit["agreement"], "FALSE_HIT")

            readiness = store.promotion_readiness(policy)
            self.assertFalse(readiness["ready_for_operator_review"])
            self.assertEqual(readiness["false_hits"], 1)
            self.assertTrue(any("false hit" in b for b in readiness["blockers"]))
            self.assertFalse(readiness["promotes_reuse"])
            self.assertEqual(readiness["current_reuse_mode"], "observation_only")

    # -- I-07 ------------------------------------------------------------
    def test_I07_only_an_explicit_expiring_operator_promotion_can_enable_reuse(self):
        with tempfile.TemporaryDirectory() as td:
            store = ReuseObservationStore(td)
            policy = base_policy("observation_only")
            fp = a_fingerprint()
            for index in range(3):
                store.observe(observation_id=f"obs-ready-{index}", policy=policy,
                              candidate_fingerprint=fp, prior_fingerprint=fp,
                              prior_returncode=0, actual_returncode=0,
                              actual_elapsed_seconds=1.0)

            readiness = store.promotion_readiness(policy)
            self.assertTrue(readiness["ready_for_operator_review"])
            # Readiness is not activation.
            self.assertFalse(readiness["promotes_reuse"])
            self.assertEqual(effective_reuse_mode(policy), "observation_only")

            # Enforced mode without a promotion record fails closed.
            with self.assertRaises(PolicyError):
                effective_reuse_mode({"validation_evidence": {"reuse_mode": "enforced"}})

            # Nothing in this slice's modules can flip the mode to enforced.
            for name in ("validation_policy.py", "evidence.py"):
                text = (LIB / name).read_text(encoding="utf-8")
                self.assertNotIn('reuse_mode"] = "enforced"', text)
                self.assertNotIn("reuse_mode = 'enforced'", text)
                self.assertNotIn('"reuse_mode": "enforced"', text)

    # -- I-08 ------------------------------------------------------------
    def test_I08_economics_never_counts_savings_that_were_not_earned(self):
        with tempfile.TemporaryDirectory() as td:
            store = ReuseObservationStore(td)
            policy = base_policy("observation_only")
            fp = a_fingerprint()
            for index in range(3):
                store.observe(observation_id=f"obs-econ-{index}", policy=policy,
                              candidate_fingerprint=fp, prior_fingerprint=fp,
                              prior_returncode=0, actual_returncode=0,
                              actual_elapsed_seconds=30.0)

            classification = classify_change(
                changed_paths=["apps/billing/src/total.ts"])
            plan = build_validation_plan(plan_id="plan-i08", classification=classification,
                                         available_checks=available_checks())

            report = economics_report(policy=policy, plans=[plan],
                                      observations=store.observations())
            # Reuse is not enforced, so no time was saved, full stop.
            self.assertFalse(report["reuse_enforced"])
            self.assertEqual(report["reuse_seconds_saved"], 0.0)
            self.assertFalse(report["reuse_savings_counted"])
            self.assertIn("still reran", report["reuse_savings_note"])
            self.assertTrue(report["mandatory_checks_preserved"])

            # Work that was omitted but later repeated is not counted as avoided.
            repeated = economics_report(
                policy=policy, plans=[plan], observations=store.observations(),
                repeated_commands=["leaf-marketing", "task-suite"],
            )
            self.assertEqual(sorted(repeated["checks_omitted_but_repeated_later"]),
                             ["leaf-marketing", "task-suite"])
            self.assertEqual(repeated["omission_savings_counted"],
                             report["omission_savings_counted"] - 2)

    # -- boundary invariants ---------------------------------------------
    def test_reuse_remains_disabled_in_the_shipped_policy(self):
        text = (Path(__file__).resolve().parents[1] / "config" / "cao-policy.json").read_text()
        self.assertIn('"reuse_mode": "disabled"', text)

    def test_classification_is_total_and_deterministic(self):
        with self.assertRaises(ContractError):
            classify_change(changed_paths=[])
        with self.assertRaises(ContractError):
            classify_change(changed_paths=["a/b.ts"], declared_risk="NONSENSE")

        for _ in range(3):
            self.assertEqual(
                classify_change(changed_paths=["apps/billing/a.ts", "apps/billing/b.ts"])["risk_tier"],
                "LOCALIZED_LOW",
            )
        # Many files in one area is no longer "localized".
        many = classify_change(changed_paths=[f"apps/billing/f{i}.ts" for i in range(8)])
        self.assertEqual(many["risk_tier"], "TASK_BROAD")


if __name__ == "__main__":
    unittest.main()
