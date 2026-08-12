"""Digest-exact WB-0 skill sealing, verification, and host reconstruction.

The canonical lock, sealed cache objects, and native mirror are separate
surfaces.  WB-0 proves all three agree, restores the CAO-owned cache without
network acquisition, rebuilds namespace bindings for the target instance, and
projects native mirror files from the sealed object bytes rather than trusting
captured mirror files as a source.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any

from .wb0_common import (
    WB0ContractError,
    WB0IntegrityError,
    WB0SafetyError,
    atomic_write_bytes,
    atomic_write_json,
    ensure_no_symlink_ancestors,
    fsync_directory,
    iso_now,
    lexical_absolute_path,
    load_json_object,
    safe_relative_path,
    sha256_file,
    sha256_json,
    validate_id,
    validate_sha256,
)

LOCK_REL = Path("release/share/skills/canonical-skill-bundles.lock.json")
EVIDENCE_LOCK_REL = Path("skills/lock/canonical-skill-bundles.lock.json")
SEALED_CACHE_REL = Path("skills/sealed/skill-cache")
MIRROR_REL = Path("skills/native-mirror")
LOCK_SCHEMA_VERSION = "1.0"


def _regular_file(path: Path, label: str) -> os.stat_result:
    try:
        st = os.lstat(path)
    except FileNotFoundError as exc:
        raise WB0IntegrityError(f"missing {label}: {path}") from exc
    if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
        raise WB0SafetyError(f"{label} must be a non-hardlinked regular file: {path}")
    return st


def _real_directory(path: Path, label: str) -> None:
    try:
        st = os.lstat(path)
    except FileNotFoundError as exc:
        raise WB0IntegrityError(f"missing {label}: {path}") from exc
    if not stat.S_ISDIR(st.st_mode):
        raise WB0SafetyError(f"{label} must be a real directory: {path}")


def _walk_secure_tree(root: Path, label: str) -> tuple[set[str], set[str]]:
    _real_directory(root, label)
    directories: set[str] = set()
    files: set[str] = set()
    for current, dirnames, filenames in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for name in sorted(dirnames):
            candidate = current_path / name
            st = os.lstat(candidate)
            if not stat.S_ISDIR(st.st_mode):
                raise WB0SafetyError(f"{label} contains a symlink/special directory: {candidate}")
            directories.add(candidate.relative_to(root).as_posix())
        for name in sorted(filenames):
            candidate = current_path / name
            st = os.lstat(candidate)
            if not stat.S_ISREG(st.st_mode) or st.st_nlink != 1:
                raise WB0SafetyError(f"{label} contains a symlink/special/hardlink: {candidate}")
            files.add(candidate.relative_to(root).as_posix())
    return directories, files


def _load_and_validate_lock(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    _regular_file(path, "canonical skill lock")
    lock = load_json_object(path)
    if lock.get("lock_schema_version") != LOCK_SCHEMA_VERSION:
        raise WB0ContractError(
            f"unsupported canonical skill lock schema: {lock.get('lock_schema_version')!r}"
        )
    declared = validate_sha256(lock.get("lock_digest"), "canonical lock digest")
    derived = sha256_json({key: value for key, value in lock.items() if key != "lock_digest"})
    if declared != derived:
        raise WB0IntegrityError(
            f"canonical skill lock digest mismatch: declared={declared} derived={derived}"
        )
    bundles = lock.get("bundles")
    if not isinstance(bundles, list) or not bundles:
        raise WB0ContractError("canonical skill lock declares no bundles")

    normalized: list[dict[str, Any]] = []
    bundle_ids: set[str] = set()
    mirror_names: set[str] = set()
    skill_ids: set[str] = set()
    for bundle in bundles:
        if not isinstance(bundle, dict):
            raise WB0ContractError("canonical skill bundle must be an object")
        bundle_id = validate_id(bundle.get("bundle_id"), "bundle_id")
        if bundle_id in bundle_ids:
            raise WB0ContractError(f"duplicate canonical skill bundle: {bundle_id}")
        bundle_ids.add(bundle_id)
        file_manifest = bundle.get("file_manifest")
        selected = bundle.get("selected_skills")
        if not isinstance(file_manifest, list) or not file_manifest:
            raise WB0ContractError(f"bundle {bundle_id!r} has no file manifest")
        if not isinstance(selected, list) or not selected:
            raise WB0ContractError(f"bundle {bundle_id!r} selects no skills")

        by_path: dict[str, dict[str, Any]] = {}
        normalized_manifest: list[dict[str, Any]] = []
        for item in file_manifest:
            if not isinstance(item, dict):
                raise WB0ContractError(f"bundle {bundle_id!r} has a non-object file entry")
            rel = safe_relative_path(item.get("relative_path"), "skill relative_path")
            if rel in by_path:
                raise WB0ContractError(f"bundle {bundle_id!r} pins {rel!r} twice")
            digest = validate_sha256(item.get("content_digest"), f"digest for {rel}")
            byte_count = item.get("byte_count")
            if not isinstance(byte_count, int) or byte_count < 0:
                raise WB0ContractError(f"invalid byte_count for canonical skill {rel!r}")
            normalized_item = {
                "relative_path": rel,
                "content_digest": digest,
                "byte_count": byte_count,
            }
            by_path[rel] = normalized_item
            normalized_manifest.append(normalized_item)
        aggregate = sha256_json(sorted(normalized_manifest, key=lambda item: item["relative_path"]))
        if bundle.get("aggregate_content_digest") != aggregate:
            raise WB0IntegrityError(f"bundle {bundle_id!r} aggregate content digest mismatch")

        selected_records: list[dict[str, Any]] = []
        for skill in selected:
            if not isinstance(skill, dict):
                raise WB0ContractError(f"bundle {bundle_id!r} has a non-object selected skill")
            skill_id = validate_id(skill.get("skill_id"), "skill_id")
            if skill_id in skill_ids:
                raise WB0ContractError(f"duplicate canonical skill id: {skill_id}")
            skill_ids.add(skill_id)
            rel = safe_relative_path(skill.get("relative_path"), "selected skill relative_path")
            pinned = by_path.get(rel)
            if pinned is None:
                raise WB0ContractError(
                    f"selected skill {skill_id!r} references unpinned path {rel!r}"
                )
            if (
                skill.get("content_digest") != pinned["content_digest"]
                or skill.get("byte_count") != pinned["byte_count"]
            ):
                raise WB0IntegrityError(
                    f"selected skill {skill_id!r} disagrees with its pinned file entry"
                )
            mirror_name = safe_relative_path(
                skill.get("native_mirror_name"), "native_mirror_name"
            )
            if "/" in mirror_name:
                raise WB0SafetyError(
                    f"native mirror name must be one path component: {mirror_name!r}"
                )
            if mirror_name in mirror_names:
                raise WB0ContractError(f"duplicate native mirror name: {mirror_name}")
            mirror_names.add(mirror_name)
            selected_records.append(
                {
                    "skill_id": skill_id,
                    "relative_path": rel,
                    "native_mirror_name": mirror_name,
                    "content_digest": pinned["content_digest"],
                    "byte_count": pinned["byte_count"],
                }
            )
        normalized.append(
            {
                "bundle_id": bundle_id,
                "aggregate_content_digest": aggregate,
                "selected_skills": sorted(selected_records, key=lambda item: item["skill_id"]),
            }
        )
    return lock, sorted(normalized, key=lambda item: item["bundle_id"])


def _verify_bundle_manifest(path: Path, bundle: dict[str, Any]) -> dict[str, Any]:
    _regular_file(path, f"sealed bundle manifest {bundle['bundle_id']}")
    manifest = load_json_object(path)
    if manifest.get("bundle_id") != bundle["bundle_id"]:
        raise WB0IntegrityError(f"sealed bundle manifest identity mismatch: {path}")
    expected_content_digest = bundle.get("aggregate_content_digest") or bundle.get("content_digest")
    if manifest.get("content_digest") != expected_content_digest:
        raise WB0IntegrityError(f"sealed bundle manifest content mismatch: {path}")
    declared = validate_sha256(
        manifest.get("manifest_digest"), f"manifest digest for {bundle['bundle_id']}"
    )
    derived = sha256_json(
        {key: value for key, value in manifest.items() if key != "manifest_digest"}
    )
    if declared != derived:
        raise WB0IntegrityError(f"sealed bundle manifest self-digest mismatch: {path}")
    return manifest


def verify_skill_capsule(
    capsule_root: str | Path, skill_contract: dict[str, Any]
) -> dict[str, Any]:
    """Prove lock, sealed objects, bundle manifests, and mirror bytes agree."""
    if not isinstance(skill_contract, dict):
        raise WB0ContractError("skill_contract must be an object")
    required_flags = {
        "sealed_bytes_required": True,
        "canonical_lock_required": True,
        "mirror_must_be_digest_equivalent": True,
        "new_skill_sources_allowed": False,
    }
    for key, expected in required_flags.items():
        if skill_contract.get(key) is not expected:
            raise WB0SafetyError(f"skill_contract must bind {key}={expected!r}")

    root = Path(capsule_root)
    active_lock_path = root / LOCK_REL
    evidence_lock_path = root / EVIDENCE_LOCK_REL
    active_bytes = active_lock_path.read_bytes() if _regular_file(active_lock_path, "active skill lock") else b""
    evidence_bytes = evidence_lock_path.read_bytes() if _regular_file(evidence_lock_path, "evidence skill lock") else b""
    if active_bytes != evidence_bytes:
        raise WB0IntegrityError("active and evidence canonical skill lock bytes differ")
    lock, bundles = _load_and_validate_lock(active_lock_path)

    cache_root = root / SEALED_CACHE_REL
    mirror_root = root / MIRROR_REL
    _walk_secure_tree(cache_root, "sealed skill cache")
    mirror_directories, mirror_files = _walk_secure_tree(mirror_root, "canonical native mirror evidence")

    expected_mirror_files: set[str] = set()
    expected_mirror_dirs: set[str] = set()
    objects: dict[str, dict[str, Any]] = {}
    bundle_summaries: list[dict[str, Any]] = []
    selected_summaries: list[dict[str, Any]] = []
    for bundle in bundles:
        manifest_path = cache_root / "manifests" / f"{bundle['bundle_id']}.json"
        sealed_manifest = _verify_bundle_manifest(manifest_path, bundle)
        bundle_summaries.append(
            {
                "bundle_id": bundle["bundle_id"],
                "content_digest": bundle["aggregate_content_digest"],
                "manifest_digest": sealed_manifest["manifest_digest"],
            }
        )
        for skill in bundle["selected_skills"]:
            digest = skill["content_digest"]
            object_rel = Path("objects") / digest[:2] / digest
            object_path = cache_root / object_rel
            st = _regular_file(object_path, f"sealed object for {skill['skill_id']}")
            if st.st_size != skill["byte_count"] or sha256_file(object_path) != digest:
                raise WB0IntegrityError(
                    f"sealed object digest/size mismatch for {skill['skill_id']!r}"
                )
            mirror_rel = Path(skill["native_mirror_name"]) / "SKILL.md"
            mirror_path = mirror_root / mirror_rel
            mirror_st = _regular_file(mirror_path, f"native mirror evidence for {skill['skill_id']}")
            if mirror_st.st_size != skill["byte_count"] or sha256_file(mirror_path) != digest:
                raise WB0IntegrityError(
                    f"native mirror evidence differs from sealed bytes for {skill['skill_id']!r}"
                )
            expected_mirror_files.add(mirror_rel.as_posix())
            expected_mirror_dirs.add(mirror_rel.parent.as_posix())
            objects[digest] = {
                "sha256": digest,
                "byte_count": skill["byte_count"],
                "object_path": object_rel.as_posix(),
            }
            selected_summaries.append(
                {
                    "skill_id": skill["skill_id"],
                    "bundle_id": bundle["bundle_id"],
                    "native_mirror_name": skill["native_mirror_name"],
                    "sha256": digest,
                    "byte_count": skill["byte_count"],
                    "object_path": object_rel.as_posix(),
                    "mirror_path": mirror_rel.as_posix(),
                }
            )
    if mirror_files != expected_mirror_files or mirror_directories != expected_mirror_dirs:
        raise WB0IntegrityError(
            "canonical native mirror evidence path set mismatch: "
            f"missing_files={sorted(expected_mirror_files-mirror_files)} "
            f"extra_files={sorted(mirror_files-expected_mirror_files)} "
            f"missing_dirs={sorted(expected_mirror_dirs-mirror_directories)} "
            f"extra_dirs={sorted(mirror_directories-expected_mirror_dirs)}"
        )
    return {
        "schema_version": "1.0",
        "lock_schema_version": lock["lock_schema_version"],
        "lock_digest": lock["lock_digest"],
        "lock_file_sha256": sha256_file(active_lock_path),
        "bundle_count": len(bundle_summaries),
        "selected_skill_count": len(selected_summaries),
        "unique_object_count": len(objects),
        "bundles": bundle_summaries,
        "selected_skills": sorted(selected_summaries, key=lambda item: item["skill_id"]),
        "sealed_cache_path": SEALED_CACHE_REL.as_posix(),
        "native_mirror_evidence_path": MIRROR_REL.as_posix(),
        "upstream_acquisition_performed": False,
        "new_skill_sources_added": False,
    }


def _quarantine_entry(path: Path, quarantine_root: Path, label: str) -> str:
    quarantine_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    base = quarantine_root / label
    candidate = base
    index = 1
    while candidate.exists() or candidate.is_symlink():
        index += 1
        candidate = quarantine_root / f"{label}.{index}"

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
    return str(candidate)


def _copy_cache_file(source: Path, destination: Path, quarantine_root: Path) -> str:
    source_st = _regular_file(source, "sealed cache source file")
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    ensure_no_symlink_ancestors(destination.parent)
    try:
        dest_st = os.lstat(destination)
    except FileNotFoundError:
        dest_st = None
    if dest_st is not None:
        if (
            stat.S_ISREG(dest_st.st_mode)
            and dest_st.st_nlink == 1
            and dest_st.st_size == source_st.st_size
            and sha256_file(destination) == sha256_file(source)
        ):
            return "ALREADY_VERIFIED"
        _quarantine_entry(
            destination,
            quarantine_root,
            destination.as_posix().lstrip("/").replace("/", "__"),
        )
    atomic_write_bytes(destination, source.read_bytes(), mode=0o400)
    if sha256_file(destination) != sha256_file(source):
        raise WB0IntegrityError(f"sealed cache copy verification failed: {destination}")
    return "IMPORTED"


def _namespace_key(project_id: str, security_domain_id: str) -> str:
    validate_id(project_id, "skill project_id")
    validate_id(security_domain_id, "skill security_domain_id")
    return sha256_json(
        {"project_id": project_id, "security_domain_id": security_domain_id}
    )


def restore_skill_assets(
    *,
    capsule_root: str | Path,
    instance: dict[str, Any],
    transaction_id: str,
) -> dict[str, Any]:
    """Restore sealed cache and project mirror from capsule-sealed object bytes."""
    root = Path(capsule_root)
    verification = verify_skill_capsule(root, instance.get("skill_contract") or {
        "sealed_bytes_required": True,
        "canonical_lock_required": True,
        "mirror_must_be_digest_equivalent": True,
        "new_skill_sources_allowed": False,
    })
    bindings = instance.get("skill_bindings")
    if not isinstance(bindings, dict):
        raise WB0ContractError("instance skill_bindings are required")
    cache_parent = lexical_absolute_path(bindings.get("cache_root"), "skill_bindings.cache_root")
    mirror_root = lexical_absolute_path(
        bindings.get("native_mirror_root"), "skill_bindings.native_mirror_root"
    )
    ensure_no_symlink_ancestors(cache_parent)
    ensure_no_symlink_ancestors(mirror_root)
    cache_root = cache_parent / "skill-cache"
    cache_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name in ("objects", "manifests", "ns"):
        path = cache_root / name
        try:
            st = os.lstat(path)
        except FileNotFoundError:
            path.mkdir(parents=True, mode=0o700)
        else:
            if not stat.S_ISDIR(st.st_mode):
                raise WB0SafetyError(f"skill cache path is not a directory: {path}")

    quarantine_root = (
        Path(instance["roots"]["state_root"])
        / "recovery"
        / "skill-quarantine"
        / validate_id(transaction_id, "transaction_id")
    )
    source_cache = root / SEALED_CACHE_REL
    cache_results: list[dict[str, Any]] = []
    for subtree in ("objects", "manifests"):
        source_subtree = source_cache / subtree
        _real_directory(source_subtree, f"sealed cache {subtree}")
        for current, dirnames, filenames in os.walk(
            source_subtree, topdown=True, followlinks=False
        ):
            current_path = Path(current)
            for name in sorted(dirnames):
                child = current_path / name
                if not stat.S_ISDIR(os.lstat(child).st_mode):
                    raise WB0SafetyError(f"sealed cache contains unsafe directory: {child}")
                destination_dir = cache_root / child.relative_to(source_cache)
                destination_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
            for name in sorted(filenames):
                source = current_path / name
                destination = cache_root / source.relative_to(source_cache)
                status = _copy_cache_file(source, destination, quarantine_root)
                cache_results.append(
                    {"path": destination.relative_to(cache_root).as_posix(), "status": status}
                )

    project_id = validate_id(bindings.get("project_id"), "skill project_id")
    security_domain_id = validate_id(
        bindings.get("security_domain_id"), "skill security_domain_id"
    )
    namespace = _namespace_key(project_id, security_domain_id)
    namespace_dir = cache_root / "ns" / namespace
    try:
        namespace_st = os.lstat(namespace_dir)
    except FileNotFoundError:
        namespace_dir.mkdir(parents=True, mode=0o700)
    else:
        if not stat.S_ISDIR(namespace_st.st_mode):
            raise WB0SafetyError(
                f"skill namespace path must be a real directory: {namespace_dir}"
            )
    namespace_results: list[dict[str, Any]] = []
    for bundle in verification["bundles"]:
        path = namespace_dir / f"{bundle['bundle_id']}.json"
        expected = {
            "bundle_id": bundle["bundle_id"],
            "project_id": project_id,
            "security_domain_id": security_domain_id,
            "namespace_key": namespace,
            "content_digest": bundle["content_digest"],
            "manifest_digest": bundle["manifest_digest"],
        }
        status = "BOUND"
        if path.exists() and not path.is_symlink():
            existing = load_json_object(path)
            if all(existing.get(key) == value for key, value in expected.items()):
                status = "ALREADY_BOUND"
            else:
                _quarantine_entry(
                    path, quarantine_root, f"binding__{bundle['bundle_id']}.json"
                )
        elif path.is_symlink():
            _quarantine_entry(
                path, quarantine_root, f"binding__{bundle['bundle_id']}.json"
            )
        if status == "BOUND":
            atomic_write_json(path, {**expected, "bound_at": iso_now()}, mode=0o600)
        namespace_results.append({"bundle_id": bundle["bundle_id"], "status": status})

    mirror_root.mkdir(parents=True, exist_ok=True, mode=0o755)
    mirror_backup_root = (
        Path(instance["roots"]["state_root"])
        / "recovery"
        / "host-backups"
        / transaction_id
        / "native-skill-mirror"
    )
    mirror_results: list[dict[str, Any]] = []
    for skill in verification["selected_skills"]:
        object_path = source_cache / skill["object_path"]
        _regular_file(object_path, f"sealed object for {skill['skill_id']}")
        target = mirror_root / skill["mirror_path"]
        ensure_no_symlink_ancestors(target.parent)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
        status = "PROJECTED_FROM_SEALED_OBJECT"
        backup: str | None = None
        try:
            target_st = os.lstat(target)
        except FileNotFoundError:
            target_st = None
        if target_st is not None:
            if (
                stat.S_ISREG(target_st.st_mode)
                and target_st.st_nlink == 1
                and target_st.st_size == skill["byte_count"]
                and sha256_file(target) == skill["sha256"]
            ):
                status = "ALREADY_EQUIVALENT"
            elif stat.S_ISREG(target_st.st_mode) or stat.S_ISLNK(target_st.st_mode):
                mirror_backup_root.mkdir(parents=True, exist_ok=True, mode=0o700)
                backup_path = mirror_backup_root / skill["native_mirror_name"] / "SKILL.md"
                backup_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                if stat.S_ISREG(target_st.st_mode):
                    atomic_write_bytes(backup_path, target.read_bytes(), mode=0o400)
                else:
                    atomic_write_json(
                        backup_path.with_suffix(".symlink.json"),
                        {"target": os.readlink(target)},
                        mode=0o400,
                    )
                    backup_path = backup_path.with_suffix(".symlink.json")
                backup = str(backup_path)
            else:
                raise WB0SafetyError(
                    f"refusing to replace non-file native mirror entry: {target}"
                )
        if status != "ALREADY_EQUIVALENT":
            atomic_write_bytes(target, object_path.read_bytes(), mode=0o400)
            if sha256_file(target) != skill["sha256"]:
                raise WB0IntegrityError(
                    f"native mirror projection digest mismatch: {target}"
                )
        mirror_results.append(
            {
                "skill_id": skill["skill_id"],
                "path": str(target),
                "sha256": skill["sha256"],
                "status": status,
                "backup": backup,
            }
        )
    return {
        "schema_version": "1.0",
        "lock_digest": verification["lock_digest"],
        "cache_root": str(cache_root),
        "namespace_key": namespace,
        "cache_files": cache_results,
        "namespace_bindings": namespace_results,
        "native_mirror_root": str(mirror_root),
        "native_mirror": mirror_results,
        "mirror_source": "sealed_content_addressed_objects",
        "upstream_acquisition_performed": False,
        "provider_calls": 0,
    }


def verify_installed_skill_assets(
    *, capsule_root: str | Path, instance: dict[str, Any]
) -> dict[str, Any]:
    verification = verify_skill_capsule(
        capsule_root,
        {
            "sealed_bytes_required": True,
            "canonical_lock_required": True,
            "mirror_must_be_digest_equivalent": True,
            "new_skill_sources_allowed": False,
        },
    )
    bindings = instance["skill_bindings"]
    cache_root = Path(bindings["cache_root"]) / "skill-cache"
    mirror_root = Path(bindings["native_mirror_root"])
    namespace = _namespace_key(bindings["project_id"], bindings["security_domain_id"])
    for bundle in verification["bundles"]:
        manifest_path = cache_root / "manifests" / f"{bundle['bundle_id']}.json"
        manifest = _verify_bundle_manifest(manifest_path, bundle)
        binding_path = cache_root / "ns" / namespace / f"{bundle['bundle_id']}.json"
        _regular_file(binding_path, f"installed namespace binding {bundle['bundle_id']}")
        binding = load_json_object(binding_path)
        for key, expected in {
            "project_id": bindings["project_id"],
            "security_domain_id": bindings["security_domain_id"],
            "namespace_key": namespace,
            "content_digest": bundle["content_digest"],
            "manifest_digest": manifest["manifest_digest"],
        }.items():
            if binding.get(key) != expected:
                raise WB0IntegrityError(
                    f"installed skill namespace binding mismatch for {bundle['bundle_id']}: {key}"
                )
    for skill in verification["selected_skills"]:
        object_path = cache_root / skill["object_path"]
        mirror_path = mirror_root / skill["mirror_path"]
        object_st = _regular_file(object_path, f"installed sealed object {skill['skill_id']}")
        mirror_st = _regular_file(mirror_path, f"installed native mirror {skill['skill_id']}")
        if (
            object_st.st_size != skill["byte_count"]
            or mirror_st.st_size != skill["byte_count"]
            or sha256_file(object_path) != skill["sha256"]
            or sha256_file(mirror_path) != skill["sha256"]
        ):
            raise WB0IntegrityError(
                f"installed skill bytes differ from capsule lock for {skill['skill_id']}"
            )
    return {
        "lock_digest": verification["lock_digest"],
        "namespace_key": namespace,
        "bundle_count": verification["bundle_count"],
        "selected_skill_count": verification["selected_skill_count"],
        "mirror_digest_equivalent": True,
        "provider_calls": 0,
    }
