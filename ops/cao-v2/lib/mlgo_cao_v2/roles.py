"""Provider-neutral role and authority contracts for MLGO CAO v2 Slice 1."""
from __future__ import annotations

from enum import Enum
from typing import Any, Protocol, runtime_checkable


class RoleId(str, Enum):
    SUPERVISOR = "supervisor"
    TECH_LEAD = "tech_lead"
    BUILDER = "builder"
    REVIEWER = "reviewer"
    SPECIALIST = "specialist"
    VERIFIER = "verifier"


class AuthorityKind(str, Enum):
    REASONING_AUTHORITY = "reasoning_authority"
    EXECUTION_AGENT = "execution_agent"
    REASONING_TOOL = "reasoning_tool"


@runtime_checkable
class ReasoningAuthority(Protocol):
    role_id: str

    def reason(self, request: dict[str, Any]) -> dict[str, Any]: ...


@runtime_checkable
class ExecutionAgent(Protocol):
    role_id: str

    def execute(self, request: dict[str, Any]) -> dict[str, Any]: ...


@runtime_checkable
class ReasoningTool(Protocol):
    role_id: str

    def consult(self, request: dict[str, Any]) -> dict[str, Any]: ...


LEGACY_ROLE_ALIASES = {
    "developer": RoleId.BUILDER.value,
    "reviewer": RoleId.REVIEWER.value,
    "task_lead": RoleId.TECH_LEAD.value,
    "task-lead": RoleId.TECH_LEAD.value,
    "supervisor": RoleId.SUPERVISOR.value,
}


def normalize_role(value: str) -> str:
    raw = str(value or "").strip().lower().replace(" ", "_")
    if raw in {item.value for item in RoleId}:
        return raw
    if raw in LEGACY_ROLE_ALIASES:
        return LEGACY_ROLE_ALIASES[raw]
    raise ValueError(f"unsupported provider-neutral role: {value!r}")
