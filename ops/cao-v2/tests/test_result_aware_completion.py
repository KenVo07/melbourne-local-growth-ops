from __future__ import annotations

import json
import socket
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from mlgo_cao_v2.common import ContractError
from mlgo_cao_v2.completion import (
    HerdrPreflightError,
    ModelOutputIncomplete,
    TerminalProvenanceError,
    capture_stable_result,
    cleanup_retained_terminal,
    preflight_herdr_boundary,
)
from mlgo_cao_v2.contracts import extract_result_packet, extract_result_packet_with_provenance
from mlgo_cao_v2.dispatch import _execute_provider


TERMINAL_ID = "9bb612a9"
RUN_ID = "runtime-write-canary-20260806t124519z"
BIG_TASK_ID = "WRITE-CANARY"
PHASE_ID = "WRITE-CANARY-P01"


def phase(*, run_id: str = RUN_ID, write_capable: bool = True, status: str = "READY_FOR_COMMIT") -> dict:
    return {
        "run_id": run_id,
        "big_task_id": BIG_TASK_ID,
        "phase_id": PHASE_ID,
        "phase_kind": "implementation" if write_capable else "analysis",
        "write_capable": write_capable,
        "result_contract": {"allowed_statuses": [status, "BLOCKED"]},
    }


def decision() -> dict:
    return {
        "selected_provider": "claude_code",
        "selected_profile": "mlgo-claude-subscription-builder",
        "selected_model": "sonnet",
        "selected_provider_api": "main",
    }


def packet_text(*, run_id: str = RUN_ID, write_capable: bool = True, status: str | None = None) -> str:
    actual_status = status or ("READY_FOR_COMMIT" if write_capable else "PASS")
    value = {
        "schema_version": "2.0",
        "run_id": run_id,
        "big_task_id": BIG_TASK_ID,
        "phase_id": PHASE_ID,
        "status": actual_status,
        "changed_files": ["canary.txt"] if write_capable and actual_status == "READY_FOR_COMMIT" else [],
        "verification": ["exact bytes verified"],
        "assumptions_confirmed": [],
        "assumptions_invalidated": [],
        "risks": [],
        "next_action": "host may continue",
        "commit_sha": None,
        "reviewed_sha": None,
        "evidence": [],
        "provider_session_id": None,
        "cao_terminal_id": None,
        "model": None,
    }
    return "prose\nMLGO_RESULT_PACKET\n" + json.dumps(value, indent=2) + "\nEND_MLGO_RESULT_PACKET\n"


class FakeClock:
    def __init__(self) -> None:
        self.value = 0.0

    def monotonic(self) -> float:
        return self.value

    def sleep(self, seconds: float) -> None:
        self.value += seconds


class FakeCAO:
    def __init__(
        self,
        outputs: list[str],
        *,
        full_outputs: list[str] | None = None,
        terminal_id: str = TERMINAL_ID,
        provider: str = "claude_code",
        profile: str = "mlgo-claude-subscription-builder",
    ) -> None:
        self.last_outputs = outputs
        self.full_outputs = full_outputs if full_outputs is not None else outputs
        self.last_index = 0
        self.full_index = 0
        self.terminal_id = terminal_id
        self.provider = provider
        self.profile = profile
        self.calls: list[tuple[str, str, str | None]] = []

    @staticmethod
    def _next(values: list[str], index: int) -> tuple[str, int]:
        value = values[min(index, len(values) - 1)]
        return value, index + 1

    def __call__(self, url: str, *, method: str = "GET", query=None, body=None, timeout=0) -> dict:
        mode = (query or {}).get("mode") if query else None
        self.calls.append((method, url, mode))
        if url.endswith(f"/terminals/{TERMINAL_ID}") and method == "GET":
            return {
                "id": self.terminal_id,
                "name": "writer",
                "provider": self.provider,
                "session_name": "mlgo-cao",
                "agent_profile": self.profile,
                "status": "completed",
            }
        if url.endswith(f"/terminals/{TERMINAL_ID}/output"):
            if mode == "last":
                value, self.last_index = self._next(self.last_outputs, self.last_index)
            elif mode == "full":
                value, self.full_index = self._next(self.full_outputs, self.full_index)
            else:
                raise AssertionError(f"unexpected output mode: {mode}")
            return {"output": value, "mode": mode}
        if url.endswith(f"/terminals/{TERMINAL_ID}/exit"):
            return {"success": True}
        if url.endswith(f"/terminals/{TERMINAL_ID}") and method == "DELETE":
            return {"success": True}
        raise AssertionError((method, url, query, body))


def policy() -> dict:
    return {
        "main_cao_api": "http://127.0.0.1:9889",
        "agy_sidecar_api": "http://127.0.0.1:9890",
        "main_cao_session": "mlgo-cao",
        "repo_root": "/tmp/repo",
        "result_aware_completion": {
            "enabled": True,
            "primary_output_mode": "last",
            "forensic_output_mode": "full",
            "full_output_is_forensic_only": True,
            "settle_window_seconds": 4,
            "poll_interval_seconds": 1,
            "stable_complete_reads": 2,
            "graceful_exit_timeout_seconds": 1,
            "delete_timeout_seconds": 1,
        },
    }


class ResultAwareCompletionTests(unittest.TestCase):
    def test_completion_edge_can_precede_rendered_packet_settle(self) -> None:
        truncated = "MLGO_RESULT_PACKET\n{\"schema_version\":\"2.0\""
        complete = packet_text()
        fake = FakeCAO([truncated, complete, complete])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            result, capture = capture_stable_result(
                endpoint="http://cao",
                terminal_id=TERMINAL_ID,
                phase=phase(),
                decision=decision(),
                policy=policy(),
                evidence_directory=td,
                run_step_response={"terminal_id": TERMINAL_ID, "last_message": truncated, "status": "completed"},
                request=fake,
                monotonic=clock.monotonic,
                sleep=clock.sleep,
            )
            self.assertEqual(result["status"], "READY_FOR_COMMIT")
            self.assertEqual(capture["stable_complete_reads"], 2)
            self.assertEqual(capture["observation_count"], 3)

    def test_opening_marker_with_delayed_closing_marker(self) -> None:
        partial = packet_text().replace("\nEND_MLGO_RESULT_PACKET\n", "")
        complete = packet_text()
        fake = FakeCAO([partial, complete, complete])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            result, _ = capture_stable_result(
                endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID}, request=fake,
                monotonic=clock.monotonic, sleep=clock.sleep,
            )
            self.assertEqual(result["run_id"], RUN_ID)

    def test_terminal_is_cleaned_only_after_authoritative_result_is_persisted(self) -> None:
        complete = packet_text()
        fake = FakeCAO([complete, complete])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            result, capture = capture_stable_result(
                endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID}, request=fake,
                monotonic=clock.monotonic, sleep=clock.sleep,
            )
            authoritative = Path(capture["authoritative_raw_path"])
            self.assertTrue(authoritative.is_file())
            cleanup_retained_terminal(endpoint="http://cao", terminal_id=TERMINAL_ID, evidence_directory=td, policy=policy(), request=fake)
            cleanup_methods = [method for method, _, _ in fake.calls if method in {"POST", "DELETE"}]
            self.assertEqual(cleanup_methods, ["POST", "DELETE"])
            self.assertEqual(result["status"], "READY_FOR_COMMIT")

    def test_timeout_is_model_output_incomplete_and_preserves_exact_raw(self) -> None:
        historical = (Path(__file__).parent / "fixtures" / "gate1-truncated-raw-output.txt").read_text(encoding="utf-8")
        fake = FakeCAO([historical])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ModelOutputIncomplete):
                capture_stable_result(
                    endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                    evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID, "last_message": historical}, request=fake,
                    monotonic=clock.monotonic, sleep=clock.sleep,
                )
            self.assertEqual((Path(td) / "best-last-output.txt").read_text(encoding="utf-8"), historical)
            self.assertEqual((Path(td) / "best-full-output.txt").read_text(encoding="utf-8"), historical)
            timeout_record = json.loads((Path(td) / "completion-timeout.json").read_text())
            self.assertEqual(timeout_record["outcome"], "MODEL_OUTPUT_INCOMPLETE")
            self.assertIn("No packet, marker, JSON token", timeout_record["note"])

    def test_exact_historical_truncation_fixture_is_rejected_without_fabrication(self) -> None:
        historical = (Path(__file__).parent / "fixtures" / "gate1-truncated-raw-output.txt").read_text(encoding="utf-8")
        with self.assertRaises(ContractError):
            extract_result_packet(historical, phase())
        self.assertNotIn("END_MLGO_RESULT_PACKET", historical)

    def test_later_complete_observation_for_same_terminal_is_accepted(self) -> None:
        historical = (Path(__file__).parent / "fixtures" / "gate1-truncated-raw-output.txt").read_text(encoding="utf-8")
        complete = packet_text()
        fake = FakeCAO([historical, complete, complete])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            result, _ = capture_stable_result(
                endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID}, request=fake,
                monotonic=clock.monotonic, sleep=clock.sleep,
            )
            self.assertEqual(result["phase_id"], PHASE_ID)

    def test_cross_run_packet_is_rejected(self) -> None:
        wrong = packet_text(run_id="other-run")
        fake = FakeCAO([wrong])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ModelOutputIncomplete):
                capture_stable_result(
                    endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                    evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID}, request=fake,
                    monotonic=clock.monotonic, sleep=clock.sleep,
                )

    def test_cross_terminal_or_provider_provenance_is_rejected(self) -> None:
        fake = FakeCAO([packet_text()], terminal_id="aaaaaaaa")
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(TerminalProvenanceError):
                capture_stable_result(
                    endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                    evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID}, request=fake,
                )

    def test_read_only_result_contract_still_accepts_pass(self) -> None:
        text = packet_text(write_capable=False, status="PASS")
        result = extract_result_packet(text, phase(write_capable=False, status="PASS"))
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["changed_files"], [])

    def test_run_step_uses_teardown_false(self) -> None:
        body_seen = {}
        def request(url, *, method, body, timeout):
            body_seen.update(body)
            return {"terminal_id": TERMINAL_ID, "last_message": "partial", "status": "completed"}
        p = policy()
        ph = {
            "write_capable": True,
            "worktree": {"path": "/tmp/repo", "branch": "canary", "require_clean": True},
            "evidence_directory": "/tmp/evidence",
            "validation": {"timeout_seconds": 60},
        }
        dec = {**decision(), "selected_provider_api": "main"}
        with mock.patch("mlgo_cao_v2.dispatch.request_json", request):
            response, endpoint, metadata = _execute_provider(ph, dec, p, "prompt")
        self.assertFalse(body_seen["teardown"])
        self.assertEqual(response["terminal_id"], TERMINAL_ID)
        self.assertEqual(endpoint, p["main_cao_api"])
        self.assertFalse(metadata["run_step_teardown"])

    def test_prompt_template_is_rejected_and_later_claude_candidate_is_considered(self) -> None:
        template = packet_text().replace('"READY_FOR_COMMIT"', '"one of: READY_FOR_COMMIT, BLOCKED"')
        actual = packet_text().replace("MLGO_RESULT_PACKET", "● MLGO_RESULT_PACKET", 1)
        packet, _, provenance = extract_result_packet_with_provenance(
            template + "\n" + actual,
            phase(),
            provider="claude_code",
        )
        self.assertEqual(packet["status"], "READY_FOR_COMMIT")
        self.assertEqual(provenance["opening_prefix"], "CLAUDE_ASSISTANT_BULLET")
        self.assertGreaterEqual(provenance["candidate_count"], 2)

    def test_repaint_row_is_not_generically_deleted_from_json(self) -> None:
        actual = packet_text().replace("MLGO_RESULT_PACKET", "● MLGO_RESULT_PACKET", 1)
        damaged = actual.replace(
            '  "verification":',
            '❯ MLGO CAO v2 bounded phase execution\n  "verification":',
            1,
        )
        with self.assertRaises(ContractError):
            extract_result_packet(damaged, phase(), provider="claude_code")

    def test_full_output_is_forensic_and_clean_last_is_authoritative(self) -> None:
        full = (
            packet_text().replace('"READY_FOR_COMMIT"', '"one of: READY_FOR_COMMIT, BLOCKED"')
            + "\n"
            + packet_text().replace("MLGO_RESULT_PACKET", "● MLGO_RESULT_PACKET", 1).replace(
                '  "verification":',
                '❯ MLGO CAO v2 bounded phase execution\n  "verification":',
                1,
            )
        )
        partial = "● MLGO_RESULT_PACKET\n{\n"
        clean = packet_text().replace("MLGO_RESULT_PACKET", "● MLGO_RESULT_PACKET", 1)
        fake = FakeCAO([partial, clean, clean], full_outputs=[full, full, full])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            result, capture = capture_stable_result(
                endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID, "last_message": "truncated"}, request=fake,
                monotonic=clock.monotonic, sleep=clock.sleep,
            )
            self.assertEqual(result["status"], "READY_FOR_COMMIT")
            self.assertEqual(capture["authoritative_source_mode"], "last")
            self.assertEqual(Path(capture["forensic_full_output_path"]).read_text(), full)
            records = sorted(p for p in (Path(td) / "result-observations").glob("observation-*.json") if not p.name.endswith("-terminal.json"))
            first = json.loads(records[0].read_text())
            self.assertEqual(first["outputs"]["last"]["request_mode"], "last")
            self.assertEqual(first["outputs"]["full"]["role"], "forensic_only")

    def test_full_output_alone_cannot_satisfy_completion(self) -> None:
        clean_full = packet_text().replace("MLGO_RESULT_PACKET", "● MLGO_RESULT_PACKET", 1)
        fake = FakeCAO(["truncated"], full_outputs=[clean_full])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ModelOutputIncomplete):
                capture_stable_result(
                    endpoint="http://cao", terminal_id=TERMINAL_ID, phase=phase(), decision=decision(), policy=policy(),
                    evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID}, request=fake,
                    monotonic=clock.monotonic, sleep=clock.sleep,
                )
            self.assertEqual((Path(td) / "best-full-output.txt").read_text(), clean_full)

    def test_json_wrap_normalization_only_removes_breaks_inside_strings(self) -> None:
        clean = packet_text().replace("exact bytes verified", "exact bytes verified across terminal rows")
        wrapped = clean.replace("verified across", "verified\n  across")
        packet, _, provenance = extract_result_packet_with_provenance(
            wrapped, phase(), provider="claude_code"
        )
        self.assertEqual(packet["verification"], ["exact bytes verifiedacross terminal rows"])
        self.assertEqual(provenance["parse_mode"], "TERMINAL_WRAP_INSIDE_JSON_STRINGS")
        self.assertEqual(provenance["transformations"][0]["kind"], "REMOVE_TERMINAL_WRAP_BYTES_INSIDE_JSON_STRINGS")

    def test_missing_closing_marker_remains_incomplete(self) -> None:
        with self.assertRaises(ContractError):
            extract_result_packet(packet_text().replace("END_MLGO_RESULT_PACKET", ""), phase(), provider="claude_code")

    def test_exact_v5_rendered_full_fixture_is_not_accepted_by_general_parser(self) -> None:
        historical = (Path(__file__).parent / "fixtures" / "v5-gate1-rendered-full-output-4092.txt").read_text(encoding="utf-8")
        with self.assertRaises(ContractError):
            extract_result_packet(historical, phase(run_id="runtime-write-canary-20260806t143253z"), provider="claude_code")
        self.assertEqual(len(historical.encode("utf-8")), 4092)

    def test_herdr_preflight_passes_only_with_running_socket_and_enumeration(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            sock_path = Path(td) / ".config/herdr/sessions/mlgo-cao/herdr.sock"
            sock_path.parent.mkdir(parents=True)
            sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            sock.bind(str(sock_path))
            try:
                def runner(argv, **kwargs):
                    if argv == ["herdr", "--version"]:
                        return subprocess.CompletedProcess(argv, 0, "herdr 0.8.0\n", "")
                    if argv == ["herdr", "session", "list"]:
                        return subprocess.CompletedProcess(argv, 0, "name status directory socket\nmlgo-cao running x y\n", "")
                    if argv == ["herdr", "--session", "mlgo-cao", "workspace", "list"]:
                        return subprocess.CompletedProcess(argv, 0, '{"result":{"workspaces":[]}}\n', "")
                    raise AssertionError(argv)
                def request_value(url, **kwargs):
                    return {"ok": True} if url.endswith("/health") else []
                result = preflight_herdr_boundary(policy(), runner=runner, request_value=request_value, home=td)
                self.assertEqual(result["status"], "PASS")
                self.assertFalse(result["mutation_performed"])
            finally:
                sock.close()

    def test_pre_provider_herdr_failure_is_precise(self) -> None:
        with tempfile.TemporaryDirectory() as td:
            def runner(argv, **kwargs):
                if argv == ["herdr", "--version"]:
                    return subprocess.CompletedProcess(argv, 0, "herdr 0.8.0\n", "")
                return subprocess.CompletedProcess(argv, 0, "mlgo-cao stopped x y\n", "")
            with self.assertRaises(HerdrPreflightError):
                preflight_herdr_boundary(policy(), runner=runner, request_value=lambda *a, **k: {}, home=td)

    def test_historical_v6_3_packet_remains_invalid_without_synthesis(self) -> None:
        historical = (
            Path(__file__).parent / "fixtures" / "v6-3-gate4-final-provider-response.txt"
        ).read_text(encoding="utf-8")
        ph = {
            "run_id": "runtime-profile-canary-20260807t060849z",
            "big_task_id": "PROFILE-CANARY",
            "phase_id": "PROFILE-CANARY-P1",
            "phase_kind": "analysis",
            "write_capable": False,
            "result_contract": {"allowed_statuses": ["PASS", "NO_CHANGE"]},
        }
        with self.assertRaisesRegex(ContractError, "next_action must be a non-empty string"):
            extract_result_packet(historical, ph, provider="claude_code")

    def test_completed_invalid_candidate_persists_precise_contract_rejection(self) -> None:
        invalid = packet_text(write_capable=False, status="PASS").replace(
            '"next_action": "host may continue"',
            '"next_action": ""',
        )
        fake = FakeCAO([invalid])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ModelOutputIncomplete) as raised:
                capture_stable_result(
                    endpoint="http://cao",
                    terminal_id=TERMINAL_ID,
                    phase=phase(write_capable=False, status="PASS"),
                    decision=decision(),
                    policy=policy(),
                    evidence_directory=td,
                    run_step_response={"terminal_id": TERMINAL_ID, "status": "completed"},
                    request=fake,
                    monotonic=clock.monotonic,
                    sleep=clock.sleep,
                )
            exc = raised.exception
            self.assertEqual(exc.contract_outcome, "POST_MODEL_RESULT_CONTRACT_MISMATCH")
            self.assertIn("next_action must be a non-empty string", str(exc))
            self.assertIsNotNone(exc.precise_rejection)
            timeout = json.loads((Path(td) / "completion-timeout.json").read_text())
            self.assertIn("next_action must be a non-empty string", json.dumps(timeout["strongest_parser_rejection"]))
            self.assertTrue(timeout["parser_rejection_history"])
            rejection_files = sorted((Path(td) / "parser-rejections").glob("rejection-*.json"))
            self.assertEqual(len(rejection_files), timeout["observation_count"])
            for path in rejection_files:
                row = json.loads(path.read_text())
                self.assertEqual(row["candidate_count"], 1)
                self.assertIn("next_action must be a non-empty string", json.dumps(row["candidate_rejections"]))

    def test_missing_complete_candidate_remains_truncation_outcome(self) -> None:
        partial = "MLGO_RESULT_PACKET\n{\n"
        fake = FakeCAO([partial])
        clock = FakeClock()
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ModelOutputIncomplete) as raised:
                capture_stable_result(
                    endpoint="http://cao", terminal_id=TERMINAL_ID,
                    phase=phase(), decision=decision(), policy=policy(),
                    evidence_directory=td, run_step_response={"terminal_id": TERMINAL_ID},
                    request=fake, monotonic=clock.monotonic, sleep=clock.sleep,
                )
            self.assertEqual(raised.exception.contract_outcome, "POST_MODEL_CONTRACT_TRUNCATION")
            self.assertIsNone(raised.exception.precise_rejection)


if __name__ == "__main__":
    unittest.main()
