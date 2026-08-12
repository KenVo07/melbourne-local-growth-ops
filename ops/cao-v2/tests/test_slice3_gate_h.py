"""Gate H - ArtifactRef, retention, isolation and privacy.

These tests attack the isolation boundary directly: they store byte-identical
restricted material in two security domains and then try, through every API the
store exposes, to observe or reuse one domain's bytes from the other.  They
also crash the write path before durability is proven, corrupt objects after
the fact, and feed the classifier real-shaped credential and browser-profile
fixtures.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.artifacts import (
    ArtifactIntegrityError,
    ArtifactStore,
    artifact_citation,
    classify_artifact,
    detect_browser_profile,
    scan_secrets,
    wrap_legacy_evidence,
)
from mlgo_cao_v2.common import ContractError, PolicyError, sha256_bytes
from mlgo_cao_v2.retention import (
    apply_approved_deletion,
    create_deletion_approval,
    load_tombstone,
    retention_report,
)

from slice3_fixtures import (
    BROWSER_PROFILE_FIXTURE,
    DOMAIN_A,
    DOMAIN_B,
    RUN_ID,
    SECRET_FIXTURES,
    Slice3Run,
    large_payload,
)

LIB = Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2"


class Slice3GateHTests(unittest.TestCase):

    # -- H-01 ------------------------------------------------------------
    def test_H01_identical_normal_evidence_in_one_domain_shares_one_object(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            store = run.artifacts
            payload = b"identical normal evidence body"

            first = store.put_bytes(payload, artifact_id="art-h01-a", run_id=RUN_ID,
                                    kind="log", media_type="text/plain")
            second = store.put_bytes(payload, artifact_id="art-h01-b", run_id=RUN_ID,
                                     kind="log", media_type="text/plain")

            self.assertNotEqual(first["artifact_id"], second["artifact_id"])
            self.assertEqual(first["content_hash"], second["content_hash"])
            self.assertEqual(
                first["storage_locator"]["relative_path"],
                second["storage_locator"]["relative_path"],
            )
            self.assertFalse(first["deduplicated"])
            self.assertTrue(second["deduplicated"])

            # Exactly one stored object backs both immutable references.
            objects = [p for p in store.objects_dir.rglob("*") if p.is_file()]
            self.assertEqual(len(objects), 1)
            self.assertTrue(store.verify_ref(first)["ok"])
            self.assertTrue(store.verify_ref(second)["ok"])

            # Differing retention classes are different lifecycles, so they do
            # not share an object even inside one domain.
            third = store.put_bytes(payload, artifact_id="art-h01-c", run_id=RUN_ID,
                                    kind="log", media_type="text/plain",
                                    retention_class="LEGAL_HOLD")
            self.assertFalse(third["deduplicated"])
            self.assertNotEqual(third["dedup_scope_digest"], first["dedup_scope_digest"])

    # -- H-02 ------------------------------------------------------------
    def test_H02_identical_restricted_bytes_do_not_leak_across_security_domains(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            alpha = run.artifact_store(DOMAIN_A)
            beta = run.artifact_store(DOMAIN_B)
            payload = b"restricted customer record 42"

            a_ref = alpha.put_bytes(payload, artifact_id="art-h02", run_id=RUN_ID,
                                    kind="record", media_type="application/json",
                                    declared_classification="RESTRICTED")
            b_ref = beta.put_bytes(payload, artifact_id="art-h02", run_id=RUN_ID,
                                   kind="record", media_type="application/json",
                                   declared_classification="RESTRICTED")

            # No dedup occurred across the boundary: each domain stored its own
            # object under its own root.
            self.assertFalse(a_ref["deduplicated"])
            self.assertFalse(b_ref["deduplicated"])
            self.assertNotEqual(a_ref["security_domain_id"], b_ref["security_domain_id"])
            self.assertNotEqual(a_ref["dedup_scope_digest"], b_ref["dedup_scope_digest"])
            self.assertNotEqual(
                alpha.object_path_for_ref(a_ref), beta.object_path_for_ref(b_ref)
            )
            self.assertTrue(alpha.domain_root != beta.domain_root)

            # Neither store can resolve, verify or read the other's reference,
            # so neither can prove those bytes exist over there.
            for store, foreign in ((alpha, b_ref), (beta, a_ref)):
                with self.assertRaises(PolicyError):
                    store.verify_ref(foreign)
                with self.assertRaises(PolicyError):
                    store.object_path_for_ref(foreign)
                with self.assertRaises(PolicyError):
                    store.read_bytes(foreign)

            # A store never lists or exports anything from another domain.
            self.assertEqual([r["security_domain_id"] for r in alpha.list_refs()], [DOMAIN_A])
            self.assertEqual([r["security_domain_id"] for r in beta.list_refs()], [DOMAIN_B])
            self.assertEqual(alpha.export_manifest()["security_domain_id"], DOMAIN_A)

            # The dedup index itself is domain-scoped, so an existence probe by
            # content hash cannot cross the boundary either.
            a_index = [p for p in alpha.index_dir.rglob("*.json")]
            self.assertTrue(a_index)
            for path in a_index:
                self.assertIn(DOMAIN_A, str(path))
                self.assertEqual(json.loads(path.read_text())["security_domain_id"], DOMAIN_A)
            self.assertFalse(any(DOMAIN_B in str(p) for p in a_index))

    def test_H02b_a_third_domain_storing_the_same_bytes_gains_nothing(self):
        """Adding a domain must not reveal that the bytes already exist elsewhere."""

        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            payload = b"restricted shared secret body"
            run.artifact_store(DOMAIN_A).put_bytes(
                payload, artifact_id="art-seed", run_id=RUN_ID, kind="record",
                media_type="text/plain", declared_classification="RESTRICTED")
            gamma = run.artifact_store("domain-gamma")
            ref = gamma.put_bytes(payload, artifact_id="art-seed", run_id=RUN_ID,
                                  kind="record", media_type="text/plain",
                                  declared_classification="RESTRICTED")
            self.assertFalse(ref["deduplicated"],
                             "a new domain observed that identical bytes already existed")

    # -- H-03 ------------------------------------------------------------
    def test_H03_credential_and_browser_profile_fixtures_are_quarantined_and_withheld(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            store = run.artifacts

            private_key_header = b"-----BEGIN OPENSSH PRIVATE " + b"KEY-----\n"
            aws_identifier = b"AKIAIOSFODNN7EX" + b"AMPLE"
            self.assertTrue(SECRET_FIXTURES["private_key"].startswith(private_key_header))
            self.assertEqual(
                SECRET_FIXTURES["aws_key"],
                b"AWS_ACCESS_KEY_ID=" + aws_identifier + b"\n",
            )

            detector_cases = {
                b"-----BEGIN RSA PRIVATE " + b"KEY-----": {"private_key_block"},
                private_key_header.rstrip(b"\n"): {
                    "private_key_block",
                    "openssh_private_key",
                },
                b"-----BEGIN PGP PRIVATE " + b"KEY BLOCK-----": {"pgp_private_key"},
            }
            for payload, expected_findings in detector_cases.items():
                self.assertEqual(set(scan_secrets(payload)), expected_findings)

            quarantined_ids = []
            for name, payload in SECRET_FIXTURES.items():
                self.assertTrue(scan_secrets(payload), f"secret fixture not detected: {name}")
                ref = store.put_bytes(payload, artifact_id=f"art-{name}", run_id=RUN_ID,
                                      kind="captured_output", media_type="text/plain")
                self.assertEqual(ref["classification"], "QUARANTINED", name)
                self.assertTrue(ref["quarantined"], name)
                self.assertFalse(ref["export_eligible"], name)
                self.assertFalse(ref["context_manifest_eligible"], name)
                self.assertEqual(ref["storage_class"], "LOCAL_QUARANTINE", name)
                self.assertTrue(ref["classification_findings"], name)
                quarantined_ids.append(ref["artifact_id"])

            # A browser profile file is quarantined on provenance even though
            # its own bytes look harmless.
            body, filename, path = BROWSER_PROFILE_FIXTURE
            self.assertFalse(scan_secrets(body))
            self.assertTrue(detect_browser_profile(source_name=filename, source_path=path))
            profile_ref = store.put_bytes(body, artifact_id="art-browser-profile", run_id=RUN_ID,
                                          kind="browser_state", media_type="application/octet-stream",
                                          source_name=filename, source_path=path)
            self.assertEqual(profile_ref["classification"], "QUARANTINED")
            quarantined_ids.append(profile_ref["artifact_id"])

            # Normal evidence alongside it is unaffected.
            ok_ref = store.put_bytes(b"ordinary build log", artifact_id="art-ok", run_id=RUN_ID,
                                     kind="log", media_type="text/plain")
            self.assertEqual(ok_ref["classification"], "NORMAL")

            manifest = store.export_manifest()
            exported = {item["artifact_id"] for item in manifest["artifacts"]}
            self.assertEqual(exported, {"art-ok"})
            self.assertEqual(manifest["withheld_count"], len(quarantined_ids))
            for artifact_id in quarantined_ids:
                self.assertNotIn(artifact_id, exported)

            context_ids = {item["artifact_id"] for item in store.context_manifest_entries()}
            self.assertEqual(context_ids, {"art-ok"})

            # Quarantined bytes never appear in the export payload at all.
            rendered = json.dumps(manifest)
            self.assertNotIn("hunter2superSecret", rendered)
            self.assertNotIn(aws_identifier.decode("ascii"), rendered)

            # A producer cannot declare credential material to be normal.
            forced = classify_artifact(SECRET_FIXTURES["private_key"],
                                       declared_classification="NORMAL")
            self.assertEqual(forced["classification"], "QUARANTINED")

    # -- H-04 ------------------------------------------------------------
    def test_H04_crash_before_durability_commits_no_reference(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            store = run.artifacts
            payload = b"payload that must never be referenced"

            def crash_before_fsync(stage, context):
                if stage == "after_write_before_fsync":
                    raise RuntimeError("injected crash before fsync")

            with self.assertRaises(RuntimeError):
                store.put_bytes(payload, artifact_id="art-h04a", run_id=RUN_ID,
                                kind="log", media_type="text/plain",
                                fault_hook=crash_before_fsync)

            self.assertIsNone(store.load_ref("art-h04a"))
            self.assertFalse(store.ref_path("art-h04a").exists())

            def vanish_before_verify(stage, context):
                if stage == "before_hash_verify":
                    Path(context["path"]).unlink(missing_ok=True)

            with self.assertRaises(ArtifactIntegrityError):
                store.put_bytes(payload, artifact_id="art-h04b", run_id=RUN_ID,
                                kind="log", media_type="text/plain",
                                fault_hook=vanish_before_verify)
            self.assertIsNone(store.load_ref("art-h04b"))

            def crash_after_verify(stage, context):
                if stage == "after_hash_verify_before_ref_commit":
                    raise RuntimeError("injected crash before reference commit")

            with self.assertRaises(RuntimeError):
                store.put_bytes(payload, artifact_id="art-h04c", run_id=RUN_ID,
                                kind="log", media_type="text/plain",
                                fault_hook=crash_after_verify)
            self.assertIsNone(store.load_ref("art-h04c"))

            # No state, Event or checkpoint can cite what was never committed.
            run.initialize()
            with self.assertRaises(ContractError):
                run.store.record_command_facts(
                    "cmd-h04",
                    [{"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                      "payload": {}, "artifact_refs": [{"artifact_id": "art-h04a"}]}],
                )
            # No temporary write leaked into the published object tree.
            leftovers = [p.name for p in store.objects_dir.rglob("*") if p.is_file()]
            self.assertTrue(all(not name.startswith(".") for name in leftovers))

    # -- H-05 ------------------------------------------------------------
    def test_H05_corrupt_or_missing_blob_fails_closed_with_exact_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            store = run.artifacts
            payload = b"evidence that will be corrupted"
            ref = store.put_bytes(payload, artifact_id="art-h05", run_id=RUN_ID,
                                  kind="log", media_type="text/plain")
            self.assertTrue(store.verify_ref(ref)["ok"])

            # Corrupt the object in place.
            path = store.object_path_for_ref(ref)
            path.write_bytes(b"corrupted content of the same length!!")
            with self.assertRaises(ArtifactIntegrityError) as ctx:
                store.verify_ref(ref)
            message = str(ctx.exception)
            self.assertIn("corrupt", message)
            self.assertIn("art-h05", message)
            self.assertIn(ref["content_hash"], message)
            self.assertIn(sha256_bytes(b"corrupted content of the same length!!"), message)

            with self.assertRaises(ArtifactIntegrityError):
                store.read_bytes(ref)

            # Delete it entirely.
            path.unlink()
            with self.assertRaises(ArtifactIntegrityError) as ctx:
                store.verify_ref(ref)
            message = str(ctx.exception)
            self.assertIn("missing", message)
            self.assertIn("art-h05", message)
            self.assertIn(DOMAIN_A, message)

    # -- H-06 ------------------------------------------------------------
    def test_H06_large_output_is_stored_by_reference_and_never_embedded(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            store = run.artifacts
            payload = large_payload(3 * 1024 * 1024)

            ref = store.put_bytes(payload, artifact_id="art-h06", run_id=RUN_ID,
                                  kind="provider_output", media_type="text/plain")
            self.assertEqual(ref["byte_size"], len(payload))

            citation = artifact_citation(ref)
            # The citation is identity and integrity only - orders of magnitude
            # smaller than the payload it stands for.
            self.assertLess(len(json.dumps(citation)), 1024)

            run.store.record_command_facts(
                "cmd-h06",
                [{"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                  "payload": {"status": "COMPLETED"}, "artifact_refs": [ref]}],
            )
            run.projection.project()

            journal_bytes = run.store.journal_path.stat().st_size
            state_bytes = run.store.state_path.stat().st_size
            stream_bytes = run.projection.stream_path("run_store").stat().st_size
            for size, label in ((journal_bytes, "journal"), (state_bytes, "state"),
                                (stream_bytes, "event stream")):
                self.assertLess(size, len(payload) // 10,
                                f"{label} appears to embed the large payload")

            # The payload bytes themselves are absent from every durable record.
            marker = b"MLGO-SLICE3-LARGE-OUTPUT-BLOCK-" * 100
            self.assertNotIn(marker, run.store.journal_path.read_bytes())
            self.assertNotIn(marker, run.store.state_path.read_bytes())
            self.assertNotIn(marker, run.projection.stream_path("run_store").read_bytes())

            # The size limit is a real limit.
            small = ArtifactStore(run.run_v2, security_domain_id="domain-small",
                                  max_object_bytes=1024)
            with self.assertRaises(PolicyError):
                small.put_bytes(payload, artifact_id="art-too-big", run_id=RUN_ID,
                                kind="provider_output", media_type="text/plain")

    # -- H-07 ------------------------------------------------------------
    def test_H07_approved_deletion_tombstones_and_preserves_reference_history(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            store = run.artifacts
            ref = store.put_bytes(b"deletable evidence", artifact_id="art-h07", run_id=RUN_ID,
                                  kind="log", media_type="text/plain")
            object_path = store.object_path_for_ref(ref)
            self.assertTrue(object_path.exists())

            # Deletion is impossible without an explicit approval record.
            with self.assertRaises(PolicyError):
                apply_approved_deletion(store, artifact_id="art-h07",
                                        approval={"schema_version": "1.0",
                                                  "action": "APPROVE_ARTIFACT_DELETION",
                                                  "approved": False})

            approval = create_deletion_approval(
                approval_id="approval-h07", artifact_id="art-h07",
                security_domain_id=store.security_domain_id,
                operator_identity="operator@example.invalid",
                reason="retention window elapsed",
            )
            result = apply_approved_deletion(store, artifact_id="art-h07", approval=approval)
            self.assertFalse(object_path.exists())
            self.assertTrue(result["tombstone"]["bytes_removed"])

            # Reference truth survives: digest, size and producer linkage remain.
            updated = store.load_ref("art-h07")
            self.assertEqual(updated["deletion_state"], "TOMBSTONED")
            self.assertEqual(updated["content_hash"], ref["content_hash"])
            self.assertEqual(updated["byte_size"], ref["byte_size"])
            self.assertFalse(updated["export_eligible"])

            tombstone = load_tombstone(store, "art-h07")
            self.assertEqual(tombstone["approval_id"], "approval-h07")
            self.assertEqual(tombstone["operator_identity"], "operator@example.invalid")
            self.assertEqual(tombstone["original_ref_digest"], ref["ref_digest"])

            # Reads now fail with an explanation, not a bare missing file.
            verdict = store.verify_ref(updated)
            self.assertFalse(verdict["ok"])
            self.assertEqual(verdict["status"], "TOMBSTONED")
            self.assertIn("approved", verdict["evidence"])

            # Deletion is idempotent and protected classes need an override.
            self.assertTrue(
                apply_approved_deletion(store, artifact_id="art-h07", approval=approval)["duplicate"]
            )
            audit = store.put_bytes(b"audit evidence", artifact_id="art-h07-audit",
                                    run_id=RUN_ID, kind="log", media_type="text/plain",
                                    retention_class="AUDIT")
            audit_approval = create_deletion_approval(
                approval_id="approval-h07-audit", artifact_id="art-h07-audit",
                security_domain_id=store.security_domain_id,
                operator_identity="operator@example.invalid", reason="mistake",
            )
            with self.assertRaises(PolicyError):
                apply_approved_deletion(store, artifact_id="art-h07-audit", approval=audit_approval)
            self.assertTrue(store.object_path_for_ref(audit).exists())

            report = retention_report(store)
            self.assertFalse(report["autonomous_gc_enabled"])
            self.assertTrue(report["deletion_requires_operator_approval"])
            self.assertIn("art-h07", report["tombstoned"])

    def test_H07b_no_autonomous_garbage_collection_exists_anywhere(self):
        """There must be no sweeper that can delete artifacts on its own."""

        for path in sorted(LIB.glob("*.py")):
            text = path.read_text(encoding="utf-8")
            for token in ("def garbage_collect", "def gc_", "def sweep_artifacts",
                          "def prune_artifacts", "def auto_delete"):
                self.assertNotIn(token, text, f"autonomous GC entry point in {path.name}: {token}")

        # The only deletion path requires a validated approval argument.
        retention_src = (LIB / "retention.py").read_text(encoding="utf-8")
        self.assertIn("validate_deletion_approval(approval)", retention_src)

    def test_H07c_deletion_never_destroys_bytes_another_live_reference_shares(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            store = run.artifacts
            payload = b"shared object body"
            first = store.put_bytes(payload, artifact_id="art-share-a", run_id=RUN_ID,
                                    kind="log", media_type="text/plain")
            second = store.put_bytes(payload, artifact_id="art-share-b", run_id=RUN_ID,
                                     kind="log", media_type="text/plain")
            self.assertTrue(second["deduplicated"])

            approval = create_deletion_approval(
                approval_id="approval-share", artifact_id="art-share-a",
                security_domain_id=store.security_domain_id,
                operator_identity="operator@example.invalid", reason="one reference retired",
            )
            result = apply_approved_deletion(store, artifact_id="art-share-a", approval=approval)
            self.assertFalse(result["tombstone"]["bytes_removed"])
            self.assertEqual(result["tombstone"]["object_shared_with"], ["art-share-b"])
            # The surviving reference is still fully readable.
            self.assertEqual(store.read_bytes(store.load_ref("art-share-b")), payload)

    # -- H-08 ------------------------------------------------------------
    def test_H08_historical_evidence_is_wrapped_without_destructive_migration(self):
        with tempfile.TemporaryDirectory() as td:
            historical = Path(td) / "legacy-evidence.txt"
            body = b"historical validation output\n"
            historical.write_bytes(body)
            original_digest = sha256_bytes(body)
            original_stat = historical.stat()

            record = {
                "path": str(historical),
                "sha256": original_digest,
                "kind": "validation_log",
                "recorded_at": "2026-01-01T00:00:00Z",
            }
            view = wrap_legacy_evidence(record, security_domain_id=DOMAIN_A, run_id=RUN_ID)

            # The original digest and record are carried through untouched.
            self.assertEqual(view["content_hash"], original_digest)
            self.assertEqual(view["original_record"], record)
            self.assertTrue(view["compatibility_wrapper"])
            self.assertEqual(view["storage_locator"]["path"], str(historical))

            # Nothing about the historical file changed.
            self.assertTrue(historical.exists())
            self.assertEqual(historical.read_bytes(), body)
            self.assertEqual(historical.stat().st_mtime_ns, original_stat.st_mtime_ns)

            # A compatibility view is explicitly not a committed CAS reference,
            # so it can never be cited as one.
            self.assertEqual(view["commit_state"], "COMPATIBILITY_VIEW")
            with self.assertRaises(PolicyError):
                artifact_citation(view)
            self.assertFalse(view["context_manifest_eligible"])

            with self.assertRaises(ContractError):
                wrap_legacy_evidence({"path": str(historical)},
                                     security_domain_id=DOMAIN_A, run_id=RUN_ID)

    # -- supporting invariants -------------------------------------------
    def test_artifact_id_reuse_with_different_content_is_refused(self):
        with tempfile.TemporaryDirectory() as td:
            store = Slice3Run(td).artifacts
            store.put_bytes(b"first", artifact_id="art-reuse", run_id=RUN_ID,
                            kind="log", media_type="text/plain")
            same = store.put_bytes(b"first", artifact_id="art-reuse", run_id=RUN_ID,
                                   kind="log", media_type="text/plain")
            self.assertEqual(same["artifact_id"], "art-reuse")
            with self.assertRaises(PolicyError):
                store.put_bytes(b"second", artifact_id="art-reuse", run_id=RUN_ID,
                                kind="log", media_type="text/plain")

    def test_reference_digest_covers_every_lifecycle_field(self):
        with tempfile.TemporaryDirectory() as td:
            store = Slice3Run(td).artifacts
            ref = store.put_bytes(b"digest coverage", artifact_id="art-digest", run_id=RUN_ID,
                                  kind="log", media_type="text/plain")
            for field in ("classification", "retention_class", "deletion_state",
                          "security_domain_id", "export_eligible"):
                tampered = dict(ref)
                tampered[field] = "TAMPERED" if isinstance(ref[field], str) else not ref[field]
                with self.assertRaises(ContractError, msg=f"{field} is outside the ref digest"):
                    artifact_citation(tampered)


if __name__ == "__main__":
    unittest.main()
