"""Gate L - PermissionAdapter contract and truthful execution state.

The property under test is that the controller's picture of a worker is derived
only from evidence it can actually justify.  So these tests repeatedly hand the
adapter things that *look* like evidence - unfamiliar tokens, a provider that
changed its wording, a "remember" flag, a bare claim of progress - and require
that none of them move the system toward an optimistic answer.
"""

from __future__ import annotations

import re
import unittest
from pathlib import Path

from mlgo_cao_v2.approval import (
    APPROVED,
    DENIED,
    NOT_REQUIRED,
    PREAUTHORIZED,
    UNKNOWN_RECONCILIATION_REQUIRED,
    WAITING_FOR_APPROVAL,
    new_approval_application,
    worker_health_state,
)
from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.permission_adapter import (
    CAP_BOUNDED_UI_FALLBACK,
    CAP_NATIVE_PREAUTHORIZATION,
    CAP_ONE_SHOT_APPROVAL,
    CAP_REMEMBER_STATE_PRESENCE,
    MATURITY_OBSERVED,
    MATURITY_QUALIFIED,
    NON_AUTHORITATIVE_CAPABILITIES,
    PermissionAdapterError,
    assert_not_remember_authority,
    effective_permission_capability,
    normalized_states_are_exclusive,
    resolved_states,
)

import slice35_fixtures as fx

LIB = Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2"

#: Concrete provider, vendor and product identifiers that must never appear in
#: controller/broker semantic policy.
PROVIDER_BRAND_RE = re.compile(
    r"\b(chatgpt|openai|anthropic|claude|claude_code|codex|gemini|kimi|deepseek|"
    r"copilot|cursor|agy_sidecar|web_bridge|browser_bridge|kiro|opencode)\b",
    re.IGNORECASE,
)


#: Sentinel so a test can distinguish "use the default qualification" from
#: "there is deliberately no qualification record".
_DEFAULT = object()

#: Concrete UI-automation primitives.  Matching identifiers rather than English
#: words keeps the assertion about code rather than about prose.
UI_AUTOMATION_PRIMITIVES = (
    "xdotool", "pyautogui", "pynput", "send_keys", "sendkeys", "keystroke",
    "auto_click", "autoclick", "subprocess", "tmux", "expect(",
)


class Slice35GateLTests(unittest.TestCase):
    def setUp(self) -> None:
        self.adapter = fx.an_adapter()
        self.qualification = fx.a_qualification(self.adapter)

    def capability(self, name, *, qualification=_DEFAULT, adapter=None, policy_enabled=True):
        adapter = adapter or self.adapter
        return effective_permission_capability(
            qualification=self.qualification if qualification is _DEFAULT else qualification,
            current_identity=adapter.identity(),
            capability=name,
            policy_enabled=policy_enabled,
        )

    def a_decision(self):
        intent = fx.an_intent(approval_request_id="req-l")
        from mlgo_cao_v2.approval import new_approval_decision

        return new_approval_decision(
            decision_id="dec-l",
            intent=intent,
            outcome="APPROVED_BY_POLICY",
            authority_class="HOST_POLICY",
            reason_codes=["BOUNDED_READ_IN_DECLARED_SCOPE"],
            approved_operation_constraints={
                "operation_class": intent["operation_class"],
                "operation_name": intent["operation_name"],
                "arguments_digest": intent["arguments_digest"],
                "resource_refs": intent["resource_refs"],
            },
        )

    # -- L-01 ------------------------------------------------------------

    def test_L01_qualified_native_preauthorization_prepares_bounded_authorization(self):
        state = self.capability(CAP_NATIVE_PREAUTHORIZATION)
        self.assertTrue(state["enabled"])
        decision = self.a_decision()
        prepared = self.adapter.prepare_native_preauthorization(
            decision=decision, capability_state=state
        )
        self.assertEqual(prepared["observed_state"], PREAUTHORIZED)
        self.assertEqual(prepared["request_digest"], decision["request_digest"])
        self.assertEqual(
            prepared["bounded_constraints"], decision["approved_operation_constraints"]
        )
        self.assertTrue(prepared["one_shot"])

    def test_L01_preauthorization_without_bounded_constraints_is_refused(self):
        from mlgo_cao_v2.approval import new_approval_decision

        unbounded = new_approval_decision(
            decision_id="dec-unbounded",
            intent=fx.an_intent(approval_request_id="req-unbounded"),
            outcome="APPROVED_BY_POLICY",
            authority_class="HOST_POLICY",
            reason_codes=["TEST"],
            approved_operation_constraints={},
        )
        with self.assertRaises(PermissionAdapterError) as ctx:
            self.adapter.prepare_native_preauthorization(
                decision=unbounded,
                capability_state=self.capability(CAP_NATIVE_PREAUTHORIZATION),
            )
        self.assertIn("no bounded operation constraints", str(ctx.exception))

    def test_L01_an_unqualified_adapter_cannot_preauthorize(self):
        with self.assertRaises(PermissionAdapterError):
            self.adapter.prepare_native_preauthorization(
                decision=self.a_decision(),
                capability_state=self.capability(
                    CAP_NATIVE_PREAUTHORIZATION, qualification=None
                ),
            )

    # -- L-02 ------------------------------------------------------------

    def test_L02_an_observed_permission_wait_is_waiting_not_running(self):
        observation = self.adapter.normalize_observation(
            fx.evidence("fixture.permission.awaiting_user")
        )
        self.assertEqual(observation["observed_state"], WAITING_FOR_APPROVAL)
        application = new_approval_application(
            application_id="app-wait",
            decision=self.a_decision(),
            adapter_id=self.adapter.adapter_id,
            provider_profile_id=self.adapter.provider_profile_id,
            observed_state=observation["observed_state"],
        )
        health = worker_health_state(
            applications=[application], execution_progressing=True
        )
        self.assertEqual(health["state"], WAITING_FOR_APPROVAL)
        self.assertFalse(health["running"])
        self.assertTrue(health["waiting_for_approval"])

    # -- L-03 ------------------------------------------------------------

    def test_L03_changed_provider_wording_fails_closed_not_open(self):
        # A provider that renamed its permission tokens.  The old vocabulary must
        # stop resolving rather than resolving to something plausible.
        moved = fx.an_adapter(observation_map=fx.FIXTURE_OBSERVATION_MAP_V2)
        stale_token = self.adapter.normalize_observation(
            fx.evidence("fixture.permission.granted")
        )
        self.assertEqual(stale_token["observed_state"], APPROVED)

        against_new_adapter = moved.normalize_observation(
            fx.evidence("fixture.permission.granted")
        )
        self.assertEqual(
            against_new_adapter["observed_state"], UNKNOWN_RECONCILIATION_REQUIRED
        )
        self.assertIn("not in this adapter's qualified map", against_new_adapter["reason"])

        # The new vocabulary normalizes to exactly the same core semantics.
        renormalized = moved.normalize_observation(
            fx.evidence("fixture.permission.v2.granted")
        )
        self.assertEqual(renormalized["observed_state"], APPROVED)

    def test_L03_core_state_vocabulary_is_identical_across_adapter_versions(self):
        v1 = {
            self.adapter.normalize_observation(fx.evidence(t))["observed_state"]
            for t in fx.FIXTURE_OBSERVATION_MAP
        }
        moved = fx.an_adapter(observation_map=fx.FIXTURE_OBSERVATION_MAP_V2)
        v2 = {
            moved.normalize_observation(fx.evidence(t))["observed_state"]
            for t in fx.FIXTURE_OBSERVATION_MAP_V2
        }
        self.assertEqual(v1, v2)

    # -- L-04 ------------------------------------------------------------

    def test_L04_undeterminable_evidence_becomes_unknown_reconciliation_required(self):
        for evidence in (
            fx.evidence("fixture.permission.something_new"),
            {"token": ""},
            {"noise": "the terminal printed something"},
        ):
            observation = self.adapter.normalize_observation(evidence)
            self.assertEqual(
                observation["observed_state"], UNKNOWN_RECONCILIATION_REQUIRED
            )

    def test_L04_liveness_and_output_are_never_treated_as_permission_evidence(self):
        # Nothing in the adapter surface accepts a PID, an exit code or raw
        # terminal text as an input, so there is no path by which liveness could
        # become a permission state.
        text = (LIB / "permission_adapter.py").read_text()
        for forbidden in ("pid", "poll(", "returncode", "stdout", "isatty", "psutil"):
            self.assertNotIn(forbidden, text, f"adapter reads {forbidden}")

    # -- L-05 ------------------------------------------------------------

    def test_L05_one_shot_application_is_bound_to_the_exact_decision(self):
        decision = self.a_decision()
        observation = self.adapter.apply_one_shot(
            decision=decision,
            capability_state=self.capability(CAP_ONE_SHOT_APPROVAL),
            evidence=fx.evidence("fixture.permission.granted"),
        )
        self.assertEqual(observation["observed_state"], APPROVED)
        self.assertEqual(observation["bound_decision_id"], decision["decision_id"])
        self.assertEqual(observation["bound_request_digest"], decision["request_digest"])
        self.assertTrue(observation["applied_one_shot"])

    # -- L-06 ------------------------------------------------------------

    def test_L06_explicit_deny_blocks_the_worker_with_a_durable_reason(self):
        observation = self.adapter.normalize_observation(
            fx.evidence("fixture.permission.refused")
        )
        self.assertEqual(observation["observed_state"], DENIED)
        application = new_approval_application(
            application_id="app-deny",
            decision=self.a_decision(),
            adapter_id=self.adapter.adapter_id,
            provider_profile_id=self.adapter.provider_profile_id,
            observed_state=DENIED,
            provider_observation_ref={"reason": observation["reason"]},
        )
        # DENIED is terminal, not a block awaiting reconciliation.
        self.assertFalse(application["blocks_execution"])
        self.assertFalse(application["requires_reconciliation"])
        self.assertTrue(application["provider_observation_ref"]["reason"])
        self.assertIn(DENIED, resolved_states())

    # -- L-07 ------------------------------------------------------------

    def test_L07_bounded_ui_fallback_is_not_implemented_and_stays_disabled(self):
        # Slice 3.5 could not qualify a bounded UI fallback, so it is left
        # disabled rather than implemented blind.  The capability name exists so
        # a future slice can qualify it; nothing enables it today.
        self.assertNotIn(CAP_BOUNDED_UI_FALLBACK, self.adapter.declared_capabilities)
        state = self.capability(CAP_BOUNDED_UI_FALLBACK)
        self.assertFalse(state["enabled"])
        self.assertEqual(state["reason"], "capability was never qualified for this adapter")

        # No auto-clicking machinery exists anywhere in the slice.
        text = (LIB / "permission_adapter.py").read_text().lower()
        for forbidden in UI_AUTOMATION_PRIMITIVES:
            self.assertNotIn(forbidden, text, f"UI automation primitive {forbidden}")

    def test_L07_an_unqualified_capability_cannot_be_enabled_by_policy_alone(self):
        state = effective_permission_capability(
            qualification=None,
            current_identity=self.adapter.identity(),
            capability=CAP_BOUNDED_UI_FALLBACK,
            policy_enabled=True,
        )
        self.assertFalse(state["enabled"])

    # -- L-08 ------------------------------------------------------------

    def test_L08_remember_state_is_recorded_but_never_authoritative(self):
        observation = self.adapter.normalize_observation(
            fx.evidence(
                "fixture.permission.granted", remember_offered=True, remember_active=True
            )
        )
        self.assertTrue(observation["provider_remember_offered"])
        assert_not_remember_authority(observation)
        with self.assertRaises(PolicyError):
            assert_not_remember_authority(
                {**observation, "treat_remember_as_authority": True}
            )
        # The capability is structurally marked non-authority-bearing.
        self.assertIn(CAP_REMEMBER_STATE_PRESENCE, NON_AUTHORITATIVE_CAPABILITIES)
        self.assertFalse(
            self.capability(CAP_REMEMBER_STATE_PRESENCE)["authority_bearing"]
        )

    def test_L08_remember_does_not_change_the_normalized_state(self):
        without = self.adapter.normalize_observation(
            fx.evidence("fixture.permission.awaiting_user")
        )
        with_remember = self.adapter.normalize_observation(
            fx.evidence(
                "fixture.permission.awaiting_user",
                remember_offered=True,
                remember_active=True,
            )
        )
        self.assertEqual(without["observed_state"], with_remember["observed_state"])
        self.assertEqual(with_remember["observed_state"], WAITING_FOR_APPROVAL)

    # -- L-09 ------------------------------------------------------------

    def test_L09_provider_or_wrapper_version_change_makes_qualification_stale(self):
        for overrides in (
            {"provider_version": "2.0.0"},
            {"wrapper_version": "1.1.0"},
            {"observation_map": fx.FIXTURE_OBSERVATION_MAP_V2},
        ):
            upgraded = fx.an_adapter(**overrides)
            state = effective_permission_capability(
                qualification=self.qualification,
                current_identity=upgraded.identity(),
                capability=CAP_NATIVE_PREAUTHORIZATION,
                policy_enabled=True,
            )
            self.assertTrue(state["stale"], overrides)
            self.assertFalse(state["enabled"], overrides)
            self.assertIn("version drift", state["reason"])

    def test_L09_requalification_against_the_new_identity_restores_the_capability(self):
        upgraded = fx.an_adapter(provider_version="2.0.0")
        requalified = fx.a_qualification(upgraded, qualification_id="qual-v2")
        state = effective_permission_capability(
            qualification=requalified,
            current_identity=upgraded.identity(),
            capability=CAP_NATIVE_PREAUTHORIZATION,
            policy_enabled=True,
        )
        self.assertTrue(state["enabled"])
        self.assertFalse(state["stale"])

    def test_L09_observed_maturity_is_below_the_qualified_bar(self):
        partial = fx.a_qualification(
            self.adapter,
            qualification_id="qual-partial",
            capabilities={CAP_NATIVE_PREAUTHORIZATION: MATURITY_OBSERVED},
        )
        state = effective_permission_capability(
            qualification=partial,
            current_identity=self.adapter.identity(),
            capability=CAP_NATIVE_PREAUTHORIZATION,
            policy_enabled=True,
        )
        self.assertFalse(state["enabled"])
        self.assertIn("below required", state["reason"])

    # -- L-10 ------------------------------------------------------------

    def test_L10_no_provider_brand_appears_in_controller_or_broker_semantics(self):
        for module in ("approval.py", "approval_broker.py", "permission_adapter.py",
                       "skill_recipes.py", "skills_registry.py", "security_pack.py"):
            text = (LIB / module).read_text()
            for line_number, line in enumerate(text.splitlines(), start=1):
                match = PROVIDER_BRAND_RE.search(line)
                self.assertIsNone(
                    match,
                    f"{module}:{line_number} leaks provider brand "
                    f"{match.group(0) if match else ''!r}: {line.strip()}",
                )

    def test_L10_provider_specifics_live_only_in_adapter_instance_data(self):
        # The adapter class itself carries no provider vocabulary; the map is
        # supplied as registry/instance data at construction time.
        from mlgo_cao_v2.permission_adapter import PermissionAdapter

        self.assertEqual(dict(PermissionAdapter.observation_map), {})
        self.assertTrue(self.adapter.observation_map)

    # -- L-11 ------------------------------------------------------------

    def test_L11_running_and_waiting_for_approval_are_mutually_exclusive(self):
        self.assertFalse(
            normalized_states_are_exclusive(WAITING_FOR_APPROVAL, execution_progressing=True)
        )
        self.assertTrue(
            normalized_states_are_exclusive(WAITING_FOR_APPROVAL, execution_progressing=False)
        )
        blocking = new_approval_application(
            application_id="app-x",
            decision=self.a_decision(),
            adapter_id=self.adapter.adapter_id,
            provider_profile_id=None,
            observed_state=WAITING_FOR_APPROVAL,
        )
        # A caller asserting progress cannot override a blocking observation.
        health = worker_health_state(applications=[blocking], execution_progressing=True)
        self.assertFalse(health["running"])
        self.assertNotEqual(health["state"], "RUNNING")

    def test_L11_resolved_states_permit_running_again(self):
        for state in (NOT_REQUIRED, PREAUTHORIZED, APPROVED, DENIED):
            application = new_approval_application(
                application_id=f"app-{state.lower()}",
                decision=self.a_decision(),
                adapter_id=self.adapter.adapter_id,
                provider_profile_id=None,
                observed_state=state,
            )
            health = worker_health_state(
                applications=[application], execution_progressing=True
            )
            self.assertEqual(health["state"], "RUNNING", state)

    def test_L11_unknown_state_reports_reconciliation_not_waiting(self):
        application = new_approval_application(
            application_id="app-unknown-health",
            decision=self.a_decision(),
            adapter_id=self.adapter.adapter_id,
            provider_profile_id=None,
            observed_state=UNKNOWN_RECONCILIATION_REQUIRED,
        )
        health = worker_health_state(
            applications=[application], execution_progressing=False
        )
        self.assertEqual(health["state"], UNKNOWN_RECONCILIATION_REQUIRED)
        self.assertFalse(health["running"])

    # -- L-12 ------------------------------------------------------------

    def test_L12_replayed_observation_after_restart_produces_no_duplicate_operation(self):
        import tempfile

        from mlgo_cao_v2.approval_broker import ApprovalBroker, ApprovalStore

        with tempfile.TemporaryDirectory() as tmp:
            store = ApprovalStore(
                tmp, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
            )
            broker = ApprovalBroker(store, **fx.delegated_broker_args())
            intent = fx.an_intent(approval_request_id="req-l12")
            store.open_request(intent)
            decision = broker.evaluate(
                intent,
                decision_id="dec-l12",
                owned_scope_digest=fx.OWNED_SCOPE_DIGEST,
                current_pre_state_digest=fx.PRE_STATE_DIGEST,
            )
            observation = self.adapter.apply_one_shot(
                decision=decision,
                capability_state=self.capability(CAP_ONE_SHOT_APPROVAL),
                evidence=fx.evidence("fixture.permission.granted"),
            )
            store.record_application(
                new_approval_application(
                    application_id="app-l12",
                    decision=decision,
                    adapter_id=self.adapter.adapter_id,
                    provider_profile_id=self.adapter.provider_profile_id,
                    observed_state=observation["observed_state"],
                )
            )

            # Restart: a fresh store re-observing the same provider evidence.
            reopened = ApprovalStore(
                tmp, project_id=fx.PROJECTS[0], security_domain_id=fx.DOMAINS[0]
            )
            replay = reopened.record_application(
                new_approval_application(
                    application_id="app-l12-replay",
                    decision=reopened.load_decision("dec-l12"),
                    adapter_id=self.adapter.adapter_id,
                    provider_profile_id=self.adapter.provider_profile_id,
                    observed_state=APPROVED,
                )
            )
            self.assertTrue(replay["duplicate"])
            self.assertFalse(replay["applied"])
            self.assertEqual(len(reopened.list_applications()), 1)


if __name__ == "__main__":
    unittest.main()
