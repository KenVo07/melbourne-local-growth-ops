"""Slice 4 gap closure: a real, non-bypassed child-provider transport.

The legacy ``cao-server`` (a separate, out-of-repo v1 service ``dispatch.py``
can route through) was found to hardcode permission bypass when it launches a
provider session ("bypass permissions on" / Codex "YOLO mode"), regardless of
what the ApprovalBroker decided. That is not a v2 defect to patch inside a
service this repo does not own; it is a missing real path. This module is
that path: the smallest clean :class:`~.transport.TransportAdapter` that
launches the real provider CLI directly, governed entirely by the
ApprovalBroker decision and the compiled SkillContract, and never passes a
bypass flag (``--dangerously-skip-permissions`` /
``--dangerously-bypass-approvals-and-sandbox``) under any circumstance.

Two properties make this a real integration rather than a scripted one-off:

* **ApprovalBroker drives native preauthorization.**  The broker's
  ``approved_operation_constraints`` (bounded to the phase's own owned-scope
  worktree) are translated into the provider's own native, non-interactive
  authorization mechanism - Claude's ``--permission-mode acceptEdits
  --allowedTools <scoped>``, Codex's ``-s workspace-write`` - never a runtime
  prompt that has to be watched and clicked.  :class:`PermissionAdapter`
  records this as ``PREAUTHORIZED`` *before* the child process starts.
* **The observed outcome is normalized through the same PermissionAdapter
  contract everything else in the codebase uses.**  Provider-specific
  evidence (Claude's structured ``permission_denials`` field; Codex's
  per-item ``status``/exit codes) is mapped to one of the shared
  ``OBSERVED_STATES`` by a real ``observation_map``, not by ad hoc string
  matching in caller code, and every observation is written durably to the
  run's v2 directory so a truthful ``WAITING_FOR_APPROVAL`` (or any other
  state) survives a restart rather than living only in a terminal a human
  happened to be watching.

Provider-specific launch mechanics (the exact CLI flags) live entirely in
this module. Nothing above this module needs to know a provider name.
"""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from .approval import APPROVED, DENIED, NOT_REQUIRED, PREAUTHORIZED, UNKNOWN_RECONCILIATION_REQUIRED
from .approval_broker import CLASS_READ_IN_SCOPE, CLASS_WRITE_IN_OWNED_SCOPE
from .common import ContractError, atomic_write_json, atomic_write_text, iso_now, sha256_bytes
from .permission_adapter import (
    CAP_NATIVE_PREAUTHORIZATION,
    MATURITY_QUALIFIED,
    PermissionAdapter,
    effective_permission_capability,
    new_adapter_qualification,
)
from .transport import ObservationState, ReconcileResult, SubmitCertainty, SubmitResult

#: Flags that must never appear in a launch argv built by this module.
FORBIDDEN_BYPASS_FLAGS = frozenset({
    "--dangerously-skip-permissions",
    "--allow-dangerously-skip-permissions",
    "--dangerously-bypass-approvals-and-sandbox",
    "--dangerously-bypass-hook-trust",
})


class BypassRefused(ContractError):
    """Raised if a launch argv would have contained a forbidden bypass flag."""


def _assert_no_bypass(argv: list[str]) -> None:
    hit = FORBIDDEN_BYPASS_FLAGS.intersection(argv)
    if hit:
        raise BypassRefused(f"refusing to launch with bypass flag(s): {sorted(hit)}")


# ---------------------------------------------------------------------------
# Provider-neutral observed-state vocabulary for each real CLI's own evidence
# ---------------------------------------------------------------------------

CLAUDE_OBSERVATION_MAP = {
    "claude.cli.preauthorized_before_launch": PREAUTHORIZED,
    "claude.cli.completed_no_permission_denials": APPROVED,
    "claude.cli.completed_no_tool_use": NOT_REQUIRED,
    "claude.cli.permission_denied": DENIED,
}

CODEX_OBSERVATION_MAP = {
    "codex.cli.preauthorized_before_launch": PREAUTHORIZED,
    "codex.cli.turn_completed_all_items_succeeded": APPROVED,
    "codex.cli.completed_no_tool_use": NOT_REQUIRED,
    "codex.cli.sandbox_denied_or_command_failed": DENIED,
}


class ClaudeCliPermissionAdapter(PermissionAdapter):
    observation_map = CLAUDE_OBSERVATION_MAP


class CodexCliPermissionAdapter(PermissionAdapter):
    observation_map = CODEX_OBSERVATION_MAP


def _scoped_allowed_tools(*, operation_class: str, worktree_path: str) -> list[str]:
    """Translate the ApprovalBroker's owned-scope decision into Claude's own
    native tool-scoping flags - the mechanism, not a runtime prompt."""

    if operation_class == CLASS_WRITE_IN_OWNED_SCOPE:
        return [f"Write({worktree_path}/**)", f"Edit({worktree_path}/**)", "Read", "Glob", "Grep"]
    if operation_class == CLASS_READ_IN_SCOPE:
        return ["Read", "Glob", "Grep"]
    raise ContractError(f"child transport does not govern operation class {operation_class!r}")


def _claude_permission_mode(operation_class: str) -> str:
    if operation_class == CLASS_WRITE_IN_OWNED_SCOPE:
        return "acceptEdits"
    return "default"


def _codex_sandbox(operation_class: str) -> str:
    if operation_class == CLASS_WRITE_IN_OWNED_SCOPE:
        return "workspace-write"
    return "read-only"


class ChildProcessTransportAdapter:
    """A real TransportAdapter that launches the provider CLI directly.

    One instance governs one child-provider dispatch. ``submit`` is a single
    blocking call (both ``claude -p`` and ``codex exec`` run one turn to
    completion synchronously), so ``observe``/``reconcile`` simply report the
    already-durable outcome rather than polling an in-flight job.
    """

    def __init__(
        self,
        *,
        provider: str,
        worktree_path: str,
        evidence_dir: Path,
        timeout_seconds: float = 180.0,
    ):
        if provider not in ("claude_code", "codex"):
            raise ContractError(f"unsupported child transport provider: {provider!r}")
        self.adapter_id = f"cao-child-direct-{provider}"
        self.provider = provider
        self.worktree_path = worktree_path
        self.evidence_dir = Path(evidence_dir)
        self.evidence_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.timeout_seconds = timeout_seconds

    # -- TransportAdapter protocol (unused legs are explicit no-ops: this is
    #    a synchronous one-shot transport, not a resumable session) ---------

    def prepare(self, command: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
        return {}

    def open(self, command: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
        return {}

    def resume(self, command: dict[str, Any], conversation_handle: dict[str, Any]) -> dict[str, Any]:
        raise ContractError("child-direct transport is one-shot; it has no session to resume")

    def submit(self, command: dict[str, Any], request: dict[str, Any]) -> SubmitResult:
        """Launch the real provider, never bypassed, governed by the
        ApprovalBroker decision and the compiled SkillContract's native
        projection - both required keys of ``request``."""

        decision = request["approval_decision"]
        permission_adapter: PermissionAdapter = request["permission_adapter"]
        capability_state: dict[str, Any] = request["capability_state"]
        prompt_text: str = request["prompt_text"]
        native_skill_projection_text: str = request.get("native_skill_projection_text", "")
        operation_class: str = request["operation_class"]

        if not capability_state.get("enabled"):
            raise ContractError(
                f"native preauthorization is not qualified/enabled for this adapter identity: "
                f"{capability_state.get('reason')}"
            )
        preauth = permission_adapter.prepare_native_preauthorization(
            decision=decision, capability_state=capability_state,
        )
        atomic_write_json(self.evidence_dir / "preauthorization.json", preauth)

        if self.provider == "claude_code":
            result = self._submit_claude(operation_class=operation_class, prompt_text=prompt_text, native_skill_projection_text=native_skill_projection_text)
        else:
            result = self._submit_codex(operation_class=operation_class, prompt_text=prompt_text, native_skill_projection_text=native_skill_projection_text)

        observation = permission_adapter.normalize_observation(result["evidence"])
        observation["bound_decision_id"] = decision["decision_id"]
        observation["bound_request_digest"] = decision["request_digest"]
        atomic_write_json(self.evidence_dir / "permission-observation.json", observation)

        if observation["observed_state"] == DENIED:
            return SubmitResult(
                certainty=SubmitCertainty.ACCEPTED, provider_started=True,
                response={"denied": True, "observation": observation, "raw": result["raw_summary"]},
            )
        if observation["observed_state"] == UNKNOWN_RECONCILIATION_REQUIRED:
            raise ContractError(
                f"child provider evidence did not map to a known state: {observation['reason']}"
            )
        return SubmitResult(
            certainty=SubmitCertainty.ACCEPTED, provider_started=True,
            response={"denied": False, "observation": observation, "result": result},
        )

    def observe(self, command: dict[str, Any], receipt_id: str | None) -> ReconcileResult:
        obs_path = self.evidence_dir / "permission-observation.json"
        if not obs_path.is_file():
            return ReconcileResult(state=ObservationState.UNKNOWN)
        return ReconcileResult(state=ObservationState.COMPLETED, exact=True)

    def reconcile(self, command: dict[str, Any]) -> ReconcileResult:
        return self.observe(command, None)

    def cancel(self, command: dict[str, Any], receipt_id: str | None) -> ReconcileResult:
        # One-shot child processes are already finished by the time submit()
        # returns; there is nothing in-flight left to cancel.
        return ReconcileResult(state=ObservationState.COMPLETED, exact=True)

    def cleanup(self, command: dict[str, Any], receipt_id: str | None) -> dict[str, Any]:
        return {"cleaned": True}

    # -- provider-specific launch mechanics ---------------------------------

    def _submit_claude(self, *, operation_class: str, prompt_text: str, native_skill_projection_text: str) -> dict[str, Any]:
        permission_mode = _claude_permission_mode(operation_class)
        allowed_tools = _scoped_allowed_tools(operation_class=operation_class, worktree_path=self.worktree_path)
        argv = ["claude", "-p", prompt_text, "--permission-mode", permission_mode,
                "--allowedTools", *allowed_tools, "--output-format", "stream-json", "--verbose"]
        if native_skill_projection_text:
            argv += ["--append-system-prompt", native_skill_projection_text]
        _assert_no_bypass(argv)

        argv_record = list(argv)
        if native_skill_projection_text:
            idx = argv_record.index("--append-system-prompt")
            argv_record[idx + 1] = f"<{len(native_skill_projection_text)} bytes, digest {sha256_bytes(native_skill_projection_text.encode())[:16]}>"
        atomic_write_json(self.evidence_dir / "launch-argv.json", {"argv": argv_record, "cwd": self.worktree_path, "launched_at": iso_now()})

        proc = subprocess.run(argv, cwd=self.worktree_path, capture_output=True, text=True, timeout=self.timeout_seconds)
        atomic_write_text(self.evidence_dir / "raw-stdout.jsonl", proc.stdout)
        if proc.stderr:
            atomic_write_text(self.evidence_dir / "raw-stderr.txt", proc.stderr)

        init_event = None
        result_event = None
        tool_use_count = 0
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "system" and event.get("subtype") == "init":
                init_event = event
            if event.get("type") == "assistant":
                for block in (event.get("message") or {}).get("content") or []:
                    if block.get("type") == "tool_use":
                        tool_use_count += 1
            if event.get("type") == "result":
                result_event = event

        if init_event is not None and init_event.get("permissionMode") == "bypassPermissions":
            raise BypassRefused("child claude session reports permissionMode=bypassPermissions")

        if result_event is None:
            evidence = {"token": None, "remember_offered": False}
        else:
            denials = result_event.get("permission_denials") or []
            if denials:
                evidence = {"token": "claude.cli.permission_denied", "remember_offered": False, "denials": denials}
            elif tool_use_count == 0:
                evidence = {"token": "claude.cli.completed_no_tool_use", "remember_offered": False}
            else:
                evidence = {"token": "claude.cli.completed_no_permission_denials", "remember_offered": False}

        return {
            "evidence": evidence,
            "raw_summary": {
                "permission_mode_observed": (init_event or {}).get("permissionMode"),
                "allowed_tools_requested": allowed_tools,
                "tool_use_count": tool_use_count,
                "is_error": (result_event or {}).get("is_error"),
                "total_cost_usd": (result_event or {}).get("total_cost_usd"),
                "usage": (result_event or {}).get("usage"),
                "session_id": (init_event or {}).get("session_id"),
            },
        }

    def _submit_codex(self, *, operation_class: str, prompt_text: str, native_skill_projection_text: str) -> dict[str, Any]:
        sandbox = _codex_sandbox(operation_class)
        full_prompt = prompt_text
        if native_skill_projection_text:
            full_prompt = (
                "The following are CAO-selected canonical skill instructions for this task. "
                "Follow them for guidance on this task only.\n\n"
                + native_skill_projection_text + "\n\n---\n\n" + prompt_text
            )
        argv = ["codex", "exec", "--json", "-s", sandbox, "-C", self.worktree_path, full_prompt]
        _assert_no_bypass(argv)

        argv_record = list(argv)
        argv_record[-1] = f"<prompt, {len(full_prompt)} bytes>"
        atomic_write_json(self.evidence_dir / "launch-argv.json", {"argv": argv_record, "cwd": self.worktree_path, "sandbox": sandbox, "launched_at": iso_now()})

        proc = subprocess.run(argv, cwd=self.worktree_path, capture_output=True, text=True, timeout=self.timeout_seconds)
        atomic_write_text(self.evidence_dir / "raw-stdout.jsonl", proc.stdout)
        if proc.stderr:
            atomic_write_text(self.evidence_dir / "raw-stderr.txt", proc.stderr)

        items: list[dict[str, Any]] = []
        turn_completed = None
        for line in proc.stdout.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") == "item.completed":
                items.append(event["item"])
            if event.get("type") == "turn.completed":
                turn_completed = event
            if event.get("type") == "turn.failed":
                turn_completed = event

        failed_items = [
            i for i in items
            if i.get("type") == "command_execution" and i.get("exit_code") not in (0, None)
        ]
        tool_items = [i for i in items if i.get("type") in ("file_change", "command_execution")]

        if turn_completed is None or turn_completed.get("type") == "turn.failed":
            evidence = {"token": "codex.cli.sandbox_denied_or_command_failed", "remember_offered": False, "turn": turn_completed}
        elif failed_items:
            evidence = {"token": "codex.cli.sandbox_denied_or_command_failed", "remember_offered": False, "failed_items": failed_items}
        elif not tool_items:
            evidence = {"token": "codex.cli.completed_no_tool_use", "remember_offered": False}
        else:
            evidence = {"token": "codex.cli.turn_completed_all_items_succeeded", "remember_offered": False}

        return {
            "evidence": evidence,
            "raw_summary": {
                "sandbox_observed": sandbox,
                "item_count": len(items),
                "tool_item_count": len(tool_items),
                "failed_item_count": len(failed_items),
                "usage": (turn_completed or {}).get("usage"),
            },
        }
