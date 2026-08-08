from __future__ import annotations

import copy
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.build_provenance import create_build_manifest, verify_build_manifest, verify_installed_projections
from mlgo_cao_v2.commands import CommandLedger, new_command_envelope
from mlgo_cao_v2.leases import ExecutorLeaseStore
from mlgo_cao_v2.common import ContractError, PolicyError, iso_now, load_json, sha256_file, sha256_json
from mlgo_cao_v2.contract_binding import (
    assert_reader_compatible,
    create_run_contract_binding,
    schema_bundle,
)
from mlgo_cao_v2.policy import load_policy
from mlgo_cao_v2.registry import (
    capability_identity,
    compatibility_policy_routes,
    compatibility_profile_specs,
    compatibility_supervisor_profiles,
    effective_capability,
    load_registry,
    make_qualification,
    registry_digest,
    validate_registry,
)
from mlgo_cao_v2.state_machine import RunStore
from mlgo_cao_v2.transport import AdapterFactory, ObservationState, ReconcileResult, SubmitCertainty, SubmitResult, adapter_for_route

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "config" / "cao-policy.json"
REGISTRY = ROOT / "registry" / "provider-registry.json"
SCHEMAS = ROOT / "schemas"


class FakeTransport:
    adapter_id = "fake-deterministic"
    def submit(self, command, request):
        return SubmitResult(SubmitCertainty.ACCEPTED, receipt_id="fake-receipt", response={"ok": True})
    def observe(self, command, receipt_id):
        return ReconcileResult(ObservationState.COMPLETED, receipt_id=receipt_id, result={"ok": True}, exact=True)
    def reconcile(self, command):
        return self.observe(command, command.get("receipt_id"))
    def cancel(self, command, receipt_id):
        return ReconcileResult(ObservationState.CANCELLED, receipt_id=receipt_id, exact=True)
    def cleanup(self, command, receipt_id):
        return {"status": "CLEANED"}


def policy_and_registry():
    policy = load_policy(POLICY)
    return policy, policy["_registry"]


def binding_for(registry_sha="a" * 64, policy_sha="b" * 64, schema_sha="c" * 64, build_sha="d" * 64):
    schema_record = {"files": [{"name": "command.schema.json", "sha256": schema_sha}], "digest": sha256_json([{"name": "command.schema.json", "sha256": schema_sha}])}
    return create_run_contract_binding(
        runtime_version="0.3.0-slice1-vnext", build_id="build-slice1-test",
        build_manifest_sha256=build_sha, registry_digest=registry_sha,
        policy_digest=policy_sha, schema_bundle_record=schema_record,
        enabled_writers=["run_state", "commands"], minimum_reader_version="0.3.0",
        minimum_writer_version="0.3.0", compatible_writer_ids=["slice1-controller"],
    )


def writer_for(binding, *, writer_id="slice1-controller", version="0.3.0"):
    return {
        "writer_id": writer_id, "writer_version": version,
        "registry_digest": binding["registry_digest"], "policy_digest": binding["policy_digest"],
        "schema_bundle_digest": binding["schema_bundle_digest"],
        "build_manifest_sha256": binding["build_manifest_sha256"],
        "writer_features": ["run_state"],
    }


class Slice1GateATests(unittest.TestCase):
    def test_A01_canonical_registry_projects_current_policy_and_profiles(self):
        policy, registry = policy_and_registry()
        self.assertEqual(policy["routes"], compatibility_policy_routes(registry))
        specs = load_json(ROOT / "profile-sources" / "profile-specs.json")
        self.assertEqual(specs, compatibility_profile_specs(registry))
        self.assertEqual(policy["_registry_digest"], registry_digest(registry))
        proc = subprocess.run(
            ["python3", str(ROOT / "registry" / "generate_registry_projections.py"), "--check"],
            cwd=ROOT, capture_output=True, text=True,
        )
        self.assertEqual(proc.returncode, 0, proc.stderr)
        launcher = (ROOT / "legacy-replacements" / "mlgo-supervise").read_text(encoding="utf-8")
        self.assertIn("provider-registry.json", launcher)
        for profile_name in compatibility_supervisor_profiles(registry):
            self.assertNotIn(profile_name, launcher, f"launcher must not carry an independent supervisor-profile list: {profile_name}")

    def test_A02_fake_provider_is_registry_plus_adapter_only(self):
        _, base = policy_and_registry()
        registry = copy.deepcopy({k: v for k, v in base.items() if not str(k).startswith("_")})
        registry["providers"]["fake"] = {"runtime_provider": "fake_runtime", "usage_mode": "UNAVAILABLE", "native_usage_parser": None}
        registry["accounts"]["fake-account"] = {"provider_id": "fake", "capacity_source": {"kind": "provider_health_manual_hint"}, "percentage_meter": False}
        registry["transports"]["fake-transport"] = {"adapter_id": "fake-deterministic", "endpoint_policy_key": "main_cao_api", "include_model": True, "requires_herdr_preflight": False}
        registry["profiles"]["fake-builder"] = {
            "profile_id": "fake-builder", "role_id": "builder", "provider_id": "fake",
            "account_profile_id": "fake-account", "transport_id": "fake-transport", "model": "fake-model",
            "frontmatter": "name: fake-builder", "body": "bounded-phase-builder.md",
            "declared_capabilities": ["execution_agent", "structured_result"], "gateway": False,
        }
        registry["routes"]["fake-route"] = {
            "route_id": "fake-route", "execution_profile_id": "fake-builder", "provider_id": "fake",
            "account_pool": "fake-account", "transport_id": "fake-transport", "model": "fake-model", "capability_floor": 1,
            "cost_rank": 1, "quality_rank": 1,
        }
        registry["capability_declarations"].extend([
            {"schema_version": "1.0", "declaration_id": "decl-fake-builder-execution_agent", "provider_profile_id": "fake-builder", "capability": "execution_agent", "maturity": "DECLARED"},
            {"schema_version": "1.0", "declaration_id": "decl-fake-builder-structured_result", "provider_profile_id": "fake-builder", "capability": "structured_result", "maturity": "DECLARED"},
        ])
        validate_registry(registry)
        factory = AdapterFactory()
        factory.register("fake-deterministic", lambda transport, policy: FakeTransport())
        adapter = adapter_for_route(registry, registry["routes"]["fake-route"], {"main_cao_api": "unused"}, factory=factory)
        result = adapter.submit({"command_id": "cmd-fake"}, {"payload": "x"})
        self.assertEqual(result.certainty, SubmitCertainty.ACCEPTED)
        self.assertEqual(registry["profiles"]["fake-builder"]["role_id"], "builder")

    def test_A03_declared_capability_is_not_qualified(self):
        policy, registry = policy_and_registry()
        out = effective_capability(registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume", policy=policy)
        self.assertFalse(out["enabled"])
        self.assertEqual(out["maturity"], "DECLARED")

    def test_A04_observed_is_insufficient_when_qualified_required(self):
        policy, registry = policy_and_registry()
        policy = copy.deepcopy(policy)
        policy["capability_activation"]["native_resume"]["enabled"] = True
        identity = capability_identity(registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume")
        observed = {
            "schema_version": "1.0", "qualification_id": "obs-native-resume", "provider_profile_id": "mlgo-claude-subscription-supervisor",
            "capability": "native_resume", "maturity": "OBSERVED", "identity": identity,
            "identity_digest": identity["identity_digest"], "evidence_sha256": "a" * 64, "qualified_at": iso_now(),
        }
        out = effective_capability(registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume", policy=policy, qualification=observed)
        self.assertFalse(out["enabled"])
        self.assertEqual(out["maturity"], "OBSERVED")

    def test_A05_qualified_but_policy_disabled_is_not_effective(self):
        policy, registry = policy_and_registry()
        qual = make_qualification(registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume", evidence_sha256="b" * 64, qualified_at=iso_now(), qualification_id="qual-native-resume")
        out = effective_capability(registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume", policy=policy, qualification=qual)
        self.assertTrue(out["qualification_valid"])
        self.assertFalse(out["policy_enabled"])
        self.assertFalse(out["enabled"])

    def test_A06_qualification_invalidates_on_identity_drift(self):
        policy, registry = policy_and_registry()
        qual = make_qualification(registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume", evidence_sha256="c" * 64, qualified_at=iso_now(), qualification_id="qual-drift")
        drifted = copy.deepcopy(registry)
        drifted["profiles"]["mlgo-claude-subscription-supervisor"]["model"] = "different-model"
        drifted["_registry_digest"] = registry_digest(drifted)
        policy2 = copy.deepcopy(policy)
        policy2["capability_activation"]["native_resume"]["enabled"] = True
        out = effective_capability(drifted, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume", policy=policy2, qualification=qual)
        self.assertFalse(out["qualification_valid"])
        self.assertFalse(out["enabled"])
        self.assertIn("stale", out["reason"])

    def test_A07_build_manifest_maps_tracked_source_and_projection(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "slice1@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Slice1 Test"], check=True)
            (root / "registry.json").write_text('{"registry":"v1"}\n')
            (root / "projection.json").write_text('{"projection":"v1"}\n')
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)
            sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
            manifest = create_build_manifest(source_root=root, source_commit=sha, runtime_version="0.3.0-slice1-vnext", registry_path=root / "registry.json", projection_paths=[root / "projection.json"], build_id="build-a07", install_projection_map={"registry.json":"stage/registry.json","projection.json":"stage/projection.json"})
            verify_build_manifest(manifest, source_root=root)
            install = root / "install"
            (install / "stage").mkdir(parents=True)
            (install / "stage" / "registry.json").write_bytes((root / "registry.json").read_bytes())
            (install / "stage" / "projection.json").write_bytes((root / "projection.json").read_bytes())
            verify_installed_projections(manifest, install_root=install)
            self.assertEqual(manifest["source_commit"], sha)
            self.assertEqual(manifest["registry_sha256"], sha256_file(root / "registry.json"))

    def test_A08_build_manifest_detects_projection_tamper(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "slice1@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Slice1 Test"], check=True)
            (root / "registry.json").write_text('{"registry":"v1"}\n')
            (root / "projection.json").write_text('{"projection":"v1"}\n')
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)
            sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
            manifest = create_build_manifest(source_root=root, source_commit=sha, runtime_version="0.3.0-slice1-vnext", registry_path=root / "registry.json", projection_paths=[root / "projection.json"], build_id="build-a08", install_projection_map={"projection.json":"stage/projection.json"})
            install = root / "install" / "stage"
            install.mkdir(parents=True)
            (install / "projection.json").write_bytes((root / "projection.json").read_bytes())
            (root / "projection.json").write_text('{"projection":"tampered"}\n')
            with self.assertRaises(ContractError):
                verify_build_manifest(manifest, source_root=root)
            (root / "projection.json").write_text('{"projection":"v1"}\n')
            untracked = root / "untracked-runtime.py"
            untracked.write_text("unreviewed\n")
            with self.assertRaises(ContractError):
                verify_build_manifest(manifest, source_root=root)
            untracked.unlink()
            (install / "projection.json").write_text('{"projection":"tampered-install"}\n')
            with self.assertRaises(ContractError):
                verify_installed_projections(manifest, install_root=root / "install")

    def test_A09_vnext_run_records_exact_contract_binding(self):
        binding = binding_for()
        writer = writer_for(binding)
        with tempfile.TemporaryDirectory() as td:
            from mlgo_cao_v2.leases import ExecutorLeaseStore
            lease_store = ExecutorLeaseStore(Path(td) / "runs" / "run-a09" / "v2")
            lease = lease_store.acquire("slice1-controller")
            writer["executor_lease"] = lease
            store = RunStore(td, "run-a09", writer_context=writer, lease_store=lease_store)
            state = store.initialize(mode="v2_shadow", supervisor_profile="mlgo-claude-subscription-supervisor", supervisor_account_pool="claude-subscription", run_contract_binding=binding)
            self.assertTrue(state["vnext_writers_enabled"])
            self.assertEqual(state["run_contract_binding"]["binding_digest"], binding["binding_digest"])
            self.assertEqual(state["run_contract_binding"]["enabled_writers"], ["commands", "run_state"])

    def test_A10_incompatible_writer_and_reader_fail_before_mutation(self):
        binding = binding_for()
        bad = writer_for(binding, writer_id="old-writer")
        with tempfile.TemporaryDirectory() as td:
            from mlgo_cao_v2.leases import ExecutorLeaseStore
            lease_store = ExecutorLeaseStore(Path(td) / "runs" / "run-a10" / "v2")
            bad["executor_lease"] = lease_store.acquire("old-writer")
            store = RunStore(td, "run-a10", writer_context=bad, lease_store=lease_store)
            with self.assertRaises(PolicyError):
                store.initialize(mode="v2_shadow", supervisor_profile="mlgo-claude-subscription-supervisor", supervisor_account_pool="claude-subscription", run_contract_binding=binding)
            self.assertFalse(store.journal_path.exists())
        with self.assertRaises(PolicyError):
            assert_reader_compatible(binding, reader_version="0.2.9")

    def test_slice1_records_conform_to_versioned_schemas(self):
        try:
            from jsonschema import Draft202012Validator
        except ImportError as exc:  # source verification requires this invariant when available
            self.skipTest(f"jsonschema unavailable: {exc}")

        def validate(schema_name, value):
            schema = load_json(SCHEMAS / schema_name)
            errors = list(Draft202012Validator(schema).iter_errors(value))
            self.assertFalse(errors, f"{schema_name}: {errors[0].message if errors else ''}")

        _, registry = policy_and_registry()
        validate("provider-registry.schema.json", {k: v for k, v in registry.items() if not str(k).startswith("_")})
        for name, item in registry["profiles"].items():
            validate("provider-profile.schema.json", {"schema_version": "1.0", "profile_id": name, **item})
        for name, item in registry["accounts"].items():
            validate("account-profile.schema.json", {"schema_version": "1.0", "account_profile_id": name, **item})
        for item in registry["capability_declarations"]:
            validate("capability-declaration.schema.json", item)
        qualification = make_qualification(
            registry, profile_id="mlgo-claude-subscription-supervisor", capability="native_resume",
            evidence_sha256="f" * 64, qualified_at=iso_now(), qualification_id="qual-schema-test",
        )
        validate("capability-qualification.schema.json", qualification)
        with tempfile.TemporaryDirectory() as td:
            lease_store = ExecutorLeaseStore(Path(td) / "v2")
            lease = lease_store.acquire("slice1-controller")
            validate("executor-lease.schema.json", lease)
            request = {"payload": "schema-test"}
            envelope = new_command_envelope(
                command_id="cmd-schema-test", run_id="run-schema-test", task_id="task-schema-test",
                phase_id="phase-schema-test", attempt_id="attempt-1", command_type="provider.submit",
                request=request, expected_pre_state={"state_version": 1}, registry_digest="a" * 64,
                policy_digest="b" * 64, runtime_version="0.3.0-slice1-vnext",
                build_manifest_sha256="c" * 64, provider_profile_id="mlgo-claude-subscription-builder",
                provider_id="claude_code", account_profile_id="claude-subscription",
                transport_id="cao-main", model="sonnet", executor_lease=lease,
            )
            validate("command.schema.json", envelope)
            outcome = CommandLedger(Path(td) / "v2").prepare(envelope)
            validate("command-outcome.schema.json", outcome)
            files = [{"name": "command.schema.json", "sha256": "d" * 64}]
            binding = create_run_contract_binding(
                runtime_version="0.3.0-slice1-vnext", build_id="build-schema-test",
                build_manifest_sha256="c" * 64, registry_digest="a" * 64, policy_digest="b" * 64,
                schema_bundle_record={"files": files, "digest": sha256_json(files)},
                enabled_writers=["commands", "run_state"], minimum_reader_version="0.3.0",
                minimum_writer_version="0.3.0", compatible_writer_ids=["slice1-controller"],
            )
            validate("run-contract-binding.schema.json", binding)
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            subprocess.run(["git", "init", "-q", str(root)], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.email", "slice1@example.invalid"], check=True)
            subprocess.run(["git", "-C", str(root), "config", "user.name", "Slice1 Test"], check=True)
            (root / "registry.json").write_text('{"registry":"v1"}\n')
            subprocess.run(["git", "-C", str(root), "add", "."], check=True)
            subprocess.run(["git", "-C", str(root), "commit", "-qm", "fixture"], check=True)
            sha = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
            manifest = create_build_manifest(
                source_root=root, source_commit=sha, runtime_version="0.3.0-slice1-vnext",
                registry_path=root / "registry.json", projection_paths=[], build_id="build-schema-test",
            )
            validate("build-release-manifest.schema.json", manifest)

    def test_current_hardening_posture_is_unchanged(self):
        policy, registry = policy_and_registry()
        self.assertEqual(policy["orchestration"]["default_mode"], "v2_shadow")
        self.assertEqual(policy["usage"]["enforcement_mode"], "warning_only")
        self.assertEqual(policy["validation_evidence"]["reuse_mode"], "disabled")
        self.assertTrue(all(not cfg["NATIVE_PROVIDER_SESSION_RESUME"]["enabled"] for cfg in policy["continuity"]["provider_capabilities"].values()))
        self.assertNotEqual(registry["profiles"]["mlgo-claude-subscription-supervisor"]["role_id"], registry["profiles"]["mlgo-claude-subscription-supervisor"]["provider_id"])


if __name__ == "__main__":
    unittest.main()
