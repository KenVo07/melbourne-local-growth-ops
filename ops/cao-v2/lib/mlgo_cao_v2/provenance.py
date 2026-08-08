"""Host-observed model delivery and decision provenance.

Terminal existence, PID liveness and HTTP input success are transport facts,
not proof that the intended model received or produced a message.  Material
authority requires a nonce acknowledgement and response parsed by a host
adapter from the exact provider artifact or CAO model-event record bound to the
selected session.  Caller-supplied labels and text files are never sufficient.
"""

from __future__ import annotations

import json
import re
import secrets
from pathlib import Path
from typing import Any, Callable, Iterable

from .common import ContractError, PolicyError, atomic_write_json, file_lock, iso_now, load_json, sha256_bytes, sha256_json, validate_id
from .state_machine import RunStore

TransportSender = Callable[[str], dict[str, Any]]

DELIVERY_STATES = {
    "QUEUED", "TERMINAL_ACCEPTED", "MODEL_ACKNOWLEDGED",
    "MODEL_RESPONSE_OBSERVED", "FAILED", "UNKNOWN",
}
TRUSTED_ARTIFACT_SOURCES = {"provider_rollout", "provider_transcript", "cao_model_event"}
AUTHORITY_TRUSTED = "HOST_PARSED_PROVIDER_ARTIFACT"
AUTHORITY_UNTRUSTED_MANUAL = "UNTRUSTED_MANUAL"
IDENTITY_KEYS = {"id", "uuid", "message_id", "event_id", "response_id", "turn_id", "item_id"}


def _delivery_ack_match_mode(expected_ack: str, observed_text: str) -> str | None:
    """Match an ACK exactly or after removing terminal-rendered ASCII whitespace.

    CAO terminal output may insert hard line breaks into a long nonce token.
    The nonce itself contains no whitespace, so removing only ASCII transport
    whitespace preserves the token while rejecting any non-whitespace change.
    """

    if expected_ack in observed_text:
        return "EXACT"
    compact_expected = re.sub(r"[ \t\r\n\f\v]+", "", expected_ack)
    compact_observed = re.sub(r"[ \t\r\n\f\v]+", "", observed_text)
    if compact_expected and compact_expected in compact_observed:
        return "ASCII_WHITESPACE_NORMALIZED"
    return None


def _delivery_dir(store: RunStore) -> Path:
    path = store.v2_dir / "deliveries"
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    return path


def create_delivery(
    *,
    store: RunStore,
    recipient_role: str,
    terminal_id: str,
    profile: str,
    generation: int,
    provider: str,
    provider_session_id: str | None,
    payload: str,
    sender: TransportSender | None = None,
    delivery_id: str | None = None,
) -> dict[str, Any]:
    validate_id(terminal_id, "terminal_id")
    validate_id(profile, "profile")
    delivery_id = delivery_id or f"dlv-{secrets.token_hex(12)}"
    validate_id(delivery_id, "delivery_id")
    nonce = secrets.token_urlsafe(24)
    challenge = f"MLGO_DELIVERY_CHALLENGE:{delivery_id}:{nonce}"
    framed = payload.rstrip() + "\n\n" + challenge + "\nRespond exactly with " + f"MLGO_DELIVERY_ACK:{delivery_id}:{nonce}" + " before taking any requested semantic action."
    record = {
        "schema_version": "1.0", "delivery_id": delivery_id, "run_id": store.run_id,
        "recipient_role": recipient_role, "terminal_id": terminal_id, "profile": profile,
        "generation": generation, "provider": provider,
        "provider_session_id": provider_session_id,
        "payload_sha256": sha256_bytes(payload.encode("utf-8")),
        "framed_message_sha256": sha256_bytes(framed.encode("utf-8")),
        "nonce": nonce, "expected_ack": f"MLGO_DELIVERY_ACK:{delivery_id}:{nonce}",
        "status": "QUEUED", "transport_response": None,
        "observation_trust": None,
        "created_at": iso_now(), "updated_at": iso_now(),
    }
    path = _delivery_dir(store) / f"{delivery_id}.json"
    lock = _delivery_dir(store) / ".delivery.lock"
    with file_lock(lock):
        if path.exists():
            existing = load_json(path)
            if existing.get("framed_message_sha256") != record["framed_message_sha256"]:
                raise PolicyError("delivery ID reused for different content")
            return existing
        atomic_write_json(path, record)
    if sender is None:
        return {**record, "path": str(path), "framed_message": framed}
    try:
        response = sender(framed)
        record.update({
            "status": "TERMINAL_ACCEPTED", "transport_response": response,
            "transport_accepted_at": iso_now(), "updated_at": iso_now(),
            "health_claim": "transport accepted only; model delivery is unproven",
        })
    except Exception as exc:
        record.update({"status": "FAILED", "error": str(exc), "updated_at": iso_now()})
    atomic_write_json(path, record)
    return {**record, "path": str(path)}


def _iter_strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, list):
        for item in value:
            yield from _iter_strings(item)
    elif isinstance(value, dict):
        for item in value.values():
            yield from _iter_strings(item)


def _native_ids(value: Any) -> list[str]:
    found: list[str] = []
    if isinstance(value, list):
        for item in value:
            found.extend(_native_ids(item))
    elif isinstance(value, dict):
        for key, item in value.items():
            if key.lower() in IDENTITY_KEYS and isinstance(item, (str, int)):
                found.append(str(item))
            found.extend(_native_ids(item))
    # Preserve encounter order while removing duplicates.
    return list(dict.fromkeys(found))


def _read_artifact_record(path: Path, record_index: int) -> tuple[bytes, Any, str]:
    if record_index < 1:
        raise ContractError("artifact record index is one-based and must be positive")
    raw = path.read_bytes()
    if not raw:
        raise ContractError(f"provider artifact is empty: {path}")

    if path.suffix.lower() == ".jsonl":
        lines = raw.splitlines()
        if record_index > len(lines):
            raise ContractError(f"artifact record index {record_index} exceeds {len(lines)} JSONL records")
        try:
            record = json.loads(lines[record_index - 1])
        except json.JSONDecodeError as exc:
            raise ContractError(f"invalid JSONL record {record_index}: {path}") from exc
        return raw, record, "jsonl"

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ContractError(f"trusted observation artifact must be JSON or JSONL: {path}") from exc
    if isinstance(parsed, list):
        if record_index > len(parsed):
            raise ContractError(f"artifact record index {record_index} exceeds {len(parsed)} JSON records")
        record = parsed[record_index - 1]
    else:
        if record_index != 1:
            raise ContractError("a single-object JSON artifact only has record index 1")
        record = parsed
    return raw, record, "json"


def _load_bound_session_registry(store: RunStore) -> dict[str, Any]:
    selected = store.load()["supervisor_selection"]
    registry_path = selected.get("session_registry_path")
    if not registry_path:
        raise PolicyError("trusted provider observation requires a host-bound session registry")
    path = Path(registry_path).resolve()
    if not path.is_file():
        raise PolicyError("bound supervisor session registry is missing")
    registry = load_json(path)
    if registry.get("run_id") != store.run_id:
        raise PolicyError("session registry run_id mismatch")
    return registry


def parse_model_artifact_observation(
    *,
    store: RunStore,
    observation_source: str,
    artifact_path: str | Path,
    record_index: int,
) -> dict[str, Any]:
    """Parse one exact provider/message record from a host-bound artifact.

    Trust is established by the adapter reading the artifact itself, computing
    the whole-artifact and exact-record digests, deriving an immutable record
    identity, and verifying that the artifact belongs to the selected session.
    No caller-provided text, source label alone, or arbitrary transcript path is
    promoted to material authority.
    """

    if observation_source not in TRUSTED_ARTIFACT_SOURCES:
        raise PolicyError(f"unsupported trusted observation adapter: {observation_source}")
    path = Path(artifact_path).expanduser().resolve()
    if not path.is_file():
        raise ContractError(f"observation artifact does not exist: {path}")

    registry: dict[str, Any] | None = None
    if observation_source in {"provider_rollout", "provider_transcript"}:
        registry = _load_bound_session_registry(store)
        expected_artifact = registry.get("provider_session_artifact")
        if not expected_artifact or Path(expected_artifact).expanduser().resolve() != path:
            raise PolicyError("provider observation artifact is not the host-bound session artifact")
        provider = str(registry.get("provider") or "")
        if observation_source == "provider_rollout" and provider != "codex":
            raise PolicyError("provider_rollout adapter is only trusted for a bound Codex session")
        if observation_source == "provider_transcript" and provider not in {"claude", "claude_code"}:
            raise PolicyError("provider_transcript adapter is only trusted for a bound Claude session")
    else:
        trusted_root = (store.v2_dir / "model-events").resolve()
        if not path.is_relative_to(trusted_root):
            raise PolicyError("CAO model-event observations must come from the run's host model-events directory")

    raw, record, artifact_format = _read_artifact_record(path, record_index)
    record_digest = sha256_json(record)
    native_ids = _native_ids(record)
    exact_identity = f"native:{native_ids[0]}" if native_ids else f"record:{record_index}:{record_digest}"
    observed_text = "\n".join(dict.fromkeys(s for s in _iter_strings(record) if s))
    if not observed_text:
        raise ContractError("selected artifact record contains no textual model observation")

    binding: dict[str, Any]
    if registry is not None:
        binding = {
            "run_id": store.run_id,
            "terminal_id": registry.get("terminal_id"),
            "profile": registry.get("profile"),
            "generation": registry.get("generation"),
            "provider": registry.get("provider"),
            "provider_session_id": registry.get("provider_session_id"),
            "session_registry_path": str(Path(store.load()["supervisor_selection"]["session_registry_path"]).resolve()),
        }
    else:
        if not isinstance(record, dict):
            raise PolicyError("CAO model-event record must be an object with host identity fields")
        binding = {
            "run_id": record.get("run_id"),
            "terminal_id": record.get("terminal_id"),
            "profile": record.get("profile"),
            "generation": record.get("generation"),
            "provider": record.get("provider"),
            "provider_session_id": record.get("provider_session_id"),
            "session_registry_path": None,
        }
        if binding["run_id"] != store.run_id or not binding["terminal_id"] or not binding["provider"]:
            raise PolicyError("CAO model-event artifact lacks exact host identity binding")

    return {
        "schema_version": "1.0",
        "adapter": f"mlgo_cao_v2.{observation_source}.v1",
        "observation_source": observation_source,
        "authority_trust": AUTHORITY_TRUSTED,
        "artifact_path": str(path),
        "artifact_format": artifact_format,
        "artifact_sha256": sha256_bytes(raw),
        "artifact_record_index": record_index,
        "artifact_record_sha256": record_digest,
        "observed_message_id": exact_identity,
        "native_message_ids": native_ids,
        "observed_text": observed_text,
        "binding": binding,
        "parsed_at": iso_now(),
    }


def _validate_artifact_observation(record: dict[str, Any], observation: dict[str, Any]) -> None:
    if observation.get("authority_trust") != AUTHORITY_TRUSTED:
        raise PolicyError("model observation was not produced by a trusted host artifact adapter")
    if observation.get("observation_source") not in TRUSTED_ARTIFACT_SOURCES:
        raise PolicyError("model observation source is not trusted for material authority")
    for field in ("artifact_path", "artifact_sha256", "artifact_record_index", "artifact_record_sha256", "observed_message_id", "observed_text"):
        if observation.get(field) in {None, ""}:
            raise PolicyError(f"trusted model observation is missing {field}")
    binding = observation.get("binding") or {}
    for field in ("terminal_id", "provider"):
        if binding.get(field) != record.get(field):
            raise PolicyError(f"artifact observation {field} does not match delivery")
    if binding.get("profile") is not None and binding.get("profile") != record.get("profile"):
        raise PolicyError("artifact observation profile does not match delivery")
    if binding.get("generation") is not None and int(binding.get("generation")) != int(record.get("generation")):
        raise PolicyError("artifact observation generation does not match delivery")
    expected_session = record.get("provider_session_id")
    if expected_session and binding.get("provider_session_id") != expected_session:
        raise PolicyError("artifact observation provider session does not match delivery")


def record_model_observation(
    *,
    store: RunStore,
    delivery_id: str,
    ack_observation: dict[str, Any],
    response_observation: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Record adapter-parsed acknowledgement and optional response evidence."""

    validate_id(delivery_id, "delivery_id")
    path = _delivery_dir(store) / f"{delivery_id}.json"
    lock = _delivery_dir(store) / ".delivery.lock"
    with file_lock(lock):
        record = load_json(path)
        _validate_artifact_observation(record, ack_observation)
        if response_observation is not None:
            _validate_artifact_observation(record, response_observation)
        expected_ack = record["expected_ack"]
        ack_match_mode = _delivery_ack_match_mode(
            expected_ack, str(ack_observation.get("observed_text") or "")
        )
        if ack_match_mode is None:
            raise PolicyError("adapter-parsed artifact record does not contain the delivery nonce acknowledgement")
        response_text = str((response_observation or {}).get("observed_text") or "") or None
        status = "MODEL_RESPONSE_OBSERVED" if response_text is not None else "MODEL_ACKNOWLEDGED"
        record.update({
            "status": status,
            "observation_trust": AUTHORITY_TRUSTED,
            "ack_observation": ack_observation,
            "response_observation": response_observation,
            "observed_message_id": (response_observation or ack_observation).get("observed_message_id"),
            "observation_source": (response_observation or ack_observation).get("observation_source"),
            "artifact_path": (response_observation or ack_observation).get("artifact_path"),
            "artifact_sha256": (response_observation or ack_observation).get("artifact_sha256"),
            "artifact_record_sha256": (response_observation or ack_observation).get("artifact_record_sha256"),
            "response_text_sha256": sha256_bytes(response_text.encode("utf-8")) if response_text is not None else None,
            "response_text": response_text,
            "ack_match_mode": ack_match_mode,
            "model_acknowledged_at": iso_now(), "updated_at": iso_now(),
            "health_claim": "model-level observation parsed from exact host-bound provider artifact",
        })
        atomic_write_json(path, record)
        return {**record, "path": str(path)}


def record_manual_observation(
    *,
    store: RunStore,
    delivery_id: str,
    observed_text: str,
    response_text: str | None = None,
    source_note: str = "manual",
) -> dict[str, Any]:
    """Store manual evidence for diagnostics without granting material trust."""

    validate_id(delivery_id, "delivery_id")
    path = _delivery_dir(store) / f"{delivery_id}.json"
    lock = _delivery_dir(store) / ".delivery.lock"
    with file_lock(lock):
        record = load_json(path)
        ack_match_mode = _delivery_ack_match_mode(record["expected_ack"], observed_text)
        if ack_match_mode is None:
            raise PolicyError("manual text does not contain the delivery nonce acknowledgement")
        record.update({
            "status": "MODEL_RESPONSE_OBSERVED" if response_text is not None else "MODEL_ACKNOWLEDGED",
            "observation_trust": AUTHORITY_UNTRUSTED_MANUAL,
            "manual_observation": {
                "source_note": source_note,
                "observed_text_sha256": sha256_bytes(observed_text.encode("utf-8")),
                "response_text_sha256": sha256_bytes(response_text.encode("utf-8")) if response_text is not None else None,
                "recorded_at": iso_now(),
            },
            "response_text": response_text,
            "response_text_sha256": sha256_bytes(response_text.encode("utf-8")) if response_text is not None else None,
            "ack_match_mode": ack_match_mode,
            "updated_at": iso_now(),
            "health_claim": "manual observation recorded for diagnostics; untrusted for material authority",
        })
        atomic_write_json(path, record)
        return {**record, "path": str(path)}


def require_model_observation(
    store: RunStore,
    delivery_id: str,
    *,
    require_response: bool = True,
    material_authority: bool = False,
) -> dict[str, Any]:
    record = load_json(_delivery_dir(store) / f"{delivery_id}.json")
    required = "MODEL_RESPONSE_OBSERVED" if require_response else {"MODEL_ACKNOWLEDGED", "MODEL_RESPONSE_OBSERVED"}
    ok = record.get("status") in required if isinstance(required, set) else record.get("status") == required
    if not ok:
        raise PolicyError(f"delivery {delivery_id} has no proven model-level acknowledgement/response")
    if material_authority and record.get("observation_trust") != AUTHORITY_TRUSTED:
        raise PolicyError(f"delivery {delivery_id} observation is untrusted for material authority")
    return record


def capture_supervisor_decision(
    *,
    store: RunStore,
    decision_packet: dict[str, Any],
    delivery_id: str,
) -> dict[str, Any]:
    """Wrap a supervisor decision in host-observed artifact provenance."""

    observation = require_model_observation(store, delivery_id, require_response=True, material_authority=True)
    state = store.load()
    selected = state["supervisor_selection"]
    if observation.get("recipient_role") != "authoritative_supervisor":
        raise PolicyError("decision observation was not addressed to the authoritative supervisor")
    for key, expected in (
        ("profile", selected.get("profile")),
        ("generation", selected.get("generation")),
        ("terminal_id", selected.get("terminal_id")),
        ("provider", selected.get("provider")),
    ):
        if expected is not None and observation.get(key) != expected:
            raise PolicyError(f"decision provenance {key} does not match immutable supervisor selection")
    if selected.get("provider_session_id") and observation.get("provider_session_id") != selected.get("provider_session_id"):
        raise PolicyError("decision provenance provider session mismatch")
    if decision_packet.get("schema_version") != "2.1":
        raise ContractError("supervisor decision packet must use schema_version 2.1")
    if decision_packet.get("run_id") != store.run_id:
        raise ContractError("supervisor decision run_id mismatch")
    if decision_packet.get("supervisor_profile") != selected.get("profile"):
        raise PolicyError("self-declared supervisor profile does not match immutable selection")
    response = observation.get("response_text") or ""
    packet_digest = sha256_json(decision_packet)
    if packet_digest not in response and decision_packet.get("decision_id") not in response:
        raise PolicyError("observed supervisor response does not reference the decision packet identity or digest")
    response_observation = observation.get("response_observation") or {}
    envelope = {
        "schema_version": "1.0", "record_type": "HOST_CAPTURED_SUPERVISOR_DECISION",
        "run_id": store.run_id, "decision_id": decision_packet["decision_id"],
        "decision_digest": packet_digest, "decision": decision_packet,
        "provenance": {
            "supervisor_profile": selected["profile"], "supervisor_generation": selected["generation"],
            "terminal_id": observation["terminal_id"], "provider": observation["provider"],
            "provider_session_id": observation.get("provider_session_id"),
            "delivery_id": delivery_id, "observed_message_id": observation.get("observed_message_id"),
            "observation_source": observation.get("observation_source"),
            "observation_trust": observation.get("observation_trust"),
            "artifact_path": response_observation.get("artifact_path") or observation.get("artifact_path"),
            "artifact_sha256": response_observation.get("artifact_sha256") or observation.get("artifact_sha256"),
            "artifact_record_index": response_observation.get("artifact_record_index"),
            "artifact_record_sha256": response_observation.get("artifact_record_sha256") or observation.get("artifact_record_sha256"),
            "adapter": response_observation.get("adapter"),
            "response_text_sha256": observation.get("response_text_sha256"),
            "captured_at": iso_now(),
        },
    }
    out_dir = store.v2_dir / "provenance" / "supervisor-decisions"
    out_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = out_dir / f"{decision_packet['decision_id']}.json"
    atomic_write_json(path, envelope)
    return {**envelope, "path": str(path)}


def load_verified_supervisor_decision(store: RunStore, path: str | Path) -> dict[str, Any]:
    envelope = load_json(path)
    if envelope.get("record_type") != "HOST_CAPTURED_SUPERVISOR_DECISION" or envelope.get("run_id") != store.run_id:
        raise ContractError("not a host-captured supervisor decision for this run")
    decision = envelope.get("decision")
    if not isinstance(decision, dict) or sha256_json(decision) != envelope.get("decision_digest"):
        raise ContractError("supervisor decision envelope digest mismatch")
    state = store.load(); selected = state["supervisor_selection"]; provenance = envelope.get("provenance") or {}
    if provenance.get("supervisor_profile") != selected.get("profile") or int(provenance.get("supervisor_generation", 0)) != int(selected.get("generation", 0)):
        raise PolicyError("supervisor decision provenance no longer matches the active generation")
    if selected.get("terminal_id") and provenance.get("terminal_id") != selected.get("terminal_id"):
        raise PolicyError("supervisor decision terminal provenance mismatch")
    delivery = require_model_observation(store, provenance.get("delivery_id"), require_response=True, material_authority=True)
    response_observation = delivery.get("response_observation") or {}
    for field in ("observed_message_id", "artifact_sha256", "artifact_record_sha256", "observation_source", "observation_trust"):
        expected = provenance.get(field)
        actual = response_observation.get(field) if field in response_observation else delivery.get(field)
        if expected != actual:
            raise PolicyError(f"supervisor decision artifact provenance mismatch: {field}")
    return envelope
