from __future__ import annotations

import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest import mock

from _wb0_test_support import (
    FakeSystemctl,
    RELEASE_ID,
    SKILL_BYTES,
    SKILL_MIRROR_NAME,
    make_capsule,
    make_instance,
    safe_resource_report,
)
from mlgo_cao_v2.wb0_common import WB0SafetyError, sha256_bytes, sha256_json
from mlgo_cao_v2.wb0_recovery import (
    apply_recovery,
    build_recovery_plan,
    inspect_recovery_transaction,
    start_controller_after_recovery,
)


class RecoveryTest(unittest.TestCase):
    def test_environment_file_path_uses_systemd_path_escaping_not_quotes(self):
        with tempfile.TemporaryDirectory(prefix="wb0 path ") as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            result = apply_recovery(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-systemd-path",
                mode="fresh_host",
                golden_generation_id="golden-systemd-path",
                writable_generation_id="work-systemd-path",
                config_generation_id="config-systemd-path",
                state_schema_version="2.1",
                command_runner=FakeSystemctl(),
            )
            self.assertEqual(result["status"], "COMMITTED")
            unit = (
                Path(instance["host_adapter"]["systemd_user_unit_root"])
                / instance["host_adapter"]["controller_unit"]
            ).read_text()
            expected = str(
                Path(instance["roots"]["config_root"])
                / "current/payload/instance.env"
            ).replace(" ", r"\x20")
            self.assertIn(f"EnvironmentFile={expected}\n", unit)
            self.assertNotIn('EnvironmentFile="', unit)

    def test_instance_recovery_lock_serializes_distinct_transactions(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            instance = make_instance(root)
            active = 0
            maximum = 0
            guard = threading.Lock()

            def fake_apply(**kwargs):
                nonlocal active, maximum
                with guard:
                    active += 1
                    maximum = max(maximum, active)
                time.sleep(0.08)
                with guard:
                    active -= 1
                return {"status": "COMMITTED", "transaction_id": kwargs["transaction_id"]}

            errors = []

            def invoke(transaction_id: str) -> None:
                try:
                    apply_recovery(
                        instance=instance,
                        capsule_root=root / "unused-capsule",
                        transaction_id=transaction_id,
                        mode="fresh_host",
                        golden_generation_id=f"golden-{transaction_id}",
                        writable_generation_id=f"work-{transaction_id}",
                        config_generation_id=f"config-{transaction_id}",
                        state_schema_version="2.1",
                    )
                except Exception as exc:  # pragma: no cover - surfaced below
                    errors.append(exc)

            with mock.patch(
                "mlgo_cao_v2.wb0_recovery._apply_recovery_with_instance_lock_held",
                side_effect=fake_apply,
            ):
                threads = [
                    threading.Thread(target=invoke, args=("tx-lock-a",)),
                    threading.Thread(target=invoke, args=("tx-lock-b",)),
                ]
                for thread in threads:
                    thread.start()
                for thread in threads:
                    thread.join()
            self.assertEqual(errors, [])
            self.assertEqual(maximum, 1)

    def test_interrupted_recovery_is_rerunnable_and_provider_free(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            kwargs = dict(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-recovery-1",
                mode="same_host",
                golden_generation_id="golden-post-slice4",
                writable_generation_id="recovered-0001",
                config_generation_id="config-0001",
                state_schema_version="2.1",
                resource_report=safe_resource_report(),
                command_runner=runner,
            )
            with self.assertRaises(RuntimeError):
                apply_recovery(**kwargs, fault_after="RELEASE_POINTER_SWITCHED")
            interrupted = inspect_recovery_transaction(instance=instance, transaction_id="tx-recovery-1")
            self.assertTrue(interrupted["rerunnable"])
            result = apply_recovery(**kwargs)
            self.assertEqual(result["status"], "COMMITTED")
            self.assertEqual(result["provider_calls"], 0)
            self.assertFalse(result["production_enforcement"])
            self.assertEqual(
                (Path(instance["roots"]["release_root"]) / "current").readlink().as_posix(),
                f"releases/{RELEASE_ID}",
            )
            self.assertTrue((Path(instance["host_adapter"]["bin_root"]) / "mlgo-v2").is_symlink())

    def test_committed_rerun_preserves_legitimate_writable_state_progress_byte_for_byte(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            kwargs = dict(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-progress-preserved",
                mode="same_host",
                golden_generation_id="golden-progress",
                writable_generation_id="work-progress",
                config_generation_id="config-progress",
                state_schema_version="2.1",
                command_runner=runner,
            )
            first = apply_recovery(**kwargs, resource_report=safe_resource_report())
            self.assertEqual(first["status"], "COMMITTED")
            live = Path(instance["roots"]["state_root"]) / "generations/work-progress/payload/runs/example/v2/state.json"
            live.write_bytes(b'{"schema_version":"2.1","phase":"advanced","checkpoint":42}\n')
            before = live.read_bytes()
            second = apply_recovery(**kwargs, resource_report=safe_resource_report())
            self.assertEqual(second["status"], "COMMITTED")
            self.assertEqual(live.read_bytes(), before)
            quarantine = Path(instance["roots"]["state_root"]) / "quarantine"
            quarantined = [] if not quarantine.exists() else [p.name for p in quarantine.iterdir()]
            self.assertFalse(any(name.startswith("work-progress--") for name in quarantined))

    def test_committed_rerun_repairs_state_pointer_without_refreezing_evolved_payload(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            kwargs = dict(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-pointer-progress",
                mode="same_host",
                golden_generation_id="golden-pointer-progress",
                writable_generation_id="work-pointer-progress",
                config_generation_id="config-pointer-progress",
                state_schema_version="2.1",
                command_runner=runner,
            )
            first = apply_recovery(**kwargs, resource_report=safe_resource_report())
            self.assertEqual(first["status"], "COMMITTED")
            state_root = Path(instance["roots"]["state_root"])
            live = state_root / "generations/work-pointer-progress/payload/runs/example/v2/state.json"
            evolved = b'{"schema_version":"2.1","phase":"advanced","checkpoint":42}\n'
            live.write_bytes(evolved)
            current = state_root / "current"
            current.unlink()
            current.symlink_to("../escaping-target")

            second = apply_recovery(**kwargs, resource_report=safe_resource_report())

            self.assertEqual(second["status"], "COMMITTED")
            self.assertEqual(live.read_bytes(), evolved)
            self.assertEqual(
                current.readlink().as_posix(),
                "generations/work-pointer-progress/payload",
            )

    def test_transaction_id_binds_state_schema_before_any_replay_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            kwargs = dict(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-schema-bound",
                mode="same_host",
                golden_generation_id="golden-schema-bound",
                writable_generation_id="work-schema-bound",
                config_generation_id="config-schema-bound",
                command_runner=runner,
            )
            first = apply_recovery(
                **kwargs, state_schema_version="2.1", resource_report=safe_resource_report()
            )
            self.assertEqual(first["status"], "COMMITTED")
            command_count = len(runner.commands)
            with self.assertRaises(WB0SafetyError):
                apply_recovery(
                    **kwargs,
                    state_schema_version="9.9",
                    resource_report=safe_resource_report(),
                )
            self.assertEqual(len(runner.commands), command_count)
            golden_meta = Path(instance["roots"]["state_root"]) / "generations/golden-schema-bound/generation.json"
            self.assertIn('"version": "2.1"', golden_meta.read_text())

    def test_late_interruption_never_starts_controller_before_commit(self):
        late_steps = (
            "STATE_POINTER_SWITCHED",
            "CONFIG_POINTER_SWITCHED",
            "RELEASE_POINTER_SWITCHED",
            "HOST_PROJECTIONS_INSTALLED",
            "SAFE_POSTURE_VERIFIED",
            "COMMITTED",
        )
        for fault in late_steps:
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                capsule = make_capsule(root)
                instance = make_instance(root)
                runner = FakeSystemctl()
                with self.assertRaises(RuntimeError):
                    apply_recovery(
                        instance=instance,
                        capsule_root=capsule,
                        transaction_id=f"tx-late-{fault.lower()}",
                        mode="same_host",
                        golden_generation_id=f"golden-{fault.lower()}",
                        writable_generation_id=f"work-{fault.lower()}",
                        config_generation_id=f"config-{fault.lower()}",
                        state_schema_version="2.1",
                        resource_report=safe_resource_report(),
                        fault_after=fault,
                        command_runner=runner,
                    )
                flattened = [item for command in runner.commands for item in command]
                self.assertNotIn("start", flattened)
                inspected = inspect_recovery_transaction(
                    instance=instance, transaction_id=f"tx-late-{fault.lower()}"
                )
                self.assertNotEqual(inspected["transaction"]["status"], "COMMITTED")

    def test_controller_start_is_separate_and_requires_committed_transaction(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            tx = "tx-explicit-start"
            with self.assertRaises(RuntimeError):
                apply_recovery(
                    instance=instance,
                    capsule_root=capsule,
                    transaction_id=tx,
                    mode="same_host",
                    golden_generation_id="golden-explicit-start",
                    writable_generation_id="work-explicit-start",
                    config_generation_id="config-explicit-start",
                    state_schema_version="2.1",
                    resource_report=safe_resource_report(),
                    fault_after="SAFE_POSTURE_VERIFIED",
                    command_runner=runner,
                )
            with self.assertRaises(WB0SafetyError):
                start_controller_after_recovery(
                    instance=instance,
                    transaction_id=tx,
                    start_id="start-before-commit",
                    command_runner=runner,
                )
            self.assertNotIn("start", [item for command in runner.commands for item in command])
            committed = apply_recovery(
                instance=instance,
                capsule_root=capsule,
                transaction_id=tx,
                mode="same_host",
                golden_generation_id="golden-explicit-start",
                writable_generation_id="work-explicit-start",
                config_generation_id="config-explicit-start",
                state_schema_version="2.1",
                resource_report=safe_resource_report(),
                command_runner=runner,
            )
            self.assertEqual(committed["status"], "COMMITTED")
            started = start_controller_after_recovery(
                instance=instance,
                transaction_id=tx,
                start_id="start-after-commit",
                command_runner=runner,
            )
            self.assertEqual(started["status"], "STARTED")
            self.assertEqual(
                sum(1 for command in runner.commands if "start" in command), 1
            )

    def test_fresh_host_reconstruction_requires_no_provider_or_resource_probe(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            mirror_root = Path(instance["skill_bindings"]["native_mirror_root"])
            unrelated = mirror_root / "unrelated-local-skill/SKILL.md"
            unrelated.parent.mkdir(parents=True)
            unrelated.write_text("local unrelated bytes\n")
            prior_target = mirror_root / SKILL_MIRROR_NAME / "SKILL.md"
            prior_target.parent.mkdir(parents=True)
            prior_target.write_text("drifted mirror bytes\n")
            result = apply_recovery(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-fresh-host",
                mode="fresh_host",
                golden_generation_id="golden-fresh",
                writable_generation_id="work-fresh",
                config_generation_id="config-fresh",
                state_schema_version="2.1",
                command_runner=runner,
            )
            self.assertEqual(result["status"], "COMMITTED")
            self.assertEqual(result["provider_calls"], 0)
            self.assertNotIn("stop", [item for command in runner.commands for item in command])
            self.assertIn("daemon-reload", [item for command in runner.commands for item in command])
            self.assertEqual(prior_target.read_bytes(), SKILL_BYTES)
            self.assertEqual(unrelated.read_text(), "local unrelated bytes\n")
            digest = sha256_bytes(SKILL_BYTES)
            cache_root = Path(instance["skill_bindings"]["cache_root"]) / "skill-cache"
            self.assertEqual(
                (cache_root / "objects" / digest[:2] / digest).read_bytes(),
                SKILL_BYTES,
            )
            namespace = sha256_json(
                {
                    "project_id": instance["skill_bindings"]["project_id"],
                    "security_domain_id": instance["skill_bindings"]["security_domain_id"],
                }
            )
            self.assertTrue(
                (cache_root / "ns" / namespace / "bundle-demo-skill.json").is_file()
            )
            step = result["steps"]["SKILL_ASSETS_RESTORED"]["details"]
            self.assertEqual(step["mirror_source"], "sealed_content_addressed_objects")
            self.assertFalse(step["upstream_acquisition_performed"])

    def test_interrupted_fresh_host_transaction_can_rerun_without_pristine_recheck(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            kwargs = dict(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-fresh-rerun",
                mode="fresh_host",
                golden_generation_id="golden-fresh-rerun",
                writable_generation_id="work-fresh-rerun",
                config_generation_id="config-fresh-rerun",
                state_schema_version="2.1",
                command_runner=runner,
            )
            with self.assertRaises(RuntimeError):
                apply_recovery(**kwargs, fault_after="HOST_PROJECTIONS_INSTALLED")
            self.assertTrue((Path(instance["roots"]["release_root"]) / "current").is_symlink())
            self.assertTrue((Path(instance["host_adapter"]["bin_root"]) / "mlgo-v2").is_symlink())
            result = apply_recovery(**kwargs)
            self.assertEqual(result["status"], "COMMITTED")
            self.assertNotIn("stop", [item for command in runner.commands for item in command])

    def test_new_fresh_host_transaction_rejects_existing_recovered_instance_before_side_effects(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            first = apply_recovery(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-live-first",
                mode="same_host",
                golden_generation_id="golden-live",
                writable_generation_id="work-live-1",
                config_generation_id="config-live-1",
                state_schema_version="2.1",
                resource_report=safe_resource_report(),
                command_runner=runner,
            )
            self.assertEqual(first["status"], "COMMITTED")
            state_current = Path(instance["roots"]["state_root"]) / "current"
            config_current = Path(instance["roots"]["config_root"]) / "current"
            release_current = Path(instance["roots"]["release_root"]) / "current"
            before = (
                state_current.readlink().as_posix(),
                config_current.readlink().as_posix(),
                release_current.readlink().as_posix(),
            )
            command_count = len(runner.commands)
            with self.assertRaises(WB0SafetyError):
                apply_recovery(
                    instance=instance,
                    capsule_root=capsule,
                    transaction_id="tx-live-fresh-bypass",
                    mode="fresh_host",
                    golden_generation_id="golden-live-2",
                    writable_generation_id="work-live-2",
                    config_generation_id="config-live-2",
                    state_schema_version="2.1",
                    command_runner=runner,
                )
            self.assertEqual(len(runner.commands), command_count)
            self.assertEqual(
                before,
                (
                    state_current.readlink().as_posix(),
                    config_current.readlink().as_posix(),
                    release_current.readlink().as_posix(),
                ),
            )
            tx_path = Path(instance["roots"]["state_root"]) / "recovery/transactions/tx-live-fresh-bypass.json"
            self.assertFalse(tx_path.exists())

    def test_new_fresh_host_transaction_rejects_legacy_launcher_or_controller_projection(self):
        for surface in ("launcher", "controller"):
            with self.subTest(surface=surface), tempfile.TemporaryDirectory() as td:
                root = Path(td)
                capsule = make_capsule(root)
                instance = make_instance(root)
                runner = FakeSystemctl()
                if surface == "launcher":
                    path = Path(instance["host_adapter"]["bin_root"]) / "mlgo-v2"
                    path.parent.mkdir(parents=True)
                    path.write_text("#!/bin/sh\nexit 0\n")
                    path.chmod(0o755)
                else:
                    path = (
                        Path(instance["host_adapter"]["systemd_user_unit_root"])
                        / instance["host_adapter"]["controller_unit"]
                    )
                    path.parent.mkdir(parents=True)
                    path.write_text("[Service]\nExecStart=/legacy/mlgo-v2-controller\n")
                with self.assertRaises(WB0SafetyError):
                    apply_recovery(
                        instance=instance,
                        capsule_root=capsule,
                        transaction_id=f"tx-fresh-block-{surface}",
                        mode="fresh_host",
                        golden_generation_id=f"golden-fresh-block-{surface}",
                        writable_generation_id=f"work-fresh-block-{surface}",
                        config_generation_id=f"config-fresh-block-{surface}",
                        state_schema_version="2.1",
                        command_runner=runner,
                    )
                self.assertEqual(runner.commands, [])
                tx_path = (
                    Path(instance["roots"]["state_root"])
                    / "recovery/transactions"
                    / f"tx-fresh-block-{surface}.json"
                )
                self.assertFalse(tx_path.exists())

    def test_controller_start_requires_referenced_transaction_outputs_to_still_be_active(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            common = dict(
                instance=instance,
                capsule_root=capsule,
                mode="same_host",
                golden_generation_id="golden-active-start",
                state_schema_version="2.1",
                command_runner=runner,
            )
            tx1 = apply_recovery(
                **common,
                transaction_id="tx-active-start-1",
                writable_generation_id="work-active-start-1",
                config_generation_id="config-active-start-1",
                resource_report=safe_resource_report(),
            )
            self.assertEqual(tx1["status"], "COMMITTED")
            tx2 = apply_recovery(
                **common,
                transaction_id="tx-active-start-2",
                writable_generation_id="work-active-start-2",
                config_generation_id="config-active-start-2",
                resource_report=safe_resource_report(),
            )
            self.assertEqual(tx2["status"], "COMMITTED")
            start_count = sum(1 for command in runner.commands if "start" in command)
            with self.assertRaises(WB0SafetyError):
                start_controller_after_recovery(
                    instance=instance,
                    transaction_id="tx-active-start-1",
                    start_id="start-stale-tx1",
                    command_runner=runner,
                )
            self.assertEqual(
                sum(1 for command in runner.commands if "start" in command), start_count
            )
            started = start_controller_after_recovery(
                instance=instance,
                transaction_id="tx-active-start-2",
                start_id="start-current-tx2",
                command_runner=runner,
            )
            self.assertEqual(started["status"], "STARTED")
            self.assertEqual(started["active_outputs"]["state_pointer"], "generations/work-active-start-2/payload")
            self.assertEqual(
                sum(1 for command in runner.commands if "start" in command), start_count + 1
            )

    def test_recovery_plan_and_apply_share_exact_request_invariants(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            request = dict(
                instance=instance,
                capsule_root=capsule,
                mode="fresh_host",
                golden_generation_id="golden-plan-parity",
                writable_generation_id="work-plan-parity",
                config_generation_id="config-plan-parity",
                state_schema_version="2.1",
            )
            plan = build_recovery_plan(**request, resource_report=None)
            applied = apply_recovery(
                **request,
                transaction_id="tx-plan-parity",
                command_runner=FakeSystemctl(),
            )
            invariant_keys = (
                "instance_id",
                "instance_digest",
                "mode",
                "release_id",
                "release_manifest_digest",
                "golden_generation_id",
                "writable_generation_id",
                "config_generation_id",
                "state_schema",
                "final_controller_state",
                "request_digest",
            )
            for key in invariant_keys:
                self.assertEqual(plan[key], applied[key], key)
            self.assertTrue(plan["fresh_host_pristine_required_for_new_transaction"])
            self.assertEqual(plan["final_controller_state"], "STOPPED")

    def test_open_canary_state_fails_closed_after_pointer_switch(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root, canary_status="OPEN")
            instance = make_instance(root)
            with self.assertRaises(WB0SafetyError):
                apply_recovery(
                    instance=instance,
                    capsule_root=capsule,
                    transaction_id="tx-open-canary",
                    mode="same_host",
                    golden_generation_id="golden-open",
                    writable_generation_id="work-open",
                    config_generation_id="config-open",
                    state_schema_version="2.1",
                    resource_report=safe_resource_report(),
                    command_runner=FakeSystemctl(),
                )

    def test_committed_transaction_repairs_immutable_surfaces_but_preserves_writable_state(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            capsule = make_capsule(root)
            instance = make_instance(root)
            runner = FakeSystemctl()
            kwargs = dict(
                instance=instance,
                capsule_root=capsule,
                transaction_id="tx-corruption-repair",
                mode="same_host",
                golden_generation_id="golden-repair",
                writable_generation_id="work-repair",
                config_generation_id="config-repair",
                state_schema_version="2.1",
                command_runner=runner,
            )
            first = apply_recovery(**kwargs, resource_report=safe_resource_report())
            self.assertEqual(first["status"], "COMMITTED")

            release_file = Path(instance["roots"]["release_root"]) / "releases" / RELEASE_ID / "release/lib/mlgo_cao_v2/__init__.py"
            release_file.chmod(0o600)
            release_file.write_text("corrupt release\n")
            release_file.chmod(0o400)
            config_file = Path(instance["roots"]["config_root"]) / "generations/config-repair/payload/cao-policy.json"
            config_file.chmod(0o600)
            config_file.write_text('{"schema_version":"2.0"}\n')
            config_file.chmod(0o400)
            config_generation = Path(instance["roots"]["config_root"]) / "generations/config-repair"
            config_generation.chmod(0o700)
            (config_generation / "unexpected.txt").write_text("unexpected\n")
            (config_generation / "unexpected.txt").chmod(0o400)
            config_generation.chmod(0o500)
            state_file = Path(instance["roots"]["state_root"]) / "generations/work-repair/payload/runs/example/v2/state.json"
            state_file.write_bytes(b'{"runtime_progress":true,"checkpoint":9}\n')
            state_before = state_file.read_bytes()
            skill_digest = sha256_bytes(SKILL_BYTES)
            skill_object = Path(instance["skill_bindings"]["cache_root"]) / "skill-cache/objects" / skill_digest[:2] / skill_digest
            skill_object.chmod(0o600)
            skill_object.write_text("corrupt sealed object\n")
            skill_object.chmod(0o400)
            skill_mirror = Path(instance["skill_bindings"]["native_mirror_root"]) / SKILL_MIRROR_NAME / "SKILL.md"
            skill_mirror.chmod(0o600)
            skill_mirror.write_text("corrupt mirror\n")
            skill_mirror.chmod(0o400)

            repaired = apply_recovery(**kwargs, resource_report=safe_resource_report())
            self.assertEqual(repaired["status"], "COMMITTED")
            self.assertIn("__version__", release_file.read_text())
            self.assertIn("v2_shadow", config_file.read_text())
            self.assertEqual(state_file.read_bytes(), state_before)
            self.assertEqual(skill_object.read_bytes(), SKILL_BYTES)
            self.assertEqual(skill_mirror.read_bytes(), SKILL_BYTES)
            self.assertFalse((config_generation / "unexpected.txt").exists())
            self.assertEqual(config_generation.stat().st_mode & 0o222, 0)
            self.assertTrue((Path(instance["roots"]["state_root"]) / "recovery/skill-quarantine").is_dir())
            self.assertTrue((Path(instance["roots"]["release_root"]) / "quarantine").is_dir())
            self.assertTrue((Path(instance["roots"]["config_root"]) / "quarantine").is_dir())
            state_quarantine = Path(instance["roots"]["state_root"]) / "quarantine"
            if state_quarantine.exists():
                self.assertFalse(any(p.name.startswith("work-repair--") for p in state_quarantine.iterdir()))
            self.assertGreater(len(repaired.get("reconciliations", [])), 0)


if __name__ == "__main__":
    unittest.main()
