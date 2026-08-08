"""Atomic hierarchical budgets with native-unit reservations.

Before an expensive governed Command may cross a transport boundary, settled
usage and currently-active reservations are evaluated together, and the
reservation is taken, inside one exclusive lock.  Evaluating and reserving in
separate steps is the classic way two callers both observe "one unit left" and
both proceed; here the observation and the claim are the same critical section,
so exactly one caller can win the last unit.

Everything is expressed in provider-native units.  A limit on calls constrains
calls; a limit in AUD constrains AUD.  Units are matched exactly and are never
converted into each other, because a budget denominated in a fabricated
universal unit would silently mis-enforce every provider that does not report
that unit.

Reservation lifecycle mirrors send certainty rather than optimism:

* confirmed completion   -> settle to a UsageRecord;
* confirmed NOT_SENT     -> release, exactly once;
* ambiguous / UNKNOWN    -> hold, still consuming budget, until reconciliation.

Holding on ambiguity is deliberate.  Releasing a reservation for a request that
may have reached the provider would let the same capacity be spent twice.

This module contains no tenant-, business- or customer-specific branch.
Protected capacity is expressed as a generic reserve on a generic scope, so a
protected instance is policy data rather than a special code path.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Iterable

from .common import (
    ContractError,
    PolicyError,
    atomic_write_json,
    file_lock,
    iso_now,
    load_json,
    sha256_json,
    validate_id,
)

BUDGET_POLICY_SCHEMA_VERSION = "1.0"
BUDGET_RESERVATION_SCHEMA_VERSION = "1.0"
BUDGET_DECISION_SCHEMA_VERSION = "1.0"

#: Scopes a limit may govern.  ``protected_reserve`` is not a separate storage
#: mechanism: it is a reserve carved out of a limit on one of the other scopes,
#: reported under its own scope name so protection is visible in decisions.
SCOPE_KINDS = (
    "run", "milestone", "work_package", "task", "role",
    "provider", "account", "profile", "project",
)

#: Ordered least to most restrictive.  When several limits apply, the strictest
#: action wins; a permissive scope can never soften a stricter one.
ACTIONS = ("allow", "warn", "pause", "require_approval", "prohibit")
_ACTION_SEVERITY = {name: index for index, name in enumerate(ACTIONS)}

#: Reservation states that still consume budget.
CONSUMING_STATES = frozenset({"ACTIVE", "HELD"})
RESERVATION_STATES = frozenset({"ACTIVE", "HELD", "SETTLED", "RELEASED"})


def strictest(actions: Iterable[str]) -> str:
    """Return the most restrictive of several applicable actions."""

    best = "allow"
    for action in actions:
        if action not in _ACTION_SEVERITY:
            raise ContractError(f"unknown budget action: {action!r}")
        if _ACTION_SEVERITY[action] > _ACTION_SEVERITY[best]:
            best = action
    return best


def make_limit(
    *,
    limit_id: str,
    scope_kind: str,
    scope_id: str,
    metric: str,
    native_unit: str,
    limit_value: float,
    action: str = "prohibit",
    protected_reserve_amount: float = 0.0,
    protected_reserve_roles: Iterable[str] | None = None,
) -> dict[str, Any]:
    """Build one budget limit in a provider-native unit."""

    validate_id(limit_id, "limit_id")
    if scope_kind not in SCOPE_KINDS:
        raise ContractError(f"unknown budget scope kind: {scope_kind!r}")
    if action not in ACTIONS:
        raise ContractError(f"unknown budget action: {action!r}")
    if not isinstance(native_unit, str) or not native_unit.strip():
        raise ContractError("budget limit requires an explicit provider-native unit")
    if float(limit_value) < 0:
        raise ContractError("budget limit_value must be non-negative")
    reserve = float(protected_reserve_amount or 0.0)
    roles = sorted({str(r) for r in (protected_reserve_roles or [])})
    if reserve and not roles:
        raise ContractError("a protected reserve must name the roles it is reserved for")
    if reserve > float(limit_value):
        raise ContractError("protected reserve cannot exceed the limit it protects")
    return {
        "limit_id": limit_id,
        "scope_kind": scope_kind,
        "scope_id": scope_id,
        "metric": metric,
        "native_unit": native_unit,
        "limit_value": float(limit_value),
        "action": action,
        "protected_reserve": {"amount": reserve, "reserved_for_roles": roles} if reserve else None,
    }


def make_budget_policy(*, policy_id: str, limits: list[dict[str, Any]], enforcement_mode: str = "warning_only") -> dict[str, Any]:
    """Build a budget policy.

    ``enforcement_mode`` describes what the *live* system does with a decision.
    The decision itself is always computed with full hard semantics so that the
    correctness of enforcement can be proven long before it is switched on.
    """

    validate_id(policy_id, "policy_id")
    if enforcement_mode not in {"warning_only", "hard"}:
        raise ContractError(f"invalid budget enforcement mode: {enforcement_mode!r}")
    record = {
        "schema_version": BUDGET_POLICY_SCHEMA_VERSION,
        "policy_id": policy_id,
        "enforcement_mode": enforcement_mode,
        "limits": list(limits),
    }
    record["policy_digest"] = sha256_json({k: v for k, v in record.items() if k != "policy_digest"})
    return record


def _request_key(request: dict[str, Any]) -> tuple[str, str]:
    return (str(request["metric"]), str(request["native_unit"]))


class BudgetExceeded(PolicyError):
    """Raised when hard semantics refuse a reservation."""

    def __init__(self, decision: dict[str, Any]):
        self.decision = decision
        super().__init__(
            f"budget action {decision['action']} for command {decision.get('command_id')}: "
            f"{decision.get('reason')}"
        )


class BudgetStore:
    """Durable reservations, settlements and decisions for one run."""

    def __init__(self, run_v2_dir: str | Path, *, run_id: str | None = None):
        self.root = Path(run_v2_dir) / "budgets"
        self.reservations_dir = self.root / "reservations"
        self.settlements_dir = self.root / "settlements"
        self.decisions_dir = self.root / "decisions"
        self.lock_path = self.root / ".budgets.lock"
        self.run_id = run_id or Path(run_v2_dir).parent.name
        for path in (self.reservations_dir, self.settlements_dir, self.decisions_dir):
            path.mkdir(parents=True, exist_ok=True, mode=0o700)

    # -- reads ------------------------------------------------------------

    def reservation_path(self, command_id: str) -> Path:
        validate_id(command_id, "command_id")
        return self.reservations_dir / f"{command_id}.json"

    def load_reservation(self, command_id: str) -> dict[str, Any] | None:
        path = self.reservation_path(command_id)
        return load_json(path) if path.exists() else None

    def list_reservations(self) -> list[dict[str, Any]]:
        return [load_json(p) for p in sorted(self.reservations_dir.glob("*.json"))]

    def list_settlements(self) -> list[dict[str, Any]]:
        return [load_json(p) for p in sorted(self.settlements_dir.glob("*.json"))]

    # -- accounting -------------------------------------------------------

    def _consumption_unlocked(self) -> dict[tuple[str, str, str, str], float]:
        """Settled usage plus still-consuming reservations, per scope and unit.

        Both halves must be counted together.  Counting only settled usage
        would let a burst of in-flight work blow through a limit before any of
        it settles; counting only reservations would forget everything that
        already completed.
        """

        totals: dict[tuple[str, str, str, str], float] = {}

        def add(scopes: dict[str, Any], metric: str, unit: str, amount: float) -> None:
            for scope_kind, scope_id in (scopes or {}).items():
                if scope_id is None:
                    continue
                key = (str(scope_kind), str(scope_id), metric, unit)
                totals[key] = totals.get(key, 0.0) + float(amount)

        for settlement in self.list_settlements():
            scopes = settlement.get("scopes") or {}
            for item in settlement.get("settled") or []:
                add(scopes, str(item["metric"]), str(item["native_unit"]), float(item["amount"]))

        for reservation in self.list_reservations():
            if reservation.get("status") not in CONSUMING_STATES:
                continue
            scopes = reservation.get("scopes") or {}
            for item in reservation.get("requests") or []:
                add(scopes, str(item["metric"]), str(item["native_unit"]), float(item["amount"]))

        return totals

    def _applicable_limits(
        self, policy: dict[str, Any], scopes: dict[str, Any], metric: str, unit: str
    ) -> list[dict[str, Any]]:
        out = []
        for limit in policy.get("limits") or []:
            if str(limit["metric"]) != metric:
                continue
            # Units are matched exactly.  A limit expressed in one native unit
            # says nothing about consumption measured in another.
            if str(limit["native_unit"]) != unit:
                continue
            if scopes.get(limit["scope_kind"]) != limit["scope_id"]:
                continue
            out.append(limit)
        return out

    def _effective_capacity(self, limit: dict[str, Any], actor_role: str | None) -> tuple[float, dict[str, Any] | None]:
        """Capacity visible to this actor after any protected reserve."""

        reserve = limit.get("protected_reserve")
        if not reserve:
            return float(limit["limit_value"]), None
        if actor_role is not None and str(actor_role) in set(reserve.get("reserved_for_roles") or []):
            return float(limit["limit_value"]), {
                "scope_kind": "protected_reserve",
                "limit_id": limit["limit_id"],
                "amount": float(reserve["amount"]),
                "reserved_for_roles": reserve["reserved_for_roles"],
                "actor_has_access": True,
            }
        return float(limit["limit_value"]) - float(reserve["amount"]), {
            "scope_kind": "protected_reserve",
            "limit_id": limit["limit_id"],
            "amount": float(reserve["amount"]),
            "reserved_for_roles": reserve["reserved_for_roles"],
            "actor_has_access": False,
        }

    def evaluate(
        self,
        *,
        policy: dict[str, Any],
        scopes: dict[str, Any],
        requests: list[dict[str, Any]],
        actor_role: str | None = None,
        command_id: str | None = None,
    ) -> dict[str, Any]:
        """Evaluate without reserving (read-only shadow decision)."""

        with file_lock(self.lock_path):
            return self._evaluate_unlocked(
                policy=policy, scopes=scopes, requests=requests,
                actor_role=actor_role, command_id=command_id,
                consumption=self._consumption_unlocked(),
            )

    def _evaluate_unlocked(
        self,
        *,
        policy: dict[str, Any],
        scopes: dict[str, Any],
        requests: list[dict[str, Any]],
        actor_role: str | None,
        command_id: str | None,
        consumption: dict[tuple[str, str, str, str], float],
    ) -> dict[str, Any]:
        evaluations: list[dict[str, Any]] = []
        protected: list[dict[str, Any]] = []
        actions: list[str] = ["allow"]

        for request in requests:
            metric, unit = _request_key(request)
            amount = float(request["amount"])
            if amount < 0:
                raise ContractError("budget request amount must be non-negative")
            for limit in self._applicable_limits(policy, scopes, metric, unit):
                capacity, reserve_note = self._effective_capacity(limit, actor_role)
                if reserve_note:
                    protected.append(reserve_note)
                used = consumption.get(
                    (str(limit["scope_kind"]), str(limit["scope_id"]), metric, unit), 0.0
                )
                projected = used + amount
                exceeded = projected > capacity + 1e-9
                evaluations.append({
                    "limit_id": limit["limit_id"],
                    "scope_kind": limit["scope_kind"],
                    "scope_id": limit["scope_id"],
                    "metric": metric,
                    "native_unit": unit,
                    "limit_value": float(limit["limit_value"]),
                    "effective_capacity": capacity,
                    "already_consumed": used,
                    "requested": amount,
                    "projected": projected,
                    "exceeded": exceeded,
                    "action": limit["action"] if exceeded else "allow",
                    "reason": (
                        f"{metric} in {unit}: {used} consumed + {amount} requested "
                        f"exceeds effective capacity {capacity} on {limit['scope_kind']}"
                        f"={limit['scope_id']}"
                    ) if exceeded else (
                        f"{metric} in {unit}: {projected} of {capacity} on "
                        f"{limit['scope_kind']}={limit['scope_id']}"
                    ),
                })
                actions.append(limit["action"] if exceeded else "allow")

        action = strictest(actions)
        breached = [item for item in evaluations if item["exceeded"]]
        decision = {
            "schema_version": BUDGET_DECISION_SCHEMA_VERSION,
            "run_id": self.run_id,
            "command_id": command_id,
            "actor_role": actor_role,
            "scopes": dict(scopes),
            "requests": [dict(r) for r in requests],
            "action": action,
            "allowed": action in {"allow", "warn"},
            "evaluations": evaluations,
            "breached_limits": [item["limit_id"] for item in breached],
            "protected_reserves": protected,
            "policy_digest": policy.get("policy_digest"),
            "enforcement_mode": policy.get("enforcement_mode", "warning_only"),
            "reason": "; ".join(item["reason"] for item in breached) or "within all applicable limits",
            "decided_at": iso_now(),
        }
        decision["decision_digest"] = sha256_json(
            {k: v for k, v in decision.items() if k not in {"decision_digest", "decided_at"}}
        )
        return decision

    # -- reservation lifecycle -------------------------------------------

    def evaluate_and_reserve(
        self,
        *,
        command_id: str,
        policy: dict[str, Any],
        scopes: dict[str, Any],
        requests: list[dict[str, Any]],
        actor_role: str | None = None,
    ) -> dict[str, Any]:
        """Atomically evaluate and, if permitted, take the reservation.

        Evaluation and reservation share one critical section.  This is the
        property that makes the last remaining unit unwinnable by two callers.
        """

        validate_id(command_id, "command_id")
        request_digest = sha256_json([dict(sorted(r.items())) for r in requests])

        with file_lock(self.lock_path):
            existing = self.load_reservation(command_id)
            if existing is not None:
                # Idempotent: one Command holds at most one reservation, so a
                # retry after a crash re-uses it instead of double-reserving.
                if existing.get("request_digest") != request_digest:
                    raise PolicyError(
                        f"reservation for command {command_id} already exists with different requests"
                    )
                return {
                    "reservation": existing,
                    "decision": existing.get("decision"),
                    "duplicate": True,
                    "reserved": existing.get("status") in CONSUMING_STATES,
                }

            decision = self._evaluate_unlocked(
                policy=policy, scopes=scopes, requests=requests,
                actor_role=actor_role, command_id=command_id,
                consumption=self._consumption_unlocked(),
            )
            atomic_write_json(self.decisions_dir / f"{command_id}.json", decision)

            if not decision["allowed"]:
                return {"reservation": None, "decision": decision, "duplicate": False, "reserved": False}

            reservation = {
                "schema_version": BUDGET_RESERVATION_SCHEMA_VERSION,
                "reservation_id": f"res-{command_id}",
                "command_id": command_id,
                "run_id": self.run_id,
                "actor_role": actor_role,
                "scopes": dict(scopes),
                "requests": [dict(r) for r in requests],
                "request_digest": request_digest,
                "status": "ACTIVE",
                "decision": decision,
                "created_at": iso_now(),
                "updated_at": iso_now(),
                "history": [{"status": "ACTIVE", "at": iso_now(), "reason": "reserved before governed command"}],
            }
            atomic_write_json(self.reservation_path(command_id), reservation)
            return {"reservation": reservation, "decision": decision, "duplicate": False, "reserved": True}

    def _transition(self, command_id: str, target: str, *, reason: str, **updates: Any) -> dict[str, Any]:
        if target not in RESERVATION_STATES:
            raise ContractError(f"unknown reservation state: {target!r}")
        record = self.load_reservation(command_id)
        if record is None:
            raise ContractError(f"unknown reservation for command: {command_id}")
        history = list(record.get("history") or [])
        history.append({"status": target, "at": iso_now(), "reason": reason})
        record.update(updates)
        record["status"] = target
        record["history"] = history
        record["updated_at"] = iso_now()
        atomic_write_json(self.reservation_path(command_id), record)
        return record

    def settle(self, command_id: str, *, settled: list[dict[str, Any]], usage_record: dict[str, Any] | None = None) -> dict[str, Any]:
        """Convert a reservation into settled usage on confirmed completion."""

        with file_lock(self.lock_path):
            record = self.load_reservation(command_id)
            if record is None:
                raise ContractError(f"unknown reservation for command: {command_id}")
            if record["status"] == "SETTLED":
                return {**record, "duplicate": True}
            if record["status"] == "RELEASED":
                raise PolicyError(
                    f"reservation for {command_id} was released as NOT_SENT and cannot settle usage"
                )
            for item in settled:
                if not str(item.get("native_unit") or "").strip():
                    raise ContractError("settled usage must carry an explicit native unit")
            settlement = {
                "schema_version": "1.0",
                "command_id": command_id,
                "run_id": self.run_id,
                "scopes": record.get("scopes"),
                "settled": [dict(item) for item in settled],
                "usage_record_id": (usage_record or {}).get("usage_record_id"),
                "settled_at": iso_now(),
            }
            atomic_write_json(self.settlements_dir / f"{command_id}.json", settlement)
            updated = self._transition(
                command_id, "SETTLED",
                reason="confirmed completion settled to UsageRecord",
                settlement=settlement,
            )
            return {**updated, "duplicate": False}

    def release(self, command_id: str, *, certainty: str) -> dict[str, Any]:
        """Release a reservation, and only for a *confirmed* non-send.

        Release is idempotent so a retried recovery path cannot credit the same
        capacity twice, and it is refused for any certainty other than a proven
        NOT_SENT, because releasing an ambiguous request would double-spend.
        """

        with file_lock(self.lock_path):
            record = self.load_reservation(command_id)
            if record is None:
                raise ContractError(f"unknown reservation for command: {command_id}")
            if certainty != "NOT_SENT_CONFIRMED":
                raise PolicyError(
                    f"reservation for {command_id} may only be released on NOT_SENT_CONFIRMED, "
                    f"not {certainty!r}; ambiguous sends must be held"
                )
            if record["status"] == "RELEASED":
                return {**record, "duplicate": True}
            if record["status"] == "SETTLED":
                raise PolicyError(f"reservation for {command_id} already settled and cannot be released")
            updated = self._transition(
                command_id, "RELEASED", reason="confirmed NOT_SENT; capacity returned exactly once"
            )
            return {**updated, "duplicate": False}

    def hold(self, command_id: str, *, reason: str) -> dict[str, Any]:
        """Hold a reservation whose send outcome is ambiguous."""

        with file_lock(self.lock_path):
            record = self.load_reservation(command_id)
            if record is None:
                raise ContractError(f"unknown reservation for command: {command_id}")
            if record["status"] in {"SETTLED", "RELEASED"}:
                return {**record, "duplicate": True}
            if record["status"] == "HELD":
                return {**record, "duplicate": True}
            return {
                **self._transition(
                    command_id, "HELD",
                    reason=reason,
                    requires_reconciliation=True,
                ),
                "duplicate": False,
            }

    # -- replay -----------------------------------------------------------

    def replay(self, *, command_states: dict[str, str] | None = None) -> dict[str, Any]:
        """Reconstruct reservation state after a crash and report leaks.

        A leak is a reservation still consuming budget whose Command has
        already reached a terminal, unambiguous outcome.  Those are exactly the
        reservations that a crash between "decide the outcome" and "settle or
        release it" leaves stranded, and they must be surfaced rather than
        quietly reclaimed.
        """

        command_states = dict(command_states or {})
        with file_lock(self.lock_path):
            active: list[str] = []
            held: list[str] = []
            leaked: list[dict[str, Any]] = []
            for record in self.list_reservations():
                command_id = str(record["command_id"])
                status = str(record["status"])
                if status == "ACTIVE":
                    active.append(command_id)
                elif status == "HELD":
                    held.append(command_id)
                if status not in CONSUMING_STATES:
                    continue
                command_status = command_states.get(command_id)
                if command_status == "NOT_SENT_CONFIRMED":
                    leaked.append({
                        "command_id": command_id, "reservation_status": status,
                        "command_status": command_status,
                        "resolution": "release",
                        "reason": "command confirmed NOT_SENT but reservation still consumes budget",
                    })
                elif command_status in {"COMPLETED", "FAILED", "CANCELLED"}:
                    leaked.append({
                        "command_id": command_id, "reservation_status": status,
                        "command_status": command_status,
                        "resolution": "settle",
                        "reason": "command reached a terminal outcome but reservation was never settled",
                    })
                elif command_status in {"UNKNOWN_AFTER_SUBMIT", "RECONCILIATION_REQUIRED"} and status == "ACTIVE":
                    leaked.append({
                        "command_id": command_id, "reservation_status": status,
                        "command_status": command_status,
                        "resolution": "hold",
                        "reason": "ambiguous send must be held until reconciliation",
                    })
            return {
                "run_id": self.run_id,
                "active": sorted(active),
                "held": sorted(held),
                "consuming": sorted(active + held),
                "leaked": sorted(leaked, key=lambda item: item["command_id"]),
                "leak_count": len(leaked),
                "replayed_at": iso_now(),
            }

    def usage_report(self, policy: dict[str, Any]) -> dict[str, Any]:
        """Current consumption per limit, in native units only."""

        with file_lock(self.lock_path):
            consumption = self._consumption_unlocked()
            rows = []
            for limit in policy.get("limits") or []:
                key = (
                    str(limit["scope_kind"]), str(limit["scope_id"]),
                    str(limit["metric"]), str(limit["native_unit"]),
                )
                rows.append({
                    "limit_id": limit["limit_id"],
                    "scope_kind": limit["scope_kind"],
                    "scope_id": limit["scope_id"],
                    "metric": limit["metric"],
                    "native_unit": limit["native_unit"],
                    "limit_value": float(limit["limit_value"]),
                    "consumed": consumption.get(key, 0.0),
                })
            return {
                "run_id": self.run_id,
                "enforcement_mode": policy.get("enforcement_mode", "warning_only"),
                "limits": rows,
                "generated_at": iso_now(),
            }
