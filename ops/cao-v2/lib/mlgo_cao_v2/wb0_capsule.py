"""Explicit, non-destructive golden-capsule capture for WB-0."""
from __future__ import annotations

import os
import shutil
import stat
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from .wb0_common import (
    WB0ContractError,
    WB0IntegrityError,
    WB0SafetyError,
    atomic_write_json,
    ensure_no_symlink_ancestors,
    fsync_tree,
    lexical_absolute_path,
    load_json_object,
    mode_string,
    paths_overlap,
    safe_relative_path,
    validate_git_sha,
    validate_id,
    validate_relative_symlink,
    write_all,
)
from .wb0_manifest import seal_release_capsule, verify_release_capsule

CAPTURE_SPEC_SCHEMA_VERSION = "1.0"
_ALLOWED_TOP_LEVEL = {
    "release",
    "config",
    "skills",
    "services",
    "recovery",
    "bootstrap",
    "docs",
    "manifests",
}
_CATEGORY_PREFIXES = {
    "tracked_source": ("release/evidence/source/", "docs/"),
    "installed_runtime": ("release/lib/",),
    "runtime_launcher": ("release/bin/",),
    "runtime_registry": ("release/share/registry/",),
    "runtime_schema": ("release/share/schemas/",),
    "runtime_example": ("release/share/examples/",),
    "runtime_profile_source": ("release/share/profile-sources/",),
    "non_secret_config": ("config/",),
    "provider_wrapper": ("release/evidence/provider-wrappers/",),
    "service_definition": ("services/",),
    "sealed_skill": ("skills/sealed/",),
    "skill_lock": ("skills/lock/", "release/share/skills/"),
    "native_skill_mirror": ("skills/native-mirror/",),
    "recovery_state_seed": ("recovery/state-seed/",),
    "recovery_tool": ("bootstrap/", "recovery/tools/"),
    "documentation": ("docs/",),
}
_RESERVED_DESTINATIONS = {
    "manifests/release-manifest.json",
    "manifests/capture-spec.json",
    "SHA256SUMS",
}


def _git(command: list[str], cwd: Path) -> str:
    proc = subprocess.run(
        ["git", "-C", str(cwd), *command],
        text=True,
        capture_output=True,
        check=False,
        env={
            **os.environ,
            "GIT_TERMINAL_PROMPT": "0",
            "GIT_ASKPASS": "",
        },
    )
    if proc.returncode != 0:
        raise WB0ContractError(
            f"git {' '.join(command)} failed in {cwd}: {proc.stderr.strip()}"
        )
    return proc.stdout.strip()


def verify_canonical_source(source_checkout: Path, source_commit: str) -> dict[str, Any]:
    if not source_checkout.is_dir() or source_checkout.is_symlink():
        raise WB0ContractError(f"source_checkout must be a real directory: {source_checkout}")
    head = _git(["rev-parse", "HEAD"], source_checkout)
    if head != source_commit:
        raise WB0IntegrityError(
            f"source checkout HEAD {head} does not match capture source_commit {source_commit}"
        )
    status = _git(["status", "--porcelain=v1", "--untracked-files=all"], source_checkout)
    if status:
        first = status.splitlines()[0]
        raise WB0SafetyError(
            f"golden source capture requires a clean canonical checkout; first drift: {first}"
        )
    return {"source_checkout": str(source_checkout), "source_commit": head, "clean": True}


def validate_capture_spec(value: dict[str, Any]) -> dict[str, Any]:
    allowed = {
        "schema_version",
        "release_id",
        "source_commit",
        "source_checkout",
        "runtime_version",
        "created_at",
        "entries",
        "state_contract",
        "skill_contract",
    }
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise WB0ContractError(f"capture spec has unsupported fields: {unknown}")
    if value.get("schema_version") != CAPTURE_SPEC_SCHEMA_VERSION:
        raise WB0ContractError(
            f"unsupported capture spec schema: {value.get('schema_version')!r}"
        )
    release_id = validate_id(value.get("release_id"), "release_id")
    source_commit = validate_git_sha(value.get("source_commit"))
    source_checkout = lexical_absolute_path(
        value.get("source_checkout"), "source_checkout"
    )
    runtime_version = value.get("runtime_version")
    created_at = value.get("created_at")
    if not isinstance(runtime_version, str) or not runtime_version:
        raise WB0ContractError("runtime_version must be non-empty")
    if not isinstance(created_at, str) or not created_at.endswith("Z"):
        raise WB0ContractError("created_at must be an explicit UTC timestamp")
    entries = value.get("entries")
    if not isinstance(entries, list) or not entries:
        raise WB0ContractError("capture spec requires a non-empty entries array")

    normalized_entries: list[dict[str, Any]] = []
    destinations: list[str] = []
    for index, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise WB0ContractError(f"capture entry {index} must be an object")
        entry_allowed = {
            "source",
            "destination",
            "category",
            "required",
            "allow_symlink",
            "description",
        }
        entry_unknown = sorted(set(entry) - entry_allowed)
        if entry_unknown:
            raise WB0ContractError(
                f"capture entry {index} has unsupported fields: {entry_unknown}"
            )
        source = lexical_absolute_path(entry.get("source"), f"entries[{index}].source")
        destination = safe_relative_path(
            entry.get("destination"), f"entries[{index}].destination"
        )
        top = destination.split("/", 1)[0]
        if top not in _ALLOWED_TOP_LEVEL or destination in _RESERVED_DESTINATIONS:
            raise WB0SafetyError(f"capture destination is reserved/unsupported: {destination}")
        category = entry.get("category")
        if category not in _CATEGORY_PREFIXES:
            raise WB0ContractError(f"unsupported capture category: {category!r}")
        if not any(
            destination == prefix.rstrip("/") or destination.startswith(prefix)
            for prefix in _CATEGORY_PREFIXES[category]
        ):
            raise WB0SafetyError(
                f"capture category {category!r} cannot target {destination!r}"
            )
        if category == "tracked_source":
            # Bind provenance to the same checkout whose Git HEAD/cleanliness is
            # verified before capture. Lexical containment alone is insufficient:
            # an in-checkout symlink could otherwise redirect tracked evidence to
            # unrelated staging bytes.
            checkout_real = source_checkout.resolve(strict=False)
            source_real = source.resolve(strict=False)
            try:
                source.relative_to(source_checkout)
                source_real.relative_to(checkout_real)
            except ValueError as exc:
                raise WB0SafetyError(
                    f"tracked_source must come from the verified source_checkout: {source}"
                ) from exc
            if destination == "release/evidence/source/ops/cao-v2":
                expected = source_checkout / "ops" / "cao-v2"
                expected_real = expected.resolve(strict=False)
                if source != expected or source_real != expected_real:
                    raise WB0SafetyError(
                        "canonical tracked-source evidence must be captured from "
                        f"{expected}, not {source}"
                    )
        required = entry.get("required")
        allow_symlink = entry.get("allow_symlink")
        if not isinstance(required, bool) or not isinstance(allow_symlink, bool):
            raise WB0ContractError("capture entry required/allow_symlink must be booleans")
        description = entry.get("description")
        if not isinstance(description, str) or not description.strip():
            raise WB0ContractError("capture entry description must be non-empty")
        for prior in destinations:
            a = Path(destination)
            b = Path(prior)
            if a == b or a in b.parents or b in a.parents:
                raise WB0SafetyError(
                    f"capture destinations overlap: {destination!r} and {prior!r}"
                )
        destinations.append(destination)
        normalized_entries.append(
            {
                "source": str(source),
                "destination": destination,
                "category": category,
                "required": required,
                "allow_symlink": allow_symlink,
                "description": description.strip(),
            }
        )

    state_contract = value.get("state_contract")
    skill_contract = value.get("skill_contract")
    if not isinstance(state_contract, dict) or not isinstance(skill_contract, dict):
        raise WB0ContractError("state_contract and skill_contract must be objects")
    if state_contract.get("golden_state_is_immutable") is not True:
        raise WB0SafetyError("state_contract must require an immutable golden state")
    if state_contract.get("reverse_migration_allowed") is not False:
        raise WB0SafetyError("state_contract must forbid reverse migration")
    required_skill_flags = {
        "sealed_bytes_required": True,
        "canonical_lock_required": True,
        "mirror_must_be_digest_equivalent": True,
        "new_skill_sources_allowed": False,
    }
    for key, expected in required_skill_flags.items():
        if skill_contract.get(key) is not expected:
            raise WB0SafetyError(f"skill_contract must bind {key}={expected!r}")

    required_destinations = {
        "release/evidence/source/ops/cao-v2",
        "release/lib",
        "release/bin",
        "release/share/registry",
        "release/share/schemas",
        "release/share/examples",
        "release/share/profile-sources",
        "release/share/skills/canonical-skill-bundles.lock.json",
        "config",
        "services",
        "skills/lock/canonical-skill-bundles.lock.json",
        "skills/sealed/skill-cache",
        "skills/native-mirror",
        "recovery/state-seed",
        "bootstrap",
    }
    captured_destinations = {entry["destination"] for entry in normalized_entries if entry["required"]}
    missing_destinations = sorted(required_destinations - captured_destinations)
    if missing_destinations:
        raise WB0ContractError(
            f"capture spec omits required activation/evidence destinations: {missing_destinations}"
        )

    return {
        "schema_version": CAPTURE_SPEC_SCHEMA_VERSION,
        "release_id": release_id,
        "source_commit": source_commit,
        "source_checkout": str(source_checkout),
        "runtime_version": runtime_version,
        "created_at": created_at,
        "entries": normalized_entries,
        "state_contract": state_contract,
        "skill_contract": skill_contract,
    }


def load_capture_spec(path: str | Path) -> dict[str, Any]:
    return validate_capture_spec(load_json_object(path))


def _copy_file(source: Path, target: Path) -> None:
    st = os.lstat(source)
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise WB0SafetyError(f"capture accepts only non-hardlinked regular files: {source}")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    source_fd = os.open(source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    target_fd = os.open(
        target,
        os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0),
        stat.S_IMODE(st.st_mode),
    )
    try:
        before = os.fstat(source_fd)
        if (
            before.st_dev != st.st_dev
            or before.st_ino != st.st_ino
            or before.st_nlink != 1
        ):
            raise WB0IntegrityError(f"source changed during no-follow open: {source}")
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
            raise WB0IntegrityError(f"source changed during capture: {source}")
    finally:
        os.close(source_fd)
        os.close(target_fd)
    os.chmod(target, stat.S_IMODE(st.st_mode))


def _copy_entry(
    source: Path, target: Path, *, allow_symlink: bool, capsule_root: Path
) -> None:
    try:
        st = os.lstat(source)
    except FileNotFoundError:
        raise
    if stat.S_ISLNK(st.st_mode):
        if not allow_symlink:
            raise WB0SafetyError(f"capture entry is a symlink but allow_symlink=false: {source}")
        target_value = os.readlink(source)
        validate_relative_symlink(
            target.relative_to(capsule_root).as_posix(), target_value
        )
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.symlink(target_value, target)
        return
    if stat.S_ISREG(st.st_mode):
        _copy_file(source, target)
        return
    if not stat.S_ISDIR(st.st_mode):
        raise WB0SafetyError(f"capture entry is a special file: {source}")
    # Preserve source directory modes only after all children are copied.  A
    # sealed source tree commonly contains 0555/0500 directories; applying
    # those modes while descending would prevent an ordinary (non-root) user
    # from creating the destination children.
    target.mkdir(parents=True, exist_ok=False, mode=0o700)
    directory_modes: dict[Path, int] = {target: stat.S_IMODE(st.st_mode)}
    for current, dirnames, filenames in os.walk(source, topdown=True, followlinks=False):
        current_path = Path(current)
        relative = current_path.relative_to(source)
        destination_dir = target / relative
        for name in sorted(dirnames):
            child = current_path / name
            child_target = destination_dir / name
            child_st = os.lstat(child)
            if stat.S_ISLNK(child_st.st_mode):
                if not allow_symlink:
                    raise WB0SafetyError(f"capture tree contains symlink: {child}")
                link_target = os.readlink(child)
                validate_relative_symlink(
                    child_target.relative_to(capsule_root).as_posix(), link_target
                )
                os.symlink(link_target, child_target)
                dirnames.remove(name)
            elif stat.S_ISDIR(child_st.st_mode):
                child_target.mkdir(mode=0o700)
                directory_modes[child_target] = stat.S_IMODE(child_st.st_mode)
            else:
                raise WB0SafetyError(f"capture tree contains special directory entry: {child}")
        for name in sorted(filenames):
            child = current_path / name
            child_target = destination_dir / name
            child_st = os.lstat(child)
            if stat.S_ISLNK(child_st.st_mode):
                if not allow_symlink:
                    raise WB0SafetyError(f"capture tree contains symlink: {child}")
                link_target = os.readlink(child)
                validate_relative_symlink(
                    child_target.relative_to(capsule_root).as_posix(), link_target
                )
                os.symlink(link_target, child_target)
            elif stat.S_ISREG(child_st.st_mode):
                _copy_file(child, child_target)
            else:
                raise WB0SafetyError(f"capture tree contains special file: {child}")
    for directory, mode in sorted(
        directory_modes.items(), key=lambda item: len(item[0].parts), reverse=True
    ):
        os.chmod(directory, mode)


def capture_golden_capsule(
    *, spec: dict[str, Any], output_directory: str | Path
) -> dict[str, Any]:
    """Capture exact explicitly-listed bytes without changing their sources."""
    spec = validate_capture_spec(spec)
    checkout = Path(spec["source_checkout"])
    source_facts = verify_canonical_source(checkout, spec["source_commit"])
    output = lexical_absolute_path(str(output_directory), "output_directory")
    if output.exists() or output.is_symlink():
        raise WB0SafetyError(f"golden capsule output already exists: {output}")
    ensure_no_symlink_ancestors(output)
    for entry in spec["entries"]:
        source = Path(entry["source"])
        if paths_overlap(source, output):
            raise WB0SafetyError(f"capture source overlaps output: {source}")

    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = Path(tempfile.mkdtemp(prefix=f".{output.name}.", dir=str(output.parent)))
    provenance_rules: list[dict[str, Any]] = []
    inventory: list[dict[str, Any]] = []
    try:
        for entry in spec["entries"]:
            source = Path(entry["source"])
            destination = temp / entry["destination"]
            try:
                _copy_entry(
                    source,
                    destination,
                    allow_symlink=entry["allow_symlink"],
                    capsule_root=temp,
                )
            except FileNotFoundError:
                if entry["required"]:
                    raise WB0ContractError(f"required capture source is missing: {source}")
                inventory.append({**entry, "status": "OPTIONAL_SOURCE_ABSENT"})
                continue
            record = {
                "class": entry["category"],
                "source_path": str(source),
                "source_commit": spec["source_commit"]
                if source == checkout or checkout in source.parents
                else None,
                "description": entry["description"],
            }
            provenance_rules.append({"prefix": entry["destination"], "record": record})
            inventory.append({**entry, "status": "CAPTURED"})

        capture_record = {
            **spec,
            "source_facts": source_facts,
            "inventory": inventory,
            "live_host_mutated": False,
            "provider_calls": 0,
        }
        atomic_write_json(temp / "manifests" / "capture-spec.json", capture_record, mode=0o400)
        provenance_rules.append(
            {
                "prefix": "manifests/capture-spec.json",
                "record": {"class": "capture_evidence", "source_path": None},
            }
        )
        manifest = seal_release_capsule(
            capsule_root=temp,
            release_id=spec["release_id"],
            source_commit=spec["source_commit"],
            runtime_version=spec["runtime_version"],
            state_contract=spec["state_contract"],
            skill_contract=spec["skill_contract"],
            provenance_rules=provenance_rules,
            created_at=spec["created_at"],
        )
        fsync_tree(temp)
        os.replace(temp, output)
        from .wb0_common import fsync_directory

        fsync_directory(output.parent)
    finally:
        if temp.exists():
            shutil.rmtree(temp, ignore_errors=True)
    verified = verify_release_capsule(output)
    if verified["manifest_digest"] != manifest["manifest_digest"]:
        raise WB0IntegrityError("capsule changed across final atomic rename")
    return {
        "release_id": verified["release_id"],
        "manifest_digest": verified["manifest_digest"],
        "output_directory": str(output),
        "captured_entries": sum(1 for item in inventory if item["status"] == "CAPTURED"),
        "optional_absent": sum(
            1 for item in inventory if item["status"] == "OPTIONAL_SOURCE_ABSENT"
        ),
        "live_host_mutated": False,
        "provider_calls": 0,
    }
