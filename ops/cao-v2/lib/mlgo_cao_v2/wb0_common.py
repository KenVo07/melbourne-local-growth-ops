"""WB-0 deterministic filesystem primitives.

This module is intentionally standard-library only.  WB-0 manipulates release,
configuration, and state *pointers*, not provider transports.  The helpers below
therefore bias toward lstat/no-follow inspection, same-filesystem atomic rename,
fsync, and explicit fail-closed validation.
"""
from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import stat
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any, Iterator

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class WB0Error(RuntimeError):
    """Base failure for WB-0 tooling."""


class WB0ContractError(WB0Error):
    """Input or durable record violates a WB-0 contract."""


class WB0IntegrityError(WB0Error):
    """A digest, mode, path, pointer, or sealed byte is inconsistent."""


class WB0SafetyError(WB0Error):
    """An operation would violate a recovery safety boundary."""


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso_now() -> str:
    return utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> dt.datetime:
    if value.endswith("Z"):
        value = value[:-1] + "+00:00"
    parsed = dt.datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=dt.timezone.utc)
    return parsed.astimezone(dt.timezone.utc)


def validate_id(value: object, label: str) -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise WB0ContractError(
            f"invalid {label}: use 1-128 letters, digits, dots, underscores, or hyphens"
        )
    return value


def validate_sha256(value: object, label: str = "sha256") -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise WB0ContractError(f"invalid {label}: expected 64 lowercase hex characters")
    return value


def validate_git_sha(value: object, label: str = "source_commit") -> str:
    if not isinstance(value, str) or not GIT_SHA_RE.fullmatch(value):
        raise WB0ContractError(f"invalid {label}: expected a full lowercase Git SHA")
    return value


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False
    ).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def write_all(fd: int, data: bytes) -> None:
    """Write every byte, handling short ``os.write`` results explicitly."""
    view = memoryview(data)
    while view:
        written = os.write(fd, view)
        if written <= 0:
            raise WB0IntegrityError("short filesystem write made no progress")
        view = view[written:]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        with os.fdopen(fd, "rb", closefd=False) as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    finally:
        os.close(fd)
    return digest.hexdigest()


def load_json_object(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    try:
        value = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise WB0ContractError(f"cannot load JSON object {p}: {exc}") from exc
    if not isinstance(value, dict):
        raise WB0ContractError(f"expected JSON object: {p}")
    return value


def fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write_bytes(path: Path, data: bytes, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        fsync_directory(path.parent)
    finally:
        tmp.unlink(missing_ok=True)


def atomic_write_text(path: Path, text: str, mode: int = 0o600) -> None:
    atomic_write_bytes(path, text.encode("utf-8"), mode=mode)


def atomic_write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    atomic_write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n", mode)


@contextlib.contextmanager
def file_lock(path: Path) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def safe_relative_path(raw: object, label: str = "path") -> str:
    if not isinstance(raw, str) or not raw or "\x00" in raw or "\\" in raw:
        raise WB0ContractError(f"invalid {label}: {raw!r}")
    path = PurePosixPath(raw)
    if path.is_absolute() or raw in {".", ".."} or ".." in path.parts:
        raise WB0ContractError(f"{label} must be a safe non-empty relative POSIX path: {raw!r}")
    normalized = path.as_posix()
    if normalized.startswith("./") or "//" in raw:
        raise WB0ContractError(f"{label} is not canonically normalized: {raw!r}")
    return normalized


def lexical_absolute_path(raw: object, label: str) -> Path:
    if not isinstance(raw, str) or not raw or "\x00" in raw:
        raise WB0ContractError(f"invalid {label}: {raw!r}")
    path = Path(raw).expanduser()
    if not path.is_absolute():
        raise WB0ContractError(f"{label} must be absolute: {path}")
    normalized = Path(os.path.normpath(str(path)))
    if normalized == Path("/"):
        raise WB0SafetyError(f"{label} may not be filesystem root")
    if any(part == ".." for part in path.parts):
        raise WB0ContractError(f"{label} may not contain '..': {path}")
    return normalized


def is_path_within(child: Path, parent: Path) -> bool:
    try:
        child.relative_to(parent)
        return True
    except ValueError:
        return False


def paths_overlap(a: Path, b: Path) -> bool:
    return is_path_within(a, b) or is_path_within(b, a)


def ensure_no_symlink_ancestors(path: Path, *, allow_missing_tail: bool = True) -> None:
    """Reject a path whose existing ancestor is a symlink.

    This is a lexical/host-local defense against redirecting a recovery write
    into another instance or project between configuration review and apply.
    """
    current = Path(path.anchor)
    parts = path.parts[1:] if path.is_absolute() else path.parts
    for index, part in enumerate(parts):
        current = current / part
        try:
            st = os.lstat(current)
        except FileNotFoundError:
            if allow_missing_tail:
                return
            raise WB0SafetyError(f"required path component is missing: {current}")
        if stat.S_ISLNK(st.st_mode):
            raise WB0SafetyError(f"symlink ancestor is not allowed: {current}")
        if index < len(parts) - 1 and not stat.S_ISDIR(st.st_mode):
            raise WB0SafetyError(f"non-directory ancestor: {current}")


def lstat_kind(path: Path) -> str:
    mode = os.lstat(path).st_mode
    if stat.S_ISREG(mode):
        return "file"
    if stat.S_ISDIR(mode):
        return "directory"
    if stat.S_ISLNK(mode):
        return "symlink"
    return "special"


def mode_string(mode: int) -> str:
    return f"{stat.S_IMODE(mode):04o}"


def parse_mode(value: object, label: str = "mode") -> int:
    if not isinstance(value, str) or not re.fullmatch(r"0[0-7]{3}", value):
        raise WB0ContractError(f"invalid {label}: expected four-digit octal string")
    return int(value, 8)


def validate_relative_symlink(path: str, target: str) -> str:
    if not isinstance(target, str) or not target or "\x00" in target or "\\" in target:
        raise WB0ContractError(f"invalid symlink target for {path!r}: {target!r}")
    target_path = PurePosixPath(target)
    if target_path.is_absolute():
        raise WB0SafetyError(f"absolute symlink target forbidden in capsule: {path} -> {target}")
    stack = list(PurePosixPath(path).parent.parts)
    for part in target_path.parts:
        if part in {"", "."}:
            continue
        if part == "..":
            if not stack:
                raise WB0SafetyError(f"symlink escapes capsule: {path} -> {target}")
            stack.pop()
        else:
            stack.append(part)
    return target


def atomic_symlink(target: str, link_path: Path) -> None:
    """Atomically replace one symlink without following either target."""
    if not target:
        raise WB0ContractError("symlink target may not be empty")
    link_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = link_path.parent / f".{link_path.name}.{os.getpid()}.{os.urandom(4).hex()}"
    try:
        os.symlink(target, tmp)
        os.replace(tmp, link_path)
        fsync_directory(link_path.parent)
    finally:
        tmp.unlink(missing_ok=True)


def read_symlink_optional(path: Path) -> str | None:
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return None
    if not stat.S_ISLNK(st.st_mode):
        raise WB0IntegrityError(f"expected symlink pointer: {path}")
    return os.readlink(path)


def require_same_filesystem(a: Path, b_parent: Path) -> None:
    a_dev = os.stat(a).st_dev
    b_parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    b_dev = os.stat(b_parent).st_dev
    if a_dev != b_dev:
        raise WB0SafetyError(
            f"atomic rename requires one filesystem: {a} and {b_parent} differ"
        )


def fsync_tree(root: Path) -> None:
    """Fsync regular files and directories bottom-up without following links."""
    directories: list[Path] = []
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        directories.append(current_path)
        for name in list(dirnames):
            candidate = current_path / name
            if candidate.is_symlink():
                dirnames.remove(name)
        for name in filenames:
            candidate = current_path / name
            if lstat_kind(candidate) == "file":
                fd = os.open(candidate, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
    for directory in reversed(directories):
        fsync_directory(directory)
