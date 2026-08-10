"""CAO-owned content-addressed sealed cache for canonical skill bundles.

The authoritative bytes of a canonical skill are the bytes in this cache, not
the bytes a provider happens to have installed.  A native installation can be
replaced, upgraded or removed by anything on the host at any time; a run that
trusted it would silently change what its worker was told between one attempt
and the next.  So a native install is only ever an *execution mirror*, usable
after - and only after - proving digest equivalence against the sealed content.

Two isolation properties are load-bearing:

* **Dedup is safe, existence disclosure is not.**  Identical bytes across
  projects share one object, because a sha256 collision is the only way that
  could be wrong.  But a namespace can only resolve bundles that were
  explicitly bound into it, and asking about an unbound bundle returns the same
  answer whether or not those bytes exist elsewhere.  Otherwise the cache would
  become a cross-domain oracle for "does project X use bundle Y".

* **Historical bytes are immutable.**  A new bundle revision is a new content
  digest and a new object.  Nothing ever rewrites an object that a historical
  run's evidence still cites.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any, Iterable, Mapping

from .approval import namespace_key
from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    file_lock,
    fsync_directory,
    iso_now,
    load_json,
    safe_relative_path,
    sha256_bytes,
    sha256_file,
    sha256_json,
    validate_id,
)

BUNDLE_MANIFEST_SCHEMA_VERSION = "1.0"

BUNDLE_KIND_INTERNAL_CAO = "INTERNAL_CAO"
BUNDLE_KIND_EXTERNAL_ENGINEERING = "EXTERNAL_ENGINEERING"
BUNDLE_KIND_SECURITY_PACK = "SECURITY_PACK"
BUNDLE_KINDS = (
    BUNDLE_KIND_INTERNAL_CAO,
    BUNDLE_KIND_EXTERNAL_ENGINEERING,
    BUNDLE_KIND_SECURITY_PACK,
)

QUALIFICATION_STATES = ("DECLARED", "OBSERVED", "QUALIFIED", "REJECTED")

#: Constraint classes an external bundle may never assert.  These are the
#: controls that make CAO's guarantees true; a skill that could relax them
#: could relax anything.
FORBIDDEN_OVERRIDE_CLASSES = (
    "authority",
    "scope",
    "ownership",
    "idempotency",
    "validation",
    "budget",
    "recovery",
    "worktree",
    "operator_only",
    "approval_policy",
)


class SkillIntegrityError(ContractError):
    """Raised when sealed content is missing, mismatched or unreadable."""


class SkillCacheIsolationError(PolicyError):
    """Raised when a namespace reaches for content it was never bound to."""


def new_bundle_manifest(
    *,
    bundle_id: str,
    bundle_kind: str,
    source_owner: str,
    source_repository_or_distribution: str,
    source_revision: str,
    version: str,
    file_manifest: Iterable[Mapping[str, Any]],
    skill_ids: Iterable[str],
    license_id: str,
    license_text_digest: str,
    provenance_record: Mapping[str, Any],
    compatibility: Mapping[str, Any] | None = None,
    dependencies: Iterable[str] = (),
    conflicts: Iterable[str] = (),
    forbidden_override_classes: Iterable[str] = FORBIDDEN_OVERRIDE_CLASSES,
    qualification_state: str = "DECLARED",
    qualification_evidence_refs: Iterable[Mapping[str, Any]] = (),
    acquired_at: str | None = None,
    cache_artifact_ref: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """Build one pinned canonical bundle manifest.

    ``content_digest`` is derived from the complete file manifest rather than
    supplied, so a manifest cannot claim a digest that its own file list does
    not produce.
    """

    validate_id(bundle_id, "bundle_id")
    if bundle_kind not in BUNDLE_KINDS:
        raise ContractError(f"unknown bundle kind: {bundle_kind!r}")
    if qualification_state not in QUALIFICATION_STATES:
        raise ContractError(f"unknown qualification state: {qualification_state!r}")

    files: list[dict[str, Any]] = []
    for entry in file_manifest:
        relative_path = safe_relative_path(str(entry.get("relative_path") or ""))
        digest = str(entry.get("content_digest") or "")
        if len(digest) != 64 or not all(c in "0123456789abcdef" for c in digest):
            raise ContractError(
                f"file manifest entry {relative_path!r} needs a lowercase sha256 digest"
            )
        byte_count = int(entry.get("byte_count", 0))
        if byte_count < 0:
            raise ContractError(f"file manifest entry {relative_path!r} has a negative size")
        files.append(
            {
                "relative_path": relative_path,
                "content_digest": digest,
                "byte_count": byte_count,
            }
        )
    if not files:
        raise ContractError("a bundle manifest must list at least one file")
    seen = {entry["relative_path"] for entry in files}
    if len(seen) != len(files):
        raise ContractError("bundle file manifest contains duplicate relative paths")
    files.sort(key=lambda entry: entry["relative_path"])

    manifest = {
        "schema_version": BUNDLE_MANIFEST_SCHEMA_VERSION,
        "bundle_id": bundle_id,
        "bundle_kind": bundle_kind,
        "source_owner": source_owner,
        "source_repository_or_distribution": source_repository_or_distribution,
        "source_revision": source_revision,
        "version": version,
        "content_digest_algorithm": "sha256",
        "content_digest": sha256_json(files),
        "file_manifest": files,
        "skill_ids": sorted({str(s) for s in skill_ids}),
        "license_id": license_id,
        "license_text_digest": license_text_digest,
        "provenance_record": dict(provenance_record),
        "acquired_at": acquired_at or iso_now(),
        "compatibility": dict(compatibility or {}),
        "dependencies": sorted({str(d) for d in dependencies}),
        "conflicts": sorted({str(c) for c in conflicts}),
        "forbidden_override_classes": sorted({str(c) for c in forbidden_override_classes}),
        "cache_artifact_ref": dict(cache_artifact_ref or {}),
        "qualification_state": qualification_state,
        "qualification_evidence_refs": [dict(r) for r in qualification_evidence_refs],
        "total_byte_count": sum(entry["byte_count"] for entry in files),
    }
    if not manifest["skill_ids"]:
        raise ContractError("a bundle manifest must declare at least one skill id")
    manifest["manifest_digest"] = sha256_json(
        {k: v for k, v in manifest.items() if k != "manifest_digest"}
    )
    return manifest


def validate_bundle_manifest(manifest: Mapping[str, Any]) -> dict[str, Any]:
    """Reject a manifest that was altered or that misstates its own content."""

    if manifest.get("schema_version") != BUNDLE_MANIFEST_SCHEMA_VERSION:
        raise ContractError(
            f"unsupported bundle manifest schema: {manifest.get('schema_version')!r}"
        )
    expected_manifest_digest = sha256_json(
        {k: v for k, v in manifest.items() if k != "manifest_digest"}
    )
    if manifest.get("manifest_digest") != expected_manifest_digest:
        raise SkillIntegrityError(
            f"bundle manifest digest mismatch for {manifest.get('bundle_id')!r}: "
            "the manifest was altered after it was pinned"
        )
    expected_content_digest = sha256_json(manifest.get("file_manifest") or [])
    if manifest.get("content_digest") != expected_content_digest:
        raise SkillIntegrityError(
            f"bundle {manifest.get('bundle_id')!r} content digest does not match its file "
            f"manifest: declared={manifest.get('content_digest')} "
            f"derived={expected_content_digest}"
        )
    return dict(manifest)


class SealedSkillCache:
    """Content-addressed store of canonical skill bytes with per-namespace binding."""

    def __init__(self, root: str | Path):
        self.root = Path(root) / "skill-cache"
        self.objects_dir = self.root / "objects"
        self.manifests_dir = self.root / "manifests"
        self.namespaces_dir = self.root / "ns"
        self.lock_path = self.root / ".skill-cache.lock"
        for directory in (self.objects_dir, self.manifests_dir, self.namespaces_dir):
            directory.mkdir(parents=True, exist_ok=True, mode=0o700)

    # -- object storage ----------------------------------------------------

    def _object_path(self, content_digest: str) -> Path:
        if len(content_digest) != 64:
            raise ContractError(f"invalid content digest: {content_digest!r}")
        return self.objects_dir / content_digest[:2] / content_digest

    def put_object(self, data: bytes) -> str:
        """Store one file's bytes and return its digest.

        Writing an object that already exists is a no-op rather than a rewrite,
        which is what keeps historical bytes immutable under concurrent imports.
        """

        if not isinstance(data, (bytes, bytearray)):
            raise ContractError("skill content must be bytes")
        data = bytes(data)
        digest = sha256_bytes(data)
        path = self._object_path(digest)
        if path.exists():
            return digest
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{digest}.", dir=str(path.parent))
        tmp = Path(tmp_name)
        try:
            os.fchmod(fd, 0o400)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(tmp, path)
            fsync_directory(path.parent)
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)
        return digest

    # -- import ------------------------------------------------------------

    def seal_bundle(
        self,
        manifest: Mapping[str, Any],
        contents: Mapping[str, bytes],
    ) -> dict[str, Any]:
        """Import a pinned bundle after proving every file matches its manifest.

        This is the operator-controlled, build-time import path.  There is no
        worker-reachable entry point into it, which is what keeps the canonical
        stack fixed rather than becoming a marketplace.
        """

        validate_bundle_manifest(manifest)
        declared = {entry["relative_path"]: entry for entry in manifest["file_manifest"]}
        supplied = {safe_relative_path(k): v for k, v in contents.items()}

        missing = sorted(set(declared) - set(supplied))
        if missing:
            raise SkillIntegrityError(
                f"bundle {manifest['bundle_id']!r} is missing required skill bytes: {missing}"
            )
        extra = sorted(set(supplied) - set(declared))
        if extra:
            raise SkillIntegrityError(
                f"bundle {manifest['bundle_id']!r} supplied files absent from its manifest: {extra}"
            )

        for relative_path, entry in sorted(declared.items()):
            data = supplied[relative_path]
            digest = sha256_bytes(data)
            if digest != entry["content_digest"]:
                raise SkillIntegrityError(
                    f"bundle {manifest['bundle_id']!r} file {relative_path!r} digest mismatch: "
                    f"manifest={entry['content_digest']} actual={digest}"
                )
            if len(data) != entry["byte_count"]:
                raise SkillIntegrityError(
                    f"bundle {manifest['bundle_id']!r} file {relative_path!r} size mismatch: "
                    f"manifest={entry['byte_count']} actual={len(data)}"
                )

        with file_lock(self.lock_path):
            manifest_path = self.manifests_dir / f"{manifest['bundle_id']}.json"
            if manifest_path.exists():
                existing = load_json(manifest_path)
                if existing.get("content_digest") != manifest.get("content_digest"):
                    raise PolicyError(
                        f"bundle {manifest['bundle_id']!r} is already sealed with a different "
                        "content digest; a new revision requires a new bundle id"
                    )
                return existing
            for relative_path in sorted(declared):
                self.put_object(supplied[relative_path])
            atomic_write_json(manifest_path, dict(manifest), mode=0o400)
            return dict(manifest)

    def load_manifest(self, bundle_id: str) -> dict[str, Any] | None:
        validate_id(bundle_id, "bundle_id")
        path = self.manifests_dir / f"{bundle_id}.json"
        return load_json(path) if path.exists() else None

    # -- namespace binding -------------------------------------------------

    def _namespace_dir(self, *, project_id: str, security_domain_id: str) -> Path:
        key = namespace_key(project_id=project_id, security_domain_id=security_domain_id)
        return self.namespaces_dir / key

    def bind_bundle(
        self, *, bundle_id: str, project_id: str, security_domain_id: str
    ) -> dict[str, Any]:
        """Make a sealed bundle resolvable inside exactly one namespace."""

        manifest = self.load_manifest(bundle_id)
        if manifest is None:
            raise SkillIntegrityError(f"bundle {bundle_id!r} is not sealed in this cache")
        directory = self._namespace_dir(
            project_id=project_id, security_domain_id=security_domain_id
        )
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        binding = {
            "bundle_id": bundle_id,
            "project_id": project_id,
            "security_domain_id": security_domain_id,
            "namespace_key": namespace_key(
                project_id=project_id, security_domain_id=security_domain_id
            ),
            "content_digest": manifest["content_digest"],
            "manifest_digest": manifest["manifest_digest"],
            "bound_at": iso_now(),
        }
        atomic_write_json(directory / f"{bundle_id}.json", binding)
        return binding

    def resolve(
        self, *, bundle_id: str, project_id: str, security_domain_id: str
    ) -> dict[str, Any]:
        """Resolve a bundle inside one namespace, proving every byte.

        An unbound bundle produces the same error whether or not its bytes exist
        in the shared object store, so this method cannot be used to probe what
        another project has cached.
        """

        directory = self._namespace_dir(
            project_id=project_id, security_domain_id=security_domain_id
        )
        binding_path = directory / f"{validate_id(bundle_id, 'bundle_id')}.json"
        if not binding_path.exists():
            raise SkillCacheIsolationError(
                f"bundle {bundle_id!r} is not available in project {project_id!r} / "
                f"security domain {security_domain_id!r}"
            )
        binding = load_json(binding_path)
        manifest = self.load_manifest(bundle_id)
        if manifest is None:
            raise SkillIntegrityError(f"sealed manifest for {bundle_id!r} disappeared")
        validate_bundle_manifest(manifest)
        if binding.get("content_digest") != manifest.get("content_digest"):
            raise SkillIntegrityError(
                f"bundle {bundle_id!r} binding digest disagrees with the sealed manifest"
            )

        resolved_files: list[dict[str, Any]] = []
        for entry in manifest["file_manifest"]:
            path = self._object_path(entry["content_digest"])
            if not path.exists():
                raise SkillIntegrityError(
                    f"sealed content missing for {bundle_id!r} file "
                    f"{entry['relative_path']!r} (digest {entry['content_digest']})"
                )
            actual = sha256_file(path)
            if actual != entry["content_digest"]:
                raise SkillIntegrityError(
                    f"sealed content corrupt for {bundle_id!r} file "
                    f"{entry['relative_path']!r}: expected {entry['content_digest']} "
                    f"found {actual}"
                )
            resolved_files.append({**entry, "object_path": str(path)})

        return {
            "bundle_id": bundle_id,
            "namespace_key": binding["namespace_key"],
            "manifest": manifest,
            "files": resolved_files,
            "content_digest": manifest["content_digest"],
            "resolved_at": iso_now(),
        }

    def read_file(self, *, resolved: Mapping[str, Any], relative_path: str) -> bytes:
        for entry in resolved["files"]:
            if entry["relative_path"] == relative_path:
                return Path(entry["object_path"]).read_bytes()
        raise SkillIntegrityError(
            f"file {relative_path!r} is not part of bundle {resolved['bundle_id']!r}"
        )

    # -- native mirror -----------------------------------------------------

    def verify_native_mirror(
        self,
        *,
        resolved: Mapping[str, Any],
        mirror_root: str | Path,
    ) -> dict[str, Any]:
        """Prove a native installation is byte-equivalent to the sealed content.

        A mirror that differs in any file is rejected outright rather than
        partially used, because a partially-correct skill set is exactly the
        drift this whole layer exists to make impossible.
        """

        root = Path(mirror_root)
        differences: list[dict[str, Any]] = []
        for entry in resolved["files"]:
            candidate = root / entry["relative_path"]
            if not candidate.is_file():
                differences.append(
                    {"relative_path": entry["relative_path"], "reason": "missing in mirror"}
                )
                continue
            actual = sha256_file(candidate)
            if actual != entry["content_digest"]:
                differences.append(
                    {
                        "relative_path": entry["relative_path"],
                        "reason": "digest mismatch",
                        "sealed_digest": entry["content_digest"],
                        "mirror_digest": actual,
                    }
                )
        equivalent = not differences
        return {
            "bundle_id": resolved["bundle_id"],
            "mirror_root": str(root),
            "equivalent": equivalent,
            "accepted": equivalent,
            "differences": differences,
            "reason": (
                "native mirror is byte-equivalent to sealed content"
                if equivalent
                else "native mirror rejected; sealed cache remains authoritative"
            ),
            "checked_at": iso_now(),
        }
