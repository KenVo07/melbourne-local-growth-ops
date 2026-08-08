"""Gate K - Approval Broker correctness.

These tests are written from the attacker's side of the contract.  The
interesting question is never "does an approval work" but "can an approval be
made to work somewhere it was never meant to": a different project, a different
Command, a later policy revision, a second delivery, or after the host lost
track of whether the effect already happened.
"""

from __future__ import annotations

import datetime as dt
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.approval import (
    APPROVED_BY_DELEGATION,
    APPROVED_BY_POLICY,
    AUTHORITY_OPERATOR,
    AUTHORITY_SUPERVISOR,
    AUTHORITY_TECH_LEAD,
    DENIED_BY_POLICY,
    ESCALATED_FOR_AUTHORITY,
    UNKNOWN_RECONCILIATION_REQUIRED,
    APPROVED,
    ApprovalBindingError,
    new_approval_application,
    new_bounded_grant,
    revalidate_before_application,
)
from mlgo_cao_v2.approval_broker import (
    CLASS_CREDENTIAL_AUTHORITY,
    CLASS_CROSS_PROJECT,
    CLASS_CROSS_SECURITY_DOMAIN,
    CLASS_DESTRUCTIVE_HOST_ACTION,
    CLASS_HISTORY_REWRITE,
    CLASS_OUT_OF_ENVELOPE_SPEND,
    CLASS_PRIVILEGE_ESCALATION,
    CLASS_PRODUCTION_AUTHORITY,
    CLASS_CONTROL_PLANE_MUTATION,
    CLASS_READ_IN_SCOPE,
    CLASS_SEMANTIC_OWNERSHIP_CONFLICT,
    CLASS_WRITE_IN_OWNED_SCOPE,
    CLASS_WRITE_OUTSIDE_OWNED_SCOPE,
    OPERATOR_ONLY_CLASSES,
    ApprovalBroker,
    ApprovalPolicyError,
    ApprovalStore,
    assert_no_blind_reapply,
)
from mlgo_cao_v2.common import PolicyError, iso_now, sha256_json
from mlgo_cao_v2.permission_adapter import assert_not_remember_authority

import slice35_fixtures as fx


def in_hours(hours: int) -> str:
    stamp = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=hours)
    return stamp.replace(microsecond=0).isoformat().replace("+00:00", "Z")


class Slice35GateKTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        self.store = ApprovalStore(
            self.root, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
        )
        self.broker = ApprovalBroker(self.store, **fx.delegated_broker_args())
        self.addCleanup(self._tmp.cleanup)

    def decide(self, intent, *, decision_id="dec-1", **overrides):
        self.store.open_request(intent)
        kwargs = dict(
            decision_id=decision_id,
            owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
            current_pre_state_digest=fx.PRE_STATE_DIGEST,
        )
        kwargs.update(overrides)
        return self.broker.evaluate(intent, **kwargs)

    # -- K-01 ------------------------------------------------------------

    def test_K01_exact_safe_read_in_scope_is_approved_by_policy(self):
        intent = fx.an_intent(operation_class=CLASS_READ_IN_SCOPE)
        decision = self.decide(intent)
        self.assertEqual(decision["outcome"], APPROVED_BY_POLICY)
        self.assertEqual(decision["authority_class"], "HOST_POLICY")
        self.assertIn("BOUNDED_READ_IN_DECLARED_SCOPE", decision["reason_codes"])
        # The approval is bounded to the exact operation, not to a tool class.
        constraints = decision["approved_operation_constraints"]
        self.assertEqual(constraints["arguments_digest"], intent["arguments_digest"])
        self.assertEqual(constraints["resource_refs"], intent["resource_refs"])

    # -- K-02 ------------------------------------------------------------

    def test_K02_bounded_write_in_owned_scope_is_approved_by_delegation(self):
        intent = fx.an_intent(
            approval_request_id="req-write",
            operation_class=CLASS_WRITE_IN_OWNED_SCOPE,
            operation_name="write_repository_file",
        )
        decision = self.decide(intent, decision_id="dec-write")
        self.assertEqual(decision["outcome"], APPROVED_BY_DELEGATION)
        self.assertEqual(decision["authority_class"], AUTHORITY_TECH_LEAD)
        self.assertIn("DELEGATION_CURRENT", decision["reason_codes"])
        self.assertEqual(
            decision["approved_operation_constraints"]["owned_scope_digest"],
            fx.OWNED_SCOPE_DIGEST,
        )

    def test_K02_a_write_is_refused_when_the_pre_state_moved(self):
        intent = fx.an_intent(
            approval_request_id="req-w2", operation_class=CLASS_WRITE_IN_OWNED_SCOPE
        )
        decision = self.decide(
            intent,
            decision_id="dec-w2",
            current_pre_state_digest=sha256_json({"head": "b" * 40}),
        )
        self.assertEqual(decision["outcome"], DENIED_BY_POLICY)
        self.assertIn("PRE_STATE_DIGEST_MISMATCH", decision["reason_codes"])

    # -- K-03 ------------------------------------------------------------

    def test_K03_write_outside_owned_scope_is_denied_with_zero_application(self):
        intent = fx.an_intent(
            approval_request_id="req-out",
            operation_class=CLASS_WRITE_OUTSIDE_OWNED_SCOPE,
            operation_name="write_repository_file",
        )
        decision = self.decide(intent, decision_id="dec-out")
        self.assertEqual(decision["outcome"], DENIED_BY_POLICY)
        self.assertIn("OPERATOR_ONLY_CLASS", decision["reason_codes"])
        # A denied decision can never reach the adapter: revalidation refuses
        # to hand it forward at all.
        with self.assertRaises(ApprovalBindingError) as ctx:
            revalidate_before_application(
                intent=intent, decision=decision, current=fx.current_context(intent)
            )
        self.assertIn("does not authorize application", str(ctx.exception))
        self.assertEqual(self.store.list_applications(), [])

    # -- K-04 ------------------------------------------------------------

    def test_K04_cross_project_and_cross_domain_operations_are_denied(self):
        for index, operation_class in enumerate(
            (CLASS_CROSS_PROJECT, CLASS_CROSS_SECURITY_DOMAIN)
        ):
            intent = fx.an_intent(
                approval_request_id=f"req-cross-{index}", operation_class=operation_class
            )
            decision = self.decide(intent, decision_id=f"dec-cross-{index}")
            self.assertEqual(decision["outcome"], DENIED_BY_POLICY, operation_class)
            self.assertIn("NEVER_AUTO_APPROVED", decision["reason_codes"])

    # -- K-05 ------------------------------------------------------------

    def test_K05_semantic_ownership_conflict_escalates_to_named_authority(self):
        intent = fx.an_intent(
            approval_request_id="req-conflict",
            operation_class=CLASS_SEMANTIC_OWNERSHIP_CONFLICT,
        )
        decision = self.decide(intent, decision_id="dec-conflict")
        self.assertEqual(decision["outcome"], ESCALATED_FOR_AUTHORITY)
        self.assertEqual(decision["required_authority_class"], AUTHORITY_TECH_LEAD)
        self.assertIn("SEMANTIC_OWNERSHIP_CONFLICT", decision["reason_codes"])

    def test_K05_a_lower_authority_cannot_close_a_higher_escalation(self):
        intent = fx.an_intent(
            approval_request_id="req-esc-high",
            operation_class=CLASS_PRODUCTION_AUTHORITY,
        )
        decision = self.decide(intent, decision_id="dec-esc-high")
        self.assertEqual(decision["required_authority_class"], AUTHORITY_OPERATOR)
        for weaker in (AUTHORITY_TECH_LEAD, AUTHORITY_SUPERVISOR):
            with self.assertRaises(PolicyError):
                self.broker.close_escalation(
                    decision=decision, answering_authority_class=weaker
                )
        closed = self.broker.close_escalation(
            decision=decision, answering_authority_class=AUTHORITY_OPERATOR
        )
        self.assertTrue(closed["ok"])

    # -- K-06 ------------------------------------------------------------

    def test_K06_operator_only_classes_are_never_auto_approved(self):
        operator_gated = (
            CLASS_CREDENTIAL_AUTHORITY,
            CLASS_PRODUCTION_AUTHORITY,
            CLASS_CONTROL_PLANE_MUTATION,
            CLASS_DESTRUCTIVE_HOST_ACTION,
            CLASS_HISTORY_REWRITE,
            CLASS_OUT_OF_ENVELOPE_SPEND,
            CLASS_PRIVILEGE_ESCALATION,
        )
        for index, operation_class in enumerate(operator_gated):
            intent = fx.an_intent(
                approval_request_id=f"req-op-{index}", operation_class=operation_class
            )
            decision = self.decide(intent, decision_id=f"dec-op-{index}")
            self.assertEqual(
                decision["outcome"], ESCALATED_FOR_AUTHORITY, operation_class
            )
            self.assertEqual(
                decision["required_authority_class"], AUTHORITY_OPERATOR, operation_class
            )

    def test_K06_no_operator_only_class_can_ever_be_approved(self):
        for index, operation_class in enumerate(sorted(OPERATOR_ONLY_CLASSES)):
            intent = fx.an_intent(
                approval_request_id=f"req-all-{index}", operation_class=operation_class
            )
            decision = self.decide(intent, decision_id=f"dec-all-{index}")
            self.assertNotIn(
                decision["outcome"],
                (APPROVED_BY_POLICY, APPROVED_BY_DELEGATION),
                f"{operation_class} was auto-approved",
            )

    def test_K06_a_delegation_may_not_even_name_an_operator_only_class(self):
        with self.assertRaises(ApprovalPolicyError) as ctx:
            ApprovalBroker(
                self.store,
                policy_revision=fx.POLICY_REVISION,
                registry_revision=fx.REGISTRY_REVISION,
                delegation_revision=fx.DELEGATION_REVISION,
                delegated_operation_classes=[CLASS_CREDENTIAL_AUTHORITY],
            )
        self.assertIn("operator-only", str(ctx.exception))

    # -- K-07 ------------------------------------------------------------

    def test_K07_stale_revisions_are_refused_at_decision_time(self):
        for index, field in enumerate(
            ("policy_revision", "registry_revision", "delegation_revision")
        ):
            intent = fx.an_intent(
                approval_request_id=f"req-stale-{index}", **{field: "moved-on"}
            )
            decision = self.decide(intent, decision_id=f"dec-stale-{index}")
            self.assertEqual(decision["outcome"], DENIED_BY_POLICY, field)
            self.assertIn(f"STALE_{field.upper()}", decision["reason_codes"])

    def test_K07_stale_bindings_are_refused_immediately_before_application(self):
        intent = fx.an_intent(approval_request_id="req-reval")
        decision = self.decide(intent, decision_id="dec-reval")
        self.assertEqual(decision["outcome"], APPROVED_BY_POLICY)

        for field, moved in (
            ("skill_contract_digest", sha256_json({"other": "contract"})),
            ("expected_pre_state_digest", sha256_json({"head": "c" * 40})),
            ("executor_epoch", 2),
            ("owned_scope_digest", sha256_json(["elsewhere"])),
            ("command_id", "cmd-999"),
        ):
            current = fx.current_context(intent, **{field: moved})
            with self.assertRaises(ApprovalBindingError) as ctx:
                self.broker.prepare_application(
                    intent=intent, decision=decision, current=current
                )
            self.assertIn(field, str(ctx.exception))

    def test_K07_an_unmoved_context_revalidates_cleanly(self):
        intent = fx.an_intent(approval_request_id="req-ok")
        decision = self.decide(intent, decision_id="dec-ok")
        report = self.broker.prepare_application(
            intent=intent, decision=decision, current=fx.current_context(intent)
        )
        self.assertTrue(report["ok"])
        self.assertIn("skill_contract_digest", report["checked_bindings"])

    # -- K-08 ------------------------------------------------------------

    def test_K08_duplicate_decision_and_application_delivery_is_a_no_op(self):
        intent = fx.an_intent(approval_request_id="req-dup")
        first = self.decide(intent, decision_id="dec-dup")
        self.assertFalse(first["duplicate"])
        again = self.store.record_decision(
            {k: v for k, v in first.items() if k != "duplicate"}
        )
        self.assertTrue(again["duplicate"])

        application = new_approval_application(
            application_id="app-dup",
            decision=first,
            adapter_id="adapter-fixture",
            provider_profile_id="profile-fixture",
            observed_state=APPROVED,
        )
        applied = self.store.record_application(application)
        self.assertTrue(applied["applied"])
        replay = self.store.record_application(application)
        self.assertTrue(replay["duplicate"])
        self.assertFalse(replay["applied"])
        self.assertEqual(len(self.store.list_applications()), 1)

    def test_K08_a_second_application_id_for_the_same_effect_is_still_one_effect(self):
        intent = fx.an_intent(approval_request_id="req-idem")
        decision = self.decide(intent, decision_id="dec-idem")
        for application_id in ("app-idem-1", "app-idem-2"):
            self.store.record_application(
                new_approval_application(
                    application_id=application_id,
                    decision=decision,
                    adapter_id="adapter-fixture",
                    provider_profile_id="profile-fixture",
                    observed_state=APPROVED,
                )
            )
        # The idempotency key covers the effect, so the second delivery under a
        # fresh application ID is still recognised as the same operation.
        self.assertEqual(len(self.store.list_applications()), 1)

    # -- K-09 ------------------------------------------------------------

    def test_K09_unknown_application_blocks_and_forbids_blind_reapply(self):
        intent = fx.an_intent(approval_request_id="req-unknown")
        decision = self.decide(intent, decision_id="dec-unknown")
        application = new_approval_application(
            application_id="app-unknown",
            decision=decision,
            adapter_id="adapter-fixture",
            provider_profile_id="profile-fixture",
            observed_state=UNKNOWN_RECONCILIATION_REQUIRED,
        )
        self.store.record_application(application)
        self.assertTrue(application["blocks_execution"])
        self.assertTrue(application["requires_reconciliation"])
        with self.assertRaises(ApprovalBindingError) as ctx:
            assert_no_blind_reapply(self.store.list_applications())
        self.assertIn("blocks resubmission", str(ctx.exception))

    def test_K09_only_a_durable_store_reconciliation_clears_the_block(self):
        intent = fx.an_intent(approval_request_id="req-rec")
        decision = self.decide(intent, decision_id="dec-rec")
        self.store.record_application(
            new_approval_application(
                application_id="app-rec",
                decision=decision,
                adapter_id="adapter-fixture",
                provider_profile_id="profile-fixture",
                observed_state=UNKNOWN_RECONCILIATION_REQUIRED,
            )
        )
        with self.assertRaises(ApprovalBindingError):
            assert_no_blind_reapply(self.store.list_applications())

        resolved = self.store.reconcile_application(
            "app-rec",
            resolved_state=APPROVED,
            evidence={"source": "operator_confirmed_effect_did_not_occur"},
        )
        self.assertFalse(resolved["blocks_execution"])
        self.assertFalse(resolved["requires_reconciliation"])
        assert_no_blind_reapply(self.store.list_applications())

    def test_K09_reconciliation_may_not_resolve_to_another_blocked_state(self):
        intent = fx.an_intent(approval_request_id="req-rec2")
        decision = self.decide(intent, decision_id="dec-rec2")
        self.store.record_application(
            new_approval_application(
                application_id="app-rec2",
                decision=decision,
                adapter_id="adapter-fixture",
                provider_profile_id="profile-fixture",
                observed_state=UNKNOWN_RECONCILIATION_REQUIRED,
            )
        )
        with self.assertRaises(PolicyError):
            self.store.reconcile_application(
                "app-rec2",
                resolved_state=UNKNOWN_RECONCILIATION_REQUIRED,
                evidence={"source": "still ambiguous"},
            )

    # -- K-10 ------------------------------------------------------------

    def test_K10_restart_while_pending_restores_the_same_durable_records(self):
        intent = fx.an_intent(approval_request_id="req-restart")
        decision = self.decide(intent, decision_id="dec-restart")
        self.store.record_application(
            new_approval_application(
                application_id="app-restart",
                decision=decision,
                adapter_id="adapter-fixture",
                provider_profile_id="profile-fixture",
                observed_state="WAITING_FOR_APPROVAL",
            )
        )
        reopened = ApprovalStore(
            self.root, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
        )
        restored_request = reopened.load_request("req-restart")
        restored_decision = reopened.load_decision("dec-restart")
        self.assertEqual(restored_request["request_digest"], intent["request_digest"])
        self.assertEqual(
            restored_decision["decision_digest"], decision["decision_digest"]
        )
        self.assertEqual(
            [r["approval_request_id"] for r in reopened.pending_requests()],
            ["req-restart"],
        )
        # Replaying the same application after restart produces no second effect.
        replay = reopened.record_application(
            new_approval_application(
                application_id="app-restart-2",
                decision=restored_decision,
                adapter_id="adapter-fixture",
                provider_profile_id="profile-fixture",
                observed_state=APPROVED,
            )
        )
        self.assertTrue(replay["duplicate"])
        self.assertEqual(len(reopened.list_applications()), 1)

    # -- K-11 ------------------------------------------------------------

    def test_K11_provider_remember_state_never_becomes_authority_or_a_grant(self):
        adapter = fx.an_adapter()
        observation = adapter.normalize_observation(
            fx.evidence(
                "fixture.permission.granted", remember_offered=True, remember_active=True
            )
        )
        # The presence of "remember" is recorded but changes nothing.
        self.assertTrue(observation["provider_remember_active"])
        self.assertEqual(observation["observed_state"], APPROVED)
        assert_not_remember_authority(observation)
        with self.assertRaises(PolicyError) as ctx:
            assert_not_remember_authority(
                {**observation, "treat_remember_as_authority": True}
            )
        self.assertIn("never be used as CAO authority", str(ctx.exception))

        # A one-shot decision cannot be turned into a grant regardless.
        intent = fx.an_intent(approval_request_id="req-remember")
        decision = self.decide(intent, decision_id="dec-remember")
        self.assertEqual(decision["one_shot_or_bounded_grant"], "ONE_SHOT")
        with self.assertRaises(PolicyError):
            new_bounded_grant(
                grant_id="grant-illegal",
                decision=decision,
                operation_class=CLASS_READ_IN_SCOPE,
                resource_refs=intent["resource_refs"],
                argument_constraints={},
                expires_at=in_hours(1),
            )

    # -- K-12 ------------------------------------------------------------

    def test_K12_a_decision_for_project_a_cannot_authorize_colliding_project_b(self):
        intent_a = fx.an_intent(
            approval_request_id="req-collide",
            project_id=fx.PROJECTS[0],
            security_domain_id=fx.DOMAINS[0],
            command_id="cmd-collide",
            task_id="task-collide",
        )
        decision_a = self.decide(intent_a, decision_id="dec-collide")

        # Project B is byte-identical apart from its namespace.
        intent_b = fx.an_intent(
            approval_request_id="req-collide",
            project_id=fx.PROJECTS[1],
            security_domain_id=fx.DOMAINS[1],
            command_id="cmd-collide",
            task_id="task-collide",
        )
        store_b = ApprovalStore(
            self.root, project_id=fx.PROJECTS[1], security_domain_id=fx.DOMAINS[1]
        )
        broker_b = ApprovalBroker(store_b, **fx.delegated_broker_args())
        store_b.open_request(intent_b)

        with self.assertRaises(PolicyError) as ctx:
            store_b.record_decision(
                {k: v for k, v in decision_a.items() if k != "duplicate"}
            )
        self.assertIn("belongs to namespace", str(ctx.exception))

        with self.assertRaises(PolicyError):
            broker_b.prepare_application(
                intent=intent_b,
                decision=decision_a,
                current=fx.current_context(intent_b),
            )
        self.assertIsNone(store_b.load_decision("dec-collide"))

    def test_K12_a_decision_cannot_be_rebound_to_a_different_request(self):
        intent_1 = fx.an_intent(approval_request_id="req-r1", command_id="cmd-r1")
        decision = self.decide(intent_1, decision_id="dec-r1")
        intent_2 = fx.an_intent(approval_request_id="req-r2", command_id="cmd-r2")
        self.store.open_request(intent_2)
        with self.assertRaises(ApprovalBindingError) as ctx:
            revalidate_before_application(
                intent=intent_2, decision=decision, current=fx.current_context(intent_2)
            )
        self.assertIn("not bound to this request", str(ctx.exception))

    # -- K-13 ------------------------------------------------------------

    def test_K13_expired_and_revoked_bounded_grants_are_rejected_immediately(self):
        intent = fx.an_intent(approval_request_id="req-grant")
        decision = self.decide(
            intent,
            decision_id="dec-grant",
            bounded_grant=True,
            grant_expires_at=in_hours(2),
        )
        self.assertEqual(decision["one_shot_or_bounded_grant"], "BOUNDED_GRANT")

        live = new_bounded_grant(
            grant_id="grant-live",
            decision=decision,
            operation_class=CLASS_READ_IN_SCOPE,
            resource_refs=intent["resource_refs"],
            argument_constraints={},
            expires_at=in_hours(2),
        )
        self.store.record_grant(live)
        self.assertTrue(self.store.grant_is_usable(live)["usable"])

        expired = {**live, "grant_id": "grant-expired", "expires_at": in_hours(-1)}
        self.assertFalse(self.store.grant_is_usable(expired)["usable"])
        self.assertEqual(self.store.grant_is_usable(expired)["reason"], "grant expired")

        revoked = {**live, "grant_id": "grant-revoked", "revoked": True}
        self.assertFalse(self.store.grant_is_usable(revoked)["usable"])

        exhausted = {**live, "grant_id": "grant-used", "uses": 1, "max_uses": 1}
        self.assertFalse(self.store.grant_is_usable(exhausted)["usable"])

    # -- K-14 ------------------------------------------------------------

    def test_K14_revision_mutation_revokes_grants_without_corrupting_decisions(self):
        intent = fx.an_intent(approval_request_id="req-mutate")
        decision = self.decide(
            intent,
            decision_id="dec-mutate",
            bounded_grant=True,
            grant_expires_at=in_hours(4),
        )
        grant = new_bounded_grant(
            grant_id="grant-mutate",
            decision=decision,
            operation_class=CLASS_READ_IN_SCOPE,
            resource_refs=intent["resource_refs"],
            argument_constraints={},
            expires_at=in_hours(4),
        )
        self.store.record_grant(grant)
        before = self.store.load_decision("dec-mutate")

        revoked = self.store.revoke_grants_for_revisions(
            delegation_revision="delegation-rev-2"
        )
        self.assertEqual(revoked, ["grant-mutate"])
        reloaded = self.store.load_grant("grant-mutate")
        self.assertTrue(reloaded["revoked"])
        self.assertFalse(self.store.grant_is_usable(reloaded)["usable"])

        # The historical decision is untouched, digest included.
        after = self.store.load_decision("dec-mutate")
        self.assertEqual(before, after)
        self.assertEqual(after["decision_digest"], decision["decision_digest"])

    def test_K14_an_unaffected_grant_survives_an_unrelated_revision_change(self):
        intent = fx.an_intent(approval_request_id="req-keep")
        decision = self.decide(
            intent,
            decision_id="dec-keep",
            bounded_grant=True,
            grant_expires_at=in_hours(4),
        )
        grant = new_bounded_grant(
            grant_id="grant-keep",
            decision=decision,
            operation_class=CLASS_READ_IN_SCOPE,
            resource_refs=intent["resource_refs"],
            argument_constraints={},
            expires_at=in_hours(4),
        )
        self.store.record_grant(grant)
        self.assertEqual(
            self.store.revoke_grants_for_revisions(
                policy_revision=fx.POLICY_REVISION,
                registry_revision=fx.REGISTRY_REVISION,
                delegation_revision=fx.DELEGATION_REVISION,
            ),
            [],
        )
        self.assertTrue(self.store.grant_is_usable(self.store.load_grant("grant-keep"))["usable"])


if __name__ == "__main__":
    unittest.main()
