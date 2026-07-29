import { describe, expect, it } from "vitest";
import {
  ContactFormService,
  InMemoryRateLimiter,
  NoopRateLimiter,
  SpamGuard,
} from "@melbourne-local-growth-ops/contact-form";
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
  overrides: Partial<{
    rateLimiter: ConstructorParameters<typeof ContactFormService>[0]["rateLimiter"];
    replyToVisitor: boolean;
  }> = {},
) {
  const adapter = new ResendLeadDeliveryAdapter(transport);

  return new ContactFormService({
    module: leadFormModule,
    connector: validatedConnector(adapter),
    deploymentId: DEPLOYMENT_ID,
    businessName: BUSINESS_NAME,
    adapter,
    rateLimiter: overrides.rateLimiter ?? new NoopRateLimiter(),
    spamGuard: new SpamGuard({ minimumFillMilliseconds: 0, clock }),
    ...(overrides.replyToVisitor === undefined
      ? {}
      : { replyToVisitor: overrides.replyToVisitor }),
  });
}

describe("contact form delivery", () => {
  it("delivers a valid submission and reports the provider reference", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    transport.setDefaultOutcome({ id: "resend_abc123" });

    const outcome = await buildService(transport, clock).submit(
      validSubmissionInput(),
    );

    expect(outcome).toStrictEqual({
      status: "DELIVERED",
      providerReference: "resend_abc123",
      idempotencyKey: `lead-form/${DEPLOYMENT_ID}/sub_01HFAKESUBMISSION`,
    });
  });

  it("requires no database and no live credential beyond the injected transport", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();

    const outcome = await buildService(transport, clock).submit(
      validSubmissionInput(),
    );

    expect(outcome.status).toBe("DELIVERED");
    expect(transport.sendCount).toBe(1);
  });

  it("sends from the verified connector address, never the visitor address", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();

    await buildService(transport, clock, { replyToVisitor: true }).submit(
      validSubmissionInput(),
    );

    const message = transport.requests[0]?.message;
    expect(message?.from).toBe("leads@acme.example");
    expect(message?.from).not.toBe(LEAD_CONTENT.email);
    expect(message?.replyTo).toBe(LEAD_CONTENT.email);
  });

  it("delivers the declared fields in configuration order", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();

    await buildService(transport, clock).submit(validSubmissionInput());

    expect(transport.requests[0]?.message.text).toBe(
      `Name: ${LEAD_CONTENT.name}\nEmail: ${LEAD_CONTENT.email}\nMessage: ${LEAD_CONTENT.message}`,
    );
  });

  it("does not mutate the caller's raw input", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const input = validSubmissionInput();
    const before = JSON.stringify(input);

    await buildService(transport, clock).submit(input);

    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate the validated connector across deliveries", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const adapter = new ResendLeadDeliveryAdapter(transport);
    const connector = validatedConnector(adapter);
    const before = JSON.stringify(connector);

    const service = new ContactFormService({
      module: leadFormModule,
      connector,
      deploymentId: DEPLOYMENT_ID,
      businessName: BUSINESS_NAME,
      adapter,
      rateLimiter: new NoopRateLimiter(),
      spamGuard: new SpamGuard({ minimumFillMilliseconds: 0, clock }),
    });

    await service.submit(validSubmissionInput("sub_one"));
    await service.submit(validSubmissionInput("sub_two"));

    expect(JSON.stringify(connector)).toBe(before);
  });

  it("keeps two submissions independent through a shared service", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const service = buildService(transport, clock, {
      rateLimiter: new InMemoryRateLimiter({
        limit: 5,
        windowMilliseconds: 60_000,
        clock,
      }),
    });

    await service.submit(validSubmissionInput("sub_first"));
    await service.submit(validSubmissionInput("sub_second"));

    expect(transport.requests.map((entry) => entry.idempotencyKey)).toStrictEqual([
      `lead-form/${DEPLOYMENT_ID}/sub_first`,
      `lead-form/${DEPLOYMENT_ID}/sub_second`,
    ]);
  });
});
