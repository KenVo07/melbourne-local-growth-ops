#!/usr/bin/env python3
"""Regenerate Slice 2 schema examples from the real runtime constructors.

The examples are produced by the same code paths the control plane uses, so a
committed example can never drift from the implementation without the source
verifier noticing.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))

from mlgo_cao_v2 import checkpoints, context_envelope, decisions, episodes, task_lead  # noqa: E402

FIXED_TIME = "2026-08-08T00:00:00Z"
SHA_A = "a" * 64
SHA_B = "b" * 64
SHA_C = "c" * 64
SHA_D = "d" * 64


def _freeze(record: dict, *, digest_field: str | None, time_fields: tuple[str, ...]) -> dict:
    for field in time_fields:
        if field in record:
            record[field] = FIXED_TIME
    if digest_field:
        record[digest_field] = checkpoints._digest_of(record, digest_field)
    return record


def build() -> dict[str, dict]:
    out: dict[str, dict] = {}

    handle = checkpoints.create_conversation_handle(
        handle_id="ch-example-1", run_id="run-example", role_id="tech_lead",
        work_package_id="bt-example", task_id="task-example",
        provider_profile_id="mlgo-claude-subscription-task-lead-sonnet",
        account_profile_id="claude-subscription", provider_id="claude_code",
        model="sonnet", reasoning_effort="medium", transport_id="cao-main",
        registry_digest=SHA_A, policy_digest=SHA_B, contract_bundle_digest=SHA_C,
        runtime_version="0.5.0-slice3-5-vnext", build_manifest_sha256=SHA_D, generation=1,
    )
    out["conversation-handle"] = _freeze(handle, digest_field="handle_digest", time_fields=("created_at",))

    state = task_lead.normalize_tech_lead_execution_state({
        "run_id": "run-example", "big_task_id": "bt-example", "task_id": "task-example",
        "task_lead_id": "tl-example", "generation": 1,
        "task_graph": [
            {"task_id": "task-a", "status": "COMPLETE", "depends_on": []},
            {"task_id": "task-b", "status": "RUNNING", "depends_on": ["task-a"]},
        ],
        "ownership": {
            "workers": [{"worker_id": "w-1", "task_id": "task-b", "route_id": "agy_flash_high"}],
            "files": ["packages/example/src/index.ts"],
            "worktrees": [{"worktree_id": "wt-1", "branch": "agent/task-b", "worker_id": "w-1"}],
        },
        "evidence_refs": [
            {"id": "ev-commit-1", "kind": "commit", "sha256": SHA_A},
            {"id": "ev-tests-1", "kind": "test_run", "sha256": SHA_B},
        ],
        "decisions": [{"decision_id": "dec-1", "outcome": "APPROVED_BOUNDED_SCOPE", "scope": "phase_sequencing"}],
        "risks": [{"risk_id": "risk-1", "status": "OPEN", "summary": "integration ordering"}],
        "dependencies": [{"dependency_id": "dep-1", "on": "task-a", "kind": "sequence"}],
        "delegation_revision": "deleg-3", "charter_revision": "charter-2",
        "cursors": {"state_version": 12, "command_cursor": {"count": 4, "last_id": "cmd-4"},
                    "operation_cursor": {"count": 2, "last_id": "op-2"}},
        "last_committed_state_version": 12,
    })
    out["tech-lead-execution-state"] = state

    checkpoint = task_lead.create_tech_lead_checkpoint(
        checkpoint_id="ckpt-example-1", execution_state=state,
        registry_digest=SHA_A, policy_digest=SHA_B, contract_bundle_digest=SHA_C,
        conversation_handle_digest=handle["handle_digest"],
    )
    out["checkpoint-vnext"] = _freeze(checkpoint, digest_field="content_digest", time_fields=("created_at",))

    trigger = episodes.classify_event({
        "event_class": episodes.TRIGGER_PROJECT_ARCHITECTURE,
        "run_id": "run-example", "task_id": "task-example", "subject_id": "milestone-1",
        "decision_scope": "milestone", "materially_affects_locked_architecture": True,
        "initiator": "host", "evidence_refs": [{"id": "ev-arch-1"}],
    })
    trigger = dict(trigger)
    out["semantic-trigger"] = _freeze(trigger, digest_field="trigger_digest", time_fields=("classified_at",))

    episode = {
        "schema_version": episodes.AUTHORITY_EPISODE_SCHEMA_VERSION,
        "episode_id": "epi-example-1", "run_id": "run-example", "task_id": "task-example",
        "trigger_class": trigger["trigger_class"], "trigger_digest": trigger["trigger_digest"],
        "dedupe_key": trigger["dedupe_key"], "evidence_ids": trigger["evidence_ids"],
        "initiator": "host", "authority_role": "authoritative_supervisor", "authority_mode": "CONSULT",
        "budget_decision": None, "enforcement_mode": "shadow_only", "status": "OPEN", "outcome": None,
        "coalesced_event_count": 0, "coalesced_evidence_ids": [],
        "created_at": FIXED_TIME, "updated_at": FIXED_TIME,
    }
    out["authority-episode"] = _freeze(episode, digest_field="episode_digest", time_fields=())

    manifest = context_envelope.build_context_manifest(
        manifest_id="ctx-example-1", run_id="run-example", task_id="task-example", role_id="tech_lead",
        components=[
            context_envelope.component(kind="system_control_text", component_id="sys-1", text="host control text"),
            context_envelope.component(kind="profile_text", component_id="prof-1", text="profile body"),
            context_envelope.component(kind="objective_task", component_id="obj-1", text="bounded objective"),
            context_envelope.component(kind="durable_state_summary", component_id="state-1", text="compact state"),
            context_envelope.component(kind="selected_history", component_id="hist-1", items=["turn-1", "turn-2"]),
            context_envelope.component(kind="tool_schemas", component_id="tools-1", items=[{"name": "read"}]),
            context_envelope.component(kind="tool_results", component_id="results-1", items=[{"ok": True}]),
            context_envelope.component(kind="attachment_excerpts", component_id="att-1", items=["excerpt"]),
            context_envelope.component(kind="adapter_wrapper", component_id="wrap-1", text="adapter envelope"),
        ],
        wrapper={"transport_id": "cao-main", "adapter_id": "cao-run-step"},
    )
    manifest = {k: v for k, v in manifest.items() if not k.startswith("_")}
    out["context-manifest"] = _freeze(manifest, digest_field="manifest_digest", time_fields=("measured_at",))

    request = decisions.new_authority_request(
        request_id="areq-example-1", run_id="run-example", task_id="task-example", big_task_id="bt-example",
        requester_role="tech_lead", authority_role="authoritative_supervisor",
        mode=decisions.MODE_ADJUDICATE, requested_scope=["phase_sequencing"],
        state_revision=12, context_manifest_digest=manifest["manifest_digest"],
        checkpoint_digest=checkpoint["content_digest"], delegation_revision="deleg-3",
        charter_revision="charter-2", delegated_scope=["phase_sequencing", "route_selection"],
        question="Is the bounded phase resequencing acceptable inside the delegated scope?",
        evidence_refs=[{"id": "ev-arch-1", "kind": "analysis"}],
    )
    request["execution_state_digest"] = state["state_digest"]
    request["conversation_handle_digest"] = handle["handle_digest"]
    request["created_at"] = FIXED_TIME
    request["binding_digest"] = checkpoints.sha256_json({f: request[f] for f in decisions.BINDING_FIELDS})
    request["request_digest"] = checkpoints._digest_of(request, "request_digest")
    out["tech-lead-consult-request"] = request

    decision = decisions.new_decision(
        decision_id="adec-example-1", request=request, outcome="APPROVED_BOUNDED_SCOPE",
        applied_scope=["phase_sequencing"], rationale_digest=SHA_A,
    )
    out["tech-lead-decision"] = _freeze(decision, digest_field="decision_digest", time_fields=("created_at",))
    return out


def main() -> int:
    check = "--check" in sys.argv
    examples_dir = ROOT / "examples"
    drift = []
    for stem, record in build().items():
        path = examples_dir / f"{stem}.example.json"
        text = json.dumps(record, indent=2, sort_keys=True) + "\n"
        if check:
            if not path.exists() or path.read_text(encoding="utf-8") != text:
                drift.append(path.name)
        else:
            path.write_text(text, encoding="utf-8")
    if check and drift:
        print(f"slice2 example drift: {sorted(drift)}", file=sys.stderr)
        return 1
    print("slice2 examples ok" if check else "slice2 examples regenerated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
