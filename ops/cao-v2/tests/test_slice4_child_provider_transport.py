"""Slice 4 gap closure (round 4): real (non-mocked-cache) tests for the
child-provider transport with qualification separated from normal dispatch,
provider-side Bash scope confinement, and truthful crash/recovery state.

Like ``test_slice4_dispatch_governance``, these run against the real
operator-populated sealed skill cache and the real installed provider
wrapper scripts - they skip gracefully if the host doesn't have them. The
provider CLI's actual model call is mocked here (``subprocess.run``) so this
file stays fast and deterministic; the real, non-mocked proof lives in
``evidence/slice4/qualified-canonical-dispatch/``.
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


def _claude_stdout(*, permission_mode="acceptEdits", denials=None, tool_use=True, bash=False):
    events = [{"type": "system", "subtype": "init", "permissionMode": permission_mode, "session_id": "sess-1"}]
    if bash:
        events.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Bash", "input": {"command": "ls"}}]}})
    if tool_use:
        events.append({"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "Write"}]}})
    events.append({"type": "result", "permission_denials": denials or [], "is_error": False, "total_cost_usd": 0.01, "usage": {}, "result": "MLGO_RESULT_PACKET\n{}\nEND_MLGO_RESULT_PACKET"})
    return "\n".join(json.dumps(e) for e in events)


def _codex_stdout():
    return "\n".join(json.dumps(e) for e in [
        {"type": "item.completed", "item": {"type": "file_change", "changes": [], "status": "completed"}},
        {"type": "item.completed", "item": {"type": "agent_message", "text": "MLGO_RESULT_PACKET\n{}\nEND_MLGO_RESULT_PACKET"}},
        {"type": "turn.completed", "usage": {}},
    ])


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

    def _prepared(self, run_id: str, *, provider: str, validation_commands=None):
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
            "validation": {"commands": validation_commands or []},
        }
        decision = {"selected_profile": profile_id, "selected_route": route_id, "selected_provider": provider}
        job = {"job_id": f"job-{run_id}", "attempt": 1}
        return policy, phase, decision, job, v2_dir, job_dir

    def _qualify(self, *, policy, provider, selected_profile):
        """Qualify via the separate, explicit operation using synthetic-but-
        structurally-real evidence bytes (this is what the operation itself
        parses and validates - not an arbitrary hash).

        Measured identity depends on a real ``--version`` probe of the
        resolved executable; callers must invoke this inside the same
        ``subprocess.run`` mock context the subsequent dispatch call uses; so
        both measure the same (mocked) provider_version and land on the same
        identity_digest - exactly as, in production, both calls run the same
        real, unmocked executable and therefore agree for real.
        """
        evidence_dir = self.tmp / "qual-evidence"
        evidence_dir.mkdir(exist_ok=True)
        if provider == "claude_code":
            raw = _claude_stdout()
        else:
            raw = _codex_stdout()
        evidence_path = evidence_dir / f"{provider}-raw-stdout.jsonl"
        evidence_path.write_text(raw)
        return dg.qualify_child_transport_provider(
            policy=policy, provider=provider, selected_profile=selected_profile,
            registry=self.registry, evidence_path=evidence_path,
        )

    def test_unqualified_dispatch_fails_closed_before_any_reservation(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-unqualified", provider="claude_code")
        self.assertIsNone(dg.load_qualification(policy=policy, adapter_id="cao-child-direct-claude_code"))

        class VersionProc:
            stdout = "2.1.226 (Claude Code)"
            stderr = ""

        with patch("subprocess.run", return_value=VersionProc()) as mock_run:
            with self.assertRaises(dg.GovernanceBlocked):
                dg.dispatch_via_child_transport(
                    phase=phase, decision=decision, job=job, policy=policy,
                    prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                    pre_state_facts={"branch": "x", "head": "y"},
                    provider="claude_code", registry=self.registry,
                )
        # subprocess.run was called exactly once - for the --version identity
        # measurement, never for an actual dispatch (no argv containing -p).
        for call in mock_run.call_args_list:
            self.assertNotIn("-p", call.args[0])

    def test_qualification_operation_rejects_bypass_flagged_evidence(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-bad-qual", provider="claude_code")
        evidence_path = self.tmp / "bad-raw-stdout.jsonl"
        evidence_path.write_text(_claude_stdout())
        argv_path = self.tmp / "bad-launch-argv.json"
        argv_path.write_text(json.dumps({"argv": ["claude", "-p", "x", "--dangerously-skip-permissions"]}))
        with self.assertRaises(dg.QualificationEvidenceInvalid):
            dg.qualify_child_transport_provider(
                policy=policy, provider="claude_code", selected_profile=decision["selected_profile"],
                registry=self.registry, evidence_path=evidence_path, launch_argv_path=argv_path,
            )
        self.assertIsNone(dg.load_qualification(policy=policy, adapter_id="cao-child-direct-claude_code"))

    def test_qualification_operation_rejects_empty_or_malformed_evidence(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-empty-qual", provider="claude_code")
        evidence_path = self.tmp / "empty.jsonl"
        evidence_path.write_text("")
        with self.assertRaises(dg.QualificationEvidenceInvalid):
            dg.qualify_child_transport_provider(
                policy=policy, provider="claude_code", selected_profile=decision["selected_profile"],
                registry=self.registry, evidence_path=evidence_path,
            )

    def test_qualified_dispatch_uses_prepare_native_preauthorization_normally(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-qualified", provider="claude_code")

        class FakeProc:
            stdout = _claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()) as mock_run:
            self._qualify(policy=policy, provider="claude_code", selected_profile=decision["selected_profile"])
            outcome = dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        self.assertTrue(mock_run.called)
        argv = mock_run.call_args.args[0]
        self.assertEqual(argv[0], str(CLAUDE_WRAPPER))
        for flag in FORBIDDEN_BYPASS_FLAGS:
            self.assertNotIn(flag, argv)
        preauth = json.loads((job_dir / "child-transport" / "preauthorization.json").read_text())
        self.assertNotIn("ceremony_mode", preauth)
        self.assertIn("observed_state", preauth)  # real PermissionAdapter.prepare_native_preauthorization shape
        self.assertFalse(outcome["submit_result"].response["denied"])

    def test_bash_is_denied_when_phase_declares_no_validation_commands(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-bash-denied", provider="claude_code")

        class FakeProc:
            stdout = _claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()) as mock_run:
            self._qualify(policy=policy, provider="claude_code", selected_profile=decision["selected_profile"])
            dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        argv = mock_run.call_args.args[0]
        self.assertIn("--disallowedTools", argv)
        self.assertIn("Bash", argv)
        self.assertNotIn("Bash", " ".join(a for a in argv if a.startswith("Write") or a.startswith("Edit")))

    def test_bash_is_scoped_to_declared_validation_commands_when_present(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared(
            "run-bash-scoped", provider="claude_code", validation_commands=["pnpm test"],
        )

        class FakeProc:
            stdout = _claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()) as mock_run:
            self._qualify(policy=policy, provider="claude_code", selected_profile=decision["selected_profile"])
            dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        argv = mock_run.call_args.args[0]
        self.assertIn("Bash(pnpm test)", argv)
        self.assertNotIn("--disallowedTools", argv)

    def test_dispatch_uses_the_route_selected_executable_not_bare_path_binary(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-executable", provider="codex")

        class FakeProc:
            stdout = _codex_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()) as mock_run:
            self._qualify(policy=policy, provider="codex", selected_profile=decision["selected_profile"])
            dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="codex", registry=self.registry,
            )
        for call in mock_run.call_args_list:
            argv = call.args[0]
            self.assertEqual(argv[0], str(CODEX_WRAPPER))
            self.assertNotEqual(argv[0], "codex")

    def test_effective_request_bytes_match_context_envelope_measurement_exactly(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-envelope-match", provider="claude_code")

        class FakeProc:
            stdout = _claude_stdout()
            stderr = ""

        with patch("subprocess.run", return_value=FakeProc()):
            self._qualify(policy=policy, provider="claude_code", selected_profile=decision["selected_profile"])
            outcome = dg.dispatch_via_child_transport(
                phase=phase, decision=decision, job=job, policy=policy,
                prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                pre_state_facts={"branch": "x", "head": "y"},
                provider="claude_code", registry=self.registry,
            )
        governance_record = outcome["governance_record"]
        effective_request = json.loads(Path(governance_record["effective_provider_request_path"]).read_text())
        manifest_path = v2_dir / "context-envelope" / f"manifest-{governance_record['context_manifest_id']}.json"
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(len(manifest["components"]), 1)
        self.assertEqual(
            manifest["components"][0]["bytes"],
            len(effective_request["rendered_text"].encode("utf-8")),
        )

    def test_stale_qualification_after_identity_drift_fails_closed(self):
        policy, phase, decision, job, v2_dir, job_dir = self._prepared("run-stale", provider="claude_code")
        self._qualify(policy=policy, provider="claude_code", selected_profile=decision["selected_profile"])

        qual_path = Path(policy["state_root"]) / "governance" / "permission-adapter-qualifications" / "cao-child-direct-claude_code.json"
        record = json.loads(qual_path.read_text())
        record["identity"]["provider_version"] = "drifted-version"
        record["identity_digest"] = "drifted-digest-not-matching-anything"
        qual_path.write_text(json.dumps(record))

        class VersionProc:
            stdout = "2.1.226 (Claude Code)"
            stderr = ""

        with patch("subprocess.run", return_value=VersionProc()) as mock_run:
            with self.assertRaises(dg.GovernanceBlocked):
                dg.dispatch_via_child_transport(
                    phase=phase, decision=decision, job=job, policy=policy,
                    prompt_text="Do the thing.", v2_dir=v2_dir, job_dir=job_dir,
                    pre_state_facts={"branch": "x", "head": "y"},
                    provider="claude_code", registry=self.registry,
                )
        for call in mock_run.call_args_list:
            self.assertNotIn("-p", call.args[0])


if __name__ == "__main__":
    unittest.main()
