import {
  ContactFormService,
  InMemoryRateLimiter,
  SpamGuard,
  type ContactFormOutcome,
  type LeadFormModule,
} from "@melbourne-local-growth-ops/contact-form";
import {
  ResendLeadDeliveryAdapter,
  type EmailDeliveryConnector,
  type ResendTransport,
} from "@melbourne-local-growth-ops/resend";

const MAXIMUM_REQUEST_BYTES = 16_384;

export interface ContactSubmissionServiceOptions {
  readonly module: LeadFormModule;
  readonly connector: EmailDeliveryConnector;
  readonly deploymentId: string;
  readonly businessName: string;
  readonly transport: ResendTransport;
  readonly now?: () => number;
}

export interface ManagedContactRuntime {
  submit(
    moduleId: string,
    input: unknown,
  ): Promise<ContactFormOutcome | undefined>;
}

export function createContactSubmissionService(
  options: ContactSubmissionServiceOptions,
): (input: unknown) => Promise<ContactFormOutcome> {
  const now = options.now ?? Date.now;
  const clock = Object.freeze({ now });
  const service = new ContactFormService({
    module: options.module,
    connector: options.connector,
    deploymentId: options.deploymentId,
    businessName: options.businessName,
    adapter: new ResendLeadDeliveryAdapter(options.transport),
    rateLimiter: new InMemoryRateLimiter({
      limit: 5,
      windowMilliseconds: 60_000,
      clock,
    }),
    spamGuard: new SpamGuard({
      minimumFillMilliseconds: 750,
      clock,
    }),
    replyToVisitor: true,
  });

  return (input: unknown) => service.submit(input);
}

export async function handleContactFormRequest(
  request: Request,
  runtime: ManagedContactRuntime,
): Promise<Response> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return safeJson(415, "INVALID_REQUEST");
  }

  let text: string;
  try {
    text = await request.text();
  } catch {
    return safeJson(400, "INVALID_REQUEST");
  }
  if (Buffer.byteLength(text, "utf8") > MAXIMUM_REQUEST_BYTES) {
    return safeJson(413, "REQUEST_TOO_LARGE");
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return safeJson(400, "INVALID_REQUEST");
  }
  if (
    !isRecord(body) ||
    typeof body.moduleId !== "string" ||
    !("submission" in body)
  ) {
    return safeJson(400, "INVALID_REQUEST");
  }

  let outcome: ContactFormOutcome | undefined;
  try {
    outcome = await runtime.submit(body.moduleId, body.submission);
  } catch {
    return safeJson(503, "SERVICE_UNAVAILABLE");
  }
  if (outcome === undefined) {
    return safeJson(404, "FORM_NOT_FOUND");
  }

  switch (outcome.status) {
    case "DELIVERED":
      return Response.json({ ok: true }, { status: 200 });
    case "INVALID":
    case "REJECTED_AS_SPAM":
      return safeJson(400, "SUBMISSION_REJECTED");
    case "RATE_LIMITED":
      return safeJson(429, "TRY_AGAIN_LATER", outcome.retryAfterMilliseconds);
    case "DELIVERY_FAILED":
      return safeJson(
        outcome.code === "RATE_LIMITED" ? 429 : 503,
        outcome.code === "RATE_LIMITED"
          ? "TRY_AGAIN_LATER"
          : "SERVICE_UNAVAILABLE",
        outcome.retryAfterMilliseconds,
      );
  }
}

function safeJson(
  status: number,
  code:
    | "FORM_NOT_FOUND"
    | "INVALID_REQUEST"
    | "REQUEST_TOO_LARGE"
    | "SERVICE_UNAVAILABLE"
    | "SUBMISSION_REJECTED"
    | "TRY_AGAIN_LATER",
  retryAfterMilliseconds?: number,
): Response {
  const headers =
    retryAfterMilliseconds === undefined
      ? undefined
      : {
          "retry-after": String(
            Math.max(1, Math.ceil(retryAfterMilliseconds / 1_000)),
          ),
        };
  return Response.json(
    { ok: false, code },
    { status, ...(headers === undefined ? {} : { headers }) },
  );
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
