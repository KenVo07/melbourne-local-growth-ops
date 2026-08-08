"""Tracked source/build/install provenance helpers for Slice 1."""
from __future__ import annotations

import subprocess
from pathlib import Path
from typing import Any

from .common import ContractError, sha256_file, sha256_json

MANIFEST_SCHEMA_VERSION = "1.0"

def _git_head(root: Path) -> str:
    proc = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        raise ContractError("build provenance requires a Git HEAD")
    return proc.stdout.strip()


def _require_clean_tracked_source(root: Path) -> None:
    proc = subprocess.run(
        ["git", "-C", str(root), "status", "--porcelain=v1", "--untracked-files=all"],
        capture_output=True, text=True, check=False,
    )
    if proc.returncode != 0:
        raise ContractError("cannot inspect Git source cleanliness")
    dirty = [line for line in proc.stdout.splitlines() if line.strip()]
    if dirty:
        raise ContractError(f"build provenance refuses dirty or untracked source: {dirty[0]}")


def tracked_files(source_root: str | Path) -> list[Path]:
    root = Path(source_root).resolve()
    proc = subprocess.run(["git", "-C", str(root), "ls-files", "-z"], capture_output=True, check=False)
    if proc.returncode != 0:
        raise ContractError("build provenance requires a Git-tracked source tree")
    return [root / item.decode() for item in proc.stdout.split(b"\0") if item]


def source_tree_digest(source_root: str | Path) -> str:
    root = Path(source_root).resolve()
    items = []
    for path in tracked_files(root):
        if not path.is_file():
            continue
        items.append({"path": path.relative_to(root).as_posix(), "sha256": sha256_file(path)})
    return sha256_json(items)


def create_build_manifest(
    *, source_root: str | Path, source_commit: str, runtime_version: str,
    registry_path: str | Path, projection_paths: list[str | Path], build_id: str,
    install_projection_map: dict[str, str | list[str]] | None = None,
) -> dict[str, Any]:
    root = Path(source_root).resolve()
    if _git_head(root) != source_commit:
        raise ContractError("source_commit does not match current Git HEAD")
    _require_clean_tracked_source(root)
    registry = Path(registry_path).resolve()
    projections = []
    for raw in projection_paths:
        path = Path(raw).resolve()
        projections.append({"path": path.relative_to(root).as_posix(), "sha256": sha256_file(path)})
    install_projections = []
    for source_rel, install_rel_value in sorted((install_projection_map or {}).items()):
        source = (root / source_rel).resolve()
        try:
            source.relative_to(root)
        except ValueError as exc:
            raise ContractError(f"install projection source escapes source root: {source_rel}") from exc
        if not source.is_file():
            raise ContractError(f"install projection source is not a file: {source_rel}")
        targets = install_rel_value if isinstance(install_rel_value, list) else [install_rel_value]
        if not targets:
            raise ContractError(f"install projection has no targets: {source_rel}")
        for install_rel in targets:
            target = Path(install_rel)
            if target.is_absolute() or ".." in target.parts or not str(install_rel):
                raise ContractError(f"invalid install projection: {source_rel} -> {install_rel}")
            install_projections.append({"source_path": source_rel, "install_path": target.as_posix(), "sha256": sha256_file(source)})
    install_projections.sort(key=lambda item: (item["install_path"], item["source_path"]))
    record = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "build_id": build_id,
        "source_commit": source_commit,
        "source_tree_digest": source_tree_digest(root),
        "runtime_version": runtime_version,
        "registry_path": registry.relative_to(root).as_posix(),
        "registry_sha256": sha256_file(registry),
        "projections": sorted(projections, key=lambda x: x["path"]),
        "install_projections": install_projections,
    }
    record["manifest_digest"] = sha256_json(record)
    return record


def verify_build_manifest(manifest: dict[str, Any], *, source_root: str | Path) -> None:
    root = Path(source_root).resolve()
    if _git_head(root) != str(manifest.get("source_commit") or ""):
        raise ContractError("source commit drift from build manifest")
    _require_clean_tracked_source(root)
    check = {k: v for k, v in manifest.items() if k != "manifest_digest"}
    if manifest.get("manifest_digest") != sha256_json(check):
        raise ContractError("build manifest digest mismatch")
    if manifest.get("source_tree_digest") != source_tree_digest(root):
        raise ContractError("tracked source tree drift from build manifest")
    registry = root / manifest["registry_path"]
    if not registry.is_file() or sha256_file(registry) != manifest["registry_sha256"]:
        raise ContractError("registry drift from build manifest")
    for item in manifest.get("projections", []):
        path = root / item["path"]
        if not path.is_file() or sha256_file(path) != item["sha256"]:
            raise ContractError(f"installed/generated projection drift: {item['path']}")


def verify_installed_projections(manifest: dict[str, Any], *, install_root: str | Path) -> None:
    root = Path(install_root).resolve()
    for item in manifest.get("install_projections", []):
        rel = Path(str(item.get("install_path") or ""))
        if rel.is_absolute() or ".." in rel.parts:
            raise ContractError("build manifest contains unsafe install projection path")
        path = root / rel
        if not path.is_file():
            raise ContractError(f"installed projection missing: {rel.as_posix()}")
        if sha256_file(path) != item.get("sha256"):
            raise ContractError(f"installed projection drift: {rel.as_posix()}")
