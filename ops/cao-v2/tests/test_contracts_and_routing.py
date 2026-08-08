from __future__ import annotations

import copy
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.common import ContractError, PolicyError
from mlgo_cao_v2.contracts import extract_result_packet, validate_big_task_charter, validate_routing_proposal
from mlgo_cao_v2.policy import load_policy
from mlgo_cao_v2.routing import decide_route

POLICY = Path(__file__).resolve().parents[1] / "config" / "cao-policy.json"


class ContractsRoutingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.policy = load_policy(POLICY)
        self.charter = {
            "schema_version": "2.0",
            "run_id": "run-1",
            "big_task_id": "task-a",
            "outcome": "Deliver a bounded result",
            "acceptance": ["observable result passes"],
            "in_scope": ["src"],
            "out_of_scope": ["deployment"],
            "constraints": [],
            "risk_class": "MEDIUM",
            "delegation_envelope": {
                "allowed_routes": ["agy_flash_high", "agy_pro_high", "claude_subscription_sonnet", "codex_plus_sol"],
                "maximum_tier": 4,
                "gateway_allowed": False,
                "protected_supervisor_pool_use_allowed": False,
                "max_phases": 4,
                "max_parallel_writers": 2,
                "supervisor_approval_triggers": ["acceptance_change"],
            },
            "review_policy": {"default_class": "routine_independent", "critical_requires_cross_provider": True},
            "completion_boundary": "Task Lead may recommend; supervisor finalizes milestone",
        }
        self.snapshot_id = "caps-20990101T000000Z-aaaaaaaaaaaa"
        self.snapshot = {
            "schema_version": "2.0",
            "snapshot_id": self.snapshot_id,
            "observed_at": "2099-01-01T00:00:00Z",
            "expires_at": "2099-01-01T00:05:00Z",
            "profiles": {},
        }
        for route_id, cfg in self.policy["routes"].items():
            self.snapshot["profiles"][route_id] = {
                "availability": "available",
                "capacity_band": "abundant",
                "remaining_pct": 90 if cfg["account_pool"].startswith("codex") else None,
                "reserve_pct": 20 if cfg["account_pool"].startswith("codex") else None,
                "reserve_status": "clear",
                "billing_mode": cfg["billing_mode"],
                "gateway_authorized": False,
                "telemetry_confidence": "high",
                "evidence_source": "test",
            }

    def proposal(self, preferred="agy_flash_high", minimum=1, acceptable=None):
        return {
            "schema_version": "2.0",
            "run_id": "run-1",
            "big_task_id": "task-a",
            "phase_id": "phase-1",
            "phase_characteristics": {
                "difficulty": "ordinary",
                "importance": "medium",
                "ambiguity": "low",
                "reversibility": "easy",
                "phase_maturity": "stable_foundation",
            },
            "preferred_route": preferred,
            "minimum_tier": minimum,
            "acceptable_routes": acceptable or [preferred],
            "unacceptable_routes": [],
            "required_families": [],
            "routing_reason": ["bounded ordinary execution"],
            "frontier_justification": None,
            "escalation_conditions": ["shared contract must change"],
            "deescalation_conditions": [],
            "review_class": "routine_independent",
            "expected_budget_class": "small",
            "capacity_snapshot_id": self.snapshot_id,
        }

    def test_gemini_preferred_is_honored_even_with_frontier_headroom(self):
        validate_big_task_charter(self.charter, self.policy)
        result = decide_route(self.proposal(), self.charter, self.snapshot, self.policy)
        self.assertEqual(result["selected_route"], "agy_flash_high")
        self.assertTrue(result["preferred_route_honored"])

    def test_host_uses_only_planner_ordered_alternatives(self):
        proposal = self.proposal(acceptable=["agy_flash_high", "agy_pro_high"])
        self.snapshot["profiles"]["agy_flash_high"]["availability"] = "unavailable"
        result = decide_route(proposal, self.charter, self.snapshot, self.policy)
        self.assertEqual(result["selected_route"], "agy_pro_high")
        self.assertFalse(result["preferred_route_honored"])

    def test_cross_provider_review_uses_reviewer_profile(self):
        proposal = self.proposal(acceptable=["agy_flash_high", "claude_subscription_sonnet"])
        proposal["review_class"] = "cross_provider"
        result = decide_route(
            proposal, self.charter, self.snapshot, self.policy,
            builder_provider_family="gemini", execution_role="reviewer",
        )
        self.assertEqual(result["selected_route"], "claude_subscription_sonnet")
        self.assertEqual(result["selected_profile"], "mlgo-claude-subscription-reviewer")
        self.assertEqual(result["selected_execution_role"], "reviewer")

    def test_no_silent_downgrade_below_capability_floor(self):
        proposal = self.proposal("codex_plus_sol", minimum=4, acceptable=["codex_plus_sol"])
        proposal["phase_characteristics"]["difficulty"] = "very_difficult"
        proposal["frontier_justification"] = "cross-package integration"
        self.snapshot["profiles"]["codex_plus_sol"]["availability"] = "unavailable"
        result = decide_route(proposal, self.charter, self.snapshot, self.policy)
        self.assertEqual(result["decision"], "BLOCKED_BY_PROVIDER_CAPACITY_OR_POLICY")
        self.assertIsNone(result["selected_route"])

    def test_proposal_cannot_be_rebound_to_a_different_capacity_snapshot(self):
        proposal = self.proposal()
        other = copy.deepcopy(self.snapshot)
        other["snapshot_id"] = "caps-20990101T000001Z-bbbbbbbbbbbb"
        with self.assertRaises(PolicyError):
            decide_route(proposal, self.charter, other, self.policy)

    def test_ordinary_frontier_route_requires_justification(self):
        proposal = self.proposal("claude_subscription_sonnet", minimum=3, acceptable=["claude_subscription_sonnet"])
        with self.assertRaises(ContractError):
            validate_routing_proposal(proposal, self.policy, self.charter)

    def test_extract_structured_result(self):
        phase = {
            "run_id": "run-1", "big_task_id": "task-a", "phase_id": "phase-1",
            "write_capable": True,
            "result_contract": {"allowed_statuses": ["READY_FOR_COMMIT"]},
        }
        packet = {
            "schema_version": "2.0", "run_id": "run-1", "big_task_id": "task-a", "phase_id": "phase-1",
            "status": "READY_FOR_COMMIT", "changed_files": ["src/a.ts"], "verification": ["test passed"],
            "assumptions_confirmed": [], "assumptions_invalidated": [], "risks": [], "next_action": "host commit"
        }
        text = "notes\nMLGO_RESULT_PACKET\n" + json.dumps(packet) + "\nEND_MLGO_RESULT_PACKET\n"
        self.assertEqual(extract_result_packet(text, phase)["status"], "READY_FOR_COMMIT")

    def test_extract_terminal_wrapped_structured_result(self):
        phase = {
            "run_id": "v2-provider-canary-20260806T091635Z",
            "big_task_id": "PROVIDER-CANARY",
            "phase_id": "PROVIDER-CANARY-P01",
            "write_capable": False,
            "result_contract": {"allowed_statuses": ["PASS"]},
        }
        packet = {
            "schema_version": "2.0",
            "run_id": phase["run_id"],
            "big_task_id": phase["big_task_id"],
            "phase_id": phase["phase_id"],
            "status": "PASS",
            "changed_files": [],
            "verification": ["Read-only Claude subscription model response observed through CAO terminal output"],
            "assumptions_confirmed": ["No repository or file mutation was requested"],
            "assumptions_invalidated": [],
            "risks": [],
            "next_action": "Host validates the packet and closes the canary session",
        }
        compact = json.dumps(packet, separators=(",", ":"))
        wrapped = "\n".join(compact[index:index + 31] for index in range(0, len(compact), 31))
        text = "provider output\n\n\nMLGO_RESULT_PACKET\n" + wrapped + "\nEND_MLGO_RESULT_PACKET\n"
        result = extract_result_packet(text, phase)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["run_id"], phase["run_id"])
        self.assertEqual(result["changed_files"], [])

    def test_terminal_wrap_normalization_does_not_repair_semantic_json_damage(self):
        phase = {
            "run_id": "run-1",
            "big_task_id": "task-a",
            "phase_id": "phase-1",
            "write_capable": False,
            "result_contract": {"allowed_statuses": ["PASS"]},
        }
        damaged = '{"schema_version":"2.0" "run_id":"run-1"}'
        text = "MLGO_RESULT_PACKET\n" + damaged + "\nEND_MLGO_RESULT_PACKET\n"
        with self.assertRaises(ContractError):
            extract_result_packet(text, phase)


if __name__ == "__main__":
    unittest.main()
