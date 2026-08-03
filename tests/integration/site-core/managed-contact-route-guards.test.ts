import {
  MockResendTransport,
} from "@melbourne-local-growth-ops/resend";
import { describe, expect, it } from "vitest";

import {
  handleContactFormRequest,
} from "../../../apps/managed-web/src/server/contact-form-runtime";
import { createManagedContactRuntime } from "../../../apps/managed-web/src/server/managed-contact-runtime";

describe("managed contact route with production guards", () => {
  it("rejects cross-site requests before provider invocation in production path", async () => {
    const transport = new MockResendTransport();
    const runtime = createManagedContactRuntime({
      environment: { MLGO_RESEND_API_KEY_01: "test-credential-value" },
      createTransport: () => transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequestWithOrigin(
        "https://example.com.au/api/contact",
        {
          moduleId: "lead-primary",
          submission: {
            submissionId: "submission-cross-site",
            name: "Dana Smith",
            email: "dana@example.com",
            phone: "+61 400 000 000",
            message: "Please call me.",
            renderedAt: 10_000,
          },
        },
        "https://attacker.example",
      ),
      runtime,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: "SUBMISSION_REJECTED",
    });
    expect(transport.sendCount).toBe(0);
  });

  it("allows requests without Origin or Referer for M1 compatibility", async () => {
    const runtime = createManagedContactRuntime();

    const response = await handleContactFormRequest(
      new Request("http://managed.invalid/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          moduleId: "nonexistent",
          submission: {},
        }),
      }),
      runtime,
    );

    // Should get 404 FORM_NOT_FOUND, not 400 SUBMISSION_REJECTED from guard
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toEqual({ ok: false, code: "FORM_NOT_FOUND" });
  });

  it("allows same-origin requests in production path", async () => {
    const transport = new MockResendTransport();
    const runtime = createManagedContactRuntime({
      environment: { MLGO_RESEND_API_KEY_01: "test-credential-value" },
      createTransport: () => transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequestWithOrigin(
        "https://example.com.au/api/contact",
        {
          moduleId: "lead-primary",
          submission: {
            submissionId: "submission-same-origin",
            name: "Dana Smith",
            email: "dana@example.com",
            phone: "+61 400 000 000",
            message: "Please call me.",
            renderedAt: 10_000,
          },
        },
        "https://example.com.au",
      ),
      runtime,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(transport.sendCount).toBe(1);
  });

  it("emits no PII in rejection responses", async () => {
    const transport = new MockResendTransport();
    const runtime = createManagedContactRuntime({
      environment: { MLGO_RESEND_API_KEY_01: "test-credential-value" },
      createTransport: () => transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequestWithOrigin(
        "https://example.com.au/api/contact",
        {
          moduleId: "lead-primary",
          submission: {
            submissionId: "submission-pii-check",
            name: "Sensitive Name",
            email: "secret@example.com",
            phone: "+61 400 123 456",
            message: "Private information here",
            renderedAt: 10_000,
          },
        },
        "https://attacker.example",
      ),
      runtime,
    );

    const text = await response.text();

    expect(response.status).toBe(400);
    expect(text).not.toContain("Sensitive Name");
    expect(text).not.toContain("secret@example.com");
    expect(text).not.toContain("+61 400 123 456");
    expect(text).not.toContain("Private information");
    expect(text).not.toContain("attacker.example");
  });
});

function contactRequestWithOrigin(url: string, body: unknown, origin: string): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify(body),
  });
}
