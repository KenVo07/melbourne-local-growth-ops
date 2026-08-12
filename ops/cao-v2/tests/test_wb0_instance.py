from __future__ import annotations

import copy
import os
import tempfile
import unittest
from pathlib import Path

from _wb0_test_support import make_instance
from mlgo_cao_v2.wb0_common import WB0ContractError, WB0SafetyError
from mlgo_cao_v2.wb0_instance import assert_safe_policy, render_safe_policy, validate_instance


class InstanceTest(unittest.TestCase):
    def test_instance_is_digest_sealed_and_roots_are_disjoint(self):
        with tempfile.TemporaryDirectory() as td:
            instance = make_instance(Path(td))
            self.assertEqual(validate_instance(instance), instance)
            altered = copy.deepcopy(instance)
            altered["project_roots"].append(str(Path(td) / "other"))
            with self.assertRaises(WB0ContractError):
                validate_instance(altered)

    def test_secret_shaped_field_is_rejected(self):
        with tempfile.TemporaryDirectory() as td:
            instance = make_instance(Path(td))
            instance["provider_bindings"]["api_key"] = "not-even-a-real-key"
            with self.assertRaises(WB0SafetyError):
                validate_instance(instance)

    def test_host_projection_roots_cannot_overlap_projects_or_control_roots(self):
        with tempfile.TemporaryDirectory() as td:
            instance = make_instance(Path(td))
            project_overlap = copy.deepcopy(instance)
            project_overlap["host_adapter"]["bin_root"] = project_overlap["project_roots"][0]
            with self.assertRaises(WB0SafetyError):
                validate_instance(project_overlap)

            control_overlap = copy.deepcopy(instance)
            control_overlap["host_adapter"]["systemd_user_unit_root"] = control_overlap["roots"]["state_root"]
            with self.assertRaises(WB0SafetyError):
                validate_instance(control_overlap)

    def test_existing_projection_symlink_is_rejected_before_apply(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            instance = make_instance(root)
            outside = root / "outside-bin"
            outside.mkdir()
            bin_root = Path(instance["host_adapter"]["bin_root"])
            bin_root.parent.mkdir(parents=True, exist_ok=True)
            os.symlink(outside, bin_root)
            with self.assertRaises(WB0SafetyError):
                validate_instance(instance, check_existing_ancestors=True)

    def test_policy_projection_forces_shadow_and_portable_paths(self):
        with tempfile.TemporaryDirectory() as td:
            instance = make_instance(Path(td))
            template = {
                "schema_version": "2.0",
                "orchestration": {"default_mode": "v2_enforced"},
                "semantic_triggers": {"enforcement_mode": "enforced"},
                "capability_activation": {"native_resume": {"enabled": True}},
                "capacity": {},
                "installation": {},
            }
            policy = render_safe_policy(template, instance)
            assert_safe_policy(policy)
            self.assertNotIn("/home/khoa", str(policy))
            self.assertEqual(policy["host_adapter"]["worktree_command"], instance["host_adapter"]["worktree_command"])


if __name__ == "__main__":
    unittest.main()
