import type {
  Clock,
  LeadFormModule,
} from "@melbourne-local-growth-ops/contact-form";
import {
  MockResendTransport,
  ResendLeadDeliveryAdapter,
} from "@melbourne-local-growth-ops/resend";
import type {
  EmailDeliveryConnector,
  ResendSendRequest,
  ResendSendResult,
  ResendTransport,
} from "@melbourne-local-growth-ops/resend";

/**
 * Stands in for the credential a real host would resolve from
 * `secretReferenceId`. Tests assert this string never appears in any outcome,
 * log line, or normalized error.
 */
export const HOST_RESOLVED_API_KEY = "re_live_NEVER_LOG_THIS_KEY";

/** Lead content used to assert it never escapes the delivery boundary. */
export const LEAD_CONTENT = Object.freeze({
  name: "Dana Smith",
  email: "dana@example.com",
  phone: "+61 400 111 222",
  message: "Our hot water system is leaking, please call today.",
});

export const DEPLOYMENT_ID = "dep_01HFAKEDEPLOY";
export const BUSINESS_NAME = "Acme Plumbing";

export class FakeClock implements Clock {
  #current: number;

  constructor(start = 1_700_000_000_000) {
    this.#current = start;
  }

  now(): number {
    return this.#current;
  }

  advance(milliseconds: number): void {
    this.#current += milliseconds;
  }
}

export const leadFormModule = Object.freeze({
  schemaVersion: 1,
  moduleId: "module_lead_form",
  connectorId: "connector_email",
  type: "LEAD_FORM",
  fields: Object.freeze(["NAME", "EMAIL", "MESSAGE"]),
}) as unknown as LeadFormModule;

/** Raw runtime configuration, exactly as it appears in a website config. */
export const emailConnectorInput = Object.freeze({
  schemaVersion: 1,
  connectorId: "connector_email",
  accountOwner: "CLIENT",
  portability: "CLIENT_OWNED",
  type: "EMAIL_DELIVERY",
  provider: "RESEND",
  fromAddress: "leads@acme.example",
  recipientAddresses: Object.freeze(["owner@acme.example"]),
  secretReferenceId: "secret_email_resend",
});

/**
 * Validate the connector through the adapter, the way a host would before
 * delivering anything.
 */
export function validatedConnector(
  adapter: ResendLeadDeliveryAdapter,
  input: unknown = emailConnectorInput,
): EmailDeliveryConnector {
  const result = adapter.validateConfiguration(input);
  if (!result.success) {
    throw new Error("fixture connector must validate");
  }
  return result.data;
}

/**
 * A transport that closes over a host-resolved credential, mirroring the real
 * wiring boundary: the host resolves `secretReferenceId`, constructs an
 * authenticated transport, and injects it. The adapter never sees the key.
 *
 * It records requests and can be scripted to fail, so tests can prove the
 * credential never reaches an outcome even on the error path.
 */
export class CredentialHoldingTransport implements ResendTransport {
  readonly #apiKey: string;
  readonly #inner = new MockResendTransport();

  constructor(apiKey: string = HOST_RESOLVED_API_KEY) {
    this.#apiKey = apiKey;
  }

  get requests(): readonly ResendSendRequest[] {
    return this.#inner.requests;
  }

  get sendCount(): number {
    return this.#inner.sendCount;
  }

  setDefaultOutcome(
    outcome: Parameters<MockResendTransport["setDefaultOutcome"]>[0],
  ): void {
    this.#inner.setDefaultOutcome(outcome);
  }

  configureOutcome(
    key: string,
    outcome: Parameters<MockResendTransport["configureOutcome"]>[1],
  ): void {
    this.#inner.configureOutcome(key, outcome);
  }

  async send(request: ResendSendRequest): Promise<ResendSendResult> {
    if (this.#apiKey.length === 0) {
      throw new Error("transport was not authenticated by the host");
    }
    return this.#inner.send(request);
  }
}

export function validSubmissionInput(
  submissionId = "sub_01HFAKESUBMISSION",
  overrides: Readonly<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    submissionId,
    name: LEAD_CONTENT.name,
    email: LEAD_CONTENT.email,
    message: LEAD_CONTENT.message,
    ...overrides,
  };
}

/** Every sensitive string that must never appear in logs or outcomes. */
export const SENSITIVE_STRINGS: readonly string[] = Object.freeze([
  HOST_RESOLVED_API_KEY,
  LEAD_CONTENT.name,
  LEAD_CONTENT.email,
  LEAD_CONTENT.phone,
  LEAD_CONTENT.message,
]);
