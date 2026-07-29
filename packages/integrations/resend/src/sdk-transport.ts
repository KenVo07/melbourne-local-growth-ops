import { toTransportError } from "./error-mapping.js";
import { TimerDeadlineScheduler } from "./sdk-client.js";
import type {
  DeadlineScheduler,
  ResendEmailClient,
  ResendEmailPayload,
} from "./sdk-client.js";
import { ResendTransportError } from "./transport.js";
import type {
  ResendSendRequest,
  ResendSendResult,
  ResendTransport,
} from "./transport.js";

/** Default request deadline. The SDK exposes no timeout of its own. */
export const DEFAULT_TIMEOUT_MILLISECONDS = 10_000;

export interface ResendSdkTransportOptions {
  readonly client: ResendEmailClient;
  readonly timeoutMilliseconds?: number;
  readonly scheduler?: DeadlineScheduler;
}

/**
 * `ResendTransport` backed by the official `resend` SDK.
 *
 * Two shape differences from the SDK are absorbed here so the rest of the
 * package stays provider-neutral:
 *
 * 1. The SDK returns `{ data, error }` instead of throwing. This transport
 *    translates a provider error into a thrown `ResendTransportError`, which is
 *    what `ResendTransport` promises.
 * 2. The SDK has no timeout and accepts no abort signal, so a deadline is
 *    applied here by racing the send against a scheduled timer.
 */
export class ResendSdkTransport implements ResendTransport {
  readonly #client: ResendEmailClient;
  readonly #timeoutMilliseconds: number;
  readonly #scheduler: DeadlineScheduler;

  constructor(options: ResendSdkTransportOptions) {
    const timeout = options.timeoutMilliseconds ?? DEFAULT_TIMEOUT_MILLISECONDS;
    if (!Number.isFinite(timeout) || timeout <= 0) {
      throw new RangeError("Resend transport timeout must be a positive number");
    }

    this.#client = options.client;
    this.#timeoutMilliseconds = timeout;
    this.#scheduler = options.scheduler ?? new TimerDeadlineScheduler();
  }

  async send(request: ResendSendRequest): Promise<ResendSendResult> {
    const payload = toPayload(request);

    // The idempotency key is forwarded byte-for-byte. Because the deadline
    // below cannot cancel an in-flight request, a retry reusing this same key
    // is what keeps a timed-out attempt from producing a second email.
    const sendPromise = this.#client.emails.send(payload, {
      idempotencyKey: request.idempotencyKey,
    });

    // The send promise outlives a timeout, so attach a no-op rejection handler
    // immediately. Without this, a later failure on the abandoned promise would
    // surface as an unhandled rejection and could crash a host process.
    const settled = sendPromise.then(
      (value) => ({ ok: true as const, value }),
      (cause: unknown) => ({ ok: false as const, cause }),
    );

    const deadline = this.#scheduler.schedule(this.#timeoutMilliseconds);

    type RaceOutcome =
      | { readonly timedOut: false; readonly settled: Awaited<typeof settled> }
      | { readonly timedOut: true };

    let outcome: RaceOutcome;
    try {
      outcome = await Promise.race<RaceOutcome>([
        settled.then((value) => ({ timedOut: false as const, settled: value })),
        deadline.promise.then(() => ({ timedOut: true as const })),
      ]);
    } finally {
      deadline.cancel();
    }

    if (outcome.timedOut) {
      throw new ResendTransportError(
        "TIMEOUT",
        `Resend request exceeded ${this.#timeoutMilliseconds}ms deadline`,
      );
    }

    if (!outcome.settled.ok) {
      // A throw from the SDK itself is a transport-level fault, not a provider
      // verdict. Report it as retryable network trouble without echoing the
      // original message, which is outside our control.
      throw new ResendTransportError(
        "NETWORK",
        "Resend request failed before a provider response was received",
      );
    }

    const response = outcome.settled.value;

    if (response.error !== null) {
      throw toTransportError(response.error, response.headers ?? null);
    }

    if (response.data === null) {
      throw new ResendTransportError(
        "UNKNOWN",
        "Resend returned neither an error nor an email id",
      );
    }

    return { id: response.data.id };
  }
}

/**
 * Map the provider-neutral message onto the SDK payload.
 *
 * Arrays are copied so the SDK cannot observe or retain our frozen input, and
 * the caller's message is never mutated.
 */
function toPayload(request: ResendSendRequest): ResendEmailPayload {
  const { message } = request;

  return {
    from: message.from,
    to: [...message.to],
    subject: message.subject,
    text: message.text,
    ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }),
  };
}
