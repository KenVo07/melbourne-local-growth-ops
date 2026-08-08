"""Provider-neutral transport boundary and deterministic fake adapters.

Transport describes how a request crosses a provider/session boundary.  It does
not define role authority or provider selection.  Ambiguous-submit semantics are
explicit and are consumed by :mod:`commands`.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Protocol, runtime_checkable

from .common import ContractError, PolicyError, sha256_json
from .http_client import HTTPError, request_json


class SubmitCertainty:
    NOT_SENT_CONFIRMED = "NOT_SENT_CONFIRMED"
    UNKNOWN_AFTER_SUBMIT = "UNKNOWN_AFTER_SUBMIT"
    ACCEPTED = "ACCEPTED"


class ObservationState:
    IN_PROGRESS = "OBSERVED_IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    UNKNOWN = "UNKNOWN"


@dataclass(frozen=True)
class SubmitResult:
    certainty: str
    receipt_id: str | None = None
    response: dict[str, Any] | None = None
    provider_started: bool = False
    error: str | None = None


@dataclass(frozen=True)
class ReconcileResult:
    state: str
    receipt_id: str | None = None
    result: dict[str, Any] | None = None
    exact: bool = False
    provider_started: bool | None = None
    error: str | None = None


class TransportSubmitError(RuntimeError):
    def __init__(self, message: str, *, certainty: str, receipt_id: str | None = None, provider_started: bool = False):
        super().__init__(message)
        self.certainty = certainty
        self.receipt_id = receipt_id
        self.provider_started = provider_started


@runtime_checkable
class TransportAdapter(Protocol):
    adapter_id: str

    def prepare(self, command: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]: ...
    def open(self, command: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]: ...
    def resume(self, command: dict[str, Any], conversation_handle: dict[str, Any]) -> dict[str, Any]: ...
    def submit(self, command: dict[str, Any], request: dict[str, Any]) -> SubmitResult: ...
    def observe(self, command: dict[str, Any], receipt_id: str | None) -> ReconcileResult: ...
    def reconcile(self, command: dict[str, Any]) -> ReconcileResult: ...
    def cancel(self, command: dict[str, Any], receipt_id: str | None) -> ReconcileResult: ...
    def cleanup(self, command: dict[str, Any], receipt_id: str | None) -> dict[str, Any]: ...


class CAORunStepTransportAdapter:
    """Generic CAO run-step adapter parameterized only by transport config.

    Provider/profile/model identities are request data from the registry.  The
    adapter contains no Supervisor/Tech-Lead routing semantics.
    """

    adapter_id = "cao-run-step"

    def __init__(self, endpoint: str, *, requester: Callable[..., dict[str, Any]] = request_json):
        self.endpoint = endpoint.rstrip("/")
        self._request = requester

    def prepare(self, command: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
        return dict(request)

    def open(self, command: dict[str, Any], request: dict[str, Any]) -> dict[str, Any]:
        raise PolicyError("cao-run-step has no separately qualified open-session operation")

    def resume(self, command: dict[str, Any], conversation_handle: dict[str, Any]) -> dict[str, Any]:
        # Native resume belongs to a separately qualified capability path.
        raise PolicyError("native provider resume is not enabled by the Slice 1 transport adapter")

    def submit(self, command: dict[str, Any], request: dict[str, Any]) -> SubmitResult:
        body = dict(request)
        try:
            response = self._request(
                self.endpoint + "/terminals/run-step",
                method="POST",
                body=body,
                timeout=float(body.get("timeout", 300)) + 240.0,
            )
        except HTTPError as exc:
            # HTTP transport failures cannot prove whether the remote endpoint
            # accepted bytes unless an exact response contract says otherwise.
            raise TransportSubmitError(
                str(exc), certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT,
                receipt_id=_find_terminal_id(exc.payload), provider_started=bool(_find_terminal_id(exc.payload)),
            ) from exc
        terminal_id = response.get("terminal_id")
        if not isinstance(terminal_id, str) or not terminal_id:
            raise TransportSubmitError(
                "CAO run-step returned no terminal identity",
                certainty=SubmitCertainty.UNKNOWN_AFTER_SUBMIT,
                provider_started=True,
            )
        return SubmitResult(
            certainty=SubmitCertainty.ACCEPTED,
            receipt_id=terminal_id,
            response=response,
            provider_started=True,
        )

    def observe(self, command: dict[str, Any], receipt_id: str | None) -> ReconcileResult:
        if not receipt_id:
            return ReconcileResult(state=ObservationState.UNKNOWN, exact=False)
        try:
            meta = self._request(self.endpoint + f"/terminals/{receipt_id}", method="GET", timeout=30)
        except Exception as exc:
            return ReconcileResult(state=ObservationState.UNKNOWN, receipt_id=receipt_id, exact=False, error=str(exc))
        status = str(meta.get("status") or "").lower()
        if status in {"completed", "complete", "done", "exited"}:
            return ReconcileResult(state=ObservationState.COMPLETED, receipt_id=receipt_id, result=meta, exact=True, provider_started=True)
        if status in {"failed", "error"}:
            return ReconcileResult(state=ObservationState.FAILED, receipt_id=receipt_id, result=meta, exact=True, provider_started=True)
        if status in {"cancelled", "canceled"}:
            return ReconcileResult(state=ObservationState.CANCELLED, receipt_id=receipt_id, result=meta, exact=True, provider_started=True)
        return ReconcileResult(state=ObservationState.IN_PROGRESS, receipt_id=receipt_id, result=meta, exact=True, provider_started=True)

    def reconcile(self, command: dict[str, Any]) -> ReconcileResult:
        receipt = command.get("receipt_id") or command.get("external_identity")
        return self.observe(command, str(receipt) if receipt else None)

    def cancel(self, command: dict[str, Any], receipt_id: str | None) -> ReconcileResult:
        if not receipt_id:
            return ReconcileResult(state=ObservationState.UNKNOWN, exact=False)
        try:
            response = self._request(self.endpoint + f"/terminals/{receipt_id}/exit", method="POST", timeout=30)
            return ReconcileResult(state=ObservationState.CANCELLED, receipt_id=receipt_id, result=response, exact=True, provider_started=True)
        except Exception as exc:
            return ReconcileResult(state=ObservationState.UNKNOWN, receipt_id=receipt_id, exact=False, error=str(exc))

    def cleanup(self, command: dict[str, Any], receipt_id: str | None) -> dict[str, Any]:
        if not receipt_id:
            return {"status": "NO_RECEIPT"}
        try:
            result = self._request(self.endpoint + f"/terminals/{receipt_id}", method="DELETE", timeout=60)
            return {"status": "CLEANED", "receipt_id": receipt_id, "result": result}
        except Exception as exc:
            return {"status": "CLEANUP_UNKNOWN", "receipt_id": receipt_id, "error": str(exc)}


class AdapterFactory:
    def __init__(self) -> None:
        self._factories: dict[str, Callable[[dict[str, Any], dict[str, Any]], TransportAdapter]] = {}
        self.register("cao-run-step", self._cao_run_step)

    def register(self, adapter_id: str, factory: Callable[[dict[str, Any], dict[str, Any]], TransportAdapter]) -> None:
        if not adapter_id or adapter_id in self._factories:
            if adapter_id in self._factories:
                raise PolicyError(f"transport adapter already registered: {adapter_id}")
            raise ContractError("adapter_id is required")
        self._factories[adapter_id] = factory

    def create(self, transport: dict[str, Any], policy: dict[str, Any]) -> TransportAdapter:
        adapter_id = str(transport.get("adapter_id") or "")
        try:
            factory = self._factories[adapter_id]
        except KeyError as exc:
            raise PolicyError(f"no transport adapter implementation: {adapter_id}") from exc
        return factory(transport, policy)

    @staticmethod
    def _cao_run_step(transport: dict[str, Any], policy: dict[str, Any]) -> TransportAdapter:
        key = str(transport.get("endpoint_policy_key") or "")
        endpoint = policy.get(key)
        if not isinstance(endpoint, str) or not endpoint:
            raise PolicyError(f"transport endpoint policy key is missing: {key}")
        return CAORunStepTransportAdapter(endpoint)


DEFAULT_ADAPTER_FACTORY = AdapterFactory()


def adapter_for_route(registry: dict[str, Any], route: dict[str, Any], policy: dict[str, Any], *, factory: AdapterFactory | None = None) -> TransportAdapter:
    transport_id = route.get("transport_id")
    try:
        transport = registry["transports"][transport_id]
    except KeyError as exc:
        raise PolicyError(f"route references unknown transport: {transport_id!r}") from exc
    return (factory or DEFAULT_ADAPTER_FACTORY).create(transport, policy)


def transport_binding(registry: dict[str, Any], route: dict[str, Any]) -> dict[str, Any]:
    transport = registry["transports"][route["transport_id"]]
    return {
        "transport_id": route["transport_id"],
        "adapter_id": transport["adapter_id"],
        "transport_config_digest": sha256_json(transport),
    }


def _find_terminal_id(payload: Any) -> str | None:
    stack = [payload]
    while stack:
        item = stack.pop()
        if isinstance(item, dict):
            value = item.get("terminal_id")
            if isinstance(value, str) and value:
                return value
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return None
