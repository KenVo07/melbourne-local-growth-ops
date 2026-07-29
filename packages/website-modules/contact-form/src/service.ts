import type {
  ValidationIssue,
  ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { translateZodIssues } from "@melbourne-local-growth-ops/contracts";
import type {
  LeadDeliveryAdapter,
  LeadDeliveryFailureClassification,
  LeadDeliveryFailureCode,
} from "@melbourne-local-growth-ops/integrations";
import type {
  EmailDeliveryConnector,
  ResendDeliveryMessage,
} from "@melbourne-local-growth-ops/resend";

import { buildIdempotencyKey } from "./idempotency.js";
import { ContactFormInputSchema, buildSubmissionSchema } from "./input-schema.js";
import type { ContactFormInput, LeadFormModule } from "./input-schema.js";
import { toDeliveryMessage } from "./message-mapper.js";
import type { RateLimiter } from "./rate-limit.js";
import { normalizeSubmission } from "./submission.js";
import type { ContactFormSubmission } from "./submission.js";
import type { SpamGuard, SpamSignal } from "./spam.js";

/**
 * The outcome of a submission attempt.
 *
 * Every variant carries only technical detail. No variant echoes submitted
 * field values, so an outcome is safe to log or return to a host handler.
 */
export type ContactFormOutcome =
  | {
      readonly status: "DELIVERED";
      readonly providerReference: string;
      readonly idempotencyKey: string;
    }
  | {
      readonly status: "INVALID";
      readonly issues: readonly ValidationIssue[];
    }
  | { readonly status: "REJECTED_AS_SPAM"; readonly signal: SpamSignal }
  | {
      readonly status: "RATE_LIMITED";
      readonly retryAfterMilliseconds?: number;
    }
  | {
      readonly status: "DELIVERY_FAILED";
      readonly classification: LeadDeliveryFailureClassification;
      readonly code: LeadDeliveryFailureCode;
      readonly retryAfterMilliseconds?: number;
    };

export interface ContactFormServiceOptions {
  readonly module: LeadFormModule;
  readonly connector: EmailDeliveryConnector;
  readonly deploymentId: string;
  readonly businessName: string;
  readonly adapter: LeadDeliveryAdapter<
    EmailDeliveryConnector,
    ResendDeliveryMessage
  >;
  readonly rateLimiter: RateLimiter;
  readonly spamGuard: SpamGuard;
  readonly replyToVisitor?: boolean;
}

/**
 * Framework-neutral contact-form application service.
 *
 * It owns the submission pipeline and no transport concerns: no HTTP, no
 * secret resolution, no persistence. The host resolves the connector secret,
 * builds the delivery adapter, generates an opaque submission id, and calls
 * `submit`.
 *
 * Order matters. Validation and spam checks run before any provider call, so
 * invalid and spam submissions can never reach the provider. Rate limiting is
 * keyed on the derived idempotency key, which contains no personal data.
 */
export class ContactFormService {
  readonly #options: ContactFormServiceOptions;

  constructor(options: ContactFormServiceOptions) {
    this.#options = options;
  }

  async submit(rawInput: unknown): Promise<ContactFormOutcome> {
    const input = ContactFormInputSchema.safeParse(rawInput);
    if (!input.success) {
      return {
        status: "INVALID",
        issues: translateZodIssues(input.error.issues),
      };
    }

    const spamVerdict = this.#options.spamGuard.evaluate({
      honeypot: input.data.honeypot,
      renderedAt: input.data.renderedAt,
    });
    if (spamVerdict.spam) {
      return { status: "REJECTED_AS_SPAM", signal: spamVerdict.signal };
    }

    const submission = this.#normalize(input.data);
    if (!submission.success) {
      return { status: "INVALID", issues: submission.issues };
    }

    const idempotencyKey = buildIdempotencyKey(
      this.#options.deploymentId,
      submission.data.submissionId,
    );

    const decision = await this.#options.rateLimiter.consume(idempotencyKey);
    if (!decision.allowed) {
      return {
        status: "RATE_LIMITED",
        ...(decision.retryAfterMilliseconds === undefined
          ? {}
          : { retryAfterMilliseconds: decision.retryAfterMilliseconds }),
      };
    }

    const message = toDeliveryMessage(
      this.#options.connector,
      submission.data,
      {
        businessName: this.#options.businessName,
        ...(this.#options.replyToVisitor === undefined
          ? {}
          : { replyToVisitor: this.#options.replyToVisitor }),
      },
    );

    const result = await this.#options.adapter.deliver(this.#options.connector, {
      lead: message,
      idempotencyKey,
      correlationId: idempotencyKey,
    });

    if (result.success) {
      return {
        status: "DELIVERED",
        providerReference: result.providerReference,
        idempotencyKey,
      };
    }

    return {
      status: "DELIVERY_FAILED",
      classification: result.classification,
      code: result.code,
      ...(result.retryAfterMilliseconds === undefined
        ? {}
        : { retryAfterMilliseconds: result.retryAfterMilliseconds }),
    };
  }

  #normalize(
    input: ContactFormInput,
  ): ValidationResult<ContactFormSubmission> {
    const parsed = buildSubmissionSchema(this.#options.module).safeParse({
      submissionId: input.submissionId,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.email === undefined ? {} : { email: input.email }),
      ...(input.phone === undefined ? {} : { phone: input.phone }),
      ...(input.message === undefined ? {} : { message: input.message }),
    });

    if (!parsed.success) {
      return {
        success: false,
        issues: translateZodIssues(parsed.error.issues),
      };
    }

    const { submissionId, ...values } = parsed.data;

    return {
      success: true,
      data: normalizeSubmission(
        this.#options.module,
        submissionId,
        values as Readonly<Record<string, string>>,
      ),
    };
  }
}
