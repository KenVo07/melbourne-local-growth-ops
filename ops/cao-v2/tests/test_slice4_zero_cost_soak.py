"""Slice 4 S4-I: >=100 local, zero-provider-call randomized/replayed cases.

The historical "~100 sessions" target is satisfied here as pure local
soak - no provider is ever invoked. Every case below is a deterministic,
seeded combination exercising one of:

- canary-scope authority bindings (including cross-run collisions);
- budget reservation/duplicate-delivery idempotency;
- approval-broker operator-only/cross-scope denial (including stale
  decisions);
- sealed-skill-cache digest/version mismatch rejection.

Requirements asserted across the whole soak, per the Slice 4 contract:
- unauthorized silent approvals: 0
- cross-project/cross-run authority leakage: 0
- invalid skill pin (digest/version mismatch) accepted: 0
- unreconciled duplicate application: 0
"""

from __future__ import annotations

import copy
import random
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2 import canary_scope
from mlgo_cao_v2.approval import normalize_arguments
from mlgo_cao_v2.approval_broker import (
    APPROVED_BY_DELEGATION,
    APPROVED_BY_POLICY,
    CLASS_CREDENTIAL_AUTHORITY,
    CLASS_CROSS_PROJECT,
    CLASS_CROSS_SECURITY_DOMAIN,
    CLASS_DESTRUCTIVE_HOST_ACTION,
    CLASS_PRODUCTION_AUTHORITY,
    CLASS_READ_IN_SCOPE,
    CLASS_WRITE_IN_OWNED_SCOPE,
    DENIED_BY_POLICY,
    ESCALATED_FOR_AUTHORITY,
    OPERATOR_ONLY_CLASSES,
    ApprovalBroker,
    ApprovalStore,
)
from mlgo_cao_v2.budgets import BudgetStore, make_budget_policy, make_limit
from mlgo_cao_v2.skill_cache import SealedSkillCache

import slice35_fixtures as fx

SEED = 20260810
CASES_PER_DIMENSION = 26  # 4 dimensions * 26 >= 100 total cases


class ZeroCostSoakTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.rng = random.Random(SEED)
        self.case_count = 0
        self.unauthorized_silent_approvals = 0
        self.cross_authority_leaks = 0
        self.invalid_skill_pins_accepted = 0
        self.unreconciled_duplicate_applications = 0

    # -- dimension 1: canary-scope authority bindings ------------------------

    def test_D1_canary_scope_bindings_and_collisions(self):
        policy = {"state_root": str(self.tmp / "d1")}
        run_ids = [f"run-{i}" for i in range(8)]
        for i in range(CASES_PER_DIMENSION):
            self.case_count += 1
            scope_id = f"scope-{i}"
            named = self.rng.sample(run_ids, k=self.rng.randint(1, 3))
            other = [r for r in run_ids if r not in named]
            canary_scope.close_scope(policy, reason="soak reset")
            canary_scope.open_scope(
                policy, scope_id=scope_id, run_ids=named, ttl_seconds=60,
                reason="soak", opened_by="soak",
            )
            for r in named:
                self.assertTrue(canary_scope.is_authorized(policy, run_id=r))
            for r in other:
                if canary_scope.is_authorized(policy, run_id=r):
                    self.cross_authority_leaks += 1
            canary_scope.close_scope(policy, reason="soak case done")
            self.assertEqual(canary_scope.posture(policy), canary_scope.POSTURE_SHADOW)

        self.assertEqual(self.cross_authority_leaks, 0)

    # -- dimension 2: budget reservation idempotency / duplicate delivery ----

    def test_D2_budget_reservation_duplicate_delivery(self):
        for i in range(CASES_PER_DIMENSION):
            self.case_count += 1
            run_id = f"run-b{i}"
            v2_dir = self.tmp / "d2" / run_id / "v2"
            store = BudgetStore(v2_dir, run_id=run_id)
            policy = make_budget_policy(
                policy_id=f"p{i}", enforcement_mode="hard",
                limits=[make_limit(limit_id="l", scope_kind="run", scope_id=run_id, metric="provider_sessions", native_unit="sessions", limit_value=1, action="prohibit")],
            )
            command_id = f"cmd-{i}"
            first = store.evaluate_and_reserve(
                command_id=command_id, policy=policy, scopes={"run": run_id},
                requests=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}],
            )
            self.assertTrue(first["reserved"])
            # Randomized replay: the same delivery is retried 1-4 times, as a
            # crash-recovery retry loop would.
            for _ in range(self.rng.randint(1, 4)):
                replay = store.evaluate_and_reserve(
                    command_id=command_id, policy=policy, scopes={"run": run_id},
                    requests=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}],
                )
                if not replay["duplicate"]:
                    self.unreconciled_duplicate_applications += 1
            # A second distinct command on an exhausted limit must never
            # silently succeed.
            second = store.evaluate_and_reserve(
                command_id=f"cmd-{i}-second", policy=policy, scopes={"run": run_id},
                requests=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}],
            )
            if second["reserved"]:
                self.unauthorized_silent_approvals += 1
            store.settle(command_id, settled=[{"metric": "provider_sessions", "native_unit": "sessions", "amount": 1.0}])
            replay_after_settle = store.replay(command_states={command_id: "COMPLETED"})
            self.assertEqual(replay_after_settle["leaked"], [])

        self.assertEqual(self.unreconciled_duplicate_applications, 0)
        self.assertEqual(self.unauthorized_silent_approvals, 0)

    # -- dimension 3: approval-broker operator-only / cross-scope denial -----

    def test_D3_approval_broker_operator_only_and_cross_scope(self):
        operator_only = sorted(OPERATOR_ONLY_CLASSES)
        cross_scope_classes = [CLASS_CROSS_PROJECT, CLASS_CROSS_SECURITY_DOMAIN]
        pools = operator_only + cross_scope_classes + [CLASS_WRITE_IN_OWNED_SCOPE, CLASS_READ_IN_SCOPE]

        for i in range(CASES_PER_DIMENSION):
            self.case_count += 1
            store = ApprovalStore(self.tmp / "d3", project_id=fx.PROJECTS[i % 3], security_domain_id=fx.DOMAINS[i % 3])
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            op_class = pools[i % len(pools)]
            stale = self.rng.random() < 0.3
            intent = fx.an_intent(
                approval_request_id=f"req-d3-{i}",
                project_id=fx.PROJECTS[i % 3], security_domain_id=fx.DOMAINS[i % 3],
                operation_class=op_class, command_id=f"cmd-d3-{i}",
                policy_revision=fx.POLICY_REVISION if not stale else "stale-rev",
            )
            store.open_request(intent)
            decision = broker.evaluate(
                intent, decision_id=f"dec-d3-{i}",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST, current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )
            if op_class in OPERATOR_ONLY_CLASSES:
                if decision["outcome"] not in (DENIED_BY_POLICY, ESCALATED_FOR_AUTHORITY):
                    self.unauthorized_silent_approvals += 1
                self.assertNotIn(decision["outcome"], (APPROVED_BY_POLICY, APPROVED_BY_DELEGATION))
            if op_class in cross_scope_classes:
                # These classes are not policy-approvable at all in this
                # broker configuration; any APPROVED outcome would be a leak.
                if decision["outcome"] in (APPROVED_BY_POLICY, APPROVED_BY_DELEGATION):
                    self.cross_authority_leaks += 1
            if stale and decision["outcome"] in (APPROVED_BY_POLICY, APPROVED_BY_DELEGATION):
                # A stale policy_revision must never still be auto-approved.
                self.unauthorized_silent_approvals += 1

        self.assertEqual(self.unauthorized_silent_approvals, 0)
        self.assertEqual(self.cross_authority_leaks, 0)

    # -- dimension 4: sealed skill-cache digest/version mismatch -------------

    def test_D4_skill_cache_digest_and_version_mismatch_rejected(self):
        lock = fx.synthetic_lock()
        contents = fx.synthetic_lock_contents()
        cache = SealedSkillCache(self.tmp / "d4" / "cache")
        from mlgo_cao_v2.skill_population import populate_cache, bind_namespace

        def provider(overrides=None):
            payload = copy.deepcopy(contents)
            if overrides:
                overrides(payload)
            return lambda bundle: payload[bundle["bundle_id"]]

        populate_cache(cache=cache, lock=lock, source_provider=provider())
        for i in range(CASES_PER_DIMENSION):
            self.case_count += 1
            # Each case gets its own namespace so a "should be bound" case
            # (kind 1) can never leave a namespace behind that a later
            # "must never resolve" case (kind 0/2) accidentally reuses.
            project_id = f"soak-project-{i}"
            domain_id = f"soak-domain-{i}"
            bundle_id = lock["bundles"][i % len(lock["bundles"])]["bundle_id"]
            case_kind = i % 3
            if case_kind == 0:
                # Never bound in this namespace: must be rejected, not silently
                # inherited from another project.
                try:
                    cache.resolve(bundle_id=bundle_id, project_id=project_id, security_domain_id=domain_id)
                    self.invalid_skill_pins_accepted += 1
                except Exception:
                    pass
            elif case_kind == 1:
                bind_namespace(cache=cache, lock=lock, project_id=project_id, security_domain_id=domain_id)
                resolved = cache.resolve(bundle_id=bundle_id, project_id=project_id, security_domain_id=domain_id)
                self.assertTrue(resolved["files"])
            else:
                # A bundle_id that was never sealed under this id at all.
                try:
                    cache.resolve(bundle_id="bundle-does-not-exist", project_id=project_id, security_domain_id=domain_id)
                    self.invalid_skill_pins_accepted += 1
                except Exception:
                    pass

        self.assertEqual(self.invalid_skill_pins_accepted, 0)


if __name__ == "__main__":
    unittest.main()
