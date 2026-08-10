#!/usr/bin/env python3
"""Slice 4 gap closure (round 2): prove the corrected child-provider
transport is reached through *canonical* CAO dispatch - `mlgo-v2-dispatch
run-job` - not a proof-only helper script.

This script only constructs the durable RunStore state and on-disk
packets/decision/job files a real `submit_phase()` would have produced (so
`run_job()` can be invoked exactly as `mlgo-v2-dispatch run-job --job-file
...` invokes it in production); it does not call `dispatch_via_child_transport`
or any dispatch_governance function directly. The actual dispatch happens by
shelling out to the real installed `mlgo-v2-dispatch` CLI binary.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

REPO_LIB = "/home/khoa/Projects/mlgo-slice4-wt/ops/cao-v2/lib"
sys.path.insert(0, REPO_LIB)

from mlgo_cao_v2 import canary_scope
from mlgo_cao_v2.canonical_lock import load_lock
from mlgo_cao_v2.common import atomic_write_json, sha256_json
from mlgo_cao_v2.skill_cache import SealedSkillCache
from mlgo_cao_v2.skill_population import bind_namespace
from mlgo_cao_v2.state_machine import RunStore

EVIDENCE_ROOT = Path("/home/khoa/Projects/mlgo-slice4-wt/evidence/slice4/canonical-dispatch-proof")
STATE_ROOT = EVIDENCE_ROOT / "state"
REAL_CACHE = Path.home() / ".local/state/mlgo-cao/canonical-skill-cache-v1"
BASE_POLICY = json.loads(Path("/home/khoa/Projects/mlgo-slice4-wt/ops/cao-v2/config/cao-policy.json").read_text())


def setup_one(*, provider: str, route_id: str, profile_id: str, model: str, run_id: str, worktree: Path) -> dict:
    cache_root = STATE_ROOT / "cache"
    if not cache_root.exists():
        shutil.copytree(REAL_CACHE, cache_root)
    cache = SealedSkillCache(cache_root)
    lock = load_lock()
    bind_namespace(cache=cache, lock=lock, project_id=run_id, security_domain_id=run_id)

    policy = dict(BASE_POLICY)
    policy["state_root"] = str(STATE_ROOT)
    policy["skill_cache_root"] = str(cache_root)
    policy_path = STATE_ROOT / f"policy-{run_id}.json"
    STATE_ROOT.mkdir(parents=True, exist_ok=True)
    policy_path.write_text(json.dumps(policy, indent=2))

    # Durable RunStore state, exactly as submit_phase() would have left it.
    store = RunStore(str(STATE_ROOT), run_id)
    store.initialize(mode="v2_shadow", supervisor_profile="mlgo-supervisor", supervisor_account_pool="codex_business")
    store.set_run_status("ACTIVE", reason="canonical dispatch proof")

    big_task_id = "PROOF"
    charter = {
        "schema_version": "2.0", "run_id": run_id, "big_task_id": big_task_id,
        "outcome": "Prove the corrected child-provider transport is reached via canonical dispatch.run_job.",
        "acceptance": ["A real, non-bypassed child dispatch completes through mlgo-v2-dispatch run-job."],
        "in_scope": ["."], "out_of_scope": ["production deployment"],
        "constraints": ["Disposable fixture only."], "risk_class": "LOW",
        "delegation_envelope": {
            "allowed_routes": [route_id], "maximum_tier": 5, "gateway_allowed": False,
            "protected_supervisor_pool_use_allowed": False, "max_phases": 1, "max_parallel_writers": 1,
            "supervisor_approval_triggers": [],
        },
        "review_policy": {"default_class": "routine_independent", "critical_requires_cross_provider": False},
        "completion_boundary": "N/A - disposable Slice 4 evidence run.",
    }
    charter_path = STATE_ROOT / f"charter-{run_id}.json"
    atomic_write_json(charter_path, charter)
    store.register_big_task(big_task_id, str(charter_path), None)

    phase_id = f"{big_task_id}-P01"
    prompt_path = STATE_ROOT / f"prompt-{run_id}.md"
    prompt_path.write_text(
        "Command: Fix the bug. Create a file named notes.py in the current directory with a "
        "function summarize(items) that has a deliberate bug (it returns len(items) + 1 instead "
        "of len(items)), then a second file bug-notes.txt briefly describing the bug. "
        "Do nothing else.",
        encoding="utf-8",
    )
    v2_dir = STATE_ROOT / "runs" / run_id / "v2"
    (v2_dir / "packets").mkdir(parents=True, exist_ok=True)
    routing_decision = {
        "schema_version": "2.0", "decision": "ROUTE_SELECTED",
        "selected_route": route_id, "selected_provider": provider, "selected_profile": profile_id,
        "selected_model": model, "selected_tier": 3, "selected_account_pool": "claude_subscription" if provider == "claude_code" else "codex_plus",
        "selected_provider_api": "child_direct",
    }
    decision_path = v2_dir / "packets" / f"{phase_id}-routing-decision.json"
    atomic_write_json(decision_path, routing_decision)

    phase_packet = {
        "schema_version": "2.0", "run_id": run_id, "big_task_id": big_task_id, "phase_id": phase_id,
        "phase_kind": "implementation", "objective": "Implement a small backend fix (canonical dispatch proof)",
        "write_capable": True, "prompt_file": str(prompt_path),
        "routing_proposal_file": str(decision_path),
        "worktree": {"path": str(worktree), "branch": "main", "base_ref": "main", "create_if_missing": False, "require_clean": False},
        "ownership": {"allowed_paths": ["notes.py", "bug-notes.txt"], "forbidden_paths": []},
        "evidence_directory": str(STATE_ROOT / "evidence" / phase_id),
        "validation": {"commands": [], "timeout_seconds": 300, "reuse_evidence_for_sha": False},
        "result_contract": {"allowed_statuses": ["READY_FOR_COMMIT", "PLAN_CONFLICT", "CAPABILITY_ESCALATION_REQUIRED", "ENVIRONMENT_BLOCKED", "MISSING_REQUIRED_CONTEXT"]},
        "review": {"required": False, "phase_packet_file": None},
        "integration": {"enabled": False, "integration_worktree": None, "integration_branch": None},
        "task_lead": {"task_lead_id": None, "terminal_id": None},
        "stop_conditions": ["Stop once notes.py and bug-notes.txt exist."],
        "rollback_boundary": "Revert the exact commit.",
        "parent_phase_id": None,
    }
    packet_path = v2_dir / "packets" / f"{phase_id}.json"
    atomic_write_json(packet_path, phase_packet)

    store.register_phase(phase_packet, str(packet_path))
    store.transition_phase(phase_id, "ROUTING_PENDING", reason="routing proposal validated", updates={"packet_path": str(packet_path), "last_error": None})
    store.transition_phase(phase_id, "ROUTED", reason="host routing decision selected an eligible route", updates={
        "routing_decision_path": str(decision_path), "selected_route": route_id,
        "selected_provider": provider, "selected_account_pool": routing_decision["selected_account_pool"], "selected_tier": 3,
    })
    store.transition_phase(phase_id, "PREFLIGHT_PENDING", reason="host preflight starting")

    job_id = f"phase-{phase_id}-a1-proof"
    job_dir = v2_dir / "jobs" / job_id
    job_dir.mkdir(parents=True, exist_ok=True)
    job = {
        "schema_version": "2.1", "job_id": job_id, "run_id": run_id, "big_task_id": big_task_id,
        "phase_id": phase_id, "phase_packet_path": str(packet_path), "routing_decision_path": str(decision_path),
        "route": routing_decision, "status": "QUEUED", "attempt": 1, "systemd_unit": None,
        "idempotency_key": sha256_json({"phase_packet": phase_packet, "routing_decision": routing_decision, "attempt": 1})[:12],
    }
    job_path = job_dir / "job.json"
    atomic_write_json(job_path, job)
    store.transition_phase(phase_id, "DISPATCHED", reason="phase job queued", updates={"job_path": str(job_path), "attempt": 1})

    return {"job_path": str(job_path), "policy_path": str(policy_path), "run_id": run_id, "phase_id": phase_id}


def run_via_real_cli(*, job_path: str, policy_path: str) -> dict:
    proc = subprocess.run(
        ["/home/khoa/.local/bin/mlgo-v2-dispatch", "run-job", "--job-file", job_path, "--policy", policy_path],
        capture_output=True, text=True, timeout=300,
    )
    return {"returncode": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr}


def main():
    # One explicit, time-bounded canary scope authorizing real dispatch for
    # both proof runs - the same structural gate every other Slice 4 real
    # dispatch went through.
    canary_scope.open_scope(
        {"state_root": str(STATE_ROOT)}, scope_id="scope-canonical-dispatch-proof",
        run_ids=["canonical-proof-claude", "canonical-proof-codex"],
        ttl_seconds=1800, reason="Slice 4 canonical dispatch.run_job proof", opened_by="slice4-local-agent",
    )

    claude_setup = setup_one(
        provider="claude_code", route_id="claude_subscription_child_direct",
        profile_id="mlgo-claude-subscription-child-direct", model="sonnet",
        run_id="canonical-proof-claude",
        worktree=Path("/home/khoa/Projects/mlgo-slice4-canaries/canonical-dispatch-proof-claude"),
    )
    (EVIDENCE_ROOT / "claude-setup.json").write_text(json.dumps(claude_setup, indent=2))
    claude_cli = run_via_real_cli(job_path=claude_setup["job_path"], policy_path=claude_setup["policy_path"])
    (EVIDENCE_ROOT / "claude-cli-invocation.json").write_text(json.dumps(claude_cli, indent=2))
    print("CLAUDE run-job exit:", claude_cli["returncode"])
    print(claude_cli["stdout"][-2000:])
    print(claude_cli["stderr"][-2000:])

    codex_setup = setup_one(
        provider="codex", route_id="codex_plus_child_direct",
        profile_id="mlgo-codex-plus-child-direct", model="gpt-5.6-sol",
        run_id="canonical-proof-codex",
        worktree=Path("/home/khoa/Projects/mlgo-slice4-canaries/canonical-dispatch-proof-codex"),
    )
    (EVIDENCE_ROOT / "codex-setup.json").write_text(json.dumps(codex_setup, indent=2))
    codex_cli = run_via_real_cli(job_path=codex_setup["job_path"], policy_path=codex_setup["policy_path"])
    (EVIDENCE_ROOT / "codex-cli-invocation.json").write_text(json.dumps(codex_cli, indent=2))
    print("CODEX run-job exit:", codex_cli["returncode"])
    print(codex_cli["stdout"][-2000:])
    print(codex_cli["stderr"][-2000:])


if __name__ == "__main__":
    main()
