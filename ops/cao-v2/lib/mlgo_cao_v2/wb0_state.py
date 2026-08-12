"""Filesystem-backed immutable state generations for WB-0."""
from __future__ import annotations

import os
import shutil
import stat
import tempfile
from pathlib import Path
from typing import Any, Iterable

from .wb0_common import (
    WB0ContractError,
    WB0IntegrityError,
    WB0SafetyError,
    atomic_symlink,
    atomic_write_json,
    file_lock,
    fsync_tree,
    is_path_within,
    lexical_absolute_path,
    load_json_object,
    mode_string,
    paths_overlap,
    read_symlink_optional,
    safe_relative_path,
    sha256_file,
    sha256_json,
    validate_id,
    write_all,
)

GENERATION_SCHEMA_VERSION = "1.1"
STATE_SCHEMA_ID = "mlgo-cao-v2-control-state"


def _walk_regular_tree(root: Path) -> list[Path]:
    if not root.is_dir() or root.is_symlink():
        raise WB0ContractError(f"state source/payload must be a real directory: {root}")
    paths: list[Path] = []
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in sorted(dirnames):
            candidate = current_path / name
            st = os.lstat(candidate)
            if stat.S_ISLNK(st.st_mode):
                raise WB0SafetyError(f"state generation forbids symlink directories: {candidate}")
            if not stat.S_ISDIR(st.st_mode):
                raise WB0SafetyError(f"state generation forbids special entries: {candidate}")
            paths.append(candidate)
        for name in sorted(filenames):
            candidate = current_path / name
            st = os.lstat(candidate)
            if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode):
                raise WB0SafetyError(f"state generation accepts regular files only: {candidate}")
            if st.st_nlink != 1:
                raise WB0SafetyError(f"state generation forbids hard-linked files: {candidate}")
            paths.append(candidate)
    return sorted(paths, key=lambda p: p.relative_to(root).as_posix())


def _payload_entries(payload: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for path in _walk_regular_tree(payload):
        rel = safe_relative_path(path.relative_to(payload).as_posix())
        st = os.lstat(path)
        if stat.S_ISDIR(st.st_mode):
            entries.append({"path": rel, "type": "directory", "mode": mode_string(st.st_mode)})
        else:
            entries.append(
                {
                    "path": rel,
                    "type": "file",
                    "mode": mode_string(st.st_mode),
                    "size": st.st_size,
                    "sha256": sha256_file(path),
                }
            )
    return entries


def _projected_payload_entries(
    payload: Path, *, immutable: bool, exclude: Iterable[str] = ()
) -> list[dict[str, Any]]:
    excluded = {safe_relative_path(item, "state exclusion") for item in exclude}
    result: list[dict[str, Any]] = []
    for path in _walk_regular_tree(payload):
        rel = path.relative_to(payload).as_posix()
        if any(rel == item or rel.startswith(item.rstrip("/") + "/") for item in excluded):
            continue
        st = os.lstat(path)
        if stat.S_ISDIR(st.st_mode):
            mode = (
                (stat.S_IMODE(st.st_mode) & ~0o222) | 0o500
                if immutable
                else 0o700
            )
            result.append(
                {"path": rel, "type": "directory", "mode": f"{mode:04o}"}
            )
        else:
            mode = (
                (stat.S_IMODE(st.st_mode) & ~0o222) | 0o400
                if immutable
                else 0o600
            )
            result.append(
                {
                    "path": rel,
                    "type": "file",
                    "mode": f"{mode:04o}",
                    "size": st.st_size,
                    "sha256": sha256_file(path),
                }
            )
    return result


def _projected_payload_root_mode(source: Path, *, immutable: bool) -> str:
    mode = stat.S_IMODE(os.lstat(source).st_mode)
    projected = (mode & ~0o222) | 0o500 if immutable else 0o700
    return f"{projected:04o}"


def _verify_generation_layout(directory: Path) -> None:
    try:
        root_st = os.lstat(directory)
    except FileNotFoundError as exc:
        raise WB0IntegrityError(f"generation missing: {directory}") from exc
    if not stat.S_ISDIR(root_st.st_mode):
        raise WB0SafetyError(f"generation root must be a real directory: {directory}")
    expected = {"generation.json", "SEALED.json", "payload"}
    actual = {entry.name for entry in directory.iterdir()}
    if actual != expected:
        raise WB0IntegrityError(
            f"generation root path set mismatch: missing={sorted(expected-actual)} "
            f"unexpected={sorted(actual-expected)}"
        )
    for name in ("generation.json", "SEALED.json"):
        st = os.lstat(directory / name)
        if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
            raise WB0SafetyError(
                f"generation metadata must be a non-hardlinked regular file: {directory / name}"
            )
    payload_st = os.lstat(directory / "payload")
    if not stat.S_ISDIR(payload_st.st_mode):
        raise WB0SafetyError(f"generation payload must be a real directory: {directory / 'payload'}")


def _copy_regular_tree(
    source: Path,
    destination: Path,
    *,
    exclude: Iterable[str] = (),
) -> None:
    excluded = {safe_relative_path(item, "state exclusion") for item in exclude}
    source_root = os.lstat(source)
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    directory_modes: dict[Path, int] = {
        destination: stat.S_IMODE(source_root.st_mode)
    }
    for path in _walk_regular_tree(source):
        rel = path.relative_to(source).as_posix()
        if any(rel == item or rel.startswith(item.rstrip("/") + "/") for item in excluded):
            continue
        target = destination / rel
        st = os.lstat(path)
        if stat.S_ISDIR(st.st_mode):
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
            directory_modes[target] = stat.S_IMODE(st.st_mode)
        else:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            source_fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
            target_fd = os.open(
                target,
                os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
                0o600,
            )
            try:
                opened = os.fstat(source_fd)
                if (opened.st_dev, opened.st_ino) != (st.st_dev, st.st_ino):
                    raise WB0IntegrityError(f"state source changed during open: {path}")
                while True:
                    chunk = os.read(source_fd, 1024 * 1024)
                    if not chunk:
                        break
                    write_all(target_fd, chunk)
                os.fsync(target_fd)
                after = os.fstat(source_fd)
                if (
                    opened.st_size != after.st_size
                    or opened.st_mtime_ns != after.st_mtime_ns
                    or opened.st_ctime_ns != after.st_ctime_ns
                ):
                    raise WB0IntegrityError(f"state source changed during copy: {path}")
            finally:
                os.close(source_fd)
                os.close(target_fd)
            os.chmod(target, stat.S_IMODE(st.st_mode))
    for directory, mode in sorted(
        directory_modes.items(), key=lambda item: len(item[0].parts), reverse=True
    ):
        os.chmod(directory, mode)
    fsync_tree(destination)


def _make_read_only(root: Path) -> None:
    for path in reversed(_walk_regular_tree(root)):
        st = os.lstat(path)
        mode = stat.S_IMODE(st.st_mode) & ~0o222
        if stat.S_ISDIR(st.st_mode):
            mode |= 0o500
        else:
            mode |= 0o400
        os.chmod(path, mode)
    os.chmod(root, (stat.S_IMODE(os.lstat(root).st_mode) & ~0o222) | 0o500)
    fsync_tree(root)


def _make_owner_writable(root: Path) -> None:
    os.chmod(root, 0o700)
    for path in _walk_regular_tree(root):
        st = os.lstat(path)
        if stat.S_ISDIR(st.st_mode):
            os.chmod(path, 0o700)
        else:
            # State is private and writable only by the owning user.
            os.chmod(path, 0o600)
    fsync_tree(root)


def _generation_dir(state_root: Path, generation_id: str) -> Path:
    return state_root / "generations" / validate_id(generation_id, "generation_id")


def _seed_record(source: Path, *, immutable: bool, exclude: Iterable[str] = ()) -> dict[str, Any]:
    entries = _projected_payload_entries(source, immutable=immutable, exclude=exclude)
    return {
        "payload_root_mode": _projected_payload_root_mode(source, immutable=immutable),
        "payload_entries": entries,
        "payload_digest": sha256_json(entries),
    }


def create_generation(
    *,
    state_root: str | Path,
    generation_id: str,
    source_payload: str | Path,
    source_release_id: str,
    state_schema_version: str,
    compatible_release_ids: list[str],
    immutable: bool,
    created_at: str,
    source_generation_id: str | None = None,
    exclude: Iterable[str] = (),
) -> dict[str, Any]:
    """Create one generation with immutable identity metadata.

    Golden generations seal and continuously verify the complete payload. Writable
    generations seal only their lineage/compatibility identity plus the initial
    clone digest. Their payload is expected to evolve after activation and is not
    treated as immutable evidence by :func:`verify_generation`.
    """
    root = lexical_absolute_path(str(state_root), "state_root")
    source = lexical_absolute_path(str(source_payload), "source_payload")
    validate_id(generation_id, "generation_id")
    validate_id(source_release_id, "source_release_id")
    if source_generation_id is not None:
        validate_id(source_generation_id, "source_generation_id")
    if not isinstance(state_schema_version, str) or not state_schema_version:
        raise WB0ContractError("state_schema_version must be non-empty")
    releases = sorted({validate_id(item, "compatible release id") for item in compatible_release_ids})
    if source_release_id not in releases:
        raise WB0ContractError("source_release_id must be compatible with the generation")
    generations = root / "generations"
    final = _generation_dir(root, generation_id)
    expected_seed = _seed_record(source, immutable=immutable, exclude=exclude)

    def verify_existing_request() -> dict[str, Any]:
        existing = verify_generation_identity(
            root,
            generation_id,
            release_id=source_release_id,
            require_immutable=immutable,
        )
        invariant_pairs = {
            "source_release_id": source_release_id,
            "source_generation_id": source_generation_id,
            "compatible_release_ids": releases,
            "writable_by_release_ids": [] if immutable else releases,
            "initial_seed": expected_seed,
        }
        for key, expected in invariant_pairs.items():
            if existing.get(key) != expected:
                raise WB0IntegrityError(
                    f"generation {generation_id} already exists with different {key}"
                )
        if (existing.get("state_schema") or {}).get("version") != state_schema_version:
            raise WB0IntegrityError(
                f"generation {generation_id} already exists with a different state schema"
            )
        # Immutable generations must still be byte-identical to their seal.
        if immutable:
            verify_immutable_golden_content(root, generation_id)
        return existing

    if final.exists() or final.is_symlink():
        return verify_existing_request()
    if paths_overlap(source, final) or is_path_within(generations, source):
        raise WB0SafetyError("state source and generation destination overlap")
    generations.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = root / ".generation.lock"
    with file_lock(lock):
        if final.exists() or final.is_symlink():
            return verify_existing_request()
        temp = Path(tempfile.mkdtemp(prefix=f".{generation_id}.", dir=str(generations)))
        try:
            payload = temp / "payload"
            _copy_regular_tree(source, payload, exclude=exclude)
            if immutable:
                _make_read_only(payload)
            else:
                _make_owner_writable(payload)
            actual_seed = {
                "payload_root_mode": mode_string(os.lstat(payload).st_mode),
                "payload_entries": _payload_entries(payload),
            }
            actual_seed["payload_digest"] = sha256_json(actual_seed["payload_entries"])
            if actual_seed != expected_seed:
                raise WB0IntegrityError(
                    f"state generation {generation_id} initial clone differs from projected source"
                )
            metadata: dict[str, Any] = {
                "schema_version": GENERATION_SCHEMA_VERSION,
                "generation_id": generation_id,
                "state_schema": {
                    "id": STATE_SCHEMA_ID,
                    "version": state_schema_version,
                },
                "created_at": created_at,
                "source_generation_id": source_generation_id,
                "source_release_id": source_release_id,
                "compatible_release_ids": releases,
                "writable_by_release_ids": [] if immutable else releases,
                "immutable": immutable,
                "initial_seed": actual_seed,
            }
            metadata["generation_digest"] = sha256_json(metadata)
            atomic_write_json(temp / "generation.json", metadata, mode=0o400)
            atomic_write_json(
                temp / "SEALED.json",
                {
                    "schema_version": GENERATION_SCHEMA_VERSION,
                    "generation_id": generation_id,
                    "generation_digest": metadata["generation_digest"],
                    "immutable": immutable,
                },
                mode=0o400,
            )
            # The generation directory and metadata are immutable-by-layout even
            # for writable generations. Only payload/ is owner-writable.
            os.chmod(temp / "generation.json", 0o400)
            os.chmod(temp / "SEALED.json", 0o400)
            os.chmod(temp, 0o500)
            fsync_tree(temp)
            os.replace(temp, final)
            from .wb0_common import fsync_directory

            fsync_directory(generations)
        finally:
            if temp.exists():
                try:
                    os.chmod(temp, 0o700)
                    for current, dirnames, filenames in os.walk(temp, topdown=True):
                        current_path = Path(current)
                        os.chmod(current_path, 0o700)
                        for name in filenames:
                            os.chmod(current_path / name, 0o600)
                except OSError:
                    pass
                shutil.rmtree(temp, ignore_errors=True)
    # Initial-clone verification is mandatory before a newly created writable
    # generation can ever be activated.
    metadata = verify_generation_identity(root, generation_id)
    verify_initial_clone(root, generation_id)
    return metadata


def load_generation(state_root: str | Path, generation_id: str) -> dict[str, Any]:
    root = lexical_absolute_path(str(state_root), "state_root")
    directory = _generation_dir(root, generation_id)
    _verify_generation_layout(directory)
    return load_json_object(directory / "generation.json")


def verify_generation_identity(
    state_root: str | Path,
    generation_id: str,
    *,
    release_id: str | None = None,
    require_immutable: bool | None = None,
) -> dict[str, Any]:
    """Verify immutable generation identity/compatibility without freezing live state."""
    root = lexical_absolute_path(str(state_root), "state_root")
    directory = _generation_dir(root, generation_id)
    metadata = load_generation(root, generation_id)
    if metadata.get("schema_version") != GENERATION_SCHEMA_VERSION:
        raise WB0ContractError("unsupported state generation schema")
    if metadata.get("generation_id") != generation_id:
        raise WB0IntegrityError("generation identity mismatch")
    expected_digest = sha256_json(
        {k: v for k, v in metadata.items() if k != "generation_digest"}
    )
    if metadata.get("generation_digest") != expected_digest:
        raise WB0IntegrityError("generation metadata digest mismatch")
    state_schema = metadata.get("state_schema")
    if not isinstance(state_schema, dict) or state_schema.get("id") != STATE_SCHEMA_ID:
        raise WB0ContractError("unsupported state schema identity")
    initial_seed = metadata.get("initial_seed")
    if not isinstance(initial_seed, dict):
        raise WB0ContractError("state generation is missing initial_seed identity")
    entries = initial_seed.get("payload_entries")
    if not isinstance(entries, list) or sha256_json(entries) != initial_seed.get("payload_digest"):
        raise WB0IntegrityError("state generation initial seed digest mismatch")
    if not isinstance(initial_seed.get("payload_root_mode"), str):
        raise WB0ContractError("state generation initial seed root mode is missing")

    sealed = load_json_object(directory / "SEALED.json")
    if (
        sealed.get("schema_version") != GENERATION_SCHEMA_VERSION
        or sealed.get("generation_id") != generation_id
        or sealed.get("generation_digest") != metadata.get("generation_digest")
        or sealed.get("immutable") is not (metadata.get("immutable") is True)
    ):
        raise WB0IntegrityError("state generation seal mismatch")

    immutable = metadata.get("immutable") is True
    if require_immutable is not None and immutable != require_immutable:
        raise WB0SafetyError(
            f"generation {generation_id} immutable={immutable}, expected {require_immutable}"
        )
    if stat.S_IMODE(os.lstat(directory).st_mode) != 0o500:
        raise WB0IntegrityError("state generation root must be mode 0500")
    for name in ("generation.json", "SEALED.json"):
        if stat.S_IMODE(os.lstat(directory / name).st_mode) != 0o400:
            raise WB0IntegrityError(f"state generation metadata must be mode 0400: {name}")
    payload = directory / "payload"
    expected_payload_mode = int(str(initial_seed["payload_root_mode"]), 8)
    if stat.S_IMODE(os.lstat(payload).st_mode) != expected_payload_mode:
        raise WB0IntegrityError(
            f"state payload root mode drift: expected {expected_payload_mode:04o}"
        )

    if release_id is not None:
        validate_id(release_id, "release_id")
        if release_id not in metadata.get("compatible_release_ids", []):
            raise WB0SafetyError(
                f"release {release_id} is not compatible with state generation {generation_id}"
            )
        if not immutable and release_id not in metadata.get("writable_by_release_ids", []):
            raise WB0SafetyError(
                f"release {release_id} may not write state generation {generation_id}"
            )
    return metadata


def verify_initial_clone(state_root: str | Path, generation_id: str) -> dict[str, Any]:
    """Prove the payload still equals its original seed before first activation.

    This is intentionally a one-time/pre-activation property. Normal runtime
    mutation is not a WB-0 integrity violation and must not be compared to the
    initial seed on later recovery reconciliation.
    """
    root = lexical_absolute_path(str(state_root), "state_root")
    metadata = verify_generation_identity(root, generation_id)
    directory = _generation_dir(root, generation_id)
    payload = directory / "payload"
    actual = {
        "payload_root_mode": mode_string(os.lstat(payload).st_mode),
        "payload_entries": _payload_entries(payload),
    }
    actual["payload_digest"] = sha256_json(actual["payload_entries"])
    if actual != metadata.get("initial_seed"):
        raise WB0IntegrityError(
            f"state generation {generation_id} no longer matches its initial clone"
        )
    return metadata


def verify_immutable_golden_content(
    state_root: str | Path, generation_id: str
) -> dict[str, Any]:
    """Strictly verify complete golden payload content, modes, and read-only layout."""
    root = lexical_absolute_path(str(state_root), "state_root")
    metadata = verify_generation_identity(
        root, generation_id, require_immutable=True
    )
    verify_initial_clone(root, generation_id)
    directory = _generation_dir(root, generation_id)
    payload = directory / "payload"
    immutable_paths = [payload, *_walk_regular_tree(payload)]
    for path in immutable_paths:
        if stat.S_IMODE(os.lstat(path).st_mode) & 0o222:
            raise WB0IntegrityError(f"immutable generation contains writable path: {path}")
    return metadata


def verify_generation(
    state_root: str | Path,
    generation_id: str,
    *,
    release_id: str | None = None,
    require_immutable: bool | None = None,
) -> dict[str, Any]:
    """Verify a generation at the appropriate semantic strength.

    Immutable golden generations receive strict full-content verification.
    Writable generations receive immutable identity/compatibility verification
    only; live payload correctness belongs to CAO's RunStore/WAL/contracts.
    """
    metadata = verify_generation_identity(
        state_root,
        generation_id,
        release_id=release_id,
        require_immutable=require_immutable,
    )
    if metadata.get("immutable") is True:
        verify_immutable_golden_content(state_root, generation_id)
    return metadata


def clone_generation(
    *,
    state_root: str | Path,
    source_generation_id: str,
    new_generation_id: str,
    target_release_id: str,
    created_at: str,
) -> dict[str, Any]:
    root = lexical_absolute_path(str(state_root), "state_root")
    source = verify_generation(root, source_generation_id, release_id=target_release_id)
    return create_generation(
        state_root=root,
        generation_id=new_generation_id,
        source_payload=_generation_dir(root, source_generation_id) / "payload",
        source_release_id=target_release_id,
        state_schema_version=source["state_schema"]["version"],
        compatible_release_ids=[target_release_id],
        immutable=False,
        created_at=created_at,
        source_generation_id=source_generation_id,
    )


def activate_generation(
    *,
    state_root: str | Path,
    generation_id: str,
    release_id: str,
    require_initial_clone: bool = False,
) -> dict[str, Any]:
    root = lexical_absolute_path(str(state_root), "state_root")
    metadata = verify_generation(root, generation_id, release_id=release_id)
    target = f"generations/{generation_id}/payload"
    current = read_symlink_optional(root / "current")
    # A newly selected recovery clone must still match its initial seed. A
    # reconciliation of an already-active generation must not re-freeze live
    # state after normal CAO progress.
    if require_initial_clone and current != target:
        verify_initial_clone(root, generation_id)
    atomic_symlink(target, root / "current")
    return {
        "generation_id": generation_id,
        "pointer": str(root / "current"),
        "target": target,
        "generation_digest": metadata["generation_digest"],
    }


def seal_golden_pointer(*, state_root: str | Path, generation_id: str) -> dict[str, Any]:
    root = lexical_absolute_path(str(state_root), "state_root")
    metadata = verify_generation(root, generation_id, require_immutable=True)
    target = f"generations/{generation_id}"
    current = read_symlink_optional(root / "golden")
    if current is not None and current != target:
        valid_existing_generation: str | None = None
        try:
            normalized = safe_relative_path(current, "golden pointer target")
            parts = Path(normalized).parts
            if len(parts) == 2 and parts[0] == "generations":
                verify_generation(root, parts[1], require_immutable=True)
                valid_existing_generation = parts[1]
        except (WB0ContractError, WB0IntegrityError, WB0SafetyError):
            # A malformed, escaping, dangling, corrupt, or non-golden target is
            # tamper evidence, not a legitimate immutable selection. Recovery
            # may atomically restore the already-verified requested golden.
            pass
        if valid_existing_generation is not None:
            raise WB0SafetyError(
                f"golden pointer is immutable and already targets {current}; refusing {target}"
            )
    if current != target:
        atomic_symlink(target, root / "golden")
    return {
        "generation_id": generation_id,
        "pointer": str(root / "golden"),
        "target": target,
        "generation_digest": metadata["generation_digest"],
    }


def active_generation_id(state_root: str | Path) -> str | None:
    root = lexical_absolute_path(str(state_root), "state_root")
    target = read_symlink_optional(root / "current")
    if target is None:
        return None
    parts = Path(target).parts
    if len(parts) != 3 or parts[0] != "generations" or parts[2] != "payload":
        raise WB0IntegrityError(f"invalid current state pointer target: {target}")
    return validate_id(parts[1], "active generation id")


def golden_generation_id(state_root: str | Path) -> str | None:
    root = lexical_absolute_path(str(state_root), "state_root")
    target = read_symlink_optional(root / "golden")
    if target is None:
        return None
    parts = Path(target).parts
    if len(parts) != 2 or parts[0] != "generations":
        raise WB0IntegrityError(f"invalid golden state pointer target: {target}")
    return validate_id(parts[1], "golden generation id")
