"""Deterministic fixtures shared by the Slice 3 acceptance gates.

Everything here is local, disposable and deterministic.  No real provider,
model, network or host service is contacted, and no Business 2 policy instance
is used: protected capacity is exercised through the same generic scope and
reserve machinery any other tenant would use.

The fakes are counting fakes rather than mocks.  ``CountingTransport`` records
how many times a side effect actually crossed the transport boundary, and
``ArtifactStore``/``BudgetStore`` are pointed at real temporary directories, so
claims like "the second racer never reserved" or "recovery never re-sent" are
falsifiable against durable evidence instead of asserted against a mock.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from mlgo_cao_v2.artifacts import ArtifactStore
from mlgo_cao_v2.budgets import BudgetStore, make_budget_policy, make_limit
from mlgo_cao_v2.commands import CommandCoordinator, CommandLedger
from mlgo_cao_v2.events import EventProjection
from mlgo_cao_v2.leases import ExecutorLeaseStore
from mlgo_cao_v2.operations import OperationLedger
from mlgo_cao_v2.state_machine import RunStore

ROOT = Path(__file__).resolve().parents[1]
SCHEMAS = ROOT / "schemas"

SUPERVISOR_PROFILE = "mlgo-claude-subscription-supervisor"
RUN_ID = "run-slice3"

DOMAIN_A = "domain-alpha"
DOMAIN_B = "domain-beta"


class Slice3Run:
    """A recreatable face over one disposable run directory.

    Rebuilding a ``Slice3Run`` for the same directory is exactly what a process
    or host restart does: no in-memory state survives, so every recovery claim
    is proven against what actually reached durable storage.
    """

    def __init__(self, state_root: str | Path, run_id: str = RUN_ID, *, security_domain_id: str = DOMAIN_A):
        self.state_root = Path(state_root)
        self.run_id = run_id
        self.run_v2 = self.state_root / "runs" / run_id / "v2"
        self.run_v2.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.leases = ExecutorLeaseStore(self.run_v2)
        previous = self.leases.load()
        instance = int((previous or {}).get("epoch", 0)) + 1
        self.owner_id = f"slice3-controller-{instance}"
        self.lease = self.leases.acquire(self.owner_id, replace=True)
        self.store = RunStore(self.state_root, run_id)
        self.operations = OperationLedger(self.run_v2, lease_store=self.leases, run_id=run_id)
        self.command_ledger = CommandLedger(self.run_v2)
        self.coordinator = CommandCoordinator(ledger=self.command_ledger, lease_store=self.leases)
        self.projection = EventProjection(self.run_v2, run_id=run_id)
        self.budgets = BudgetStore(self.run_v2, run_id=run_id)
        self.artifacts = ArtifactStore(self.run_v2, security_domain_id=security_domain_id)

    def initialize(self) -> dict[str, Any]:
        return self.store.initialize(mode="v2_shadow", supervisor_profile=SUPERVISOR_PROFILE,
                                     supervisor_account_pool="claude-subscription")

    def artifact_store(self, security_domain_id: str) -> ArtifactStore:
        return ArtifactStore(self.run_v2, security_domain_id=security_domain_id)

    def seed_phase(self, phase_id: str = "phase-1", big_task_id: str = "bt-1") -> None:
        self.store.register_big_task(big_task_id, "/tmp/charter.json", None)
        self.store.register_phase(
            {"phase_id": phase_id, "big_task_id": big_task_id, "phase_kind": "build", "write_capable": True},
            "/tmp/packet.json",
        )


class CountingTransport:
    """Counts side effects that actually crossed the transport boundary."""

    adapter_id = "slice3-deterministic-fake"

    def __init__(self) -> None:
        self.external_effects = 0
        self.submit_count = 0

    def apply(self) -> dict[str, Any]:
        self.submit_count += 1
        self.external_effects += 1
        return {"external_identity": f"effect-{self.external_effects}", "ok": True}


# --------------------------------------------------------------------------
# Budget policy fixtures
# --------------------------------------------------------------------------

def single_unit_policy(*, run_id: str = RUN_ID, limit_value: float = 1.0) -> dict[str, Any]:
    """A policy with exactly one remaining call on the run scope."""

    return make_budget_policy(
        policy_id="budget-single-unit",
        enforcement_mode="warning_only",
        limits=[
            make_limit(
                limit_id="run-calls", scope_kind="run", scope_id=run_id,
                metric="provider_calls", native_unit="calls",
                limit_value=limit_value, action="prohibit",
            )
        ],
    )


def layered_policy(*, run_id: str = RUN_ID) -> dict[str, Any]:
    """Overlapping scopes whose actions differ, to prove the strictest wins."""

    return make_budget_policy(
        policy_id="budget-layered",
        enforcement_mode="warning_only",
        limits=[
            make_limit(limit_id="run-calls", scope_kind="run", scope_id=run_id,
                       metric="provider_calls", native_unit="calls",
                       limit_value=10, action="warn"),
            make_limit(limit_id="role-calls", scope_kind="role", scope_id="builder",
                       metric="provider_calls", native_unit="calls",
                       limit_value=2, action="pause"),
            make_limit(limit_id="account-calls", scope_kind="account", scope_id="acct-1",
                       metric="provider_calls", native_unit="calls",
                       limit_value=2, action="require_approval"),
            make_limit(limit_id="project-calls", scope_kind="project", scope_id="proj-1",
                       metric="provider_calls", native_unit="calls",
                       limit_value=2, action="prohibit"),
        ],
    )


def protected_capacity_policy(*, account_id: str = "acct-protected") -> dict[str, Any]:
    """Generic protected capacity.

    The reserve is ordinary policy data on an ordinary account scope.  Nothing
    in the budget kernel knows which tenant this protects, which is exactly the
    property that keeps a protected instance from becoming a special code path.
    """

    return make_budget_policy(
        policy_id="budget-protected",
        enforcement_mode="warning_only",
        limits=[
            make_limit(
                limit_id="protected-account-calls", scope_kind="account", scope_id=account_id,
                metric="provider_calls", native_unit="calls",
                limit_value=10, action="prohibit",
                protected_reserve_amount=4, protected_reserve_roles=["supervisor", "tech_lead"],
            )
        ],
    )


def scopes_for(*, run_id: str = RUN_ID, role: str = "builder", account: str = "acct-1",
               provider: str = "fake", profile: str = "fake-builder",
               project: str = "proj-1") -> dict[str, Any]:
    return {
        "run": run_id, "role": role, "account": account,
        "provider": provider, "profile": profile, "project": project,
    }


def calls(amount: float = 1.0) -> list[dict[str, Any]]:
    return [{"metric": "provider_calls", "native_unit": "calls", "amount": amount}]


# --------------------------------------------------------------------------
# Artifact fixtures
# --------------------------------------------------------------------------

SECRET_FIXTURES: dict[str, bytes] = {
    "cookie_jar": b"Set-Cookie: session=abc123; HttpOnly\nSet-Cookie: csrf=xyz\n",
    "bearer_token": b"Authorization: Bearer sk-live-000111222333444555\n",
    "private_key": (
        b"-----BEGIN OPENSSH PRIVATE KEY-----\n"
        b"b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAAB\n"
        b"-----END OPENSSH PRIVATE KEY-----\n"
    ),
    "password_config": b"database:\n  user: app\n  password: hunter2superSecret\n",
    "aws_key": b"AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\n",
}

#: A browser profile file whose *bytes* are innocuous.  Only the provenance
#: makes it credential-adjacent, which is why path/name detection matters.
BROWSER_PROFILE_FIXTURE = (b"SQLite format 3\x00" + b"\x00" * 64, "cookies.sqlite",
                           "/home/example/.mozilla/firefox/abc.default/cookies.sqlite")


def large_payload(size_bytes: int = 3 * 1024 * 1024) -> bytes:
    """A deterministic large payload used to prove storage-by-reference."""

    block = b"MLGO-SLICE3-LARGE-OUTPUT-BLOCK-"
    return (block * ((size_bytes // len(block)) + 1))[:size_bytes]


def env_flag(name: str) -> bool:
    return os.environ.get(name, "").strip().lower() in {"1", "true", "yes"}
