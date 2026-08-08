"""Hybrid Tech Lead authority brokering and capability/authority separation.

Two independent axes are deliberately kept apart:

* **semantic authority** - who may decide.  A ``ReasoningAuthority`` can be
  fully authoritative for project/milestone decisions.
* **machine execution capability** - who can actually touch the host.  A
  reasoning authority may have no filesystem, shell, local Git, service control
  or any other host capability at all.

Conflating them is what breaks integrations: a semantically authoritative role
gets handed a mechanical action it cannot perform, or - worse - a role that can
perform the action silently inherits the decision.  The broker below routes
mechanical actions to deterministic host execution or an ``ExecutionAgent``
while leaving semantic authority exactly where it was delegated.

The seams here are generic.  No provider, product or adapter name appears in
this module; capability facts come from the registry/qualification layer.
"""

from __future__ import annotations

from typing import Any

from .checkpoints import validate_checkpoint, validate_conversation_handle
from .common import ContractError, PolicyError, iso_now, sha256_json
from .context_envelope import STATUS_WITHIN_CAP, assert_within_cap
from .decisions import (
    MODE_ADJUDICATE,
    MODE_CONSULT,
    MODE_ESCALATE,
    DecisionLedger,
    new_authority_request,
)

#: Generic host capability names.  These describe machine execution, never
#: semantic standing.
CAP_SEMANTIC_AUTHORITY = "semantic_authority"
CAP_FILESYSTEM = "filesystem"
CAP_SHELL = "shell"
CAP_LOCAL_GIT = "local_git"
CAP_SERVICE_CONTROL = "service_control"
CAP_STRUCTURED_RESULT = "structured_result"

MECHANICAL_CAPABILITIES = (CAP_FILESYSTEM, CAP_SHELL, CAP_LOCAL_GIT, CAP_SERVICE_CONTROL)

#: Which capability each mechanical action kind requires.
ACTION_CAPABILITY = {
    "read_repository": CAP_FILESYSTEM,
    "write_repository": CAP_FILESYSTEM,
    "run_command": CAP_SHELL,
    "git_operation": CAP_LOCAL_GIT,
    "service_operation": CAP_SERVICE_CONTROL,
}

EXECUTOR_REASONING_AUTHORITY = "reasoning_authority"
EXECUTOR_EXECUTION_AGENT = "execution_agent"
EXECUTOR_DETERMINISTIC_HOST = "deterministic_host"


def has_capability(capabilities: dict[str, Any] | None, name: str) -> bool:
    """A bare truthy value is not qualification evidence; mirror Slice 1 rules."""

    item = (capabilities or {}).get(name)
    if isinstance(item, dict):
        return bool(item.get("enabled"))
    return False


def route_action(
    *,
    action_kind: str,
    semantic_authority_role: str,
    authority_capabilities: dict[str, Any] | None,
    execution_agent_capabilities: dict[str, Any] | None = None,
    deterministic_host_capabilities: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Route one mechanical action without transferring semantic authority."""

    if action_kind not in ACTION_CAPABILITY:
        raise ContractError(f"unknown mechanical action kind: {action_kind!r}")
    required = ACTION_CAPABILITY[action_kind]
    candidates = (
        (EXECUTOR_DETERMINISTIC_HOST, deterministic_host_capabilities),
        (EXECUTOR_EXECUTION_AGENT, execution_agent_capabilities),
        (EXECUTOR_REASONING_AUTHORITY, authority_capabilities),
    )
    for executor, capabilities in candidates:
        if has_capability(capabilities, required):
            return {
                "action_kind": action_kind,
                "required_capability": required,
                "executor": executor,
                "semantic_authority_role": semantic_authority_role,
                "semantic_authority_transferred": False,
                "routed_at": iso_now(),
            }
    raise PolicyError(
        f"no routable executor holds the {required!r} capability for action {action_kind!r}; "
        "semantic authority is not a substitute for machine execution capability"
    )


class AuthorityBroker:
    """Bind a Tech Lead's full current state to every authority request."""

    def __init__(
        self,
        ledger: DecisionLedger,
        *,
        delegated_scope: list[str],
        authority_role: str = "authoritative_supervisor",
        requester_role: str = "tech_lead",
    ):
        self.ledger = ledger
        self.delegated_scope = sorted(set(delegated_scope))
        self.authority_role = authority_role
        self.requester_role = requester_role
        self.provider_sends = 0

    def prepare_request(
        self,
        *,
        request_id: str,
        mode: str,
        requested_scope: list[str],
        question: str,
        execution_state: dict[str, Any],
        context_manifest: dict[str, Any],
        checkpoint: dict[str, Any],
        conversation_handle: dict[str, Any] | None = None,
        delegation_revision: str,
        charter_revision: str,
        evidence_refs: list[dict[str, Any]] | None = None,
        episode_id: str | None = None,
        supersedes_request_id: str | None = None,
    ) -> dict[str, Any]:
        """Build and persist a request bound to exact state/context/checkpoint.

        The complete CAO-controlled serialized request is checked against the
        hard context envelope cap *before* anything could be sent, and the
        conversation handle identity is validated at the same boundary.
        """

        if mode not in (MODE_CONSULT, MODE_ADJUDICATE, MODE_ESCALATE):
            raise ContractError(f"unknown authority mode: {mode!r}")
        validate_checkpoint(checkpoint)
        if conversation_handle is not None:
            validate_conversation_handle(conversation_handle)
        if context_manifest.get("status") != STATUS_WITHIN_CAP:
            assert_within_cap(context_manifest)  # raises with the exact durable reason

        state_revision = int(execution_state.get("last_committed_state_version", 0))
        request = new_authority_request(
            request_id=request_id,
            run_id=execution_state["run_id"],
            task_id=execution_state["task_id"],
            big_task_id=execution_state["big_task_id"],
            requester_role=self.requester_role,
            authority_role=self.authority_role,
            mode=mode,
            requested_scope=requested_scope,
            state_revision=state_revision,
            context_manifest_digest=context_manifest["manifest_digest"],
            checkpoint_digest=checkpoint["content_digest"],
            delegation_revision=delegation_revision,
            charter_revision=charter_revision,
            delegated_scope=self.delegated_scope,
            question=question,
            evidence_refs=evidence_refs,
            episode_id=episode_id,
            supersedes_request_id=supersedes_request_id,
        )
        request["execution_state_digest"] = sha256_json(execution_state)
        request["conversation_handle_digest"] = (
            conversation_handle["handle_digest"] if conversation_handle else None
        )
        request["request_digest"] = sha256_json(
            {k: v for k, v in request.items() if k != "request_digest"}
        )
        return self.ledger.open_request(request)

    def reconsult(
        self,
        *,
        stale_request: dict[str, Any],
        request_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Open a fresh request after a stale decision.

        The superseded request record stays immutable; only a new request ID
        with freshly bound revisions may proceed.
        """

        if request_id == stale_request["request_id"]:
            raise PolicyError("a reconsult after STALE_DECISION requires a fresh request ID")
        kwargs.setdefault("mode", stale_request["mode"])
        kwargs.setdefault("requested_scope", stale_request["requested_scope"])
        kwargs.setdefault("question", stale_request["question"])
        return self.prepare_request(
            request_id=request_id,
            supersedes_request_id=stale_request["request_id"],
            **kwargs,
        )
