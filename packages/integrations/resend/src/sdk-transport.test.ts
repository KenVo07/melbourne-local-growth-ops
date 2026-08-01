import { describe, expect, it, vi } from "vitest";

import {
  MissingResendApiKeyError,
  createResendTransportFromClient,
} from "./create-transport.js";
import {
  FakeResendClient,
  ManualDeadlineScheduler,
  providerError,
} from "./fake-sdk-client.js";
import {
  DEFAULT_TIMEOUT_MILLISECONDS,
  ResendSdkTransport,
} from "./sdk-transport.js";
import { ResendTransportError } from "./transport.js";
import type { ResendSendRequest } from "./transport.js";

const API_KEY = "re_live_NEVER_LOG_THIS_KEY";

const message = Object.freeze({
  from: "leads@acme.example",
  to: Object.freeze(["owner@acme.example"]),
  subject: "New website enquiry",
  text: "Name: Dana Smith\nEmail: dana@example.com\nMessage: Please call me.",
});

function request(
  idempotencyKey = "lead-form/dep_001/sub_abc",
): ResendSendRequest {
  return { message, idempotencyKey };
}

function buildTransport(
  client: FakeResendClient,
  scheduler?: ManualDeadlineScheduler,
) {
  return new ResendSdkTransport({
    client,
    timeoutMilliseconds: 10_000,
    ...(scheduler === undefined ? {} : { scheduler }),
  });
}

describe("successful delivery", () => {
  it("returns the provider email id", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "success", id: "resend_abc123" });

    const result = await buildTransport(client).send(request());

    expect(result).toStrictEqual({ id: "resend_abc123" });
  });

  it("forwards the idempotency key to the SDK unchanged", async () => {
    const client = new FakeResendClient();
    const key = "lead-form/dep_001/sub_forwarded";

    await buildTransport(client).send(request(key));

    expect(client.calls[0]?.options?.idempotencyKey).toBe(key);
  });

  it("maps the message onto the SDK payload", async () => {
    const client = new FakeResendClient();

    await buildTransport(client).send(request());

    expect(client.calls[0]?.payload).toStrictEqual({
      from: "leads@acme.example",
      to: ["owner@acme.example"],
      subject: "New website enquiry",
      text: message.text,
    });
  });

  it("passes reply-to through when present", async () => {
    const client = new FakeResendClient();
    const transport = buildTransport(client);

    await transport.send({
      message: { ...message, replyTo: "dana@example.com" },
      idempotencyKey: "lead-form/dep_001/sub_reply",
    });

    expect(client.calls[0]?.payload.replyTo).toBe("dana@example.com");
  });

  it("omits reply-to when absent", async () => {
    const client = new FakeResendClient();

    await buildTransport(client).send(request());

    expect(client.calls[0]?.payload).not.toHaveProperty("replyTo");
  });

  it("supports multiple recipients", async () => {
    const client = new FakeResendClient();
    const transport = buildTransport(client);

    await transport.send({
      message: { ...message, to: ["a@acme.example", "b@acme.example"] },
      idempotencyKey: "lead-form/dep_001/sub_multi",
    });

    expect(client.calls[0]?.payload.to).toStrictEqual([
      "a@acme.example",
      "b@acme.example",
    ]);
  });

  it("copies the recipient array rather than sharing the caller's", async () => {
    const client = new FakeResendClient();

    await buildTransport(client).send(request());

    expect(client.calls[0]?.payload.to).not.toBe(message.to);
  });

  it("does not mutate the caller's message", async () => {
    const client = new FakeResendClient();
    const before = JSON.stringify(message);

    await buildTransport(client).send(request());

    expect(JSON.stringify(message)).toBe(before);
  });

  it("cancels the deadline once the send resolves", async () => {
    const client = new FakeResendClient();
    const scheduler = new ManualDeadlineScheduler();

    await buildTransport(client, scheduler).send(request());

    expect(scheduler.cancelled).toBe(true);
  });
});

describe("provider failures", () => {
  it("throws a classified transport error", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "providerError",
      error: providerError("validation_error", 422),
    });

    await expect(buildTransport(client).send(request())).rejects.toMatchObject({
      name: "ResendTransportError",
      kind: "PROVIDER_REJECTED",
    });
  });

  it("carries provider retry metadata through", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "providerError",
      error: providerError("rate_limit_exceeded", 429),
      headers: { "retry-after": "15" },
    });

    await expect(buildTransport(client).send(request())).rejects.toMatchObject({
      kind: "RATE_LIMITED",
      retryAfterMilliseconds: 15_000,
    });
  });

  it("treats an SDK throw as a retryable network fault", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "throws", cause: new Error("socket hang up") });

    await expect(buildTransport(client).send(request())).rejects.toMatchObject({
      kind: "NETWORK",
    });
  });

  it("does not leak an SDK throw message", async () => {
    const client = new FakeResendClient();
    client.setOutcome({
      kind: "throws",
      cause: new Error(`request failed with ${API_KEY}`),
    });

    await expect(buildTransport(client).send(request())).rejects.not.toThrow(
      API_KEY,
    );
  });

  it("reports an empty response as unknown rather than success", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "emptyResponse" });

    await expect(buildTransport(client).send(request())).rejects.toMatchObject({
      kind: "UNKNOWN",
    });
  });
});

describe("deadline handling", () => {
  it("classifies an expired deadline as a timeout", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "never" });
    const scheduler = new ManualDeadlineScheduler();
    const transport = buildTransport(client, scheduler);

    const pending = transport.send(request());
    scheduler.expire();

    await expect(pending).rejects.toMatchObject({
      name: "ResendTransportError",
      kind: "TIMEOUT",
    });
    client.settlePendingWithFailure();
  });

  it("schedules the configured deadline", async () => {
    const client = new FakeResendClient();
    const scheduler = new ManualDeadlineScheduler();

    await new ResendSdkTransport({
      client,
      timeoutMilliseconds: 2_500,
      scheduler,
    }).send(request());

    expect(scheduler.scheduledMilliseconds).toBe(2_500);
  });

  it("defaults to a bounded deadline", async () => {
    const client = new FakeResendClient();
    const scheduler = new ManualDeadlineScheduler();

    await new ResendSdkTransport({ client, scheduler }).send(request());

    expect(scheduler.scheduledMilliseconds).toBe(DEFAULT_TIMEOUT_MILLISECONDS);
  });

  it("does not raise an unhandled rejection when the abandoned send later fails", async () => {
    const unhandled = vi.fn();
    const bus = globalThis as unknown as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
      process?: {
        on(event: string, listener: (reason: unknown) => void): void;
        off(event: string, listener: (reason: unknown) => void): void;
      };
    };
    bus.process?.on("unhandledRejection", unhandled);

    try {
      const client = new FakeResendClient();
      client.setOutcome({ kind: "never" });
      const scheduler = new ManualDeadlineScheduler();
      const transport = buildTransport(client, scheduler);

      const pending = transport.send(request());
      scheduler.expire();
      await expect(pending).rejects.toMatchObject({ kind: "TIMEOUT" });

      // The provider call the transport walked away from now fails.
      client.settlePendingWithFailure(new Error("late provider failure"));

      // Drain microtasks so the abandoned promise has a chance to reject.
      const qm = (globalThis as unknown as { queueMicrotask?: (cb: () => void) => void })
        .queueMicrotask;
      if (qm) {
        await new Promise<void>((r) => qm(r));
        await new Promise<void>((r) => qm(r));
      }

      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      bus.process?.off("unhandledRejection", unhandled);
    }
  });

  it("reuses the same idempotency key when a timed-out send is retried", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "never" });
    const scheduler = new ManualDeadlineScheduler();
    const transport = buildTransport(client, scheduler);
    const key = "lead-form/dep_001/sub_timeout_retry";

    const first = transport.send(request(key));
    scheduler.expire();
    await expect(first).rejects.toMatchObject({ kind: "TIMEOUT" });
    client.settlePendingWithFailure();

    client.setOutcome({ kind: "success", id: "resend_after_timeout" });
    const second = await transport.send(request(key));

    expect(second).toStrictEqual({ id: "resend_after_timeout" });
    expect(client.calls.map((call) => call.options?.idempotencyKey)).toStrictEqual([
      key,
      key,
    ]);
  });

  it("rejects a nonsensical timeout", () => {
    expect(
      () =>
        new ResendSdkTransport({
          client: new FakeResendClient(),
          timeoutMilliseconds: 0,
        }),
    ).toThrow(RangeError);
  });
});

describe("authenticated construction boundary", () => {
  it("builds a transport from a host-supplied client", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "success", id: "resend_from_client" });

    const transport = createResendTransportFromClient({ client });

    expect(await transport.send(request())).toStrictEqual({
      id: "resend_from_client",
    });
  });

  it("refuses to construct without a key", async () => {
    const { createResendTransport } = await import("./create-transport.js");

    expect(() => createResendTransport({ apiKey: "   " })).toThrow(
      MissingResendApiKeyError,
    );
  });

  it("does not echo the key when refusing", async () => {
    const { createResendTransport } = await import("./create-transport.js");

    try {
      createResendTransport({ apiKey: "" });
      expect.unreachable("construction should fail");
    } catch (cause) {
      expect(String(cause)).not.toContain(API_KEY);
    }
  });

  it("keeps the key out of the transport surface", async () => {
    const { createResendTransport } = await import("./create-transport.js");

    const transport = createResendTransport({ apiKey: API_KEY });

    expect(JSON.stringify(transport)).not.toContain(API_KEY);
    expect(Object.keys(transport)).toStrictEqual([]);
  });
});

describe("credential and lead content redaction", () => {
  it("keeps the key and lead content out of every failure error", async () => {
    const outcomes = [
      { kind: "providerError" as const, error: providerError("validation_error", 422, `bad address dana@example.com key ${API_KEY}`) },
      { kind: "throws" as const, cause: new Error(`boom ${API_KEY} Dana Smith`) },
      { kind: "emptyResponse" as const },
    ];

    for (const outcome of outcomes) {
      const client = new FakeResendClient();
      client.setOutcome(outcome);

      let raised: unknown;
      try {
        await buildTransport(client).send(request());
      } catch (cause) {
        raised = cause;
      }

      expect(raised).toBeInstanceOf(ResendTransportError);
      const serialized = `${String(raised)} ${JSON.stringify(raised)} ${(raised as Error).stack ?? ""}`;
      expect(serialized).not.toContain(API_KEY);
      expect(serialized).not.toContain("Dana Smith");
      expect(serialized).not.toContain("dana@example.com");
    }
  });

  it("keeps lead content out of a timeout error", async () => {
    const client = new FakeResendClient();
    client.setOutcome({ kind: "never" });
    const scheduler = new ManualDeadlineScheduler();
    const transport = buildTransport(client, scheduler);

    const pending = transport.send(request());
    scheduler.expire();

    let raised: unknown;
    try {
      await pending;
    } catch (cause) {
      raised = cause;
    }
    client.settlePendingWithFailure();

    expect(String(raised)).not.toContain("Dana Smith");
    expect(String(raised)).not.toContain("dana@example.com");
  });
});
