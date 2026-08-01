import type { ProviderErrorLike, ProviderHeaders } from "./error-mapping.js";
import type {
  DeadlineScheduler,
  ResendEmailClient,
  ResendEmailPayload,
  ResendEmailResponse,
  ResendSendOptions,
} from "./sdk-client.js";

/** A scripted SDK outcome: a success id, a provider error, a throw, or a hang. */
export type FakeSdkOutcome =
  | { readonly kind: "success"; readonly id: string; readonly headers?: ProviderHeaders }
  | {
      readonly kind: "providerError";
      readonly error: ProviderErrorLike;
      readonly headers?: ProviderHeaders;
    }
  | { readonly kind: "throws"; readonly cause: unknown }
  | { readonly kind: "never" }
  | { readonly kind: "emptyResponse" };

export interface FakeSdkCall {
  readonly payload: ResendEmailPayload;
  readonly options: ResendSendOptions | undefined;
}

/**
 * Deterministic stand-in for the Resend SDK client.
 *
 * It performs no network access and holds no credential, so tests can drive
 * every branch of the transport, including a request that never settles.
 */
export class FakeResendClient implements ResendEmailClient {
  readonly #calls: FakeSdkCall[] = [];
  #outcome: FakeSdkOutcome = { kind: "success", id: "fake_email_id" };
  /** Rejects the abandoned promise of a `never` outcome during cleanup. */
  #pendingRejects: Array<(reason: unknown) => void> = [];

  setOutcome(outcome: FakeSdkOutcome): void {
    this.#outcome = outcome;
  }

  get calls(): readonly FakeSdkCall[] {
    return this.#calls;
  }

  get sendCount(): number {
    return this.#calls.length;
  }

  /**
   * Fail any still-pending `never` request, so a test can prove the abandoned
   * promise cannot become an unhandled rejection.
   */
  settlePendingWithFailure(cause: unknown = new Error("late provider failure")): void {
    const rejects = this.#pendingRejects;
    this.#pendingRejects = [];
    for (const reject of rejects) {
      reject(cause);
    }
  }

  readonly emails = {
    send: (
      payload: ResendEmailPayload,
      options?: ResendSendOptions,
    ): Promise<ResendEmailResponse> => {
      this.#calls.push({ payload, options });

      const outcome = this.#outcome;

      switch (outcome.kind) {
        case "success":
          return Promise.resolve({
            data: { id: outcome.id },
            error: null,
            headers: outcome.headers ?? {},
          });
        case "providerError":
          return Promise.resolve({
            data: null,
            error: outcome.error,
            headers: outcome.headers ?? {},
          });
        case "emptyResponse":
          return Promise.resolve({ data: null, error: null, headers: {} });
        case "throws":
          return Promise.reject(outcome.cause);
        case "never":
          return new Promise<ResendEmailResponse>((_resolve, reject) => {
            this.#pendingRejects.push(reject);
          });
      }
    },
  };
}

/**
 * Deadline scheduler driven by explicit test control rather than real time.
 */
export class ManualDeadlineScheduler implements DeadlineScheduler {
  #fire: (() => void) | undefined;
  #cancelled = false;
  #scheduledMilliseconds: number | undefined;
  /**
   * Latches an `expire()` that arrived before the transport scheduled anything.
   *
   * A caller may sit behind async work (validation, spam checks, rate limiting)
   * before the transport runs, so a test cannot rely on `schedule` having
   * happened yet. Latching makes expiry order-independent.
   */
  #expireRequested = false;

  get scheduledMilliseconds(): number | undefined {
    return this.#scheduledMilliseconds;
  }

  get cancelled(): boolean {
    return this.#cancelled;
  }

  /** Trip the deadline, as if the timer had elapsed. */
  expire(): void {
    if (this.#fire === undefined) {
      this.#expireRequested = true;
      return;
    }
    this.#fire();
  }

  schedule(milliseconds: number): { promise: Promise<void>; cancel(): void } {
    this.#scheduledMilliseconds = milliseconds;
    this.#cancelled = false;

    const promise = new Promise<void>((resolve) => {
      this.#fire = resolve;
    });

    if (this.#expireRequested) {
      this.#expireRequested = false;
      this.#fire?.();
    }

    return {
      promise,
      cancel: () => {
        this.#cancelled = true;
      },
    };
  }
}

/** Build a provider error with the SDK's field shape. */
export function providerError(
  name: string,
  statusCode: number | null,
  message = "provider rejected the request",
): ProviderErrorLike {
  return { name, statusCode, message };
}
