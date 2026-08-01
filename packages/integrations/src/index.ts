import type { ValidationResult } from "@melbourne-local-growth-ops/contracts";

export type LeadDeliveryFailureClassification =
  | "RETRYABLE"
  | "PERMANENT"
  | "UNKNOWN";

export type LeadDeliveryFailureCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_LEAD"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "PROVIDER_REJECTED"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN";

export type LeadDeliveryProvider = "RESEND";

export type LeadDeliveryResult =
  | {
      readonly success: true;
      readonly providerReference: string;
      readonly duplicate: boolean;
    }
  | {
      readonly success: false;
      readonly classification: LeadDeliveryFailureClassification;
      readonly code: LeadDeliveryFailureCode;
      readonly retryAfterMilliseconds?: number;
    };

export interface LeadDeliveryRequest<TLead> {
  readonly lead: TLead;
  readonly idempotencyKey: string;
  readonly correlationId: string;
}

/**
 * Provider-neutral and stateless by default. Implementations may add an
 * optional persistence dependency only when the selected feature requires it.
 */
export interface LeadDeliveryAdapter<TConfiguration, TLead> {
  readonly provider: LeadDeliveryProvider;
  readonly supportsIdempotency: boolean;
  validateConfiguration(input: unknown): ValidationResult<TConfiguration>;
  deliver(
    configuration: TConfiguration,
    request: LeadDeliveryRequest<TLead>,
  ): Promise<LeadDeliveryResult>;
}
