"""Gate D - logical restart, continuity and checkpoint correctness.

D-01 .. D-10 of the Slice 2 source acceptance matrix.

Every case is deterministic and offline.  D-02 uses a real process/environment
recreation fixture (two separate Python processes over one durable directory),
not a machine reboot.  D-09 uses a disposable in-memory registry/policy fixture
that cannot qualify or enable native resume for any real provider; the same test
asserts the tracked policy still has native resume disabled everywhere.
"""

from __future__ import annotations

import copy
import os
import json
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

from mlgo_cao_v2.checkpoints import (
    CLAIM_NATIVE_SESSION_RESUME,
    CLAIM_NEW_GENERATION,
    HANDLE_IDENTITY_FIELDS,
    assert_handle_authorizes_send,
    create_checkpoint,
    create_conversation_handle,
    load_checkpoint,
    successor_handle,
    validate_checkpoint,
    write_checkpoint,
)
from mlgo_cao_v2.common import ContractError, PolicyError, iso_now, load_json, sha256_json
from mlgo_cao_v2.continuity import (
    PATH_CHECKPOINT,
    PATH_NATIVE,
    begin_checkpoint_fallback,
    build_successor_after_loss,
    durable_cursors,
    logical_replay_plan,
    reconcile_logical_state,
)
from mlgo_cao_v2.policy import load_policy
from mlgo_cao_v2.registry import capability_identity, make_qualification, registry_digest, validate_registry
from mlgo_cao_v2.task_lead import (
    create_tech_lead_checkpoint,
    normalize_tech_lead_execution_state,
    restore_tech_lead_execution_state,
    tech_lead_replay_plan,
)
from mlgo_cao_v2.transport import ObservationState, SubmitCertainty

from slice2_fixtures import (
    LOOKUP_CAPABILITIES,
    POLICY,
    ROOT,
    SHA_BUILD,
    SHA_POLICY,
    SHA_REGISTRY,
    SHA_SCHEMAS,
    SUPERVISOR_PROFILE,
    Controller,
    CountingProvider,
    command_envelope,
)

RUNTIME_VERSION = "0.4.0-slice2-vnext"


def base_handle(**overrides):
    fields = dict(
        handle_id="ch-1", run_id="run-slice2", role_id="tech_lead", work_package_id="bt-1",
        task_id="task-1", provider_profile_id="fake-builder", account_profile_id="fake-account",
        provider_id="fake", model="fake-model", reasoning_effort="medium", transport_id="fake-transport",
        registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
        runtime_version=RUNTIME_VERSION, build_manifest_sha256=SHA_BUILD, generation=1,
    )
    fields.update(overrides)
    return create_conversation_handle(**fields)


def expected_identity(handle):
    return {field: handle[field] for field in HANDLE_IDENTITY_FIELDS}


def tech_lead_state(**overrides):
    value = {
        "run_id": "run-slice2", "big_task_id": "bt-1", "task_id": "task-1", "task_lead_id": "tl-1",
        "generation": 1,
        "task_graph": [
            {"task_id": "t-a", "status": "COMPLETE", "depends_on": []},
            {"task_id": "t-b", "status": "COMPLETE", "depends_on": ["t-a"]},
            {"task_id": "t-c", "status": "RUNNING", "depends_on": ["t-b"]},
        ],
        "ownership": {
            "workers": [{"worker_id": "w-1", "task_id": "t-c", "route_id": "agy_flash_high"}],
            "files": ["packages/x/src/a.ts", "packages/x/src/b.ts"],
            "worktrees": [{"worktree_id": "wt-1", "branch": "agent/t-c", "worker_id": "w-1"}],
        },
        "evidence_refs": [
            {"id": "ev-commit-a", "kind": "commit", "sha256": "1" * 64},
            {"id": "ev-diff-a", "kind": "diff", "sha256": "2" * 64},
            {"id": "ev-test-a", "kind": "test_run", "sha256": "3" * 64},
            {"id": "ev-review-a", "kind": "review", "sha256": "4" * 64},
            {"id": "ev-integration-a", "kind": "integration", "sha256": "5" * 64},
        ],
        "decisions": [{"decision_id": "dec-1", "outcome": "APPROVED", "scope": "phase_sequencing"}],
        "risks": [{"risk_id": "risk-1", "status": "OPEN", "summary": "ordering"}],
        "dependencies": [{"dependency_id": "dep-1", "on": "t-a", "kind": "sequence"}],
        "delegation_revision": "deleg-3", "charter_revision": "charter-2",
        "cursors": {"state_version": 9, "command_cursor": {"count": 3, "last_id": "cmd-3"},
                    "operation_cursor": {"count": 1, "last_id": "op-1"}},
        "last_committed_state_version": 9,
    }
    value.update(overrides)
    return value


def supervisor_checkpoint(td, **overrides):
    fields = dict(
        checkpoint_id="ckpt-sup-1", run_id="run-slice2", role_id="authoritative_supervisor",
        work_package_id="bt-1", task_id="task-1", source_generation=1, state_schema_version="2.1",
        normalized_state={"phases": {"p-1": "COMPLETE"}, "open_risks": []},
        registry_digest=SHA_REGISTRY, policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
        last_committed_state_version=4,
        cursors={"state_version": 4, "command_cursor": {"count": 2, "last_id": "cmd-2"}},
    )
    fields.update(overrides)
    return create_checkpoint(**fields)


class Slice2GateDTests(unittest.TestCase):

    # -- D-01 ------------------------------------------------------------
    def test_D01_controller_recreation_at_every_boundary_never_repeats_provider_work(self):
        """Recreate the controller at each durable Command boundary."""

        command_ids = ["cmd-1", "cmd-2", "cmd-3"]
        for crash_after in range(len(command_ids)):
            with self.subTest(crash_after=crash_after), tempfile.TemporaryDirectory() as td:
                provider = CountingProvider()
                controller = Controller(td)
                controller.initialize()
                for index, command_id in enumerate(command_ids):
                    envelope, request = command_envelope(command_id=command_id, lease=controller.lease)
                    out = controller.coordinator.dispatch(
                        envelope=envelope, request=request, adapter=provider,
                        capabilities=LOOKUP_CAPABILITIES,
                    )
                    self.assertEqual(out["status"], "COMPLETED")
                    if index == crash_after:
                        # Controller/process loss: nothing survives in memory.
                        controller = Controller(td)
                        replay = reconcile_logical_state(
                            store=controller.store, coordinator=controller.coordinator,
                            command_ledger=controller.command_ledger, adapter=provider,
                            capabilities=LOOKUP_CAPABILITIES,
                            operation_ledger=controller.operation_ledger,
                            executor_lease=controller.lease,
                        )
                        self.assertEqual(replay["resubmitted_command_ids"], [])
                        self.assertEqual(replay["replay_command_ids"], [])
                        self.assertTrue(replay["completed_provider_work_replay_forbidden"])
                self.assertEqual(provider.external_effects, len(command_ids))
                self.assertEqual(sorted(provider.effects_by_command), command_ids)
                self.assertTrue(all(v == 1 for v in provider.effects_by_command.values()))

    def test_D01_incomplete_work_reconciles_without_a_second_send(self):
        with tempfile.TemporaryDirectory() as td:
            provider = CountingProvider(
                submit_certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT,
                reconcile_state=ObservationState.IN_PROGRESS,
            )
            controller = Controller(td)
            controller.initialize()
            envelope, request = command_envelope(command_id="cmd-amb", lease=controller.lease)
            out = controller.coordinator.dispatch(
                envelope=envelope, request=request, adapter=provider, capabilities=LOOKUP_CAPABILITIES,
            )
            self.assertEqual(out["status"], "OBSERVED_IN_PROGRESS")

            recreated = Controller(td)
            plan = logical_replay_plan(
                store=recreated.store, command_ledger=recreated.command_ledger,
                operation_ledger=recreated.operation_ledger,
            )
            self.assertEqual(plan["reconcile_command_ids"], ["cmd-amb"])
            self.assertEqual(plan["completed_command_ids"], [])

            provider.observe_state = ObservationState.COMPLETED
            replay = reconcile_logical_state(
                store=recreated.store, coordinator=recreated.coordinator,
                command_ledger=recreated.command_ledger, adapter=provider,
                capabilities=LOOKUP_CAPABILITIES, operation_ledger=recreated.operation_ledger,
                executor_lease=recreated.lease,
            )
            self.assertEqual(replay["reconciled"]["cmd-amb"], "COMPLETED")
            self.assertEqual(provider.submit_count, 1)
            self.assertEqual(provider.external_effects, 1)

    # -- D-02 ------------------------------------------------------------
    def test_D02_process_and_environment_recreation_resumes_from_last_boundary(self):
        """A genuinely separate process resumes durable work without replay."""

        fixture = textwrap.dedent(
            """
            import json, os, sys
            from pathlib import Path
            sys.path.insert(0, sys.argv[1])          # runtime lib
            sys.path.insert(0, sys.argv[2])          # tests dir
            from mlgo_cao_v2.transport import ObservationState, SubmitCertainty
            from slice2_fixtures import Controller, LOOKUP_CAPABILITIES, command_envelope

            state_root, ledger_path, phase = sys.argv[3], Path(sys.argv[4]), sys.argv[5]

            class DurableProvider:
                "A provider whose external effects survive host process death."
                adapter_id = "slice2-durable-fake"
                def _bump(self, command_id):
                    data = json.loads(ledger_path.read_text()) if ledger_path.exists() else {}
                    data[command_id] = data.get(command_id, 0) + 1
                    ledger_path.write_text(json.dumps(data, sort_keys=True))
                def submit(self, command, request):
                    from mlgo_cao_v2.transport import SubmitResult
                    self._bump(str(command["command_id"]))
                    return SubmitResult(SubmitCertainty.ACCEPTED, receipt_id="r-1", response={}, provider_started=True)
                def observe(self, command, receipt_id):
                    from mlgo_cao_v2.transport import ReconcileResult
                    return ReconcileResult(ObservationState.COMPLETED, receipt_id="r-1", result={"ok": True}, exact=True, provider_started=True)
                def reconcile(self, command):
                    return self.observe(command, "r-1")
                def cancel(self, command, receipt_id): raise AssertionError("not used")
                def cleanup(self, command, receipt_id): raise AssertionError("not used")

            controller = Controller(state_root, owner_id="controller-" + phase)
            provider = DurableProvider()
            if phase == "first":
                controller.initialize()
                envelope, request = command_envelope(command_id="cmd-d02", lease=controller.lease)
                def fault(stage, record):
                    if stage == "after_transport_submit":
                        # Environment loss immediately after the transport crossing.
                        os._exit(17)
                controller.coordinator.dispatch(envelope=envelope, request=request, adapter=provider,
                                                capabilities=LOOKUP_CAPABILITIES, fault_hook=fault)
                raise AssertionError("first phase must not complete normally")
            else:
                from mlgo_cao_v2.continuity import logical_replay_plan, reconcile_logical_state
                plan = logical_replay_plan(store=controller.store, command_ledger=controller.command_ledger,
                                          operation_ledger=controller.operation_ledger)
                out = reconcile_logical_state(store=controller.store, coordinator=controller.coordinator,
                                             command_ledger=controller.command_ledger, adapter=provider,
                                             capabilities=LOOKUP_CAPABILITIES,
                                             operation_ledger=controller.operation_ledger,
                                             executor_lease=controller.lease)
                print(json.dumps({"plan": plan["reconcile_command_ids"], "reconciled": out["reconciled"],
                                  "state_version": plan["state_version"]}))
            """
        )
        with tempfile.TemporaryDirectory() as td:
            script = Path(td) / "d02_fixture.py"
            script.write_text(fixture, encoding="utf-8")
            state_root = Path(td) / "state"
            ledger = Path(td) / "provider-effects.json"
            env_args = [sys.executable, str(script), str(ROOT / "lib"), str(ROOT / "tests"), str(state_root), str(ledger)]
            # Each phase is a separate process with a separate environment.
            child_env = {**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "MLGO_CAO_V2_SLICE2_FIXTURE": "1"}

            first = subprocess.run(env_args + ["first"], capture_output=True, text=True, env=child_env)
            self.assertEqual(first.returncode, 17, first.stderr)
            self.assertEqual(json.loads(ledger.read_text()), {"cmd-d02": 1})

            second = subprocess.run(env_args + ["second"], capture_output=True, text=True, env=child_env)
            self.assertEqual(second.returncode, 0, second.stderr)
            result = json.loads(second.stdout.strip().splitlines()[-1])
            self.assertEqual(result["plan"], ["cmd-d02"])
            self.assertEqual(result["reconciled"]["cmd-d02"], "COMPLETED")
            # The completed provider call was never repeated by the new process.
            self.assertEqual(json.loads(ledger.read_text()), {"cmd-d02": 1})

    # -- D-03 ------------------------------------------------------------
    def test_D03_swapped_conversation_handles_reject_before_provider_submission(self):
        handle_a = base_handle(handle_id="ch-run-a", run_id="run-a", task_id="task-a")
        handle_b = base_handle(handle_id="ch-run-b", run_id="run-b", task_id="task-b")
        provider = CountingProvider()
        # The correct handle authorizes the send.
        self.assertTrue(assert_handle_authorizes_send(handle_a, expected=expected_identity(handle_a))["authorized"])
        with self.assertRaises(PolicyError) as ctx:
            assert_handle_authorizes_send(handle_b, expected=expected_identity(handle_a))
        self.assertIn("run_id", str(ctx.exception))
        self.assertEqual(provider.submit_count, 0)
        self.assertEqual(provider.external_effects, 0)

    # -- D-04 ------------------------------------------------------------
    def test_D04_each_identity_axis_mismatch_rejects_before_send(self):
        handle = base_handle()
        provider = CountingProvider()
        mismatches = {
            "role_id": "authoritative_supervisor",
            "task_id": "task-other",
            "provider_profile_id": "other-profile",
            "account_profile_id": "other-account",
            "provider_id": "other-provider",
            "model": "other-model",
            "transport_id": "other-transport",
            "generation": 2,
        }
        for field, value in mismatches.items():
            with self.subTest(field=field):
                expected = expected_identity(handle)
                expected[field] = value
                with self.assertRaises(PolicyError) as ctx:
                    assert_handle_authorizes_send(handle, expected=expected)
                self.assertIn(field, str(ctx.exception))
        self.assertEqual(provider.submit_count, 0)

    # -- D-05 ------------------------------------------------------------
    def test_D05_checkpoint_content_or_digest_tamper_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            checkpoint = supervisor_checkpoint(td)
            path = write_checkpoint(Path(td) / "ckpt.json", checkpoint)
            self.assertEqual(load_checkpoint(path)["checkpoint_id"], "ckpt-sup-1")

            tampered_state = copy.deepcopy(checkpoint)
            tampered_state["normalized_state"]["phases"]["p-1"] = "PENDING"
            with self.assertRaises(ContractError) as ctx:
                validate_checkpoint(tampered_state)
            self.assertIn("normalized state digest mismatch", str(ctx.exception))

            tampered_digest = copy.deepcopy(checkpoint)
            tampered_digest["content_digest"] = "0" * 64
            with self.assertRaises(ContractError) as ctx:
                validate_checkpoint(tampered_digest)
            self.assertIn("content digest mismatch", str(ctx.exception))

            tampered_field = copy.deepcopy(checkpoint)
            tampered_field["last_committed_state_version"] = 99
            with self.assertRaises(ContractError):
                validate_checkpoint(tampered_field)

    # -- D-06 ------------------------------------------------------------
    def test_D06_cursor_gap_lineage_and_unsupported_schema_fail_closed_with_exact_reason(self):
        checkpoint = supervisor_checkpoint(None)

        with self.assertRaises(ContractError) as ctx:
            validate_checkpoint(
                checkpoint,
                available_cursors={"state_version": 4, "command_cursor": {"count": 1, "last_id": "cmd-1"}},
            )
        self.assertIn("cursor gap", str(ctx.exception))
        self.assertIn("command_cursor", str(ctx.exception))

        with self.assertRaises(ContractError) as ctx:
            validate_checkpoint(
                checkpoint,
                available_cursors={"state_version": 2, "command_cursor": {"count": 2, "last_id": "cmd-2"}},
            )
        self.assertIn("state_version", str(ctx.exception))

        with self.assertRaises(ContractError) as ctx:
            validate_checkpoint(
                checkpoint,
                available_cursors={"state_version": 4,
                                   "command_cursor": {"count": 2, "last_id": "cmd-2", "available": False}},
            )
        self.assertIn("no longer available for replay", str(ctx.exception))

        broken_lineage = copy.deepcopy(checkpoint)
        broken_lineage["predecessor_checkpoint_id"] = "ckpt-old"
        broken_lineage["content_digest"] = sha256_json(
            {k: v for k, v in broken_lineage.items() if k != "content_digest"}
        )
        with self.assertRaises(ContractError) as ctx:
            validate_checkpoint(broken_lineage)
        self.assertIn("lineage is incomplete", str(ctx.exception))

        future = copy.deepcopy(checkpoint)
        future["schema_version"] = "9.9"
        future["content_digest"] = sha256_json({k: v for k, v in future.items() if k != "content_digest"})
        with self.assertRaises(ContractError) as ctx:
            validate_checkpoint(future)
        self.assertIn("unsupported checkpoint schema version", str(ctx.exception))

        with self.assertRaises(PolicyError) as ctx:
            validate_checkpoint(checkpoint, expected_identity={"run_id": "run-other"})
        self.assertIn("identity mismatch", str(ctx.exception))

    # -- D-07 ------------------------------------------------------------
    def test_D07_supervisor_fallback_produces_one_truthful_successor_generation(self):
        policy = load_policy(POLICY)
        self.assertTrue(
            all(not cfg[PATH_NATIVE]["enabled"] for cfg in policy["continuity"]["provider_capabilities"].values()),
            "native resume must remain disabled for every real provider",
        )
        with tempfile.TemporaryDirectory() as td:
            provider = CountingProvider()
            controller = Controller(td)
            controller.initialize(supervisor_profile=SUPERVISOR_PROFILE)
            envelope, request = command_envelope(command_id="cmd-done", lease=controller.lease)
            controller.coordinator.dispatch(
                envelope=envelope, request=request, adapter=provider, capabilities=LOOKUP_CAPABILITIES,
            )
            self.assertEqual(provider.external_effects, 1)

            checkpoint = supervisor_checkpoint(td)
            checkpoint_path = write_checkpoint(Path(td) / "sup-ckpt.json", checkpoint)
            approval = {
                "schema_version": "1.0", "action": PATH_CHECKPOINT, "run_id": controller.run_id,
                "approved": True, "issued_at": iso_now(),
                "expires_at": _plus_minutes(iso_now(), 30),
            }
            outcome = begin_checkpoint_fallback(
                store=controller.store, policy=policy, checkpoint_path=str(checkpoint_path),
                approval=approval, reason="deterministic Gate D-07 supervisor loss fixture",
            )
            self.assertEqual(outcome["path"], PATH_CHECKPOINT)
            self.assertEqual(outcome["generation"], 2)

            state = controller.store.load()
            selected = state["supervisor_selection"]
            self.assertEqual(selected["profile"], SUPERVISOR_PROFILE, "selected supervisor must be immutable")
            self.assertEqual(selected["generation"], 2, "exactly one successor generation")
            self.assertIsNone(selected["provider_session_id"], "no false claim on the old provider session")
            self.assertIsNone(selected["terminal_id"])

            predecessor = base_handle(role_id="authoritative_supervisor", provider_session_id="prov-session-old",
                                      provider_conversation_id="prov-conv-old")
            selection = build_successor_after_loss(
                predecessor_handle=predecessor, handle_id="ch-sup-g2", policy=policy,
                native_session_evidence={"provider_session_id": "prov-session-old"},
            )
            self.assertEqual(selection["selected_path"], PATH_CHECKPOINT)
            self.assertEqual(selection["session_continuity_claim"], CLAIM_NEW_GENERATION)
            self.assertIsNone(selection["handle"]["provider_session_id"])
            self.assertEqual(selection["handle"]["generation"], 2)
            self.assertEqual(selection["handle"]["predecessor_handle_id"], predecessor["handle_id"])
            for field in ("provider_profile_id", "account_profile_id", "provider_id", "model", "transport_id"):
                self.assertEqual(selection["handle"][field], predecessor[field])

            plan = logical_replay_plan(store=controller.store, command_ledger=controller.command_ledger,
                                       operation_ledger=controller.operation_ledger)
            self.assertEqual(plan["completed_command_ids"], ["cmd-done"])
            self.assertEqual(plan["replay_command_ids"], [])
            self.assertEqual(provider.external_effects, 1)

    # -- D-08 ------------------------------------------------------------
    def test_D08_tech_lead_checkpoint_fallback_restores_complete_state(self):
        state = normalize_tech_lead_execution_state(tech_lead_state())
        checkpoint = create_tech_lead_checkpoint(
            checkpoint_id="ckpt-tl-1", execution_state=state, registry_digest=SHA_REGISTRY,
            policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
        )
        with tempfile.TemporaryDirectory() as td:
            path = write_checkpoint(Path(td) / "tl.json", checkpoint)
            loaded = load_checkpoint(path, expected_identity={"run_id": "run-slice2", "task_id": "task-1"})
            restored = restore_tech_lead_execution_state(loaded)

        self.assertEqual(restored["state_digest"], state["state_digest"])
        self.assertEqual(len(restored["task_graph"]), 3)
        self.assertEqual(restored["ownership"]["files"], ["packages/x/src/a.ts", "packages/x/src/b.ts"])
        self.assertEqual(restored["ownership"]["workers"][0]["worker_id"], "w-1")
        self.assertEqual(restored["ownership"]["worktrees"][0]["worktree_id"], "wt-1")
        self.assertEqual({e["kind"] for e in restored["evidence_refs"]},
                         {"commit", "diff", "test_run", "review", "integration"})
        self.assertEqual(restored["decisions"], state["decisions"])
        self.assertEqual(restored["risks"], state["risks"])
        self.assertEqual(restored["dependencies"], state["dependencies"])
        self.assertEqual(restored["delegation_revision"], "deleg-3")
        self.assertEqual(restored["charter_revision"], "charter-2")
        self.assertEqual(restored["cursors"]["command_cursor"]["count"], 3)
        self.assertEqual(restored["last_committed_state_version"], 9)

        plan = tech_lead_replay_plan(restored)
        self.assertEqual(plan["completed_task_ids"], ["t-a", "t-b"])
        self.assertEqual(plan["reconcile_task_ids"], ["t-c"])
        self.assertEqual(plan["replay_task_ids"], [], "completed phases must never be replayed")

    # -- D-09 ------------------------------------------------------------
    def test_D09_disposable_qualified_native_resume_fixture(self):
        """A disposable fixture only; it qualifies no real provider capability."""

        policy = load_policy(POLICY)
        registry = copy.deepcopy({k: v for k, v in policy["_registry"].items() if not str(k).startswith("_")})

        # Disposable, in-memory-only provider/profile/account/transport.
        registry["providers"]["fixture_disposable"] = {
            "runtime_provider": "fixture_runtime", "usage_mode": "UNAVAILABLE", "native_usage_parser": None,
        }
        registry["accounts"]["fixture-account"] = {
            "provider_id": "fixture_disposable",
            "capacity_source": {"kind": "provider_health_manual_hint"}, "percentage_meter": False,
        }
        registry["transports"]["fixture-transport"] = {
            "adapter_id": "slice2-deterministic-fake", "endpoint_policy_key": "main_cao_api",
            "include_model": True, "requires_herdr_preflight": False,
        }
        registry["profiles"]["fixture-supervisor"] = {
            "profile_id": "fixture-supervisor", "role_id": "supervisor", "provider_id": "fixture_disposable",
            "account_profile_id": "fixture-account", "transport_id": "fixture-transport",
            "model": "fixture-model", "frontmatter": "name: fixture-supervisor",
            "body": "authoritative-supervisor.md", "declared_capabilities": ["native_resume"], "gateway": False,
        }
        registry["capability_declarations"].append({
            "schema_version": "1.0", "declaration_id": "decl-fixture-native-resume",
            "provider_profile_id": "fixture-supervisor", "capability": "native_resume", "maturity": "DECLARED",
        })
        registry["_registry_digest"] = registry_digest(registry)
        validate_registry({k: v for k, v in registry.items() if not str(k).startswith("_")})

        fixture_policy = copy.deepcopy({k: v for k, v in policy.items() if not str(k).startswith("_")})
        fixture_policy["capability_activation"]["native_resume"]["enabled"] = True
        fixture_policy["continuity"]["provider_capabilities"]["fixture_disposable"] = {
            "LIVE_PROCESS_REATTACH": {"adapter": None, "enabled": False, "reason": "fixture", "release_required": False},
            PATH_NATIVE: {"adapter": "fixture_native_resume", "enabled": True,
                          "reason": "disposable Gate D-09 fixture only", "release_required": False},
        }
        qualification = make_qualification(
            registry, profile_id="fixture-supervisor", capability="native_resume",
            evidence_sha256="9" * 64, qualified_at=iso_now(), qualification_id="qual-fixture-native-resume",
        )
        capability = {**qualification, "enabled": True, "policy_enabled": True, "qualification_valid": True}

        predecessor = base_handle(
            handle_id="ch-fixture-1", role_id="authoritative_supervisor",
            provider_profile_id="fixture-supervisor", account_profile_id="fixture-account",
            provider_id="fixture_disposable", model="fixture-model", transport_id="fixture-transport",
            provider_conversation_id="fixture-conv-1", provider_session_id="fixture-session-1",
            terminal_id="fixture-terminal-1",
        )

        exact_handshake = {
            "provider_id": "fixture_disposable", "provider_profile_id": "fixture-supervisor",
            "account_profile_id": "fixture-account", "model": "fixture-model",
            "transport_id": "fixture-transport", "provider_conversation_id": "fixture-conv-1",
            "provider_session_id": "fixture-session-1", "terminal_id": "fixture-terminal-1",
        }
        resumed = build_successor_after_loss(
            predecessor_handle=predecessor, handle_id="ch-fixture-2", policy=fixture_policy,
            native_session_evidence=exact_handshake, native_capability=capability,
        )
        self.assertEqual(resumed["selected_path"], PATH_NATIVE)
        self.assertEqual(resumed["session_continuity_claim"], CLAIM_NATIVE_SESSION_RESUME)
        self.assertTrue(resumed["native_handshake_exact"])
        self.assertFalse(resumed["provider_resubmission_required"])

        provider = CountingProvider()
        for field in ("provider_session_id", "model", "transport_id", "provider_profile_id"):
            with self.subTest(mismatch=field):
                bad = dict(exact_handshake)
                bad[field] = "drifted"
                fallback = build_successor_after_loss(
                    predecessor_handle=predecessor, handle_id=f"ch-fixture-mismatch-{field}",
                    policy=fixture_policy, native_session_evidence=bad, native_capability=capability,
                )
                self.assertEqual(fallback["selected_path"], PATH_CHECKPOINT)
                self.assertEqual(fallback["session_continuity_claim"], CLAIM_NEW_GENERATION)
                self.assertIn("handshake mismatch", fallback["native_handshake_reason"])
                self.assertFalse(fallback["provider_resubmission_required"])
        self.assertEqual(provider.submit_count, 0)

        # The fixture never leaks into tracked policy or the real registry.
        tracked = load_policy(POLICY)
        self.assertFalse(tracked["capability_activation"]["native_resume"]["enabled"])
        self.assertTrue(all(not cfg[PATH_NATIVE]["enabled"]
                            for cfg in tracked["continuity"]["provider_capabilities"].values()))
        self.assertNotIn("fixture_disposable", tracked["continuity"]["provider_capabilities"])
        self.assertNotIn("fixture-supervisor", tracked["_registry"]["profiles"])
        self.assertNotIn("fixture_disposable", tracked["_registry"]["providers"])

    # -- D-10 ------------------------------------------------------------
    def test_D10_checkpoint_path_is_fully_correct_when_native_resume_is_unavailable(self):
        policy = load_policy(POLICY)
        predecessor = base_handle(role_id="authoritative_supervisor",
                                  provider_id="claude_code", provider_session_id="sess-1",
                                  provider_conversation_id="conv-1")
        for evidence in (None, {"provider_session_id": "sess-1", "provider_id": "claude_code"}):
            with self.subTest(evidence=bool(evidence)):
                selection = build_successor_after_loss(
                    predecessor_handle=predecessor, handle_id="ch-d10", policy=policy,
                    native_session_evidence=evidence, native_capability=None,
                )
                self.assertEqual(selection["selected_path"], PATH_CHECKPOINT)
                self.assertFalse(selection["native_resume_capability_effective"])
                self.assertEqual(selection["session_continuity_claim"], CLAIM_NEW_GENERATION)

        state = normalize_tech_lead_execution_state(tech_lead_state())
        checkpoint = create_tech_lead_checkpoint(
            checkpoint_id="ckpt-d10", execution_state=state, registry_digest=SHA_REGISTRY,
            policy_digest=SHA_POLICY, contract_bundle_digest=SHA_SCHEMAS,
        )
        restored = restore_tech_lead_execution_state(
            checkpoint,
            expected_identity={"run_id": "run-slice2", "task_id": "task-1",
                               "registry_digest": SHA_REGISTRY, "policy_digest": SHA_POLICY},
            available_cursors={"state_version": 9, "command_cursor": {"count": 3, "last_id": "cmd-3"},
                               "operation_cursor": {"count": 1, "last_id": "op-1"}},
        )
        self.assertEqual(restored["state_digest"], state["state_digest"])
        self.assertEqual(tech_lead_replay_plan(restored)["replay_task_ids"], [])

    def test_durable_cursors_report_actual_replay_availability(self):
        with tempfile.TemporaryDirectory() as td:
            controller = Controller(td)
            controller.initialize()
            provider = CountingProvider()
            envelope, request = command_envelope(command_id="cmd-cursor", lease=controller.lease)
            controller.coordinator.dispatch(envelope=envelope, request=request, adapter=provider,
                                            capabilities=LOOKUP_CAPABILITIES)
            cursors = durable_cursors(store=controller.store, command_ledger=controller.command_ledger,
                                      operation_ledger=controller.operation_ledger)
            self.assertEqual(cursors["command_cursor"]["count"], 1)
            self.assertTrue(cursors["command_cursor"]["available"])
            self.assertFalse(cursors["event_cursor"]["available"],
                             "Slice 2 does not claim an event cursor it does not have")


def _plus_minutes(iso: str, minutes: int) -> str:
    import datetime as dt

    from mlgo_cao_v2.common import parse_iso

    return (parse_iso(iso) + dt.timedelta(minutes=minutes)).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    unittest.main()
