"""Result-aware provider completion and Herdr preflight boundaries.

CAO's run-step response proves that the provider execution reached CAO's
semantic completion edge.  It does not prove that a terminal-rendered
structured result has fully settled.  This module keeps the returned terminal
alive, polls the authoritative CAO terminal-output surface for a bounded settle
window, and accepts a result only after the same complete marked packet is
observed on consecutive reads.
"""

from __future__ import annotations

import hashlib
import json
import os
import stat
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from .common import ContractError, PolicyError, atomic_write_json, atomic_write_text, iso_now, sha256_json
from .contracts import ResultPacketExtractionError, extract_result_packet_with_provenance
from .http_client import HTTPError, request_json, request_json_value


class ModelOutputIncomplete(ContractError):
    """The provider settled, but no stable valid structured result arrived."""

    def __init__(
        self,
        message: str,
        *,
        terminal_id: str,
        evidence_path: str,
        precise_rejection: dict[str, Any] | None = None,
        parser_rejections: list[dict[str, Any]] | None = None,
    ):
        self.terminal_id = terminal_id
        self.evidence_path = evidence_path
        self.outcome = "MODEL_OUTPUT_INCOMPLETE"
        self.precise_rejection = precise_rejection
        self.parser_rejections = list(parser_rejections or [])
        self.contract_outcome = (
            "POST_MODEL_RESULT_CONTRACT_MISMATCH"
            if precise_rejection is not None
            else "POST_MODEL_CONTRACT_TRUNCATION"
        )
        super().__init__(message)


class TerminalProvenanceError(ContractError):
    """CAO terminal metadata does not match the host routing decision."""


class HerdrPreflightError(PolicyError):
    """The named Herdr/CAO execution boundary is not ready for a live call."""


def _completion_policy(policy: dict[str, Any]) -> dict[str, Any]:
    configured = dict(policy.get("result_aware_completion") or {})
    configured.setdefault("enabled", True)
    configured.setdefault("settle_window_seconds", 45.0)
    configured.setdefault("poll_interval_seconds", 1.0)
    configured.setdefault("stable_complete_reads", 2)
    configured.setdefault("primary_output_mode", "last")
    configured.setdefault("forensic_output_mode", "full")
    configured.setdefault("full_output_is_forensic_only", True)
    configured.setdefault("graceful_exit_timeout_seconds", 30.0)
    configured.setdefault("delete_timeout_seconds", 60.0)
    if configured["primary_output_mode"] != "last":
        raise PolicyError("result-aware completion requires primary CAO output mode=last")
    if configured["forensic_output_mode"] != "full":
        raise PolicyError("result-aware completion requires forensic CAO output mode=full")
    if configured.get("full_output_is_forensic_only") is not True:
        raise PolicyError("full terminal output must remain forensic-only")
    if float(configured["settle_window_seconds"]) <= 0:
        raise PolicyError("result settle window must be positive")
    if float(configured["poll_interval_seconds"]) <= 0:
        raise PolicyError("result poll interval must be positive")
    if int(configured["stable_complete_reads"]) < 2:
        raise PolicyError("result-aware completion requires at least two stable complete reads")
    return configured

def _parser_rejection(exc: ContractError) -> dict[str, Any]:
    """Return an exact, JSON-serializable parser/contract rejection record."""

    rejections = list(getattr(exc, "rejections", []) or [])
    return {
        "error_type": type(exc).__name__,
        "error": str(exc),
        "candidate_count": int(getattr(exc, "candidate_count", 0) or 0),
        "candidate_rejections": rejections,
    }


def _strongest_rejection(diagnostic: dict[str, Any]) -> dict[str, Any] | None:
    """Prefer the newest complete marked candidate's exact contract rejection."""

    rows = diagnostic.get("candidate_rejections") or []
    if not rows:
        return None
    newest = dict(rows[0])
    return {
        "error_type": diagnostic.get("error_type"),
        "aggregate_error": diagnostic.get("error"),
        "candidate_count": diagnostic.get("candidate_count"),
        "candidate_rejection": newest,
    }


def validate_terminal_provenance(
    metadata: dict[str, Any],
    *,
    terminal_id: str,
    expected_provider: str,
    expected_profile: str,
) -> dict[str, Any]:
    observed_id = str(metadata.get("id") or "")
    observed_provider = str(metadata.get("provider") or "")
    observed_profile = str(metadata.get("agent_profile") or "")
    if observed_id != terminal_id:
        raise TerminalProvenanceError(
            f"terminal metadata id mismatch: expected {terminal_id}, observed {observed_id!r}"
        )
    if observed_provider != expected_provider:
        raise TerminalProvenanceError(
            f"terminal provider mismatch: expected {expected_provider}, observed {observed_provider!r}"
        )
    if observed_profile != expected_profile:
        raise TerminalProvenanceError(
            f"terminal profile mismatch: expected {expected_profile}, observed {observed_profile!r}"
        )
    return metadata


def _safe_observation_name(index: int) -> str:
    return f"observation-{index:04d}"


def capture_stable_result(
    *,
    endpoint: str,
    terminal_id: str,
    phase: dict[str, Any],
    decision: dict[str, Any],
    policy: dict[str, Any],
    evidence_directory: str | Path,
    run_step_response: dict[str, Any],
    run_step_metadata: dict[str, Any] | None = None,
    request: Callable[..., dict[str, Any]] = request_json,
    monotonic: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> tuple[dict[str, Any], dict[str, Any]]:
    """Capture a stable structured result from CAO ``mode=last`` output.

    ``mode=full`` is persisted on every poll for forensic reconstruction only.
    It is a rendered TUI screen and is never treated as a clean provider result
    by the normal runtime parser.  Acceptance requires the same validated
    marked packet on at least two consecutive ``mode=last`` reads.
    """

    settings = _completion_policy(policy)
    evidence = Path(evidence_directory).resolve()
    observations = evidence / "result-observations"
    observations.mkdir(parents=True, exist_ok=True)
    rejection_evidence = evidence / "parser-rejections"
    rejection_evidence.mkdir(parents=True, exist_ok=True)
    atomic_write_json(evidence / "run-step-response.json", run_step_response)
    atomic_write_text(
        evidence / "run-step-last-message.txt",
        str(run_step_response.get("last_message") or ""),
    )
    boundary = dict(run_step_metadata or {})
    if boundary:
        atomic_write_json(evidence / "provider-execution-boundary.json", boundary)

    registry = policy.get("_registry")
    if isinstance(registry, dict) and decision.get("selected_route") in registry.get("routes", {}):
        route_cfg = registry["routes"][decision["selected_route"]]
        expected_provider = str(registry["providers"][route_cfg["provider_id"]]["runtime_provider"])
    else:
        # Compatibility for pre-registry decision fixtures and existing legacy runs.
        expected_provider = (
            "antigravity_cli"
            if decision["selected_provider"] == "agy"
            else str(decision["selected_provider"])
        )
    expected_profile = str(decision["selected_profile"])
    deadline = monotonic() + float(settings["settle_window_seconds"])
    poll_interval = float(settings["poll_interval_seconds"])
    required_stable = int(settings["stable_complete_reads"])

    observation_index = 0
    stable_count = 0
    last_block_sha: str | None = None
    best_last = ""
    best_full = ""
    last_observation: dict[str, Any] | None = None
    final_packet: dict[str, Any] | None = None
    final_block = ""
    final_last = ""
    final_full = ""
    final_metadata: dict[str, Any] | None = None
    final_candidate_provenance: dict[str, Any] | None = None
    parser_rejection_history: list[dict[str, Any]] = []
    latest_parser_rejection: dict[str, Any] | None = None
    strongest_parser_rejection: dict[str, Any] | None = None

    while True:
        observation_index += 1
        observed_at = iso_now()
        name = _safe_observation_name(observation_index)
        metadata = request(
            endpoint.rstrip("/") + f"/terminals/{terminal_id}",
            method="GET",
            timeout=30.0,
        )
        terminal_record = {
            "observed_at": observed_at,
            "terminal_id_requested": terminal_id,
            "terminal_metadata": metadata,
            "terminal_metadata_sha256": sha256_json(metadata),
        }
        atomic_write_json(observations / f"{name}-terminal.json", terminal_record)
        validate_terminal_provenance(
            metadata,
            terminal_id=terminal_id,
            expected_provider=expected_provider,
            expected_profile=expected_profile,
        )

        outputs: dict[str, dict[str, Any]] = {}
        for mode, role in (
            (str(settings["primary_output_mode"]), "authoritative_candidate"),
            (str(settings["forensic_output_mode"]), "forensic_only"),
        ):
            requested_at = iso_now()
            response = request(
                endpoint.rstrip("/") + f"/terminals/{terminal_id}/output",
                method="GET",
                query={"mode": mode},
                timeout=30.0,
            )
            raw = response.get("output")
            if not isinstance(raw, str):
                raise ContractError(
                    f"CAO terminal-output response for mode={mode} did not contain string output"
                )
            path = observations / f"{name}-{mode}.txt"
            atomic_write_text(path, raw)
            outputs[mode] = {
                "request_mode": mode,
                "role": role,
                "requested_at": requested_at,
                "persisted_at": iso_now(),
                "path": str(path),
                "bytes": len(raw.encode("utf-8")),
                "sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest(),
                "raw": raw,
            }

        last_output = outputs["last"]["raw"]
        full_output = outputs["full"]["raw"]
        if len(last_output.encode("utf-8")) >= len(best_last.encode("utf-8")):
            best_last = last_output
        if len(full_output.encode("utf-8")) >= len(best_full.encode("utf-8")):
            best_full = full_output

        record: dict[str, Any] = {
            "schema_version": "1.1",
            "observation_index": observation_index,
            "observed_at": observed_at,
            "terminal_id": terminal_id,
            "expected_provider": expected_provider,
            "expected_profile": expected_profile,
            "expected_model": decision.get("selected_model"),
            "terminal_metadata": metadata,
            "terminal_metadata_sha256": sha256_json(metadata),
            "primary_output_mode": "last",
            "forensic_output_mode": "full",
            "outputs": {
                mode: {k: v for k, v in value.items() if k != "raw"}
                for mode, value in outputs.items()
            },
            "complete_packet": False,
            "parse_error": None,
            "parse_rejection": None,
            "candidate_provenance": None,
            "result_block_sha256": None,
            "stable_complete_reads": stable_count,
        }
        try:
            packet, marked_block, candidate_provenance = extract_result_packet_with_provenance(
                last_output,
                phase,
                provider=expected_provider,
            )
            block_sha = hashlib.sha256(marked_block.encode("utf-8")).hexdigest()
            if block_sha == last_block_sha:
                stable_count += 1
            else:
                last_block_sha = block_sha
                stable_count = 1
            record.update(
                {
                    "complete_packet": True,
                    "result_block_sha256": block_sha,
                    "stable_complete_reads": stable_count,
                    "result_status": packet.get("status"),
                    "candidate_provenance": candidate_provenance,
                }
            )
            final_packet = packet
            final_block = marked_block
            final_last = last_output
            final_full = full_output
            final_metadata = metadata
            final_candidate_provenance = candidate_provenance
        except ContractError as exc:
            stable_count = 0
            last_block_sha = None
            diagnostic = _parser_rejection(exc)
            rejection_record = {
                "schema_version": "1.0",
                "observation_index": observation_index,
                "observed_at": observed_at,
                "terminal_id": terminal_id,
                "authoritative_source_mode": "last",
                "authoritative_output_sha256": outputs["last"]["sha256"],
                **diagnostic,
            }
            record["parse_error"] = str(exc)
            record["parse_rejection"] = rejection_record
            atomic_write_json(
                rejection_evidence / f"rejection-{observation_index:04d}.json",
                rejection_record,
            )
            parser_rejection_history.append(rejection_record)
            latest_parser_rejection = rejection_record
            precise = _strongest_rejection(diagnostic)
            if precise is not None:
                strongest_parser_rejection = {
                    "observation_index": observation_index,
                    "observed_at": observed_at,
                    "authoritative_output_sha256": outputs["last"]["sha256"],
                    **precise,
                }
        atomic_write_json(observations / f"{name}.json", record)
        last_observation = record

        if final_packet is not None and stable_count >= required_stable:
            authoritative_last = evidence / "authoritative-last-output.txt"
            authoritative_full = evidence / "authoritative-full-output.txt"
            authoritative_block = evidence / "authoritative-result-block.txt"
            atomic_write_text(authoritative_last, final_last)
            atomic_write_text(authoritative_full, final_full)
            atomic_write_text(
                authoritative_block,
                final_block + ("\n" if not final_block.endswith("\n") else ""),
            )
            capture = {
                "schema_version": "1.1",
                "outcome": "RESULT_PACKET_STABLE",
                "captured_at": iso_now(),
                "terminal_id": terminal_id,
                "run_id": phase["run_id"],
                "big_task_id": phase["big_task_id"],
                "phase_id": phase["phase_id"],
                "provider": expected_provider,
                "profile": expected_profile,
                "model": decision.get("selected_model"),
                "routing_decision_sha256": sha256_json(decision),
                "host_execution_boundary": boundary or None,
                "host_execution_boundary_sha256": sha256_json(boundary) if boundary else None,
                "host_requested_model": boundary.get("requested_model") if boundary else decision.get("selected_model"),
                "terminal_metadata": final_metadata,
                "terminal_metadata_sha256": sha256_json(final_metadata),
                "authoritative_source_mode": "last",
                "authoritative_raw_path": str(authoritative_last),
                "authoritative_raw_sha256": hashlib.sha256(final_last.encode("utf-8")).hexdigest(),
                "authoritative_last_output_path": str(authoritative_last),
                "authoritative_last_output_sha256": hashlib.sha256(final_last.encode("utf-8")).hexdigest(),
                "forensic_full_output_path": str(authoritative_full),
                "forensic_full_output_sha256": hashlib.sha256(final_full.encode("utf-8")).hexdigest(),
                "authoritative_result_block_path": str(authoritative_block),
                "authoritative_result_block_sha256": last_block_sha,
                "candidate_provenance": final_candidate_provenance,
                "stable_complete_reads": stable_count,
                "observation_count": observation_index,
                "run_step_response_path": str(evidence / "run-step-response.json"),
            }
            atomic_write_json(evidence / "completion-capture.json", capture)
            return final_packet, capture

        if monotonic() >= deadline:
            break
        sleep(poll_interval)

    best_last_path = evidence / "best-last-output.txt"
    best_full_path = evidence / "best-full-output.txt"
    atomic_write_text(best_last_path, best_last)
    atomic_write_text(best_full_path, best_full)
    timeout_record = {
        "schema_version": "1.1",
        "outcome": "MODEL_OUTPUT_INCOMPLETE",
        "timed_out_at": iso_now(),
        "terminal_id": terminal_id,
        "run_id": phase["run_id"],
        "big_task_id": phase["big_task_id"],
        "phase_id": phase["phase_id"],
        "provider": expected_provider,
        "profile": expected_profile,
        "model": decision.get("selected_model"),
        "settle_window_seconds": float(settings["settle_window_seconds"]),
        "host_execution_boundary": boundary or None,
        "host_execution_boundary_sha256": sha256_json(boundary) if boundary else None,
        "stable_complete_reads_required": required_stable,
        "observation_count": observation_index,
        "best_last_output_path": str(best_last_path),
        "best_last_output_sha256": hashlib.sha256(best_last.encode("utf-8")).hexdigest(),
        "best_full_output_path": str(best_full_path),
        "best_full_output_sha256": hashlib.sha256(best_full.encode("utf-8")).hexdigest(),
        "last_observation": last_observation,
        "latest_parser_rejection": latest_parser_rejection,
        "strongest_parser_rejection": strongest_parser_rejection,
        "parser_rejection_history": parser_rejection_history,
        "run_step_response_path": str(evidence / "run-step-response.json"),
        "note": (
            "No packet, marker, JSON token, punctuation, key or value was fabricated. "
            "mode=last and mode=full observations are preserved verbatim; full output was not parsed as clean model output."
        ),
    }
    atomic_write_json(evidence / "completion-timeout.json", timeout_record)
    if strongest_parser_rejection is not None:
        exact_error = strongest_parser_rejection["candidate_rejection"].get("error")
        message = (
            "provider execution settled and a complete marked result candidate was observed, "
            f"but the result contract remained invalid: {exact_error}"
        )
    else:
        message = (
            "provider execution settled but no stable complete MLGO result packet arrived "
            "on authoritative mode=last within the bounded settle window"
        )
    raise ModelOutputIncomplete(
        message,
        terminal_id=terminal_id,
        evidence_path=str(evidence),
        precise_rejection=strongest_parser_rejection,
        parser_rejections=parser_rejection_history,
    )

def cleanup_retained_terminal(
    *,
    endpoint: str,
    terminal_id: str,
    evidence_directory: str | Path,
    policy: dict[str, Any],
    request: Callable[..., dict[str, Any]] = request_json,
) -> dict[str, Any]:
    """Gracefully exit and delete a retained terminal after evidence capture."""

    settings = _completion_policy(policy)
    evidence = Path(evidence_directory).resolve()
    record: dict[str, Any] = {
        "schema_version": "1.0",
        "terminal_id": terminal_id,
        "started_at": iso_now(),
        "exit": None,
        "delete": None,
        "status": "STARTED",
    }
    try:
        try:
            record["exit"] = request(
                endpoint.rstrip("/") + f"/terminals/{terminal_id}/exit",
                method="POST",
                timeout=float(settings["graceful_exit_timeout_seconds"]),
            )
        except HTTPError as exc:
            record["exit"] = {"error": str(exc), "http_status": exc.status}
        try:
            record["delete"] = request(
                endpoint.rstrip("/") + f"/terminals/{terminal_id}",
                method="DELETE",
                timeout=float(settings["delete_timeout_seconds"]),
            )
            record["status"] = "DELETED"
        except HTTPError as exc:
            if exc.status == 404:
                record["delete"] = {"status": "ALREADY_ABSENT", "http_status": 404}
                record["status"] = "ALREADY_ABSENT"
            else:
                record["delete"] = {"error": str(exc), "http_status": exc.status}
                record["status"] = "DELETE_FAILED"
    finally:
        record["finished_at"] = iso_now()
        atomic_write_json(evidence / "terminal-cleanup.json", record)
    if record["status"] == "DELETE_FAILED":
        raise PolicyError(f"retained terminal {terminal_id} could not be deleted after evidence capture")
    return record


def _run_command(
    argv: list[str],
    *,
    timeout: float = 30.0,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
) -> subprocess.CompletedProcess[str]:
    return runner(argv, capture_output=True, text=True, timeout=timeout)


def preflight_herdr_boundary(
    policy: dict[str, Any],
    *,
    session_name: str | None = None,
    request_value: Callable[..., Any] = request_json_value,
    runner: Callable[..., subprocess.CompletedProcess[str]] = subprocess.run,
    home: str | Path | None = None,
) -> dict[str, Any]:
    """Read-only Herdr/CAO dependency check performed before live reservation."""

    session = session_name or str(policy.get("main_cao_session") or "mlgo-cao")
    home_path = Path(home or os.environ.get("HOME") or str(Path.home())).expanduser()
    socket_path = home_path / ".config" / "herdr" / "sessions" / session / "herdr.sock"

    version = _run_command(["herdr", "--version"], runner=runner)
    if version.returncode != 0:
        raise HerdrPreflightError(f"herdr --version failed: {version.stderr.strip()}")
    sessions = _run_command(["herdr", "session", "list"], runner=runner)
    if sessions.returncode != 0:
        raise HerdrPreflightError(f"herdr session list failed: {sessions.stderr.strip()}")
    matching = [line for line in sessions.stdout.splitlines() if line.split()[:1] == [session]]
    if not matching or "running" not in matching[0].split():
        raise HerdrPreflightError(f"required Herdr session {session!r} is not running")
    try:
        mode = socket_path.stat().st_mode
    except FileNotFoundError as exc:
        raise HerdrPreflightError(f"Herdr socket does not exist: {socket_path}") from exc
    if not stat.S_ISSOCK(mode):
        raise HerdrPreflightError(f"Herdr path is not a UNIX socket: {socket_path}")

    workspaces = _run_command(["herdr", "--session", session, "workspace", "list"], runner=runner)
    if workspaces.returncode != 0:
        raise HerdrPreflightError(
            f"Herdr session socket did not answer workspace enumeration: {workspaces.stderr.strip()}"
        )
    try:
        workspace_payload = json.loads(workspaces.stdout)
    except json.JSONDecodeError as exc:
        raise HerdrPreflightError("Herdr workspace enumeration did not return JSON") from exc

    api = str(policy["main_cao_api"]).rstrip("/")
    health = request_value(api + "/health", method="GET", timeout=15.0)
    cao_sessions = request_value(api + "/sessions", method="GET", timeout=30.0)
    if not isinstance(cao_sessions, list):
        raise HerdrPreflightError("CAO /sessions did not return an enumerable session list")

    return {
        "schema_version": "1.0",
        "status": "PASS",
        "checked_at": iso_now(),
        "herdr_version": version.stdout.strip(),
        "herdr_session": session,
        "herdr_session_line": matching[0],
        "socket_path": str(socket_path),
        "socket_type": "unix",
        "workspace_enumeration_sha256": sha256_json(workspace_payload),
        "cao_health": health,
        "cao_session_count": len(cao_sessions),
        "mutation_performed": False,
    }
