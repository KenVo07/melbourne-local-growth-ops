import type { DeploymentProviderObservation } from "./provider-boundary.js";

export interface VercelGitSource {
  readonly type: "github";
  readonly org: string;
  readonly repo: string;
  readonly ref: string;
}

export type VercelLifecycleEvent =
  | {
      readonly type: "PROJECT_RECONCILED";
      readonly projectIdentity: string;
      readonly action: "REUSED" | "CREATED";
    }
  | {
      readonly type: "DEPLOYMENT_OBSERVED";
      readonly projectIdentity: string;
      readonly status: "READY";
    }
  | {
      readonly type: "DOMAIN_OBSERVED";
      readonly projectIdentity: string;
      readonly hostname: string;
      readonly status: VercelDomainStatus;
    }
  | {
      readonly type: "ROLLBACK_ATTEMPT_STARTED";
      readonly projectIdentity: string;
      readonly attempt: number;
    }
  | {
      readonly type: "ROLLBACK_ATTEMPT_FAILED";
      readonly projectIdentity: string;
      readonly attempt: number;
      readonly code: VercelRollbackErrorCode;
      readonly retryable: boolean;
    }
  | {
      readonly type: "ROLLBACK_SUCCEEDED";
      readonly projectIdentity: string;
      readonly attempts: number;
    };

export interface VercelLifecycleLogger {
  log(event: VercelLifecycleEvent): void;
}

export type VercelDomainStatus =
  | "ATTACHED"
  | "PENDING_VERIFICATION"
  | "NOT_ATTACHED";

export interface VercelObservedDomain {
  readonly hostname: string;
  readonly status: VercelDomainStatus;
}

export interface VercelObservedState {
  readonly providerName: "VERCEL";
  readonly projectIdentity: string;
  readonly providerProjectId: string;
  readonly providerDeploymentId: string;
  readonly deploymentStatus: "READY";
  readonly sourceRevision: string;
  readonly previewUrl: string;
  readonly observedAt: string;
  readonly domains: readonly VercelObservedDomain[];
}

export type VercelInspectionErrorCode =
  | "INVALID_INSPECTION_TARGET"
  | "INSPECTION_TARGET_NOT_FOUND"
  | "INSPECTION_PROVIDER_RATE_LIMITED"
  | "INSPECTION_PROVIDER_TIMEOUT"
  | "INSPECTION_PROVIDER_UNAVAILABLE"
  | "INSPECTION_PROVIDER_REJECTED"
  | "MALFORMED_PROVIDER_RESPONSE";

export type VercelInspectionResult =
  | {
      readonly success: true;
      readonly state: VercelObservedState;
    }
  | {
      readonly success: false;
      readonly error: {
        readonly code: VercelInspectionErrorCode;
        readonly message: string;
        readonly retryable: boolean;
      };
    };

export type VercelRollbackErrorCode =
  | "INVALID_ROLLBACK_OPTIONS"
  | "INVALID_ROLLBACK_TARGET"
  | "ROLLBACK_TARGET_NOT_FOUND"
  | "ROLLBACK_DOMAIN_NOT_READY"
  | "ROLLBACK_PROVIDER_RATE_LIMITED"
  | "ROLLBACK_PROVIDER_TIMEOUT"
  | "ROLLBACK_PROVIDER_UNAVAILABLE"
  | "ROLLBACK_PROVIDER_REJECTED"
  | "MALFORMED_PROVIDER_RESPONSE";

export interface VercelRollbackOptions {
  readonly maxAttempts?: number;
}

export type VercelRollbackResult =
  | {
      readonly success: true;
      readonly projectIdentity: string;
      readonly providerProjectId: string;
      readonly providerDeploymentId: string;
      readonly attempts: number;
      readonly observedState: VercelObservedState;
    }
  | {
      readonly success: false;
      readonly error: {
        readonly code: VercelRollbackErrorCode;
        readonly message: string;
        readonly retryable: boolean;
        readonly attempts: number;
      };
    };

export function isObservedVercelTarget(
  value: DeploymentProviderObservation,
): boolean {
  return value.providerName === "VERCEL" &&
    value.domainObservations.every((domain) => domain.status === "ATTACHED");
}
