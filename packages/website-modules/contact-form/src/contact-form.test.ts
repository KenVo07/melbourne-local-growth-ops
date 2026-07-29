import { describe, expect, it } from "vitest";

import {
  IDEMPOTENCY_KEY_PREFIX,
  InvalidIdempotencySegmentError,
  buildIdempotencyKey,
} from "./idempotency.js";
import { LeadFormModuleSchema } from "@melbourne-local-growth-ops/contracts";

import { buildSubmissionSchema, declaredInputKeys } from "./input-schema.js";
import type { LeadFormField, LeadFormModule } from "./input-schema.js";
import { InMemoryRateLimiter, NoopRateLimiter } from "./rate-limit.js";
import type { Clock } from "./rate-limit.js";
import { SpamGuard } from "./spam.js";
import { normalizeSubmission, submissionValue } from "./submission.js";

class FakeClock implements Clock {
  #current: number;

  constructor(start = 1_000_000) {
    this.#current = start;
  }

  now(): number {
    return this.#current;
  }

  advance(milliseconds: number): void {
    this.#current += milliseconds;
  }
}

/** Build a module through the contract schema so branded ids are real. */
function moduleWithFields(
  fields: readonly LeadFormField[],
): LeadFormModule {
  return LeadFormModuleSchema.parse({
    schemaVersion: 1,
    moduleId: "module_lead_form",
    connectorId: "connector_email",
    type: "LEAD_FORM",
    fields,
  });
}

const fullModule = moduleWithFields(["NAME", "EMAIL", "PHONE", "MESSAGE"]);
const minimalModule = moduleWithFields(["EMAIL"]);

describe("buildIdempotencyKey", () => {
  it("formats a key from non-sensitive identifiers only", () => {
    expect(buildIdempotencyKey("dep_001", "sub_abc")).toBe(
      `${IDEMPOTENCY_KEY_PREFIX}/dep_001/sub_abc`,
    );
  });

  it("is deterministic for the same identifiers", () => {
    expect(buildIdempotencyKey("dep_001", "sub_abc")).toBe(
      buildIdempotencyKey("dep_001", "sub_abc"),
    );
  });

  it("rejects a submission id that would change the key shape", () => {
    expect(() => buildIdempotencyKey("dep_001", "sub/../other")).toThrow(
      InvalidIdempotencySegmentError,
    );
  });

  it("rejects an unsafe deployment id", () => {
    expect(() => buildIdempotencyKey("dep 001", "sub_abc")).toThrow(
      InvalidIdempotencySegmentError,
    );
  });
});

describe("buildSubmissionSchema", () => {
  it("requires every field the module declares", () => {
    const result = buildSubmissionSchema(fullModule).safeParse({
      submissionId: "sub_abc",
      name: "Dana Smith",
      email: "dana@example.com",
      phone: "+61 400 000 000",
      message: "Please call me.",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a submission missing a declared field", () => {
    const result = buildSubmissionSchema(fullModule).safeParse({
      submissionId: "sub_abc",
      name: "Dana Smith",
      email: "dana@example.com",
      phone: "+61 400 000 000",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a field the module does not declare", () => {
    const result = buildSubmissionSchema(minimalModule).safeParse({
      submissionId: "sub_abc",
      email: "dana@example.com",
      message: "Undeclared field",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed email", () => {
    const result = buildSubmissionSchema(minimalModule).safeParse({
      submissionId: "sub_abc",
      email: "not-an-email",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a phone number with unsupported characters", () => {
    const result = buildSubmissionSchema(
      moduleWithFields(["PHONE"]),
    ).safeParse({ submissionId: "sub_abc", phone: "call-me-maybe" });

    expect(result.success).toBe(false);
  });

  it("trims surrounding whitespace", () => {
    const result = buildSubmissionSchema(minimalModule).safeParse({
      submissionId: "sub_abc",
      email: "  dana@example.com  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("dana@example.com");
    }
  });

  it("rejects a whitespace-only required message", () => {
    const result = buildSubmissionSchema(
      moduleWithFields(["MESSAGE"]),
    ).safeParse({ submissionId: "sub_abc", message: "   " });

    expect(result.success).toBe(false);
  });

  it("maps declared fields to input keys", () => {
    expect(declaredInputKeys(fullModule)).toStrictEqual([
      "name",
      "email",
      "phone",
      "message",
    ]);
  });
});

describe("normalizeSubmission", () => {
  it("orders values by the module's declared field order", () => {
    const submission = normalizeSubmission(fullModule, "sub_abc", {
      message: "Please call me.",
      email: "dana@example.com",
      name: "Dana Smith",
      phone: "+61 400 000 000",
    });

    expect(submission.fields.map((entry) => entry.field)).toStrictEqual([
      "NAME",
      "EMAIL",
      "PHONE",
      "MESSAGE",
    ]);
  });

  it("exposes values by field", () => {
    const submission = normalizeSubmission(minimalModule, "sub_abc", {
      email: "dana@example.com",
    });

    expect(submissionValue(submission, "EMAIL")).toBe("dana@example.com");
    expect(submissionValue(submission, "NAME")).toBeUndefined();
  });

  it("returns a frozen model", () => {
    const submission = normalizeSubmission(minimalModule, "sub_abc", {
      email: "dana@example.com",
    });

    expect(Object.isFrozen(submission)).toBe(true);
    expect(Object.isFrozen(submission.fields)).toBe(true);
  });
});

describe("SpamGuard", () => {
  it("accepts a normal submission", () => {
    const clock = new FakeClock();
    const guard = new SpamGuard({
      minimumFillMilliseconds: 3_000,
      clock,
    });

    expect(
      guard.evaluate({ renderedAt: clock.now() - 10_000 }),
    ).toStrictEqual({ spam: false });
  });

  it("rejects a filled honeypot", () => {
    const guard = new SpamGuard({
      minimumFillMilliseconds: 3_000,
      clock: new FakeClock(),
    });

    expect(guard.evaluate({ honeypot: "http://spam.example" })).toStrictEqual({
      spam: true,
      signal: "HONEYPOT_FILLED",
    });
  });

  it("ignores an empty honeypot", () => {
    const guard = new SpamGuard({
      minimumFillMilliseconds: 0,
      clock: new FakeClock(),
    });

    expect(guard.evaluate({ honeypot: "   " })).toStrictEqual({ spam: false });
  });

  it("rejects a submission that arrives implausibly fast", () => {
    const clock = new FakeClock();
    const guard = new SpamGuard({
      minimumFillMilliseconds: 3_000,
      clock,
    });

    expect(guard.evaluate({ renderedAt: clock.now() - 500 })).toStrictEqual({
      spam: true,
      signal: "SUBMITTED_TOO_FAST",
    });
  });

  it("accepts once enough time has passed on the fake clock", () => {
    const clock = new FakeClock();
    const renderedAt = clock.now();
    const guard = new SpamGuard({
      minimumFillMilliseconds: 3_000,
      clock,
    });

    expect(guard.evaluate({ renderedAt }).spam).toBe(true);
    clock.advance(3_000);
    expect(guard.evaluate({ renderedAt }).spam).toBe(false);
  });

  it("never echoes submitted content in its verdict", () => {
    const guard = new SpamGuard({
      minimumFillMilliseconds: 0,
      clock: new FakeClock(),
    });

    const verdict = guard.evaluate({ honeypot: "dana@example.com" });

    expect(JSON.stringify(verdict)).not.toContain("dana@example.com");
  });
});

describe("InMemoryRateLimiter", () => {
  it("allows submissions up to the configured limit", async () => {
    const limiter = new InMemoryRateLimiter({
      limit: 2,
      windowMilliseconds: 60_000,
      clock: new FakeClock(),
    });

    expect((await limiter.consume("key")).allowed).toBe(true);
    expect((await limiter.consume("key")).allowed).toBe(true);
  });

  it("rejects deterministically past the limit and reports retry-after", async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter({
      limit: 2,
      windowMilliseconds: 60_000,
      clock,
    });

    await limiter.consume("key");
    await limiter.consume("key");
    clock.advance(10_000);

    expect(await limiter.consume("key")).toStrictEqual({
      allowed: false,
      retryAfterMilliseconds: 50_000,
    });
  });

  it("tracks keys independently", async () => {
    const limiter = new InMemoryRateLimiter({
      limit: 1,
      windowMilliseconds: 60_000,
      clock: new FakeClock(),
    });

    await limiter.consume("a");

    expect((await limiter.consume("b")).allowed).toBe(true);
  });

  it("starts a fresh window after it elapses", async () => {
    const clock = new FakeClock();
    const limiter = new InMemoryRateLimiter({
      limit: 1,
      windowMilliseconds: 60_000,
      clock,
    });

    await limiter.consume("key");
    clock.advance(60_000);

    expect((await limiter.consume("key")).allowed).toBe(true);
  });

  it("rejects a nonsensical configuration", () => {
    expect(
      () =>
        new InMemoryRateLimiter({
          limit: 0,
          windowMilliseconds: 1_000,
          clock: new FakeClock(),
        }),
    ).toThrow(RangeError);
  });

  it("never rejects when the noop limiter is used", async () => {
    expect((await new NoopRateLimiter().consume("key")).allowed).toBe(true);
  });
});
