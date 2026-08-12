"""Crash-rerunnable WB-0 same-host recovery and fresh-host bootstrap."""
from __future__ import annotations

import json
import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable

from .wb0_common import (
    WB0ContractError,
    WB0IntegrityError,
    WB0SafetyError,
    atomic_symlink,
    atomic_write_json,
    atomic_write_text,
    file_lock,
    fsync_directory,
    fsync_tree,
    iso_now,
    lexical_absolute_path,
    load_json_object,
    mode_string,
    parse_iso,
    read_symlink_optional,
    sha256_file,
    sha256_json,
    utc_now,
    validate_id,
    write_all,
)
from .wb0_instance import (
    assert_safe_policy,
    render_instance_environment,
    render_safe_policy,
    validate_instance,
)
from .wb0_manifest import verify_release_capsule
from .wb0_skills import restore_skill_assets, verify_installed_skill_assets
from .wb0_state import (
    activate_generation,
    clone_generation,
    create_generation,
    seal_golden_pointer,
    verify_generation,
)

TRANSACTION_SCHEMA_VERSION = "1.1"
RESOURCE_REPORT_SCHEMA_VERSION = "1.0"
CONFIG_GENERATION_SCHEMA_VERSION = "1.0"
_WEB_BRIDGE_STARTED_KEY = "web_" + "bridge_started"
CommandRunner = Callable[[list[str]], subprocess.CompletedProcess[str]]


STEPS = (
    "PREFLIGHT_VERIFIED",
    "CONTROLLER_BOUNDED",
    "RELEASE_INSTALLED",
    "SKILL_ASSETS_RESTORED",
    "GOLDEN_STATE_SEALED",
    "WRITABLE_STATE_PREPARED",
    "CONFIG_PREPARED",
    "STATE_POINTER_SWITCHED",
    "CONFIG_POINTER_SWITCHED",
    "RELEASE_POINTER_SWITCHED",
    "HOST_PROJECTIONS_INSTALLED",
    "SAFE_POSTURE_VERIFIED",
    "COMMITTED",
)


def _default_runner(command: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(command, text=True, capture_output=True, check=False)


def _transaction_path(instance: dict[str, Any], transaction_id: str) -> Path:
    state_root = Path(instance["roots"]["state_root"])
    return state_root / "recovery" / "transactions" / f"{validate_id(transaction_id, 'transaction_id')}.json"


def _step_done(record: dict[str, Any], name: str) -> bool:
    return (record.get("steps") or {}).get(name, {}).get("status") == "DONE"


def _write_transaction(path: Path, record: dict[str, Any]) -> None:
    record["updated_at"] = iso_now()
    atomic_write_json(path, record, mode=0o600)


def _mark_step(
    path: Path,
    record: dict[str, Any],
    name: str,
    details: dict[str, Any],
    *,
    fault_after: str | None,
) -> None:
    if name not in STEPS:
        raise WB0ContractError(f"unknown recovery step: {name}")
    record.setdefault("steps", {})[name] = {
        "status": "DONE",
        "at": iso_now(),
        "details": details,
    }
    record["status"] = name
    _write_transaction(path, record)
    if fault_after == name:
        raise RuntimeError(f"injected WB-0 interruption after {name}")


def _complete_or_reconcile_step(
    path: Path,
    record: dict[str, Any],
    name: str,
    details: dict[str, Any],
    *,
    fault_after: str | None,
) -> None:
    if not _step_done(record, name):
        _mark_step(path, record, name, details, fault_after=fault_after)
        return
    record.setdefault("reconciliations", []).append(
        {"step": name, "at": iso_now(), "details": details}
    )
    _write_transaction(path, record)


def _quarantine_path(path: Path, *, root: Path, transaction_id: str) -> Path:
    quarantine_root = root / "quarantine"
    quarantine_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    base = quarantine_root / f"{path.name}--{transaction_id}"
    candidate = base
    index = 1
    while candidate.exists() or candidate.is_symlink():
        index += 1
        candidate = Path(f"{base}.{index}")

    original_mode: int | None = None
    source_st = os.lstat(path)
    if stat.S_ISDIR(source_st.st_mode) and not stat.S_ISLNK(source_st.st_mode):
        original_mode = stat.S_IMODE(source_st.st_mode)
        if not original_mode & stat.S_IWUSR:
            os.chmod(path, original_mode | stat.S_IWUSR)
    try:
        os.replace(path, candidate)
    except Exception:
        if original_mode is not None and path.exists():
            os.chmod(path, original_mode)
        raise
    if original_mode is not None:
        os.chmod(candidate, original_mode)
    fsync_directory(path.parent)
    fsync_directory(quarantine_root)
    return candidate


def build_recovery_request_invariant(
    *,
    instance: dict[str, Any],
    manifest: dict[str, Any],
    mode: str,
    golden_generation_id: str,
    writable_generation_id: str,
    config_generation_id: str,
    state_schema_version: str,
) -> dict[str, Any]:
    """Build the deterministic request identity shared by plan and apply."""
    if mode not in {"same_host", "fresh_host"}:
        raise WB0ContractError("recovery mode must be same_host or fresh_host")
    if not isinstance(state_schema_version, str) or not state_schema_version:
        raise WB0ContractError("state_schema_version must be non-empty")
    invariant = {
        "instance_id": instance["instance_id"],
        "instance_digest": instance["instance_digest"],
        "mode": mode,
        "release_id": manifest["release_id"],
        "release_manifest_digest": manifest["manifest_digest"],
        "golden_generation_id": validate_id(golden_generation_id, "golden_generation_id"),
        "writable_generation_id": validate_id(
            writable_generation_id, "writable_generation_id"
        ),
        "config_generation_id": validate_id(
            config_generation_id, "config_generation_id"
        ),
        "state_schema": {
            "id": "mlgo-cao-v2-control-state",
            "version": state_schema_version,
        },
        "final_controller_state": "STOPPED",
    }
    invariant["request_digest"] = sha256_json(invariant)
    return invariant


def _path_lexists(path: Path) -> bool:
    return os.path.lexists(path)


def _assert_fresh_host_pristine(instance: dict[str, Any]) -> dict[str, Any]:
    """Require a genuinely unused target before creating a fresh-host journal.

    The instance-wide recovery lock necessarily creates state_root/recovery and
    .instance-recovery.lock before this check.  Those two objects are the only
    state-root scaffolding tolerated for a new fresh-host transaction.
    """
    release_root = Path(instance["roots"]["release_root"])
    config_root = Path(instance["roots"]["config_root"])
    state_root = Path(instance["roots"]["state_root"])
    blockers: list[str] = []

    pointer_paths = (
        release_root / "current",
        config_root / "current",
        state_root / "current",
        state_root / "golden",
    )
    for pointer in pointer_paths:
        if _path_lexists(pointer):
            blockers.append(str(pointer))

    # A demonstrably fresh versioned-release/config target has no prior payload.
    for label, root in (("release_root", release_root), ("config_root", config_root)):
        if not _path_lexists(root):
            continue
        if root.is_symlink() or not root.is_dir():
            blockers.append(f"{label}:{root}")
            continue
        for child in sorted(root.iterdir(), key=lambda item: item.name):
            blockers.append(str(child))

    if _path_lexists(state_root):
        if state_root.is_symlink() or not state_root.is_dir():
            blockers.append(f"state_root:{state_root}")
        else:
            for child in sorted(state_root.iterdir(), key=lambda item: item.name):
                if child.name != "recovery":
                    blockers.append(str(child))
                    continue
                if child.is_symlink() or not child.is_dir():
                    blockers.append(str(child))
                    continue
                for recovery_child in sorted(child.iterdir(), key=lambda item: item.name):
                    if recovery_child.name == ".instance-recovery.lock" and recovery_child.is_file() and not recovery_child.is_symlink():
                        continue
                    blockers.append(str(recovery_child))

    bin_root = Path(instance["host_adapter"]["bin_root"])
    if _path_lexists(bin_root) and bin_root.is_dir() and not bin_root.is_symlink():
        for child in sorted(bin_root.iterdir(), key=lambda item: item.name):
            if child.name == "mlgo-v2" or child.name.startswith("mlgo-v2-"):
                blockers.append(str(child))
    elif _path_lexists(bin_root) and (bin_root.is_symlink() or not bin_root.is_dir()):
        blockers.append(f"bin_root:{bin_root}")

    unit_path = (
        Path(instance["host_adapter"]["systemd_user_unit_root"])
        / instance["host_adapter"]["controller_unit"]
    )
    if _path_lexists(unit_path):
        blockers.append(str(unit_path))

    if blockers:
        raise WB0SafetyError(
            "fresh_host requires a pristine CAO instance target; use same_host for an "
            f"existing/recovered target. Existing surfaces: {sorted(set(blockers))}"
        )
    return {
        "pristine": True,
        "allowed_state_scaffolding": [
            str(state_root / "recovery"),
            str(state_root / "recovery" / ".instance-recovery.lock"),
        ],
    }


def _load_or_create_transaction(
    *,
    instance: dict[str, Any],
    transaction_id: str,
    mode: str,
    manifest: dict[str, Any],
    golden_generation_id: str,
    writable_generation_id: str,
    config_generation_id: str,
    state_schema_version: str,
) -> tuple[Path, dict[str, Any]]:
    path = _transaction_path(instance, transaction_id)
    invariant = build_recovery_request_invariant(
        instance=instance,
        manifest=manifest,
        mode=mode,
        golden_generation_id=golden_generation_id,
        writable_generation_id=writable_generation_id,
        config_generation_id=config_generation_id,
        state_schema_version=state_schema_version,
    )
    if path.exists():
        record = load_json_object(path)
        for key, expected in invariant.items():
            if record.get(key) != expected:
                raise WB0SafetyError(
                    f"transaction {transaction_id} invariant changed for {key}: "
                    f"{record.get(key)!r} != {expected!r}"
                )
        return path, record

    if mode == "fresh_host":
        _assert_fresh_host_pristine(instance)

    # A new rollback/reconstruction transaction must never select an already
    # existing writable generation. Reusing an evolved generation would turn a
    # requested rollback-to-golden into "keep current live state". Only a replay
    # of the *same* durable transaction may reuse its generation ID.
    writable_path = (
        Path(instance["roots"]["state_root"])
        / "generations"
        / invariant["writable_generation_id"]
    )
    if writable_path.exists() or writable_path.is_symlink():
        raise WB0SafetyError(
            "a new recovery transaction requires a fresh writable_generation_id; "
            f"generation already exists: {writable_path}"
        )

    record: dict[str, Any] = {
        "schema_version": TRANSACTION_SCHEMA_VERSION,
        "transaction_id": transaction_id,
        **invariant,
        "status": "PREPARED",
        "created_at": iso_now(),
        "steps": {},
        "before": {
            "release_pointer": read_symlink_optional(
                Path(instance["roots"]["release_root"]) / "current"
            ),
            "state_pointer": read_symlink_optional(
                Path(instance["roots"]["state_root"]) / "current"
            ),
            "config_pointer": read_symlink_optional(
                Path(instance["roots"]["config_root"]) / "current"
            ),
        },
        "provider_calls": 0,
        "production_enforcement": False,
        _WEB_BRIDGE_STARTED_KEY: False,
    }
    _write_transaction(path, record)
    return path, record


def validate_resource_report(
    value: dict[str, Any], *, maximum_age_seconds: int = 300
) -> dict[str, Any]:
    if value.get("schema_version") != RESOURCE_REPORT_SCHEMA_VERSION:
        raise WB0ContractError("unsupported active-resource report schema")
    captured_at = parse_iso(str(value.get("captured_at") or ""))
    age = (utc_now() - captured_at).total_seconds()
    if age < -5 or age > maximum_age_seconds:
        raise WB0SafetyError(f"active-resource report is stale/future-dated: age={age:.1f}s")
    resources = value.get("active_resources")
    if not isinstance(resources, dict):
        raise WB0ContractError("active-resource report is missing active_resources")
    unsafe = []
    if resources.get("restart_blocked") is not False:
        unsafe.append("restart_blocked")
    if resources.get("active_runs"):
        unsafe.append("active_runs")
    if resources.get("unknown_checks"):
        unsafe.append("unknown_checks")
    terminals = resources.get("main_cao_terminals") or {}
    if terminals.get("active"):
        unsafe.append("main_cao_terminals")
    bridges = resources.get("agy_bridge_units") or {}
    if bridges.get("units"):
        unsafe.append("agy_bridge_units")
    if unsafe:
        raise WB0SafetyError(f"active/unknown resources block recovery: {unsafe}")
    return value


def build_recovery_plan(
    *,
    instance: dict[str, Any],
    capsule_root: str | Path,
    mode: str,
    golden_generation_id: str,
    writable_generation_id: str,
    config_generation_id: str,
    state_schema_version: str,
    resource_report: dict[str, Any] | None,
) -> dict[str, Any]:
    instance = validate_instance(instance)
    manifest = verify_release_capsule(capsule_root)
    request = build_recovery_request_invariant(
        instance=instance,
        manifest=manifest,
        mode=mode,
        golden_generation_id=golden_generation_id,
        writable_generation_id=writable_generation_id,
        config_generation_id=config_generation_id,
        state_schema_version=state_schema_version,
    )
    if mode == "same_host":
        if resource_report is None:
            raise WB0SafetyError("same-host recovery requires a fresh active-resource report")
        validate_resource_report(resource_report)
    return {
        "schema_version": "1.1",
        **request,
        "actions": list(STEPS),
        "controller_start_is_separate_operation": True,
        "fresh_host_pristine_required_for_new_transaction": mode == "fresh_host",
        "service_scope": [instance["host_adapter"]["controller_unit"]],
        "provider_calls": 0,
        "credentials_imported": False,
        "production_enforcement": False,
        "client_repositories_mutated": False,
    }


def _copy_regular(source: Path, target: Path, mode: int) -> None:
    source_lstat = os.lstat(source)
    if not stat.S_ISREG(source_lstat.st_mode) or source_lstat.st_nlink != 1:
        raise WB0SafetyError(f"copy source must be a non-hardlinked regular file: {source}")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    target_fd = os.open(
        target,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        mode,
    )
    try:
        before = os.fstat(source_fd)
        if (before.st_dev, before.st_ino) != (source_lstat.st_dev, source_lstat.st_ino):
            raise WB0IntegrityError(f"copy source changed during no-follow open: {source}")
        while True:
            chunk = os.read(source_fd, 1024 * 1024)
            if not chunk:
                break
            write_all(target_fd, chunk)
        os.fsync(target_fd)
        after = os.fstat(source_fd)
        if (
            before.st_size != after.st_size
            or before.st_mtime_ns != after.st_mtime_ns
            or before.st_ctime_ns != after.st_ctime_ns
        ):
            raise WB0IntegrityError(f"copy source changed during read: {source}")
    finally:
        os.close(source_fd)
        os.close(target_fd)
    os.chmod(target, mode)


def _install_release(
    capsule_root: Path,
    instance: dict[str, Any],
    manifest: dict[str, Any],
    *,
    transaction_id: str,
) -> dict[str, Any]:
    release_root = Path(instance["roots"]["release_root"])
    releases = release_root / "releases"
    final = releases / manifest["release_id"]
    action = "INSTALLED"
    quarantine: str | None = None
    if final.exists() or final.is_symlink():
        try:
            existing = verify_release_capsule(final)
            if existing["manifest_digest"] != manifest["manifest_digest"]:
                raise WB0IntegrityError(
                    f"release id collision with different content: {manifest['release_id']}"
                )
            return {"path": str(final), "action": "ALREADY_VERIFIED", "quarantine": None}
        except (WB0ContractError, WB0IntegrityError, WB0SafetyError):
            quarantined = _quarantine_path(
                final, root=release_root, transaction_id=transaction_id
            )
            quarantine = str(quarantined)
            action = "CORRUPT_RELEASE_QUARANTINED_AND_RESTORED"
    releases.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = Path(tempfile.mkdtemp(prefix=f".{manifest['release_id']}.", dir=str(releases)))
    try:
        entries = list(manifest["entries"])
        directories = sorted(
            (entry for entry in entries if entry["type"] == "directory"),
            key=lambda item: (len(Path(item["path"]).parts), item["path"]),
        )
        for entry in directories:
            target = temp / entry["path"]
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
        for entry in sorted(entries, key=lambda item: item["path"]):
            source = capsule_root / entry["path"]
            target = temp / entry["path"]
            if entry["type"] == "file":
                _copy_regular(source, target, int(entry["mode"], 8))
            elif entry["type"] == "symlink":
                target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                os.symlink(entry["target"], target)
        # Metadata is deliberately copied after payload because it seals the tree.
        for rel in ("manifests/release-manifest.json", "SHA256SUMS"):
            source = capsule_root / rel
            target = temp / rel
            _copy_regular(source, target, stat.S_IMODE(os.lstat(source).st_mode))
        for entry in sorted(directories, key=lambda item: len(Path(item["path"]).parts), reverse=True):
            os.chmod(temp / entry["path"], int(entry["mode"], 8))
        fsync_tree(temp)
        verify_release_capsule(temp)
        os.replace(temp, final)
        os.chmod(final, 0o500)
        fsync_directory(releases)
    finally:
        if temp.exists():
            shutil.rmtree(temp, ignore_errors=True)
    return {"path": str(final), "action": action, "quarantine": quarantine}


def _copy_config_tree(source: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    if not source.exists():
        return
    if not source.is_dir() or source.is_symlink():
        raise WB0SafetyError(f"capsule config must be a real directory: {source}")
    for current, dirnames, filenames in os.walk(source, topdown=True, followlinks=False):
        current_path = Path(current)
        rel_dir = current_path.relative_to(source)
        target_dir = destination / rel_dir
        target_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        for name in sorted(dirnames):
            child = current_path / name
            if child.is_symlink():
                raise WB0SafetyError(f"config generation forbids symlink: {child}")
            (target_dir / name).mkdir(mode=0o700)
        for name in sorted(filenames):
            child = current_path / name
            st = os.lstat(child)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
                raise WB0SafetyError(f"config generation accepts regular files only: {child}")
            _copy_regular(child, target_dir / name, 0o600)


def _tree_entries(root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in sorted(dirnames):
            path = current_path / name
            if path.is_symlink():
                raise WB0SafetyError(f"unexpected config symlink: {path}")
            entries.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "type": "directory",
                    "mode": mode_string(os.lstat(path).st_mode),
                }
            )
        for name in sorted(filenames):
            path = current_path / name
            st = os.lstat(path)
            if not stat.S_ISREG(st.st_mode):
                raise WB0SafetyError(f"unexpected config special file: {path}")
            entries.append(
                {
                    "path": path.relative_to(root).as_posix(),
                    "type": "file",
                    "mode": mode_string(st.st_mode),
                    "size": st.st_size,
                    "sha256": sha256_file(path),
                }
            )
    return sorted(entries, key=lambda item: item["path"])


def _make_config_read_only(root: Path) -> None:
    for current, dirnames, filenames in os.walk(root, topdown=False, followlinks=False):
        current_path = Path(current)
        for name in filenames:
            os.chmod(current_path / name, 0o400)
        for name in dirnames:
            os.chmod(current_path / name, 0o500)
    os.chmod(root, 0o500)
    fsync_tree(root)


def _verify_config_generation(
    final: Path, *, release_id: str, instance: dict[str, Any]
) -> dict[str, Any]:
    try:
        final_st = os.lstat(final)
    except FileNotFoundError as exc:
        raise WB0IntegrityError(f"config generation missing: {final}") from exc
    if not stat.S_ISDIR(final_st.st_mode):
        raise WB0IntegrityError(f"config generation missing or unsafe: {final}")
    if stat.S_IMODE(final_st.st_mode) & 0o222:
        raise WB0IntegrityError(f"config generation root is writable: {final}")
    expected_root_entries = {"generation.json", "payload"}
    actual_root_entries = {entry.name for entry in final.iterdir()}
    if actual_root_entries != expected_root_entries:
        raise WB0IntegrityError(
            "config generation root path set mismatch: "
            f"missing={sorted(expected_root_entries-actual_root_entries)} "
            f"unexpected={sorted(actual_root_entries-expected_root_entries)}"
        )
    metadata_path = final / "generation.json"
    metadata_st = os.lstat(metadata_path)
    if not stat.S_ISREG(metadata_st.st_mode) or metadata_st.st_nlink != 1:
        raise WB0SafetyError("config generation metadata must be a non-hardlinked regular file")
    if stat.S_IMODE(metadata_st.st_mode) & 0o222:
        raise WB0IntegrityError("config generation metadata is writable")
    payload = final / "payload"
    payload_st = os.lstat(payload)
    if not stat.S_ISDIR(payload_st.st_mode):
        raise WB0SafetyError("config generation payload must be a real directory")
    metadata = load_json_object(metadata_path)
    if metadata.get("schema_version") != CONFIG_GENERATION_SCHEMA_VERSION:
        raise WB0ContractError("unsupported config generation schema")
    if metadata.get("config_generation_id") != final.name:
        raise WB0IntegrityError("config generation identity mismatch")
    if metadata.get("release_id") != release_id:
        raise WB0IntegrityError("config generation release mismatch")
    if metadata.get("instance_digest") != instance["instance_digest"]:
        raise WB0IntegrityError("config generation instance mismatch")
    expected_digest = sha256_json(
        {k: v for k, v in metadata.items() if k != "generation_digest"}
    )
    if metadata.get("generation_digest") != expected_digest:
        raise WB0IntegrityError("config generation metadata digest mismatch")
    entries = _tree_entries(payload)
    if entries != metadata.get("entries") or sha256_json(entries) != metadata.get("payload_digest"):
        raise WB0IntegrityError("config generation payload drift")
    immutable_paths = [payload]
    for current, dirnames, filenames in os.walk(payload, topdown=True, followlinks=False):
        current_path = Path(current)
        immutable_paths.extend(current_path / name for name in dirnames)
        immutable_paths.extend(current_path / name for name in filenames)
    for path in immutable_paths:
        if stat.S_IMODE(os.lstat(path).st_mode) & 0o222:
            raise WB0IntegrityError(f"config generation contains writable path: {path}")
    assert_safe_policy(load_json_object(payload / "cao-policy.json"))
    return metadata


def _prepare_config_generation(
    *,
    capsule_root: Path,
    instance: dict[str, Any],
    release_id: str,
    config_generation_id: str,
    transaction_id: str,
) -> dict[str, Any]:
    config_root = Path(instance["roots"]["config_root"])
    generations = config_root / "generations"
    final = generations / config_generation_id
    if final.exists() or final.is_symlink():
        try:
            return _verify_config_generation(final, release_id=release_id, instance=instance)
        except (WB0ContractError, WB0IntegrityError, WB0SafetyError):
            _quarantine_path(final, root=config_root, transaction_id=transaction_id)
    generations.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = Path(tempfile.mkdtemp(prefix=f".{config_generation_id}.", dir=str(generations)))
    try:
        payload = temp / "payload"
        _copy_config_tree(capsule_root / "config", payload)
        template_candidates = [
            payload / "cao-policy.template.json",
            payload / "cao-policy.json",
        ]
        template_path = next((p for p in template_candidates if p.is_file()), None)
        if template_path is None:
            raise WB0ContractError("capsule config lacks cao-policy template")
        template = load_json_object(template_path)
        policy = render_safe_policy(template, instance)
        atomic_write_json(payload / "cao-policy.json", policy, mode=0o600)
        if template_path.name != "cao-policy.json":
            template_path.unlink()
        atomic_write_text(
            payload / "instance.env", render_instance_environment(instance), mode=0o600
        )
        _make_config_read_only(payload)
        entries_before_seal = _tree_entries(payload)
        metadata: dict[str, Any] = {
            "schema_version": CONFIG_GENERATION_SCHEMA_VERSION,
            "config_generation_id": config_generation_id,
            "release_id": release_id,
            "instance_id": instance["instance_id"],
            "instance_digest": instance["instance_digest"],
            "entries": entries_before_seal,
            "payload_digest": sha256_json(entries_before_seal),
            "safe_posture": {
                "orchestration_mode": "v2_shadow",
                "semantic_enforcement": "shadow_only",
                "production_enforcement": False,
            },
        }
        metadata["generation_digest"] = sha256_json(metadata)
        atomic_write_json(temp / "generation.json", metadata, mode=0o400)
        os.chmod(temp / "generation.json", 0o400)
        os.chmod(temp, 0o500)
        fsync_tree(temp)
        os.replace(temp, final)
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
    return _verify_config_generation(final, release_id=release_id, instance=instance)


def _systemd_quote(path: str) -> str:
    if "\n" in path or "\r" in path or "\x00" in path:
        raise WB0SafetyError("systemd path contains control characters")
    return '"' + path.replace("\\", "\\\\").replace('"', '\\"') + '"'


def _systemd_environment_file_path(path: str) -> str:
    """Render an absolute EnvironmentFile= argument without whole-item quotes.

    EnvironmentFile= consumes its argument as a filename and does not strip the
    quotes accepted by list-valued directives. Use systemd.syntax C escapes for
    characters that cannot appear literally in one unquoted argument.
    """
    if not Path(path).is_absolute():
        raise WB0SafetyError("systemd environment-file path must be absolute")
    if any(character in path for character in ("\n", "\r", "\x00")):
        raise WB0SafetyError("systemd path contains control characters")
    replacements = {
        " ": r"\x20",
        "\t": r"\x09",
        "\\": r"\x5c",
        '"': r"\x22",
        "'": r"\x27",
        "%": "%%",
    }
    return "".join(replacements.get(character, character) for character in path)


def _render_controller_unit(template: str, instance: dict[str, Any]) -> str:
    state_current = str(Path(instance["roots"]["state_root"]) / "current")
    config_current = str(Path(instance["roots"]["config_root"]) / "current" / "payload")
    release_current = str(Path(instance["roots"]["release_root"]) / "current")
    project_paths = " ".join(_systemd_quote(path) for path in instance["project_roots"])
    replacements = {
        "{{STATE_CURRENT}}": _systemd_quote(state_current),
        "{{CONFIG_CURRENT}}": _systemd_quote(config_current),
        "{{RELEASE_CURRENT}}": _systemd_quote(release_current),
        "{{INSTANCE_ENV}}": _systemd_environment_file_path(
            str(Path(config_current) / "instance.env")
        ),
        "{{CONTROLLER_EXEC}}": _systemd_quote(str(Path(release_current) / "release" / "bin" / "mlgo-v2-controller")),
        "{{PROJECT_READ_WRITE_PATHS}}": project_paths,
    }
    rendered = template
    for needle, replacement in replacements.items():
        rendered = rendered.replace(needle, replacement)
    if "{{" in rendered or "}}" in rendered:
        raise WB0ContractError("unresolved controller service template variable")
    return rendered


def _backup_existing(path: Path, backup_root: Path) -> dict[str, Any]:
    rel_name = path.as_posix().lstrip("/").replace("/", "__")
    backup = backup_root / rel_name
    try:
        st = os.lstat(path)
    except FileNotFoundError:
        return {"path": str(path), "existed": False, "backup": None}
    backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if stat.S_ISLNK(st.st_mode):
        atomic_write_json(
            backup.with_suffix(".symlink.json"),
            {"target": os.readlink(path), "mode": mode_string(st.st_mode)},
            mode=0o600,
        )
        return {
            "path": str(path),
            "existed": True,
            "type": "symlink",
            "backup": str(backup.with_suffix(".symlink.json")),
        }
    if stat.S_ISREG(st.st_mode):
        _copy_regular(path, backup, 0o600)
        return {
            "path": str(path),
            "existed": True,
            "type": "file",
            "backup": str(backup),
            "sha256": sha256_file(backup),
        }
    raise WB0SafetyError(f"refusing to replace non-file host projection: {path}")


def _project_host_files(
    *,
    instance: dict[str, Any],
    release_id: str,
    transaction_id: str,
    capsule_root: Path,
) -> dict[str, Any]:
    release_root = Path(instance["roots"]["release_root"])
    bin_root = Path(instance["host_adapter"]["bin_root"])
    unit_root = Path(instance["host_adapter"]["systemd_user_unit_root"])
    backup_root = (
        Path(instance["roots"]["state_root"])
        / "recovery"
        / "host-backups"
        / transaction_id
    )
    projected: list[dict[str, Any]] = []
    release_bin = release_root / "releases" / release_id / "release" / "bin"
    if not release_bin.is_dir():
        raise WB0ContractError("release capsule lacks release/bin")
    bin_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for source in sorted(release_bin.iterdir(), key=lambda p: p.name):
        if not source.is_file() or source.is_symlink():
            raise WB0SafetyError(f"release/bin accepts regular launchers only: {source}")
        destination = bin_root / source.name
        target = str(release_root / "current" / "release" / "bin" / source.name)
        existing = read_symlink_optional(destination) if destination.is_symlink() else None
        if existing == target:
            projected.append({"path": str(destination), "status": "ALREADY_PROJECTED"})
            continue
        backup = _backup_existing(destination, backup_root)
        atomic_symlink(target, destination)
        projected.append(
            {"path": str(destination), "status": "PROJECTED", "backup": backup}
        )

    template_path = capsule_root / "services" / "mlgo-cao-v2-controller.service.in"
    if not template_path.is_file() or template_path.is_symlink():
        raise WB0ContractError("capsule lacks safe controller service template")
    rendered = _render_controller_unit(template_path.read_text(encoding="utf-8"), instance)
    unit_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    unit_path = unit_root / instance["host_adapter"]["controller_unit"]
    if unit_path.is_file() and unit_path.read_text(encoding="utf-8") == rendered:
        projected.append({"path": str(unit_path), "status": "ALREADY_PROJECTED"})
    else:
        backup = _backup_existing(unit_path, backup_root)
        atomic_write_text(unit_path, rendered, mode=0o600)
        projected.append({"path": str(unit_path), "status": "PROJECTED", "backup": backup})
    return {"projected": projected, "backup_root": str(backup_root)}


def _run_systemctl(
    instance: dict[str, Any], runner: CommandRunner, *args: str
) -> subprocess.CompletedProcess[str]:
    command = [instance["host_adapter"]["systemctl_command"], "--user", *args]
    proc = runner(command)
    if not isinstance(proc, subprocess.CompletedProcess):
        raise WB0ContractError("command runner must return subprocess.CompletedProcess")
    return proc


def _verify_safe_posture(instance: dict[str, Any], release_id: str) -> dict[str, Any]:
    release_root = Path(instance["roots"]["release_root"])
    state_root = Path(instance["roots"]["state_root"])
    config_root = Path(instance["roots"]["config_root"])
    if read_symlink_optional(release_root / "current") != f"releases/{release_id}":
        raise WB0IntegrityError("active release pointer mismatch")
    config_target = read_symlink_optional(config_root / "current")
    if not config_target:
        raise WB0IntegrityError("active config pointer missing")
    policy_path = config_root / "current" / "payload" / "cao-policy.json"
    policy = load_json_object(policy_path)
    assert_safe_policy(policy)
    canary_path = state_root / "current" / "governance" / "canary-scope.json"
    if canary_path.exists():
        canary = load_json_object(canary_path)
        if canary.get("status") == "OPEN":
            raise WB0SafetyError("recovered state contains an open canary scope")
    qualification_root = Path(instance["provider_bindings"]["qualification_root"])
    qualifications = []
    if qualification_root.exists():
        qualifications = [str(p) for p in qualification_root.iterdir()]
    return {
        "release_pointer": f"releases/{release_id}",
        "config_pointer": config_target,
        "state_pointer": read_symlink_optional(state_root / "current"),
        "orchestration_mode": "v2_shadow",
        "semantic_enforcement": "shadow_only",
        "production_enforcement": False,
        "open_canary_scope": False,
        "provider_qualification_imported": False,
        "host_qualification_entries_preserved_separately": qualifications,
        "provider_calls": 0,
    }


def _apply_recovery_with_instance_lock_held(
    *,
    instance: dict[str, Any],
    capsule_root: str | Path,
    transaction_id: str,
    mode: str,
    golden_generation_id: str,
    writable_generation_id: str,
    config_generation_id: str,
    state_schema_version: str,
    resource_report: dict[str, Any] | None = None,
    fault_after: str | None = None,
    command_runner: CommandRunner | None = None,
) -> dict[str, Any]:
    """Apply or reconcile a recovery transaction.

    Every step is idempotent and journaled before the next step.  Re-running the
    same transaction ID after interruption converges from observed filesystem
    state; no reverse state migration is attempted.
    """
    instance = validate_instance(instance, check_existing_ancestors=True)
    capsule = lexical_absolute_path(str(capsule_root), "capsule_root")
    manifest = verify_release_capsule(capsule)
    plan = build_recovery_plan(
        instance=instance,
        capsule_root=capsule,
        mode=mode,
        golden_generation_id=golden_generation_id,
        writable_generation_id=writable_generation_id,
        config_generation_id=config_generation_id,
        state_schema_version=state_schema_version,
        resource_report=resource_report,
    )
    runner = command_runner or _default_runner
    path, record = _load_or_create_transaction(
        instance=instance,
        transaction_id=transaction_id,
        mode=mode,
        manifest=manifest,
        golden_generation_id=golden_generation_id,
        writable_generation_id=writable_generation_id,
        config_generation_id=config_generation_id,
        state_schema_version=state_schema_version,
    )
    transaction_lock = path.with_suffix(".lock")
    with file_lock(transaction_lock):
        # A journal records progress, but observed filesystem state remains the
        # authority on every rerun. Completed steps are re-verified/reconciled.
        record = load_json_object(path)
        try:
            if mode == "same_host":
                assert resource_report is not None
                validate_resource_report(resource_report)
            _complete_or_reconcile_step(
                path,
                record,
                "PREFLIGHT_VERIFIED",
                {"plan": plan, "capsule_verified": True},
                fault_after=fault_after,
            )

            service_details: dict[str, Any]
            if mode == "same_host":
                proc = _run_systemctl(
                    instance,
                    runner,
                    "stop",
                    instance["host_adapter"]["controller_unit"],
                )
                if proc.returncode != 0:
                    raise WB0SafetyError(
                        f"controller stop failed: {proc.stderr.strip() or proc.stdout.strip()}"
                    )
                service_details = {"action": "stopped", "returncode": proc.returncode}
            else:
                service_details = {"action": "fresh_host_no_existing_controller"}
            _complete_or_reconcile_step(
                path,
                record,
                "CONTROLLER_BOUNDED",
                service_details,
                fault_after=fault_after,
            )

            installed = _install_release(
                capsule,
                instance,
                manifest,
                transaction_id=transaction_id,
            )
            installed["manifest_digest"] = manifest["manifest_digest"]
            _complete_or_reconcile_step(
                path,
                record,
                "RELEASE_INSTALLED",
                installed,
                fault_after=fault_after,
            )

            skill_assets = restore_skill_assets(
                capsule_root=capsule,
                instance=instance,
                transaction_id=transaction_id,
            )
            _complete_or_reconcile_step(
                path,
                record,
                "SKILL_ASSETS_RESTORED",
                skill_assets,
                fault_after=fault_after,
            )

            state_root = Path(instance["roots"]["state_root"])
            state_seed = capsule / "recovery" / "state-seed"
            empty_seed: tempfile.TemporaryDirectory[str] | None = None
            if not state_seed.is_dir():
                if mode == "same_host":
                    raise WB0ContractError("same-host golden capsule lacks recovery/state-seed")
                empty_seed = tempfile.TemporaryDirectory(prefix="wb0-empty-state-")
                state_seed = Path(empty_seed.name)
            try:
                golden_path = state_root / "generations" / golden_generation_id
                try:
                    golden = create_generation(
                        state_root=state_root,
                        generation_id=golden_generation_id,
                        source_payload=state_seed,
                        source_release_id=manifest["release_id"],
                        state_schema_version=state_schema_version,
                        compatible_release_ids=[manifest["release_id"]],
                        immutable=True,
                        created_at=manifest["created_at"],
                    )
                except (WB0ContractError, WB0IntegrityError, WB0SafetyError):
                    if not (golden_path.exists() or golden_path.is_symlink()):
                        raise
                    _quarantine_path(
                        golden_path, root=state_root, transaction_id=transaction_id
                    )
                    golden = create_generation(
                        state_root=state_root,
                        generation_id=golden_generation_id,
                        source_payload=state_seed,
                        source_release_id=manifest["release_id"],
                        state_schema_version=state_schema_version,
                        compatible_release_ids=[manifest["release_id"]],
                        immutable=True,
                        created_at=manifest["created_at"],
                    )
                pointer = seal_golden_pointer(
                    state_root=state_root, generation_id=golden_generation_id
                )
                _complete_or_reconcile_step(
                    path,
                    record,
                    "GOLDEN_STATE_SEALED",
                    {"generation_digest": golden["generation_digest"], **pointer},
                    fault_after=fault_after,
                )

                writable_path = state_root / "generations" / writable_generation_id
                try:
                    writable = clone_generation(
                        state_root=state_root,
                        source_generation_id=golden_generation_id,
                        new_generation_id=writable_generation_id,
                        target_release_id=manifest["release_id"],
                        created_at=iso_now(),
                    )
                except (WB0ContractError, WB0IntegrityError, WB0SafetyError):
                    if not (writable_path.exists() or writable_path.is_symlink()):
                        raise
                    _quarantine_path(
                        writable_path, root=state_root, transaction_id=transaction_id
                    )
                    writable = clone_generation(
                        state_root=state_root,
                        source_generation_id=golden_generation_id,
                        new_generation_id=writable_generation_id,
                        target_release_id=manifest["release_id"],
                        created_at=iso_now(),
                    )
                _complete_or_reconcile_step(
                    path,
                    record,
                    "WRITABLE_STATE_PREPARED",
                    {"generation_digest": writable["generation_digest"]},
                    fault_after=fault_after,
                )
            finally:
                if empty_seed is not None:
                    empty_seed.cleanup()

            config = _prepare_config_generation(
                capsule_root=capsule,
                instance=instance,
                release_id=manifest["release_id"],
                config_generation_id=config_generation_id,
                transaction_id=transaction_id,
            )
            _complete_or_reconcile_step(
                path,
                record,
                "CONFIG_PREPARED",
                {"generation_digest": config["generation_digest"]},
                fault_after=fault_after,
            )

            pointer = activate_generation(
                state_root=state_root,
                generation_id=writable_generation_id,
                release_id=manifest["release_id"],
                # The first switch must prove an exact golden clone. A replay
                # of this same journal has already durably recorded that proof;
                # if its pointer was tampered, reassert it without treating
                # legitimate subsequent runtime progress as corruption.
                require_initial_clone=not _step_done(record, "STATE_POINTER_SWITCHED"),
            )
            _complete_or_reconcile_step(
                path,
                record,
                "STATE_POINTER_SWITCHED",
                pointer,
                fault_after=fault_after,
            )

            config_root = Path(instance["roots"]["config_root"])
            config_target = f"generations/{config_generation_id}"
            atomic_symlink(config_target, config_root / "current")
            _complete_or_reconcile_step(
                path,
                record,
                "CONFIG_POINTER_SWITCHED",
                {"pointer": str(config_root / "current"), "target": config_target},
                fault_after=fault_after,
            )

            release_root = Path(instance["roots"]["release_root"])
            release_target = f"releases/{manifest['release_id']}"
            atomic_symlink(release_target, release_root / "current")
            _complete_or_reconcile_step(
                path,
                record,
                "RELEASE_POINTER_SWITCHED",
                {"pointer": str(release_root / "current"), "target": release_target},
                fault_after=fault_after,
            )

            projections = _project_host_files(
                instance=instance,
                release_id=manifest["release_id"],
                transaction_id=transaction_id,
                capsule_root=capsule,
            )
            daemon_reload = _run_systemctl(instance, runner, "daemon-reload")
            if daemon_reload.returncode != 0:
                raise WB0SafetyError(
                    f"systemd daemon-reload failed: {daemon_reload.stderr.strip()}"
                )
            projections["daemon_reload_returncode"] = daemon_reload.returncode
            _complete_or_reconcile_step(
                path,
                record,
                "HOST_PROJECTIONS_INSTALLED",
                projections,
                fault_after=fault_after,
            )

            posture = _verify_safe_posture(instance, manifest["release_id"])
            posture["skill_assets"] = verify_installed_skill_assets(
                capsule_root=capsule,
                instance=instance,
            )
            verify_generation(
                state_root,
                writable_generation_id,
                release_id=manifest["release_id"],
                require_immutable=False,
            )
            verify_generation(
                state_root,
                golden_generation_id,
                release_id=manifest["release_id"],
                require_immutable=True,
            )
            _complete_or_reconcile_step(
                path,
                record,
                "SAFE_POSTURE_VERIFIED",
                posture,
                fault_after=fault_after,
            )

            _complete_or_reconcile_step(
                path,
                record,
                "COMMITTED",
                {
                    "provider_calls": 0,
                    "credentials_imported": False,
                    "production_enforcement": False,
                    _WEB_BRIDGE_STARTED_KEY: False,
                    "controller_state": "STOPPED",
                    "controller_start_is_separate_operation": True,
                },
                fault_after=fault_after,
            )
            record = load_json_object(path)
            record["status"] = "COMMITTED"
            record.pop("last_error", None)
            _write_transaction(path, record)
            return record
        except Exception as exc:
            record = load_json_object(path)
            record["status"] = "INTERRUPTED_RECONCILIATION_REQUIRED"
            record["last_error"] = {"type": type(exc).__name__, "message": str(exc)}
            _write_transaction(path, record)
            raise


def apply_recovery(
    *,
    instance: dict[str, Any],
    capsule_root: str | Path,
    transaction_id: str,
    mode: str,
    golden_generation_id: str,
    writable_generation_id: str,
    config_generation_id: str,
    state_schema_version: str,
    resource_report: dict[str, Any] | None = None,
    fault_after: str | None = None,
    command_runner: CommandRunner | None = None,
) -> dict[str, Any]:
    """Serialize recovery across the instance, then apply or reconcile it.

    A transaction-specific journal is insufficient to protect two different
    transaction IDs from switching the same release/config/state pointers at
    once.  The instance lock therefore encloses transaction creation and every
    mutating recovery step.
    """
    normalized = validate_instance(instance, check_existing_ancestors=True)
    instance_lock = (
        Path(normalized["roots"]["state_root"])
        / "recovery"
        / ".instance-recovery.lock"
    )
    with file_lock(instance_lock):
        return _apply_recovery_with_instance_lock_held(
            instance=normalized,
            capsule_root=capsule_root,
            transaction_id=transaction_id,
            mode=mode,
            golden_generation_id=golden_generation_id,
            writable_generation_id=writable_generation_id,
            config_generation_id=config_generation_id,
            state_schema_version=state_schema_version,
            resource_report=resource_report,
            fault_after=fault_after,
            command_runner=command_runner,
        )



def start_controller_after_recovery(
    *,
    instance: dict[str, Any],
    transaction_id: str,
    start_id: str,
    command_runner: CommandRunner | None = None,
) -> dict[str, Any]:
    """Explicitly start the controller only after a committed recovery.

    Controller liveness is intentionally outside the recovery commit boundary.
    This operation re-verifies the committed transaction's safe shadow posture
    before issuing the one bounded systemctl start.
    """
    normalized = validate_instance(instance, check_existing_ancestors=True)
    validate_id(start_id, "start_id")
    state_root = Path(normalized["roots"]["state_root"])
    instance_lock = state_root / "recovery" / ".instance-recovery.lock"
    with file_lock(instance_lock):
        transaction_path = _transaction_path(normalized, transaction_id)
        record = load_json_object(transaction_path)
        missing = [step for step in STEPS if not _step_done(record, step)]
        if record.get("status") != "COMMITTED" or missing:
            raise WB0SafetyError(
                f"controller start requires a fully COMMITTED recovery transaction; missing={missing}"
            )
        if record.get("final_controller_state") != "STOPPED":
            raise WB0SafetyError("recovery transaction does not bind STOPPED final controller state")
        release_id = validate_id(record.get("release_id"), "release_id")
        writable_generation_id = validate_id(
            record.get("writable_generation_id"), "writable_generation_id"
        )
        config_generation_id = validate_id(
            record.get("config_generation_id"), "config_generation_id"
        )
        expected_outputs = {
            "release_pointer": f"releases/{release_id}",
            "state_pointer": f"generations/{writable_generation_id}/payload",
            "config_pointer": f"generations/{config_generation_id}",
        }
        actual_outputs = {
            "release_pointer": read_symlink_optional(
                Path(normalized["roots"]["release_root"]) / "current"
            ),
            "state_pointer": read_symlink_optional(state_root / "current"),
            "config_pointer": read_symlink_optional(
                Path(normalized["roots"]["config_root"]) / "current"
            ),
        }
        if actual_outputs != expected_outputs:
            raise WB0SafetyError(
                "controller start transaction outputs are no longer active: "
                f"expected={expected_outputs!r} actual={actual_outputs!r}"
            )
        verify_generation(
            state_root,
            writable_generation_id,
            release_id=release_id,
            require_immutable=False,
        )
        verify_generation(
            state_root,
            validate_id(record.get("golden_generation_id"), "golden_generation_id"),
            release_id=release_id,
            require_immutable=True,
        )
        posture = _verify_safe_posture(normalized, release_id)
        starts = state_root / "recovery" / "controller-starts"
        start_path = starts / f"{start_id}.json"
        start_invariant = {
            "schema_version": "1.0",
            "start_id": start_id,
            "transaction_id": transaction_id,
            "transaction_request_digest": record.get("request_digest"),
            "release_id": release_id,
            "writable_generation_id": writable_generation_id,
            "config_generation_id": config_generation_id,
            "active_outputs": actual_outputs,
            "safe_posture": posture,
        }
        if start_path.exists():
            existing = load_json_object(start_path)
            for key in (
                "start_id", "transaction_id", "transaction_request_digest",
                "release_id", "writable_generation_id", "config_generation_id",
                "active_outputs"
            ):
                if existing.get(key) != start_invariant.get(key):
                    raise WB0SafetyError(f"controller start record invariant changed for {key}")
            if existing.get("status") == "STARTED":
                return existing
        starts.mkdir(parents=True, exist_ok=True, mode=0o700)
        prepared = {**start_invariant, "status": "PREPARED", "prepared_at": iso_now()}
        atomic_write_json(start_path, prepared, mode=0o600)
        runner = command_runner or _default_runner
        proc = _run_systemctl(
            normalized, runner, "start", normalized["host_adapter"]["controller_unit"]
        )
        if proc.returncode != 0:
            prepared.update({
                "status": "FAILED",
                "completed_at": iso_now(),
                "stderr": proc.stderr.strip(),
            })
            atomic_write_json(start_path, prepared, mode=0o600)
            raise WB0SafetyError(f"safe controller start failed: {proc.stderr.strip()}")
        prepared.update({
            "status": "STARTED",
            "completed_at": iso_now(),
            "systemctl_returncode": proc.returncode,
        })
        atomic_write_json(start_path, prepared, mode=0o600)
        return prepared

def inspect_recovery_transaction(
    *, instance: dict[str, Any], transaction_id: str
) -> dict[str, Any]:
    instance = validate_instance(instance)
    path = _transaction_path(instance, transaction_id)
    record = load_json_object(path)
    missing = [step for step in STEPS if not _step_done(record, step)]
    return {
        "transaction": record,
        "missing_steps": missing,
        "rerunnable": record.get("status") != "COMMITTED" or bool(missing),
        "provider_calls": record.get("provider_calls", 0),
    }
