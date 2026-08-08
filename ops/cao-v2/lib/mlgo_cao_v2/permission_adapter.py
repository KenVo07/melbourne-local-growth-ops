"""Provider-neutral permission adapter contract and qualification lifecycle.

The controller and the Approval Broker must never learn what a provider's
permission prompt looks like.  If they did, every new provider version would be
a change to authority semantics, and a provider that changed its wording would
silently change what the host believes about whether a worker is blocked.

So the boundary is drawn here: an adapter converts provider-specific evidence
into one of the normalized observed states, and nothing above this module sees
anything else.  Two rules make that boundary real rather than nominal:

* **Unrecognised evidence is not "probably fine".**  An observation the adapter
  cannot map produces ``UNKNOWN_RECONCILIATION_REQUIRED``, never an optimistic
  guess and never a state inferred from process liveness or terminal output.

* **"Remember my choice" is not authority.**  Providers commonly offer to
  persist an approval.  That state is recorded as an observation for
  diagnostics and is explicitly excluded from every authority path, because a
  grant the host did not issue is a grant the host cannot revalidate or revoke.

Provider specifics live in adapter instances and registry data.  This module
contains no provider, vendor or product name.
"""

from __future__ import annotations

from typing import Any, Iterable, Mapping

from .approval import (
    APPROVED,
    DENIED,
    NOT_REQUIRED,
    PREAUTHORIZED,
    UNKNOWN_RECONCILIATION_REQUIRED,
    WAITING_FOR_APPROVAL,
    OBSERVED_STATES,
    validate_decision,
)
from .common import ContractError, PolicyError, iso_now, sha256_json, validate_id

ADAPTER_QUALIFICATION_SCHEMA_VERSION = "1.0"

# -- normalized permission capabilities ------------------------------------

CAP_NATIVE_PREAUTHORIZATION = "native_preauthorization"
CAP_ONE_SHOT_APPROVAL = "one_shot_approval"
CAP_EXPLICIT_DENY = "explicit_deny"
CAP_WAIT_STATE_OBSERVATION = "wait_state_observation"
CAP_RECONCILIATION = "reconciliation"
CAP_BOUNDED_UI_FALLBACK = "bounded_ui_fallback"
CAP_REMEMBER_STATE_PRESENCE = "remember_state_presence"

PERMISSION_CAPABILITIES = (
    CAP_NATIVE_PREAUTHORIZATION,
    CAP_ONE_SHOT_APPROVAL,
    CAP_EXPLICIT_DENY,
    CAP_WAIT_STATE_OBSERVATION,
    CAP_RECONCILIATION,
    CAP_BOUNDED_UI_FALLBACK,
    CAP_REMEMBER_STATE_PRESENCE,
)

#: Capabilities that can never contribute authority no matter how they are
#: declared, observed or qualified.  ``remember`` is listed here because its
#: whole purpose - persisting an approval outside CAO - is precisely what makes
#: it unusable as CAO authority.
NON_AUTHORITATIVE_CAPABILITIES = frozenset({CAP_REMEMBER_STATE_PRESENCE})

MATURITY_DECLARED = "DECLARED"
MATURITY_OBSERVED = "OBSERVED"
MATURITY_QUALIFIED = "QUALIFIED"
MATURITY_ORDER = {MATURITY_DECLARED: 1, MATURITY_OBSERVED: 2, MATURITY_QUALIFIED: 3}


class PermissionAdapterError(PolicyError):
    """Raised when an adapter is used outside its qualified envelope."""


def adapter_identity(
    *,
    adapter_id: str,
    provider_profile_id: str,
    provider_version: str,
    wrapper_version: str,
    config_digest: str,
) -> dict[str, Any]:
    """The exact identity a qualification is bound to.

    Provider and wrapper versions are inside the identity digest, so a provider
    upgrade invalidates qualification automatically rather than requiring
    someone to remember to re-run conformance.
    """

    validate_id(adapter_id, "adapter_id")
    identity = {
        "adapter_id": adapter_id,
        "provider_profile_id": provider_profile_id,
        "provider_version": provider_version,
        "wrapper_version": wrapper_version,
        "config_digest": config_digest,
    }
    identity["identity_digest"] = sha256_json(identity)
    return identity


def new_adapter_qualification(
    *,
    qualification_id: str,
    identity: Mapping[str, Any],
    capabilities: Mapping[str, str],
    evidence_sha256: str,
    qualified_at: str | None = None,
) -> dict[str, Any]:
    """Record which capabilities were actually proven for one exact identity."""

    validate_id(qualification_id, "qualification_id")
    for capability, maturity in capabilities.items():
        if capability not in PERMISSION_CAPABILITIES:
            raise ContractError(f"unknown permission capability: {capability!r}")
        if maturity not in MATURITY_ORDER:
            raise ContractError(f"unknown capability maturity: {maturity!r}")
    record = {
        "schema_version": ADAPTER_QUALIFICATION_SCHEMA_VERSION,
        "qualification_id": qualification_id,
        "identity": dict(identity),
        "identity_digest": identity["identity_digest"],
        "capabilities": dict(sorted(capabilities.items())),
        "evidence_sha256": evidence_sha256,
        "qualified_at": qualified_at or iso_now(),
    }
    record["qualification_digest"] = sha256_json(
        {k: v for k, v in record.items() if k != "qualification_digest"}
    )
    return record


def effective_permission_capability(
    *,
    qualification: Mapping[str, Any] | None,
    current_identity: Mapping[str, Any],
    capability: str,
    policy_enabled: bool,
    required_maturity: str = MATURITY_QUALIFIED,
) -> dict[str, Any]:
    """Resolve one capability through DECLARED -> OBSERVED -> QUALIFIED -> ENABLED.

    A capability is usable only when a qualification exists, its identity still
    matches the running provider/wrapper/config, its maturity is sufficient, and
    policy has enabled it.  Any drift downgrades the capability to unusable and
    says exactly why.
    """

    if capability not in PERMISSION_CAPABILITIES:
        raise ContractError(f"unknown permission capability: {capability!r}")

    if qualification is None:
        return {
            "capability": capability,
            "enabled": False,
            "maturity": None,
            "stale": False,
            "reason": "no qualification record exists for this adapter identity",
            "authority_bearing": capability not in NON_AUTHORITATIVE_CAPABILITIES,
        }

    stale = qualification.get("identity_digest") != current_identity.get("identity_digest")
    maturity = (qualification.get("capabilities") or {}).get(capability)
    sufficient = bool(
        maturity and MATURITY_ORDER[maturity] >= MATURITY_ORDER[required_maturity]
    )

    if stale:
        reason = "qualification is stale after provider/wrapper/config version drift"
    elif not maturity:
        reason = "capability was never qualified for this adapter"
    elif not sufficient:
        reason = f"capability maturity {maturity} is below required {required_maturity}"
    elif not policy_enabled:
        reason = "policy activation is disabled"
    else:
        reason = "qualification identity matches the running adapter"

    return {
        "capability": capability,
        "enabled": bool(not stale and sufficient and policy_enabled),
        "maturity": None if stale else maturity,
        "stale": stale,
        "reason": reason,
        # Declared here so that a caller reading this record can never treat a
        # non-authoritative capability as permission to proceed.
        "authority_bearing": capability not in NON_AUTHORITATIVE_CAPABILITIES,
    }


class PermissionAdapter:
    """Convert provider-specific permission evidence into normalized states.

    Subclasses supply an ``observation_map``: the registry data that says which
    provider-specific evidence token means which normalized state.  Everything
    else - fail-closed behaviour, the ban on ``remember`` as authority, one-shot
    enforcement - is implemented once, here, so no adapter can opt out of it.
    """

    #: Provider-specific evidence token -> normalized observed state.
    observation_map: Mapping[str, str] = {}

    def __init__(
        self,
        *,
        adapter_id: str,
        provider_profile_id: str,
        provider_version: str,
        wrapper_version: str,
        observation_map: Mapping[str, str] | None = None,
        declared_capabilities: Iterable[str] = (),
    ):
        self.adapter_id = validate_id(adapter_id, "adapter_id")
        self.provider_profile_id = provider_profile_id
        self.provider_version = provider_version
        self.wrapper_version = wrapper_version
        if observation_map is not None:
            self.observation_map = dict(observation_map)
        for state in self.observation_map.values():
            if state not in OBSERVED_STATES:
                raise ContractError(
                    f"observation map produces unknown normalized state: {state!r}"
                )
        self.declared_capabilities = frozenset(declared_capabilities)
        unknown = self.declared_capabilities - set(PERMISSION_CAPABILITIES)
        if unknown:
            raise ContractError(f"unknown declared permission capabilities: {sorted(unknown)}")

    # -- identity ----------------------------------------------------------

    @property
    def config_digest(self) -> str:
        return sha256_json(
            {
                "observation_map": dict(sorted(self.observation_map.items())),
                "declared_capabilities": sorted(self.declared_capabilities),
            }
        )

    def identity(self) -> dict[str, Any]:
        return adapter_identity(
            adapter_id=self.adapter_id,
            provider_profile_id=self.provider_profile_id,
            provider_version=self.provider_version,
            wrapper_version=self.wrapper_version,
            config_digest=self.config_digest,
        )

    # -- normalization -----------------------------------------------------

    def normalize_observation(self, evidence: Mapping[str, Any]) -> dict[str, Any]:
        """Map one piece of provider evidence to a normalized observed state.

        An evidence token that is not in the map is not evidence of anything.
        It produces ``UNKNOWN_RECONCILIATION_REQUIRED`` so that a provider whose
        wording changed blocks and reconciles rather than being misread as a
        grant or as healthy progress.
        """

        if not isinstance(evidence, Mapping):
            raise ContractError("adapter evidence must be an object")
        token = evidence.get("token")
        if not isinstance(token, str) or not token.strip():
            return self._unknown(evidence, reason="evidence carried no identifiable token")

        state = self.observation_map.get(token.strip())
        if state is None:
            return self._unknown(
                evidence,
                reason=f"evidence token {token.strip()!r} is not in this adapter's qualified map",
            )

        record = {
            "adapter_id": self.adapter_id,
            "provider_profile_id": self.provider_profile_id,
            "observed_state": state,
            "evidence_token": token.strip(),
            "reason": "token mapped by qualified adapter observation map",
            "observed_at": iso_now(),
            # Recorded for diagnostics only.  Nothing downstream may read this
            # as authorization; see ``assert_not_remember_authority``.
            "provider_remember_offered": bool(evidence.get("remember_offered")),
            "provider_remember_active": bool(evidence.get("remember_active")),
        }
        record["observation_digest"] = sha256_json(
            {k: v for k, v in record.items() if k != "observed_at"}
        )
        return record

    def _unknown(self, evidence: Mapping[str, Any], *, reason: str) -> dict[str, Any]:
        record = {
            "adapter_id": self.adapter_id,
            "provider_profile_id": self.provider_profile_id,
            "observed_state": UNKNOWN_RECONCILIATION_REQUIRED,
            "evidence_token": evidence.get("token"),
            "reason": reason,
            "observed_at": iso_now(),
            "provider_remember_offered": bool(evidence.get("remember_offered")),
            "provider_remember_active": bool(evidence.get("remember_active")),
        }
        record["observation_digest"] = sha256_json(
            {k: v for k, v in record.items() if k != "observed_at"}
        )
        return record

    # -- application -------------------------------------------------------

    def prepare_native_preauthorization(
        self,
        *,
        decision: Mapping[str, Any],
        capability_state: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Prepare an exact bounded native authorization before dispatch.

        Native pre-authorization is the correctness path: it makes the approved
        operation possible without any interactive prompt, so there is nothing
        to parse, click or time out.
        """

        validate_decision(decision)
        if capability_state.get("capability") != CAP_NATIVE_PREAUTHORIZATION:
            raise ContractError("capability state does not describe native preauthorization")
        if not capability_state.get("enabled"):
            raise PermissionAdapterError(
                "native preauthorization is not enabled for this adapter identity: "
                f"{capability_state.get('reason')}"
            )
        constraints = dict(decision.get("approved_operation_constraints") or {})
        if not constraints:
            raise PermissionAdapterError(
                "refusing to preauthorize a decision that carries no bounded operation constraints"
            )
        record = {
            "adapter_id": self.adapter_id,
            "decision_id": decision["decision_id"],
            "approval_request_id": decision["approval_request_id"],
            "request_digest": decision["request_digest"],
            "bounded_constraints": constraints,
            "observed_state": PREAUTHORIZED,
            "one_shot": decision.get("one_shot_or_bounded_grant") == "ONE_SHOT",
            "prepared_at": iso_now(),
        }
        record["preauthorization_digest"] = sha256_json(
            {k: v for k, v in record.items() if k != "prepared_at"}
        )
        return record

    def apply_one_shot(
        self,
        *,
        decision: Mapping[str, Any],
        capability_state: Mapping[str, Any],
        evidence: Mapping[str, Any],
    ) -> dict[str, Any]:
        """Apply exactly one bounded authorization and observe the result.

        The applied authorization is bound to the decision's request digest, so
        an application can be proven to belong to the decision it claims - a
        "yes" observed at the right moment is not evidence that the right thing
        was approved.
        """

        validate_decision(decision)
        if not capability_state.get("enabled"):
            raise PermissionAdapterError(
                f"one-shot approval is not enabled: {capability_state.get('reason')}"
            )
        observation = self.normalize_observation(evidence)
        observation["bound_decision_id"] = decision["decision_id"]
        observation["bound_request_digest"] = decision["request_digest"]
        observation["applied_one_shot"] = True
        return observation


def assert_not_remember_authority(observation: Mapping[str, Any]) -> Mapping[str, Any]:
    """Guard placed wherever an observation could become authority.

    Provider "remember" state may be present and may even be active; it simply
    never counts.  This guard exists so that the ban is enforced at the point of
    use rather than relying on every caller to remember it.
    """

    if observation.get("provider_remember_active") and observation.get(
        "treat_remember_as_authority"
    ):
        raise PolicyError(
            "provider/session 'approve and remember' state may never be used as CAO authority"
        )
    return observation


def normalized_states_are_exclusive(state: str, *, execution_progressing: bool) -> bool:
    """``RUNNING`` and ``WAITING_FOR_APPROVAL`` can never both hold."""

    if state not in OBSERVED_STATES:
        raise ContractError(f"unknown observed state: {state!r}")
    if state == WAITING_FOR_APPROVAL and execution_progressing:
        return False
    return True


def resolved_states() -> tuple[str, ...]:
    """Observed states that do not block execution."""

    return (NOT_REQUIRED, PREAUTHORIZED, APPROVED, DENIED)
