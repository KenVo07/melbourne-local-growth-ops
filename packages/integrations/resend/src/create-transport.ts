import { Resend } from "resend";

import { ResendSdkTransport } from "./sdk-transport.js";
import type { ResendSdkTransportOptions } from "./sdk-transport.js";
import type { DeadlineScheduler, ResendEmailClient } from "./sdk-client.js";
import type { ResendTransport } from "./transport.js";

export interface CreateResendTransportOptions {
  /**
   * The API key the host resolved from the connector's `secretReferenceId`.
   *
   * This is the only place in the package where a raw credential is accepted.
   * It is handed straight to the SDK client and never stored on the transport,
   * copied into a message, or included in an error.
   */
  readonly apiKey: string;
  readonly timeoutMilliseconds?: number;
  readonly scheduler?: DeadlineScheduler;
  /** Override the API base URL, for a sandbox or a local contract test. */
  readonly baseUrl?: string;
}

export class MissingResendApiKeyError extends Error {
  constructor() {
    // Deliberately says nothing about the value that was supplied.
    super("A Resend API key is required to construct an authenticated transport");
    this.name = "MissingResendApiKeyError";
  }
}

/**
 * The authenticated transport construction boundary.
 *
 * The host resolves the secret reference, calls this once, and injects the
 * result into `ResendLeadDeliveryAdapter`. Everything downstream of here is
 * credential-free: the adapter, the message mapper, and the contact-form
 * service never receive the key.
 */
export function createResendTransport(
  options: CreateResendTransportOptions,
): ResendTransport {
  if (options.apiKey.trim() === "") {
    throw new MissingResendApiKeyError();
  }

  const client = new Resend(
    options.apiKey,
    options.baseUrl === undefined ? undefined : { baseUrl: options.baseUrl },
  ) as unknown as ResendEmailClient;

  return createResendTransportFromClient({
    client,
    ...(options.timeoutMilliseconds === undefined
      ? {}
      : { timeoutMilliseconds: options.timeoutMilliseconds }),
    ...(options.scheduler === undefined ? {} : { scheduler: options.scheduler }),
  });
}

/**
 * Build a transport from an already-constructed client.
 *
 * Useful when a host manages the SDK instance itself, and the seam tests use to
 * inject a deterministic fake without a network or a credential.
 */
export function createResendTransportFromClient(
  options: ResendSdkTransportOptions,
): ResendTransport {
  return new ResendSdkTransport(options);
}
