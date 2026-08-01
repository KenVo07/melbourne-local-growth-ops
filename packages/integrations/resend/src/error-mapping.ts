import { ResendTransportError } from "./transport.js";
import type { ResendTransportErrorKind } from "./transport.js";

/**
 * The provider error shape returned by the SDK. Declared structurally so this
 * module does not depend on the SDK's exported type surface.
 */
export interface ProviderErrorLike {
  readonly name: string;
  readonly statusCode: number | null;
  readonly message: string;
}

/** Response headers as the SDK surfaces them: a plain map, or null. */
export type ProviderHeaders = Readonly<Record<string, string>> | null;

/**
 * Error names that always mean the request was refused on its merits. Retrying
 * the identical request cannot succeed, so these are permanent.
 */
const PERMANENT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "validation_error",
  "missing_required_field",
  "invalid_parameter",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_region",
  "not_found",
  "method_not_allowed",
  "security_error",
  "invalid_access",
  "missing_api_key",
  "restricted_api_key",
  "invalid_api_key",
  "invalid_idempotency_key",
  "invalid_idempotent_request",
]);

/** Error names that mean "slow down"; a later identical retry can succeed. */
const RATE_LIMIT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "rate_limit_exceeded",
  "concurrent_idempotent_requests",
]);

/**
 * Quota exhaustion. Unlike ordinary rate limiting this usually needs a plan
 * change or a new billing period, so it must not feed an automatic retry loop
 * unless the provider actually told us when to come back.
 */
const QUOTA_ERROR_NAMES: ReadonlySet<string> = new Set([
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
]);

/**
 * Server-side faults that are worth retrying. `application_error` is the SDK's
 * catch-all: it is also what a failed fetch becomes, distinguished by
 * `statusCode`.
 */
const SERVER_FAULT_ERROR_NAMES: ReadonlySet<string> = new Set([
  "internal_server_error",
  "application_error",
]);

/** Upper bound on accepted retry hints, so a bad header cannot stall a host. */
const MAX_RETRY_AFTER_MILLISECONDS = 24 * 60 * 60 * 1000;

/**
 * Parse a provider retry hint into milliseconds.
 *
 * Accepts `retry-after` (delta seconds, per RFC 9110) and the `ratelimit-reset`
 * family. Anything non-finite, negative, or implausibly large is discarded
 * rather than trusted, because a wrong hint is worse than no hint.
 */
export function parseRetryAfterMilliseconds(
  headers: ProviderHeaders,
): number | undefined {
  if (headers === null) {
    return undefined;
  }

  const lookup = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    lookup.set(key.toLowerCase(), value);
  }

  const candidates = [
    "retry-after",
    "ratelimit-reset",
    "x-ratelimit-reset",
    "x-ratelimit-reset-after",
  ];

  for (const header of candidates) {
    const raw = lookup.get(header);
    if (raw === undefined) {
      continue;
    }

    const seconds = Number(raw.trim());
    if (!Number.isFinite(seconds) || seconds < 0) {
      continue;
    }

    const milliseconds = Math.round(seconds * 1000);
    if (milliseconds > MAX_RETRY_AFTER_MILLISECONDS) {
      continue;
    }

    return milliseconds;
  }

  return undefined;
}

function kindForProviderError(
  error: ProviderErrorLike,
  retryAfterMilliseconds: number | undefined,
): ResendTransportErrorKind {
  if (RATE_LIMIT_ERROR_NAMES.has(error.name)) {
    return "RATE_LIMITED";
  }

  if (QUOTA_ERROR_NAMES.has(error.name)) {
    // Only treat quota exhaustion as retryable when the provider supplied a
    // concrete reset hint. Without one, a retry loop would hammer a quota that
    // only an operator or a new billing period can clear, so report it as a
    // refusal that needs external intervention.
    return retryAfterMilliseconds === undefined ? "PROVIDER_REJECTED" : "RATE_LIMITED";
  }

  if (PERMANENT_ERROR_NAMES.has(error.name)) {
    return "PROVIDER_REJECTED";
  }

  if (SERVER_FAULT_ERROR_NAMES.has(error.name)) {
    // A null statusCode means the SDK never got an HTTP response, so the
    // request failed at the network layer and is worth retrying.
    if (error.statusCode === null) {
      return "NETWORK";
    }
    if (error.statusCode === 429) {
      return "RATE_LIMITED";
    }
    if (error.statusCode >= 500) {
      return "NETWORK";
    }
    // A 4xx carrying the catch-all name is ambiguous; degrade safely instead
    // of guessing that a retry is either safe or pointless.
    return "UNKNOWN";
  }

  if (error.statusCode === 429) {
    return "RATE_LIMITED";
  }
  if (error.statusCode !== null && error.statusCode >= 500) {
    return "NETWORK";
  }

  // An unrecognized name (for example one added by a future SDK release)
  // degrades to UNKNOWN rather than being forced into a retry decision.
  return "UNKNOWN";
}

/**
 * Translate a provider error into the package-local transport error.
 *
 * The resulting message contains only the provider's error name and status
 * code. The provider's own message text is deliberately dropped: it can echo
 * submitted values or credential fragments, and the adapter never needs it.
 */
export function toTransportError(
  error: ProviderErrorLike,
  headers: ProviderHeaders,
): ResendTransportError {
  const retryAfterMilliseconds = parseRetryAfterMilliseconds(headers);
  const kind = kindForProviderError(error, retryAfterMilliseconds);

  const status = error.statusCode === null ? "no status" : `status ${error.statusCode}`;
  const safeMessage = `Resend request failed (${error.name}, ${status})`;

  return retryAfterMilliseconds === undefined
    ? new ResendTransportError(kind, safeMessage)
    : new ResendTransportError(kind, safeMessage, retryAfterMilliseconds);
}
