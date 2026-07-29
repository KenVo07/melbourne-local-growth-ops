import type { ProviderErrorLike, ProviderHeaders } from "./error-mapping.js";

/**
 * The narrow slice of the Resend SDK this package actually uses.
 *
 * Declaring it structurally means the real `Resend` instance satisfies it
 * without a cast, while tests can inject a deterministic fake that needs no
 * network and no API key. Nothing here holds a credential: the key lives inside
 * the client instance the host constructs.
 */
export interface ResendEmailClient {
  readonly emails: {
    send(
      payload: ResendEmailPayload,
      options?: ResendSendOptions,
    ): Promise<ResendEmailResponse>;
  };
}

/**
 * The send payload. Field names follow the SDK's camelCase surface (`replyTo`),
 * which it maps to the wire format internally.
 */
export interface ResendEmailPayload {
  readonly from: string;
  readonly to: string | string[];
  readonly subject: string;
  readonly text: string;
  readonly replyTo?: string | string[];
}

/** Per-request options. The idempotency key becomes an `Idempotency-Key` header. */
export interface ResendSendOptions {
  readonly idempotencyKey?: string;
}

/**
 * The SDK reports provider failures in the result rather than throwing, so both
 * branches must be handled explicitly.
 */
export type ResendEmailResponse = {
  readonly data: { readonly id: string } | null;
  readonly error: ProviderErrorLike | null;
  readonly headers?: ProviderHeaders;
};

/** A deadline seam so timeout behaviour is deterministic under test. */
export interface DeadlineScheduler {
  /**
   * Resolve after `milliseconds`. The returned `cancel` must release the timer
   * so a completed send never leaves a pending handle behind.
   */
  schedule(milliseconds: number): { promise: Promise<void>; cancel(): void };
}

/**
 * Timer globals reached through `globalThis`, so this package needs neither the
 * DOM lib nor a Node type dependency to schedule a deadline.
 */
interface TimerGlobals {
  setTimeout(handler: () => void, timeout: number): unknown;
  clearTimeout(handle: unknown): void;
}

const timers = globalThis as unknown as TimerGlobals;

/** Default scheduler backed by the host runtime's timer functions. */
export class TimerDeadlineScheduler implements DeadlineScheduler {
  schedule(milliseconds: number): { promise: Promise<void>; cancel(): void } {
    let handle: unknown;

    const promise = new Promise<void>((resolve) => {
      handle = timers.setTimeout(resolve, milliseconds);
    });

    return {
      promise,
      cancel: () => {
        if (handle !== undefined) {
          timers.clearTimeout(handle);
        }
      },
    };
  }
}
