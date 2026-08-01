import type {
  ClientId,
  DeploymentId,
} from "@melbourne-local-growth-ops/contracts";

export type TechnicalEventCategory =
  | "BUILD"
  | "DEPLOYMENT"
  | "DELIVERY"
  | "RUNTIME"
  | "HANDOFF";

export type TechnicalErrorCategory =
  | "VALIDATION"
  | "PROVIDER"
  | "TIMEOUT"
  | "CONFIGURATION"
  | "UNKNOWN";

/**
 * The closed envelope intentionally has no form payload or generic metadata
 * bag. Event producers must never attach lead content, credentials, or PII.
 */
export interface ObservabilityEvent {
  readonly schemaVersion: 1;
  readonly eventName: string;
  readonly category: TechnicalEventCategory;
  readonly clientId: ClientId;
  readonly deploymentId: DeploymentId;
  readonly timestamp: string;
  readonly correlationId: string;
  readonly errorCategory?: TechnicalErrorCategory;
  readonly providerReference?: string;
}
