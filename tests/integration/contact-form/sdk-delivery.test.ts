import { describe, expect, it } from "vitest";
import {
  ContactFormService,
  NoopRateLimiter,
  SpamGuard,
} from "@melbourne-local-growth-ops/contact-form";
import {
  FakeResendClient,
  ManualDeadlineScheduler,
  ResendLeadDeliveryAdapter,
  createResendTransportFromClient,
  providerError,
} from "@melbourne-local-growth-ops/resend";

import {
  BUSINESS_NAME,
  DEPLOYMENT_ID,
  FakeClock,
  HOST_RESOLVED_API_KEY,
  LEAD_CONTENT,
  SENSITIVE_STRINGS,
  leadFormModule,
  validSubmissionInput,
  validatedConnector,
} from "./fixtures.js";

/**
 * Wire the real production path end to end: service → adapter → SDK transport,
 * with only the SDK client itself faked. No network, no credential.
 */
function buildService(
  client: FakeResendClient,
  options: { scheduler?: ManualDeadlineScheduler; replyToVisitor?: boolean } = {},
) {
  const transport = createResendTransportFromClient({
    client,
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
  });
  const adapter = new ResendLeadDeliveryAdapter(transport);

  return new ContactFormService({
    module: leadFormModule,
    connector: validatedConnector(adapter),
    deploymentId: DEPLOYMENT_ID,
    businessName: BUSINESS_NAME,
    adapter,
    rateLimiter: new NoopRateLimiter(),
    spamGuard: new SpamGuard({
      minimumFillMilliseconds: 0,
      clock: new FakeClock(),
    }),
    ...(options.replyToVisitor === undefined
      ? {}
      : { replyToVisitor: options.replyToVisitor }),
  });
}

describe("contact form over the SDK transport", () => {
  it("delivers a submission through the real adapter and transport", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "success", id: "resend_sdk_1" });

    const outcome = await buildService(client).submit(validSubmissionInput());

    expect(outcome).toStrictEqual({
      status: "DELIVERED",
      providerReference: "resend_sdk_1",
      idempotencyKey: `lead-form/${DEPLOYMENT_ID}/sub_01HFAKESUBMISSION`,
    });
  });

  it("forwards the derived idempotency key to the SDK", async () => {
    const client = new FakeResendClient();

    await buildService(client).submit(validSubmissionInput("sub_sdk_key"));

    expect(client.calls[0]?.options?.idempotencyKey).toBe(
      `lead-form/${DEPLOYMENT_ID}/sub_sdk_key`,
    );
  });

  it("sends from the verified connector address", async () => {
    const client = new FakeResendClient();

    await buildService(client, { replyToVisitor: true }).submit(
      validSubmissionInput(),
    );

    expect(client.calls[0]?.payload.from).toBe("leads@acme.example");
    expect(client.calls[0]?.payload.replyTo).toBe(LEAD_CONTENT.email);
  });

  it("never contacts the provider for an invalid submission", async () => {
    const client = new FakeResendClient();

    const outcome = await buildService(client).submit(
      validSubmissionInput("sub_bad", { email: "not-an-email" }),
    );

    expect(outcome.status).toBe("INVALID");
    expect(client.sendCount).toBe(0);
  });

  it("never contacts the provider for a spam submission", async () => {
    const client = new FakeResendClient();

    const outcome = await buildService(client).submit(
      validSubmissionInput("sub_bot", { honeypot: "http://spam.example" }),
    );

    expect(outcome.status).toBe("REJECTED_AS_SPAM");
    expect(client.sendCount).toBe(0);
  });
});

describe("provider failures surface as normalized outcomes", () => {
  it("maps a validation rejection to a permanent failure", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "providerError",
      error: providerError("validation_error", 422),
    });

    expect(await buildService(client).submit(validSubmissionInput())).toStrictEqual(
      {
        status: "DELIVERY_FAILED",
        classification: "PERMANENT",
        code: "PROVIDER_REJECTED",
      },
    );
  });

  it("maps rate limiting to a retryable failure with retry metadata", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "providerError",
      error: providerError("rate_limit_exceeded", 429),
      headers: { "retry-after": "25" },
    });

    expect(await buildService(client).submit(validSubmissionInput())).toStrictEqual(
      {
        status: "DELIVERY_FAILED",
        classification: "RETRYABLE",
        code: "RATE_LIMITED",
        retryAfterMilliseconds: 25_000,
      },
    );
  });

  it("maps a network fault to a retryable provider outage", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "providerError",
      error: providerError("application_error", null),
      headers: null,
    });

    expect(await buildService(client).submit(validSubmissionInput())).toStrictEqual(
      {
        status: "DELIVERY_FAILED",
        classification: "RETRYABLE",
        code: "PROVIDER_UNAVAILABLE",
      },
    );
  });

  it("does not encourage retrying an exhausted daily quota", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "providerError",
      error: providerError("daily_quota_exceeded", 429),
    });

    const outcome = await buildService(client).submit(validSubmissionInput());

    expect(outcome).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "PERMANENT",
      code: "PROVIDER_REJECTED",
    });
  });

  it("maps a timeout to a retryable failure", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "never" });
    const scheduler = new ManualDeadlineScheduler();

    const pending = buildService(client, { scheduler }).submit(
      validSubmissionInput(),
    );
    scheduler.expire();
    const outcome = await pending;
    client.settlePendingWithFailure();

    expect(outcome).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "RETRYABLE",
      code: "TIMEOUT",
    });
  });
});

describe("redaction across the SDK boundary", () => {
  it("keeps the key and lead content out of every failure outcome", async () => {
    const scripted = [
      {
        kind: "providerError" as const,
        error: providerError(
          "validation_error",
          422,
          `rejected ${LEAD_CONTENT.email} with ${HOST_RESOLVED_API_KEY}`,
        ),
      },
      {
        kind: "throws" as const,
        cause: new Error(`transport blew up ${HOST_RESOLVED_API_KEY}`),
      },
    ];

    for (const outcomeScript of scripted) {
      const client = new FakeResendClient();
      client.setOutcome(outcomeScript);

      const outcome = await buildService(client).submit(validSubmissionInput());
      const serialized = JSON.stringify(outcome);

      for (const sensitive of SENSITIVE_STRINGS) {
        expect(serialized).not.toContain(sensitive);
      }
    }
  });

  it("keeps the key out of the payload handed to the SDK", async () => {
    const client = new FakeResendClient();

    await buildService(client).submit(validSubmissionInput());

    expect(JSON.stringify(client.calls)).not.toContain(HOST_RESOLVED_API_KEY);
  });

  it("keeps the secret reference out of the payload", async () => {
    const client = new FakeResendClient();

    await buildService(client).submit(validSubmissionInput());

    expect(JSON.stringify(client.calls)).not.toContain("secret_email_resend");
  });
});
