import { describe, expect, it } from "vitest";
import {
  ContactFormService,
  NoopRateLimiter,
  SpamGuard,
} from "@melbourne-local-growth-ops/contact-form";
import {
  ResendLeadDeliveryAdapter,
  ResendTransportError,
  mockNetworkError,
  mockProviderRejectedError,
  mockRateLimitedError,
  mockTimeoutError,
  mockUnknownError,
} from "@melbourne-local-growth-ops/resend";
import type { ResendSendOutcome } from "@melbourne-local-growth-ops/resend";

import {
  BUSINESS_NAME,
  CredentialHoldingTransport,
  DEPLOYMENT_ID,
  FakeClock,
  leadFormModule,
  validSubmissionInput,
  validatedConnector,
} from "./fixtures.js";

function buildService(transport: CredentialHoldingTransport) {
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
  });
}

async function submitWithOutcome(outcome: ResendSendOutcome) {
  const transport = new CredentialHoldingTransport();
  transport.setDefaultOutcome(outcome);
  const service = buildService(transport);

  return service.submit(validSubmissionInput("sub_classify"));
}

describe("provider failure classification reaches the host unchanged", () => {
  it("classifies a timeout as retryable", async () => {
    expect(await submitWithOutcome(mockTimeoutError())).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "RETRYABLE",
      code: "TIMEOUT",
    });
  });

  it("classifies a network failure as a retryable provider outage", async () => {
    expect(await submitWithOutcome(mockNetworkError())).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "RETRYABLE",
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("classifies provider rate limiting as retryable with retry-after", async () => {
    expect(await submitWithOutcome(mockRateLimitedError(20_000))).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "RETRYABLE",
      code: "RATE_LIMITED",
      retryAfterMilliseconds: 20_000,
    });
  });

  it("classifies provider rejection as permanent", async () => {
    expect(await submitWithOutcome(mockProviderRejectedError())).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "PERMANENT",
      code: "PROVIDER_REJECTED",
    });
  });

  it("classifies an unrecognized provider failure as unknown", async () => {
    expect(await submitWithOutcome(mockUnknownError())).toStrictEqual({
      status: "DELIVERY_FAILED",
      classification: "UNKNOWN",
      code: "UNKNOWN",
    });
  });
});

describe("retry behaviour across attempts", () => {
  it("lets a retried submission succeed after a transient failure", async () => {
    const transport = new CredentialHoldingTransport();
    const key = `lead-form/${DEPLOYMENT_ID}/sub_retry`;
    transport.configureOutcome(key, mockTimeoutError());
    const service = buildService(transport);

    const first = await service.submit(validSubmissionInput("sub_retry"));
    expect(first).toMatchObject({
      status: "DELIVERY_FAILED",
      classification: "RETRYABLE",
    });

    transport.configureOutcome(key, { id: "resend_after_retry" });
    const second = await service.submit(validSubmissionInput("sub_retry"));

    expect(second).toStrictEqual({
      status: "DELIVERED",
      providerReference: "resend_after_retry",
      idempotencyKey: key,
    });
  });

  it("forwards the same idempotency key on every retry of one submission", async () => {
    const transport = new CredentialHoldingTransport();
    const key = `lead-form/${DEPLOYMENT_ID}/sub_stable`;
    transport.configureOutcome(key, mockTimeoutError());
    const service = buildService(transport);

    await service.submit(validSubmissionInput("sub_stable"));
    await service.submit(validSubmissionInput("sub_stable"));
    await service.submit(validSubmissionInput("sub_stable"));

    expect(transport.requests).toHaveLength(3);
    expect(
      transport.requests.every((entry) => entry.idempotencyKey === key),
    ).toBe(true);
  });

  it("reports duplicate as false because the transport cannot prove a provider duplicate", async () => {
    const transport = new CredentialHoldingTransport();
    const adapter = new ResendLeadDeliveryAdapter(transport);
    const connector = validatedConnector(adapter);
    const key = `lead-form/${DEPLOYMENT_ID}/sub_dup`;

    const first = await adapter.deliver(connector, {
      lead: {
        from: connector.fromAddress,
        to: [...connector.recipientAddresses],
        subject: "New website enquiry",
        text: "Message: hello",
      },
      idempotencyKey: key,
      correlationId: key,
    });
    const second = await adapter.deliver(connector, {
      lead: {
        from: connector.fromAddress,
        to: [...connector.recipientAddresses],
        subject: "New website enquiry",
        text: "Message: hello",
      },
      idempotencyKey: key,
      correlationId: key,
    });

    expect(first).toMatchObject({ success: true, duplicate: false });
    expect(second).toMatchObject({ success: true, duplicate: false });
  });

  it("propagates a programming error instead of reporting a delivery failure", async () => {
    const brokenTransport = {
      send: () => Promise.reject(new TypeError("transport misconfigured")),
    };
    const adapter = new ResendLeadDeliveryAdapter(brokenTransport);
    const service = new ContactFormService({
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
    });

    await expect(service.submit(validSubmissionInput("sub_bug"))).rejects.toThrow(
      TypeError,
    );
  });

  it("keeps provider text out of the normalized failure", async () => {
    const outcome = await submitWithOutcome(
      new ResendTransportError(
        "PROVIDER_REJECTED",
        "domain acme.example unverified for key re_live_LEAK",
      ),
    );

    expect(JSON.stringify(outcome)).not.toContain("re_live_LEAK");
    expect(JSON.stringify(outcome)).not.toContain("unverified");
  });
});
