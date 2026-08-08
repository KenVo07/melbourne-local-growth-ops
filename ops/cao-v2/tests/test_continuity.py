from __future__ import annotations

import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from mlgo_cao_v2.common import PolicyError
from mlgo_cao_v2.continuity import (
    PATH_CHECKPOINT,
    PATH_LIVE,
    PATH_NATIVE,
    begin_checkpoint_fallback,
    complete_same_session_recovery,
    plan_recovery,
    register_session,
)
from mlgo_cao_v2.provenance import create_delivery, parse_model_artifact_observation, record_model_observation
from mlgo_cao_v2.state_machine import RunStore


class ContinuityTest(unittest.TestCase):
    def setUp(self):
        self.td = tempfile.TemporaryDirectory()
        self.root = Path(self.td.name)
        self.rollout = self.root / "rollout.jsonl"
        self.rollout.write_text("", encoding="utf-8")
        self.store = RunStore(self.root, "run-1")
        self.store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor")
        self.policy = {
            "continuity": {
                "checkpoint_fallback_max_attempts": 1,
                "provider_capabilities": {
                    "codex": {
                        PATH_LIVE: {"enabled": True},
                        PATH_NATIVE: {"enabled": False, "release_required": False},
                    }
                },
            }
        }
        self.registry = register_session(
            store=self.store,
            profile="mlgo-supervisor",
            generation=1,
            terminal_id="terminal-1",
            provider="codex",
            provider_session_id="session-1",
            provider_session_artifact=str(self.rollout),
            process_identity={"pid": 10, "process_start_time": "t", "executable": "codex"},
            launch_identity={"profile_digest": "a", "launch_command_digest": "b"},
        )

    def tearDown(self):
        self.td.cleanup()

    def approval(self):
        now = dt.datetime.now(dt.timezone.utc)
        return {
            "schema_version": "1.0",
            "action": PATH_CHECKPOINT,
            "run_id": "run-1",
            "approved": True,
            "approved_by": "operator",
            "reason": "One bounded fallback after verified session loss.",
            "issued_at": (now - dt.timedelta(minutes=1)).isoformat(),
            "expires_at": (now + dt.timedelta(minutes=20)).isoformat(),
        }

    def record_trusted_ack(self, delivery: dict[str, object], message_id: str) -> None:
        self.rollout.write_text(
            json.dumps({"id": message_id, "session_id": "session-1", "message": {"text": delivery["expected_ack"]}}) + "\n",
            encoding="utf-8",
        )
        evidence = parse_model_artifact_observation(
            store=self.store,
            observation_source="provider_rollout",
            artifact_path=self.rollout,
            record_index=1,
        )
        record_model_observation(store=self.store, delivery_id=str(delivery["delivery_id"]), ack_observation=evidence)

    def test_live_process_path_preferred_when_identity_matches(self):
        plan = plan_recovery(
            store=self.store,
            policy=self.policy,
            live_process_evidence={"pid": 10, "process_start_time": "t", "executable": "codex", "terminal_id": "terminal-1"},
            native_session_evidence=None,
            checkpoint_path=None,
            fallback_approval=None,
        )
        self.assertEqual(plan["selected_path"], PATH_LIVE)
        self.assertEqual(plan["cache_continuity_claim"], "NOT_GUARANTEED")

    def test_native_resume_disabled_is_not_release_blocker(self):
        plan = plan_recovery(
            store=self.store,
            policy=self.policy,
            live_process_evidence=None,
            native_session_evidence={"provider_session_id": "session-1"},
            checkpoint_path=None,
            fallback_approval=None,
        )
        native = next(x for x in plan["options"] if x["path"] == PATH_NATIVE)
        self.assertFalse(native["eligible"])
        self.assertFalse(native["release_required"])
        self.assertIsNone(plan["selected_path"])

    def test_same_session_completion_requires_trusted_artifact_handshake(self):
        rec = create_delivery(
            store=self.store,
            recipient_role="authoritative_supervisor",
            terminal_id="terminal-1",
            profile="mlgo-supervisor",
            generation=1,
            provider="codex",
            provider_session_id="session-1",
            payload="recover",
            delivery_id="continuity-delivery",
        )
        facts = {
            "terminal_id": "terminal-1",
            "provider": "codex",
            "process_identity": {"pid": 10, "process_start_time": "t", "executable": "codex"},
        }
        with self.assertRaises(PolicyError):
            complete_same_session_recovery(store=self.store, policy=self.policy, path=PATH_LIVE, delivery_id="continuity-delivery", recovery_facts=facts)
        self.record_trusted_ack(rec, "ack-live")
        out = complete_same_session_recovery(store=self.store, policy=self.policy, path=PATH_LIVE, delivery_id="continuity-delivery", recovery_facts=facts)
        self.assertEqual(out["status"], PATH_LIVE + "_VERIFIED")

    def test_native_resume_must_preserve_provider_session_id(self):
        self.policy["continuity"]["provider_capabilities"]["codex"][PATH_NATIVE]["enabled"] = True
        rec = create_delivery(
            store=self.store,
            recipient_role="authoritative_supervisor",
            terminal_id="terminal-1",
            profile="mlgo-supervisor",
            generation=1,
            provider="codex",
            provider_session_id="session-1",
            payload="resume",
            delivery_id="native-delivery",
        )
        self.record_trusted_ack(rec, "ack-native")
        with self.assertRaises(PolicyError):
            complete_same_session_recovery(
                store=self.store,
                policy=self.policy,
                path=PATH_NATIVE,
                delivery_id="native-delivery",
                recovery_facts={"terminal_id": "terminal-1", "provider": "codex", "provider_session_id": "other"},
            )

    def test_disabled_continuity_capability_cannot_be_completed(self):
        rec = create_delivery(
            store=self.store,
            recipient_role="authoritative_supervisor",
            terminal_id="terminal-1",
            profile="mlgo-supervisor",
            generation=1,
            provider="codex",
            provider_session_id="session-1",
            payload="resume",
            delivery_id="disabled-native",
        )
        self.record_trusted_ack(rec, "ack-disabled")
        with self.assertRaises(PolicyError):
            complete_same_session_recovery(
                store=self.store,
                policy=self.policy,
                path=PATH_NATIVE,
                delivery_id="disabled-native",
                recovery_facts={"terminal_id": "terminal-1", "provider": "codex", "provider_session_id": "session-1"},
            )

    def test_checkpoint_fallback_one_attempt_and_new_generation(self):
        checkpoint = self.root / "checkpoint.md"
        checkpoint.write_text("checkpoint")
        first = begin_checkpoint_fallback(
            store=self.store,
            policy=self.policy,
            checkpoint_path=str(checkpoint),
            approval=self.approval(),
            reason="native continuity unavailable",
        )
        self.assertEqual(first["generation"], 2)
        self.assertEqual(first["attempt"], 1)
        self.assertEqual(first["cache_continuity_claim"], "NOT_GUARANTEED")
        with self.assertRaises(PolicyError):
            begin_checkpoint_fallback(
                store=self.store,
                policy=self.policy,
                checkpoint_path=str(checkpoint),
                approval=self.approval(),
                reason="second attempt",
            )


if __name__ == "__main__":
    unittest.main()
