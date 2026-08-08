"""Gate C - owner-ledger transactional outbox and rebuildable Event projection.

These tests try to break the central claim of Slice 3: that a projected Event
can never describe a fact which did not commit to an owner ledger, and that a
committed fact can never become unprojectable.  Crashes are injected at the
real durability boundaries, projections are deleted, authoritative records are
mutated and truncated, and the projector is replayed repeatedly.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.common import ContractError, PolicyError, file_lock, read_jsonl, sha256_json
from mlgo_cao_v2.events import (
    SOURCE_OPERATION_LEDGER,
    SOURCE_RUN_STORE,
    EventProjection,
    EventProjectionGapError,
    assert_no_chain_of_thought,
    make_event_intent,
)
from mlgo_cao_v2.state_machine import RunStore

from slice3_fixtures import RUN_ID, Slice3Run


class Slice3GateCTests(unittest.TestCase):

    # -- C-01 ------------------------------------------------------------
    def test_C01_crash_after_wal_outbox_fsync_before_snapshot_keeps_committed_facts(self):
        """A crash between journal fsync and snapshot replacement loses nothing.

        The Event intent rides inside the very journal record that carries the
        state snapshot, so proving the state survived also proves the outbox
        fact survived.  They cannot diverge because they are one write.
        """

        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()

            store = run.store
            with self.assertRaises(RuntimeError):
                with file_lock(store.lock_path):
                    state = store._load_unlocked()
                    state["phases"]["phase-1"]["state"] = "ROUTING_PENDING"
                    store._commit_unlocked(
                        state,
                        {"type": "PHASE_TRANSITION", "phase_id": "phase-1",
                         "from": "CREATED", "to": "ROUTING_PENDING"},
                        fault_after_journal=True,
                    )

            # The snapshot never got replaced, but the WAL record did commit.
            records, _ = read_jsonl(store.journal_path, allow_trailing_partial=True)
            committed = records[-1]
            self.assertEqual(committed["event"]["type"], "PHASE_TRANSITION")
            self.assertEqual(len(committed["event_outbox"]), 1)
            crashed_event_id = committed["event_outbox"][0]["event_id"]

            # A restarted process repairs state from the journal ...
            restarted = Slice3Run(td)
            repaired = restarted.store.load()
            self.assertEqual(repaired["phases"]["phase-1"]["state"], "ROUTING_PENDING")
            self.assertEqual(repaired["state_version"], committed["state_version"])

            # ... and the exactly-committed outbox fact is still projectable.
            restarted.projection.project()
            ids = [e["event_id"] for e in restarted.projection.load_events()]
            self.assertIn(crashed_event_id, ids)
            self.assertEqual(ids.count(crashed_event_id), 1)

    # -- C-02 ------------------------------------------------------------
    def test_C02_crash_after_state_commit_before_projection_rebuilds_exactly_once(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.projection.project()
            before = len(run.projection.load_events())

            # Commit a fact and "crash" before the projector ever runs.
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="c02")

            # Authoritative state does not depend on the projection at all.
            restarted = Slice3Run(td)
            self.assertEqual(
                restarted.store.load()["phases"]["phase-1"]["state"], "ROUTING_PENDING"
            )

            restarted.projection.project()
            after = restarted.projection.load_events()
            self.assertEqual(len(after) - before, 1)
            self.assertEqual(after[-1]["event_type"], "run.phase_transition")

            # Re-running the projector adds nothing.
            restarted.projection.project()
            self.assertEqual(len(restarted.projection.load_events()), len(after))

    # -- C-03 ------------------------------------------------------------
    def test_C03_durable_operation_projects_once_and_process_local_success_is_not_authority(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()

            applied = {"count": 0}

            def apply():
                applied["count"] += 1
                return {"external_identity": "effect-1"}

            def verify(record):
                return {"external_identity": "effect-1"} if applied["count"] else None

            result = run.operations.execute(
                operation_id="op-c03", operation_type="test.apply",
                inputs={"k": "v"}, apply=apply, verify_existing=verify,
            )
            self.assertEqual(result["status"], "VERIFIED")

            # A brand-new process (nothing in memory) projects the durable fact.
            restarted = Slice3Run(td)
            restarted.projection.project()
            verified = [
                e for e in restarted.projection.load_events()
                if e["source"] == SOURCE_OPERATION_LEDGER
                and e["payload"].get("status") == "VERIFIED"
            ]
            self.assertEqual(len(verified), 1)
            self.assertTrue(verified[0]["payload"]["success_asserted"])
            self.assertEqual(verified[0]["payload"]["outcome_certainty"], "PROVEN")

            # Replaying the projector never duplicates the domain fact.
            restarted.projection.project()
            verified_again = [
                e for e in restarted.projection.load_events()
                if e["payload"].get("status") == "VERIFIED"
            ]
            self.assertEqual(len(verified_again), 1)
            self.assertEqual(applied["count"], 1)

    # -- C-04 ------------------------------------------------------------
    def test_C04_unknown_after_apply_projects_ambiguity_never_success(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()

            def apply():
                return {"external_identity": "maybe"}

            # The verifier can never prove the effect, so the operation is
            # ambiguous rather than successful.
            result = run.operations.execute(
                operation_id="op-c04", operation_type="test.ambiguous",
                inputs={"k": "v"}, apply=apply, verify_existing=lambda record: None,
            )
            self.assertEqual(result["status"], "UNKNOWN_AFTER_APPLY")

            run.projection.project()
            events = [
                e for e in run.projection.load_events()
                if e["source"] == SOURCE_OPERATION_LEDGER
            ]
            statuses = [e["payload"]["status"] for e in events]
            self.assertIn("UNKNOWN_AFTER_APPLY", statuses)
            self.assertNotIn("VERIFIED", statuses)

            ambiguous = [e for e in events if e["payload"]["status"] == "UNKNOWN_AFTER_APPLY"][0]
            self.assertEqual(ambiguous["payload"]["outcome_certainty"], "AMBIGUOUS")
            self.assertFalse(ambiguous["payload"]["success_asserted"])
            self.assertTrue(ambiguous["payload"]["requires_reconciliation"])

            # Nothing anywhere in the projection asserts success for this op.
            for event in events:
                if event["payload"]["operation_id"] == "op-c04":
                    self.assertFalse(
                        event["payload"]["success_asserted"] and event["payload"]["status"] != "VERIFIED"
                    )

    # -- C-05 ------------------------------------------------------------
    def test_C05_one_command_produces_multiple_linked_events_without_id_collision(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()

            run.store.record_command_facts(
                "cmd-c05",
                [
                    {"event_type": "command.accepted", "discriminator": "ACCEPTED",
                     "payload": {"status": "ACCEPTED"}},
                    {"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                     "payload": {"status": "OUTPUT"}},
                    {"event_type": "command.completed", "discriminator": "COMPLETED",
                     "payload": {"status": "COMPLETED"}, "status": "COMPLETED"},
                ],
                correlation_id="corr-c05",
            )

            run.projection.project()
            events = run.projection.events_for_command("cmd-c05")
            self.assertEqual(len(events), 3)

            ids = [e["event_id"] for e in events]
            self.assertEqual(len(set(ids)), 3, "multi-event Command produced colliding Event IDs")
            for event in events:
                self.assertEqual(event["causation_id"], "cmd-c05")
                self.assertEqual(event["correlation_id"], "corr-c05")
            self.assertEqual(
                sorted(e["discriminator"] for e in events),
                ["ACCEPTED", "COMPLETED", "OUTPUT"],
            )

            # All three facts committed in exactly one owner-ledger transaction.
            records, _ = read_jsonl(run.store.journal_path, allow_trailing_partial=True)
            self.assertEqual(len(records[-1]["event_outbox"]), 3)

            # Reusing a discriminator inside one commit is refused rather than
            # silently collapsing two distinct facts into one Event.
            with self.assertRaises(ContractError):
                run.store.record_command_facts(
                    "cmd-c05b",
                    [
                        {"event_type": "command.accepted", "discriminator": "SAME", "payload": {}},
                        {"event_type": "command.completed", "discriminator": "SAME", "payload": {}},
                    ],
                )

    # -- C-06 ------------------------------------------------------------
    def test_C06_deleting_the_projection_and_rebuilding_reproduces_it_exactly(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="c06")
            run.store.transition_phase("phase-1", "ROUTED", reason="c06")
            run.store.record_command_facts(
                "cmd-c06",
                [{"event_type": "command.completed", "discriminator": "COMPLETED",
                  "payload": {"status": "COMPLETED"}}],
            )
            run.operations.execute(
                operation_id="op-c06", operation_type="test.apply", inputs={},
                apply=lambda: {"external_identity": "e"},
                verify_existing=lambda record: {"external_identity": "e"} if record["status"] != "PREPARED" else None,
            )

            run.projection.project()
            original_digest = run.projection.canonical_stream_digest()
            original_view = run.projection.state_view()
            original_ids = sorted(e["event_id"] for e in run.projection.load_events())
            self.assertGreater(len(original_ids), 4)

            # Destroy the entire materialized read model.
            for source in (SOURCE_RUN_STORE, SOURCE_OPERATION_LEDGER):
                run.projection.stream_path(source).unlink()
            run.projection.checkpoint_path.unlink()
            self.assertEqual(run.projection.load_events(), [])

            # Authoritative state is completely unaffected by that deletion.
            self.assertEqual(run.store.load()["phases"]["phase-1"]["state"], "ROUTED")

            rebuilt = EventProjection(run.run_v2, run_id=RUN_ID)
            rebuilt.project()
            self.assertEqual(rebuilt.canonical_stream_digest(), original_digest)
            self.assertEqual(rebuilt.state_view(), original_view)
            self.assertEqual(sorted(e["event_id"] for e in rebuilt.load_events()), original_ids)

    # -- C-07 ------------------------------------------------------------
    def test_C07_mutated_projected_event_fails_closed_with_exact_evidence(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="c07")
            run.projection.project()

            path = run.projection.stream_path(SOURCE_RUN_STORE)
            lines = path.read_text(encoding="utf-8").splitlines()
            tampered = json.loads(lines[-1])
            tampered["payload"]["to"] = "COMPLETE"  # a fact that never committed
            lines[-1] = json.dumps(tampered, sort_keys=True, separators=(",", ":"))
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            with self.assertRaises(EventProjectionGapError) as ctx:
                run.projection.verify()
            message = str(ctx.exception)
            self.assertIn("digest mismatch", message)
            self.assertIn(tampered["event_id"], message)

    def test_C07b_removed_projected_event_breaks_the_chain_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="c07b")
            run.store.transition_phase("phase-1", "ROUTED", reason="c07b")
            run.projection.project()

            path = run.projection.stream_path(SOURCE_RUN_STORE)
            lines = path.read_text(encoding="utf-8").splitlines()
            self.assertGreater(len(lines), 2)
            del lines[1]  # excise a middle event
            path.write_text("\n".join(lines) + "\n", encoding="utf-8")

            with self.assertRaises(EventProjectionGapError) as ctx:
                run.projection.verify()
            self.assertIn("chain", str(ctx.exception))

    def test_C07c_truncated_authoritative_outbox_below_checkpoint_fails_closed(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.operations.execute(
                operation_id="op-c07c", operation_type="test.apply", inputs={},
                apply=lambda: {"external_identity": "e"},
                verify_existing=lambda record: {"external_identity": "e"} if record["status"] != "PREPARED" else None,
            )
            run.projection.project()
            consumed = run.projection.load_checkpoint()["cursors"][SOURCE_OPERATION_LEDGER]["op-c07c"]
            self.assertGreater(consumed, 1)

            # Rewrite authoritative history underneath a recorded cursor.
            op_path = run.operations.path("op-c07c")
            record = json.loads(op_path.read_text(encoding="utf-8"))
            record["event_outbox"] = record["event_outbox"][:1]
            op_path.write_text(json.dumps(record, indent=2, sort_keys=True), encoding="utf-8")

            with self.assertRaises(EventProjectionGapError) as ctx:
                run.projection.verify()
            message = str(ctx.exception)
            self.assertIn("truncated", message)
            self.assertIn("op-c07c", message)

    def test_C07d_projected_event_with_no_owner_intent_fails_closed(self):
        """A projected Event that no owner ledger vouches for is never accepted.

        This is the drift the whole design exists to prevent: an Event stream
        that has learned a fact the authoritative ledger never committed.
        """

        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.projection.project()

            forged = make_event_intent(
                source=SOURCE_RUN_STORE, run_id=RUN_ID, cursor_token="9999",
                event_type="run.status_transition", discriminator="FORGED",
                payload={"to": "FINALIZED"},
            )
            from mlgo_cao_v2.events import _event_from_intent  # noqa: PLC0415

            event = _event_from_intent(forged, source_cursor={"state_version": 9999})
            events = run.projection.load_events()
            chain = events[-1]["chain_digest"] if events else sha256_json([])
            event["previous_chain_digest"] = chain
            event["chain_digest"] = sha256_json([chain, event["event_digest"]])
            with run.projection.stream_path(SOURCE_RUN_STORE).open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(event, sort_keys=True, separators=(",", ":")) + "\n")

            with self.assertRaises(EventProjectionGapError) as ctx:
                run.projection.verify()
            self.assertIn("no authoritative owner-ledger intent", str(ctx.exception))

    # -- C-08 ------------------------------------------------------------
    def test_C08_duplicate_projection_replay_is_an_idempotent_no_op(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="c08")
            run.operations.execute(
                operation_id="op-c08", operation_type="test.apply", inputs={},
                apply=lambda: {"external_identity": "e"},
                verify_existing=lambda record: {"external_identity": "e"} if record["status"] != "PREPARED" else None,
            )

            first = run.projection.project()
            self.assertGreater(first["appended_total"], 0)
            digest = run.projection.canonical_stream_digest()
            count = first["checkpoint"]["event_count"]

            for _ in range(4):
                again = run.projection.project()
                self.assertEqual(again["appended_total"], 0)
                self.assertEqual(again["checkpoint"]["event_count"], count)
                self.assertEqual(run.projection.canonical_stream_digest(), digest)

            ids = [e["event_id"] for e in run.projection.load_events()]
            self.assertEqual(len(ids), len(set(ids)), "replay produced duplicate Events")

    # -- C-09 ------------------------------------------------------------
    def test_C09_event_may_only_cite_an_already_durable_hash_verified_artifact(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()

            ref = run.artifacts.put_bytes(
                b"result payload for c09", artifact_id="art-c09", run_id=RUN_ID,
                kind="provider_output", media_type="text/plain",
            )
            self.assertEqual(ref["commit_state"], "COMMITTED")
            self.assertEqual(ref["content_hash"], ref["storage_hash"])

            run.store.record_command_facts(
                "cmd-c09",
                [{"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                  "payload": {"status": "COMPLETED"}, "artifact_refs": [ref]}],
            )
            run.projection.project()
            events = run.projection.events_for_command("cmd-c09")
            self.assertEqual(len(events), 1)
            citation = events[0]["artifact_refs"][0]
            self.assertEqual(citation["artifact_id"], "art-c09")
            self.assertEqual(citation["content_hash"], ref["content_hash"])

            # The object was durable and verified before the reference committed.
            self.assertTrue(run.artifacts.verify_ref(ref)["ok"])

            # An unproven reference can never enter an authoritative fact.
            unproven = dict(ref)
            unproven["commit_state"] = "PENDING"
            with self.assertRaises(PolicyError):
                run.store.record_command_facts(
                    "cmd-c09b",
                    [{"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                      "payload": {}, "artifact_refs": [unproven]}],
                )

            # A reference whose recorded hash no longer matches durable storage
            # is refused before it can be cited.
            hash_mismatch = dict(ref)
            hash_mismatch["content_hash"] = "0" * 64
            with self.assertRaises(PolicyError):
                run.store.record_command_facts(
                    "cmd-c09d",
                    [{"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                      "payload": {}, "artifact_refs": [hash_mismatch]}],
                )

            # A tampered reference digest is refused too.
            tampered = dict(ref)
            tampered["byte_size"] = 999999
            with self.assertRaises(ContractError):
                run.store.record_command_facts(
                    "cmd-c09c",
                    [{"event_type": "command.output_recorded", "discriminator": "OUTPUT",
                      "payload": {}, "artifact_refs": [tampered]}],
                )

    # -- supporting invariants -------------------------------------------
    def test_events_never_carry_raw_chain_of_thought(self):
        with self.assertRaises(ContractError):
            assert_no_chain_of_thought({"summary": "ok", "reasoning_trace": "step 1..."})
        with self.assertRaises(ContractError):
            assert_no_chain_of_thought({"nested": [{"chain_of_thought": "..."}]})
        with self.assertRaises(ContractError):
            make_event_intent(
                source=SOURCE_RUN_STORE, run_id=RUN_ID, cursor_token="1",
                event_type="run.note", discriminator="NOTE",
                payload={"thinking": "private deliberation"},
            )
        # A normal decision payload is fine.
        make_event_intent(
            source=SOURCE_RUN_STORE, run_id=RUN_ID, cursor_token="1",
            event_type="run.note", discriminator="NOTE",
            payload={"decision": "proceed", "reason": "tests passed"},
        )

    def test_authoritative_state_never_reads_the_projection(self):
        """RunStore and OperationLedger must not import or consult the read model."""

        lib = Path(__file__).resolve().parents[1] / "lib" / "mlgo_cao_v2"
        for name in ("state_machine.py", "operations.py"):
            text = (lib / name).read_text(encoding="utf-8")
            self.assertNotIn("EventProjection", text,
                             f"{name} reads the derived Event projection")
            self.assertNotIn("load_events", text)

    def test_projection_is_not_required_for_state_to_load(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="no-projection")
            # No projection has ever been built for this run.
            self.assertFalse(run.projection.stream_path(SOURCE_RUN_STORE).exists())
            restarted = RunStore(Path(td), RUN_ID)
            self.assertEqual(restarted.load()["phases"]["phase-1"]["state"], "ROUTING_PENDING")


if __name__ == "__main__":
    unittest.main()


class Slice3ProjectionDurabilityTests(unittest.TestCase):
    """A torn projection append must not corrupt the derived stream."""

    def test_torn_projection_append_is_repaired_and_re_derived(self):
        with tempfile.TemporaryDirectory() as td:
            run = Slice3Run(td)
            run.initialize()
            run.seed_phase()
            run.store.transition_phase("phase-1", "ROUTING_PENDING", reason="torn")
            run.projection.project()

            path = run.projection.stream_path(SOURCE_RUN_STORE)
            expected = run.projection.canonical_stream_digest()
            events_before = len(run.projection.load_events())

            # Simulate a process death midway through appending a record.
            with path.open("ab") as handle:
                handle.write(b'{"event_id": "ev-partial", "sourc')

            # The next projection pass repairs the fragment and re-derives.
            run.projection.project()
            self.assertEqual(len(run.projection.load_events()), events_before)
            self.assertEqual(run.projection.canonical_stream_digest(), expected)
            self.assertNotIn(b"ev-partial", path.read_bytes())

            # And the stream is readable again from a cold start.
            restarted = Slice3Run(td)
            self.assertEqual(restarted.projection.canonical_stream_digest(), expected)
