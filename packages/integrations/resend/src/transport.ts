import type { ResendDeliveryMessage } from "./message.js";

/**
 * Package-local transport seam that keeps the adapter independent of any
 * provider SDK.
 *
 * The host resolves the email connector's `secretReferenceId` and constructs
 * an authenticated implementation of this interface. Implementations own
 * credential handling; the adapter never sees a raw API key.
 */
export interface ResendTransport {
  send(request: ResendSendRequest): Promise<ResendSendResult>;
}

/**
 * A single send attempt. The idempotency key is supplied by the caller and is
 * forwarded to the provider unchanged so repeated attempts for the same
 * submission are safe.
 */
export interface ResendSendRequest {
  readonly message: ResendDeliveryMessage;
  readonly idempotencyKey: string;
}

export interface ResendSendResult {
  readonly id: string;
}

/**
 * The closed set of failure modes a transport may report. Keeping this typed
 * lets the adapter classify retryable and permanent failures without parsing
 * provider strings.
 */
export type ResendTransportErrorKind =
  | "TIMEOUT"
  | "NETWORK"
  | "RATE_LIMITED"
  | "PROVIDER_REJECTED"
  | "UNKNOWN";

/**
 * Transport failure carrying only safe technical detail.
 *
 * Implementations must never place an API key, credential, or lead content in
 * `message`. The adapter does not copy this message into its normalized
 * result, so provider text cannot leak through the delivery boundary.
 */
export class ResendTransportError extends Error {
  readonly kind: ResendTransportErrorKind;
  readonly retryAfterMilliseconds?: number;

  constructor(
    kind: ResendTransportErrorKind,
    message: string,
    retryAfterMilliseconds?: number,
  ) {
    super(message);
    this.name = "ResendTransportError";
    this.kind = kind;
    if (retryAfterMilliseconds !== undefined) {
      this.retryAfterMilliseconds = retryAfterMilliseconds;
    }
  }
}
