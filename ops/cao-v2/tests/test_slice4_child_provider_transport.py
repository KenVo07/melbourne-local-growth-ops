"""Slice 4 gap closure (round 2): real (non-mocked-cache) tests for the
child-provider transport wired through the actual registry-selected route,
with measured (not caller-supplied) provider identity and no qualification
self-certification.

Like ``test_slice4_dispatch_governance``, these run against the real
operator-populated sealed skill cache and the real installed provider
wrapper scripts (copied/read, never network-called for anything but a fast
``--version`` probe here) - they skip gracefully if the host doesn't have
them, since they prove real-host integration, not portable unit behaviour.
The provider CLI's actual model call is mocked here (``subprocess.run``) so
this file stays fast and deterministic; the real, non-mocked proof lives in
``evidence/slice4/permission-adapter-live/``.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from mlgo_cao_v2 import dispatch_governance as dg
from mlgo_cao_v2.canonical_lock import load_lock
from mlgo_cao_v2.child_provider_transport import FORBIDDEN_BYPASS_FLAGS, BypassRefused, _assert_no_bypass
from mlgo_cao_v2.registry import load_registry, profile as registry_profile
from mlgo_cao_v2.skill_cache import SealedSkillCache
from mlgo_cao_v2.skill_population import bind_namespace

REAL_CACHE_ROOT = Path.home() / ".local" / "state" / "mlgo-cao" / "canonical-skill-cache-v1"
REGISTRY_PATH = Path(__file__).resolve().parents[1] / "registry" / "provider-registry.json"
CLAUDE_WRAPPER = Path.home() / ".local" / "bin" / "mlgo-claude-subscription-high"
CODEX_WRAPPER = Path.home() / ".local" / "bin" / "mlgo-codex-plus"


def _real_cache_populated() -> bool:
    if not (REAL_CACHE_ROOT / "skill-cache" / "manifests").is_dir():
        return False
    try:
        lock = load_lock()
    except Exception:
        return False
    cache = SealedSkillCache(REAL_CACHE_ROOT)
    return all(cache.load_manifest(b["bundle_id"]) is not None for b in lock["bundles"])


def _host_ready() -> bool:
    return _real_cache_populated() and CLAUDE_WRAPPER.is_file() and CODEX_WRAPPER.is_file()


class BypassGuardTests(unittest.TestCase):
    def test_forbidden_flags_are_refused(self):
        for flag in FORBIDDEN_BYPASS_FLAGS:
            with self.assertRaises(BypassRefused):
                _assert_no_bypass(["claude", "-p", "x", flag])

    def test_ordinary_argv_passes(self):
        _assert_no_bypass(["claude", "-p", "x", "--permission-mode", "acceptEdits"])


@unittest.skipUnless(
    _host_ready(),
    "requires the operator-populated sealed cache and installed provider wrapper scripts on this host",
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
        self.registry = load_registry(REGISTRY_PATH)

    def _prepared(self, run_id: str, *, provider: str):
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
        profile_id = "mlgo-claude-subscription-child-direct" if provider == "claude_code" else "mlgo-codex-plus-child-direct"
        route_id = "claude_subscription_child_direct" if provider == "claude_code" else "codex_plus_child_direct"
        phase = {
            "run_id": run_id, "big_task_id": "bt-1", "phase_id": "phase-1",
            "phase_kind": "implementation", "objective": "Implement a small backend fix",
            "write_capable": True,
            "worktree": {"path": str(self.worktree), "branch": "main"},
            "ownership": {"allowed_paths": ["."], "forbidden_paths": []},
        }
        decision = {"selected_profile": profile_id, "selected_route": route_id, "selected_provider": provider}
        job = {"job_id": f"job-{run_id}", "attempt": 1}
        return policy, phase, decision, job, v2_dir, job_dir

    def _claude_stdout(self, *, permission_mode="acceptEdits", denials=None, tool_use=True):
        events = [{"type": "system", "subtype": "init", "permissionMode": permission_mode, "session_id": "sess-1"}]
        if tool_use:
            events.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write"}]}})
        events.append({"type": "result", "permission_denials": denials or [], "is_error": False, "total_cost_usd": 0.01, "usage": {}})
        return "\n".join(json.dumps(e) for e in events)

    def test_first_use_is_a_ceremony_and_qualifies_from_real_evidence_not_a_caller_hash(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-ceremony", provider="claude_code")
        self.assertIsNone(dg.load_qualification(policy=policy, adapter_id="cao-child-direct-claude_code"))

        class FakeProc:
            stdout = self._claude_stdout()
            stderr = ""

        with patch("subprocess.run") as mock_run:
            mock_run.return_value = FakeProc()
            outcome = dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        self.assertTrue(outcome["ceremony_mode"])
        self.assertIsNotNone(outcome["qualification"])
        # The qualification's evidence hash must be derived from the real
        # captured stdout, not any value the test supplied.
        raw = (job_dir / "child-transport" / "raw-stdout.jsonl").read_bytes()
        from mlgo_cao_v2.common import sha256_bytes
        self.assertEqual(outcome["qualification"]["evidence_sha256"], sha256_bytes(raw))

        # A second dispatch for the *same* measured identity is no longer a
        # ceremony - it uses the now-real qualification.
        policy2, phase2, decision2, job2, v2_dir2, job_dir2 = self._prepared("run-qualified", provider="claude_code")
        with patch("subprocess.run") as mock_run2:
            mock_run2.return_value = FakeProc()
            outcome2 = dg.dispatch_via_child_transport(
                phase=phase2, decision=decision2, job=job2, policy=policy,  # same policy/state_root as run 1
                prompt_text="Do the thing.", v2_dir=v2_dir2, job_dir=job_dir2,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        self.assertFalse(outcome2["ceremony_mode"])
        argv = mock_run2.call_args.kwargs.get("timeout") is not None
        launch_argv = json.loads((job_dir2 / "child-transport" / "launch-argv.json").read_text())
        self.assertIn(str(CLAUDE_WRAPPER), launch_argv["argv"][0])
        for flag in FORBIDDEN_BYPASS_FLAGS:
            self.assertNotIn(flag, launch_argv["argv"])

    def test_dispatch_uses_the_route_selected_executable_not_bare_path_binary(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-executable", provider="codex")

        class FakeProc:
            stdout = "\n".join(json.dumps(e) for e in [
                {"type": "item.completed", "item": {"type": "file_change", "changes": [], "status": "completed"}},
                {"type": "turn.completed", "usage": {}},
            ])
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()) as mock_run:
            dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="codex", registry=self.registry,
            )
        # subprocess.run was called at least once for --version (identity
        # measurement) and once for the actual dispatch, both against the
        # resolved wrapper, never a bare "codex".
        for call in mock_run.call_args_list:
            argv = call.args[0]
            self.assertEqual(argv[0], str(CODEX_WRAPPER))
            self.assertNotEqual(argv[0], "codex")

    def test_effective_request_bytes_match_context_envelope_measurement_exactly(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-envelope-match", provider="claude_code")

        class FakeProc:
            stdout = self._claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()):
            outcome = dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        governance_record = outcome["governance_record"]
        effective_request = json.loads(Path(governance_record["effective_provider_request_path"]).read_text())
        # ContextEnvelope's serialized_request_bytes legitimately includes
        # its own JSON accounting envelope (kind/component_id/etc) on top of
        # the payload, but the single component's own "bytes" field - the
        # exact CAO-controlled content, before that envelope - must equal
        # exactly the rendered_text bytes actually sent: not a reference
        # count, not an estimate.
        manifest_path = v2_dir / "context-envelope" / f"manifest-{governance_record['context_manifest_id']}.json"
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(len(manifest["components"]), 1)
        self.assertEqual(
            manifest["components"][0]["bytes"],
            len(effective_request["rendered_text"].encode("utf-8")),
        )
        self.assertGreaterEqual(governance_record["context_manifest_bytes"], manifest["components"][0]["bytes"])
        used = json.loads((job_dir / "child-transport" / "effective-request-used.json").read_text())
        self.assertEqual(used["effective_request_digest"], effective_request["effective_request_digest"])

    def test_stale_qualification_after_identity_drift_fails_closed(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-stale", provider="claude_code")

        class FakeProc:
            stdout = self._claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()):
            dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        # Corrupt the recorded identity to simulate drift (e.g. a provider
        # upgrade) without re-running a real session.
        qual_path = Path(policy["state_root"]) / "governance" / "permission-adapter-qualifications" / "cao-child-direct-claude_code.json"
        record = json.loads(qual_path.read_text())
        record["identity"]["provider_version"] = "drifted-version"
        record["identity_digest"] = "drifted-digest-not-matching-anything"
        qual_path.write_text(json.dumps(record))

        policy2, phase2, decision2, job2, v2_dir2, job_dir2 = self._prepared("run-stale-2", provider="claude_code")
        with patch("subprocess.run", return_value=FakeProc()):
            with self.assertRaises(dg.GovernanceBlocked):
                dg.dispatch_via_child_transport(
                    phase=phase2, decision=decision2, job=job2, policy=policy,
                    prompt_text="Do the thing.", v2_dir=v2_dir2, job_dir=job_dir2,
                    pre_state_facts={"branch": "x", "head": "y"},
                    provider="claude_code", registry=self.registry,
                )


if __name__ == "__main__":
    unittest.main()
