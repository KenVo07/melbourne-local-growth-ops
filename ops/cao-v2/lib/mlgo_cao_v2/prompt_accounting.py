"""Static MLGO prompt-component accounting at dispatch time."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from .common import atomic_write_json, iso_now, sha256_file

CAO_PYTHON = Path("/home/khoa/.local/share/uv/tools/cli-agent-orchestrator/bin/python")


def _split_frontmatter(text: str) -> tuple[str, str]:
    if not text.startswith("---\n"):
        return "", text
    end = text.find("\n---\n", 4)
    if end < 0:
        return "", text
    return text[4:end], text[end + 5 :].strip()


def _skills(frontmatter: str) -> list[str] | None:
    lines = frontmatter.splitlines()
    out: list[str] = []
    active = False
    for line in lines:
        if line == "skills:":
            active = True
            continue
        if active:
            if line.startswith("  - "):
                out.append(line[4:].strip().strip('"\''))
                continue
            if line and not line.startswith(" "):
                break
    return out if active else None


def _skill_catalog_bytes(skills: list[str] | None) -> tuple[int | None, str]:
    if not CAO_PYTHON.is_file():
        return None, "CAO Python unavailable"
    code = (
        "import json; from cli_agent_orchestrator.utils.skills import build_skill_catalog; "
        "v=json.loads(" + repr(json.dumps(skills)) + "); print(len(build_skill_catalog(v).encode()))"
    )
    proc = subprocess.run([str(CAO_PYTHON), "-c", code], text=True, capture_output=True, check=False)
    if proc.returncode != 0:
        return None, proc.stderr.strip()[-500:]
    try:
        return int(proc.stdout.strip()), "exact installed build_skill_catalog"
    except ValueError:
        return None, "invalid catalog measurement output"


def record_dispatch_prompt(
    *,
    state_root: str | Path,
    job_id: str,
    selected_profile: str,
    provider: str,
    model: str,
    effective_task_prompt: str | Path,
    profile_source_dir: str | Path,
) -> Path:
    profile_path = Path(profile_source_dir) / f"{selected_profile}.md"
    text = profile_path.read_text(encoding="utf-8")
    frontmatter, body = _split_frontmatter(text)
    skills = _skills(frontmatter)
    skill_bytes, skill_method = _skill_catalog_bytes(skills)
    prompt_path = Path(effective_task_prompt)
    record = {
        "schema_version": "1.0",
        "job_id": job_id,
        "provider": provider,
        "profile": selected_profile,
        "model": model,
        "profile_path": str(profile_path),
        "profile_sha256": sha256_file(profile_path),
        "profile_body_bytes": len(body.encode()),
        "skills_filter": skills,
        "skill_catalog_bytes": skill_bytes,
        "skill_catalog_measurement": skill_method,
        "task_prompt_path": str(prompt_path),
        "task_prompt_sha256": sha256_file(prompt_path),
        "task_prompt_bytes": prompt_path.stat().st_size,
        "provider_base_prompt_bytes": None,
        "conversation_history_bytes": None,
        "tool_output_bytes": None,
        "note": "Provider base prompt, history and tool output require provider records and are not estimated.",
        "recorded_at": iso_now(),
    }
    path = Path(state_root) / "telemetry" / "prompt-manifests" / f"{job_id}.json"
    atomic_write_json(path, record)
    return path
