import type { Clock } from "./rate-limit.js";

export type SpamSignal = "HONEYPOT_FILLED" | "SUBMITTED_TOO_FAST";

export type SpamVerdict =
  | { readonly spam: false }
  | { readonly spam: true; readonly signal: SpamSignal };

export interface SpamCheckInput {
  readonly honeypot?: string | undefined;
  readonly renderedAt?: number | undefined;
}

export interface SpamGuardOptions {
  /** Minimum plausible time between rendering the form and submitting it. */
  readonly minimumFillMilliseconds: number;
  readonly clock: Clock;
}

/**
 * Basic, dependency-free spam protection.
 *
 * Two signals only: a hidden honeypot field that humans never fill, and a
 * time trap for submissions that arrive implausibly fast. Both are cheap and
 * stateless. Neither is a substitute for a challenge such as CAPTCHA, which is
 * a deferred product decision.
 *
 * The verdict carries a signal name and never echoes submitted content.
 */
export class SpamGuard {
  readonly #minimumFillMilliseconds: number;
  readonly #clock: Clock;

  constructor(options: SpamGuardOptions) {
    if (options.minimumFillMilliseconds < 0) {
      throw new RangeError("Minimum fill time cannot be negative");
    }

    this.#minimumFillMilliseconds = options.minimumFillMilliseconds;
    this.#clock = options.clock;
  }

  evaluate(input: SpamCheckInput): SpamVerdict {
    if (input.honeypot !== undefined && input.honeypot.trim() !== "") {
      return { spam: true, signal: "HONEYPOT_FILLED" };
    }

    if (input.renderedAt !== undefined && this.#minimumFillMilliseconds > 0) {
      const elapsed = this.#clock.now() - input.renderedAt;
      if (elapsed < this.#minimumFillMilliseconds) {
        return { spam: true, signal: "SUBMITTED_TOO_FAST" };
      }
    }

    return { spam: false };
  }
}
