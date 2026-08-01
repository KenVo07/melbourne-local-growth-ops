import { describe, expect, it } from "vitest";
import {
  ContactFormService,
  InMemoryRateLimiter,
  NoopRateLimiter,
  SpamGuard,
} from "@melbourne-local-growth-ops/contact-form";
import type { RateLimiter } from "@melbourne-local-growth-ops/contact-form";
import { ResendLeadDeliveryAdapter } from "@melbourne-local-growth-ops/resend";

import {
  BUSINESS_NAME,
  CredentialHoldingTransport,
  DEPLOYMENT_ID,
  FakeClock,
  LEAD_CONTENT,
  leadFormModule,
  validSubmissionInput,
  validatedConnector,
} from "./fixtures.js";

function buildService(
  transport: CredentialHoldingTransport,
  clock: FakeClock,
  options: {
    minimumFillMilliseconds?: number;
    rateLimiter?: RateLimiter;
  } = {},
) {
  const adapter = new ResendLeadDeliveryAdapter(transport);

  return new ContactFormService({
    module: leadFormModule,
    connector: validatedConnector(adapter),
    deploymentId: DEPLOYMENT_ID,
    businessName: BUSINESS_NAME,
    adapter,
    rateLimiter: options.rateLimiter ?? new NoopRateLimiter(),
    spamGuard: new SpamGuard({
      minimumFillMilliseconds: options.minimumFillMilliseconds ?? 0,
      clock,
    }),
  });
}

describe("server-side validation stops bad submissions before the provider", () => {
  it("rejects a submission missing a declared field", async () => {
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, new FakeClock());

    const outcome = await service.submit({
      submissionId: "sub_missing",
      name: LEAD_CONTENT.name,
      email: LEAD_CONTENT.email,
    });

    expect(outcome.status).toBe("INVALID");
    expect(transport.sendCount).toBe(0);
  });

  it("rejects a malformed email without contacting the provider", async () => {
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, new FakeClock());

    const outcome = await service.submit(
      validSubmissionInput("sub_bad_email", { email: "not-an-email" }),
    );

    expect(outcome.status).toBe("INVALID");
    expect(transport.sendCount).toBe(0);
  });

  it("rejects an unknown field rather than forwarding it", async () => {
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, new FakeClock());

    const outcome = await service.submit(
      validSubmissionInput("sub_extra", { taxFileNumber: "123456789" }),
    );

    expect(outcome.status).toBe("INVALID");
    expect(transport.sendCount).toBe(0);
  });

  it("rejects a missing submission identifier", async () => {
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, new FakeClock());

    const outcome = await service.submit({
      name: LEAD_CONTENT.name,
      email: LEAD_CONTENT.email,
      message: LEAD_CONTENT.message,
    });

    expect(outcome.status).toBe("INVALID");
    expect(transport.sendCount).toBe(0);
  });

  it("reports validation issues without echoing submitted values", async () => {
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, new FakeClock());

    const outcome = await service.submit(
      validSubmissionInput("sub_bad_email", { email: "not-an-email" }),
    );

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(LEAD_CONTENT.name);
    expect(serialized).not.toContain(LEAD_CONTENT.message);
  });
});

describe("spam controls stop bots before the provider", () => {
  it("rejects a filled honeypot", async () => {
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, new FakeClock());

    const outcome = await service.submit(
      validSubmissionInput("sub_bot", { honeypot: "http://spam.example" }),
    );

    expect(outcome).toStrictEqual({
      status: "REJECTED_AS_SPAM",
      signal: "HONEYPOT_FILLED",
    });
    expect(transport.sendCount).toBe(0);
  });

  it("rejects an implausibly fast submission using the fake clock", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, clock, {
      minimumFillMilliseconds: 3_000,
    });

    const outcome = await service.submit(
      validSubmissionInput("sub_fast", { renderedAt: clock.now() - 250 }),
    );

    expect(outcome).toStrictEqual({
      status: "REJECTED_AS_SPAM",
      signal: "SUBMITTED_TOO_FAST",
    });
    expect(transport.sendCount).toBe(0);
  });

  it("accepts the same submission once enough time has passed", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, clock, {
      minimumFillMilliseconds: 3_000,
    });
    const renderedAt = clock.now();

    clock.advance(4_000);
    const outcome = await service.submit(
      validSubmissionInput("sub_human", { renderedAt }),
    );

    expect(outcome.status).toBe("DELIVERED");
    expect(transport.sendCount).toBe(1);
  });
});

describe("rate limiting", () => {
  it("blocks submissions past the configured limit deterministically", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, clock, {
      rateLimiter: new InMemoryRateLimiter({
        limit: 1,
        windowMilliseconds: 60_000,
        clock,
      }),
    });

    const first = await service.submit(validSubmissionInput("sub_repeat"));
    const second = await service.submit(validSubmissionInput("sub_repeat"));

    expect(first.status).toBe("DELIVERED");
    expect(second).toStrictEqual({
      status: "RATE_LIMITED",
      retryAfterMilliseconds: 60_000,
    });
    expect(transport.sendCount).toBe(1);
  });

  it("allows the submission again after the window elapses", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, clock, {
      rateLimiter: new InMemoryRateLimiter({
        limit: 1,
        windowMilliseconds: 60_000,
        clock,
      }),
    });

    await service.submit(validSubmissionInput("sub_window"));
    clock.advance(60_000);
    const outcome = await service.submit(validSubmissionInput("sub_window"));

    expect(outcome.status).toBe("DELIVERED");
    expect(transport.sendCount).toBe(2);
  });

  it("keys the limiter on non-sensitive identifiers only", async () => {
    const clock = new FakeClock();
    const observedKeys: string[] = [];
    const recordingLimiter: RateLimiter = {
      async consume(key) {
        observedKeys.push(key);
        return { allowed: true };
      },
    };
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, clock, {
      rateLimiter: recordingLimiter,
    });

    await service.submit(validSubmissionInput("sub_keyed"));

    expect(observedKeys).toStrictEqual([
      `lead-form/${DEPLOYMENT_ID}/sub_keyed`,
    ]);
    expect(observedKeys[0]).not.toContain(LEAD_CONTENT.email);
  });
});
