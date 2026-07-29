import { describe, expect, it } from "vitest";

import {
  parseRetryAfterMilliseconds,
  toTransportError,
} from "./error-mapping.js";
import { providerError } from "./fake-sdk-client.js";
import type { ResendTransportErrorKind } from "./transport.js";

function kindOf(
  name: string,
  statusCode: number | null,
  headers: Readonly<Record<string, string>> | null = {},
): ResendTransportErrorKind {
  return toTransportError(providerError(name, statusCode), headers).kind;
}

describe("permanent provider rejections", () => {
  const permanent: ReadonlyArray<[string, number | null]> = [
    ["validation_error", 422],
    ["missing_required_field", 422],
    ["invalid_parameter", 422],
    ["invalid_attachment", 422],
    ["invalid_from_address", 403],
    ["invalid_region", 400],
    ["not_found", 404],
    ["method_not_allowed", 405],
    ["security_error", 451],
    ["invalid_access", 403],
    ["missing_api_key", 401],
    ["restricted_api_key", 401],
    ["invalid_api_key", 401],
    ["invalid_idempotency_key", 400],
    ["invalid_idempotent_request", 400],
  ];

  it.each(permanent)("classifies %s as a permanent rejection", (name, status) => {
    expect(kindOf(name, status)).toBe("PROVIDER_REJECTED");
  });
});

describe("rate limiting", () => {
  it("classifies rate_limit_exceeded as retryable", () => {
    expect(kindOf("rate_limit_exceeded", 429)).toBe("RATE_LIMITED");
  });

  it("classifies concurrent_idempotent_requests as retryable", () => {
    expect(kindOf("concurrent_idempotent_requests", 409)).toBe("RATE_LIMITED");
  });

  it("preserves the provider retry hint", () => {
    const error = toTransportError(
      providerError("rate_limit_exceeded", 429),
      { "retry-after": "30" },
    );

    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.retryAfterMilliseconds).toBe(30_000);
  });
});

describe("quota exhaustion is not an ordinary rate limit", () => {
  const quotas = ["daily_quota_exceeded", "monthly_quota_exceeded"] as const;

  it.each(quotas)(
    "classifies %s without a reset hint as needing intervention",
    (name) => {
      // No hint means no safe moment to retry, so it must not drive a retry
      // loop against a quota only an operator can clear.
      expect(kindOf(name, 429)).toBe("PROVIDER_REJECTED");
    },
  );

  it.each(quotas)("classifies %s as retryable when a reset hint exists", (name) => {
    const error = toTransportError(providerError(name, 429), {
      "ratelimit-reset": "600",
    });

    expect(error.kind).toBe("RATE_LIMITED");
    expect(error.retryAfterMilliseconds).toBe(600_000);
  });

  it("ignores an unusable quota hint and still avoids a retry loop", () => {
    expect(
      kindOf("daily_quota_exceeded", 429, { "retry-after": "not-a-number" }),
    ).toBe("PROVIDER_REJECTED");
  });
});

describe("server faults and network failures", () => {
  it("treats application_error with no status as a network failure", () => {
    expect(kindOf("application_error", null, null)).toBe("NETWORK");
  });

  it("treats internal_server_error as retryable", () => {
    expect(kindOf("internal_server_error", 500)).toBe("NETWORK");
  });

  it("treats a 503 catch-all as retryable", () => {
    expect(kindOf("application_error", 503)).toBe("NETWORK");
  });

  it("treats a 429 catch-all as rate limiting", () => {
    expect(kindOf("application_error", 429)).toBe("RATE_LIMITED");
  });

  it("degrades an ambiguous 4xx catch-all to unknown", () => {
    // A 4xx with the catch-all name tells us neither that a retry is safe nor
    // that it is pointless.
    expect(kindOf("application_error", 400)).toBe("UNKNOWN");
  });
});

describe("unrecognized error names", () => {
  it("degrades an unknown name to UNKNOWN", () => {
    expect(kindOf("some_future_error_code", 418)).toBe("UNKNOWN");
  });

  it("still uses status 429 for an unknown name", () => {
    expect(kindOf("some_future_error_code", 429)).toBe("RATE_LIMITED");
  });

  it("still uses a 5xx status for an unknown name", () => {
    expect(kindOf("some_future_error_code", 502)).toBe("NETWORK");
  });

  it("degrades an unknown name with no status to UNKNOWN", () => {
    expect(kindOf("some_future_error_code", null)).toBe("UNKNOWN");
  });
});

describe("parseRetryAfterMilliseconds", () => {
  it("returns undefined when headers are absent", () => {
    expect(parseRetryAfterMilliseconds(null)).toBeUndefined();
  });

  it("returns undefined when no retry header is present", () => {
    expect(parseRetryAfterMilliseconds({ "content-type": "application/json" }))
      .toBeUndefined();
  });

  it("reads retry-after seconds", () => {
    expect(parseRetryAfterMilliseconds({ "retry-after": "12" })).toBe(12_000);
  });

  it("is case insensitive", () => {
    expect(parseRetryAfterMilliseconds({ "Retry-After": "5" })).toBe(5_000);
  });

  it("reads the ratelimit-reset family", () => {
    expect(parseRetryAfterMilliseconds({ "x-ratelimit-reset-after": "2" })).toBe(
      2_000,
    );
  });

  it("prefers retry-after over a reset header", () => {
    expect(
      parseRetryAfterMilliseconds({
        "retry-after": "7",
        "ratelimit-reset": "99",
      }),
    ).toBe(7_000);
  });

  it("rejects a non-numeric value", () => {
    expect(parseRetryAfterMilliseconds({ "retry-after": "soon" })).toBeUndefined();
  });

  it("rejects a negative value", () => {
    expect(parseRetryAfterMilliseconds({ "retry-after": "-5" })).toBeUndefined();
  });

  it("rejects an implausibly large value", () => {
    expect(
      parseRetryAfterMilliseconds({ "retry-after": "999999" }),
    ).toBeUndefined();
  });

  it("accepts zero", () => {
    expect(parseRetryAfterMilliseconds({ "retry-after": "0" })).toBe(0);
  });
});

describe("transport error content", () => {
  it("drops the provider message text", () => {
    const error = toTransportError(
      providerError(
        "validation_error",
        422,
        "to address dana@example.com rejected using key re_live_LEAK",
      ),
      {},
    );

    expect(error.message).not.toContain("dana@example.com");
    expect(error.message).not.toContain("re_live_LEAK");
  });

  it("keeps the error name and status for diagnosis", () => {
    const error = toTransportError(providerError("validation_error", 422), {});

    expect(error.message).toContain("validation_error");
    expect(error.message).toContain("422");
  });

  it("describes a missing status without inventing one", () => {
    const error = toTransportError(providerError("application_error", null), null);

    expect(error.message).toContain("no status");
  });
});
