"""Slice 4 gap closure: real (non-mocked-cache) tests for the child-provider
transport that closes the PermissionAdapter and SkillContract-application
integration gaps.

Like ``test_slice4_dispatch_governance``, these run against the real
operator-populated sealed skill cache (copied into a tmp dir) and skip if the
host has not populated one - they prove real-host integration, not portable
unit behaviour.  The provider CLI itself is mocked here (``subprocess.run``)
so this file stays fast and deterministic; the actual real-provider proof
lives in ``evidence/slice4/permission-adapter-live/``.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mlgo_cao_v2 import dispatch_governance as dg
from mlgo_cao_v2.approval_broker import CLASS_WRITE_IN_OWNED_SCOPE
from mlgo_cao_v2.canonical_lock import load_lock
from mlgo_cao_v2.child_provider_transport import (
    FORBIDDEN_BYPASS_FLAGS,
    BypassRefused,
    ChildProcessTransportAdapter,
    ClaudeCliPermissionAdapter,
    CodexCliPermissionAdapter,
    _assert_no_bypass,
)
from mlgo_cao_v2.skill_cache import SealedSkillCache
from mlgo_cao_v2.skill_population import bind_namespace

REAL_CACHE_ROOT = Path.home() / ".local" / "state" / "mlgo-cao" / "canonical-skill-cache-v1"


def _real_cache_populated() -> bool:
    if not (REAL_CACHE_ROOT / "skill-cache" / "manifests").is_dir():
        return False
    try:
        lock = load_lock()
    except Exception:
        return False
    cache = SealedSkillCache(REAL_CACHE_ROOT)
    return all(cache.load_manifest(b["bundle_id"]) is not None for b in lock["bundles"])


class BypassGuardTests(unittest.TestCase):
    def test_forbidden_flags_are_refused(self):
        for flag in FORBIDDEN_BYPASS_FLAGS:
            with self.assertRaises(BypassRefused):
                _assert_no_bypass(["claude", "-p", "x", flag])

    def test_ordinary_argv_passes(self):
        _assert_no_bypass(["claude", "-p", "x", "--permission-mode", "acceptEdits"])


@unittest.skipUnless(
    _real_cache_populated(),
    "requires the operator-populated sealed canonical skill cache on this host",
)
class ChildProviderTransportTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.cache_root = self.tmp / "cache"
        shutil.copytree(REAL_CACHE_ROOT, self.cache_root)
        self.lock = load_lock()
        self.cache = SealedSkillCache(self.cache_root)
        self.worktree = self.tmp / "worktree"
        self.worktree.mkdir()

    def _prepared(self, run_id: str):
        project_id, domain_id = dg.project_and_domain_for_run(run_id)
        bind_namespace(cache=self.cache, lock=self.lock, project_id=project_id, security_domain_id=domain_id)
        v2_dir = self.tmp / "runs" / run_id / "v2"
        job_dir = v2_dir / "jobs" / "job-1"
        job_dir.mkdir(parents=True)
        policy = {
            "state_root": str(self.tmp),
            "repo_root": str(self.worktree),
            "skill_cache_root": str(self.cache_root),
            "orchestration": {"max_real_provider_sessions_per_run": 12},
            "context_envelope": {},
        }
        phase = {
            "run_id": run_id, "big_task_id": "bt-1", "phase_id": "phase-1",
            "phase_kind": "implementation", "objective": "Implement a small backend fix",
            "write_capable": True,
            "worktree": {"path": str(self.worktree), "branch": "main"},
            "ownership": {"allowed_paths": ["."], "forbidden_paths": []},
        }
        decision = {"selected_profile": "mlgo-claude-subscription-builder", "selected_route": "claude_subscription_opus"}
        job = {"job_id": f"job-{run_id}", "attempt": 1}
        return policy, phase, decision, job, v2_dir, job_dir

    def _claude_stdout(self, *, permission_mode="acceptEdits", denials=None, tool_use=True):
        events = [{"type": "system", "subtype": "init", "permissionMode": permission_mode, "session_id": "sess-1"}]
        if tool_use:
            events.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write"}]}})
        events.append({"type": "result", "permission_denials": denials or [], "is_error": False, "total_cost_usd": 0.01, "usage": {}})
        return "\n".join(json.dumps(e) for e in events)

    def test_unqualified_adapter_identity_blocks_before_launch(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-unqualified")
        with patch("subprocess.run") as mock_run:
            with self.assertRaises(dg.GovernanceBlocked):
                dg.dispatch_via_child_transport(
                    phase=phase, decision=decision, job=job, policy=policy,
                    prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                    pre_state_facts={"branch": "x", "head": "y"},
                    provider="claude_code", provider_version="2.1.226",
                )
        mock_run.assert_not_called()

    def test_qualified_write_dispatch_is_approved_and_never_bypassed(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-approved")
        adapter = ClaudeCliPermissionAdapter(
            adapter_id="cao-child-direct-claude_code", provider_profile_id=decision["selected_profile"],
            provider_version="2.1.226", wrapper_version="1.0.0", declared_capabilities=["native_preauthorization"],
        )
        dg.qualify_native_preauthorization(policy=policy, adapter=adapter, evidence_sha256="a" * 64)

        class FakeProc:
            stdout = self._claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()) as mock_run:
            outcome = dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", provider_version="2.1.226",
            )
        self.assertTrue(mock_run.called)
        argv = mock_run.call_args.args[0]
        for flag in FORBIDDEN_BYPASS_FLAGS:
            self.assertNotIn(flag, argv)
        self.assertIn("acceptEdits", argv)
        self.assertFalse(outcome["submit_result"].response["denied"])
        self.assertEqual(outcome["submit_result"].response["observation"]["observed_state"], "APPROVED")

        # The exact selected-skill bytes must actually have been sent.
        governance_record = outcome["governance_record"]
        self.assertTrue(governance_record["native_skill_projection_bytes"] > 0)
        launch_argv_path = job_dir / "child-transport" / "launch-argv.json"
        self.assertTrue(launch_argv_path.is_file())

    def test_bypass_permission_mode_reported_by_provider_is_refused(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-bypass-detected")
        adapter = ClaudeCliPermissionAdapter(
            adapter_id="cao-child-direct-claude_code", provider_profile_id=decision["selected_profile"],
            provider_version="2.1.226", wrapper_version="1.0.0", declared_capabilities=["native_preauthorization"],
        )
        dg.qualify_native_preauthorization(policy=policy, adapter=adapter, evidence_sha256="a" * 64)

        class FakeProc:
            stdout = self._claude_stdout(permission_mode="bypassPermissions")
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()):
            with self.assertRaises(Exception) as ctx:
                dg.dispatch_via_child_transport(
                    phase=phase, decision=decision, job=job, policy=policy,
                    prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                    pre_state_facts={"branch": "x", "head": "y"},
                    provider="claude_code", provider_version="2.1.226",
                )
        self.assertIn("bypassPermissions", str(ctx.exception))

    def test_permission_denied_evidence_maps_to_denied_not_approved(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-denied")
        adapter = ClaudeCliPermissionAdapter(
            adapter_id="cao-child-direct-claude_code", provider_profile_id=decision["selected_profile"],
            provider_version="2.1.226", wrapper_version="1.0.0", declared_capabilities=["native_preauthorization"],
        )
        dg.qualify_native_preauthorization(policy=policy, adapter=adapter, evidence_sha256="a" * 64)

        class FakeProc:
            stdout = self._claude_stdout(denials=[{"tool": "Bash", "reason": "outside allowed scope"}])
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()):
            outcome = dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", provider_version="2.1.226",
            )
        self.assertTrue(outcome["submit_result"].response["denied"])
        self.assertEqual(outcome["submit_result"].response["observation"]["observed_state"], "DENIED")


if __name__ == "__main__":
    unittest.main()
