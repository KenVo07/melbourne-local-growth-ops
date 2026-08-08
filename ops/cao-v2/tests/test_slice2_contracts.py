"""Slice 2 schema conformance, RunContractBinding compatibility and migration.

These are the invariants the acceptance matrix depends on but does not itself
enumerate: the new records validate against their versioned schemas, a run only
gains Slice 2 durable writers when its RunContractBinding says so, and historical
Supervisor/Task Lead evidence is read through projections rather than rewritten.
"""

from __future__ import annotations

import copy
import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.checkpoints import create_conversation_handle
from mlgo_cao_v2.common import ContractError, PolicyError, load_json, sha256_json
from mlgo_cao_v2.context_envelope import build_context_manifest, component
from mlgo_cao_v2.continuity import project_legacy_session_record
from mlgo_cao_v2.contract_binding import (
    SLICE2_SCHEMA_NAMES,
    SLICE2_WRITER_FEATURES,
    assert_slice2_writer_allowed,
    slice2_compatibility,
)
from mlgo_cao_v2.decisions import MODE_ADJUDICATE, new_authority_request, new_decision
from mlgo_cao_v2.episodes import EpisodeLedger, TRIGGER_PROJECT_ARCHITECTURE, classify_event
from mlgo_cao_v2.task_lead import (
    create_tech_lead_checkpoint,
    normalize_tech_lead_execution_state,
    project_legacy_task_lead_checkpoint,
)

from slice2_fixtures import (
    ROOT,
    SCHEMAS,
    SHA_BUILD,
    SHA_POLICY,
    SHA_REGISTRY,
    SHA_SCHEMAS,
    all_slice2_writers,
    slice2_binding,
)


class Slice2ContractTests(unittest.TestCase):

    def validate(self, schema_name, value):
        try:
            from jsonschema import Draft202012Validator
        except ImportError as exc:  # pragma: no cover - environment dependent
            self.skipTest(f"jsonschema unavailable: {exc}")
        schema = load_json(SCHEMAS / schema_name)
        errors = list(Draft202012Validator(schema).iter_errors(value))
        self.assertFalse(errors, f"{schema_name}: {errors[0].message if errors else ''}")

    def test_slice2_records_conform_to_versioned_schemas(self):
        handle = create_conversation_handle(
            handle_id="ch-schema", run_id="run-schema", role_id="tech_lead", work_package_id="bt-schema",
            task_id="task-schema", provider_profile_id="fake-builder", account_profile_id="fake-account",
            provider_id="fake", model="fake-model", reasoning_effort="medium", transport_id="fake-transport",
            registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
            runtime_version="0.4.0-slice2-vnext", build_manifest_sha256=SHA_BUILD, generation=1,
        )
        self.validate("conversation-handle.schema.json", handle)

        state = normalize_tech_lead_execution_state({
            "run_id": "run-schema", "big_task_id": "bt-schema", "task_id": "task-schema",
            "task_lead_id": "tl-schema", "task_graph": [{"task_id": "t-a", "status": "COMPLETE", "depends_on": []}],
            "ownership": {"workers": [], "files": [], "worktrees": []},
            "evidence_refs": [{"id": "ev-1", "kind": "commit"}],
            "decisions": [], "risks": [], "dependencies": [],
            "delegation_revision": "deleg-1", "charter_revision": "charter-1",
            "cursors": {"state_version": 3}, "last_committed_state_version": 3,
        })
        self.validate("tech-lead-execution-state.schema.json", state)

        checkpoint = create_tech_lead_checkpoint(
            checkpoint_id="ckpt-schema", execution_state=state, registry_digest=SHA_REGISTRY,
            policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
            conversation_handle_digest=handle["handle_digest"],
        )
        self.validate("checkpoint-vnext.schema.json", checkpoint)

        trigger = classify_event({
            "event_class": TRIGGER_PROJECT_ARCHITECTURE, "run_id": "run-schema", "task_id": "task-schema",
            "subject_id": "milestone-1", "decision_scope": "milestone",
            "materially_affects_locked_architecture": True, "evidence_refs": [{"id": "ev-1"}],
        })
        self.validate("semantic-trigger.schema.json", dict(trigger))

        with tempfile.TemporaryDirectory() as td:
            ledger = EpisodeLedger(Path(td) / "v2")
            out = ledger.record_event({
                "event_class": TRIGGER_PROJECT_ARCHITECTURE, "run_id": "run-schema", "task_id": "task-schema",
                "subject_id": "milestone-1", "decision_scope": "milestone",
                "materially_affects_locked_architecture": True, "evidence_refs": [{"id": "ev-1"}],
            })
            self.validate("authority-episode.schema.json", out["episode"])

        manifest = build_context_manifest(
            manifest_id="ctx-schema", run_id="run-schema", task_id="task-schema", role_id="tech_lead",
            components=[component(kind="objective_task", component_id="obj-1", text="objective")],
            wrapper={"transport_id": "fake-transport"},
        )
        self.validate("context-manifest.schema.json",
                      {k: v for k, v in manifest.items() if not k.startswith("_")})

        request = new_authority_request(
            request_id="areq-schema", run_id="run-schema", task_id="task-schema", big_task_id="bt-schema",
            requester_role="tech_lead", authority_role="authoritative_supervisor", mode=MODE_ADJUDICATE,
            requested_scope=["phase_sequencing"], state_revision=3,
            context_manifest_digest=manifest["manifest_digest"], checkpoint_digest=checkpoint["content_digest"],
            delegation_revision="deleg-1", charter_revision="charter-1",
            delegated_scope=["phase_sequencing"], question="bounded question",
        )
        self.validate("tech-lead-consult-request.schema.json", request)

        decision = new_decision(decision_id="adec-schema", request=request, outcome="APPROVED",
                                applied_scope=["phase_sequencing"])
        self.validate("tech-lead-decision.schema.json", decision)

    def test_all_slice2_schemas_are_tracked_and_parse(self):
        for name in SLICE2_SCHEMA_NAMES:
            path = SCHEMAS / name
            self.assertTrue(path.is_file(), f"missing Slice 2 schema: {name}")
            schema = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(schema["$schema"], "https://json-schema.org/draft/2020-12/schema")
            self.assertIn("title", schema)

    def test_run_contract_binding_identifies_slice2_and_writers_default_off(self):
        default = slice2_binding()
        compatibility = slice2_compatibility(default)
        self.assertTrue(compatibility["slice2_schema_bundle_complete"])
        self.assertEqual(compatibility["slice2_writers_enabled"], [])
        self.assertFalse(compatibility["slice2_durable_writers_active"])
        for feature in SLICE2_WRITER_FEATURES:
            with self.assertRaises(PolicyError):
                assert_slice2_writer_allowed(default, feature)

        enabled = slice2_binding(enabled_writers=all_slice2_writers())
        compatibility = slice2_compatibility(enabled)
        self.assertEqual(compatibility["slice2_writers_enabled"], sorted(SLICE2_WRITER_FEATURES))
        self.assertTrue(compatibility["slice2_durable_writers_active"])
        for feature in SLICE2_WRITER_FEATURES:
            assert_slice2_writer_allowed(enabled, feature)

        with self.assertRaises(ContractError):
            assert_slice2_writer_allowed(enabled, "not_a_slice2_writer")

    def test_slice2_writers_require_the_complete_schema_bundle(self):
        from mlgo_cao_v2.contract_binding import create_run_contract_binding

        files = [{"name": "command.schema.json", "sha256": SHA_SCHEMAS},
                 {"name": "conversation-handle.schema.json", "sha256": SHA_SCHEMAS}]
        partial = create_run_contract_binding(
            runtime_version="0.4.0-slice2-vnext", build_id="build-partial",
            build_manifest_sha256=SHA_BUILD, registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY,
            schema_bundle_record={"files": files, "digest": sha256_json(files)},
            enabled_writers=["run_state", "conversation_handles"], minimum_reader_version="0.4.0",
            minimum_writer_version="0.4.0", compatible_writer_ids=["slice2-controller"],
        )
        compatibility = slice2_compatibility(partial)
        self.assertFalse(compatibility["slice2_schema_bundle_complete"])
        with self.assertRaises(PolicyError) as ctx:
            assert_slice2_writer_allowed(partial, "conversation_handles")
        self.assertIn("complete Slice 2 schema bundle", str(ctx.exception))

    def test_legacy_task_lead_checkpoint_projects_without_rewriting_history(self):
        source_path = ROOT / "examples" / "task-lead-checkpoint.example.json"
        original = source_path.read_bytes()
        legacy = json.loads(original)
        projection = project_legacy_task_lead_checkpoint(copy.deepcopy(legacy))

        self.assertFalse(projection["source_record_rewritten"])
        self.assertEqual(projection["source_digest"], sha256_json(legacy))
        state = projection["execution_state"]
        self.assertEqual(state["run_id"], legacy["run_id"])
        self.assertEqual(state["completed_task_ids"], [legacy["completed_phase"]])
        self.assertEqual([t["task_id"] for t in state["task_graph"]],
                         sorted([legacy["completed_phase"], *legacy["remaining_phase_map"]]))
        # The projection is honest about what the legacy schema cannot carry.
        self.assertIn("ownership", projection["unavailable_sections"])
        self.assertEqual(source_path.read_bytes(), original, "historical evidence must stay byte-identical")
        self.validate("tech-lead-execution-state.schema.json", state)

    def test_legacy_supervisor_session_record_projects_without_claiming_resume(self):
        source_path = ROOT / "examples" / "session-continuity-record.example.json"
        original = source_path.read_bytes()
        legacy = json.loads(original)
        projection = project_legacy_session_record(
            copy.deepcopy(legacy), handle_id="ch-legacy", policy_digest=SHA_POLICY,
            registry_digest=SHA_REGISTRY, contract_bundle_digest=SHA_SCHEMAS,
            runtime_version="0.4.0-slice2-vnext", build_manifest_sha256=SHA_BUILD,
            account_profile_id="codex-business", transport_id="cao-main", model="gpt-5.6-sol",
        )
        self.assertFalse(projection["source_record_rewritten"])
        self.assertFalse(projection["native_resume_claimed"])
        handle = projection["conversation_handle"]
        self.assertEqual(handle["provider_profile_id"], legacy["profile"])
        self.assertEqual(handle["provider_id"], legacy["provider"])
        self.assertEqual(handle["session_continuity_claim"], "NONE_NEW_GENERATION")
        self.assertIsNone(handle["provider_session_id"],
                          "a projection must not invent a session-continuity claim")
        self.assertEqual(handle["host_observation"]["process_identity"], legacy["process_identity"])
        self.assertEqual(source_path.read_bytes(), original, "historical evidence must stay byte-identical")
        self.validate("conversation-handle.schema.json", handle)

    def test_runtime_version_is_the_slice2_version(self):
        from mlgo_cao_v2 import __version__

        self.assertEqual(__version__, "0.4.0-slice2-vnext")
        verify = (ROOT / "verify.sh").read_text(encoding="utf-8")
        self.assertIn('expected = "0.4.0-slice2-vnext"', verify)


if __name__ == "__main__":
    unittest.main()


class Slice2IndependentReviewFindingTests(unittest.TestCase):
    """Regressions for material findings raised during the Slice 2 review pass."""

    def test_review_R1_partial_expected_identity_cannot_weaken_the_send_check(self):
        from mlgo_cao_v2.checkpoints import HANDLE_IDENTITY_FIELDS, assert_handle_authorizes_send

        handle = create_conversation_handle(
            handle_id="ch-r1", run_id="run-r1", role_id="tech_lead", work_package_id="bt-r1",
            task_id="task-r1", provider_profile_id="fake-builder", account_profile_id="fake-account",
            provider_id="fake", model="fake-model", reasoning_effort="medium", transport_id="fake-transport",
            registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
            runtime_version="0.4.0-slice2-vnext", build_manifest_sha256=SHA_BUILD, generation=1,
        )
        with self.assertRaises(ContractError) as ctx:
            assert_handle_authorizes_send(handle, expected={"run_id": "run-r1"})
        self.assertIn("complete expected identity", str(ctx.exception))
        complete = {field: handle[field] for field in HANDLE_IDENTITY_FIELDS}
        out = assert_handle_authorizes_send(handle, expected=complete)
        self.assertEqual(sorted(out["checked_fields"]), sorted(HANDLE_IDENTITY_FIELDS))

    def test_review_R2_a_stale_decision_can_never_be_applied_later(self):
        from mlgo_cao_v2.decisions import DecisionLedger, new_decision

        with tempfile.TemporaryDirectory() as td:
            ledger = DecisionLedger(Path(td) / "v2")
            request = new_authority_request(
                request_id="areq-r2", run_id="run-r2", task_id="task-r2", big_task_id="bt-r2",
                requester_role="tech_lead", authority_role="authoritative_supervisor",
                mode=MODE_ADJUDICATE, requested_scope=["phase_sequencing"], state_revision=5,
                context_manifest_digest="a" * 64, checkpoint_digest="b" * 64,
                delegation_revision="deleg-1", charter_revision="charter-1",
                delegated_scope=["phase_sequencing"], question="q",
            )
            ledger.open_request(request)
            decision = new_decision(decision_id="adec-r2", request=request, outcome="APPROVED",
                                    applied_scope=["phase_sequencing"])
            applications = []
            stale = ledger.apply_decision(
                decision, current_state_revision=6, current_delegation_revision="deleg-1",
                current_charter_revision="charter-1", applier=lambda d: applications.append(d) or {},
            )
            self.assertEqual(stale["status"], "STALE_DECISION")
            # The bound revision is "current" again, but the decision stays dead.
            with self.assertRaises(PolicyError) as ctx:
                ledger.apply_decision(
                    decision, current_state_revision=5, current_delegation_revision="deleg-1",
                    current_charter_revision="charter-1", applier=lambda d: applications.append(d) or {},
                )
            self.assertIn("already recorded STALE_DECISION", str(ctx.exception))
            self.assertEqual(applications, [])

    def test_review_R3_duplicate_component_ids_cannot_double_count_request_material(self):
        with self.assertRaises(ContractError) as ctx:
            build_context_manifest(
                manifest_id="ctx-r3", run_id="run-r3", task_id="task-r3", role_id="tech_lead",
                components=[
                    component(kind="tool_results", component_id="dup-1", items=[{"a": 1}]),
                    component(kind="attachment_excerpts", component_id="dup-1", items=["b"]),
                ],
            )
        self.assertIn("double counted", str(ctx.exception))
