"""Deterministic Git, publication and exact-CI executor.

Semantic conflicts are never resolved automatically.  Idempotent callers can
prove an existing commit/integration by operation trailer or patch identity.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path
from typing import Any, Iterable

from .common import ContractError, PolicyError, atomic_write_json, iso_now, run, safe_relative_path, validate_sha
from .preflight import verify_worktree


def _git(worktree: Path, *args: str, timeout: int = 120, check: bool = True):
    return run(["git", "-C", str(worktree), *args], timeout=timeout, check=check)


def snapshot(worktree: str | Path) -> dict[str, Any]:
    wt = Path(worktree).resolve(); top = Path(_git(wt, "rev-parse", "--show-toplevel").stdout.strip()).resolve()
    if top != wt: raise ContractError(f"not a worktree root: {wt}")
    return {
        "worktree": str(wt), "branch": _git(wt, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip(),
        "head": _git(wt, "rev-parse", "HEAD").stdout.strip(),
        "status_porcelain": _git(wt, "status", "--porcelain=v1", "--untracked-files=all").stdout.splitlines(),
        "diff_name_status": _git(wt, "diff", "--name-status", "HEAD", "--").stdout.splitlines(),
        "captured_at": iso_now(),
    }


def changed_paths(worktree: Path) -> list[str]:
    tracked = _git(worktree, "diff", "--name-only", "-z", "HEAD", "--").stdout
    untracked = _git(worktree, "ls-files", "--others", "--exclude-standard", "-z", "--").stdout
    return sorted({Path(raw).as_posix() for raw in (tracked + untracked).split("\0") if raw})


def _path_matches(path: str, rule: str) -> bool:
    p = Path(path); r = Path(rule)
    return path == rule or r in p.parents


def validate_ownership(paths: Iterable[str], allowed: Iterable[str], forbidden: Iterable[str]) -> None:
    normalized = [safe_relative_path(p) for p in paths]
    allow = [safe_relative_path(p) for p in allowed]; deny = [safe_relative_path(p) for p in forbidden]
    bad_forbidden = [p for p in normalized if any(_path_matches(p, rule) for rule in deny)]
    bad_unowned = [p for p in normalized if not any(_path_matches(p, rule) for rule in allow)]
    if bad_forbidden: raise PolicyError(f"changes touch forbidden paths: {bad_forbidden}")
    if bad_unowned: raise PolicyError(f"changes exceed allowed ownership: {bad_unowned}")


def find_commit_by_operation_id(worktree: str | Path, operation_id: str) -> dict[str, Any] | None:
    wt = Path(worktree).resolve()
    proc = _git(wt, "log", "--all", "--fixed-strings", "--grep", f"MLGO-Operation-Id: {operation_id}", "--format=%H", "-n", "2", check=False)
    matches = [line.strip() for line in proc.stdout.splitlines() if re.fullmatch(r"[0-9a-f]{40}", line.strip())]
    if not matches: return None
    if len(matches) > 1: raise PolicyError(f"multiple commits claim operation ID {operation_id}")
    sha = matches[0]
    files = _git(wt, "diff-tree", "--no-commit-id", "--name-only", "-r", sha).stdout.splitlines()
    return {"operation": "commit_task", "commit_sha": sha, "changed_files": files, "external_identity": sha, "recovered": True}


def commit_task(
    *, worktree: str | Path, expected_branch: str, allowed_paths: list[str], forbidden_paths: list[str],
    message: str, author_name: str = "MLGO CAO Host", author_email: str = "cao-host@localhost",
    operation_id: str | None = None,
) -> dict[str, Any]:
    wt = Path(worktree).resolve()
    verify_worktree(wt, expected_branch=expected_branch, require_clean=False, evidence_directory=None, working_directory=wt)
    if operation_id:
        existing = find_commit_by_operation_id(wt, operation_id)
        if existing:
            validate_ownership(existing["changed_files"], allowed_paths, forbidden_paths)
            return {**existing, "worktree": str(wt), "branch": expected_branch, "message": message}
    paths = changed_paths(wt)
    if not paths: raise ContractError("no changed files to commit")
    validate_ownership(paths, allowed_paths, forbidden_paths)
    for path in paths: _git(wt, "add", "--", path)
    staged = _git(wt, "diff", "--cached", "--name-only").stdout.splitlines()
    validate_ownership(staged, allowed_paths, forbidden_paths)
    effective_message = message
    if operation_id: effective_message += f"\n\nMLGO-Operation-Id: {operation_id}"
    env = {"GIT_AUTHOR_NAME": author_name, "GIT_AUTHOR_EMAIL": author_email, "GIT_COMMITTER_NAME": author_name, "GIT_COMMITTER_EMAIL": author_email}
    run(["git", "-C", str(wt), "commit", "-m", effective_message], env=env, timeout=120)
    sha = validate_sha(_git(wt, "rev-parse", "HEAD").stdout.strip())
    if _git(wt, "status", "--porcelain=v1", "--untracked-files=all").stdout.strip():
        raise PolicyError("task commit succeeded but worktree is not clean")
    return {"operation": "commit_task", "worktree": str(wt), "branch": expected_branch, "commit_sha": sha, "external_identity": sha, "changed_files": staged, "message": message, "operation_id": operation_id, "completed_at": iso_now()}


def _patch_id(worktree: Path, commit_sha: str) -> str:
    show = run(["git", "-C", str(worktree), "show", "--pretty=format:", "--binary", commit_sha], timeout=120)
    proc = run(["git", "patch-id", "--stable"], input_text=show.stdout, timeout=120)
    value = proc.stdout.split()
    if not value: raise ContractError(f"cannot compute patch id for {commit_sha}")
    return value[0]


def find_integrated_patch(integration_worktree: str | Path, source_commit_sha: str, *, max_commits: int = 500) -> dict[str, Any] | None:
    wt = Path(integration_worktree).resolve(); source = validate_sha(source_commit_sha)
    wanted = _patch_id(wt, source)
    commits = _git(wt, "rev-list", f"--max-count={max_commits}", "HEAD").stdout.splitlines()
    for sha in commits:
        try:
            if _patch_id(wt, sha) == wanted:
                return {"operation": "integrate_commit", "source_commit_sha": source, "integration_sha": sha, "external_identity": sha, "patch_id": wanted, "recovered": True}
        except ContractError:
            continue
    return None


def integrate_commit(*, integration_worktree: str | Path, expected_branch: str, commit_sha: str) -> dict[str, Any]:
    sha = validate_sha(commit_sha, "commit_sha"); wt = Path(integration_worktree).resolve()
    verify_worktree(wt, expected_branch=expected_branch, require_clean=True, evidence_directory=None, working_directory=wt)
    existing = find_integrated_patch(wt, sha)
    if existing: return {**existing, "integration_worktree": str(wt), "branch": expected_branch}
    base = _git(wt, "rev-parse", "HEAD").stdout.strip()
    proc = _git(wt, "cherry-pick", sha, timeout=300, check=False)
    if proc.returncode != 0:
        conflicts = _git(wt, "diff", "--name-only", "--diff-filter=U", check=False).stdout.splitlines()
        _git(wt, "cherry-pick", "--abort", check=False)
        raise PolicyError("semantic integration required; cherry-pick conflicted in: " + ", ".join(conflicts))
    integrated = validate_sha(_git(wt, "rev-parse", "HEAD").stdout.strip(), "integration_sha")
    return {"operation": "integrate_commit", "integration_worktree": str(wt), "branch": expected_branch, "base_sha": base, "source_commit_sha": sha, "integration_sha": integrated, "external_identity": integrated, "patch_id": _patch_id(wt, integrated), "completed_at": iso_now()}


def verify_reachability(*, repository: str | Path, remote: str, branch: str, expected_sha: str) -> dict[str, Any]:
    repo = Path(repository).resolve(); sha = validate_sha(expected_sha, "expected_sha")
    _git(repo, "fetch", "--prune", remote, branch, timeout=300)
    remote_ref = f"refs/remotes/{remote}/{branch}"; remote_sha = validate_sha(_git(repo, "rev-parse", remote_ref).stdout.strip(), "remote_sha")
    reachable = _git(repo, "merge-base", "--is-ancestor", sha, remote_ref, check=False).returncode == 0
    if not reachable: raise PolicyError(f"expected commit {sha} is not reachable from {remote}/{branch}")
    return {"operation": "verify_reachability", "remote": remote, "branch": branch, "expected_sha": sha, "remote_sha": remote_sha, "reachable": True, "completed_at": iso_now()}


def push_branch(*, worktree: str | Path, remote: str, branch: str, expected_sha: str) -> dict[str, Any]:
    wt = Path(worktree).resolve(); sha = validate_sha(expected_sha, "expected_sha")
    current = _git(wt, "rev-parse", "HEAD").stdout.strip()
    if current != sha: raise PolicyError(f"worktree HEAD {current} does not match expected candidate {sha}")
    _git(wt, "push", remote, f"HEAD:refs/heads/{branch}", timeout=600)
    return {"operation": "push_branch", "worktree": str(wt), "remote": remote, "branch": branch, "sha": sha, "external_identity": f"{remote}/{branch}@{sha}", "completed_at": iso_now()}


def create_pull_request(*, repository: str | Path, head_branch: str, base_branch: str, title: str, body_file: str | Path) -> dict[str, Any]:
    repo = Path(repository).resolve(); body = Path(body_file).resolve()
    if not body.is_file(): raise ContractError(f"PR body file does not exist: {body}")
    # First look for an existing PR; this makes retry after a lost response safe.
    existing = run(["gh", "pr", "list", "--head", head_branch, "--base", base_branch, "--json", "url,number,state", "--limit", "5"], cwd=repo, timeout=120, check=False)
    if existing.returncode == 0:
        values = json.loads(existing.stdout or "[]")
        if values:
            return {"operation": "create_pull_request", "url": values[0]["url"], "number": values[0].get("number"), "head_branch": head_branch, "base_branch": base_branch, "external_identity": values[0]["url"], "recovered": True, "completed_at": iso_now()}
    proc = run(["gh", "pr", "create", "--head", head_branch, "--base", base_branch, "--title", title, "--body-file", str(body)], cwd=repo, timeout=300)
    url = proc.stdout.strip().splitlines()[-1]
    if not url.startswith("http"): raise ContractError(f"gh pr create did not return a URL: {proc.stdout!r}")
    return {"operation": "create_pull_request", "url": url, "head_branch": head_branch, "base_branch": base_branch, "external_identity": url, "completed_at": iso_now()}


def _required_check_specs(required_checks: list[str | dict[str, Any]]) -> dict[str, set[str]]:
    if not required_checks: raise ContractError("required_checks must be explicit and non-empty")
    specs: dict[str, set[str]] = {}
    for item in required_checks:
        if isinstance(item, str): name, allowed = item, {"success"}
        elif isinstance(item, dict):
            name = str(item.get("name") or ""); allowed = set(item.get("allowed_conclusions") or ["success"])
        else: raise ContractError("required check must be a name or object")
        if not name: raise ContractError("required check name is empty")
        if not allowed or not allowed <= {"success", "neutral", "skipped"}:
            raise ContractError(f"invalid allowed conclusions for required check {name}")
        specs[name] = allowed
    return specs


def evaluate_required_checks(*, sha: str, required_checks: list[str | dict[str, Any]], observed_checks: list[dict[str, Any]]) -> dict[str, Any]:
    expected = validate_sha(sha); specs = _required_check_specs(required_checks)
    by_name: dict[str, list[dict[str, Any]]] = {}
    for check in observed_checks:
        if check.get("head_sha") not in {None, expected}: continue
        by_name.setdefault(str(check.get("name") or ""), []).append(check)
    missing = sorted(name for name in specs if name not in by_name)
    pending: list[str] = []; failed: list[dict[str, Any]] = []; satisfied: list[dict[str, Any]] = []
    for name, allowed in specs.items():
        candidates = by_name.get(name, [])
        if not candidates: continue
        latest = sorted(candidates, key=lambda v: str(v.get("completed_at") or v.get("started_at") or ""))[-1]
        if latest.get("status") != "completed": pending.append(name); continue
        conclusion = str(latest.get("conclusion") or "")
        if conclusion not in allowed: failed.append({"name": name, "conclusion": conclusion, "allowed": sorted(allowed), "url": latest.get("details_url")})
        else: satisfied.append({"name": name, "conclusion": conclusion, "url": latest.get("details_url")})
    status = "FAIL" if missing or failed else ("PENDING" if pending else "PASS")
    return {"schema_version": "2.1", "candidate_sha": expected, "required_checks": [{"name": n, "allowed_conclusions": sorted(a)} for n, a in specs.items()], "observed_check_names": sorted(by_name), "satisfied_checks": satisfied, "missing_checks": missing, "pending_checks": sorted(pending), "failed_checks": failed, "unexpected_checks": sorted(name for name in by_name if name not in specs), "status": status, "observed_at": iso_now()}


def _repo_slug(repo: Path) -> str:
    proc = run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], cwd=repo, timeout=120)
    value = proc.stdout.strip()
    if "/" not in value: raise ContractError("cannot determine GitHub repository nameWithOwner")
    return value


def _fetch_check_runs(repo: Path, slug: str, sha: str) -> list[dict[str, Any]]:
    proc = run(["gh", "api", f"repos/{slug}/commits/{sha}/check-runs", "--paginate", "-H", "Accept: application/vnd.github+json"], cwd=repo, timeout=120)
    # gh --paginate may emit multiple JSON documents.  Decode sequentially.
    decoder = json.JSONDecoder(); text = proc.stdout; index = 0; out: list[dict[str, Any]] = []
    while index < len(text):
        while index < len(text) and text[index].isspace(): index += 1
        if index >= len(text): break
        value, index = decoder.raw_decode(text, index)
        if isinstance(value, dict): out.extend(item for item in value.get("check_runs", []) if isinstance(item, dict))
    return out


def verify_ci(*, repository: str | Path, sha: str, required_checks: list[str | dict[str, Any]], timeout_seconds: int = 1800) -> dict[str, Any]:
    repo = Path(repository).resolve(); expected = validate_sha(sha)
    if not 1 <= timeout_seconds <= 14400: raise ContractError("CI timeout must be 1..14400 seconds")
    _required_check_specs(required_checks)  # fail before any network call
    slug = _repo_slug(repo); deadline = time.monotonic() + timeout_seconds; last: dict[str, Any] | None = None
    while True:
        checks = _fetch_check_runs(repo, slug, expected)
        last = evaluate_required_checks(sha=expected, required_checks=required_checks, observed_checks=checks)
        last.update({"run_id": None, "provider": "github_checks", "repository": slug})
        if last["status"] == "PASS": return last
        if last["status"] == "FAIL":
            raise PolicyError(f"required CI checks not satisfied: missing={last['missing_checks']} failed={last['failed_checks']}")
        if time.monotonic() >= deadline:
            raise PolicyError(f"required CI checks did not complete before timeout: pending={last['pending_checks']}")
        time.sleep(min(15.0, max(0.5, deadline - time.monotonic())))


def write_record(path: str | Path, record: dict[str, Any]) -> None:
    atomic_write_json(Path(path), record)
