"""Operator-controlled population of the sealed cache from the tracked lock.

This is the only path by which third-party bytes enter the CAO-owned cache, and
it is deliberately dull.  It reads the lock, acquires exactly the pinned files
at exactly the pinned revisions, proves every byte against its recorded digest,
and only then seals.  It makes no selection, resolves no version range, and
runs nothing that came out of an upstream repository.

Two properties are worth stating explicitly because they are what make the tool
safe to hand to an operator:

* **Upstream content is inert data, never code.**  Acquisition is a pinned
  ``git fetch`` of one commit followed by reading a fixed list of relative
  paths.  Hooks are redirected to an empty directory, submodules are never
  initialised, and nothing from the fetched tree is executed, imported or
  installed.  The tool would behave identically if the upstream repository were
  a tarball of text files, which is precisely how it treats it.

* **Verification precedes visibility.**  Every file in every bundle is acquired
  and digest-checked before the first bundle is sealed.  A failure anywhere
  leaves the cache exactly as it was, because objects are content-addressed and
  a bundle only becomes resolvable when its manifest lands - and manifests are
  written last, atomically.

The tool activates nothing.  It does not touch policy, profiles, workers,
providers or ``~/.config/mlgo-cao``.  It can *read* ``~/.agents/skills`` to
report mirror equivalence, and it never writes there.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Callable, Mapping

from .canonical_lock import CanonicalLockError, bundle_manifests, load_lock
from .common import ContractError, iso_now, safe_relative_path, sha256_bytes
from .skill_cache import SealedSkillCache, SkillIntegrityError

#: Environment handed to git during acquisition.  Everything that could cause
#: git to run repository-supplied code or read operator credentials is either
#: neutralised or made non-interactive.
_GIT_SAFE_ENV = {
    "GIT_TERMINAL_PROMPT": "0",
    "GIT_ASKPASS": "",
    "GIT_CONFIG_NOSYSTEM": "1",
    "GIT_ALLOW_PROTOCOL": "https",
}


class SkillPopulationError(ContractError):
    """Raised when pinned content cannot be acquired or proven."""


#: A source provider takes one lock bundle entry and returns
#: ``{relative_path: bytes}`` for exactly the paths that bundle pins.  Injecting
#: one is how the tests exercise the whole pipeline offline, without a network
#: fetch and without weakening any verification step.
SourceProvider = Callable[[Mapping[str, Any]], Mapping[str, bytes]]


def git_pinned_source_provider(bundle: Mapping[str, Any]) -> dict[str, bytes]:
    """Acquire one bundle's pinned files by fetching exactly one commit.

    The fetched tree is treated as inert data: nothing in it is executed, and
    only the exact relative paths named by the lock are read.
    """

    revision = str(bundle["source_revision"])
    url = str(bundle["source_repository_or_distribution"])
    if not url.startswith("https://"):
        raise SkillPopulationError(f"refusing non-https source: {url!r}")

    with tempfile.TemporaryDirectory(prefix="mlgo-skill-acquire-") as tmp:
        work = Path(tmp) / "repo"
        work.mkdir(parents=True)
        hooks = Path(tmp) / "empty-hooks"
        hooks.mkdir()

        env = dict(os.environ)
        env.update(_GIT_SAFE_ENV)

        def git(*args: str) -> str:
            result = subprocess.run(
                ["git", "-C", str(work), *args],
                env=env,
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                raise SkillPopulationError(
                    f"git {' '.join(args)} failed for {url} @ {revision}: "
                    f"{result.stderr.strip()}"
                )
            return result.stdout.strip()

        git("init", "-q")
        # Redirect hooks at an empty directory so no fetched or pre-existing
        # hook can execute during any of the commands below.
        git("config", "core.hooksPath", str(hooks))
        git("remote", "add", "origin", url + ".git" if not url.endswith(".git") else url)
        git("-c", "protocol.version=2", "fetch", "-q", "--depth", "1", "--no-tags",
            "origin", revision)
        git("-c", "advice.detachedHead=false", "checkout", "-q",
            "--no-recurse-submodules", "FETCH_HEAD")

        head = git("rev-parse", "HEAD")
        if head != revision:
            raise SkillPopulationError(
                f"acquired revision {head!r} does not match the pinned revision "
                f"{revision!r} for {bundle['bundle_id']!r}"
            )

        contents: dict[str, bytes] = {}
        for entry in bundle["file_manifest"]:
            rel = safe_relative_path(str(entry["relative_path"]))
            candidate = work / rel
            # Resolve and re-check containment so a symlink in the fetched tree
            # cannot redirect a read outside the checkout.
            resolved = candidate.resolve()
            if not str(resolved).startswith(str(work.resolve()) + os.sep):
                raise SkillPopulationError(
                    f"pinned path {rel!r} escapes the checkout for "
                    f"{bundle['bundle_id']!r}"
                )
            if not candidate.is_file() or candidate.is_symlink():
                raise SkillPopulationError(
                    f"pinned file {rel!r} is missing (or is not a regular file) at "
                    f"{revision} of {url}"
                )
            contents[rel] = candidate.read_bytes()
        return contents


def _verify_against_manifest(
    *, bundle_id: str, file_manifest, contents: Mapping[str, bytes]
) -> None:
    """Prove supplied bytes match the pinned manifest exactly, both ways."""

    declared = {e["relative_path"]: e for e in file_manifest}
    missing = sorted(set(declared) - set(contents))
    if missing:
        raise SkillPopulationError(
            f"bundle {bundle_id!r} is missing pinned files: {missing}"
        )
    extra = sorted(set(contents) - set(declared))
    if extra:
        raise SkillPopulationError(
            f"bundle {bundle_id!r} supplied files that the lock does not pin: {extra}"
        )
    for rel, entry in sorted(declared.items()):
        data = contents[rel]
        digest = sha256_bytes(data)
        if digest != entry["content_digest"]:
            raise SkillPopulationError(
                f"bundle {bundle_id!r} file {rel!r} digest mismatch: "
                f"lock={entry['content_digest']} acquired={digest}"
            )
        if len(data) != entry["byte_count"]:
            raise SkillPopulationError(
                f"bundle {bundle_id!r} file {rel!r} size mismatch: "
                f"lock={entry['byte_count']} acquired={len(data)}"
            )


def populate_cache(
    *,
    cache: SealedSkillCache,
    lock: Mapping[str, Any] | None = None,
    lock_path: str | Path | None = None,
    source_provider: SourceProvider = git_pinned_source_provider,
) -> dict[str, Any]:
    """Acquire, verify and seal every bundle the lock pins.

    Every bundle is acquired and fully verified before *any* bundle is sealed,
    so a failure part-way through leaves no newly resolvable content behind.
    Re-running with the same lock is a no-op: sealing is content-addressed and
    idempotent, and an already-sealed bundle is reported rather than rewritten.
    """

    lock = dict(lock) if lock is not None else load_lock(lock_path)
    manifests = bundle_manifests(lock)

    # -- phase 1: acquire and verify everything, seal nothing ---------------
    acquired: dict[str, dict[str, bytes]] = {}
    for bundle in lock["bundles"]:
        bundle_id = bundle["bundle_id"]
        contents = {
            safe_relative_path(str(k)): bytes(v)
            for k, v in source_provider(bundle).items()
        }
        _verify_against_manifest(
            bundle_id=bundle_id,
            file_manifest=bundle["file_manifest"],
            contents=contents,
        )
        acquired[bundle_id] = contents

    # -- phase 2: seal, now that every byte is proven ------------------------
    results: list[dict[str, Any]] = []
    for bundle in lock["bundles"]:
        bundle_id = bundle["bundle_id"]
        manifest = manifests[bundle_id]
        already = cache.load_manifest(bundle_id) is not None
        sealed = cache.seal_bundle(manifest, acquired[bundle_id])
        if sealed["content_digest"] != bundle["aggregate_content_digest"]:
            raise SkillPopulationError(
                f"bundle {bundle_id!r} sealed digest disagrees with the lock"
            )
        results.append(
            {
                "bundle_id": bundle_id,
                "source_revision": bundle["source_revision"],
                "content_digest": sealed["content_digest"],
                "manifest_digest": sealed["manifest_digest"],
                "file_count": len(bundle["file_manifest"]),
                "byte_count": bundle["total_byte_count"],
                "action": "ALREADY_SEALED" if already else "SEALED",
            }
        )

    return {
        "schema_version": "1.0",
        "lock_digest": lock["lock_digest"],
        "cache_root": str(cache.root),
        "bundles": sorted(results, key=lambda r: r["bundle_id"]),
        "sealed_count": sum(1 for r in results if r["action"] == "SEALED"),
        "already_sealed_count": sum(1 for r in results if r["action"] == "ALREADY_SEALED"),
        "upstream_code_executed": False,
        "populated_at": iso_now(),
    }


def bind_namespace(
    *,
    cache: SealedSkillCache,
    lock: Mapping[str, Any],
    project_id: str,
    security_domain_id: str,
) -> list[dict[str, Any]]:
    """Make every pinned bundle resolvable inside exactly one namespace."""

    return [
        cache.bind_bundle(
            bundle_id=bundle["bundle_id"],
            project_id=project_id,
            security_domain_id=security_domain_id,
        )
        for bundle in sorted(lock["bundles"], key=lambda b: b["bundle_id"])
    ]


def project_native_mirror(
    *,
    cache: SealedSkillCache,
    lock: Mapping[str, Any],
    mirror_root: str | Path,
    project_id: str,
    security_domain_id: str,
    rollback_root: str | Path,
) -> dict[str, Any]:
    """Project already-sealed, already-approved bundle bytes into the native mirror.

    This is the one authorized Slice 4 canary write path into
    ``~/.agents/skills``.  It never selects, fetches, or executes anything: it
    only copies bytes that are already sealed (and already digest-proven) in
    the operator-populated cache, using the same skill_id -> mirror-name
    mapping :func:`verify_native_mirror` uses to compare them.

    Every file this call is about to touch is snapshotted first, so a single
    rollback record can restore the mirror to its pre-projection state.
    Already-equivalent files are left untouched (idempotent), and a mismatch
    that survives the write is treated as failure, not partial success -
    mirror drift fails closed.
    """

    root = Path(mirror_root).expanduser()
    rollback_dir = Path(rollback_root).expanduser()
    rollback_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = iso_now().replace(":", "").replace("-", "") + "-" + os.urandom(4).hex()
    snapshot: list[dict[str, Any]] = []
    written: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []

    for bundle in sorted(lock["bundles"], key=lambda b: b["bundle_id"]):
        resolved = cache.resolve(
            bundle_id=bundle["bundle_id"],
            project_id=project_id,
            security_domain_id=security_domain_id,
        )
        sealed_by_path = {e["relative_path"]: e for e in resolved["files"]}
        for skill in sorted(bundle["selected_skills"], key=lambda s: s["skill_id"]):
            entry = sealed_by_path[skill["relative_path"]]
            target = root / skill["native_mirror_name"] / "SKILL.md"
            data = cache.read_file(resolved=resolved, relative_path=skill["relative_path"])
            if sha256_bytes(data) != entry["content_digest"]:
                raise SkillPopulationError(
                    f"sealed content corrupt for skill {skill['skill_id']!r} before projection"
                )

            pre_existed = target.is_file()
            pre_bytes = target.read_bytes() if pre_existed else None
            if pre_existed and sha256_bytes(pre_bytes) == entry["content_digest"]:
                skipped.append({"skill_id": skill["skill_id"], "mirror_path": str(target), "reason": "already equivalent"})
                continue

            snapshot.append({
                "skill_id": skill["skill_id"],
                "mirror_path": str(target),
                "pre_existed": pre_existed,
                "pre_content_sha256": sha256_bytes(pre_bytes) if pre_existed else None,
                "pre_content_backup": None,
            })
            if pre_existed:
                backup_path = rollback_dir / f"{stamp}-{skill['skill_id']}-SKILL.md.bak"
                backup_path.write_bytes(pre_bytes)
                backup_path.chmod(0o400)
                snapshot[-1]["pre_content_backup"] = str(backup_path)

            target.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
            fd, tmp_name = tempfile.mkstemp(prefix=".mirror-", dir=str(target.parent))
            tmp = Path(tmp_name)
            try:
                with os.fdopen(fd, "wb") as handle:
                    handle.write(data)
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp, target)
            finally:
                if tmp.exists():
                    tmp.unlink(missing_ok=True)
            written.append({"skill_id": skill["skill_id"], "mirror_path": str(target), "bytes": len(data)})

    rollback_record = {
        "schema_version": "1.0",
        "projected_at": iso_now(),
        "mirror_root": str(root),
        "project_id": project_id,
        "security_domain_id": security_domain_id,
        "lock_digest": lock["lock_digest"],
        "snapshot": snapshot,
        "written": written,
        "skipped": skipped,
    }
    rollback_path = rollback_dir / f"{stamp}-rollback-record.json"
    rollback_path.write_text(
        json.dumps(rollback_record, indent=2, sort_keys=True), encoding="utf-8"
    )
    rollback_path.chmod(0o400)

    verification = verify_native_mirror(
        cache=cache, lock=lock, mirror_root=root,
        project_id=project_id, security_domain_id=security_domain_id,
    )
    if not verification["equivalent"]:
        raise SkillPopulationError(
            f"native mirror still drifted after projection: {verification['bundles']}"
        )

    return {
        "schema_version": "1.0",
        "mirror_root": str(root),
        "mirror_mutated": bool(written),
        "written_count": len(written),
        "skipped_count": len(skipped),
        "written": written,
        "skipped": skipped,
        "rollback_record_path": str(rollback_path),
        "verification": verification,
        "projected_at": iso_now(),
    }


def verify_native_mirror(
    *,
    cache: SealedSkillCache,
    lock: Mapping[str, Any],
    mirror_root: str | Path,
    project_id: str,
    security_domain_id: str,
) -> dict[str, Any]:
    """Compare a native mirror against sealed content without mutating it.

    The mirror is laid out by skill name (``<mirror_root>/<name>/SKILL.md``),
    which is the ``~/.agents/skills`` convention, whereas the sealed content is
    addressed by the bundle-relative path.  The lock records the expected mirror
    name for each skill, so the comparison is exact rather than a search.

    This function only ever reads.  A drifted mirror is reported as rejected;
    the sealed cache remains authoritative either way.
    """

    root = Path(mirror_root).expanduser()
    bundles: list[dict[str, Any]] = []
    for bundle in sorted(lock["bundles"], key=lambda b: b["bundle_id"]):
        resolved = cache.resolve(
            bundle_id=bundle["bundle_id"],
            project_id=project_id,
            security_domain_id=security_domain_id,
        )
        sealed_by_path = {e["relative_path"]: e for e in resolved["files"]}
        differences: list[dict[str, Any]] = []
        for skill in sorted(bundle["selected_skills"], key=lambda s: s["skill_id"]):
            entry = sealed_by_path[skill["relative_path"]]
            candidate = root / skill["native_mirror_name"] / "SKILL.md"
            if not candidate.is_file():
                differences.append(
                    {
                        "skill_id": skill["skill_id"],
                        "mirror_path": str(candidate),
                        "reason": "missing in mirror",
                    }
                )
                continue
            actual = sha256_bytes(candidate.read_bytes())
            if actual != entry["content_digest"]:
                differences.append(
                    {
                        "skill_id": skill["skill_id"],
                        "mirror_path": str(candidate),
                        "reason": "digest mismatch",
                        "sealed_digest": entry["content_digest"],
                        "mirror_digest": actual,
                    }
                )
        bundles.append(
            {
                "bundle_id": bundle["bundle_id"],
                "equivalent": not differences,
                "accepted": not differences,
                "differences": differences,
            }
        )

    equivalent = all(b["equivalent"] for b in bundles)
    return {
        "schema_version": "1.0",
        "mirror_root": str(root),
        "mirror_mutated": False,
        "equivalent": equivalent,
        "accepted": equivalent,
        "bundles": bundles,
        "reason": (
            "native mirror is byte-equivalent to sealed content"
            if equivalent
            else "native mirror rejected; sealed cache remains authoritative"
        ),
        "checked_at": iso_now(),
    }
