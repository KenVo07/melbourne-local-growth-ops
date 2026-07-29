import {
  MockResendTransport,
  mockNetworkError,
} from "@melbourne-local-growth-ops/resend";
import {
  EmailDeliveryConnectorSchema,
  LeadFormModuleSchema,
} from "@melbourne-local-growth-ops/contracts";
import { describe, expect, it } from "vitest";

import {
  createContactSubmissionService,
  handleContactFormRequest,
} from "../../../apps/managed-web/src/server/contact-form-runtime";
import { createManagedContactRuntime } from "../../../apps/managed-web/src/server/managed-contact-runtime";

const leadModule = LeadFormModuleSchema.parse({
  schemaVersion: 1,
  moduleId: "lead-client-a",
  connectorId: "email-client-a",
  type: "LEAD_FORM",
  fields: ["NAME", "EMAIL", "MESSAGE"],
});

const emailConnector = EmailDeliveryConnectorSchema.parse({
  schemaVersion: 1,
  connectorId: "email-client-a",
  accountOwner: "CLIENT",
  portability: "TRANSFERABLE",
  type: "EMAIL_DELIVERY",
  provider: "RESEND",
  fromAddress: "website@client-a.example.com.au",
  recipientAddresses: ["owner@client-a.example.com.au"],
  secretReferenceId: "resend-client-a",
});

describe("managed contact route", () => {
  it("resolves the generated client form and environment binding end to end", async () => {
    const transport = new MockResendTransport();
    const runtime = createManagedContactRuntime({
      environment: { MLGO_RESEND_API_KEY_01: "test-credential-value" },
      createTransport: () => transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequest({
        moduleId: "lead-primary",
        submission: {
          submissionId: "submission-runtime",
          name: "Dana Smith",
          email: "dana@example.com",
          phone: "+61 400 000 000",
          message: "Please call me.",
          renderedAt: 10_000,
        },
      }),
      runtime,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(transport.sendCount).toBe(1);
  });

  it("fails safely when the isolated deployment has no bound Resend credential", async () => {
    const runtime = createManagedContactRuntime({ environment: {} });
    const response = await handleContactFormRequest(
      contactRequest({
        moduleId: "lead-primary",
        submission: {
          submissionId: "submission-runtime",
          name: "Dana Smith",
          email: "dana@example.com",
          phone: "+61 400 000 000",
          message: "Private message",
          renderedAt: 10_000,
        },
      }),
      runtime,
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(text).not.toContain("dana@example.com");
    expect(text).not.toContain("MLGO_RESEND_API_KEY_01");
  });

  it("delivers through ContactFormService and returns only a safe success response", async () => {
    const transport = new MockResendTransport();
    const submit = createContactSubmissionService({
      module: leadModule,
      connector: emailConnector,
      deploymentId: "deployment-client-a",
      businessName: "Business client-a",
      transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequest({
        moduleId: "lead-client-a",
        submission: {
          submissionId: "submission-1",
          name: "Dana Smith",
          email: "dana@example.com",
          message: "Please call me.",
          honeypot: "",
          renderedAt: 10_000,
        },
      }),
      {
        submit(moduleId, input) {
          return moduleId === "lead-client-a"
            ? submit(input)
            : Promise.resolve(undefined);
        },
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(transport.sendCount).toBe(1);
  });

  it("returns a generic rejection and never calls Resend for invalid input", async () => {
    const transport = new MockResendTransport();
    const submit = createContactSubmissionService({
      module: leadModule,
      connector: emailConnector,
      deploymentId: "deployment-client-a",
      businessName: "Business client-a",
      transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequest({
        moduleId: "lead-client-a",
        submission: {
          submissionId: "submission-2",
          name: "Dana Smith",
          email: "not-an-email",
          message: "Private message",
          renderedAt: 10_000,
        },
      }),
      { submit: (_moduleId, input) => submit(input) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      ok: false,
      code: "SUBMISSION_REJECTED",
    });
    expect(transport.sendCount).toBe(0);
  });

  it("returns a safe unavailable response and no provider detail on delivery failure", async () => {
    const transport = new MockResendTransport();
    transport.setDefaultOutcome(mockNetworkError());
    const submit = createContactSubmissionService({
      module: leadModule,
      connector: emailConnector,
      deploymentId: "deployment-client-a",
      businessName: "Business client-a",
      transport,
      now: () => 20_000,
    });

    const response = await handleContactFormRequest(
      contactRequest({
        moduleId: "lead-client-a",
        submission: {
          submissionId: "submission-3",
          name: "Dana Smith",
          email: "dana@example.com",
          message: "Private message",
          renderedAt: 10_000,
        },
      }),
      { submit: (_moduleId, input) => submit(input) },
    );
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({
      ok: false,
      code: "SERVICE_UNAVAILABLE",
    });
    expect(text).not.toContain("dana@example.com");
    expect(text).not.toContain("Connection reset");
    expect(text).not.toContain("resend-client-a");
  });

  it("rejects malformed, oversized, and unknown-module requests before submission", async () => {
    let submissions = 0;
    const runtime = {
      submit() {
        submissions += 1;
        return Promise.resolve(undefined);
      },
    };

    const malformed = await handleContactFormRequest(
      new Request("http://managed.invalid/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      runtime,
    );
    const oversized = await handleContactFormRequest(
      new Request("http://managed.invalid/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(20_000) }),
      }),
      runtime,
    );
    const unknown = await handleContactFormRequest(
      contactRequest({ moduleId: "unknown", submission: {} }),
      runtime,
    );

    expect(malformed.status).toBe(400);
    expect(oversized.status).toBe(413);
    expect(unknown.status).toBe(404);
    expect(submissions).toBe(1);
  });
});

function contactRequest(body: unknown): Request {
  return new Request("http://managed.invalid/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
