from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.restart import _validate_break_glass_approval, active_resources, active_runs


class RestartGuardTest(unittest.TestCase):
    def test_either_legacy_or_v2_nonterminal_state_keeps_run_active(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            run_dir = root / "runs" / "run-1"
            (run_dir / "v2").mkdir(parents=True)
            (run_dir / "state.json").write_text(json.dumps({"run_status": "completed"}))
            (run_dir / "v2" / "state.json").write_text(json.dumps({"status": "EXECUTING"}))
            found = active_runs({"state_root": str(root)})
            self.assertEqual([item["run_id"] for item in found], ["run-1"])

    def test_unknown_runtime_inventory_blocks_restart(self):
        policy = {"state_root": "/nonexistent"}
        with patch("mlgo_cao_v2.restart.active_main_terminals", return_value={
            "status": "UNKNOWN", "reason": "offline", "active": [], "all_records": [], "session": "mlgo-cao"
        }), patch("mlgo_cao_v2.restart.active_bridge_units", return_value={
            "status": "KNOWN", "reason": None, "units": []
        }):
            resources = active_resources(policy)
        self.assertTrue(resources["restart_blocked"])
        self.assertEqual(resources["unknown_checks"], ["main_cao_terminals"])

    def test_break_glass_approval_is_short_lived_and_explicit(self):
        with tempfile.TemporaryDirectory() as td:
            now = dt.datetime.now(dt.timezone.utc)
            approval = {
                "schema_version": "1.0",
                "action": "CAO_BREAK_GLASS_RESTART",
                "approved": True,
                "approved_by": "operator",
                "reason": "Emergency maintenance accepted by the operator.",
                "issued_at": (now - dt.timedelta(minutes=1)).isoformat(),
                "expires_at": (now + dt.timedelta(minutes=20)).isoformat(),
                "acknowledge_active_sessions_will_be_destroyed": True,
            }
            path = Path(td) / "approval.json"
            path.write_text(json.dumps(approval))
            checked = _validate_break_glass_approval(path)
            self.assertEqual(checked["action"], "CAO_BREAK_GLASS_RESTART")
            approval["acknowledge_active_sessions_will_be_destroyed"] = False
            path.write_text(json.dumps(approval))
            with self.assertRaises(PolicyError):
                _validate_break_glass_approval(path)


if __name__ == "__main__":
    unittest.main()
