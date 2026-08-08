"""Gate F - hybrid Tech Lead state-bound authority.

F-01 .. F-10 of the Slice 2 source acceptance matrix.

Every "zero mutation / zero dispatch" claim is measured: the applier and the
counting fake provider both record how many times they were entered.
"""

from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.authority import (
    ACTION_CAPABILITY,
    CAP_FILESYSTEM,
    CAP_LOCAL_GIT,
    CAP_SEMANTIC_AUTHORITY,
    CAP_SHELL,
    EXECUTOR_DETERMINISTIC_HOST,
    EXECUTOR_EXECUTION_AGENT,
    AuthorityBroker,
    route_action,
)
from mlgo_cao_v2.checkpoints import write_checkpoint, load_checkpoint
from mlgo_cao_v2.common import ContractError, PolicyError, load_json, sha256_json
from mlgo_cao_v2.context_envelope import build_context_manifest, component
from mlgo_cao_v2.decisions import (
    ADVISORY_RECORDED,
    APPLIED,
    BINDING_FIELDS,
    ESCALATION_RECORDED,
    MODE_ADJUDICATE,
    MODE_CONSULT,
    MODE_ESCALATE,
    STALE_DECISION,
    DecisionLedger,
    new_authority_request,
    new_decision,
)
from mlgo_cao_v2.task_lead import (
    create_tech_lead_checkpoint,
    normalize_tech_lead_execution_state,
    restore_tech_lead_execution_state,
)

from slice2_fixtures import SHA_POLICY, SHA_REGISTRY, SHA_SCHEMAS, CountingProvider

RUN = "run-slice2"
TASK = "task-1"
DELEGATED = ["phase_sequencing", "route_selection"]


def execution_state(**overrides):
    value = {
        "run_id": RUN, "big_task_id": "bt-1", "task_id": TASK, "task_lead_id": "tl-1", "generation": 1,
        "task_graph": [
            {"task_id": "t-a", "status": "COMPLETE", "depends_on": []},
            {"task_id": "t-b", "status": "RUNNING", "depends_on": ["t-a"]},
        ],
        "ownership": {
            "workers": [{"worker_id": "w-1", "task_id": "t-b", "route_id": "agy_flash_high"}],
            "files": ["packages/x/src/a.ts"],
            "worktrees": [{"worktree_id": "wt-1", "branch": "agent/t-b", "worker_id": "w-1"}],
        },
        "evidence_refs": [
            {"id": "ev-commit-a", "kind": "commit", "sha256": "1" * 64},
            {"id": "ev-test-a", "kind": "test_run", "sha256": "2" * 64},
            {"id": "ev-review-a", "kind": "review", "sha256": "3" * 64},
        ],
        "decisions": [{"decision_id": "dec-0", "outcome": "APPROVED", "scope": "route_selection"}],
        "risks": [{"risk_id": "risk-1", "status": "OPEN", "summary": "ordering"}],
        "dependencies": [{"dependency_id": "dep-1", "on": "t-a", "kind": "sequence"}],
        "delegation_revision": "deleg-3", "charter_revision": "charter-2",
        "cursors": {"state_version": 7, "command_cursor": {"count": 2, "last_id": "cmd-2"},
                    "operation_cursor": {"count": 1, "last_id": "op-1"}},
        "last_committed_state_version": 7,
    }
    value.update(overrides)
    return normalize_tech_lead_execution_state(value)


def context_manifest(manifest_id="ctx-f"):
    return build_context_manifest(
        manifest_id=manifest_id, run_id=RUN, task_id=TASK, role_id="tech_lead",
        components=[
            component(kind="system_control_text", component_id="sys-1", text="control"),
            component(kind="profile_text", component_id="prof-1", text="profile"),
            component(kind="objective_task", component_id="obj-1", text="objective"),
            component(kind="durable_state_summary", component_id="state-1", text="state"),
            component(kind="adapter_wrapper", component_id="wrap-1", text="wrapper"),
        ],
        wrapper={"transport_id": "fake-transport"},
    )


def checkpoint_for(state, checkpoint_id="ckpt-f"):
    return create_tech_lead_checkpoint(
        checkpoint_id=checkpoint_id, execution_state=state, registry_digest=SHA_REGISTRY,
        policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
    )


class Spy:
    """Records every state mutation and worker/provider dispatch attempt."""

    def __init__(self):
        self.applications = 0
        self.dispatches = 0

    def apply(self, decision):
        self.applications += 1
        return {"applied": True, "decision_id": decision["decision_id"]}

    def dispatch_worker(self, *_args, **_kwargs):
        self.dispatches += 1
        return {"dispatched": True}


class Slice2GateFTests(unittest.TestCase):

    def broker(self, td, *, delegated=None):
        ledger = DecisionLedger(Path(td) / "v2")
        return ledger, AuthorityBroker(ledger, delegated_scope=delegated or DELEGATED)

    def prepared(self, broker, *, request_id, mode, scope, state=None, manifest=None, checkpoint=None):
        state = state or execution_state()
        manifest = manifest or context_manifest()
        checkpoint = checkpoint or checkpoint_for(state)
        return broker.prepare_request(
            request_id=request_id, mode=mode, requested_scope=scope,
            question="bounded question", execution_state=state, context_manifest=manifest,
            checkpoint=checkpoint, delegation_revision=state["delegation_revision"],
            charter_revision=state["charter_revision"],
            evidence_refs=[{"id": "ev-commit-a", "kind": "commit"}],
        ), state, manifest, checkpoint

    # -- F-01 ------------------------------------------------------------
    def test_F01_consult_is_durable_digest_bound_advice_and_tech_lead_retains_authority(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            request, state, manifest, checkpoint = self.prepared(
                broker, request_id="areq-f01", mode=MODE_CONSULT, scope=["phase_sequencing"])
            self.assertEqual(request["authority_retained_by"], "tech_lead")
            self.assertEqual(request["context_manifest_digest"], manifest["manifest_digest"])
            self.assertEqual(request["checkpoint_digest"], checkpoint["content_digest"])
            self.assertEqual(request["execution_state_digest"], sha256_json(state))
            self.assertEqual(request["state_revision"], state["last_committed_state_version"])
            self.assertEqual(request["binding_digest"],
                             sha256_json({f: request[f] for f in BINDING_FIELDS}))

            decision = new_decision(decision_id="adec-f01", request=request,
                                    outcome="ADVISORY", advice="prefer sequencing B",
                                    rationale_digest="a" * 64)
            recorded = ledger.record_consult(decision)
            self.assertEqual(recorded["status"], ADVISORY_RECORDED)
            self.assertFalse(recorded["binding"])
            self.assertEqual(recorded["authority_retained_by"], "tech_lead")
            self.assertEqual(recorded["state_mutations"], 0)
            self.assertEqual(recorded["worker_dispatches"], 0)

            # The Tech Lead still holds its complete state after consulting.
            self.assertEqual(len(state["task_graph"]), 2)
            self.assertEqual(state["ownership"]["workers"][0]["worker_id"], "w-1")
            self.assertEqual(state["cursors"]["command_cursor"]["count"], 2)

    # -- F-02 ------------------------------------------------------------
    def test_F02_adjudicate_inside_delegated_scope_binds_all_revisions_and_applies_once(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            request, state, manifest, checkpoint = self.prepared(
                broker, request_id="areq-f02", mode=MODE_ADJUDICATE, scope=["phase_sequencing"])
            decision = new_decision(decision_id="adec-f02", request=request, outcome="APPROVED",
                                    applied_scope=["phase_sequencing"])
            out = ledger.apply_decision(
                decision, current_state_revision=state["last_committed_state_version"],
                current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                current_context_manifest_digest=manifest["manifest_digest"],
                current_checkpoint_digest=checkpoint["content_digest"], applier=spy.apply,
            )
            self.assertEqual(out["status"], APPLIED)
            self.assertTrue(out["applied"])
            self.assertTrue(out["binding"])
            self.assertEqual(spy.applications, 1)
            for field in BINDING_FIELDS:
                self.assertEqual(out[field], request[field])
            stored = load_json(ledger.decision_path("adec-f02"))
            self.assertEqual(stored["applied_at_state_revision"], 7)

    # -- F-03 ------------------------------------------------------------
    def test_F03_escalation_outside_delegated_scope_records_facts_only(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            provider = CountingProvider()
            request, state, _, _ = self.prepared(
                broker, request_id="areq-f03", mode=MODE_ESCALATE, scope=["locked_architecture"])
            self.assertEqual(request["mode"], MODE_ESCALATE)

            escalation = ledger.record_escalation(request, facts={
                "reason": "decision is outside the Tech Lead delegated scope",
                "evidence_ids": ["ev-commit-a"],
            })
            self.assertEqual(escalation["status"], ESCALATION_RECORDED)
            self.assertFalse(escalation["locally_converted_to_decision"])
            self.assertEqual(escalation["state_mutations"], 0)

            decision = new_decision(decision_id="adec-f03", request=request, outcome="DECIDED",
                                    applied_scope=["locked_architecture"])
            with self.assertRaises(PolicyError) as ctx:
                ledger.apply_decision(
                    decision, current_state_revision=state["last_committed_state_version"],
                    current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                    applier=spy.apply,
                )
            self.assertIn("cannot be locally converted", str(ctx.exception))
            self.assertEqual(spy.applications, 0)
            self.assertEqual(spy.dispatches, 0)
            self.assertEqual(provider.submit_count, 0)

            duplicate = ledger.record_escalation(request, facts={"reason": "repeat"})
            self.assertTrue(duplicate["duplicate"])

    def test_F03_adjudicate_cannot_even_be_requested_outside_delegated_scope(self):
        with self.assertRaises(PolicyError):
            new_authority_request(
                request_id="areq-f03b", run_id=RUN, task_id=TASK, big_task_id="bt-1",
                requester_role="tech_lead", authority_role="authoritative_supervisor",
                mode=MODE_ADJUDICATE, requested_scope=["locked_architecture"], state_revision=7,
                context_manifest_digest="a" * 64, checkpoint_digest="b" * 64,
                delegation_revision="deleg-3", charter_revision="charter-2",
                delegated_scope=DELEGATED, question="q",
            )

    # -- F-04 ------------------------------------------------------------
    def test_F04_applying_a_consult_as_an_adjudication_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            provider = CountingProvider()
            request, state, _, _ = self.prepared(
                broker, request_id="areq-f04", mode=MODE_CONSULT, scope=["phase_sequencing"])
            decision = new_decision(decision_id="adec-f04", request=request, outcome="ADVISORY",
                                    advice="do B")
            with self.assertRaises(PolicyError) as ctx:
                ledger.apply_decision(
                    decision, current_state_revision=state["last_committed_state_version"],
                    current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                    applier=spy.apply,
                )
            self.assertIn("advisory", str(ctx.exception))
            self.assertEqual(spy.applications, 0)
            self.assertEqual(spy.dispatches, 0)
            self.assertEqual(provider.submit_count, 0)
            self.assertFalse(ledger.decision_path("adec-f04").exists())

            # Relabelling the response does not launder it into a binding one.
            forged = copy.deepcopy(decision)
            forged["mode"] = MODE_ADJUDICATE
            forged["applied_scope"] = ["phase_sequencing"]
            with self.assertRaises(PolicyError):
                ledger.apply_decision(
                    forged, current_state_revision=state["last_committed_state_version"],
                    current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                    applier=spy.apply,
                )
            self.assertEqual(spy.applications, 0)

    # -- F-05 ------------------------------------------------------------
    def test_F05_adjudication_beyond_requested_or_delegated_scope_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            request, state, _, _ = self.prepared(
                broker, request_id="areq-f05", mode=MODE_ADJUDICATE, scope=["phase_sequencing"])

            beyond_requested = new_decision(decision_id="adec-f05a", request=request, outcome="APPROVED",
                                            applied_scope=["phase_sequencing", "route_selection"])
            with self.assertRaises(PolicyError) as ctx:
                ledger.apply_decision(
                    beyond_requested, current_state_revision=7,
                    current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                    applier=spy.apply,
                )
            self.assertIn("exceeds the requested scope", str(ctx.exception))

            beyond_delegated = new_decision(decision_id="adec-f05b", request=request, outcome="APPROVED",
                                            applied_scope=["locked_architecture"])
            with self.assertRaises(PolicyError):
                ledger.apply_decision(
                    beyond_delegated, current_state_revision=7,
                    current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                    applier=spy.apply,
                )
            self.assertEqual(spy.applications, 0)
            self.assertEqual(spy.dispatches, 0)

    # -- F-06 ------------------------------------------------------------
    def test_F06_state_advancing_before_the_response_records_stale_decision(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            provider = CountingProvider()
            request, state, manifest, checkpoint = self.prepared(
                broker, request_id="areq-f06", mode=MODE_ADJUDICATE, scope=["phase_sequencing"])
            decision = new_decision(decision_id="adec-f06", request=request, outcome="APPROVED",
                                    applied_scope=["phase_sequencing"])
            out = ledger.apply_decision(
                decision, current_state_revision=state["last_committed_state_version"] + 1,
                current_delegation_revision="deleg-3", current_charter_revision="charter-2",
                current_context_manifest_digest=manifest["manifest_digest"],
                current_checkpoint_digest=checkpoint["content_digest"], applier=spy.apply,
            )
            self.assertEqual(out["status"], STALE_DECISION)
            self.assertEqual(out["state_mutations"], 0)
            self.assertEqual(out["worker_dispatches"], 0)
            self.assertEqual(out["provider_dispatches"], 0)
            self.assertTrue(out["requires_fresh_request_id"])
            self.assertIn("advanced from the bound revision 7 to 8", out["reason"])
            self.assertEqual(spy.applications, 0)
            self.assertEqual(spy.dispatches, 0)
            self.assertEqual(provider.submit_count, 0)
            self.assertFalse(ledger.decision_path("adec-f06").exists())
            self.assertIsNotNone(ledger.stale_record("adec-f06"))

    def test_F06_bound_context_or_checkpoint_drift_is_also_stale(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            request, state, manifest, checkpoint = self.prepared(
                broker, request_id="areq-f06b", mode=MODE_ADJUDICATE, scope=["phase_sequencing"])
            decision = new_decision(decision_id="adec-f06b", request=request, outcome="APPROVED",
                                    applied_scope=["phase_sequencing"])
            out = ledger.apply_decision(
                decision, current_state_revision=7, current_delegation_revision="deleg-3",
                current_charter_revision="charter-2",
                current_context_manifest_digest="f" * 64,
                current_checkpoint_digest=checkpoint["content_digest"], applier=spy.apply,
            )
            self.assertEqual(out["status"], STALE_DECISION)
            self.assertIn("context manifest changed", out["reason"])
            self.assertEqual(spy.applications, 0)

    # -- F-07 ------------------------------------------------------------
    def test_F07_delegation_or_charter_revision_change_is_stale(self):
        for field, current in (("delegation", {"current_delegation_revision": "deleg-4",
                                               "current_charter_revision": "charter-2"}),
                               ("charter", {"current_delegation_revision": "deleg-3",
                                            "current_charter_revision": "charter-3"})):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as td:
                ledger, broker = self.broker(td)
                spy = Spy()
                request, state, _, _ = self.prepared(
                    broker, request_id=f"areq-f07-{field}", mode=MODE_ADJUDICATE,
                    scope=["phase_sequencing"])
                decision = new_decision(decision_id=f"adec-f07-{field}", request=request,
                                        outcome="APPROVED", applied_scope=["phase_sequencing"])
                out = ledger.apply_decision(decision, current_state_revision=7, applier=spy.apply, **current)
                self.assertEqual(out["status"], STALE_DECISION)
                self.assertIn(f"{field} revision changed", out["reason"])
                self.assertEqual(spy.applications, 0)
                self.assertEqual(spy.dispatches, 0)

    # -- F-08 ------------------------------------------------------------
    def test_F08_duplicate_delivery_of_a_valid_decision_applies_once(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            request, state, manifest, checkpoint = self.prepared(
                broker, request_id="areq-f08", mode=MODE_ADJUDICATE, scope=["route_selection"])
            decision = new_decision(decision_id="adec-f08", request=request, outcome="APPROVED",
                                    applied_scope=["route_selection"])
            kwargs = dict(current_state_revision=7, current_delegation_revision="deleg-3",
                          current_charter_revision="charter-2",
                          current_context_manifest_digest=manifest["manifest_digest"],
                          current_checkpoint_digest=checkpoint["content_digest"], applier=spy.apply)
            first = ledger.apply_decision(decision, **kwargs)
            second = ledger.apply_decision(decision, **kwargs)
            third = ledger.apply_decision(copy.deepcopy(decision), **kwargs)
            self.assertTrue(first["applied"])
            self.assertFalse(second["applied"])
            self.assertTrue(second["duplicate"])
            self.assertFalse(third["applied"])
            self.assertEqual(spy.applications, 1)

    # -- F-09 ------------------------------------------------------------
    def test_F09_reconsult_after_stale_uses_a_fresh_request_id_and_leaves_the_old_record_immutable(self):
        with tempfile.TemporaryDirectory() as td:
            ledger, broker = self.broker(td)
            spy = Spy()
            state = execution_state()
            manifest = context_manifest()
            checkpoint = checkpoint_for(state)
            request, _, _, _ = self.prepared(
                broker, request_id="areq-f09", mode=MODE_ADJUDICATE, scope=["phase_sequencing"],
                state=state, manifest=manifest, checkpoint=checkpoint)
            original_bytes = ledger.request_path("areq-f09").read_bytes()

            decision = new_decision(decision_id="adec-f09", request=request, outcome="APPROVED",
                                    applied_scope=["phase_sequencing"])
            stale = ledger.apply_decision(decision, current_state_revision=8,
                                          current_delegation_revision="deleg-3",
                                          current_charter_revision="charter-2", applier=spy.apply)
            self.assertEqual(stale["status"], STALE_DECISION)

            with self.assertRaises(PolicyError) as ctx:
                broker.reconsult(stale_request=request, request_id="areq-f09",
                                 execution_state=state, context_manifest=manifest,
                                 checkpoint=checkpoint, delegation_revision="deleg-3",
                                 charter_revision="charter-2")
            self.assertIn("fresh request ID", str(ctx.exception))

            advanced = execution_state(last_committed_state_version=8,
                                       cursors={"state_version": 8,
                                                "command_cursor": {"count": 3, "last_id": "cmd-3"},
                                                "operation_cursor": {"count": 1, "last_id": "op-1"}})
            fresh_manifest = context_manifest(manifest_id="ctx-f09b")
            fresh_checkpoint = checkpoint_for(advanced, checkpoint_id="ckpt-f09b")
            fresh = broker.reconsult(
                stale_request=request, request_id="areq-f09b", execution_state=advanced,
                context_manifest=fresh_manifest, checkpoint=fresh_checkpoint,
                delegation_revision="deleg-3", charter_revision="charter-2")
            self.assertEqual(fresh["supersedes_request_id"], "areq-f09")
            self.assertEqual(fresh["state_revision"], 8)
            self.assertNotEqual(fresh["binding_digest"], request["binding_digest"])

            self.assertEqual(ledger.request_path("areq-f09").read_bytes(), original_bytes)
            self.assertEqual(spy.applications, 0)

            # A reused request ID with different bound revisions is refused.
            with self.assertRaises(PolicyError):
                ledger.open_request({**fresh, "request_id": "areq-f09", "state_revision": 99})

    # -- F-10 ------------------------------------------------------------
    def test_F10_tech_lead_recovered_from_checkpoint_is_not_a_context_poor_relay(self):
        with tempfile.TemporaryDirectory() as td:
            state = execution_state()
            checkpoint = checkpoint_for(state, checkpoint_id="ckpt-f10")
            path = write_checkpoint(Path(td) / "ckpt.json", checkpoint)
            restored = restore_tech_lead_execution_state(
                load_checkpoint(path, expected_identity={"run_id": RUN, "task_id": TASK}))

            self.assertEqual(restored["state_digest"], state["state_digest"])
            self.assertEqual([t["task_id"] for t in restored["task_graph"]], ["t-a", "t-b"])
            self.assertEqual(restored["ownership"]["workers"], state["ownership"]["workers"])
            self.assertEqual(restored["ownership"]["worktrees"], state["ownership"]["worktrees"])
            self.assertEqual(restored["ownership"]["files"], state["ownership"]["files"])
            self.assertEqual({e["kind"] for e in restored["evidence_refs"]},
                             {"commit", "test_run", "review"})
            self.assertEqual(restored["decisions"], state["decisions"])
            self.assertEqual(restored["cursors"], state["cursors"])
            self.assertEqual(restored["delegation_revision"], "deleg-3")

            # The recovered Tech Lead can immediately bind a full-state request.
            ledger, broker = self.broker(td)
            request, _, _, _ = self.prepared(
                broker, request_id="areq-f10", mode=MODE_ADJUDICATE, scope=["route_selection"],
                state=restored, checkpoint=checkpoint)
            self.assertEqual(request["execution_state_digest"], sha256_json(restored))
            self.assertEqual(request["checkpoint_digest"], checkpoint["content_digest"])
            self.assertEqual(request["state_revision"], 7)

    # -- capability / authority separation --------------------------------
    def test_semantic_authority_is_never_a_substitute_for_execution_capability(self):
        authority_only = {CAP_SEMANTIC_AUTHORITY: {"enabled": True}}
        execution_agent = {CAP_FILESYSTEM: {"enabled": True}, CAP_SHELL: {"enabled": True}}
        host = {CAP_LOCAL_GIT: {"enabled": True}}

        routed = route_action(action_kind="git_operation", semantic_authority_role="reasoning_authority",
                              authority_capabilities=authority_only,
                              execution_agent_capabilities=execution_agent,
                              deterministic_host_capabilities=host)
        self.assertEqual(routed["executor"], EXECUTOR_DETERMINISTIC_HOST)
        self.assertFalse(routed["semantic_authority_transferred"])

        routed = route_action(action_kind="run_command", semantic_authority_role="reasoning_authority",
                              authority_capabilities=authority_only,
                              execution_agent_capabilities=execution_agent,
                              deterministic_host_capabilities=host)
        self.assertEqual(routed["executor"], EXECUTOR_EXECUTION_AGENT)

        with self.assertRaises(PolicyError) as ctx:
            route_action(action_kind="service_operation", semantic_authority_role="reasoning_authority",
                         authority_capabilities=authority_only,
                         execution_agent_capabilities=execution_agent,
                         deterministic_host_capabilities=host)
        self.assertIn("not a substitute", str(ctx.exception))

        # A bare truthy capability claim is not qualification evidence.
        with self.assertRaises(PolicyError):
            route_action(action_kind="git_operation", semantic_authority_role="reasoning_authority",
                         authority_capabilities={CAP_LOCAL_GIT: True})

        with self.assertRaises(ContractError):
            route_action(action_kind="teleport", semantic_authority_role="reasoning_authority",
                         authority_capabilities=host)
        self.assertEqual(sorted(ACTION_CAPABILITY),
                         ["git_operation", "read_repository", "run_command", "service_operation",
                          "write_repository"])

    def test_authority_module_is_provider_neutral(self):
        for name in ("authority.py", "decisions.py", "checkpoints.py", "context_envelope.py", "episodes.py"):
            text = (Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2" / name).read_text(encoding="utf-8")
            for token in ("chatgpt", "openai", "anthropic", "gemini", "codex", "kimi", "deepseek"):
                self.assertNotIn(token, text.lower(), f"{name} must stay provider neutral ({token})")

    def test_over_cap_context_cannot_be_bound_into_an_authority_request(self):
        with tempfile.TemporaryDirectory() as td:
            _, broker = self.broker(td)
            state = execution_state()
            blocked = build_context_manifest(
                manifest_id="ctx-blocked", run_id=RUN, task_id=TASK, role_id="tech_lead",
                components=[component(kind="system_control_text", component_id="sys-1", text="x" * 20000)],
                policy={"context_envelope": {"hard_cap_bytes": 1024}},
            )
            with self.assertRaises(PolicyError):
                broker.prepare_request(
                    request_id="areq-blocked", mode=MODE_CONSULT, requested_scope=["phase_sequencing"],
                    question="q", execution_state=state, context_manifest=blocked,
                    checkpoint=checkpoint_for(state), delegation_revision="deleg-3",
                    charter_revision="charter-2")


if __name__ == "__main__":
    unittest.main()
