"""Deterministic, self-contained WB-0 bootstrap bundle construction.

The bootstrap bundle is intentionally limited to the WB-0 standard-library
recovery tooling.  It contains no provider adapters, credentials, qualification
records, or Web Bridge code.  A clean host can run the bootstrap before an
ordinary CAO release has been activated.
"""
from __future__ import annotations

import os
import shutil
import stat
import tempfile
from pathlib import Path
from typing import Any

from .wb0_common import (
    WB0ContractError,
    WB0IntegrityError,
    WB0SafetyError,
    atomic_write_json,
    ensure_no_symlink_ancestors,
    fsync_directory,
    fsync_tree,
    lexical_absolute_path,
    lstat_kind,
    load_json_object,
    mode_string,
    sha256_file,
    sha256_json,
    write_all,
)

BOOTSTRAP_SCHEMA_VERSION = "1.0"
_WEB_BRIDGE_INCLUDED_KEY = "web_" + "bridge_included"
_REQUIRED_MODULES = {
    "wb0_bootstrap.py",
    "wb0_capsule.py",
    "wb0_cli.py",
    "wb0_common.py",
    "wb0_instance.py",
    "wb0_manifest.py",
    "wb0_recovery.py",
    "wb0_skills.py",
    "wb0_state.py",
}


def _copy_regular(source: Path, destination: Path, *, mode: int) -> None:
    try:
        before = os.lstat(source)
    except FileNotFoundError as exc:
        raise WB0ContractError(f"bootstrap source is missing: {source}") from exc
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise WB0SafetyError(
            f"bootstrap source must be a non-hardlinked regular file: {source}"
        )
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    destination_fd = os.open(
        destination,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        mode,
    )
    try:
        opened = os.fstat(source_fd)
        if (opened.st_dev, opened.st_ino, opened.st_size) != (
            before.st_dev,
            before.st_ino,
            before.st_size,
        ):
            raise WB0IntegrityError(f"bootstrap source changed while opening: {source}")
        while True:
            block = os.read(source_fd, 1024 * 1024)
            if not block:
                break
            write_all(destination_fd, block)
        os.fsync(destination_fd)
        after = os.fstat(source_fd)
        if (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) != (
            opened.st_dev,
            opened.st_ino,
            opened.st_size,
            opened.st_mtime_ns,
        ):
            raise WB0IntegrityError(f"bootstrap source changed during copy: {source}")
    finally:
        os.close(source_fd)
        os.close(destination_fd)


def _payload_entries(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix()
        if rel == "bootstrap-manifest.json":
            continue
        kind = lstat_kind(path)
        if kind not in {"directory", "file"}:
            raise WB0SafetyError(f"bootstrap contains unsupported object: {rel} ({kind})")
        st = os.lstat(path)
        record: dict[str, Any] = {
            "path": rel,
            "type": kind,
            "mode": mode_string(st.st_mode),
        }
        if kind == "file":
            if st.st_nlink != 1:
                raise WB0SafetyError(f"bootstrap hardlink is forbidden: {rel}")
            record.update({"size": st.st_size, "sha256": sha256_file(path)})
        entries.append(record)
    return entries


def verify_bootstrap_bundle(bundle_root: str | Path) -> dict[str, Any]:
    root = Path(bundle_root)
    if not root.is_dir() or root.is_symlink():
        raise WB0ContractError(f"bootstrap root must be a real directory: {root}")
    manifest_path = root / "bootstrap-manifest.json"
    if not manifest_path.is_file() or manifest_path.is_symlink():
        raise WB0IntegrityError("bootstrap-manifest.json is missing or unsafe")
    manifest = load_json_object(manifest_path)
    if manifest.get("schema_version") != BOOTSTRAP_SCHEMA_VERSION:
        raise WB0ContractError(
            f"unsupported bootstrap schema: {manifest.get('schema_version')!r}"
        )
    declared = manifest.get("manifest_digest")
    expected = sha256_json({k: v for k, v in manifest.items() if k != "manifest_digest"})
    if declared != expected:
        raise WB0IntegrityError("bootstrap manifest digest mismatch")
    entries = _payload_entries(root)
    if entries != manifest.get("entries"):
        raise WB0IntegrityError("bootstrap payload differs from its manifest")
    required = {
        "bin/mlgo-v2-wb0",
        "lib/mlgo_cao_v2/__init__.py",
        *{f"lib/mlgo_cao_v2/{name}" for name in _REQUIRED_MODULES},
    }
    actual_files = {entry["path"] for entry in entries if entry["type"] == "file"}
    missing = sorted(required - actual_files)
    if missing:
        raise WB0IntegrityError(f"bootstrap is missing required files: {missing}")
    return {
        "schema_version": BOOTSTRAP_SCHEMA_VERSION,
        "manifest_digest": declared,
        "file_count": len(actual_files),
        "provider_code_included": False,
        "credentials_included": False,
        _WEB_BRIDGE_INCLUDED_KEY: False,
    }


def build_bootstrap_bundle(
    *, source_cao_root: str | Path, output_directory: str | Path
) -> dict[str, Any]:
    source_root = lexical_absolute_path(str(source_cao_root), "source_cao_root")
    ensure_no_symlink_ancestors(source_root, allow_missing_tail=False)
    if not source_root.is_dir() or source_root.is_symlink():
        raise WB0ContractError(f"source_cao_root must be a real directory: {source_root}")
    launcher = source_root / "bin" / "mlgo-v2-wb0"
    module_root = source_root / "lib" / "mlgo_cao_v2"
    modules = {path.name: path for path in module_root.glob("wb0_*.py")}
    if set(modules) != _REQUIRED_MODULES:
        raise WB0IntegrityError(
            "WB-0 bootstrap module set drift: "
            f"expected={sorted(_REQUIRED_MODULES)} actual={sorted(modules)}"
        )

    output = lexical_absolute_path(str(output_directory), "bootstrap output")
    ensure_no_symlink_ancestors(output)
    if output.exists() or output.is_symlink():
        raise WB0SafetyError(f"bootstrap output already exists: {output}")
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=str(output.parent)))
    try:
        _copy_regular(launcher, temp / "bin" / "mlgo-v2-wb0", mode=0o555)
        package = temp / "lib" / "mlgo_cao_v2"
        package.mkdir(parents=True, exist_ok=True, mode=0o755)
        init_path = package / "__init__.py"
        init_bytes = (
            '"""Self-contained WB-0 bootstrap package; no provider authority."""\n'
            '__version__ = "wb0-bootstrap-1.0"\n'
        ).encode("utf-8")
        init_fd = os.open(
            init_path,
            os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
            0o444,
        )
        try:
            write_all(init_fd, init_bytes)
            os.fsync(init_fd)
        finally:
            os.close(init_fd)
        for name, source in sorted(modules.items()):
            _copy_regular(source, package / name, mode=0o444)
        for directory in sorted(
            (path for path in temp.rglob("*") if path.is_dir()),
            key=lambda item: len(item.parts),
            reverse=True,
        ):
            os.chmod(directory, 0o555)
        entries = _payload_entries(temp)
        manifest: dict[str, Any] = {
            "schema_version": BOOTSTRAP_SCHEMA_VERSION,
            "bundle_kind": "WB0_STANDARD_LIBRARY_RECOVERY_BOOTSTRAP",
            "entries": entries,
            "provider_code_included": False,
            "credentials_included": False,
            _WEB_BRIDGE_INCLUDED_KEY: False,
        }
        manifest["manifest_digest"] = sha256_json(manifest)
        atomic_write_json(temp / "bootstrap-manifest.json", manifest, mode=0o444)
        fsync_tree(temp)
        os.replace(temp, output)
        fsync_directory(output.parent)
    finally:
        if temp.exists():
            shutil.rmtree(temp, ignore_errors=True)
    verification = verify_bootstrap_bundle(output)
    return {"output": str(output), "verification": verification}
