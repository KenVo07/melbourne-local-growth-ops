import { describe, expect, it } from "vitest";

import {
  ResendLeadDeliveryAdapter,
  classifyTransportFailure,
} from "./adapter.js";
import type { EmailDeliveryConnector } from "./adapter.js";
import {
  MockResendTransport,
  mockNetworkError,
  mockProviderRejectedError,
  mockRateLimitedError,
  mockTimeoutError,
  mockUnknownError,
} from "./mock-transport.js";
import type { ResendDeliveryMessage } from "./message.js";
import { ResendTransportError } from "./transport.js";

const connectorInput = {
  schemaVersion: 1,
  connectorId: "connector_email",
  accountOwner: "CLIENT",
  portability: "CLIENT_OWNED",
  type: "EMAIL_DELIVERY",
  provider: "RESEND",
  fromAddress: "leads@acme.example",
  recipientAddresses: ["owner@acme.example"],
  secretReferenceId: "secret_email",
} as const;

function validConnector(
  adapter: ResendLeadDeliveryAdapter,
): EmailDeliveryConnector {
  const result = adapter.validateConfiguration(connectorInput);
  if (!result.success) {
    throw new Error("fixture connector must be valid");
  }
  return result.data;
}

const message: ResendDeliveryMessage = Object.freeze({
  from: "leads@acme.example",
  to: Object.freeze(["owner@acme.example"]),
  subject: "New website enquiry",
  text: "Name: Dana Smith\nMessage: Please call me.",
});

function request(idempotencyKey = "lead-form/dep_001/sub_abc") {
  return {
    lead: message,
    idempotencyKey,
    correlationId: "corr_001",
  };
}

describe("ResendLeadDeliveryAdapter configuration", () => {
  it("accepts a valid email delivery connector", () => {
    const adapter = new ResendLeadDeliveryAdapter(new MockResendTransport());

    const result = adapter.validateConfiguration(connectorInput);

    expect(result.success).toBe(true);
  });

  it("rejects an invalid connector configuration", () => {
    const adapter = new ResendLeadDeliveryAdapter(new MockResendTransport());

    const result = adapter.validateConfiguration({
      ...connectorInput,
      fromAddress: "not-an-email",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it("rejects a non-email connector type", () => {
    const adapter = new ResendLeadDeliveryAdapter(new MockResendTransport());

    const result = adapter.validateConfiguration({
      ...connectorInput,
      type: "BOOKING_LINK",
    });

    expect(result.success).toBe(false);
  });

  it("declares provider identity and idempotency support", () => {
    const adapter = new ResendLeadDeliveryAdapter(new MockResendTransport());

    expect(adapter.provider).toBe("RESEND");
    expect(adapter.supportsIdempotency).toBe(true);
  });
});

describe("ResendLeadDeliveryAdapter delivery", () => {
  it("returns a normalized success with the provider reference", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome({ id: "resend_123" });
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());

    expect(result).toStrictEqual({
      success: true,
      providerReference: "resend_123",
      duplicate: false,
    });
  });

  it("forwards the caller idempotency key unchanged", async () => {
    const transport = new MockResendTransport();
    const adapter = new ResendLeadDeliveryAdapter(transport);
    const key = "lead-form/dep_001/sub_zzz";

    await adapter.deliver(validConnector(adapter), request(key));

    expect(transport.requests).toHaveLength(1);
    expect(transport.requests[0]?.idempotencyKey).toBe(key);
  });

  it("forwards the same key for a repeated submission", async () => {
    const transport = new MockResendTransport();
    const adapter = new ResendLeadDeliveryAdapter(transport);
    const connector = validConnector(adapter);
    const key = "lead-form/dep_001/sub_repeat";

    await adapter.deliver(connector, request(key));
    await adapter.deliver(connector, request(key));

    expect(transport.requests.map((entry) => entry.idempotencyKey)).toStrictEqual([
      key,
      key,
    ]);
  });

  it("does not mutate the configuration or the message", async () => {
    const transport = new MockResendTransport();
    const adapter = new ResendLeadDeliveryAdapter(transport);
    const connector = Object.freeze(validConnector(adapter));
    const before = JSON.stringify({ connector, message });

    await adapter.deliver(connector, request());

    expect(JSON.stringify({ connector, message })).toBe(before);
  });
});

describe("ResendLeadDeliveryAdapter failure classification", () => {
  it("classifies a timeout as retryable", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(mockTimeoutError());
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());

    expect(result).toStrictEqual({
      success: false,
      classification: "RETRYABLE",
      code: "TIMEOUT",
    });
  });

  it("classifies a network failure as a retryable provider outage", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(mockNetworkError());
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());

    expect(result).toStrictEqual({
      success: false,
      classification: "RETRYABLE",
      code: "PROVIDER_UNAVAILABLE",
    });
  });

  it("classifies rate limiting as retryable and preserves retry-after", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(mockRateLimitedError(45_000));
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());

    expect(result).toStrictEqual({
      success: false,
      classification: "RETRYABLE",
      code: "RATE_LIMITED",
      retryAfterMilliseconds: 45_000,
    });
  });

  it("classifies provider rejection as permanent", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(mockProviderRejectedError());
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());

    expect(result).toStrictEqual({
      success: false,
      classification: "PERMANENT",
      code: "PROVIDER_REJECTED",
    });
  });

  it("classifies an unrecognized transport failure as unknown", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(mockUnknownError());
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());

    expect(result).toStrictEqual({
      success: false,
      classification: "UNKNOWN",
      code: "UNKNOWN",
    });
  });

  it("does not misclassify a programming error as a delivery failure", async () => {
    const bug = new TypeError("cannot read property of undefined");
    const adapter = new ResendLeadDeliveryAdapter({
      send: () => Promise.reject(bug),
    });

    await expect(
      adapter.deliver(validConnector(adapter), request()),
    ).rejects.toBe(bug);
  });

  it("omits provider text from the normalized failure result", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(
      new ResendTransportError(
        "PROVIDER_REJECTED",
        "key re_live_SECRET rejected for dana@example.com",
      ),
    );
    const adapter = new ResendLeadDeliveryAdapter(transport);

    const result = await adapter.deliver(validConnector(adapter), request());
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("re_live_SECRET");
    expect(serialized).not.toContain("dana@example.com");
  });

  it("rethrows non-transport values from classification", () => {
    expect(() => classifyTransportFailure(new Error("boom"))).toThrow("boom");
  });
});
