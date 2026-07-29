import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ContactFormService,
  InMemoryRateLimiter,
  SpamGuard,
} from "@melbourne-local-growth-ops/contact-form";
import {
  ResendLeadDeliveryAdapter,
  mockProviderRejectedError,
  mockTimeoutError,
} from "@melbourne-local-growth-ops/resend";

import {
  BUSINESS_NAME,
  CredentialHoldingTransport,
  DEPLOYMENT_ID,
  FakeClock,
  HOST_RESOLVED_API_KEY,
  LEAD_CONTENT,
  SENSITIVE_STRINGS,
  leadFormModule,
  validSubmissionInput,
  validatedConnector,
} from "./fixtures.js";

type ConsoleMethod = "log" | "info" | "warn" | "error" | "debug";
type ConsoleLike = Record<ConsoleMethod, (...args: unknown[]) => void>;

/**
 * Reached through globalThis so these tests need no DOM lib and no Node type
 * dependency just to assert on logging.
 */
const consoleLike = (globalThis as unknown as { console: ConsoleLike }).console;

/** Capture everything written to the console during a submission. */
function captureConsole() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.map((arg) => String(arg)).join(" "));
  };

  const methods: readonly ConsoleMethod[] = [
    "log",
    "info",
    "warn",
    "error",
    "debug",
  ];
  const spies = methods.map((method) =>
    vi.spyOn(consoleLike, method).mockImplementation(record),
  );

  return {
    lines,
    restore: () => spies.forEach((spy) => spy.mockRestore()),
  };
}

function buildService(transport: CredentialHoldingTransport, clock: FakeClock) {
  const adapter = new ResendLeadDeliveryAdapter(transport);

  return new ContactFormService({
    module: leadFormModule,
    connector: validatedConnector(adapter),
    deploymentId: DEPLOYMENT_ID,
    businessName: BUSINESS_NAME,
    adapter,
    rateLimiter: new InMemoryRateLimiter({
      limit: 5,
      windowMilliseconds: 60_000,
      clock,
    }),
    spamGuard: new SpamGuard({ minimumFillMilliseconds: 0, clock }),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("credential redaction", () => {
  it("never places the host-resolved key in a successful outcome", async () => {
    const transport = new CredentialHoldingTransport();
    const outcome = await buildService(transport, new FakeClock()).submit(
      validSubmissionInput(),
    );

    expect(JSON.stringify(outcome)).not.toContain(HOST_RESOLVED_API_KEY);
  });

  it("never places the key in a failed outcome", async () => {
    const transport = new CredentialHoldingTransport();
    transport.setDefaultOutcome(mockProviderRejectedError());

    const outcome = await buildService(transport, new FakeClock()).submit(
      validSubmissionInput(),
    );

    expect(JSON.stringify(outcome)).not.toContain(HOST_RESOLVED_API_KEY);
  });

  it("never places the key in the provider message", async () => {
    const transport = new CredentialHoldingTransport();
    await buildService(transport, new FakeClock()).submit(validSubmissionInput());

    expect(JSON.stringify(transport.requests)).not.toContain(
      HOST_RESOLVED_API_KEY,
    );
  });

  it("keeps the secret reference out of the delivered message", async () => {
    const transport = new CredentialHoldingTransport();
    await buildService(transport, new FakeClock()).submit(validSubmissionInput());

    expect(JSON.stringify(transport.requests[0]?.message)).not.toContain(
      "secret_email_resend",
    );
  });
});

describe("lead content redaction", () => {
  it("keeps lead content out of a successful outcome", async () => {
    const transport = new CredentialHoldingTransport();
    const outcome = await buildService(transport, new FakeClock()).submit(
      validSubmissionInput(),
    );

    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain(LEAD_CONTENT.name);
    expect(serialized).not.toContain(LEAD_CONTENT.email);
    expect(serialized).not.toContain(LEAD_CONTENT.message);
  });

  it("keeps lead content out of every failure outcome", async () => {
    for (const outcomeScript of [mockTimeoutError(), mockProviderRejectedError()]) {
      const transport = new CredentialHoldingTransport();
      transport.setDefaultOutcome(outcomeScript);

      const outcome = await buildService(transport, new FakeClock()).submit(
        validSubmissionInput(),
      );
      const serialized = JSON.stringify(outcome);

      for (const sensitive of SENSITIVE_STRINGS) {
        expect(serialized).not.toContain(sensitive);
      }
    }
  });

  it("keeps lead content out of a spam rejection", async () => {
    const transport = new CredentialHoldingTransport();
    const outcome = await buildService(transport, new FakeClock()).submit(
      validSubmissionInput("sub_bot", { honeypot: LEAD_CONTENT.email }),
    );

    for (const sensitive of SENSITIVE_STRINGS) {
      expect(JSON.stringify(outcome)).not.toContain(sensitive);
    }
  });

  it("keeps lead content out of a rate-limit rejection", async () => {
    const clock = new FakeClock();
    const transport = new CredentialHoldingTransport();
    const adapter = new ResendLeadDeliveryAdapter(transport);
    const service = new ContactFormService({
      module: leadFormModule,
      connector: validatedConnector(adapter),
      deploymentId: DEPLOYMENT_ID,
      businessName: BUSINESS_NAME,
      adapter,
      rateLimiter: new InMemoryRateLimiter({
        limit: 1,
        windowMilliseconds: 60_000,
        clock,
      }),
      spamGuard: new SpamGuard({ minimumFillMilliseconds: 0, clock }),
    });

    await service.submit(validSubmissionInput("sub_limited"));
    const outcome = await service.submit(validSubmissionInput("sub_limited"));

    expect(outcome.status).toBe("RATE_LIMITED");
    for (const sensitive of SENSITIVE_STRINGS) {
      expect(JSON.stringify(outcome)).not.toContain(sensitive);
    }
  });

  it("keeps lead content and credentials out of the idempotency key", async () => {
    const transport = new CredentialHoldingTransport();
    const outcome = await buildService(transport, new FakeClock()).submit(
      validSubmissionInput(),
    );

    expect(outcome.status).toBe("DELIVERED");
    if (outcome.status === "DELIVERED") {
      for (const sensitive of SENSITIVE_STRINGS) {
        expect(outcome.idempotencyKey).not.toContain(sensitive);
      }
    }
  });
});

describe("logging boundary", () => {
  it("writes nothing to the console on a successful delivery", async () => {
    const captured = captureConsole();
    try {
      const transport = new CredentialHoldingTransport();
      await buildService(transport, new FakeClock()).submit(
        validSubmissionInput(),
      );
    } finally {
      captured.restore();
    }

    expect(captured.lines).toStrictEqual([]);
  });

  it("writes no sensitive data to the console on failure paths", async () => {
    const captured = captureConsole();
    try {
      const transport = new CredentialHoldingTransport();
      transport.setDefaultOutcome(mockProviderRejectedError());
      const service = buildService(transport, new FakeClock());

      await service.submit(validSubmissionInput("sub_fail"));
      await service.submit(
        validSubmissionInput("sub_invalid", { email: "not-an-email" }),
      );
      await service.submit(
        validSubmissionInput("sub_spam", { honeypot: "bot" }),
      );
    } finally {
      captured.restore();
    }

    const joined = captured.lines.join("\n");
    for (const sensitive of SENSITIVE_STRINGS) {
      expect(joined).not.toContain(sensitive);
    }
  });
});
