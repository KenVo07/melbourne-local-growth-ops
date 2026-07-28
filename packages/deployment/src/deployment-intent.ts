import {
  DeploymentRecordSchema,
  translateZodIssues,
  validateWebsiteRuntimeConfig,
} from "@melbourne-local-growth-ops/contracts";
import type {
  AccountOwner,
  ClientId,
  DeliveryMode,
  DeploymentId,
  DomainConfiguration,
  ValidationIssue,
  ValidationIssueCode,
  ValidationResult,
  WebsiteConfigurationId,
} from "@melbourne-local-growth-ops/contracts";

export interface RequestedDeploymentProvenance {
  readonly applicationVersion: string;
  readonly templateVersion: string;
  readonly sourceRevision: string;
}

export interface DeploymentIntentOwnership {
  readonly operationalOwner: AccountOwner;
  readonly hostingAccountOwner: AccountOwner;
  readonly sourceRepositoryOwner: AccountOwner;
  readonly domainOwner: "CLIENT";
}

/**
 * A deterministic, provider-unverified plan for one isolated deployment.
 *
 * Requested provenance describes what the caller wants to build. Observed build
 * and provider provenance belongs in DeploymentManifest after provider success.
 */
export interface DeploymentIntent {
  readonly schemaVersion: 1;
  readonly projectIdentity: string;
  readonly clientId: ClientId;
  readonly deploymentId: DeploymentId;
  readonly configurationId: WebsiteConfigurationId;
  readonly configurationVersion: number;
  readonly deliveryMode: DeliveryMode;
  readonly ownership: DeploymentIntentOwnership;
  readonly domains: readonly DomainConfiguration[];
  readonly requestedProvenance: RequestedDeploymentProvenance;
}

const inputKeys = new Set([
  "runtimeConfiguration",
  "deploymentRecord",
  "requestedProvenance",
]);
const provenanceKeys = new Set([
  "applicationVersion",
  "templateVersion",
  "sourceRevision",
]);

function issue(
  code: ValidationIssueCode,
  path: readonly (string | number)[],
  message: string,
): ValidationIssue {
  return Object.freeze({
    code,
    path: Object.freeze([...path]),
    message,
  });
}

function failure<T>(
  issues: readonly ValidationIssue[],
): ValidationResult<T> {
  return {
    success: false,
    issues: Object.freeze([...issues]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function prefixedIssues(
  prefix: string,
  issues: readonly ValidationIssue[],
): readonly ValidationIssue[] {
  return issues.map((validationIssue) =>
    issue(
      validationIssue.code,
      [prefix, ...validationIssue.path],
      validationIssue.message,
    ),
  );
}

function unknownFieldIssues(
  value: Record<string, unknown>,
  allowedKeys: ReadonlySet<string>,
  prefix: readonly string[] = [],
): readonly ValidationIssue[] {
  return Object.keys(value)
    .filter((key) => !allowedKeys.has(key))
    .sort()
    .map((key) =>
      issue(
        "UNKNOWN_FIELD",
        [...prefix, key],
        `Unknown field: ${key}`,
      ),
    );
}

function validateRequestedProvenance(
  value: unknown,
): ValidationResult<RequestedDeploymentProvenance> {
  if (!isRecord(value)) {
    return failure([
      issue(
        "INVALID_TYPE",
        ["requestedProvenance"],
        "Requested provenance must be an object",
      ),
    ]);
  }

  const issues = [
    ...unknownFieldIssues(value, provenanceKeys, ["requestedProvenance"]),
  ];
  for (const field of provenanceKeys) {
    const fieldValue = value[field];
    if (typeof fieldValue !== "string") {
      issues.push(
        issue(
          "INVALID_TYPE",
          ["requestedProvenance", field],
          `${field} must be a string`,
        ),
      );
    } else if (fieldValue.trim().length === 0) {
      issues.push(
        issue(
          "INVALID_LENGTH",
          ["requestedProvenance", field],
          `${field} must not be empty`,
        ),
      );
    }
  }

  if (issues.length > 0) {
    return failure(issues);
  }

  return {
    success: true,
    data: Object.freeze({
      applicationVersion: value.applicationVersion as string,
      templateVersion: value.templateVersion as string,
      sourceRevision: value.sourceRevision as string,
    }),
  };
}

/**
 * Generates a pure deployment plan. The project identity is deterministic for
 * this client/deployment pair but is not a claim of provider-wide uniqueness.
 */
export function createDeploymentIntent(
  input: unknown,
): ValidationResult<DeploymentIntent> {
  if (!isRecord(input)) {
    return failure([
      issue(
        "INVALID_TYPE",
        [],
        "Deployment intent input must be an object",
      ),
    ]);
  }

  const topLevelIssues = unknownFieldIssues(input, inputKeys);
  if (topLevelIssues.length > 0) {
    return failure(topLevelIssues);
  }

  const runtimeConfigurationResult = validateWebsiteRuntimeConfig(
    input.runtimeConfiguration,
  );
  if (!runtimeConfigurationResult.success) {
    return failure(
      prefixedIssues(
        "runtimeConfiguration",
        runtimeConfigurationResult.issues,
      ),
    );
  }

  const deploymentRecordResult = DeploymentRecordSchema.safeParse(
    input.deploymentRecord,
  );
  if (!deploymentRecordResult.success) {
    return failure(
      prefixedIssues(
        "deploymentRecord",
        translateZodIssues(deploymentRecordResult.error.issues),
      ),
    );
  }

  const requestedProvenanceResult = validateRequestedProvenance(
    input.requestedProvenance,
  );
  if (!requestedProvenanceResult.success) {
    return requestedProvenanceResult;
  }

  const runtimeConfiguration = runtimeConfigurationResult.data;
  const deploymentRecord = deploymentRecordResult.data;
  const identityIssues: ValidationIssue[] = [];

  if (deploymentRecord.clientId !== runtimeConfiguration.clientId) {
    identityIssues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        ["deploymentRecord", "clientId"],
        "Deployment record client does not match runtime configuration",
      ),
    );
  }
  if (deploymentRecord.deploymentId !== runtimeConfiguration.deploymentId) {
    identityIssues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        ["deploymentRecord", "deploymentId"],
        "Deployment record identity does not match runtime configuration",
      ),
    );
  }
  if (
    deploymentRecord.websiteConfigurationId !==
    runtimeConfiguration.configurationId
  ) {
    identityIssues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        ["deploymentRecord", "websiteConfigurationId"],
        "Deployment record configuration does not match runtime configuration",
      ),
    );
  }

  if (identityIssues.length > 0) {
    return failure(identityIssues);
  }

  const domains = Object.freeze(
    runtimeConfiguration.domains.map((domain) =>
      Object.freeze({ ...domain }),
    ),
  );

  return {
    success: true,
    data: Object.freeze({
      schemaVersion: 1,
      projectIdentity:
        `${runtimeConfiguration.clientId}:${runtimeConfiguration.deploymentId}`,
      clientId: runtimeConfiguration.clientId,
      deploymentId: runtimeConfiguration.deploymentId,
      configurationId: runtimeConfiguration.configurationId,
      configurationVersion: runtimeConfiguration.configurationVersion,
      deliveryMode: deploymentRecord.deliveryMode,
      ownership: Object.freeze({
        operationalOwner: deploymentRecord.operationalOwner,
        hostingAccountOwner: deploymentRecord.hostingAccountOwner,
        sourceRepositoryOwner: deploymentRecord.sourceRepositoryOwner,
        domainOwner: deploymentRecord.domainOwner,
      }),
      domains,
      requestedProvenance: Object.freeze({
        ...requestedProvenanceResult.data,
      }),
    }),
  };
}
