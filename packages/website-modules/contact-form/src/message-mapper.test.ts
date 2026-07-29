import { describe, expect, it } from "vitest";
import {
  EmailDeliveryConnectorSchema,
  LeadFormModuleSchema,
} from "@melbourne-local-growth-ops/contracts";

import { toDeliveryMessage } from "./message-mapper.js";
import type { LeadFormField, LeadFormModule } from "./input-schema.js";
import { normalizeSubmission } from "./submission.js";

/** Parse fixtures through the contracts so branded identifiers are real. */
const connector = EmailDeliveryConnectorSchema.parse({
  schemaVersion: 1,
  connectorId: "connector_email",
  accountOwner: "CLIENT",
  portability: "CLIENT_OWNED",
  type: "EMAIL_DELIVERY",
  provider: "RESEND",
  fromAddress: "leads@acme.example",
  recipientAddresses: ["owner@acme.example"],
  secretReferenceId: "secret_email",
});

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

const module = moduleWithFields(["NAME", "EMAIL", "MESSAGE"]);

const submission = normalizeSubmission(module, "sub_abc", {
  name: "Dana Smith",
  email: "dana@example.com",
  message: "Please call me.",
});

describe("toDeliveryMessage", () => {
  it("sends from the connector's verified address", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
    });

    expect(message.from).toBe("leads@acme.example");
  });

  it("never uses the visitor address as the sender", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
      replyToVisitor: true,
    });

    expect(message.from).not.toBe("dana@example.com");
    expect(message.from).toBe(connector.fromAddress);
  });

  it("targets the configured recipients", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
    });

    expect(message.to).toStrictEqual(["owner@acme.example"]);
  });

  it("omits reply-to by default", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
    });

    expect(message.replyTo).toBeUndefined();
  });

  it("sets reply-to to the visitor email when enabled", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
      replyToVisitor: true,
    });

    expect(message.replyTo).toBe("dana@example.com");
  });

  it("omits reply-to when the form collects no email", () => {
    const phoneOnly = moduleWithFields(["PHONE"]);
    const phoneSubmission = normalizeSubmission(phoneOnly, "sub_abc", {
      phone: "+61 400 000 000",
    });

    const message = toDeliveryMessage(connector, phoneSubmission, {
      businessName: "Acme Plumbing",
      replyToVisitor: true,
    });

    expect(message.replyTo).toBeUndefined();
  });

  it("renders labelled lines in declared field order", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
    });

    expect(message.text).toBe(
      "Name: Dana Smith\nEmail: dana@example.com\nMessage: Please call me.",
    );
  });

  it("includes the business name in the subject", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
    });

    expect(message.subject).toContain("Acme Plumbing");
  });

  it("does not mutate the connector or the submission", () => {
    const before = JSON.stringify({ connector, submission });

    toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
      replyToVisitor: true,
    });

    expect(JSON.stringify({ connector, submission })).toBe(before);
  });

  it("does not copy the secret reference into the message", () => {
    const message = toDeliveryMessage(connector, submission, {
      businessName: "Acme Plumbing",
    });

    expect(JSON.stringify(message)).not.toContain("secret_email");
  });
});
