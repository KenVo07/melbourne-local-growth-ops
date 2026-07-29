import { describe, expect, it } from "vitest";

import {
  BUSINESS_NAME,
  DEPLOYMENT_ID,
  HOST_RESOLVED_API_KEY,
  LEAD_CONTENT,
  emailConnectorInput,
} from "./fixtures.js";

/**
 * Smoke tests against the *compiled* package rather than `src`.
 *
 * The rest of the suite runs through vitest aliases that resolve to TypeScript
 * sources, which would not catch a broken build: a missing export, an
 * unresolvable ESM specifier, or a declaration that never emitted. These tests
 * import the built `dist/index.js` by file URL to exercise what a host actually
 * consumes.
 *
 * `pnpm check` runs build before test, so `dist` is present. If it is missing
 * the failure below says so explicitly instead of silently skipping.
 */
/**
 * `URL` and `import.meta.url` are reached through narrow local declarations so
 * these tests need neither the DOM lib nor a Node type dependency.
 */
interface UrlGlobals {
  URL: new (url: string, base?: string) => { readonly href: string };
}
const { URL: Url } = globalThis as unknown as UrlGlobals;
const moduleUrl = (import.meta as unknown as { readonly url: string }).url;

function distUrl(relative: string): string {
  return new Url(relative, moduleUrl).href;
}

const COMPILED_ENTRY = distUrl(
  "../../../packages/integrations/resend/dist/index.js",
);

/**
 * The specifier is a variable, so TypeScript does not resolve it and the
 * typecheck stays independent of whether `dist` currently exists.
 */
async function loadCompiled(): Promise<Record<string, unknown>> {
  try {
    return (await import(COMPILED_ENTRY)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `Could not import the compiled resend package. Run the package build first. Cause: ${String(cause)}`,
    );
  }
}

describe("compiled resend package", () => {
  it("exposes the production entry points a host needs", async () => {
    const compiled = await loadCompiled();

    for (const name of [
      "ResendLeadDeliveryAdapter",
      "ResendSdkTransport",
      "ResendTransportError",
      "createResendTransport",
      "createResendTransportFromClient",
      "MissingResendApiKeyError",
      "TimerDeadlineScheduler",
      "toTransportError",
      "parseRetryAfterMilliseconds",
      "DEFAULT_TIMEOUT_MILLISECONDS",
    ]) {
      expect(compiled[name], `missing export: ${name}`).toBeDefined();
    }
  });

  it("still ships the deterministic test doubles", async () => {
    const compiled = await loadCompiled();

    for (const name of [
      "MockResendTransport",
      "FakeResendClient",
      "ManualDeadlineScheduler",
      "providerError",
    ]) {
      expect(compiled[name], `missing export: ${name}`).toBeDefined();
    }
  });

  it("delivers end to end through the compiled adapter and transport", async () => {
    const compiled = await loadCompiled();

    const FakeResendClient = compiled["FakeResendClient"] as new () => {
      setOutcome(outcome: unknown): void;
      calls: readonly { options?: { idempotencyKey?: string } }[];
    };
    const createResendTransportFromClient = compiled[
      "createResendTransportFromClient"
    ] as (options: { client: unknown }) => unknown;
    const ResendLeadDeliveryAdapter = compiled[
      "ResendLeadDeliveryAdapter"
    ] as new (transport: unknown) => {
      validateConfiguration(input: unknown): { success: boolean; data?: unknown };
      deliver(
        configuration: unknown,
        request: unknown,
      ): Promise<Record<string, unknown>>;
    };

    const client = new FakeResendClient();
    client.setOutcome({ kind: "success", id: "resend_compiled" });
    const adapter = new ResendLeadDeliveryAdapter(
      createResendTransportFromClient({ client }),
    );

    const validated = adapter.validateConfiguration(emailConnectorInput);
    expect(validated.success).toBe(true);

    const idempotencyKey = `lead-form/${DEPLOYMENT_ID}/sub_compiled`;
    const result = await adapter.deliver(validated.data, {
      lead: {
        from: "leads@acme.example",
        to: ["owner@acme.example"],
        subject: `New website enquiry — ${BUSINESS_NAME}`,
        text: `Message: ${LEAD_CONTENT.message}`,
      },
      idempotencyKey,
      correlationId: idempotencyKey,
    });

    expect(result).toStrictEqual({
      success: true,
      providerReference: "resend_compiled",
      duplicate: false,
    });
    expect(client.calls[0]?.options?.idempotencyKey).toBe(idempotencyKey);
  });

  it("classifies a provider failure through the compiled mapping", async () => {
    const compiled = await loadCompiled();

    const toTransportError = compiled["toTransportError"] as (
      error: { name: string; statusCode: number | null; message: string },
      headers: Record<string, string> | null,
    ) => { kind: string; retryAfterMilliseconds?: number };

    expect(
      toTransportError(
        { name: "rate_limit_exceeded", statusCode: 429, message: "slow down" },
        { "retry-after": "8" },
      ),
    ).toMatchObject({ kind: "RATE_LIMITED", retryAfterMilliseconds: 8_000 });

    expect(
      toTransportError(
        { name: "daily_quota_exceeded", statusCode: 429, message: "quota" },
        {},
      ),
    ).toMatchObject({ kind: "PROVIDER_REJECTED" });
  });

  it("refuses compiled construction without a key and does not echo it", async () => {
    const compiled = await loadCompiled();

    const createResendTransport = compiled["createResendTransport"] as (
      options: { apiKey: string },
    ) => unknown;

    expect(() => createResendTransport({ apiKey: "  " })).toThrow(
      /Resend API key is required/,
    );

    const transport = createResendTransport({ apiKey: HOST_RESOLVED_API_KEY });
    expect(JSON.stringify(transport)).not.toContain(HOST_RESOLVED_API_KEY);
  });

  it("resolves as real ESM with named bindings", async () => {
    // A default-only or CommonJS-interop shape would still satisfy property
    // lookups, so assert the named binding is callable as a constructor.
    const compiled = await loadCompiled();
    const Transport = compiled["ResendSdkTransport"];

    expect(typeof Transport).toBe("function");
    expect(typeof compiled["createResendTransport"]).toBe("function");
    expect(compiled["DEFAULT_TIMEOUT_MILLISECONDS"]).toBeTypeOf("number");
  });
});
