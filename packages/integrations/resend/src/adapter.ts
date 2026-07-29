import {
  EmailDeliveryConnectorSchema,
  translateZodIssues,
} from "@melbourne-local-growth-ops/contracts";
import type {
  ValidationResult,
  WebsiteConnector,
} from "@melbourne-local-growth-ops/contracts";
import type {
  LeadDeliveryAdapter,
  LeadDeliveryProvider,
  LeadDeliveryRequest,
  LeadDeliveryResult,
} from "@melbourne-local-growth-ops/integrations";

import type { ResendDeliveryMessage } from "./message.js";
import { ResendTransportError } from "./transport.js";
import type { ResendSendRequest, ResendTransport } from "./transport.js";

/**
 * The email-delivery member of the shared connector union. Derived from the
 * package-root contract export rather than redeclared, so the adapter cannot
 * drift from the contract.
 */
export type EmailDeliveryConnector = Extract<
  WebsiteConnector,
  { type: "EMAIL_DELIVERY" }
>;

/**
 * Provider-neutral adapter that drives a `ResendTransport`.
 *
 * The host resolves the connector's `secretReferenceId` and constructs an
 * authenticated transport before injecting it here. This adapter never reads,
 * stores, or logs a raw API key, and it never mutates the configuration or the
 * message it is given.
 */
export class ResendLeadDeliveryAdapter
  implements LeadDeliveryAdapter<EmailDeliveryConnector, ResendDeliveryMessage>
{
  readonly provider: LeadDeliveryProvider = "RESEND";
  readonly supportsIdempotency = true;

  readonly #transport: ResendTransport;

  constructor(transport: ResendTransport) {
    this.#transport = transport;
  }

  validateConfiguration(input: unknown): ValidationResult<EmailDeliveryConnector> {
    const parsed = EmailDeliveryConnectorSchema.safeParse(input);

    if (!parsed.success) {
      return {
        success: false,
        issues: translateZodIssues(parsed.error.issues),
      };
    }

    return { success: true, data: parsed.data };
  }

  async deliver(
    _configuration: EmailDeliveryConnector,
    request: LeadDeliveryRequest<ResendDeliveryMessage>,
  ): Promise<LeadDeliveryResult> {
    const sendRequest: ResendSendRequest = {
      message: request.lead,
      idempotencyKey: request.idempotencyKey,
    };

    try {
      const result = await this.#transport.send(sendRequest);

      return {
        success: true,
        providerReference: result.id,
        // The package-local transport result cannot prove a provider-side
        // duplicate, so this stays false. Idempotency protection comes from
        // forwarding the caller's key unchanged.
        duplicate: false,
      };
    } catch (cause) {
      return classifyTransportFailure(cause);
    }
  }
}

/**
 * Normalize a transport failure into the shared delivery result.
 *
 * Anything that is not a `ResendTransportError` is a programming error and is
 * rethrown, so it is never misreported as a validation or delivery failure.
 * Only the closed error kind is used — provider text never reaches the result.
 */
export function classifyTransportFailure(cause: unknown): LeadDeliveryResult {
  if (!(cause instanceof ResendTransportError)) {
    throw cause;
  }

  const retryAfter =
    cause.retryAfterMilliseconds === undefined
      ? {}
      : { retryAfterMilliseconds: cause.retryAfterMilliseconds };

  switch (cause.kind) {
    case "TIMEOUT":
      return {
        success: false,
        classification: "RETRYABLE",
        code: "TIMEOUT",
        ...retryAfter,
      };
    case "NETWORK":
      return {
        success: false,
        classification: "RETRYABLE",
        code: "PROVIDER_UNAVAILABLE",
        ...retryAfter,
      };
    case "RATE_LIMITED":
      return {
        success: false,
        classification: "RETRYABLE",
        code: "RATE_LIMITED",
        ...retryAfter,
      };
    case "PROVIDER_REJECTED":
      return {
        success: false,
        classification: "PERMANENT",
        code: "PROVIDER_REJECTED",
      };
    case "UNKNOWN":
      return {
        success: false,
        classification: "UNKNOWN",
        code: "UNKNOWN",
      };
  }
}
