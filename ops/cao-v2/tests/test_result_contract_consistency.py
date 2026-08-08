from __future__ import annotations

import json
import unittest

from mlgo_cao_v2.common import ContractError
from mlgo_cao_v2.contracts import (
    NO_FURTHER_ACTION,
    RESULT_END,
    RESULT_START,
    RESULT_STATUSES,
    extract_result_packet,
    result_packet_instructions,
    validate_result_packet,
)


SHA = "a" * 40


def phase(
    *,
    phase_kind: str,
    write_capable: bool,
    allowed_statuses: list[str],
    phase_id: str,
) -> dict:
    return {
        "run_id": "contract-roundtrip-run",
        "big_task_id": "CONTRACT-ROUNDTRIP",
        "phase_id": phase_id,
        "phase_kind": phase_kind,
        "write_capable": write_capable,
        "result_contract": {"allowed_statuses": allowed_statuses},
    }


def template_value(instructions: str) -> dict:
    start = instructions.index(RESULT_START + "\n") + len(RESULT_START) + 1
    end = instructions.index("\n" + RESULT_END, start)
    value = json.loads(instructions[start:end])
    assert isinstance(value, dict)
    return value


def materialize(value: dict, ph: dict, status: str) -> dict:
    packet = json.loads(json.dumps(value))
    packet["status"] = status
    packet["next_action"] = (
        NO_FURTHER_ACTION
        if status in {"PASS", "NO_CHANGE"}
        else "Host must inspect this result and apply the phase policy."
    )
    if ph["write_capable"] and status == "READY_FOR_COMMIT":
        packet["changed_files"] = ["example.txt"]
    if ph["phase_kind"] == "review" and status == "PASS":
        packet["reviewed_sha"] = SHA
    return packet


class ResultContractConsistencyTests(unittest.TestCase):
    def phase_shapes(self) -> list[dict]:
        return [
            phase(
                phase_kind="implementation",
                write_capable=True,
                allowed_statuses=[
                    "READY_FOR_COMMIT",
                    "BLOCKED",
                    "PLAN_CONFLICT",
                    "CAPABILITY_ESCALATION_REQUIRED",
                    "ENVIRONMENT_BLOCKED",
                    "MISSING_REQUIRED_CONTEXT",
                ],
                phase_id="IMPLEMENTATION-P1",
            ),
            phase(
                phase_kind="analysis",
                write_capable=False,
                allowed_statuses=["PASS", "NO_CHANGE", "BLOCKED"],
                phase_id="ANALYSIS-P1",
            ),
            phase(
                phase_kind="validation",
                write_capable=False,
                allowed_statuses=["PASS", "FAIL", "BLOCKED"],
                phase_id="VALIDATION-P1",
            ),
            phase(
                phase_kind="review",
                write_capable=False,
                allowed_statuses=["PASS", "FAIL", "BLOCKED"],
                phase_id="REVIEW-P1",
            ),
            phase(
                phase_kind="integration_repair",
                write_capable=True,
                allowed_statuses=["READY_FOR_COMMIT", "BLOCKED", "PLAN_CONFLICT"],
                phase_id="INTEGRATION-REPAIR-P1",
            ),
        ]

    def test_every_generated_template_shape_round_trips_for_each_allowed_status(self) -> None:
        observed: set[str] = set()
        for ph in self.phase_shapes():
            instructions = result_packet_instructions(ph)
            value = template_value(instructions)
            self.assertIsNone(value["next_action"])
            self.assertTrue(str(value["status"]).startswith("one of:"))
            for status in ph["result_contract"]["allowed_statuses"]:
                observed.add(status)
                packet = materialize(value, ph, status)
                self.assertEqual(validate_result_packet(packet, ph)["status"], status)
                marked = RESULT_START + "\n" + json.dumps(packet, indent=2) + "\n" + RESULT_END
                self.assertEqual(extract_result_packet(marked, ph)["status"], status)
        self.assertEqual(observed, RESULT_STATUSES)

    def test_exact_template_copy_is_rejected(self) -> None:
        ph = self.phase_shapes()[1]
        instructions = result_packet_instructions(ph)
        with self.assertRaisesRegex(ContractError, "PROMPT_RESULT_CONTRACT_TEMPLATE_REJECTED"):
            extract_result_packet(instructions, ph)

    def test_concrete_status_with_unfilled_next_action_is_rejected(self) -> None:
        ph = self.phase_shapes()[1]
        packet = template_value(result_packet_instructions(ph))
        packet["status"] = "PASS"
        marked = RESULT_START + "\n" + json.dumps(packet) + "\n" + RESULT_END
        with self.assertRaisesRegex(ContractError, "next_action must be a non-empty string"):
            extract_result_packet(marked, ph)

    def test_empty_and_whitespace_next_action_remain_invalid(self) -> None:
        ph = self.phase_shapes()[1]
        base = materialize(template_value(result_packet_instructions(ph)), ph, "PASS")
        for invalid in ("", "   \n\t"):
            packet = dict(base)
            packet["next_action"] = invalid
            with self.subTest(invalid=repr(invalid)):
                with self.assertRaisesRegex(ContractError, "next_action must be a non-empty string"):
                    validate_result_packet(packet, ph)

    def test_read_only_pass_no_change_safe_value_is_concrete_and_valid(self) -> None:
        ph = self.phase_shapes()[1]
        instructions = result_packet_instructions(ph)
        self.assertIn(NO_FURTHER_ACTION, instructions)
        for status in ("PASS", "NO_CHANGE"):
            packet = materialize(template_value(instructions), ph, status)
            self.assertEqual(packet["next_action"], NO_FURTHER_ACTION)
            validate_result_packet(packet, ph)

    def test_review_pass_requires_reviewed_sha(self) -> None:
        ph = self.phase_shapes()[3]
        packet = materialize(template_value(result_packet_instructions(ph)), ph, "PASS")
        packet["reviewed_sha"] = None
        with self.assertRaisesRegex(ContractError, "reviewed_sha"):
            validate_result_packet(packet, ph)

    def test_malformed_markers_schema_and_identity_remain_rejected(self) -> None:
        ph = self.phase_shapes()[1]
        packet = materialize(template_value(result_packet_instructions(ph)), ph, "PASS")
        cases = []
        cases.append(("wrong marker", "MLGO_RESULT_PACKET_START\n" + json.dumps(packet) + "\n" + RESULT_END))
        wrong_schema = dict(packet); wrong_schema["schema_version"] = "1.0"
        cases.append(("wrong schema", RESULT_START + "\n" + json.dumps(wrong_schema) + "\n" + RESULT_END))
        wrong_id = dict(packet); wrong_id["run_id"] = "other-run"
        cases.append(("wrong identity", RESULT_START + "\n" + json.dumps(wrong_id) + "\n" + RESULT_END))
        for label, marked in cases:
            with self.subTest(label=label):
                with self.assertRaises(ContractError):
                    extract_result_packet(marked, ph)


if __name__ == "__main__":
    unittest.main()
