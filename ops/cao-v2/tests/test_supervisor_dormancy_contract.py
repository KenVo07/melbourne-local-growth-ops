from __future__ import annotations

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REGISTRY = ROOT / "registry" / "provider-registry.json"
BODY = ROOT / "profile-sources" / "bodies" / "authoritative-supervisor.md"
PROFILES = ROOT / "profiles"


class SupervisorDormancyContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.registry = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.supervisors = {
            name: spec
            for name, spec in self.registry["profiles"].items()
            if spec.get("role_id") == "supervisor"
            and spec.get("body") == "authoritative-supervisor"
        }
        self.assertIn("mlgo-supervisor", self.supervisors)

    def test_authoritative_supervisors_cannot_inject_direct_cao_orchestration(self) -> None:
        for name, spec in sorted(self.supervisors.items()):
            fm = spec["frontmatter"]
            with self.subTest(profile=name):
                self.assertNotIn("@cao-mcp-server", fm)
                self.assertNotIn("cao-supervisor-protocols", fm)
                self.assertNotIn("mcpServers:", fm)
                self.assertIn("execute_bash", fm)
                self.assertIn("cao-agent-routing", fm)

                rendered = (PROFILES / f"{name}.md").read_text(encoding="utf-8")
                frontmatter = rendered.split("---", 2)[1]
                self.assertNotIn("cao-mcp-server", frontmatter)
                self.assertNotIn("cao-supervisor-protocols", frontmatter)

    def test_authoritative_body_requires_model_dormancy_while_workers_run(self) -> None:
        body = BODY.read_text(encoding="utf-8")
        required = (
            "### Supervisor dormancy invariant",
            "Never invoke CAO `handoff` or `assign` directly",
            "end the model turn",
            "zero supervisor-model activity",
            "stop with a truthful blocked decision",
        )
        for marker in required:
            self.assertIn(marker, body)


if __name__ == "__main__":
    unittest.main()
