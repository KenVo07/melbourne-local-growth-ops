"""Slice 4 gap closure (round 4): the ``qualify-provider`` CLI subcommand is
the smallest explicit, disposable qualification ceremony - separate from
normal ``run-job`` dispatch - and it must genuinely parse/validate real
captured provider evidence rather than accept a caller-supplied hash.

These tests reuse the real Claude/Codex raw-stdout.jsonl + launch-argv.json
captured in evidence/slice4/canonical-dispatch-proof/ (round 3's real
provider sessions) as the evidence bytes handed to the qualification
operation, so qualifying costs zero additional real provider sessions. They
skip gracefully if the real installed provider wrapper scripts this host
uses for identity measurement are not present.
"""

from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2 import cli
from mlgo_cao_v2 import dispatch_governance as dg

REPO_ROOT = Path(__file__).resolve().parents[3]
POLICY_PATH = Path(__file__).resolve().parents[1] / "config" / "cao-policy.json"
CLAUDE_WRAPPER = Path.home() / ".local" / "bin" / "mlgo-claude-subscription-high"
CODEX_WRAPPER = Path.home() / ".local" / "bin" / "mlgo-codex-plus"

CLAUDE_EVIDENCE = REPO_ROOT / "evidence/slice4/canonical-dispatch-proof/state/runs/canonical-proof-claude/v2/jobs/phase-PROOF-P01-a1-proof/child-transport/raw-stdout.jsonl"
CLAUDE_ARGV = REPO_ROOT / "evidence/slice4/canonical-dispatch-proof/state/runs/canonical-proof-claude/v2/jobs/phase-PROOF-P01-a1-proof/child-transport/launch-argv.json"
CODEX_EVIDENCE = REPO_ROOT / "evidence/slice4/canonical-dispatch-proof/state/runs/canonical-proof-codex/v2/jobs/phase-PROOF-P01-a1-proof/child-transport/raw-stdout.jsonl"
CODEX_ARGV = REPO_ROOT / "evidence/slice4/canonical-dispatch-proof/state/runs/canonical-proof-codex/v2/jobs/phase-PROOF-P01-a1-proof/child-transport/launch-argv.json"


def _host_ready() -> bool:
    return CLAUDE_WRAPPER.is_file() and CODEX_WRAPPER.is_file() and CLAUDE_EVIDENCE.is_file() and CODEX_EVIDENCE.is_file()


@unittest.skipUnless(_host_ready(), "requires installed provider wrappers and round-3 evidence on this host")
class QualifyProviderCliTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmp.name)
        self.addCleanup(self._tmp.cleanup)
        self.state_root = self.tmp / "state"
        self.state_root.mkdir()
        policy = json.loads(POLICY_PATH.read_text())
        policy["state_root"] = str(self.state_root)
        self.policy_path = self.tmp / "cao-policy.json"
        self.policy_path.write_text(json.dumps(policy))

    def test_qualify_provider_cli_reuses_real_evidence_for_both_providers(self):
        rc = cli.main([
            "qualify-provider", "--provider", "claude_code",
            "--profile", "mlgo-claude-subscription-child-direct",
            "--evidence", str(CLAUDE_EVIDENCE), "--launch-argv", str(CLAUDE_ARGV),
            "--policy", str(self.policy_path),
        ])
        self.assertEqual(rc, 0)
        rc = cli.main([
            "qualify-provider", "--provider", "codex",
            "--profile", "mlgo-codex-plus-child-direct",
            "--evidence", str(CODEX_EVIDENCE), "--launch-argv", str(CODEX_ARGV),
            "--policy", str(self.policy_path),
        ])
        self.assertEqual(rc, 0)

        policy = {"state_root": str(self.state_root)}
        claude_q = dg.load_qualification(policy=policy, adapter_id="cao-child-direct-claude_code")
        codex_q = dg.load_qualification(policy=policy, adapter_id="cao-child-direct-codex")
        self.assertIsNotNone(claude_q)
        self.assertIsNotNone(codex_q)
        self.assertEqual(claude_q["capabilities"]["native_preauthorization"], "QUALIFIED")
        self.assertEqual(codex_q["capabilities"]["native_preauthorization"], "QUALIFIED")

    def test_qualify_provider_cli_rejects_evidence_with_a_forbidden_bypass_flag(self):
        bad_argv = self.tmp / "bad-launch-argv.json"
        bad_argv.write_text(json.dumps({"argv": [str(CLAUDE_WRAPPER), "-p", "x", "--dangerously-skip-permissions"]}))
        rc = cli.main([
            "qualify-provider", "--provider", "claude_code",
            "--profile", "mlgo-claude-subscription-child-direct",
            "--evidence", str(CLAUDE_EVIDENCE), "--launch-argv", str(bad_argv),
            "--policy", str(self.policy_path),
        ])
        self.assertEqual(rc, 1)
        policy = {"state_root": str(self.state_root)}
        self.assertIsNone(dg.load_qualification(policy=policy, adapter_id="cao-child-direct-claude_code"))


if __name__ == "__main__":
    unittest.main()
