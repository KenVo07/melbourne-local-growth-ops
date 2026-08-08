"""Two-step finalization with correct authority ordering.

1. A host-captured supervisor decision authorizes publication (or explicitly
   declares publication not required).
2. The host publishes, proves target reachability and exact required CI, then
   writes a Final Facts Packet.
3. The same immutable supervisor generation receives those facts and issues a
   host-captured FINAL_VERDICT bound to their digest.
4. Only then may the host transition the run to FINALIZED.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .common import ContractError, PolicyError, atomic_write_json, iso_now, load_json, sha256_json, validate_sha
from .git_executor import verify_reachability
from .policy import load_policy
from .provenance import load_verified_supervisor_decision
from .state_machine import RunStore


def _require_pass_record(path: str | Path, label: str) -> dict[str, Any]:
    value = load_json(path)
    status = str(value.get("status") or value.get("verdict") or value.get("result") or "").upper()
    if status not in {"PASS", "PASSED", "APPROVED", "SATISFIED"}:
        raise PolicyError(f"{label} record is not passing: {path} ({status or 'missing status'})")
    return value


def _decision(store: RunStore, path: str | Path, expected_type: str) -> dict[str, Any]:
    envelope = load_verified_supervisor_decision(store, path)
    decision = envelope["decision"]
    if decision.get("decision_type") != expected_type:
        raise ContractError(f"expected {expected_type}, got {decision.get('decision_type')}")
    return envelope


def prepare_final_facts(
    *,
    run_id: str,
    integration_worktree: str | Path,
    target_branch: str,
    expected_sha: str,
    review_record: str | Path,
    final_validation_record: str | Path,
    publication_authorization: str | Path,
    publication_record: str | Path | None,
    remote_ci_record: str | Path | None,
    required_ci_checks: list[str | dict[str, Any]] | None = None,
    publication_required: bool = True,
    ci_required: bool = True,
    remote: str = "origin",
    policy_path: str | Path | None = None,
) -> dict[str, Any]:
    policy = load_policy(policy_path); sha = validate_sha(expected_sha, "expected_sha")
    store = RunStore(policy["state_root"], run_id)
    review = _require_pass_record(review_record, "review")
    if validate_sha(str(review.get("reviewed_sha") or ""), "reviewed_sha") != sha:
        raise PolicyError("review record does not cover the final candidate SHA")
    validation = _require_pass_record(final_validation_record, "final validation")
    if validate_sha(str(validation.get("candidate_sha") or ""), "candidate_sha") != sha:
        raise PolicyError("final validation record does not cover the final candidate SHA")
    if validation.get("scope") != "full_integrated":
        raise PolicyError("final validation record is not full_integrated")

    authorization = _decision(store, publication_authorization, "PUBLICATION_AUTHORIZATION")
    auth_decision = authorization["decision"]
    allowed_auth = "AUTHORIZE_PUBLICATION" if publication_required else "PUBLICATION_NOT_REQUIRED"
    if auth_decision.get("decision") != allowed_auth:
        raise PolicyError(f"publication authorization decision must be {allowed_auth}")
    authorized_sha = auth_decision.get("candidate_sha") or auth_decision.get("facts_digest")
    if authorized_sha and authorized_sha != sha:
        raise PolicyError("publication authorization does not cover the final candidate SHA")

    state_status = store.load()["status"]
    if state_status == "ACTIVE":
        store.set_run_status("PUBLICATION_PENDING", reason="immutable supervisor authorized publication")
    elif state_status != "PUBLICATION_PENDING":
        raise PolicyError(f"run is not ready for publication facts: {state_status}")

    publication: dict[str, Any] | None = None
    if publication_required and publication_record is None:
        raise ContractError("publication record is required")
    if publication_record is not None:
        publication = load_json(publication_record)
        if publication.get("schema_version") not in {"2.0", "2.1"} or publication.get("run_id") != run_id:
            raise ContractError("publication record identity mismatch")
        if validate_sha(str(publication.get("candidate_sha") or ""), "publication candidate_sha") != sha:
            raise PolicyError("publication record covers a different SHA")
        if publication.get("remote") != remote or publication.get("target_branch") != target_branch:
            raise PolicyError("publication target mismatch")
        expected_status = "PUBLISHED" if publication_required else {"PUBLISHED", "NOT_REQUIRED"}
        if isinstance(expected_status, set):
            ok = publication.get("status") in expected_status
        else:
            ok = publication.get("status") == expected_status
        if not ok: raise PolicyError("publication record is not satisfied")

    reachability = verify_reachability(repository=integration_worktree, remote=remote, branch=target_branch, expected_sha=sha)

    ci: dict[str, Any] | None = None
    if ci_required:
        if remote_ci_record is None: raise ContractError("remote CI record is required")
        ci = load_json(remote_ci_record)
        if ci.get("schema_version") not in {"2.0", "2.1"} or ci.get("candidate_sha") != sha:
            raise ContractError("remote CI record identity mismatch")
        if ci.get("status") != "PASS" or ci.get("missing_checks") or ci.get("pending_checks") or ci.get("failed_checks"):
            raise PolicyError("exact required CI checks are not satisfied")
        if not required_ci_checks:
            raise PolicyError("finalization requires an explicit expected CI/check set")
        def canonical(items: list[str | dict[str, Any]]) -> list[dict[str, Any]]:
            out = []
            for item in items:
                if isinstance(item, str): out.append({"name": item, "allowed_conclusions": ["success"]})
                elif isinstance(item, dict): out.append({"name": str(item.get("name") or ""), "allowed_conclusions": sorted(item.get("allowed_conclusions") or ["success"])})
                else: raise ContractError("invalid required CI check specification")
            if any(not row["name"] for row in out): raise ContractError("required CI check name is empty")
            return sorted(out, key=lambda row: row["name"])
        if canonical(ci.get("required_checks") or []) != canonical(required_ci_checks):
            raise PolicyError("remote CI record does not cover the exact expected required check set")
    elif remote_ci_record is not None:
        ci = load_json(remote_ci_record)

    facts = {
        "schema_version": "2.1", "record_type": "FINAL_FACTS_PACKET", "run_id": run_id,
        "candidate_sha": sha, "remote": remote, "target_branch": target_branch,
        "remote_sha": reachability["remote_sha"], "target_reachable": True,
        "review_record": str(Path(review_record).resolve()),
        "final_validation_record": str(Path(final_validation_record).resolve()),
        "publication_authorization": str(Path(publication_authorization).resolve()),
        "publication_record": str(Path(publication_record).resolve()) if publication_record else None,
        "remote_ci_record": str(Path(remote_ci_record).resolve()) if remote_ci_record else None,
        "publication_required": publication_required, "ci_required": ci_required,
        "required_ci_checks": required_ci_checks or [],
        "required_review_satisfied": True, "final_validation_satisfied": True,
        "publication_satisfied": not publication_required or publication is not None,
        "remote_ci_satisfied": not ci_required or ci is not None,
        "unresolved_blockers": [], "prepared_at": iso_now(),
    }
    facts["facts_digest"] = sha256_json({k: v for k, v in facts.items() if k != "facts_digest"})
    output = store.v2_dir / "finalization" / "final-facts.json"
    atomic_write_json(output, facts)
    store.set_run_status("FINAL_FACTS_READY", reason="publication, reachability and exact required CI proven")
    return {"record": facts, "path": str(output)}


def finalize_with_verdict(
    *,
    run_id: str,
    final_facts_record: str | Path,
    final_verdict: str | Path,
    policy_path: str | Path | None = None,
) -> dict[str, Any]:
    policy = load_policy(policy_path); store = RunStore(policy["state_root"], run_id)
    facts = load_json(final_facts_record)
    if facts.get("record_type") != "FINAL_FACTS_PACKET" or facts.get("run_id") != run_id:
        raise ContractError("invalid final facts packet")
    expected_digest = sha256_json({k: v for k, v in facts.items() if k != "facts_digest"})
    if facts.get("facts_digest") != expected_digest:
        raise ContractError("final facts packet digest mismatch")
    if facts.get("unresolved_blockers"):
        raise PolicyError("final facts packet still has unresolved blockers")
    envelope = _decision(store, final_verdict, "FINAL_VERDICT")
    decision = envelope["decision"]
    if decision.get("decision") != "MILESTONE_FINALIZED":
        raise PolicyError("supervisor did not issue MILESTONE_FINALIZED")
    if decision.get("facts_digest") != facts["facts_digest"]:
        raise PolicyError("FINAL_VERDICT is not bound to the verified final facts digest")
    if store.load()["status"] != "FINAL_FACTS_READY":
        raise PolicyError("run is not in FINAL_FACTS_READY")
    store.set_run_status("FINALIZATION_PENDING", reason="host-captured FINAL_VERDICT covers final facts")
    record = {
        "schema_version": "2.1", "run_id": run_id,
        "local_integration_sha": facts["candidate_sha"],
        "remote_target": f"{facts['remote']}/{facts['target_branch']}",
        "remote_sha": facts["remote_sha"], "target_reachable": True,
        "required_review_satisfied": True, "final_validation_satisfied": True,
        "remote_ci_satisfied": facts["remote_ci_satisfied"],
        "publication_satisfied": facts["publication_satisfied"],
        "final_facts_record": str(Path(final_facts_record).resolve()),
        "final_facts_digest": facts["facts_digest"],
        "supervisor_decision_provenance": str(Path(final_verdict).resolve()),
        "supervisor_verdict": "MILESTONE_FINALIZED", "unresolved_blockers": [],
        "cleanup_eligible": True, "recorded_at": iso_now(),
    }
    output = store.v2_dir / "finalization" / "finalization-record.json"
    atomic_write_json(output, record)
    store.set_run_status("FINALIZED", reason="authoritative verdict issued after all final facts were proven")
    return {"record": record, "path": str(output)}


# Deliberately retained as a fail-closed compatibility symbol.  Callers must
# migrate to prepare_final_facts() followed by finalize_with_verdict().
def build_finalization_record(**_: Any) -> dict[str, Any]:
    raise PolicyError(
        "one-step finalization is disabled; use prepare_final_facts then finalize_with_verdict"
    )
