export { ContactFormInputSchema, buildSubmissionSchema, declaredInputKeys } from "./input-schema.js";
export type { ContactFormInput, LeadFormField, LeadFormModule } from "./input-schema.js";

export { fieldLabel, normalizeSubmission, submissionValue } from "./submission.js";
export type { ContactFormFieldValue, ContactFormSubmission } from "./submission.js";

export {
  IDEMPOTENCY_KEY_PREFIX,
  InvalidIdempotencySegmentError,
  buildIdempotencyKey,
} from "./idempotency.js";

export { SpamGuard } from "./spam.js";
export type {
  SpamCheckInput,
  SpamGuardOptions,
  SpamSignal,
  SpamVerdict,
} from "./spam.js";

export { InMemoryRateLimiter, NoopRateLimiter } from "./rate-limit.js";
export type {
  Clock,
  InMemoryRateLimiterOptions,
  RateLimitDecision,
  RateLimiter,
} from "./rate-limit.js";

export { toDeliveryMessage } from "./message-mapper.js";
export type { MessageMapOptions } from "./message-mapper.js";

export { ContactFormService } from "./service.js";
export type { ContactFormOutcome, ContactFormServiceOptions } from "./service.js";
