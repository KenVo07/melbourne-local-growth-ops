# Resend transport usage

The contact-form package owns the domain logic; the resend package owns delivery.
This document describes how a host wires the two together.

## Overview

```
host ──Resend(apiKey)──▶ ResendSdkTransport ──ResendLeadDeliveryAdapter──▶ ContactFormService
```

The host is the only component that knows a live API key. The key resolves from
the connector's `secretReferenceId` and never leaves the host boundary.

## Authenticated construction

```typescript
import { createResendTransport } from "@melbourne-local-growth-ops/resend";

const transport = createResendTransport({
  apiKey: resolvedSecret,
  timeoutMilliseconds: 10_000,
});
```

The `apiKey` is the only parameter that accepts a credential. It is passed
directly to the SDK constructor and never stored on the transport, never copied
into a message, and never included in an error.

## Injection

```typescript
import { ResendLeadDeliveryAdapter } from "@melbourne-local-growth-ops/resend";

const adapter = new ResendLeadDeliveryAdapter(transport);
```

## Wiring to ContactFormService

```typescript
import { ContactFormService } from "@melbourne-local-growth-ops/contact-form";

const service = new ContactFormService({
  module: validatedModule,
  connector: validatedConnector,
  deploymentId: "dep_001",
  businessName: "Acme Plumbing",
  adapter,
  rateLimiter,          // see the contact-form README
  spamGuard,
  replyToVisitor: true, // optional
});
```

## Timeout semantics

The SDK exposes no timeout or abort mechanism, so the transport applies its own
deadline. When the deadline expires the transport throws a `TIMEOUT`
`ResendTransportError`.

**A timeout does not cancel the underlying SDK request.** A retried submission
reuses the same idempotency key, so the provider treats the retry as the same
operation. However, the final outcome of the timed-out request may still be
unknown, which is why the transport reports a `TIMEOUT` classification rather
than `UNKNOWN`.

## Error classification

Provider errors are classified by the SDK's `name` field and the HTTP status
code, not by string parsing. The table below is authoritative.

| Kind | Classification |
|---|---|
| `rate_limit_exceeded`, `concurrent_idempotent_requests` | `RATE_LIMITED` / `RETRYABLE` |
| `daily_quota_exceeded`, `monthly_quota_exceeded` | `PROVIDER_REJECTED` / `PERMANENT` unless a reset hint is present |
| `validation_error`, `missing_required_field`, … (all 15 permanent names) | `PROVIDER_REJECTED` / `PERMANENT` |
| `application_error`, `internal_server_error` with `statusCode === null` | `NETWORK` / `RETRYABLE` |
| `application_error` / `internal_server_error` with `statusCode >= 500` | `NETWORK` / `RETRYABLE` |
| `application_error` with `statusCode === 429` | `RATE_LIMITED` / `RETRYABLE` |
| `application_error` with ambiguous `statusCode` (e.g. 400) | `UNKNOWN` / `UNKNOWN` |
| Unrecognized `name` | `UNKNOWN` / `UNKNOWN` |

## Retry metadata

When the provider returns `retry-after` or `ratelimit-reset` headers, the
transport parses them into `retryAfterMilliseconds` on the error. Values that
are non-numeric, negative, or greater than 24 hours are discarded.

## Logging note

The SDK logs errors to `console.error` when `NODE_ENV` is not `"production"`.
The logged payload contains the error name and status code, not lead content or
credentials. Hosts that enforce strict log policies should run with
`NODE_ENV=production`.

## Testing

Inject a `FakeResendClient` (no network, no key) and a
`ManualDeadlineScheduler` (deterministic clock). The rest of the stack is
unchanged. See `tests/integration/contact-form/sdk-delivery.test.ts` for
examples.

## Out of scope

- Next.js route or UI — belongs to the site-core stream.
- Webhook delivery — deferred.
- Batch send, attachments, React email templates, topics — deferred.
