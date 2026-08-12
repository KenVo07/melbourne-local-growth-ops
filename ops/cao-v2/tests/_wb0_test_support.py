from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from mlgo_cao_v2.wb0_bootstrap import build_bootstrap_bundle
from mlgo_cao_v2.wb0_common import iso_now, sha256_bytes, sha256_json
from mlgo_cao_v2.wb0_instance import new_instance
from mlgo_cao_v2.wb0_manifest import seal_release_capsule

SOURCE_COMMIT = "d06073d92ff3491bcb7945da1a98c56c61b4a551"
SOURCE_CAO_ROOT = Path(__file__).resolve().parents[1] / "candidate-source/ops/cao-v2"
if not SOURCE_CAO_ROOT.is_dir():
    SOURCE_CAO_ROOT = Path(__file__).resolve().parents[1]
RELEASE_ID = "post-slice4-golden-d06073d92ff3"
SKILL_ID = "demo-skill"
SKILL_MIRROR_NAME = "demo-skill"
SKILL_BYTES = b"# Demo canonical skill\n\nExact sealed test bytes.\n"


def write(path: Path, text: str, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    path.chmod(mode)


def write_bytes(path: Path, data: bytes, mode: int = 0o644) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(mode)


def _skill_lock() -> tuple[dict[str, Any], dict[str, Any], str]:
    digest = sha256_bytes(SKILL_BYTES)
    file_entry = {
        "relative_path": "skills/demo/SKILL.md",
        "content_digest": digest,
        "byte_count": len(SKILL_BYTES),
    }
    aggregate = sha256_json([file_entry])
    bundle = {
        "acquired_at": "2026-08-10T00:00:00Z",
        "aggregate_content_digest": aggregate,
        "bundle_id": "bundle-demo-skill",
        "bundle_kind": "EXTERNAL_ENGINEERING",
        "compatibility": {"min_cao_contract_version": "0.5.0"},
        "file_manifest": [file_entry],
        "license_id": "MIT",
        "license_text_digest": "0" * 64,
        "provenance_record": {"upstream_code_executed": False},
        "qualification_state": "QUALIFIED",
        "selected_skills": [
            {
                "skill_id": SKILL_ID,
                "relative_path": file_entry["relative_path"],
                "native_mirror_name": SKILL_MIRROR_NAME,
                "content_digest": digest,
                "byte_count": len(SKILL_BYTES),
            }
        ],
        "skill_ids": [SKILL_ID],
        "source_owner": "example",
        "source_repository_or_distribution": "https://example.invalid/demo",
        "source_revision": "1" * 40,
        "source_revision_kind": "git_commit_sha1",
        "version": "1.0.0",
    }
    lock: dict[str, Any] = {
        "lock_schema_version": "1.0",
        "bundles": [bundle],
        "recipes": [],
    }
    lock["lock_digest"] = sha256_json(lock)
    manifest: dict[str, Any] = {
        "schema_version": "1.0",
        "bundle_id": bundle["bundle_id"],
        "bundle_kind": bundle["bundle_kind"],
        "content_digest": aggregate,
        "file_manifest": [file_entry],
        "skill_ids": [SKILL_ID],
        "qualification_state": "QUALIFIED",
    }
    manifest["manifest_digest"] = sha256_json(manifest)
    return lock, manifest, digest


def populate_skill_capsule(capsule: Path) -> None:
    lock, manifest, digest = _skill_lock()
    lock_text = json.dumps(lock, indent=2, sort_keys=True) + "\n"
    write(
        capsule / "release/share/skills/canonical-skill-bundles.lock.json",
        lock_text,
    )
    write(
        capsule / "skills/lock/canonical-skill-bundles.lock.json",
        lock_text,
    )
    write_bytes(
        capsule / f"skills/sealed/skill-cache/objects/{digest[:2]}/{digest}",
        SKILL_BYTES,
        0o400,
    )
    write(
        capsule / "skills/sealed/skill-cache/manifests/bundle-demo-skill.json",
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        0o400,
    )
    write_bytes(
        capsule / f"skills/native-mirror/{SKILL_MIRROR_NAME}/SKILL.md",
        SKILL_BYTES,
        0o400,
    )


def populate_capsule_payload(capsule: Path, *, canary_status: str = "CLOSED") -> None:
    write(
        capsule / "release/bin/mlgo-v2-controller",
        "#!/usr/bin/env bash\nexit 0\n",
        0o755,
    )
    write(capsule / "release/bin/mlgo-v2", "#!/usr/bin/env bash\nexit 0\n", 0o755)
    write(capsule / "release/lib/mlgo_cao_v2/__init__.py", "__version__='test'\n")
    write(
        capsule / "release/share/registry/provider-registry.json",
        '{"schema_version":"1.0"}\n',
    )
    write(capsule / "release/share/schemas/example.schema.json", '{}\n')
    write(capsule / "release/share/examples/README.txt", "example\n")
    write(
        capsule / "release/share/profile-sources/generate_profiles.py",
        "#!/usr/bin/env python3\n",
        0o755,
    )
    populate_skill_capsule(capsule)
    policy = """{
  "schema_version": "2.0",
  "orchestration": {"default_mode": "v2_shadow"},
  "semantic_triggers": {"enforcement_mode": "shadow_only"},
  "capability_activation": {"native_resume": {"enabled": false}},
  "capacity": {"manual_hint_path": "/legacy/manual-capacity-hints.json"},
  "installation": {},
  "state_root": "/legacy/state",
  "repo_root": "/legacy/repo",
  "profile_source_dir": "/legacy/profiles"
}
"""
    write(capsule / "config/cao-policy.json", policy)
    write(capsule / "config/profiles/README.txt", "non-secret profile projection\n")
    test_root = Path(__file__).resolve().parents[1]
    template_candidates = [
        test_root / "systemd/mlgo-cao-v2-controller.service.in",
        test_root / "candidate-source/ops/cao-v2/systemd/mlgo-cao-v2-controller.service.in",
    ]
    template_path = next(path for path in template_candidates if path.is_file())
    template = template_path.read_text()
    write(capsule / "services/mlgo-cao-v2-controller.service.in", template)
    write(
        capsule / "recovery/state-seed/governance/canary-scope.json",
        '{"schema_version":"1.0","status":"%s"}\n' % canary_status,
        0o600,
    )
    write(
        capsule / "recovery/state-seed/runs/example/v2/state.json",
        '{"schema_version":"2.1"}\n',
        0o600,
    )
    build_bootstrap_bundle(
        source_cao_root=SOURCE_CAO_ROOT, output_directory=capsule / "bootstrap"
    )


def make_capsule(root: Path, *, canary_status: str = "CLOSED") -> Path:
    capsule = root / "capsule"
    populate_capsule_payload(capsule, canary_status=canary_status)
    seal_release_capsule(
        capsule_root=capsule,
        release_id=RELEASE_ID,
        source_commit=SOURCE_COMMIT,
        runtime_version="0.5.0-slice3-5-vnext",
        state_contract={
            "golden_state_is_immutable": True,
            "reverse_migration_allowed": False,
            "state_schema_id": "mlgo-cao-v2-control-state",
            "state_schema_version": "2.1",
        },
        skill_contract={
            "sealed_bytes_required": True,
            "canonical_lock_required": True,
            "mirror_must_be_digest_equivalent": True,
            "new_skill_sources_allowed": False,
        },
        provenance_rules=[
            {
                "prefix": "release",
                "record": {"class": "tracked_or_installed_release", "source_commit": SOURCE_COMMIT},
            },
            {"prefix": "config", "record": {"class": "non_secret_config"}},
            {"prefix": "services", "record": {"class": "service_definition"}},
            {"prefix": "skills", "record": {"class": "sealed_skill_evidence"}},
            {"prefix": "recovery", "record": {"class": "recovery_state_seed"}},
        ],
        created_at="2026-08-10T00:00:00Z",
    )
    return capsule


def make_instance(root: Path) -> dict[str, Any]:
    host = root / "host"
    projects = root / "projects"
    projects.mkdir(parents=True)
    worktree = root / "tools/mlgo-worktree"
    worktree.parent.mkdir(parents=True)
    worktree.write_text("#!/bin/sh\nexit 0\n")
    worktree.chmod(0o755)
    return new_instance(
        instance_id="test-instance",
        config_root=host / "config",
        state_root=host / "state",
        release_root=host / "release",
        project_roots=[projects],
        worktree_command=worktree,
        systemctl_command="/usr/bin/systemctl",
        systemd_run_command="/usr/bin/systemd-run",
        bin_root=host / "bin",
        systemd_user_unit_root=host / "systemd-user",
        skill_cache_root=host / "state" / "skill-assets",
        native_mirror_root=host / "native-skills",
        skill_project_id="test-project",
        security_domain_id="test-security-domain",
    )


def safe_resource_report() -> dict[str, Any]:
    return {
        "schema_version": "1.0",
        "captured_at": iso_now(),
        "active_resources": {
            "restart_blocked": False,
            "active_runs": [],
            "unknown_checks": [],
            "main_cao_terminals": {"active": []},
            "agy_bridge_units": {"units": []},
        },
    }


class FakeSystemctl:
    def __init__(self) -> None:
        self.commands: list[list[str]] = []

    def __call__(self, command: list[str]) -> subprocess.CompletedProcess[str]:
        self.commands.append(command)
        return subprocess.CompletedProcess(command, 0, stdout="ok\n", stderr="")
