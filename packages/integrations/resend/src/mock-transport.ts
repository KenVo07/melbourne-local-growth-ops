import { ResendTransportError } from "./transport.js";
import type {
  ResendSendRequest,
  ResendSendResult,
  ResendTransport,
} from "./transport.js";

/** A scripted outcome: either a provider result or a typed transport failure. */
export type ResendSendOutcome = ResendSendResult | ResendTransportError;

/**
 * Deterministic in-memory transport for tests and local development.
 *
 * It performs no network calls, never holds a credential, and produces stable
 * provider references derived from the forwarded idempotency key.
 */
export class MockResendTransport implements ResendTransport {
  readonly #outcomesByKey = new Map<string, ResendSendOutcome>();
  readonly #requests: ResendSendRequest[] = [];
  #defaultOutcome: ResendSendOutcome | undefined;

  /** Script the outcome for a specific forwarded idempotency key. */
  configureOutcome(idempotencyKey: string, outcome: ResendSendOutcome): void {
    this.#outcomesByKey.set(idempotencyKey, outcome);
  }

  /** Script the outcome used when no key-specific outcome is configured. */
  setDefaultOutcome(outcome: ResendSendOutcome): void {
    this.#defaultOutcome = outcome;
  }

  /** Every request received, in order, for assertions on forwarding. */
  get requests(): readonly ResendSendRequest[] {
    return this.#requests;
  }

  get sendCount(): number {
    return this.#requests.length;
  }

  reset(): void {
    this.#outcomesByKey.clear();
    this.#requests.length = 0;
    this.#defaultOutcome = undefined;
  }

  async send(request: ResendSendRequest): Promise<ResendSendResult> {
    this.#requests.push(request);

    const outcome =
      this.#outcomesByKey.get(request.idempotencyKey) ?? this.#defaultOutcome;

    if (outcome instanceof ResendTransportError) {
      throw outcome;
    }

    return outcome ?? { id: `mock_${request.idempotencyKey}` };
  }
}

export function mockTimeoutError(): ResendTransportError {
  return new ResendTransportError("TIMEOUT", "Transport deadline exceeded");
}

export function mockNetworkError(): ResendTransportError {
  return new ResendTransportError("NETWORK", "Connection reset");
}

export function mockRateLimitedError(
  retryAfterMilliseconds = 30_000,
): ResendTransportError {
  return new ResendTransportError(
    "RATE_LIMITED",
    "Too many requests",
    retryAfterMilliseconds,
  );
}

export function mockProviderRejectedError(): ResendTransportError {
  return new ResendTransportError(
    "PROVIDER_REJECTED",
    "Sending domain not verified",
  );
}

export function mockUnknownError(): ResendTransportError {
  return new ResendTransportError("UNKNOWN", "Unrecognized provider failure");
}
