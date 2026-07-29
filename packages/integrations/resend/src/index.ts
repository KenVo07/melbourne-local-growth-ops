export { ResendTransportError } from "./transport.js";
export type {
  ResendSendRequest,
  ResendSendResult,
  ResendTransport,
  ResendTransportErrorKind,
} from "./transport.js";

export type { ResendDeliveryMessage } from "./message.js";

export {
  ResendLeadDeliveryAdapter,
  classifyTransportFailure,
} from "./adapter.js";
export type { EmailDeliveryConnector } from "./adapter.js";

export {
  MockResendTransport,
  mockNetworkError,
  mockProviderRejectedError,
  mockRateLimitedError,
  mockTimeoutError,
  mockUnknownError,
} from "./mock-transport.js";
export type { ResendSendOutcome } from "./mock-transport.js";

export { parseRetryAfterMilliseconds, toTransportError } from "./error-mapping.js";
export type { ProviderErrorLike, ProviderHeaders } from "./error-mapping.js";

export { TimerDeadlineScheduler } from "./sdk-client.js";
export type {
  DeadlineScheduler,
  ResendEmailClient,
  ResendEmailPayload,
  ResendEmailResponse,
  ResendSendOptions,
} from "./sdk-client.js";

export {
  DEFAULT_TIMEOUT_MILLISECONDS,
  ResendSdkTransport,
} from "./sdk-transport.js";
export type { ResendSdkTransportOptions } from "./sdk-transport.js";

export {
  MissingResendApiKeyError,
  createResendTransport,
  createResendTransportFromClient,
} from "./create-transport.js";
export type { CreateResendTransportOptions } from "./create-transport.js";

export {
  FakeResendClient,
  ManualDeadlineScheduler,
  providerError,
} from "./fake-sdk-client.js";
export type { FakeSdkCall, FakeSdkOutcome } from "./fake-sdk-client.js";
