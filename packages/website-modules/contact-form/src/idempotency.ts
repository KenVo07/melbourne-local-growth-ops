/**
 * Deterministic idempotency key construction.
 *
 * The key is built only from non-sensitive identifiers: the deployment that
 * received the submission and the caller-supplied opaque submission id. Lead
 * content is never hashed into or encoded in the key, so the key can be logged
 * and forwarded safely.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9_.:-]+$/;

export const IDEMPOTENCY_KEY_PREFIX = "lead-form";

export class InvalidIdempotencySegmentError extends Error {
  constructor(segmentName: string) {
    super(`Idempotency segment ${segmentName} contains unsupported characters`);
    this.name = "InvalidIdempotencySegmentError";
  }
}

/**
 * Format `lead-form/<deploymentId>/<submissionId>`.
 *
 * Both segments must already be opaque identifiers. Any value that could
 * change the key's shape is rejected rather than escaped, because a silently
 * rewritten key would break duplicate protection.
 */
export function buildIdempotencyKey(
  deploymentId: string,
  submissionId: string,
): string {
  if (!SAFE_SEGMENT.test(deploymentId)) {
    throw new InvalidIdempotencySegmentError("deploymentId");
  }
  if (!SAFE_SEGMENT.test(submissionId)) {
    throw new InvalidIdempotencySegmentError("submissionId");
  }

  return `${IDEMPOTENCY_KEY_PREFIX}/${deploymentId}/${submissionId}`;
}
