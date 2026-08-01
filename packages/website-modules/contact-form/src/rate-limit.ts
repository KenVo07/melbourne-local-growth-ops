/** A monotonic clock seam so rate limiting and spam checks stay deterministic. */
export interface Clock {
  now(): number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  readonly retryAfterMilliseconds?: number;
}

/**
 * Rate-limit seam injected into the contact-form service.
 *
 * The interface exists so a host can supply a shared, durable limiter. It is
 * deliberately narrow: a single consume-one-token decision per key.
 */
export interface RateLimiter {
  consume(key: string): Promise<RateLimitDecision>;
}

/** A limiter that never rejects. Useful when the host enforces limits upstream. */
export class NoopRateLimiter implements RateLimiter {
  async consume(_key: string): Promise<RateLimitDecision> {
    void _key;
    return { allowed: true };
  }
}

export interface InMemoryRateLimiterOptions {
  readonly limit: number;
  readonly windowMilliseconds: number;
  readonly clock: Clock;
}

/**
 * Deterministic fixed-window limiter for tests and local development.
 *
 * IMPORTANT: this is process-local. On serverless or multi-instance hosting
 * each instance keeps its own counters, so the effective limit is the
 * configured limit multiplied by the number of live instances. It is a
 * reference implementation and a test double, not reliable production abuse
 * protection. A host that needs real enforcement must supply a shared,
 * durable RateLimiter.
 */
export class InMemoryRateLimiter implements RateLimiter {
  readonly #limit: number;
  readonly #windowMilliseconds: number;
  readonly #clock: Clock;
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(options: InMemoryRateLimiterOptions) {
    if (options.limit < 1) {
      throw new RangeError("Rate limit must be at least 1");
    }
    if (options.windowMilliseconds < 1) {
      throw new RangeError("Rate limit window must be at least 1ms");
    }

    this.#limit = options.limit;
    this.#windowMilliseconds = options.windowMilliseconds;
    this.#clock = options.clock;
  }

  async consume(key: string): Promise<RateLimitDecision> {
    const now = this.#clock.now();
    const existing = this.#windows.get(key);

    if (existing === undefined || now - existing.start >= this.#windowMilliseconds) {
      this.#windows.set(key, { start: now, count: 1 });
      return { allowed: true };
    }

    if (existing.count < this.#limit) {
      existing.count += 1;
      return { allowed: true };
    }

    return {
      allowed: false,
      retryAfterMilliseconds:
        existing.start + this.#windowMilliseconds - now,
    };
  }
}
