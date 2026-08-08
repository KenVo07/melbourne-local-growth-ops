"""Fail-closed environment validation before any provider process is launched."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .common import ContractError, ensure_absolute, run


def verify_worktree(
    path: str | Path,
    *,
    expected_branch: str | None,
    require_clean: bool,
    evidence_directory: str | Path | None,
    working_directory: str | Path | None = None,
) -> dict[str, Any]:
    worktree = ensure_absolute(path, "worktree")
    if worktree.is_symlink() or not worktree.is_dir():
        raise ContractError(f"worktree must be an existing non-symlink directory: {worktree}")
    resolved = worktree.resolve()
    if working_directory is not None and ensure_absolute(working_directory, "working_directory").resolve() != resolved:
        raise ContractError(
            f"working_directory must exactly equal worktree root: {working_directory} != {resolved}"
        )
    top = Path(run(["git", "-C", str(resolved), "rev-parse", "--show-toplevel"]).stdout.strip()).resolve()
    if top != resolved:
        raise ContractError(f"path is not the Git worktree root: {resolved}; top-level is {top}")
    common = Path(run(["git", "-C", str(resolved), "rev-parse", "--git-common-dir"]).stdout.strip())
    if not common.is_absolute():
        common = (resolved / common).resolve()
    if not common.exists():
        raise ContractError(f"git common directory does not exist: {common}")
    branch = run(["git", "-C", str(resolved), "rev-parse", "--abbrev-ref", "HEAD"]).stdout.strip()
    if branch == "HEAD":
        raise ContractError("detached HEAD is not allowed for a write-capable phase")
    if expected_branch and branch != expected_branch:
        raise ContractError(f"branch mismatch: expected {expected_branch!r}, got {branch!r}")
    status = run(["git", "-C", str(resolved), "status", "--porcelain=v1", "--untracked-files=all"]).stdout
    if require_clean and status.strip():
        first = status.splitlines()[0][:160]
        raise ContractError(f"worktree is dirty; first entry: {first}")
    if not os.access(resolved, os.W_OK | os.X_OK):
        raise ContractError(f"worktree is not writable: {resolved}")
    probe = resolved / f".mlgo-cao-preflight-{os.getpid()}"
    try:
        fd = os.open(probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write("preflight\n")
            handle.flush()
            os.fsync(handle.fileno())
        if probe.read_text(encoding="utf-8") != "preflight\n":
            raise ContractError("worktree write probe content mismatch")
    finally:
        probe.unlink(missing_ok=True)
    post = run(["git", "-C", str(resolved), "status", "--porcelain=v1", "--untracked-files=all"]).stdout
    if post != status:
        raise ContractError("preflight probe changed Git status")

    evidence: Path | None = None
    if evidence_directory is not None:
        evidence = ensure_absolute(evidence_directory, "evidence_directory")
        if evidence.is_symlink():
            raise ContractError(f"evidence directory cannot be a symlink: {evidence}")
        evidence.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not evidence.is_dir() or not os.access(evidence, os.W_OK | os.X_OK):
            raise ContractError(f"evidence directory is not writable: {evidence}")
        ev_probe = evidence / f".mlgo-cao-preflight-{os.getpid()}"
        try:
            fd = os.open(ev_probe, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
        finally:
            ev_probe.unlink(missing_ok=True)

    return {
        "worktree": str(resolved),
        "branch": branch,
        "clean": not bool(status.strip()),
        "git_common_dir": str(common),
        "evidence_directory": str(evidence) if evidence else None,
    }
