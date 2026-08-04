/**
 * Route-boundary abuse mitigation for contact submission endpoints.
 *
 * These guards run BEFORE provider invocation and are designed for early
 * rejection of cross-site browser abuse. They do not constitute distributed
 * rate limiting or global bot prevention.
 *
 * Production deployments must evidence an active host-enforced path limiter
 * (e.g., Vercel WAF rate limiting with documented threshold, cost, and
 * ownership) before contact capability activation.
 */

export interface ContactGuardDecision {
  readonly allowed: boolean;
  readonly reason?: "CROSS_SITE_REQUEST";
}

/**
 * Same-origin guard that rejects requests with explicitly mismatched Origin/Referer.
 *
 * Derives the expected origin from the request URL itself using URL.origin
 * (scheme + host + effective port). Allows requests with absent Origin and
 * Referer headers for M1 compatibility and non-browser clients. This is a
 * browser-oriented cross-site mitigation, not caller authentication. Absent
 * headers and spoofed headers remain possible.
 */
export class SameOriginGuard {
  check(request: Request): ContactGuardDecision {
    const requestUrl = new URL(request.url);
    const expectedOrigin = requestUrl.origin;

    const origin = request.headers.get("origin");
    const referer = request.headers.get("referer");

    if (origin !== null) {
      try {
        const originUrl = new URL(origin);
        if (originUrl.origin !== expectedOrigin) {
          return { allowed: false, reason: "CROSS_SITE_REQUEST" };
        }
      } catch {
        return { allowed: false, reason: "CROSS_SITE_REQUEST" };
      }
    }

    if (referer !== null) {
      try {
        const refererUrl = new URL(referer);
        if (refererUrl.origin !== expectedOrigin) {
          return { allowed: false, reason: "CROSS_SITE_REQUEST" };
        }
      } catch {
        return { allowed: false, reason: "CROSS_SITE_REQUEST" };
      }
    }

    return { allowed: true };
  }
}
