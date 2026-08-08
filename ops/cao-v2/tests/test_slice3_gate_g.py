"""Gate G - generic budgets, UsageRecord v2 and protected capacity.

The reservation tests are adversarial by construction: the concurrency case
spawns real OS processes that contend for a single remaining unit through real
file locks, rather than simulating a race in one interpreter.  If evaluation
and reservation were not one critical section, more than one process would win.

No provider, model or network is contacted, and no tenant-specific policy is
used anywhere: protected capacity is exercised through the same generic scope
and reserve machinery that any tenant would use.
"""

from __future__ import annotations

import multiprocessing as mp
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.budgets import (
    BudgetStore,
    make_budget_policy,
    make_limit,
    strictest,
)
from mlgo_cao_v2.common import ContractError, PolicyError
from mlgo_cao_v2.usage import (
    UNAVAILABLE,
    assert_no_fabricated_universal_metric,
    native_total,
    new_usage_record_v2,
    normalized_currency_estimate,
    unavailable_metric,
    usage_metric,
)

from slice3_fixtures import (
    RUN_ID,
    Slice3Run,
    calls,
    layered_policy,
    protected_capacity_policy,
    scopes_for,
    single_unit_policy,
)

LIB = Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2"


def _race_worker(args):
    """Reserve one unit from a shared store; run in a separate OS process."""

    run_v2, index, barrier = args
    store = BudgetStore(run_v2, run_id=RUN_ID)
    policy = single_unit_policy()
    barrier.wait()  # maximise contention on the lock
    outcome = store.evaluate_and_reserve(
        command_id=f"cmd-race-{index}", policy=policy,
        scopes=scopes_for(), requests=calls(1), actor_role="builder",
    )
    return {
        "index": index,
        "reserved": bool(outcome["reserved"]),
        "action": outcome["decision"]["action"],
    }


class Slice3GateGTests(unittest.TestCase):

    # -- G-01 ------------------------------------------------------------
    def test_G01_concurrent_commands_racing_one_remaining_unit_yield_one_reservation(self):
        """Real processes, real locks, one remaining unit, exactly one winner."""

        workers = 8
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            ctx = mp.get_context("fork")
            with ctx.Manager() as manager:
                barrier = manager.Barrier(workers)
                payload = [(str(run.run_v2), i, barrier) for i in range(workers)]
                with ctx.Pool(workers) as pool:
                    results = pool.map(_race_worker, payload)

            winners = [r for r in results if r["reserved"]]
            losers = [r for r in results if not r["reserved"]]
            self.assertEqual(len(winners), 1, f"more than one racer reserved the last unit: {results}")
            self.assertEqual(len(losers), workers - 1)

            # Every loser got the configured action, not a silent failure.
            for loser in losers:
                self.assertEqual(loser["action"], "prohibit")

            # Durable evidence agrees: exactly one consuming reservation exists.
            store = BudgetStore(run.run_v2, run_id=RUN_ID)
            consuming = [r for r in store.list_reservations() if r["status"] in {"ACTIVE", "HELD"}]
            self.assertEqual(len(consuming), 1)

    # -- G-02 ------------------------------------------------------------
    def test_G02_crash_after_reserve_then_confirmed_not_sent_releases_exactly_once(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy()

            outcome = run.budgets.evaluate_and_reserve(
                command_id="cmd-g02", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )
            self.assertTrue(outcome["reserved"])

            # Crash: a brand-new process picks the run back up.
            restarted = Slice3Run(td)
            self.assertEqual(restarted.budgets.load_reservation("cmd-g02")["status"], "ACTIVE")
            self.assertEqual(
                restarted.budgets.usage_report(policy)["limits"][0]["consumed"], 1.0
            )

            released = restarted.budgets.release("cmd-g02", certainty="NOT_SENT_CONFIRMED")
            self.assertFalse(released["duplicate"])
            self.assertEqual(released["status"], "RELEASED")
            self.assertEqual(restarted.budgets.usage_report(policy)["limits"][0]["consumed"], 0.0)

            # Releasing again must not credit the capacity a second time.
            again = restarted.budgets.release("cmd-g02", certainty="NOT_SENT_CONFIRMED")
            self.assertTrue(again["duplicate"])
            self.assertEqual(restarted.budgets.usage_report(policy)["limits"][0]["consumed"], 0.0)
            self.assertEqual(
                [h["status"] for h in again["history"]].count("RELEASED"), 1
            )

    # -- G-03 ------------------------------------------------------------
    def test_G03_crash_after_possible_send_holds_the_reservation_until_reconciliation(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy()
            run.budgets.evaluate_and_reserve(
                command_id="cmd-g03", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )

            restarted = Slice3Run(td)
            # The request may have reached the provider, so it may not be released.
            for certainty in ("UNKNOWN_AFTER_SUBMIT", "RECONCILIATION_REQUIRED", "ACCEPTED"):
                with self.assertRaises(PolicyError):
                    restarted.budgets.release("cmd-g03", certainty=certainty)

            held = restarted.budgets.hold("cmd-g03", reason="UNKNOWN_AFTER_SUBMIT; awaiting reconciliation")
            self.assertEqual(held["status"], "HELD")
            self.assertTrue(held["requires_reconciliation"])

            # A held reservation still consumes budget, so the capacity cannot
            # be spent twice while the outcome is unknown.
            self.assertEqual(restarted.budgets.usage_report(policy)["limits"][0]["consumed"], 1.0)
            blocked = restarted.budgets.evaluate_and_reserve(
                command_id="cmd-g03b", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )
            self.assertFalse(blocked["reserved"])
            self.assertEqual(blocked["decision"]["action"], "prohibit")

            # Reconciliation to a confirmed completion settles it.
            settled = restarted.budgets.settle(
                "cmd-g03", settled=[{"metric": "provider_calls", "native_unit": "calls", "amount": 1}]
            )
            self.assertEqual(settled["status"], "SETTLED")
            self.assertEqual(restarted.budgets.usage_report(policy)["limits"][0]["consumed"], 1.0)

    # -- G-04 ------------------------------------------------------------
    def test_G04_duplicate_reservation_for_one_command_is_idempotent(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy(limit_value=5)

            first = run.budgets.evaluate_and_reserve(
                command_id="cmd-g04", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )
            self.assertFalse(first["duplicate"])

            for _ in range(5):
                repeat = run.budgets.evaluate_and_reserve(
                    command_id="cmd-g04", policy=policy, scopes=scopes_for(),
                    requests=calls(1), actor_role="builder",
                )
                self.assertTrue(repeat["duplicate"])

            # Six calls, one unit consumed.
            self.assertEqual(run.budgets.usage_report(policy)["limits"][0]["consumed"], 1.0)
            self.assertEqual(len(run.budgets.list_reservations()), 1)

            # Re-using a command ID for a *different* request is refused rather
            # than silently returning the old reservation.
            with self.assertRaises(PolicyError):
                run.budgets.evaluate_and_reserve(
                    command_id="cmd-g04", policy=policy, scopes=scopes_for(),
                    requests=calls(3), actor_role="builder",
                )

    # -- G-05 ------------------------------------------------------------
    def test_G05_strictest_applicable_action_wins_across_overlapping_scopes(self):
        self.assertEqual(strictest(["allow", "warn", "pause"]), "pause")
        self.assertEqual(strictest(["prohibit", "warn"]), "prohibit")
        self.assertEqual(strictest(["require_approval", "pause"]), "require_approval")
        self.assertEqual(strictest([]), "allow")

        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = layered_policy()

            # Consume two units so the role/account/project limits are all met.
            run.budgets.evaluate_and_reserve(
                command_id="cmd-g05a", policy=policy, scopes=scopes_for(),
                requests=calls(2), actor_role="builder",
            )
            run.budgets.settle(
                "cmd-g05a", settled=[{"metric": "provider_calls", "native_unit": "calls", "amount": 2}]
            )

            decision = run.budgets.evaluate(
                policy=policy, scopes=scopes_for(), requests=calls(1),
                actor_role="builder", command_id="cmd-g05b",
            )
            # role=pause, account=require_approval, project=prohibit all breach;
            # run=warn does not.  The strictest of the breached actions wins.
            self.assertEqual(decision["action"], "prohibit")
            self.assertFalse(decision["allowed"])
            self.assertEqual(
                sorted(decision["breached_limits"]),
                ["account-calls", "project-calls", "role-calls"],
            )
            self.assertNotIn("run-calls", decision["breached_limits"])
            for evaluation in decision["evaluations"]:
                self.assertTrue(evaluation["reason"])

            # A permissive scope can never soften a stricter one: dropping the
            # prohibit limit yields require_approval, not allow.
            softer = make_budget_policy(
                policy_id="budget-softer", enforcement_mode="warning_only",
                limits=[l for l in policy["limits"] if l["limit_id"] != "project-calls"],
            )
            self.assertEqual(
                run.budgets.evaluate(policy=softer, scopes=scopes_for(), requests=calls(1),
                                     actor_role="builder")["action"],
                "require_approval",
            )

    # -- G-06 ------------------------------------------------------------
    def test_G06_protected_capacity_blocks_a_worker_but_stays_available_to_authority(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = protected_capacity_policy()
            scopes = scopes_for(account="acct-protected")

            # Consume everything outside the protected reserve.
            run.budgets.evaluate_and_reserve(
                command_id="cmd-g06-warm", policy=policy, scopes=scopes,
                requests=calls(6), actor_role="builder",
            )
            run.budgets.settle(
                "cmd-g06-warm",
                settled=[{"metric": "provider_calls", "native_unit": "calls", "amount": 6}],
            )

            worker = run.budgets.evaluate_and_reserve(
                command_id="cmd-g06-worker", policy=policy, scopes=scopes,
                requests=calls(1), actor_role="builder",
            )
            self.assertFalse(worker["reserved"], "worker consumed protected authority capacity")
            self.assertEqual(worker["decision"]["action"], "prohibit")
            reserve_note = worker["decision"]["protected_reserves"][0]
            self.assertFalse(reserve_note["actor_has_access"])
            self.assertEqual(reserve_note["scope_kind"], "protected_reserve")

            # The protected capacity remains genuinely available to the roles it
            # is reserved for.
            supervisor = run.budgets.evaluate_and_reserve(
                command_id="cmd-g06-supervisor", policy=policy, scopes=scopes,
                requests=calls(1), actor_role="supervisor",
            )
            self.assertTrue(supervisor["reserved"])
            self.assertTrue(supervisor["decision"]["protected_reserves"][0]["actor_has_access"])

            # Even a privileged role cannot exceed the real limit.
            over = run.budgets.evaluate(
                policy=policy, scopes=scopes, requests=calls(10), actor_role="supervisor",
            )
            self.assertEqual(over["action"], "prohibit")

    # -- G-07 ------------------------------------------------------------
    def test_G07_provider_without_token_telemetry_still_enforces_native_limits(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy(limit_value=2)

            record = new_usage_record_v2(
                usage_record_id="usage-g07", run_id=RUN_ID, command_id="cmd-g07",
                provider_id="telemetry-free-provider", role="builder",
                metrics=[
                    usage_metric(metric="provider_calls", native_unit="calls", value=1,
                                 source="host_transport_counter", availability="MEASURED",
                                 confidence="exact"),
                    usage_metric(metric="wall_time", native_unit="seconds", value=12.5,
                                 source="host_clock", availability="MEASURED", confidence="high"),
                    unavailable_metric(metric="input_tokens", native_unit="tokens",
                                       source="provider exposes no token counters"),
                    unavailable_metric(metric="output_tokens", native_unit="tokens",
                                       source="provider exposes no token counters"),
                    unavailable_metric(metric="cost", native_unit="AUD",
                                       source="provider exposes no cost telemetry"),
                ],
                correlation={"exact": True, "command_id": "cmd-g07"},
            )

            for name in ("input_tokens", "output_tokens", "cost"):
                metric = next(m for m in record["metrics"] if m["metric"] == name)
                self.assertEqual(metric["availability"], UNAVAILABLE)
                self.assertIsNone(metric["value"])
                self.assertEqual(metric["confidence"], "unavailable")

            # Missing telemetry is never invented.
            with self.assertRaises(PolicyError):
                usage_metric(metric="input_tokens", native_unit="tokens", value=1234,
                             source="estimate", availability=UNAVAILABLE)

            # Enforceable native limits still operate on what *is* measurable.
            run.budgets.evaluate_and_reserve(
                command_id="cmd-g07", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )
            run.budgets.settle(
                "cmd-g07",
                settled=[{"metric": "provider_calls", "native_unit": "calls", "amount": 1}],
                usage_record=record,
            )
            second = run.budgets.evaluate_and_reserve(
                command_id="cmd-g07b", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )
            self.assertTrue(second["reserved"])
            third = run.budgets.evaluate_and_reserve(
                command_id="cmd-g07c", policy=policy, scopes=scopes_for(),
                requests=calls(1), actor_role="builder",
            )
            self.assertFalse(third["reserved"])

    # -- G-08 ------------------------------------------------------------
    def test_G08_native_cost_and_currency_are_preserved_exactly(self):
        estimate = normalized_currency_estimate(
            currency="usd", amount=0.81, source="static_fx_table",
            confidence="low", basis="1 AUD = 0.66 USD on 2026-08-08",
        )
        record = new_usage_record_v2(
            usage_record_id="usage-g08", run_id=RUN_ID, command_id="cmd-g08",
            provider_id="billing-provider",
            metrics=[
                usage_metric(metric="cost", native_unit="AUD", value=1.23,
                             source="provider_invoice_line", availability="PROVIDER_REPORTED",
                             confidence="exact"),
                usage_metric(metric="provider_calls", native_unit="calls", value=1,
                             source="host_transport_counter", availability="MEASURED",
                             confidence="exact"),
            ],
            normalized_estimate=estimate,
            correlation={"exact": True},
        )

        native = next(m for m in record["metrics"] if m["metric"] == "cost")
        self.assertEqual(native["native_unit"], "AUD")
        self.assertEqual(native["value"], 1.23)
        self.assertEqual(native["source"], "provider_invoice_line")
        self.assertEqual(native["confidence"], "exact")
        self.assertFalse(native["estimated"])

        # The conversion is clearly secondary and never displaces the native value.
        self.assertTrue(record["normalized_estimate"]["is_estimate"])
        self.assertTrue(record["normalized_estimate"]["secondary"])
        self.assertFalse(record["normalized_estimate"]["replaces_native_values"])
        self.assertEqual(record["normalized_estimate"]["currency"], "USD")

        with self.assertRaises(PolicyError):
            assert_no_fabricated_universal_metric({
                "metrics": [], "normalized_estimate": {**estimate, "replaces_native_values": True},
            })

        # Fabricated cross-provider units are refused outright.
        for name in ("universal_tokens", "token_equivalent", "normalized_cost_units"):
            with self.assertRaises(PolicyError):
                usage_metric(metric=name, native_unit="tokens", value=10,
                             source="derived", availability="MEASURED")

        # Totals are unit-scoped: incompatible units are reported, never added.
        other = new_usage_record_v2(
            usage_record_id="usage-g08b", run_id=RUN_ID,
            metrics=[usage_metric(metric="cost", native_unit="USD", value=5.0,
                                  source="provider_invoice_line",
                                  availability="PROVIDER_REPORTED", confidence="exact")],
        )
        total = native_total([record, other], metric="cost", native_unit="AUD")
        self.assertEqual(total["total"], 1.23)
        self.assertEqual(total["excluded_other_units"], ["USD"])
        self.assertFalse(total["complete"])

    # -- G-09 ------------------------------------------------------------
    def test_G09_replay_reconstructs_reservations_and_finds_leaks(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy(limit_value=100)

            for command_id, amount in (("cmd-live", 1), ("cmd-notsent", 1),
                                       ("cmd-done", 1), ("cmd-ambiguous", 1)):
                run.budgets.evaluate_and_reserve(
                    command_id=command_id, policy=policy, scopes=scopes_for(),
                    requests=calls(amount), actor_role="builder",
                )
            run.budgets.hold("cmd-ambiguous", reason="UNKNOWN_AFTER_SUBMIT")

            # Crash here: nothing was settled or released for the terminal ones.
            restarted = Slice3Run(td)
            report = restarted.budgets.replay(command_states={
                "cmd-live": "ACCEPTED",
                "cmd-notsent": "NOT_SENT_CONFIRMED",
                "cmd-done": "COMPLETED",
                "cmd-ambiguous": "UNKNOWN_AFTER_SUBMIT",
            })

            # Every reservation is reconstructed; none vanished.
            self.assertEqual(
                sorted(report["consuming"]),
                ["cmd-ambiguous", "cmd-done", "cmd-live", "cmd-notsent"],
            )
            self.assertEqual(report["held"], ["cmd-ambiguous"])

            leaks = {item["command_id"]: item for item in report["leaked"]}
            self.assertEqual(sorted(leaks), ["cmd-done", "cmd-notsent"])
            self.assertEqual(leaks["cmd-notsent"]["resolution"], "release")
            self.assertEqual(leaks["cmd-done"]["resolution"], "settle")

            # The ambiguous call is neither leaked-as-releasable nor forgotten.
            self.assertNotIn("cmd-ambiguous", leaks)
            self.assertIn("cmd-ambiguous", report["consuming"])

            # An in-flight ACTIVE command with an ambiguous outcome is flagged
            # for a hold rather than silently released.
            second = restarted.budgets.replay(command_states={"cmd-live": "UNKNOWN_AFTER_SUBMIT"})
            self.assertEqual(
                [i["resolution"] for i in second["leaked"] if i["command_id"] == "cmd-live"],
                ["hold"],
            )

    # -- G-10 ------------------------------------------------------------
    def test_G10_protection_is_a_generic_policy_instance_not_a_core_special_case(self):
        """The budget kernel must contain no tenant-specific branch."""

        text = (LIB / "budgets.py").read_text(encoding="utf-8").lower()
        for token in ("business 2", "business2", "business-2", "business_2", "biz2"):
            self.assertNotIn(token, text, f"tenant-specific identifier in budget kernel: {token}")

        # The identical machinery protects any scope ID.  Nothing about the
        # behaviour depends on which tenant the ID names.
        outcomes = {}
        for scope_id in ("business-2", "some-other-tenant", "proj-generic"):
            with tempfile.TemporaryDirectory() as td:
                run = Slice3Run(td)
                run.initialize()
                policy = make_budget_policy(
                    policy_id="budget-generic", enforcement_mode="warning_only",
                    limits=[make_limit(
                        limit_id="protected", scope_kind="project", scope_id=scope_id,
                        metric="provider_calls", native_unit="calls",
                        limit_value=5, action="prohibit",
                        protected_reserve_amount=5, protected_reserve_roles=["supervisor"],
                    )],
                )
                scopes = scopes_for(project=scope_id)
                worker = run.budgets.evaluate_and_reserve(
                    command_id="cmd-worker", policy=policy, scopes=scopes,
                    requests=calls(1), actor_role="builder",
                )
                supervisor = run.budgets.evaluate_and_reserve(
                    command_id="cmd-supervisor", policy=policy, scopes=scopes,
                    requests=calls(1), actor_role="supervisor",
                )
                outcomes[scope_id] = (worker["reserved"], supervisor["reserved"])

        self.assertEqual(len(set(outcomes.values())), 1,
                         f"protection behaviour varied by tenant identity: {outcomes}")
        self.assertEqual(outcomes["business-2"], (False, True))

    # -- boundary invariants ---------------------------------------------
    def test_live_budget_enforcement_stays_warning_only_in_fixtures_and_policy(self):
        """Hard semantics are proven without switching live enforcement on."""

        for policy in (single_unit_policy(), layered_policy(), protected_capacity_policy()):
            self.assertEqual(policy["enforcement_mode"], "warning_only")

        shipped = Path(__file__).resolve().parents[1] / "config" / "cao-policy.json"
        text = shipped.read_text(encoding="utf-8")
        self.assertIn('"enforcement_mode": "warning_only"', text)

        # Decisions are still computed with full hard semantics regardless of
        # what the live system would do with them.
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy(limit_value=0)
            decision = run.budgets.evaluate(
                policy=policy, scopes=scopes_for(), requests=calls(1), actor_role="builder",
            )
            self.assertEqual(decision["action"], "prohibit")
            self.assertFalse(decision["allowed"])
            self.assertEqual(decision["enforcement_mode"], "warning_only")

    def test_limits_require_explicit_native_units_and_reject_incoherent_reserves(self):
        with self.assertRaises(ContractError):
            make_limit(limit_id="bad", scope_kind="run", scope_id="r",
                       metric="calls", native_unit="  ", limit_value=1)
        with self.assertRaises(ContractError):
            make_limit(limit_id="bad", scope_kind="nonsense", scope_id="r",
                       metric="calls", native_unit="calls", limit_value=1)
        with self.assertRaises(ContractError):
            make_limit(limit_id="bad", scope_kind="run", scope_id="r",
                       metric="calls", native_unit="calls", limit_value=1,
                       protected_reserve_amount=5, protected_reserve_roles=["supervisor"])
        with self.assertRaises(ContractError):
            make_limit(limit_id="bad", scope_kind="run", scope_id="r",
                       metric="calls", native_unit="calls", limit_value=5,
                       protected_reserve_amount=1)

    def test_a_limit_in_one_native_unit_never_constrains_another_unit(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            policy = single_unit_policy(limit_value=0)
            # A zero-call limit says nothing about bytes.
            decision = run.budgets.evaluate(
                policy=policy, scopes=scopes_for(),
                requests=[{"metric": "provider_calls", "native_unit": "bytes", "amount": 1000}],
                actor_role="builder",
            )
            self.assertEqual(decision["evaluations"], [])
            self.assertEqual(decision["action"], "allow")

    def test_settled_usage_cannot_be_recorded_without_a_native_unit(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.budgets.evaluate_and_reserve(
                command_id="cmd-unit", policy=single_unit_policy(limit_value=5),
                scopes=scopes_for(), requests=calls(1), actor_role="builder",
            )
            with self.assertRaises(ContractError):
                run.budgets.settle("cmd-unit", settled=[{"metric": "provider_calls", "amount": 1}])

    def test_a_released_reservation_can_never_later_settle_usage(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.budgets.evaluate_and_reserve(
                command_id="cmd-rel", policy=single_unit_policy(limit_value=5),
                scopes=scopes_for(), requests=calls(1), actor_role="builder",
            )
            run.budgets.release("cmd-rel", certainty="NOT_SENT_CONFIRMED")
            with self.assertRaises(PolicyError):
                run.budgets.settle(
                    "cmd-rel",
                    settled=[{"metric": "provider_calls", "native_unit": "calls", "amount": 1}],
                )


if __name__ == "__main__":
    unittest.main()
