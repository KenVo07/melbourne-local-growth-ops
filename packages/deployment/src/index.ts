import type {
  AccountOwner,
  ClientId,
  DeliveryMode,
  DeploymentId,
  DomainConfiguration,
  Handoff,
  InfrastructureKind,
  WebsiteConfigurationId,
} from "@melbourne-local-growth-ops/contracts";

export { createDeploymentIntent } from "./deployment-intent.js";
export type {
  DeploymentIntent,
  DeploymentIntentInfrastructureOwnership,
  DeploymentIntentOwnership,
  RequestedDeploymentProvenance,
} from "./deployment-intent.js";
export {
  deploymentIdempotencyKey,
  executeDeployment,
} from "./execute-deployment.js";
export type {
  DeploymentExecutionError,
  DeploymentExecutionErrorCode,
  DeploymentExecutionOptions,
  DeploymentExecutionResult,
  DeploymentLogger,
  DeploymentLogEvent,
} from "./execute-deployment.js";
export { DeterministicFakeVercelAdapter } from "./fake-vercel-adapter.js";
export type {
  DeterministicFakeVercelOptions,
} from "./fake-vercel-adapter.js";
export type {
  DeploymentProvider,
  DeploymentProviderFailureCode,
  DeploymentProviderObservation,
  DeploymentProviderRequest,
  DeploymentProviderResult,
} from "./provider-boundary.js";

export interface BuildProvenance {
  readonly buildId: string;
  readonly sourceRevision: string;
  readonly generatedAt: string;
}

export interface InfrastructureOwnership {
  readonly kind: InfrastructureKind;
  readonly owner: AccountOwner;
}

/**
 * Transfer object shared by deployment, operations, and handoff tooling.
 * It records provenance; it does not perform deployment.
 */
export interface DeploymentManifest {
  readonly schemaVersion: 1;
  readonly deploymentId: DeploymentId;
  readonly clientId: ClientId;
  readonly configurationId: WebsiteConfigurationId;
  readonly configurationVersion: number;
  readonly applicationVersion: string;
  readonly deliveryMode: DeliveryMode;
  readonly infrastructureOwnership: readonly InfrastructureOwnership[];
  readonly domains: readonly DomainConfiguration[];
  readonly buildProvenance: BuildProvenance;
  readonly handoff?: Handoff;
}
