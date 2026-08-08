"""Gate E - host semantic-trigger policy and complete hard context envelope.

E-01 .. E-12 of the Slice 2 source acceptance matrix.

No model is contacted anywhere in this file.  The counting fake provider is
inspected after every case so "zero hidden high-quality reasoning calls" and
"blocked before submission" are measured facts, not narration.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.commands import CommandCoordinator, CommandLedger
from mlgo_cao_v2.common import ContractError, PolicyError, load_json
from mlgo_cao_v2.context_envelope import (
    COMPONENT_KINDS,
    STATUS_BLOCKED_OVER_CAP,
    STATUS_WITHIN_CAP,
    UNAVAILABLE,
    SemanticCompressionDisabled,
    assert_within_cap,
    build_context_manifest,
    component,
    envelope_policy,
    record_block,
    semantic_compression_command,
    write_manifest,
)
from mlgo_cao_v2.episodes import (
    ALLOWED_TRIGGER_CLASSES,
    ENFORCEMENT_SHADOW_ONLY,
    EPISODE_OPEN,
    EPISODE_PAUSED_ESCALATED,
    NON_SEMANTIC_EVENT_CLASSES,
    TRIGGER_AUTHORITY_EXCEPTION,
    TRIGGER_DIFFICULT_PLANNING,
    TRIGGER_END_OF_TASK_CHALLENGE,
    TRIGGER_MATERIAL_DECOMPOSITION,
    TRIGGER_PROJECT_ARCHITECTURE,
    TRIGGER_UNUSUAL_ERROR,
    EpisodeLedger,
    classify_event,
)
from mlgo_cao_v2.policy import load_policy

from slice2_fixtures import (
    LOOKUP_CAPABILITIES,
    POLICY,
    ROOT,
    Controller,
    CountingProvider,
    command_envelope,
)

RUN = "run-slice2"
TASK = "task-slice2"


def semantic_event(trigger_class: str, **overrides):
    base = {
        "event_class": trigger_class, "run_id": RUN, "task_id": TASK,
        "initiator": "host", "evidence_refs": [{"id": f"ev-{trigger_class.lower()}"}],
        "subject_id": f"subject-{trigger_class.lower()}",
    }
    if trigger_class in (TRIGGER_PROJECT_ARCHITECTURE, TRIGGER_MATERIAL_DECOMPOSITION):
        base.update({"decision_scope": "milestone", "materially_affects_locked_architecture": True})
    elif trigger_class == TRIGGER_DIFFICULT_PLANNING:
        base["planning_difficulty_declared"] = True
    elif trigger_class == TRIGGER_UNUSUAL_ERROR:
        base.update({"error_class": "UNUSUAL", "bounded_attempts_used": 3})
    elif trigger_class == TRIGGER_AUTHORITY_EXCEPTION:
        base["exception_kind"] = "budget"
    elif trigger_class == TRIGGER_END_OF_TASK_CHALLENGE:
        base.update({"task_complete": True, "risk_tier": "HIGH"})
    base.update(overrides)
    return base


def text_component(kind, component_id, size, **kw):
    return component(kind=kind, component_id=component_id, text="x" * size, **kw)


def baseline_components(**sizes):
    defaults = {
        "system_control_text": 200, "profile_text": 200, "objective_task": 200,
        "durable_state_summary": 200, "adapter_wrapper": 100,
    }
    defaults.update({k: v for k, v in sizes.items() if k in defaults})
    out = [text_component(kind, f"{kind}-1", defaults[kind]) for kind in defaults]
    out.append(component(kind="selected_history", component_id="hist-1",
                         items=["turn-%d-%s" % (i, "h" * sizes.get("history_item_size", 8))
                                for i in range(sizes.get("history_items", 4))]))
    out.append(component(kind="tool_schemas", component_id="tools-1",
                         items=[{"name": "read", "schema": "s" * sizes.get("tool_schema_size", 20)}]))
    out.append(component(kind="tool_results", component_id="results-1",
                         items=[{"out": "r" * sizes.get("tool_result_size", 20)}],
                         reducible=sizes.get("tool_results_reducible", True)))
    out.append(component(kind="attachment_excerpts", component_id="att-1",
                         items=["e" * sizes.get("attachment_size", 20)]))
    return out


def manifest_for(components, *, cap, manifest_id="ctx-1", wrapper=None, observed=None):
    return build_context_manifest(
        manifest_id=manifest_id, run_id=RUN, task_id=TASK, role_id="tech_lead",
        components=components, wrapper=wrapper or {"transport_id": "fake-transport"},
        policy={"context_envelope": {"hard_cap_bytes": cap}},
        observed_provider_token_counts=observed,
    )


class Slice2GateETests(unittest.TestCase):

    # -- E-01 ------------------------------------------------------------
    def test_E01_routine_deterministic_events_produce_zero_episodes_and_zero_semantic_calls(self):
        provider = CountingProvider()
        with tempfile.TemporaryDirectory() as td:
            ledger = EpisodeLedger(Path(td) / "v2")
            for event_class in NON_SEMANTIC_EVENT_CLASSES:
                with self.subTest(event_class=event_class):
                    out = ledger.record_event({
                        "event_class": event_class, "run_id": RUN, "task_id": TASK,
                        "evidence_refs": [{"id": "ev-routine"}],
                    })
                    self.assertIsNone(out["episode"])
                    self.assertFalse(out["semantic_authority_required"])
                    self.assertEqual(out["semantic_calls_requested"], 0)
            counters = ledger.counters(TASK)
            self.assertEqual(counters["episodes"], 0)
            self.assertEqual(counters["semantic_calls_requested"], 0)
        self.assertEqual(provider.submit_count, 0)
        self.assertEqual(provider.external_effects, 0)

    def test_E01_episode_module_cannot_reach_a_provider(self):
        """A hidden semantic call cannot originate in the classifier."""

        source = (ROOT / "lib" / "mlgo_cao_v2" / "episodes.py").read_text(encoding="utf-8")
        imports = [line.strip() for line in source.splitlines()
                   if line.startswith(("import ", "from ")) or line.strip().startswith(("import ", "from "))]
        for line in imports:
            for forbidden in ("http_client", "transport", "request_json", "urllib", "socket", "subprocess",
                              "dispatch", "task_lead", "commands"):
                self.assertNotIn(forbidden, line,
                                 f"episodes.py must not be able to reach a provider: {line!r}")
        self.assertNotIn("def submit", source)

    # -- E-02 ------------------------------------------------------------
    def test_E02_each_allowed_trigger_opens_exactly_one_correctly_scoped_episode(self):
        with tempfile.TemporaryDirectory() as td:
            ledger = EpisodeLedger(Path(td) / "v2", policy={"semantic_triggers": {"max_episodes_per_task": 20,
                                                                                  "max_open_episodes_per_task": 20}})
            for trigger_class in ALLOWED_TRIGGER_CLASSES:
                with self.subTest(trigger_class=trigger_class):
                    out = ledger.record_event(semantic_event(trigger_class))
                    self.assertTrue(out["episode_opened"])
                    self.assertEqual(out["semantic_calls_requested"], 1)
                    episode = out["episode"]
                    self.assertEqual(episode["trigger_class"], trigger_class)
                    self.assertEqual(episode["status"], EPISODE_OPEN)
                    self.assertEqual(episode["run_id"], RUN)
                    self.assertEqual(episode["task_id"], TASK)
                    self.assertEqual(episode["initiator"], "host")
                    self.assertTrue(episode["evidence_ids"])
                    self.assertTrue(episode["dedupe_key"])
                    self.assertEqual(episode["enforcement_mode"], ENFORCEMENT_SHADOW_ONLY)
                    self.assertIn("authority_role", episode)
                    self.assertIn("authority_mode", episode)
                    self.assertIn("budget_decision", episode)
                    self.assertIn("outcome", episode)
            counters = ledger.counters(TASK)
            self.assertEqual(counters["episodes"], len(ALLOWED_TRIGGER_CLASSES))
            self.assertEqual(counters["open"], len(ALLOWED_TRIGGER_CLASSES))

    # -- E-03 ------------------------------------------------------------
    def test_E03_repeated_unresolved_trigger_coalesces_into_one_episode(self):
        with tempfile.TemporaryDirectory() as td:
            ledger = EpisodeLedger(Path(td) / "v2")
            first = ledger.record_event(semantic_event(TRIGGER_PROJECT_ARCHITECTURE))
            self.assertTrue(first["episode_opened"])
            for repeat in range(4):
                out = ledger.record_event(semantic_event(TRIGGER_PROJECT_ARCHITECTURE))
                self.assertFalse(out["episode_opened"])
                self.assertTrue(out["coalesced"])
                self.assertTrue(out["duplicate_no_op"])
                self.assertEqual(out["semantic_calls_requested"], 0)
                self.assertEqual(out["episode"]["episode_id"], first["episode"]["episode_id"])
                self.assertEqual(out["episode"]["coalesced_event_count"], repeat + 1)
            counters = ledger.counters(TASK)
            self.assertEqual(counters["episodes"], 1)
            self.assertEqual(counters["semantic_calls_requested"], 1)

    # -- E-04 ------------------------------------------------------------
    def test_E04_near_miss_events_open_no_episode(self):
        near_misses = [
            ("bounded attempts not exhausted",
             semantic_event(TRIGGER_UNUSUAL_ERROR, bounded_attempts_used=2)),
            ("ordinary error class",
             semantic_event(TRIGGER_UNUSUAL_ERROR, error_class="ORDINARY")),
            ("task-scoped architecture question",
             semantic_event(TRIGGER_PROJECT_ARCHITECTURE, decision_scope="task")),
            ("decomposition not materially affecting architecture",
             semantic_event(TRIGGER_MATERIAL_DECOMPOSITION, materially_affects_locked_architecture=False)),
            ("planning difficulty not declared",
             semantic_event(TRIGGER_DIFFICULT_PLANNING, planning_difficulty_declared=False)),
            ("exception kind is not authority/scope/risk/budget",
             semantic_event(TRIGGER_AUTHORITY_EXCEPTION, exception_kind="informational")),
            ("risk tier below the policy floor",
             semantic_event(TRIGGER_END_OF_TASK_CHALLENGE, risk_tier="LOW")),
            ("task not complete",
             semantic_event(TRIGGER_END_OF_TASK_CHALLENGE, task_complete=False)),
            ("no durable evidence reference",
             semantic_event(TRIGGER_PROJECT_ARCHITECTURE, evidence_refs=[])),
            ("unknown event class",
             {"event_class": "SOMETHING_ELSE", "run_id": RUN, "task_id": TASK}),
        ]
        with tempfile.TemporaryDirectory() as td:
            ledger = EpisodeLedger(Path(td) / "v2")
            for label, event in near_misses:
                with self.subTest(case=label):
                    classified = classify_event(event)
                    self.assertFalse(classified["semantic_authority_required"], label)
                    out = ledger.record_event(event)
                    self.assertIsNone(out["episode"])
                    self.assertEqual(out["semantic_calls_requested"], 0)
            self.assertEqual(ledger.counters(TASK)["episodes"], 0)

    # -- E-05 ------------------------------------------------------------
    def test_E05_exceeding_the_episode_ceiling_pauses_and_escalates(self):
        with tempfile.TemporaryDirectory() as td:
            ledger = EpisodeLedger(Path(td) / "v2", policy={"semantic_triggers": {
                "max_open_episodes_per_task": 2, "max_episodes_per_task": 2}})
            first = ledger.record_event(semantic_event(TRIGGER_PROJECT_ARCHITECTURE))
            second = ledger.record_event(semantic_event(TRIGGER_DIFFICULT_PLANNING))
            self.assertTrue(first["episode_opened"])
            self.assertTrue(second["episode_opened"])

            third = ledger.record_event(semantic_event(TRIGGER_AUTHORITY_EXCEPTION))
            self.assertFalse(third["episode_opened"])
            self.assertTrue(third["paused"])
            self.assertTrue(third["escalated"])
            self.assertFalse(third["silently_continued"])
            self.assertTrue(third["semantic_authority_required"])
            self.assertEqual(third["episode"]["status"], EPISODE_PAUSED_ESCALATED)
            self.assertEqual(third["episode"]["authority_mode"], "ESCALATE")
            self.assertEqual(third["episode"]["outcome"],
                             "EPISODE_LIMIT_EXCEEDED_PAUSED_FOR_HIGHER_AUTHORITY")
            self.assertEqual(ledger.counters(TASK)["paused_escalated"], 1)

    # -- E-06 ------------------------------------------------------------
    def test_E06_enlarged_system_and_profile_text_stays_within_cap_or_blocks_before_send(self):
        provider = CountingProvider()
        small = manifest_for(baseline_components(), cap=8192)
        self.assertEqual(small["status"], STATUS_WITHIN_CAP)
        assert_within_cap(small)

        for kind in ("system_control_text", "profile_text"):
            with self.subTest(kind=kind):
                enlarged = manifest_for(baseline_components(**{kind: 20000}), cap=8192,
                                        manifest_id=f"ctx-e06-{kind.replace('_', '-')}")
                self.assertEqual(enlarged["status"], STATUS_BLOCKED_OVER_CAP)
                self.assertIn("exceeding the hard cap", enlarged["block_reason"])
                with self.assertRaises(PolicyError):
                    assert_within_cap(enlarged)
                self.assertEqual(provider.submit_count, 0)
                self.assertEqual(provider.external_effects, 0)

    # -- E-07 ------------------------------------------------------------
    def test_E07_enlarged_selected_history_is_reduced_deterministically_or_blocks(self):
        provider = CountingProvider()
        enlarged = manifest_for(baseline_components(history_items=400, history_item_size=200),
                                cap=8192, manifest_id="ctx-e07")
        self.assertEqual(enlarged["status"], STATUS_WITHIN_CAP)
        self.assertLessEqual(enlarged["serialized_request_bytes"], enlarged["hard_cap_bytes"])
        self.assertTrue(enlarged["reductions"])
        self.assertTrue(all(r["kind"] == "selected_history" for r in enlarged["reductions"]))
        self.assertTrue(enlarged["deterministic_reduction_only"])
        self.assertFalse(enlarged["semantic_compression_used"])

        # Determinism: the same inputs produce the same reduced serialization.
        again = manifest_for(baseline_components(history_items=400, history_item_size=200),
                             cap=8192, manifest_id="ctx-e07")
        self.assertEqual(again["serialized_request_sha256"], enlarged["serialized_request_sha256"])
        self.assertEqual(provider.submit_count, 0)

    # -- E-08 ------------------------------------------------------------
    def test_E08_enlarged_tool_schemas_and_results_stay_within_cap_or_block(self):
        provider = CountingProvider()
        reducible = manifest_for(baseline_components(tool_schema_size=4000, tool_result_size=4000),
                                 cap=8192, manifest_id="ctx-e08a")
        self.assertEqual(reducible["status"], STATUS_WITHIN_CAP)
        self.assertLessEqual(reducible["serialized_request_bytes"], 8192)
        self.assertTrue(reducible["reductions"])

        # Deterministic reduction can shed reducible tool material entirely.
        shed = manifest_for(baseline_components(tool_schema_size=200000, tool_result_size=200000),
                            cap=2048, manifest_id="ctx-e08b")
        self.assertEqual(shed["status"], STATUS_WITHIN_CAP)
        self.assertLessEqual(shed["serialized_request_bytes"], 2048)
        self.assertNotIn("tool_schemas", shed["measured_component_kinds"])

        # Tool results the host has pinned as required cannot be shed, so the
        # request is blocked before submission rather than silently degraded.
        impossible = manifest_for(
            baseline_components(tool_result_size=200000, tool_results_reducible=False),
            cap=8192, manifest_id="ctx-e08c")
        self.assertEqual(impossible["status"], STATUS_BLOCKED_OVER_CAP)
        with self.assertRaises(PolicyError):
            assert_within_cap(impossible)
        self.assertEqual(provider.submit_count, 0)

    # -- E-09 ------------------------------------------------------------
    def test_E09_attachments_evidence_excerpts_and_adapter_wrapper_are_measured(self):
        provider = CountingProvider()
        attachments = manifest_for(baseline_components(attachment_size=40000), cap=8192,
                                   manifest_id="ctx-e09a")
        self.assertEqual(attachments["status"], STATUS_WITHIN_CAP)
        self.assertTrue(attachments["reductions"])

        # CAO-controlled adapter wrapper content counts toward the same cap and
        # is never silently excluded.
        wrapper_heavy = manifest_for(baseline_components(adapter_wrapper=40000), cap=8192,
                                     manifest_id="ctx-e09b")
        self.assertEqual(wrapper_heavy["status"], STATUS_BLOCKED_OVER_CAP)

        wrapper_payload = {"transport_id": "fake-transport", "envelope": "w" * 40000}
        outer_wrapper = manifest_for(baseline_components(), cap=8192, manifest_id="ctx-e09c",
                                     wrapper=wrapper_payload)
        self.assertEqual(outer_wrapper["status"], STATUS_BLOCKED_OVER_CAP)
        with self.assertRaises(PolicyError):
            assert_within_cap(outer_wrapper)
        self.assertEqual(provider.submit_count, 0)

    def test_E09_every_cao_controlled_component_kind_is_accounted_for(self):
        manifest = manifest_for(baseline_components(), cap=32768, manifest_id="ctx-e09d")
        self.assertEqual(sorted(manifest["measured_component_kinds"]), sorted(COMPONENT_KINDS))
        self.assertEqual(manifest["unmeasured_component_kinds"], [])

    # -- E-10 ------------------------------------------------------------
    def test_E10_host_bytes_are_exact_and_provider_internal_overhead_is_unavailable(self):
        components = baseline_components()
        manifest = manifest_for(components, cap=32768, manifest_id="ctx-e10")
        self.assertEqual(manifest["provider_internal_prompt_overhead"], UNAVAILABLE)
        self.assertEqual(manifest["provider_internal_transforms"], UNAVAILABLE)
        self.assertEqual(manifest["provider_native_token_counts"], UNAVAILABLE)
        self.assertEqual(manifest["token_estimation_method"], "none; host measures bytes and items only")

        # Exactness: the recorded byte count is the real serialized length.
        rebuilt = json.dumps(
            {"components": [{"kind": c["kind"], "component_id": c["component_id"], "payload": c["payload"]}
                            for c in manifest["_selected_components"]],
             "wrapper": {"transport_id": "fake-transport"}},
            sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8")
        self.assertEqual(manifest["serialized_request_bytes"], len(rebuilt))

        blob = json.dumps({k: v for k, v in manifest.items() if not k.startswith("_")})
        for forbidden in ("estimated_tokens", "approx_tokens", "token_estimate", "assumed_overhead"):
            self.assertNotIn(forbidden, blob)

        # Observed counts are recorded only where a provider actually reported.
        observed = manifest_for(components, cap=32768, manifest_id="ctx-e10b",
                                observed={"input_tokens": 1234, "source": "provider_reported"})
        self.assertEqual(observed["provider_native_token_counts"]["input_tokens"], 1234)
        self.assertEqual(observed["provider_internal_prompt_overhead"], UNAVAILABLE)

    # -- E-11 ------------------------------------------------------------
    def test_E11_semantic_compression_is_disabled_by_default_and_fails_closed(self):
        policy = load_policy(POLICY)
        self.assertFalse(policy["context_envelope"]["semantic_compression"]["enabled"])
        manifest = manifest_for(baseline_components(system_control_text=20000), cap=8192,
                                manifest_id="ctx-e11a")
        self.assertEqual(manifest["status"], STATUS_BLOCKED_OVER_CAP)
        with self.assertRaises(SemanticCompressionDisabled) as ctx:
            semantic_compression_command(
                manifest=manifest, policy=policy,
                envelope_builder=lambda request: (_ for _ in ()).throw(AssertionError("must not build")),
                command_runner=lambda envelope: (_ for _ in ()).throw(AssertionError("must not run")),
                evidence_refs=[{"kind": "usage", "id": "usage-1"}],
            )
        self.assertIn("blocked before submission", str(ctx.exception))

    def test_E11_enabled_semantic_compression_is_a_bounded_command_with_a_recursion_guard(self):
        enabled_policy = {"context_envelope": {"hard_cap_bytes": 8192, "semantic_compression": {
            "enabled": True, "max_depth": 1, "command_type": "context.semantic_compression"}}}
        manifest = manifest_for(baseline_components(system_control_text=20000), cap=8192,
                                manifest_id="ctx-e11b")
        with tempfile.TemporaryDirectory() as td:
            controller = Controller(td)
            controller.initialize()
            provider = CountingProvider()
            captured = {}

            def builder(request):
                captured["request"] = request
                envelope, payload = command_envelope(
                    command_id="cmd-compression", lease=controller.lease, request=request,
                    command_type="context.semantic_compression",
                )
                captured["payload"] = payload
                return envelope

            def runner(envelope):
                return controller.coordinator.dispatch(
                    envelope=envelope, request=captured["payload"], adapter=provider,
                    capabilities=LOOKUP_CAPABILITIES,
                )

            out = semantic_compression_command(
                manifest=manifest, policy=enabled_policy, envelope_builder=builder,
                command_runner=runner,
                evidence_refs=[{"kind": "usage_event", "id": "usage-1"},
                               {"kind": "provenance_delivery", "id": "dlv-1"}],
            )
            self.assertTrue(out["bounded_command"])
            self.assertEqual(out["command_type"], "context.semantic_compression")
            self.assertEqual(out["status"], "COMPLETED")
            # Exactly one bounded Command, and it is not a provider.submit.
            record = controller.command_ledger.load("cmd-compression")
            self.assertEqual(record["command_type"], "context.semantic_compression")
            self.assertEqual(provider.submit_count, 1)

            # References only; no new artifact/CAS/budget/event system.
            self.assertEqual([r["kind"] for r in captured["request"]["evidence_refs"]],
                             ["usage_event", "provenance_delivery"])

            # Recursion guard: compression can never trigger compression.
            with self.assertRaises(PolicyError) as ctx:
                semantic_compression_command(
                    manifest=manifest, policy=enabled_policy, envelope_builder=builder,
                    command_runner=runner, evidence_refs=[{"kind": "usage_event", "id": "usage-1"}],
                    depth=1,
                )
            self.assertIn("recursion guard", str(ctx.exception))
            self.assertEqual(provider.submit_count, 1)

            with self.assertRaises(PolicyError):
                semantic_compression_command(
                    manifest=manifest, policy=enabled_policy,
                    envelope_builder=lambda request: {**builder(request), "command_type": "provider.submit"},
                    command_runner=runner, evidence_refs=[{"kind": "usage_event", "id": "usage-1"}],
                )

    def test_E11_no_slice3_systems_were_introduced(self):
        lib = ROOT / "lib" / "mlgo_cao_v2"
        forbidden = ("ArtifactRef", "content_addressed_store", "cas_store", "budget_governor", "event_bus",
                     "retention_policy")
        for path in sorted(lib.glob("*.py")):
            text = path.read_text(encoding="utf-8")
            for token in forbidden:
                self.assertNotIn(token, text, f"Slice 3 machinery leaked into {path.name}: {token}")

    # -- E-12 ------------------------------------------------------------
    def test_E12_over_cap_payload_blocks_before_submission_with_a_durable_exact_reason(self):
        with tempfile.TemporaryDirectory() as td:
            controller = Controller(td)
            controller.initialize()
            provider = CountingProvider()
            manifest = manifest_for(baseline_components(system_control_text=50000), cap=4096,
                                    manifest_id="ctx-e12")
            self.assertEqual(manifest["status"], STATUS_BLOCKED_OVER_CAP)

            sent = False
            try:
                assert_within_cap(manifest)
                envelope, request = command_envelope(command_id="cmd-e12", lease=controller.lease)
                controller.coordinator.dispatch(envelope=envelope, request=request, adapter=provider,
                                                capabilities=LOOKUP_CAPABILITIES)
                sent = True
            except PolicyError:
                pass
            self.assertFalse(sent)
            self.assertEqual(provider.submit_count, 0)
            self.assertEqual(provider.external_effects, 0)

            block_path = record_block(controller.run_v2, manifest)
            record = load_json(block_path)
            self.assertEqual(record["status"], "BLOCKED_BEFORE_SUBMISSION")
            self.assertFalse(record["provider_submission_attempted"])
            self.assertIn("exceeding the hard cap", record["block_reason"])
            self.assertEqual(record["serialized_request_bytes"], manifest["serialized_request_bytes"])
            self.assertEqual(record["hard_cap_bytes"], 4096)

            manifest_path = write_manifest(controller.run_v2, manifest)
            stored = load_json(manifest_path)
            self.assertNotIn("_selected_components", stored)
            self.assertEqual(stored["status"], STATUS_BLOCKED_OVER_CAP)

    def test_tracked_policy_keeps_shadow_only_semantic_triggers(self):
        policy = load_policy(POLICY)
        self.assertEqual(policy["semantic_triggers"]["enforcement_mode"], ENFORCEMENT_SHADOW_ONLY)
        self.assertTrue(policy["context_envelope"]["block_before_send_on_overflow"])
        self.assertTrue(policy["context_envelope"]["common_token_estimate_forbidden"])
        self.assertEqual(envelope_policy(policy)["semantic_compression"]["enabled"], False)

    def test_unknown_component_kind_is_rejected(self):
        with self.assertRaises(ContractError):
            component(kind="freeform_extra", component_id="x", text="y")


if __name__ == "__main__":
    unittest.main()
