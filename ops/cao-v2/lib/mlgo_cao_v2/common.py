"""Shared primitives for the MLGO CAO v2 control plane.

All durable writes in this package are local, atomic where practical, fsynced,
and fail closed.  Semantic decisions remain outside this module.
"""

from __future__ import annotations

import contextlib
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Iterator, Sequence

ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class MLGOError(RuntimeError):
    """Base exception for v2 control-plane failures."""


class ContractError(MLGOError):
    """Raised when a durable packet or state record is invalid."""


class PolicyError(MLGOError):
    """Raised when an action violates policy."""


class CommandError(MLGOError):
    """Raised when a deterministic subprocess fails."""

    def __init__(self, command: Sequence[str], returncode: int, stdout: str, stderr: str):
        self.command = list(command)
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
        rendered = " ".join(command)
        super().__init__(f"command failed ({returncode}): {rendered}\n{stderr.strip()}")


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


def validate_id(value: str, label: str = "id") -> str:
    if not isinstance(value, str) or not ID_RE.fullmatch(value):
        raise ContractError(
            f"invalid {label}: use 1-128 letters, digits, dots, underscores, or hyphens"
        )
    return value


def validate_sha(value: str, label: str = "sha") -> str:
    if not isinstance(value, str) or not SHA_RE.fullmatch(value):
        raise ContractError(f"invalid {label}: expected a full 40-character lowercase Git SHA")
    return value


def ensure_absolute(path: str | Path, label: str = "path") -> Path:
    p = Path(path)
    if not p.is_absolute():
        raise ContractError(f"{label} must be absolute: {p}")
    return p


def canonical_json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_json(value: Any) -> str:
    return sha256_bytes(canonical_json_bytes(value))


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def load_json(path: str | Path) -> dict[str, Any]:
    p = Path(path)
    with p.open(encoding="utf-8") as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ContractError(f"expected JSON object: {p}")
    return value


def fsync_directory(path: Path) -> None:
    fd = os.open(path, os.O_RDONLY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def atomic_write_text(path: Path, text: str, mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    tmp = Path(tmp_name)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        fsync_directory(path.parent)
    finally:
        if tmp.exists():
            tmp.unlink(missing_ok=True)


def atomic_write_json(path: Path, value: Any, mode: int = 0o600) -> None:
    atomic_write_text(path, json.dumps(value, indent=2, sort_keys=True) + "\n", mode=mode)


def append_jsonl(path: Path, value: dict[str, Any], mode: int = 0o600) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    line = canonical_json_bytes(value) + b"\n"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, mode)
    try:
        os.write(fd, line)
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_directory(path.parent)


def read_jsonl(path: Path, *, allow_trailing_partial: bool = False) -> tuple[list[dict[str, Any]], int | None]:
    """Read JSONL records and report a trailing partial-line byte offset.

    A partial final record can exist only when the writer was interrupted before
    a complete fsynced line.  Callers may truncate that suffix under an exclusive
    lock; malformed complete lines are never silently ignored.
    """

    if not path.exists():
        return [], None
    raw = path.read_bytes()
    records: list[dict[str, Any]] = []
    offset = 0
    for chunk in raw.splitlines(keepends=True):
        complete = chunk.endswith(b"\n")
        payload = chunk[:-1] if complete else chunk
        if not payload.strip():
            offset += len(chunk)
            continue
        try:
            value = json.loads(payload)
        except json.JSONDecodeError as exc:
            if not complete and allow_trailing_partial and offset + len(chunk) == len(raw):
                return records, offset
            raise ContractError(f"invalid JSONL record at byte {offset} in {path}: {exc}") from exc
        if not isinstance(value, dict):
            raise ContractError(f"non-object JSONL record at byte {offset} in {path}")
        records.append(value)
        offset += len(chunk)
    return records, None


def truncate_file(path: Path, size: int) -> None:
    fd = os.open(path, os.O_WRONLY)
    try:
        os.ftruncate(fd, size)
        os.fsync(fd)
    finally:
        os.close(fd)
    fsync_directory(path.parent)


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


def run(
    command: Sequence[str],
    *,
    cwd: str | Path | None = None,
    timeout: int | float = 60,
    env: dict[str, str] | None = None,
    check: bool = True,
    input_text: str | None = None,
) -> subprocess.CompletedProcess[str]:
    merged_env = os.environ.copy()
    if env:
        merged_env.update(env)
    proc = subprocess.run(
        list(command),
        cwd=str(cwd) if cwd is not None else None,
        timeout=timeout,
        env=merged_env,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if check and proc.returncode != 0:
        raise CommandError(command, proc.returncode, proc.stdout, proc.stderr)
    return proc


def safe_relative_path(raw: str) -> str:
    p = Path(raw)
    if p.is_absolute() or ".." in p.parts or raw in {"", "."}:
        raise ContractError(f"path must be a non-empty repository-relative path: {raw!r}")
    return p.as_posix()


def is_terminal_run_status(value: object) -> bool:
    return str(value or "").upper() in {
        "COMPLETED",
        "FINALIZED",
        "FAILED",
        "CANCELLED",
        "ABANDONED",
    }


def bounded_text(value: object, *, label: str, maximum: int) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ContractError(f"{label} must be a non-empty string")
    value = value.strip()
    if len(value) > maximum:
        raise ContractError(f"{label} exceeds {maximum} characters")
    return value
