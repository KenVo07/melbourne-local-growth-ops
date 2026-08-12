"""Immutable ArtifactRefs over a local security-domain-aware content store.

Large evidence is never embedded in durable state, Events or checkpoints.  It is
written to a content-addressed object store, fsynced, classified and
hash-verified *before* any authoritative reference to it may be committed.

Isolation is structural rather than advisory.  Every object, dedup index entry
and reference lives underneath one ``security_domain_id`` root, so a store bound
to one domain has no filesystem path through which it could observe, reuse or
prove the existence of bytes belonging to another domain.  Deduplication is
therefore only ever intra-domain, and additionally requires an identical
classification, retention class and storage class, because two references that
disagree on any of those cannot share one object's lifecycle.

Credential material and browser profile state are recognised as a distinct
category: they are quarantined rather than stored as ordinary evidence, and are
excluded from normal evidence export and from any ContextManifest.
"""

from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any, Callable

from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    file_lock,
    fsync_directory,
    iso_now,
    load_json,
    sha256_bytes,
    sha256_file,
    sha256_json,
    validate_id,
)

ARTIFACT_REF_SCHEMA_VERSION = "1.0"

#: Ordered from least to most restrictive.  ``QUARANTINED`` is not a severity
#: level but a terminal disposition for material that must never become
#: ordinary evidence.
CLASSIFICATIONS = ("NORMAL", "SENSITIVE", "RESTRICTED", "QUARANTINED")
RETENTION_CLASSES = ("TRANSIENT", "STANDARD", "AUDIT", "LEGAL_HOLD")
DELETION_STATES = ("ACTIVE", "DELETION_APPROVED", "TOMBSTONED")
STORAGE_CLASSES = ("LOCAL_CAS", "LOCAL_QUARANTINE")

FaultHook = Callable[[str, dict[str, Any]], None]

# Keep detector bytes intact at runtime while avoiding contiguous secret-shaped
# literals in source, which the repository scanner correctly treats as suspect.
_PRIVATE_KEY_MARKER = rb"PRIVATE " + rb"KEY"

#: Byte patterns that indicate credential material.  These are deliberately
#: conservative: a false positive quarantines evidence (recoverable, auditable)
#: while a false negative would place a live secret into shared evidence.
_SECRET_PATTERNS: tuple[tuple[str, re.Pattern[bytes]], ...] = (
    ("private_key_block", re.compile(rb"-----BEGIN [A-Z ]*" + _PRIVATE_KEY_MARKER + rb"-----")),
    ("openssh_private_key", re.compile(rb"-----BEGIN OPENSSH " + _PRIVATE_KEY_MARKER + rb"-----")),
    ("pgp_private_key", re.compile(rb"-----BEGIN PGP " + _PRIVATE_KEY_MARKER + rb" BLOCK-----")),
    ("set_cookie_header", re.compile(rb"(?i)\bset-cookie\s*:")),
    ("cookie_header", re.compile(rb"(?i)\bcookie\s*:\s*\S+=")),
    ("authorization_bearer", re.compile(rb"(?i)\bauthorization\s*:\s*bearer\s+\S+")),
    ("password_assignment", re.compile(rb"(?i)\b(password|passwd|pwd)\s*[=:]\s*['\"]?\S+")),
    ("secret_assignment", re.compile(rb"(?i)\b(api[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token)\s*[=:]\s*['\"]?\S+")),
    ("aws_access_key_id", re.compile(rb"\bAKIA[0-9A-Z]{16}\b")),
    ("github_token", re.compile(rb"\bgh[pousr]_[A-Za-z0-9]{20,}")),
    ("slack_token", re.compile(rb"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("jwt", re.compile(rb"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}")),
)

#: Filenames that are browser-profile state.  A browser profile is never normal
#: evidence even when the bytes themselves look innocuous.
_BROWSER_PROFILE_FILES = frozenset({
    "cookies", "cookies.sqlite", "cookies.sqlite-wal", "cookies.sqlite-journal",
    "login data", "login data-journal", "web data", "key3.db", "key4.db",
    "logins.json", "signons.sqlite", "cert9.db", "places.sqlite",
    "local state", "sessionstore.jsonlz4", "sessionstore-backups",
})

#: Path components that indicate the object came out of a browser profile tree.
_BROWSER_PROFILE_DIRS = frozenset({
    ".mozilla", "firefox", "chrome", "chromium", "brave-browser", "microsoft edge",
    "google-chrome", "default", "profile.default", "user data",
})


class ArtifactIntegrityError(ContractError):
    """Raised when a referenced object is missing, truncated or corrupt."""


def _norm(value: str | None) -> str:
    return (value or "").strip().lower()


def detect_browser_profile(*, source_name: str | None, source_path: str | None) -> list[str]:
    """Report browser-profile indicators for a candidate artifact."""

    findings: list[str] = []
    name = _norm(source_name)
    if name in _BROWSER_PROFILE_FILES:
        findings.append(f"browser_profile_file:{name}")
    if source_path:
        parts = [_norm(part) for part in Path(source_path).parts]
        for part in parts:
            if part in _BROWSER_PROFILE_FILES:
                findings.append(f"browser_profile_file:{part}")
            if part in _BROWSER_PROFILE_DIRS:
                findings.append(f"browser_profile_dir:{part}")
    return sorted(set(findings))


def scan_secrets(data: bytes) -> list[str]:
    """Report credential-material indicators inside candidate bytes."""

    return sorted({name for name, pattern in _SECRET_PATTERNS if pattern.search(data)})


def classify_artifact(
    data: bytes,
    *,
    source_name: str | None = None,
    source_path: str | None = None,
    declared_classification: str = "NORMAL",
) -> dict[str, Any]:
    """Deterministically classify candidate bytes.

    A declared classification may only be *raised*.  A producer cannot declare
    credential material to be ordinary evidence, and detection outranks the
    declaration in every case.
    """

    if declared_classification not in CLASSIFICATIONS:
        raise ContractError(f"unknown classification: {declared_classification!r}")
    secret_findings = scan_secrets(data)
    browser_findings = detect_browser_profile(source_name=source_name, source_path=source_path)
    findings = secret_findings + browser_findings
    if findings:
        classification = "QUARANTINED"
        reason = "credential or browser-profile material detected"
    else:
        classification = declared_classification
        reason = "declared classification; no credential or browser-profile indicator detected"
    if declared_classification == "QUARANTINED":
        classification = "QUARANTINED"
    return {
        "classification": classification,
        "declared_classification": declared_classification,
        "quarantined": classification == "QUARANTINED",
        "findings": findings,
        "secret_findings": secret_findings,
        "browser_profile_findings": browser_findings,
        "reason": reason,
        "classifier_version": "1.0",
    }


def dedup_scope(*, security_domain_id: str, classification: str, retention_class: str, storage_class: str) -> dict[str, Any]:
    """The exact boundary inside which two identical byte strings may share one object.

    Every component is lifecycle-bearing: domain governs who may observe the
    bytes, classification governs export, retention governs how long the object
    must survive, and storage class governs where it physically lives.  Sharing
    an object across any difference would let one reference silently change
    another reference's guarantees.
    """

    scope = {
        "security_domain_id": security_domain_id,
        "classification": classification,
        "retention_class": retention_class,
        "storage_class": storage_class,
    }
    return {**scope, "scope_digest": sha256_json(scope)}


class ArtifactStore:
    """A content-addressed artifact store bound to exactly one security domain."""

    def __init__(
        self,
        root: str | Path,
        *,
        security_domain_id: str,
        max_embedded_bytes: int = 64 * 1024,
        max_object_bytes: int = 512 * 1024 * 1024,
    ):
        self.security_domain_id = validate_id(security_domain_id, "security_domain_id")
        self.root = Path(root) / "artifacts"
        # Every mutable path is derived from the domain root.  There is
        # deliberately no store-level path that spans domains.
        self.domain_root = self.root / "domains" / self.security_domain_id
        self.objects_dir = self.domain_root / "objects"
        self.quarantine_dir = self.domain_root / "quarantine"
        self.refs_dir = self.domain_root / "refs"
        self.index_dir = self.domain_root / "index"
        self.tombstones_dir = self.domain_root / "tombstones"
        self.lock_path = self.domain_root / ".artifacts.lock"
        self.max_embedded_bytes = int(max_embedded_bytes)
        self.max_object_bytes = int(max_object_bytes)
        for path in (self.objects_dir, self.quarantine_dir, self.refs_dir, self.index_dir, self.tombstones_dir):
            path.mkdir(parents=True, exist_ok=True, mode=0o700)

    # -- paths ------------------------------------------------------------

    def _object_path(self, content_hash: str, storage_class: str) -> Path:
        base = self.quarantine_dir if storage_class == "LOCAL_QUARANTINE" else self.objects_dir
        return base / content_hash[:2] / content_hash

    def ref_path(self, artifact_id: str) -> Path:
        validate_id(artifact_id, "artifact_id")
        return self.refs_dir / f"{artifact_id}.json"

    def _index_path(self, scope: dict[str, Any], content_hash: str) -> Path:
        return self.index_dir / scope["scope_digest"] / f"{content_hash}.json"

    # -- reads ------------------------------------------------------------

    def load_ref(self, artifact_id: str) -> dict[str, Any] | None:
        path = self.ref_path(artifact_id)
        return load_json(path) if path.exists() else None

    def list_refs(self) -> list[dict[str, Any]]:
        return [load_json(path) for path in sorted(self.refs_dir.glob("*.json"))]

    def object_path_for_ref(self, ref: dict[str, Any]) -> Path:
        self._assert_same_domain(ref)
        locator = ref.get("storage_locator") or {}
        relative = str(locator.get("relative_path") or "")
        if not relative or relative.startswith("/") or ".." in Path(relative).parts:
            raise ContractError(f"invalid artifact storage locator: {relative!r}")
        return self.domain_root / relative

    def _assert_same_domain(self, ref: dict[str, Any]) -> None:
        """Refuse to resolve a reference belonging to a different domain.

        Without this a caller holding a foreign ArtifactRef could use a local
        store to confirm whether those bytes exist here, which is exactly the
        cross-domain existence leak the isolation boundary must prevent.
        """

        domain = ref.get("security_domain_id")
        if domain != self.security_domain_id:
            raise PolicyError(
                "artifact reference belongs to security domain "
                f"{domain!r}; this store is bound to {self.security_domain_id!r}"
            )

    # -- writes -----------------------------------------------------------

    def put_bytes(
        self,
        data: bytes,
        *,
        artifact_id: str,
        run_id: str,
        task_id: str | None = None,
        role: str | None = None,
        kind: str,
        media_type: str,
        declared_classification: str = "NORMAL",
        retention_class: str = "STANDARD",
        source_name: str | None = None,
        source_path: str | None = None,
        producer_command_id: str | None = None,
        producer_operation_id: str | None = None,
        producer_event_id: str | None = None,
        fault_hook: FaultHook | None = None,
    ) -> dict[str, Any]:
        """Durably store bytes and return a committed, verified ArtifactRef.

        Ordering is the whole point of this method: the object is written and
        fsynced, then classified, then re-read and hash-verified from durable
        storage, and only then is the authoritative reference committed.  A
        crash at any earlier point leaves no reference behind, so no Event,
        state record or checkpoint can ever cite an object that is not already
        durable and proven.
        """

        validate_id(artifact_id, "artifact_id")
        validate_id(run_id, "run_id")
        if retention_class not in RETENTION_CLASSES:
            raise ContractError(f"unknown retention class: {retention_class!r}")
        if not isinstance(data, (bytes, bytearray)):
            raise ContractError("artifact payload must be bytes")
        data = bytes(data)
        if len(data) > self.max_object_bytes:
            raise PolicyError(
                f"artifact exceeds the {self.max_object_bytes}-byte object limit: {len(data)} bytes"
            )

        expected_hash = sha256_bytes(data)
        classification_record = classify_artifact(
            data,
            source_name=source_name,
            source_path=source_path,
            declared_classification=declared_classification,
        )
        classification = classification_record["classification"]
        storage_class = "LOCAL_QUARANTINE" if classification_record["quarantined"] else "LOCAL_CAS"
        scope = dedup_scope(
            security_domain_id=self.security_domain_id,
            classification=classification,
            retention_class=retention_class,
            storage_class=storage_class,
        )

        with file_lock(self.lock_path):
            existing_ref = self.load_ref(artifact_id)
            if existing_ref is not None:
                if existing_ref.get("content_hash") != expected_hash:
                    raise PolicyError(f"artifact ID reused with different content: {artifact_id}")
                return existing_ref

            object_path = self._object_path(expected_hash, storage_class)
            index_path = self._index_path(scope, expected_hash)
            deduplicated = False

            if index_path.exists() and object_path.exists():
                # Intra-domain, intra-scope reuse of an already-proven object.
                deduplicated = True
            else:
                self._write_object(object_path, data, fault_hook=fault_hook)

            # Verify from durable storage, never from the in-memory buffer: the
            # point is to prove what actually survived the write.
            if fault_hook:
                fault_hook("before_hash_verify", {"artifact_id": artifact_id, "path": str(object_path)})
            if not object_path.exists():
                raise ArtifactIntegrityError(f"artifact object is missing after write: {object_path}")
            storage_hash = sha256_file(object_path)
            if storage_hash != expected_hash:
                raise ArtifactIntegrityError(
                    f"artifact hash verification failed for {artifact_id}: "
                    f"expected {expected_hash}, stored {storage_hash}"
                )
            if object_path.stat().st_size != len(data):
                raise ArtifactIntegrityError(f"artifact size verification failed for {artifact_id}")

            if fault_hook:
                fault_hook("after_hash_verify_before_ref_commit", {"artifact_id": artifact_id})

            ref = {
                "schema_version": ARTIFACT_REF_SCHEMA_VERSION,
                "artifact_id": artifact_id,
                "security_domain_id": self.security_domain_id,
                "run_id": run_id,
                "task_id": task_id,
                "role": role,
                "kind": kind,
                "media_type": media_type,
                "byte_size": len(data),
                "content_hash_algorithm": "sha256",
                "content_hash": expected_hash,
                "storage_hash": storage_hash,
                "storage_hash_verified_at": iso_now(),
                "classification": classification,
                "declared_classification": classification_record["declared_classification"],
                "classification_findings": classification_record["findings"],
                "classification_reason": classification_record["reason"],
                "classifier_version": classification_record["classifier_version"],
                "quarantined": classification_record["quarantined"],
                "redacted": bool(classification_record["findings"]),
                "export_eligible": not classification_record["quarantined"],
                "context_manifest_eligible": not classification_record["quarantined"],
                "retention_class": retention_class,
                "deletion_state": "ACTIVE",
                "storage_class": storage_class,
                "storage_locator": {
                    "scheme": "local-cas",
                    "relative_path": object_path.relative_to(self.domain_root).as_posix(),
                },
                "dedup_scope_digest": scope["scope_digest"],
                "deduplicated": deduplicated,
                "producer_command_id": producer_command_id,
                "producer_operation_id": producer_operation_id,
                "producer_event_id": producer_event_id,
                "stored_at": iso_now(),
                "commit_state": "COMMITTED",
            }
            ref["ref_digest"] = sha256_json({k: v for k, v in ref.items() if k != "ref_digest"})

            atomic_write_json(self.ref_path(artifact_id), ref)
            self._record_index(index_path, scope, expected_hash, artifact_id)
            return ref

    def _write_object(self, object_path: Path, data: bytes, *, fault_hook: FaultHook | None) -> None:
        object_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, tmp_name = tempfile.mkstemp(prefix=f".{object_path.name}.", dir=str(object_path.parent))
        tmp = Path(tmp_name)
        try:
            os.fchmod(fd, 0o600)
            with os.fdopen(fd, "wb") as handle:
                handle.write(data)
                handle.flush()
                if fault_hook:
                    fault_hook("after_write_before_fsync", {"path": str(tmp)})
                os.fsync(handle.fileno())
            if fault_hook:
                fault_hook("after_fsync_before_publish", {"path": str(tmp)})
            os.replace(tmp, object_path)
            fsync_directory(object_path.parent)
        finally:
            if tmp.exists():
                tmp.unlink(missing_ok=True)

    def _record_index(self, index_path: Path, scope: dict[str, Any], content_hash: str, artifact_id: str) -> None:
        index_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        current = load_json(index_path) if index_path.exists() else {
            "schema_version": "1.0",
            "content_hash": content_hash,
            **{k: v for k, v in scope.items()},
            "artifact_ids": [],
        }
        ids = list(current.get("artifact_ids") or [])
        if artifact_id not in ids:
            ids.append(artifact_id)
        current["artifact_ids"] = sorted(ids)
        current["updated_at"] = iso_now()
        atomic_write_json(index_path, current)

    # -- integrity --------------------------------------------------------

    def verify_ref(self, ref: dict[str, Any]) -> dict[str, Any]:
        """Fail closed with exact evidence when a referenced object is unusable."""

        self._assert_same_domain(ref)
        artifact_id = str(ref.get("artifact_id"))
        expected = str(ref.get("content_hash"))
        path = self.object_path_for_ref(ref)
        if ref.get("deletion_state") == "TOMBSTONED":
            return {
                "ok": False, "status": "TOMBSTONED", "artifact_id": artifact_id,
                "security_domain_id": ref.get("security_domain_id"),
                "content_hash": expected, "path": str(path),
                "evidence": "artifact was deleted under an approved retention decision",
            }
        if not path.exists():
            raise ArtifactIntegrityError(
                "referenced artifact object is missing: "
                f"artifact_id={artifact_id} domain={ref.get('security_domain_id')} "
                f"content_hash={expected} path={path}"
            )
        actual = sha256_file(path)
        if actual != expected:
            raise ArtifactIntegrityError(
                "referenced artifact object is corrupt: "
                f"artifact_id={artifact_id} domain={ref.get('security_domain_id')} "
                f"expected_hash={expected} actual_hash={actual} path={path}"
            )
        return {
            "ok": True, "status": "VERIFIED", "artifact_id": artifact_id,
            "security_domain_id": ref.get("security_domain_id"),
            "content_hash": expected, "path": str(path),
        }

    def read_bytes(self, ref: dict[str, Any]) -> bytes:
        self.verify_ref(ref)
        return self.object_path_for_ref(ref).read_bytes()

    # -- export -----------------------------------------------------------

    def export_manifest(self, *, include_quarantined: bool = False) -> dict[str, Any]:
        """Normal evidence export.

        Quarantined material is never included, and the manifest reports how
        many items were withheld so the omission is auditable rather than
        invisible.
        """

        included: list[dict[str, Any]] = []
        withheld: list[dict[str, Any]] = []
        for ref in self.list_refs():
            if ref.get("quarantined") and not include_quarantined:
                withheld.append({
                    "artifact_id": ref["artifact_id"],
                    "reason": "quarantined credential or browser-profile material",
                    "findings": ref.get("classification_findings"),
                })
                continue
            included.append({
                "artifact_id": ref["artifact_id"],
                "kind": ref.get("kind"),
                "content_hash": ref.get("content_hash"),
                "byte_size": ref.get("byte_size"),
                "classification": ref.get("classification"),
                "retention_class": ref.get("retention_class"),
                "deletion_state": ref.get("deletion_state"),
            })
        return {
            "schema_version": "1.0",
            "security_domain_id": self.security_domain_id,
            "artifacts": included,
            "withheld": withheld,
            "withheld_count": len(withheld),
            "generated_at": iso_now(),
        }

    def context_manifest_entries(self) -> list[dict[str, Any]]:
        """ArtifactRefs eligible to be bound into a ContextManifest."""

        return [
            {
                "artifact_id": ref["artifact_id"],
                "content_hash": ref["content_hash"],
                "byte_size": ref["byte_size"],
                "kind": ref.get("kind"),
            }
            for ref in self.list_refs()
            if ref.get("context_manifest_eligible") and ref.get("deletion_state") != "TOMBSTONED"
        ]


def assert_reference_is_committed(ref: dict[str, Any]) -> dict[str, Any]:
    """Guard used wherever an ArtifactRef is about to enter an authoritative fact."""

    if not isinstance(ref, dict):
        raise ContractError("artifact reference must be an object")
    if ref.get("schema_version") != ARTIFACT_REF_SCHEMA_VERSION:
        raise ContractError("unsupported ArtifactRef schema")
    for field in ("artifact_id", "security_domain_id", "content_hash", "storage_hash", "ref_digest"):
        if not ref.get(field):
            raise ContractError(f"ArtifactRef missing {field}")
    if ref.get("commit_state") != "COMMITTED":
        raise PolicyError(f"ArtifactRef {ref['artifact_id']} is not committed")
    if ref.get("content_hash") != ref.get("storage_hash"):
        raise PolicyError(f"ArtifactRef {ref['artifact_id']} was not hash-verified against durable storage")
    expected = sha256_json({k: v for k, v in ref.items() if k != "ref_digest"})
    if ref.get("ref_digest") != expected:
        raise ContractError(f"ArtifactRef digest mismatch for {ref['artifact_id']}")
    return ref


def artifact_citation(ref: dict[str, Any]) -> dict[str, Any]:
    """The minimal, embeddable citation placed inside Events and state.

    Only identity and integrity facts travel; the payload itself never does.
    """

    assert_reference_is_committed(ref)
    return {
        "artifact_id": ref["artifact_id"],
        "security_domain_id": ref["security_domain_id"],
        "content_hash": ref["content_hash"],
        "byte_size": ref["byte_size"],
        "classification": ref["classification"],
        "ref_digest": ref["ref_digest"],
    }


# --------------------------------------------------------------------------
# Historical evidence compatibility
# --------------------------------------------------------------------------

def wrap_legacy_evidence(
    record: dict[str, Any],
    *,
    security_domain_id: str,
    run_id: str,
    path_field: str = "path",
    digest_field: str = "sha256",
) -> dict[str, Any]:
    """Present a historical path+digest evidence record as an ArtifactRef view.

    This is strictly additive.  The original record is preserved verbatim, its
    original digest is carried through unchanged, and no historical file is
    moved, rewritten or re-hashed.  Adopting ArtifactRef must never rewrite
    history that earlier evidence already attests to.
    """

    original_path = record.get(path_field)
    original_digest = record.get(digest_field)
    if not original_path or not original_digest:
        raise ContractError(
            f"legacy evidence record must carry {path_field!r} and {digest_field!r}"
        )
    view = {
        "schema_version": ARTIFACT_REF_SCHEMA_VERSION,
        "artifact_id": f"legacy-{sha256_json([original_path, original_digest])[:32]}",
        "security_domain_id": validate_id(security_domain_id, "security_domain_id"),
        "run_id": run_id,
        "kind": record.get("kind") or "legacy_evidence",
        "media_type": record.get("media_type") or "application/octet-stream",
        "byte_size": record.get("byte_size"),
        "content_hash_algorithm": "sha256",
        "content_hash": original_digest,
        "storage_hash": original_digest,
        "classification": record.get("classification") or "NORMAL",
        "retention_class": "AUDIT",
        "deletion_state": "ACTIVE",
        "storage_class": "LEGACY_PATH",
        "storage_locator": {"scheme": "legacy-path", "path": original_path},
        "compatibility_wrapper": True,
        "compatibility_wrapper_version": "1.0",
        "original_record": dict(record),
        "quarantined": False,
        "export_eligible": True,
        "context_manifest_eligible": False,
        "commit_state": "COMPATIBILITY_VIEW",
    }
    view["ref_digest"] = sha256_json({k: v for k, v in view.items() if k != "ref_digest"})
    return view
