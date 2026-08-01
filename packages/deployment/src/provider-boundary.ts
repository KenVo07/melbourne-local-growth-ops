import type {
  ClientId,
  DeliveryMode,
  DeploymentId,
  DomainConfiguration,
  WebsiteConfigurationId,
} from "@melbourne-local-growth-ops/contracts";

import type { RequestedDeploymentProvenance } from "./deployment-intent.js";

export type DeploymentProviderFailureCode =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "REJECTED"
  | "IDEMPOTENCY_CONFLICT"
  | "MALFORMED_RESPONSE"
  | "DOMAIN_PENDING_VERIFICATION"
  | "DOMAIN_CONFLICT";

export interface DeploymentProviderDomainObservation {
  readonly hostname: string;
  readonly status: "ATTACHED";
}

export interface DeploymentProviderRequest {
  readonly schemaVersion: 1;
  readonly projectIdentity: string;
  readonly clientId: ClientId;
  readonly deploymentId: DeploymentId;
  readonly configurationId: WebsiteConfigurationId;
  readonly configurationVersion: number;
  readonly deliveryMode: DeliveryMode;
  readonly domains: readonly DomainConfiguration[];
  readonly requestedProvenance: RequestedDeploymentProvenance;
  readonly idempotencyKey: string;
  readonly attempt: number;
}

export interface DeploymentProviderObservation {
  readonly providerName: string;
  readonly projectIdentity: string;
  readonly idempotencyKey: string;
  readonly providerProjectId: string;
  readonly providerDeploymentId: string;
  readonly previewUrl: string;
  readonly buildId: string;
  readonly sourceRevision: string;
  readonly observedAt: string;
  readonly domainObservations: readonly DeploymentProviderDomainObservation[];
}

export type DeploymentProviderResult =
  | {
      readonly success: true;
      readonly observation: DeploymentProviderObservation;
    }
  | {
      readonly success: false;
      readonly error: {
        readonly code: DeploymentProviderFailureCode;
      };
    };

/**
 * Provider adapters must honor the idempotency key and return observations only
 * after the provider reports a successful deployment.
 */
export interface DeploymentProvider {
  readonly providerName: string;
  deploy(
    request: DeploymentProviderRequest,
  ): Promise<DeploymentProviderResult>;
}
