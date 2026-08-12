"""Deterministic WB-0 release-capsule manifests and archive verification."""
from __future__ import annotations

import gzip
import os
import re
import stat
import tarfile
import tempfile
from pathlib import Path
from typing import Any, Iterable

from .wb0_bootstrap import verify_bootstrap_bundle
from .wb0_common import (
    WB0ContractError,
    WB0IntegrityError,
    WB0SafetyError,
    atomic_write_json,
    atomic_write_text,
    canonical_json_bytes,
    ensure_no_symlink_ancestors,
    fsync_directory,
    lexical_absolute_path,
    lstat_kind,
    mode_string,
    parse_mode,
    safe_relative_path,
    sha256_bytes,
    sha256_file,
    sha256_json,
    validate_git_sha,
    validate_id,
    validate_relative_symlink,
    validate_sha256,
)
from .wb0_skills import (
    EVIDENCE_LOCK_REL,
    LOCK_REL,
    SEALED_CACHE_REL,
    MIRROR_REL,
    verify_skill_capsule,
)

MANIFEST_SCHEMA_VERSION = "1.0"
MANIFEST_PATH = "manifests/release-manifest.json"
SUMS_PATH = "SHA256SUMS"
_METADATA_EXCLUSIONS = {MANIFEST_PATH, SUMS_PATH}

# High-confidence credential material only.  Generic words such as "auth" are
# deliberately not findings because source code and documentation legitimately
# discuss authentication.  Capture-spec allowlists remain the primary control.
# Split PEM sentinels across source literals so packaging this scanner does not
# make its own implementation look like a credential.  The compiled patterns
# are identical to the ordinary contiguous sentinels found in real key files.
_PRIVATE_KEY_PEM_PATTERN = rb"-----BEGIN " + rb"(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"
_GOOGLE_PRIVATE_KEY_PATTERN = (
    rb'"private_key"\s*:\s*"' + rb"-----BEGIN " + rb"PRIVATE KEY-----"
)
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[bytes]], ...] = (
    ("private_key_pem", re.compile(_PRIVATE_KEY_PEM_PATTERN)),
    ("aws_access_key", re.compile(rb"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("github_token", re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{32,255}\b")),
    ("slack_token", re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("openai_style_key", re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b")),
    ("bearer_token", re.compile(rb"(?i)authorization\s*:\s*bearer\s+[A-Za-z0-9._~+/-]{20,}")),
    ("google_private_key", re.compile(_GOOGLE_PRIVATE_KEY_PATTERN)),
)
_SECRET_BASENAMES = {
    ".env",
    "credentials.json",
    "service-account.json",
    "cookies.sqlite",
    "cookies.json",
    "login data",
    "key4.db",
    "cert9.db",
}
_SECRET_SUFFIXES = {".pem", ".p12", ".pfx", ".key"}


def _read_stable_regular(path: Path) -> tuple[bytes, os.stat_result]:
    before = os.lstat(path)
    if not stat.S_ISREG(before.st_mode):
        raise WB0IntegrityError(f"not a regular file: {path}")
    if before.st_nlink != 1:
        raise WB0SafetyError(f"hard-linked capsule file forbidden: {path}")
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise WB0IntegrityError(f"file changed during no-follow open: {path}")
        chunks: list[bytes] = []
        while True:
            chunk = os.read(fd, 1024 * 1024)
            if not chunk:
                break
            chunks.append(chunk)
        after = os.fstat(fd)
    finally:
        os.close(fd)
    if (
        opened.st_size != after.st_size
        or opened.st_mtime_ns != after.st_mtime_ns
        or opened.st_ctime_ns != after.st_ctime_ns
    ):
        raise WB0IntegrityError(f"file changed while hashing: {path}")
    return b"".join(chunks), after


def scan_secret_bytes(path: str, data: bytes) -> list[dict[str, str]]:
    rel = safe_relative_path(path)
    basename = Path(rel).name.lower()
    findings: list[dict[str, str]] = []
    if basename in _SECRET_BASENAMES or any(basename.endswith(s) for s in _SECRET_SUFFIXES):
        findings.append({"path": rel, "rule": "forbidden_secret_store_filename"})
    for rule, pattern in _SECRET_PATTERNS:
        if pattern.search(data):
            findings.append({"path": rel, "rule": rule})
    return findings


def scan_capsule_for_secrets(root: str | Path) -> dict[str, Any]:
    base = Path(root)
    findings: list[dict[str, str]] = []
    scanned_files = 0
    for path in sorted(base.rglob("*"), key=lambda p: p.relative_to(base).as_posix()):
        rel = path.relative_to(base).as_posix()
        if rel in _METADATA_EXCLUSIONS:
            continue
        kind = lstat_kind(path)
        if kind == "file":
            data, _ = _read_stable_regular(path)
            scanned_files += 1
            findings.extend(scan_secret_bytes(rel, data))
        elif kind == "special":
            findings.append({"path": rel, "rule": "special_file"})
    return {
        "schema_version": "1.0",
        "status": "PASS" if not findings else "FAIL",
        "scanned_files": scanned_files,
        "findings": findings,
        "ruleset": "wb0-high-confidence-v1",
    }


def _entry_for(path: Path, root: Path, provenance: dict[str, Any] | None) -> dict[str, Any]:
    rel = safe_relative_path(path.relative_to(root).as_posix())
    st = os.lstat(path)
    kind = lstat_kind(path)
    if kind == "special":
        raise WB0SafetyError(f"special file forbidden in capsule: {rel}")
    entry: dict[str, Any] = {
        "path": rel,
        "type": kind,
        "mode": mode_string(st.st_mode),
        "provenance": dict(provenance or {"class": "generated"}),
    }
    if kind == "file":
        data, opened = _read_stable_regular(path)
        entry["size"] = opened.st_size
        entry["sha256"] = sha256_bytes(data)
    elif kind == "symlink":
        target = os.readlink(path)
        entry["target"] = validate_relative_symlink(rel, target)
    return entry


def _provenance_for(
    rel: str, provenance_rules: Iterable[dict[str, Any]] | None
) -> dict[str, Any]:
    matches: list[tuple[int, dict[str, Any]]] = []
    for rule in provenance_rules or ():
        prefix = safe_relative_path(rule.get("prefix"), "provenance prefix")
        if rel == prefix or rel.startswith(prefix.rstrip("/") + "/"):
            record = rule.get("record")
            if not isinstance(record, dict):
                raise WB0ContractError("provenance rule record must be an object")
            matches.append((len(prefix), record))
    if not matches:
        return {"class": "generated"}
    matches.sort(key=lambda item: item[0], reverse=True)
    return dict(matches[0][1])


def _verify_activation_layout(root: Path) -> dict[str, Any]:
    required_directories = (
        "release/bin",
        "release/lib/mlgo_cao_v2",
        "release/share/registry",
        "release/share/schemas",
        "release/share/examples",
        "release/share/profile-sources",
        "config",
        "services",
        "recovery/state-seed",
        SEALED_CACHE_REL.as_posix(),
        MIRROR_REL.as_posix(),
    )
    required_files = (
        "release/bin/mlgo-v2",
        "release/bin/mlgo-v2-controller",
        "release/share/registry/provider-registry.json",
        "release/share/profile-sources/generate_profiles.py",
        LOCK_REL.as_posix(),
        EVIDENCE_LOCK_REL.as_posix(),
        "services/mlgo-cao-v2-controller.service.in",
        "bootstrap/bin/mlgo-v2-wb0",
        "bootstrap/lib/mlgo_cao_v2/wb0_cli.py",
        "bootstrap/bootstrap-manifest.json",
    )
    for rel in required_directories:
        path = root / rel
        try:
            kind = lstat_kind(path)
        except FileNotFoundError as exc:
            raise WB0IntegrityError(f"capsule activation directory missing: {rel}") from exc
        if kind != "directory":
            raise WB0SafetyError(f"capsule activation path is not a directory: {rel}")
    for rel in required_files:
        path = root / rel
        try:
            kind = lstat_kind(path)
        except FileNotFoundError as exc:
            raise WB0IntegrityError(f"capsule activation file missing: {rel}") from exc
        if kind != "file":
            raise WB0SafetyError(f"capsule activation path is not a regular file: {rel}")
    policy_candidates = (
        root / "config/cao-policy.template.json",
        root / "config/cao-policy.json",
    )
    if not any(path.is_file() and not path.is_symlink() for path in policy_candidates):
        raise WB0IntegrityError("capsule config lacks cao-policy.json or cao-policy.template.json")
    bootstrap = verify_bootstrap_bundle(root / "bootstrap")
    return {
        "schema_version": "1.0",
        "required_directories": list(required_directories),
        "required_files": list(required_files),
        "policy_template_present": True,
        "bootstrap": bootstrap,
    }


def build_release_manifest(
    *,
    capsule_root: str | Path,
    release_id: str,
    source_commit: str,
    runtime_version: str,
    state_contract: dict[str, Any],
    skill_contract: dict[str, Any],
    provenance_rules: Iterable[dict[str, Any]] | None = None,
    created_at: str,
) -> dict[str, Any]:
    root = Path(capsule_root)
    validate_id(release_id, "release_id")
    validate_git_sha(source_commit)
    if not isinstance(runtime_version, str) or not runtime_version:
        raise WB0ContractError("runtime_version must be non-empty")
    if not root.is_dir() or root.is_symlink():
        raise WB0ContractError(f"capsule_root must be a real directory: {root}")

    entries: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix()
        if rel in _METADATA_EXCLUSIONS:
            continue
        entries.append(_entry_for(path, root, _provenance_for(rel, provenance_rules)))

    activation_layout = _verify_activation_layout(root)
    skill_verification = verify_skill_capsule(root, skill_contract)
    secret_scan = scan_capsule_for_secrets(root)
    if secret_scan["status"] != "PASS":
        raise WB0SafetyError(f"secret scan failed: {secret_scan['findings']}")

    manifest: dict[str, Any] = {
        "schema_version": MANIFEST_SCHEMA_VERSION,
        "release_id": release_id,
        "source_commit": source_commit,
        "runtime_version": runtime_version,
        "created_at": created_at,
        "entries": entries,
        "state_contract": state_contract,
        "skill_contract": skill_contract,
        "skill_verification": skill_verification,
        "activation_layout": activation_layout,
        "safe_posture": {
            "orchestration_mode": "v2_shadow",
            "semantic_enforcement": "shadow_only",
            "production_enforcement": False,
            "provider_calls_during_recovery": 0,
        },
        "host_qualification_portable": False,
        "secret_scan": secret_scan,
    }
    manifest["manifest_digest"] = sha256_json(manifest)
    return manifest


def _canonical_sums(root: Path) -> str:
    lines: list[str] = []
    for path in sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix()):
        rel = path.relative_to(root).as_posix()
        if rel == SUMS_PATH or lstat_kind(path) != "file":
            continue
        lines.append(f"{sha256_file(path)}  {rel}")
    return "\n".join(lines) + "\n"




def normalize_capsule_modes(root: str | Path) -> None:
    """Make capsule payload immutable-by-permission while preserving execute bits."""
    base = Path(root)
    paths = sorted(base.rglob("*"), key=lambda p: len(p.relative_to(base).parts), reverse=True)
    for path in paths:
        kind = lstat_kind(path)
        if kind == "file":
            current = stat.S_IMODE(os.lstat(path).st_mode)
            os.chmod(path, (current & ~0o222) | 0o400)
        elif kind == "directory":
            current = stat.S_IMODE(os.lstat(path).st_mode)
            os.chmod(path, (current & ~0o222) | 0o500)
        elif kind == "special":
            raise WB0SafetyError(f"special file forbidden in capsule: {path}")
    os.chmod(base, 0o500)

def seal_release_capsule(
    *,
    capsule_root: str | Path,
    release_id: str,
    source_commit: str,
    runtime_version: str,
    state_contract: dict[str, Any],
    skill_contract: dict[str, Any],
    provenance_rules: Iterable[dict[str, Any]] | None,
    created_at: str,
) -> dict[str, Any]:
    root = Path(capsule_root)
    manifest_path = root / MANIFEST_PATH
    manifest_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    normalize_capsule_modes(root)
    manifest = build_release_manifest(
        capsule_root=root,
        release_id=release_id,
        source_commit=source_commit,
        runtime_version=runtime_version,
        state_contract=state_contract,
        skill_contract=skill_contract,
        provenance_rules=provenance_rules,
        created_at=created_at,
    )
    os.chmod(manifest_path.parent, 0o700)
    atomic_write_json(manifest_path, manifest, mode=0o400)
    os.chmod(manifest_path.parent, 0o500)
    os.chmod(root, 0o700)
    atomic_write_text(root / SUMS_PATH, _canonical_sums(root), mode=0o400)
    os.chmod(root, 0o500)
    verify_release_capsule(root)
    return manifest


def _load_manifest(root: Path) -> dict[str, Any]:
    path = root / MANIFEST_PATH
    if lstat_kind(path) != "file":
        raise WB0IntegrityError(f"release manifest missing or unsafe: {path}")
    import json

    data, _ = _read_stable_regular(path)
    value = json.loads(data.decode("utf-8"))
    if not isinstance(value, dict):
        raise WB0ContractError("release manifest must be an object")
    if value.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        raise WB0ContractError(
            f"unsupported release manifest schema: {value.get('schema_version')!r}"
        )
    declared = value.get("manifest_digest")
    expected = sha256_json({k: v for k, v in value.items() if k != "manifest_digest"})
    if declared != expected:
        raise WB0IntegrityError(
            f"release manifest digest mismatch: declared={declared} expected={expected}"
        )
    validate_id(value.get("release_id"), "release_id")
    validate_git_sha(value.get("source_commit"))
    return value


def _verify_sums(root: Path) -> None:
    sums = root / SUMS_PATH
    if lstat_kind(sums) != "file":
        raise WB0IntegrityError("SHA256SUMS missing or unsafe")
    data, _ = _read_stable_regular(sums)
    raw = data.decode("utf-8")
    seen: set[str] = set()
    for line_number, line in enumerate(raw.splitlines(), 1):
        if not line:
            continue
        if "  " not in line:
            raise WB0ContractError(f"invalid SHA256SUMS line {line_number}")
        digest, rel = line.split("  ", 1)
        validate_sha256(digest, f"SHA256SUMS line {line_number}")
        rel = safe_relative_path(rel, f"SHA256SUMS path line {line_number}")
        if rel == SUMS_PATH or rel in seen:
            raise WB0ContractError(f"duplicate or recursive SHA256SUMS path: {rel}")
        seen.add(rel)
        path = root / rel
        if lstat_kind(path) != "file" or sha256_file(path) != digest:
            raise WB0IntegrityError(f"SHA256SUMS mismatch: {rel}")
    expected = {
        p.relative_to(root).as_posix()
        for p in root.rglob("*")
        if p.relative_to(root).as_posix() != SUMS_PATH and lstat_kind(p) == "file"
    }
    if seen != expected:
        raise WB0IntegrityError(
            f"SHA256SUMS coverage mismatch: missing={sorted(expected-seen)} extra={sorted(seen-expected)}"
        )
    if raw != _canonical_sums(root):
        raise WB0IntegrityError("SHA256SUMS is not canonical or sorted")


def verify_release_capsule(capsule_root: str | Path) -> dict[str, Any]:
    root = Path(capsule_root)
    if not root.is_dir() or root.is_symlink():
        raise WB0ContractError(f"capsule root must be a real directory: {root}")
    manifest = _load_manifest(root)
    expected_entries = manifest.get("entries")
    if not isinstance(expected_entries, list):
        raise WB0ContractError("release manifest entries must be an array")
    expected_by_path: dict[str, dict[str, Any]] = {}
    for entry in expected_entries:
        if not isinstance(entry, dict):
            raise WB0ContractError("release manifest entry must be an object")
        rel = safe_relative_path(entry.get("path"), "manifest entry path")
        if rel in expected_by_path or rel in _METADATA_EXCLUSIONS:
            raise WB0ContractError(f"duplicate/reserved manifest entry: {rel}")
        expected_by_path[rel] = entry

    actual_paths = {
        p.relative_to(root).as_posix()
        for p in root.rglob("*")
        if p.relative_to(root).as_posix() not in _METADATA_EXCLUSIONS
    }
    if actual_paths != set(expected_by_path):
        raise WB0IntegrityError(
            "capsule path set mismatch: "
            f"missing={sorted(set(expected_by_path)-actual_paths)} "
            f"unexpected={sorted(actual_paths-set(expected_by_path))}"
        )

    for rel, entry in sorted(expected_by_path.items()):
        path = root / rel
        kind = lstat_kind(path)
        if kind != entry.get("type"):
            raise WB0IntegrityError(
                f"entry type mismatch for {rel}: {kind} != {entry.get('type')}"
            )
        actual_mode = mode_string(os.lstat(path).st_mode)
        parse_mode(entry.get("mode"), f"mode for {rel}")
        if actual_mode != entry["mode"]:
            raise WB0IntegrityError(
                f"entry mode mismatch for {rel}: {actual_mode} != {entry['mode']}"
            )
        if kind == "file":
            data, st = _read_stable_regular(path)
            validate_sha256(entry.get("sha256"), f"sha256 for {rel}")
            if st.st_size != entry.get("size") or sha256_bytes(data) != entry["sha256"]:
                raise WB0IntegrityError(f"file size/digest mismatch: {rel}")
        elif kind == "symlink":
            target = os.readlink(path)
            validate_relative_symlink(rel, target)
            if target != entry.get("target"):
                raise WB0IntegrityError(f"symlink target mismatch: {rel}")
        if not isinstance(entry.get("provenance"), dict):
            raise WB0ContractError(f"entry provenance missing: {rel}")

    activation_layout = _verify_activation_layout(root)
    if activation_layout != manifest.get("activation_layout"):
        raise WB0IntegrityError("capsule activation-layout evidence drift")
    skill_verification = verify_skill_capsule(root, manifest.get("skill_contract") or {})
    if skill_verification != manifest.get("skill_verification"):
        raise WB0IntegrityError("capsule skill-verification evidence drift")
    secret_scan = scan_capsule_for_secrets(root)
    if secret_scan["status"] != "PASS":
        raise WB0SafetyError(f"capsule now contains secret-like material: {secret_scan['findings']}")
    _verify_sums(root)
    safe = manifest.get("safe_posture") or {}
    if (
        safe.get("orchestration_mode") != "v2_shadow"
        or safe.get("semantic_enforcement") != "shadow_only"
        or safe.get("production_enforcement") is not False
        or safe.get("provider_calls_during_recovery") != 0
    ):
        raise WB0SafetyError("release manifest does not bind the required safe posture")
    if manifest.get("host_qualification_portable") is not False:
        raise WB0SafetyError("provider qualification must remain host-specific")
    return manifest


def create_deterministic_tar_gz(capsule_root: str | Path, output_path: str | Path) -> Path:
    root = Path(capsule_root)
    verify_release_capsule(root)
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{output.name}.", dir=str(output.parent))
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with tmp.open("wb") as raw, gzip.GzipFile(
            filename="", fileobj=raw, mode="wb", mtime=0
        ) as gz:
            with tarfile.open(fileobj=gz, mode="w", format=tarfile.PAX_FORMAT) as tar:
                for path in [root] + sorted(root.rglob("*"), key=lambda p: p.relative_to(root).as_posix()):
                    arcname = root.name if path == root else f"{root.name}/{path.relative_to(root).as_posix()}"
                    info = tar.gettarinfo(str(path), arcname=arcname)
                    info.uid = info.gid = 0
                    info.uname = info.gname = ""
                    info.mtime = 0
                    if info.isreg():
                        with path.open("rb") as handle:
                            tar.addfile(info, handle)
                    else:
                        tar.addfile(info)
        os.replace(tmp, output)
        fsync_directory(output.parent)
    finally:
        tmp.unlink(missing_ok=True)
    return output


def _safe_member_name(name: str) -> str:
    if not isinstance(name, str) or not name or name.startswith("/") or "\\" in name:
        raise WB0SafetyError(f"unsafe archive member: {name!r}")
    parts = Path(name).parts
    if ".." in parts or any(part in {"", "."} for part in parts):
        raise WB0SafetyError(f"unsafe archive member: {name!r}")
    return Path(*parts).as_posix()


def safe_extract_tar_gz(archive: str | Path, destination: str | Path) -> Path:
    """Extract a WB-0 capsule without traversal, hardlinks, devices, or link pivots."""
    dest = lexical_absolute_path(str(destination), "archive destination")
    ensure_no_symlink_ancestors(dest)
    dest.mkdir(parents=True, exist_ok=True, mode=0o700)
    if lstat_kind(dest) != "directory":
        raise WB0SafetyError(f"archive destination must be a real directory: {dest}")
    if any(dest.iterdir()):
        raise WB0SafetyError(f"archive destination must be empty: {dest}")
    with tarfile.open(archive, mode="r:gz") as tar:
        members = tar.getmembers()
        if not members:
            raise WB0ContractError("empty WB-0 archive")
        names: set[str] = set()
        top_levels: set[str] = set()
        symlink_names: set[str] = set()
        normalized: list[tuple[tarfile.TarInfo, str]] = []
        for member in members:
            name = _safe_member_name(member.name)
            if name in names:
                raise WB0SafetyError(f"duplicate archive member: {name}")
            names.add(name)
            top_levels.add(name.split("/", 1)[0])
            if member.islnk() or member.ischr() or member.isblk() or member.isfifo():
                raise WB0SafetyError(f"unsafe archive entry type: {name}")
            if not (member.isdir() or member.isreg() or member.issym()):
                raise WB0SafetyError(f"unsupported archive entry type: {name}")
            if member.issym():
                validate_relative_symlink(name, member.linkname)
                symlink_names.add(name)
            normalized.append((member, name))
        if len(top_levels) != 1:
            raise WB0SafetyError("WB-0 archive must contain exactly one top-level directory")
        for _, name in normalized:
            parents = Path(name).parents
            for parent in parents:
                if parent.as_posix() == ".":
                    continue
                if parent.as_posix() in symlink_names:
                    raise WB0SafetyError(
                        f"archive member traverses a symlink member: {name} via {parent}"
                    )

        directories = sorted(
            ((m, n) for m, n in normalized if m.isdir()),
            key=lambda item: (len(Path(item[1]).parts), item[1]),
        )
        for _, name in directories:
            (dest / name).mkdir(parents=True, exist_ok=True, mode=0o700)

        for member, name in normalized:
            target = dest / name
            if member.isdir():
                continue
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            if member.issym():
                os.symlink(member.linkname, target)
                continue
            source = tar.extractfile(member)
            if source is None:
                raise WB0IntegrityError(f"cannot read archive member: {name}")
            fd = os.open(
                target,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                member.mode & 0o777,
            )
            try:
                with os.fdopen(fd, "wb") as handle:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk:
                            break
                        handle.write(chunk)
                    handle.flush()
                    os.fsync(handle.fileno())
            finally:
                source.close()
            os.chmod(target, member.mode & 0o777)

        for member, name in sorted(
            directories, key=lambda item: len(Path(item[1]).parts), reverse=True
        ):
            os.chmod(dest / name, member.mode & 0o777)
        top = dest / next(iter(top_levels))
        verify_release_capsule(top)
        return top

