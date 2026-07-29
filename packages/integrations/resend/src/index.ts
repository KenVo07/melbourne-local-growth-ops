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
