"""Normalized Event stream projected from authoritative owner ledgers.

The Event stream is a *derived read model*, never a source of truth.  Every
Event originates as an "event intent" that is written inside the same durable
commit as the fact it describes:

* run, state, Command and authority facts place their intent inside the same
  RunStore write-ahead journal record that carries the resulting state
  snapshot, so the fact and its intent share one fsync;
* Operation outcomes place their intent inside the same atomic OperationLedger
  record write that owns the effect truth.

That is what makes the outbox transactional.  There is no separate append-only
event log that a writer could update independently of the owner ledger, so
there is no window in which a projected Event can describe a fact that never
committed, nor a committed fact that can never be projected.

The projection may lag arbitrarily, may be deleted, and may be rebuilt from the
owner ledgers at any time.  Authoritative state never reads it.  Because event
identity is derived from the owner-ledger cursor and assigned at commit time,
a rebuild reproduces byte-identical events, and replaying a projection twice is
an idempotent no-op.

Anything that cannot be reconciled against owner truth - a missing cursor, a
truncated outbox, a mutated intent, a mutated projected event - fails closed
with exact evidence rather than being repaired by guesswork.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Iterable

from .artifacts import artifact_citation
from .common import (
    ContractError,
    append_jsonl,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    read_jsonl,
    sha256_json,
    truncate_file,
    validate_id,
)

EVENT_SCHEMA_VERSION = "1.0"
EVENT_INTENT_SCHEMA_VERSION = "1.0"
PROJECTION_CHECKPOINT_SCHEMA_VERSION = "1.0"

SOURCE_RUN_STORE = "run_store"
SOURCE_OPERATION_LEDGER = "operation_ledger"
EVENT_SOURCES = (SOURCE_RUN_STORE, SOURCE_OPERATION_LEDGER)

#: Field names that would carry raw model deliberation.  Events describe what
#: was decided and what changed, never the private reasoning that produced it.
_CHAIN_OF_THOUGHT_KEYS = frozenset({
    "chain_of_thought", "cot", "raw_reasoning", "reasoning_trace", "reasoning_content",
    "thinking", "thoughts", "scratchpad", "deliberation", "internal_monologue",
    "hidden_reasoning", "model_reasoning",
})


class EventProjectionGapError(ContractError):
    """Raised when the projection cannot be reconciled with owner-ledger truth."""


def assert_no_chain_of_thought(payload: Any, *, path: str = "payload") -> None:
    """Reject raw model deliberation anywhere inside an Event payload."""

    if isinstance(payload, dict):
        for key, value in payload.items():
            if str(key).strip().lower() in _CHAIN_OF_THOUGHT_KEYS:
                raise ContractError(
                    f"Event payload may not carry raw chain-of-thought: {path}.{key}"
                )
            assert_no_chain_of_thought(value, path=f"{path}.{key}")
    elif isinstance(payload, (list, tuple)):
        for index, value in enumerate(payload):
            assert_no_chain_of_thought(value, path=f"{path}[{index}]")


def event_id_for(*, source: str, run_id: str, cursor_token: str, discriminator: str) -> str:
    """Derive a stable Event ID from owner-ledger position.

    Identity is a function of durable owner-ledger coordinates only, so the
    same committed fact yields the same Event ID on every rebuild, and two
    Events emitted by one Command are distinguished by their discriminator
    rather than colliding on the Command ID.
    """

    if source not in EVENT_SOURCES:
        raise ContractError(f"unknown event source: {source!r}")
    digest = sha256_json([source, run_id, cursor_token, discriminator])
    return f"ev-{digest[:40]}"


def make_event_intent(
    *,
    source: str,
    run_id: str,
    cursor_token: str,
    event_type: str,
    discriminator: str,
    payload: dict[str, Any],
    causation_id: str | None = None,
    correlation_id: str | None = None,
    artifact_refs: Iterable[dict[str, Any]] | None = None,
    occurred_at: str | None = None,
) -> dict[str, Any]:
    """Build one Event intent for embedding in an owner-ledger commit."""

    validate_id(run_id, "run_id")
    if not isinstance(event_type, str) or not event_type.strip():
        raise ContractError("event_type must be a non-empty string")
    if not isinstance(discriminator, str) or not discriminator.strip():
        raise ContractError("event discriminator must be a non-empty string")
    if not isinstance(payload, dict):
        raise ContractError("event payload must be an object")
    assert_no_chain_of_thought(payload)

    # An Event may only cite an artifact whose bytes are already durable and
    # hash-verified.  ``artifact_citation`` re-proves that here, at the moment
    # the intent is built, which is inside the owner-ledger commit path.
    citations = [artifact_citation(ref) for ref in (artifact_refs or [])]

    intent = {
        "intent_schema_version": EVENT_INTENT_SCHEMA_VERSION,
        "event_id": event_id_for(
            source=source, run_id=run_id, cursor_token=cursor_token, discriminator=discriminator
        ),
        "source": source,
        "run_id": run_id,
        "cursor_token": cursor_token,
        "event_type": event_type.strip(),
        "discriminator": discriminator.strip(),
        "causation_id": causation_id,
        "correlation_id": correlation_id,
        "payload": copy.deepcopy(payload),
        "artifact_refs": citations,
        "occurred_at": occurred_at or iso_now(),
    }
    intent["intent_digest"] = sha256_json({k: v for k, v in intent.items() if k != "intent_digest"})
    return intent


def _event_from_intent(intent: dict[str, Any], *, source_cursor: dict[str, Any]) -> dict[str, Any]:
    event = {
        "schema_version": EVENT_SCHEMA_VERSION,
        "event_id": intent["event_id"],
        "source": intent["source"],
        "source_cursor": source_cursor,
        "run_id": intent["run_id"],
        "event_type": intent["event_type"],
        "discriminator": intent["discriminator"],
        "causation_id": intent.get("causation_id"),
        "correlation_id": intent.get("correlation_id"),
        "payload": copy.deepcopy(intent.get("payload") or {}),
        "artifact_refs": copy.deepcopy(intent.get("artifact_refs") or []),
        "occurred_at": intent.get("occurred_at"),
        "intent_digest": intent.get("intent_digest"),
    }
    event["event_digest"] = sha256_json({k: v for k, v in event.items() if k != "event_digest"})
    return event


def _cursor_sort_key(event: dict[str, Any]) -> tuple[Any, ...]:
    cursor = event.get("source_cursor") or {}
    if event.get("source") == SOURCE_RUN_STORE:
        return (0, int(cursor.get("state_version", 0)), str(event.get("discriminator", "")))
    return (
        1,
        str(cursor.get("operation_id", "")),
        int(cursor.get("sequence", 0)),
        str(event.get("discriminator", "")),
    )


# --------------------------------------------------------------------------
# Owner-ledger readers
# --------------------------------------------------------------------------

def run_store_intents(run_v2_dir: str | Path) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Read Event intents out of committed RunStore journal records.

    Only fully committed journal records are read.  A trailing partial record
    from an interrupted write is not a committed fact and therefore has no
    projectable intent.
    """

    journal = Path(run_v2_dir) / "journal.jsonl"
    records, _trailing = read_jsonl(journal, allow_trailing_partial=True)
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    expected_version = 1
    for record in records:
        version = int(record.get("state_version", 0))
        if version != expected_version:
            raise EventProjectionGapError(
                "RunStore journal cursor gap while projecting events: "
                f"expected state_version={expected_version}, found {version} in {journal}"
            )
        expected_version += 1
        for intent in record.get("event_outbox") or []:
            out.append((intent, {"state_version": version, "transaction_id": record.get("transaction_id")}))
    return out


def operation_ledger_intents(run_v2_dir: str | Path) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    """Read Event intents out of durable OperationLedger records."""

    operations = Path(run_v2_dir) / "operations"
    out: list[tuple[dict[str, Any], dict[str, Any]]] = []
    if not operations.is_dir():
        return out
    for path in sorted(operations.glob("*.json")):
        record = load_json(path)
        operation_id = str(record.get("operation_id") or path.stem)
        for index, intent in enumerate(record.get("event_outbox") or []):
            out.append((intent, {"operation_id": operation_id, "sequence": index}))
    return out


# --------------------------------------------------------------------------
# Projection
# --------------------------------------------------------------------------

class EventProjection:
    """A rebuildable, shadow read model over owner-ledger event intents.

    Each owner ledger gets its own append-only projected stream so that
    appending to one source never rewrites the other.  Cross-source ordering is
    a deterministic read-time sort on owner-ledger cursors, which keeps the
    canonical stream digest invariant to the order in which a projector
    happened to discover events.
    """

    def __init__(self, run_v2_dir: str | Path, *, run_id: str | None = None):
        self.run_v2_dir = Path(run_v2_dir)
        self.root = self.run_v2_dir / "events" / "projection"
        self.checkpoint_path = self.root / "checkpoint.json"
        self.lock_path = self.root / ".projection.lock"
        self.run_id = run_id
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)

    def stream_path(self, source: str) -> Path:
        if source not in EVENT_SOURCES:
            raise ContractError(f"unknown event source: {source!r}")
        return self.root / f"{source}.jsonl"

    # -- reads ------------------------------------------------------------

    def _read_stream(self, source: str) -> list[dict[str, Any]]:
        records, _trailing = read_jsonl(self.stream_path(source), allow_trailing_partial=True)
        # A torn trailing line is an incomplete projection append, not a
        # committed fact.  It is ignored here and physically removed by
        # ``_repair_stream`` before the next append.
        return records

    def _repair_stream(self, source: str) -> bool:
        """Truncate a torn trailing append before writing to the stream.

        Appending after a partial line would splice the new record onto the
        fragment and produce a malformed *complete* line, which is unreadable
        rather than merely incomplete.  The projection is derived data, so the
        fragment is simply discarded and re-derived from the owner ledger.
        """

        path = self.stream_path(source)
        if not path.exists():
            return False
        _records, trailing = read_jsonl(path, allow_trailing_partial=True)
        if trailing is None:
            return False
        truncate_file(path, trailing)
        return True

    def load_events(self) -> list[dict[str, Any]]:
        """All projected events in canonical owner-ledger cursor order."""

        events: list[dict[str, Any]] = []
        for source in EVENT_SOURCES:
            events.extend(self._read_stream(source))
        events.sort(key=_cursor_sort_key)
        return events

    def load_checkpoint(self) -> dict[str, Any]:
        if not self.checkpoint_path.exists():
            return {
                "schema_version": PROJECTION_CHECKPOINT_SCHEMA_VERSION,
                "run_id": self.run_id,
                "cursors": {SOURCE_RUN_STORE: {"state_version": 0}, SOURCE_OPERATION_LEDGER: {}},
                "event_count": 0,
                "stream_chain_digests": {},
                "canonical_stream_digest": sha256_json([]),
                "updated_at": None,
            }
        return load_json(self.checkpoint_path)

    def canonical_stream_digest(self) -> str:
        """Identity of the projected stream, invariant to discovery order.

        This is the value a rebuild must reproduce: it covers every event's
        content digest in canonical cursor order, so it changes if any event is
        added, removed, reordered by cursor, or mutated.
        """

        return sha256_json([event.get("event_digest") for event in self.load_events()])

    # -- integrity --------------------------------------------------------

    def _verify_stream(self, source: str, events: list[dict[str, Any]]) -> str:
        """Recompute per-event digests and the intra-stream chain."""

        chain = sha256_json([])
        for position, event in enumerate(events):
            stored = event.get("event_digest")
            recomputed = sha256_json({
                k: v for k, v in event.items()
                if k not in {"event_digest", "chain_digest", "previous_chain_digest", "projected_at"}
            })
            if stored != recomputed:
                raise EventProjectionGapError(
                    "projected Event digest mismatch: "
                    f"source={source} position={position} event_id={event.get('event_id')} "
                    f"stored_digest={stored} recomputed_digest={recomputed}"
                )
            if event.get("previous_chain_digest") != chain:
                raise EventProjectionGapError(
                    "projected Event chain gap: "
                    f"source={source} position={position} event_id={event.get('event_id')} "
                    f"expected_previous_chain_digest={chain} "
                    f"found={event.get('previous_chain_digest')}"
                )
            chain = sha256_json([chain, stored])
            if event.get("chain_digest") != chain:
                raise EventProjectionGapError(
                    "projected Event chain digest mismatch: "
                    f"source={source} position={position} event_id={event.get('event_id')} "
                    f"expected_chain_digest={chain} found={event.get('chain_digest')}"
                )
        return chain

    def verify(self) -> dict[str, Any]:
        """Verify the projection against owner-ledger truth and fail closed."""

        with file_lock(self.lock_path):
            return self._verify_locked()

    def _owner_intents(self) -> dict[str, list[tuple[dict[str, Any], dict[str, Any]]]]:
        return {
            SOURCE_RUN_STORE: run_store_intents(self.run_v2_dir),
            SOURCE_OPERATION_LEDGER: operation_ledger_intents(self.run_v2_dir),
        }

    def _verify_locked(self) -> dict[str, Any]:
        owner = self._owner_intents()
        checkpoint = self.load_checkpoint()

        # Owner-ledger truncation is checked first.  If authoritative history
        # moved backwards, every downstream comparison would report the
        # resulting symptom ("this projected event has no intent") rather than
        # the actual cause ("the ledger lost facts the projector already
        # consumed"), which is the fact an operator needs.
        self._verify_checkpoint_cursors(checkpoint, owner)

        report: dict[str, Any] = {"sources": {}}
        for source in EVENT_SOURCES:
            projected = self._read_stream(source)
            self._verify_stream(source, projected)

            expected_by_id = {
                intent["event_id"]: _event_from_intent(intent, source_cursor=cursor)
                for intent, cursor in owner[source]
            }
            for position, event in enumerate(projected):
                event_id = event.get("event_id")
                expected = expected_by_id.get(event_id)
                if expected is None:
                    raise EventProjectionGapError(
                        "projected Event has no authoritative owner-ledger intent: "
                        f"source={source} position={position} event_id={event_id} "
                        f"cursor={event.get('source_cursor')}"
                    )
                if expected["event_digest"] != event.get("event_digest"):
                    raise EventProjectionGapError(
                        "projected Event disagrees with its owner-ledger intent: "
                        f"source={source} event_id={event_id} "
                        f"owner_digest={expected['event_digest']} "
                        f"projected_digest={event.get('event_digest')}"
                    )
            report["sources"][source] = {
                "projected": len(projected),
                "owner_intents": len(owner[source]),
                "pending": len(owner[source]) - len(projected),
            }

        self._verify_checkpoint_cursors(checkpoint, owner)
        report["ok"] = True
        report["canonical_stream_digest"] = self.canonical_stream_digest()
        return report

    def _verify_checkpoint_cursors(
        self, checkpoint: dict[str, Any], owner: dict[str, list[tuple[dict[str, Any], dict[str, Any]]]]
    ) -> None:
        """Detect an owner ledger that moved backwards under a recorded cursor.

        A checkpoint records how far the projector consumed each authoritative
        ledger.  If the ledger now holds fewer facts than the checkpoint already
        consumed, authoritative history was truncated or rewritten underneath
        the projection, which is never a recoverable condition.
        """

        cursors = checkpoint.get("cursors") or {}
        recorded_version = int((cursors.get(SOURCE_RUN_STORE) or {}).get("state_version", 0))
        journal_versions = [
            cursor["state_version"] for _intent, cursor in owner[SOURCE_RUN_STORE]
        ]
        highest = max(journal_versions) if journal_versions else 0
        journal_records, _ = read_jsonl(self.run_v2_dir / "journal.jsonl", allow_trailing_partial=True)
        highest_committed = max(
            [int(r.get("state_version", 0)) for r in journal_records] or [0]
        )
        if recorded_version > max(highest, highest_committed):
            raise EventProjectionGapError(
                "RunStore journal truncated below the projection checkpoint: "
                f"checkpoint_state_version={recorded_version} "
                f"highest_committed_state_version={highest_committed}"
            )

        recorded_ops = (cursors.get(SOURCE_OPERATION_LEDGER) or {})
        actual_ops: dict[str, int] = {}
        for _intent, cursor in owner[SOURCE_OPERATION_LEDGER]:
            key = str(cursor["operation_id"])
            actual_ops[key] = max(actual_ops.get(key, 0), int(cursor["sequence"]) + 1)
        for operation_id, consumed in recorded_ops.items():
            available = actual_ops.get(operation_id, 0)
            if int(consumed) > available:
                raise EventProjectionGapError(
                    "OperationLedger outbox truncated below the projection checkpoint: "
                    f"operation_id={operation_id} checkpoint_sequence={consumed} "
                    f"available_intents={available}"
                )

    # -- projection -------------------------------------------------------

    def project(self) -> dict[str, Any]:
        """Append any owner-ledger intents that are not yet projected.

        Duplicate projection is a no-op: already-projected event IDs are
        skipped, so replaying this method never produces a duplicate domain
        fact and the checkpoint simply re-advances to the same position.
        """

        with file_lock(self.lock_path):
            for source in EVENT_SOURCES:
                self._repair_stream(source)
            self._verify_locked()
            owner = self._owner_intents()
            appended: dict[str, int] = {}
            chain_digests: dict[str, str] = {}
            cursors: dict[str, Any] = {SOURCE_RUN_STORE: {"state_version": 0}, SOURCE_OPERATION_LEDGER: {}}

            for source in EVENT_SOURCES:
                projected = self._read_stream(source)
                chain = self._verify_stream(source, projected)
                seen = {event.get("event_id") for event in projected}
                count = 0
                for intent, cursor in owner[source]:
                    if intent["event_id"] in seen:
                        continue
                    event = _event_from_intent(intent, source_cursor=cursor)
                    event["previous_chain_digest"] = chain
                    chain = sha256_json([chain, event["event_digest"]])
                    event["chain_digest"] = chain
                    event["projected_at"] = iso_now()
                    append_jsonl(self.stream_path(source), event)
                    seen.add(intent["event_id"])
                    count += 1
                appended[source] = count
                chain_digests[source] = chain

            for _intent, cursor in owner[SOURCE_RUN_STORE]:
                cursors[SOURCE_RUN_STORE]["state_version"] = max(
                    cursors[SOURCE_RUN_STORE]["state_version"], int(cursor["state_version"])
                )
            for _intent, cursor in owner[SOURCE_OPERATION_LEDGER]:
                key = str(cursor["operation_id"])
                cursors[SOURCE_OPERATION_LEDGER][key] = max(
                    int(cursors[SOURCE_OPERATION_LEDGER].get(key, 0)), int(cursor["sequence"]) + 1
                )

            events = self.load_events()
            checkpoint = {
                "schema_version": PROJECTION_CHECKPOINT_SCHEMA_VERSION,
                "run_id": self.run_id,
                "cursors": cursors,
                "event_count": len(events),
                "stream_chain_digests": chain_digests,
                "canonical_stream_digest": sha256_json([e.get("event_digest") for e in events]),
                "updated_at": iso_now(),
            }
            atomic_write_json(self.checkpoint_path, checkpoint)
            return {
                "appended": appended,
                "appended_total": sum(appended.values()),
                "checkpoint": checkpoint,
            }

    def rebuild(self) -> dict[str, Any]:
        """Discard the derived read model and rebuild it from owner ledgers."""

        with file_lock(self.lock_path):
            for source in EVENT_SOURCES:
                self.stream_path(source).unlink(missing_ok=True)
            self.checkpoint_path.unlink(missing_ok=True)
        return self.project()

    # -- views ------------------------------------------------------------

    def events_for_command(self, command_id: str) -> list[dict[str, Any]]:
        return [
            event for event in self.load_events()
            if event.get("causation_id") == command_id
        ]

    def state_view(self) -> dict[str, Any]:
        """A derived summary used to compare a rebuilt projection to the original."""

        events = self.load_events()
        phases: dict[str, str] = {}
        run_status: str | None = None
        commands: dict[str, str] = {}
        operations: dict[str, str] = {}
        for event in events:
            payload = event.get("payload") or {}
            kind = event.get("event_type")
            if kind == "run.phase_transition":
                phases[str(payload.get("phase_id"))] = str(payload.get("to"))
            elif kind == "run.status_transition":
                run_status = str(payload.get("to"))
            elif kind.startswith("command."):
                commands[str(event.get("causation_id"))] = str(payload.get("status"))
            elif kind.startswith("operation."):
                operations[str(payload.get("operation_id"))] = str(payload.get("status"))
        return {
            "run_status": run_status,
            "phases": dict(sorted(phases.items())),
            "commands": dict(sorted(commands.items())),
            "operations": dict(sorted(operations.items())),
            "event_count": len(events),
        }
