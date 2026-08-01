import type { DeploymentManifest } from "./index.js";
import type { DeploymentIntent } from "./deployment-intent.js";
import type {
  DeploymentProvider,
  DeploymentProviderFailureCode,
  DeploymentProviderObservation,
  DeploymentProviderRequest,
} from "./provider-boundary.js";

export type DeploymentExecutionErrorCode =
  | "INVALID_EXECUTION_OPTIONS"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_REJECTED"
  | "IDEMPOTENCY_CONFLICT"
  | "DOMAIN_PENDING_VERIFICATION"
  | "DOMAIN_CONFLICT"
  | "MALFORMED_PROVIDER_RESPONSE";

export interface DeploymentExecutionError {
  readonly code: DeploymentExecutionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly attempts: number;
}

export type DeploymentLogEvent =
  | {
      readonly type: "ATTEMPT_STARTED";
      readonly projectIdentity: string;
      readonly providerName: string;
      readonly attempt: number;
    }
  | {
      readonly type: "ATTEMPT_FAILED";
      readonly projectIdentity: string;
      readonly providerName: string;
      readonly attempt: number;
      readonly code: DeploymentExecutionErrorCode;
      readonly retryable: boolean;
    }
  | {
      readonly type: "RETRY_SCHEDULED";
      readonly projectIdentity: string;
      readonly providerName: string;
      readonly nextAttempt: number;
    }
  | {
      readonly type: "DEPLOYMENT_SUCCEEDED";
      readonly projectIdentity: string;
      readonly providerName: string;
      readonly attempts: number;
    };

export interface DeploymentLogger {
  log(event: DeploymentLogEvent): void;
}

export interface DeploymentExecutionOptions {
  readonly maxAttempts?: number;
  readonly logger?: DeploymentLogger;
}

export type DeploymentExecutionResult =
  | {
      readonly success: true;
      readonly attempts: number;
      readonly idempotencyKey: string;
      readonly projectIdentity: string;
      readonly providerObservation: DeploymentProviderObservation;
      readonly manifest: DeploymentManifest;
    }
  | {
      readonly success: false;
      readonly error: DeploymentExecutionError;
    };

type DeploymentExecutionFailure = Extract<
  DeploymentExecutionResult,
  { readonly success: false }
>;

interface NormalizedProviderFailure {
  readonly code: DeploymentExecutionErrorCode;
  readonly message: string;
  readonly retryable: boolean;
}

const providerFailureCodes = new Set<DeploymentProviderFailureCode>([
  "RATE_LIMITED",
  "TIMEOUT",
  "UNAVAILABLE",
  "REJECTED",
  "IDEMPOTENCY_CONFLICT",
  "MALFORMED_RESPONSE",
  "DOMAIN_PENDING_VERIFICATION",
  "DOMAIN_CONFLICT",
]);

function freezeEvent(event: DeploymentLogEvent): DeploymentLogEvent {
  return Object.freeze(event);
}

function emit(
  logger: DeploymentLogger | undefined,
  event: DeploymentLogEvent,
): void {
  if (logger === undefined) {
    return;
  }

  try {
    logger.log(freezeEvent(event));
  } catch {
    // Observability must not turn a completed provider action into a retry.
  }
}

function failure(
  code: DeploymentExecutionErrorCode,
  message: string,
  retryable: boolean,
  attempts: number,
): DeploymentExecutionFailure {
  return Object.freeze({
    success: false,
    error: Object.freeze({ code, message, retryable, attempts }),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isExactIsoTimestamp(value: unknown): value is string {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

function isHttpsUrl(value: unknown): value is string {
  if (
    !isNonEmptyString(value) ||
    !value.startsWith("https://") ||
    /\s/.test(value)
  ) {
    return false;
  }

  const authority = value.slice("https://".length).split("/", 1)[0];
  return authority !== undefined &&
    authority.length > 0 &&
    !authority.includes("@");
}

function normalizedProviderFailure(
  code: DeploymentProviderFailureCode,
): NormalizedProviderFailure {
  switch (code) {
    case "RATE_LIMITED":
      return {
        code: "PROVIDER_RATE_LIMITED",
        message: "Deployment provider rate limited the request",
        retryable: true,
      };
    case "TIMEOUT":
      return {
        code: "PROVIDER_TIMEOUT",
        message: "Deployment provider timed out",
        retryable: true,
      };
    case "UNAVAILABLE":
      return {
        code: "PROVIDER_UNAVAILABLE",
        message: "Deployment provider is unavailable",
        retryable: true,
      };
    case "REJECTED":
      return {
        code: "PROVIDER_REJECTED",
        message: "Deployment provider rejected the request",
        retryable: false,
      };
    case "IDEMPOTENCY_CONFLICT":
      return {
        code: "IDEMPOTENCY_CONFLICT",
        message: "Deployment provider detected an idempotency conflict",
        retryable: false,
      };
    case "MALFORMED_RESPONSE":
      return {
        code: "MALFORMED_PROVIDER_RESPONSE",
        message: "Deployment provider returned an invalid response",
        retryable: false,
      };
    case "DOMAIN_PENDING_VERIFICATION":
      return {
        code: "DOMAIN_PENDING_VERIFICATION",
        message: "Deployment domain is pending provider verification",
        retryable: false,
      };
    case "DOMAIN_CONFLICT":
      return {
        code: "DOMAIN_CONFLICT",
        message: "Deployment domain is assigned to another provider project",
        retryable: false,
      };
  }
}

function malformedProviderFailure(
  attempts: number,
): DeploymentExecutionFailure {
  return failure(
    "MALFORMED_PROVIDER_RESPONSE",
    "Deployment provider returned an invalid response",
    false,
    attempts,
  );
}

function validateProviderFailure(
  value: unknown,
): DeploymentProviderFailureCode | undefined {
  if (!isRecord(value) || value.success !== false || !isRecord(value.error)) {
    return undefined;
  }

  const code = value.error.code;
  return typeof code === "string" &&
    providerFailureCodes.has(code as DeploymentProviderFailureCode)
    ? (code as DeploymentProviderFailureCode)
    : undefined;
}

function validateProviderObservation(
  value: unknown,
  providerName: string,
  request: DeploymentProviderRequest,
): DeploymentProviderObservation | undefined {
  if (
    !isRecord(value) ||
    value.success !== true ||
    !isRecord(value.observation)
  ) {
    return undefined;
  }

  const observation = value.observation;
  const expectedDomains = request.domains
    .map((domain) => domain.hostname)
    .sort();
  if (!Array.isArray(observation.domainObservations)) {
    return undefined;
  }
  const domainObservations = observation.domainObservations.map((domain) => {
    if (
      !isRecord(domain) ||
      !isNonEmptyString(domain.hostname) ||
      domain.status !== "ATTACHED"
    ) {
      return undefined;
    }
    return Object.freeze({
      hostname: domain.hostname,
      status: "ATTACHED" as const,
    });
  });
  if (
    domainObservations.some((domain) => domain === undefined) ||
    new Set(domainObservations.map((domain) => domain?.hostname)).size !==
      domainObservations.length ||
    JSON.stringify(
      domainObservations.map((domain) => domain?.hostname).sort(),
    ) !== JSON.stringify(expectedDomains)
  ) {
    return undefined;
  }

  if (
    observation.providerName !== providerName ||
    observation.projectIdentity !== request.projectIdentity ||
    observation.idempotencyKey !== request.idempotencyKey ||
    observation.sourceRevision !==
      request.requestedProvenance.sourceRevision ||
    !isNonEmptyString(observation.providerProjectId) ||
    !isNonEmptyString(observation.providerDeploymentId) ||
    !isHttpsUrl(observation.previewUrl) ||
    !isNonEmptyString(observation.buildId) ||
    !isExactIsoTimestamp(observation.observedAt)
  ) {
    return undefined;
  }

  return Object.freeze({
    providerName: observation.providerName,
    projectIdentity: observation.projectIdentity,
    idempotencyKey: observation.idempotencyKey,
    providerProjectId: observation.providerProjectId,
    providerDeploymentId: observation.providerDeploymentId,
    previewUrl: observation.previewUrl,
    buildId: observation.buildId,
    sourceRevision: observation.sourceRevision,
    observedAt: observation.observedAt,
    domainObservations: Object.freeze(
      domainObservations as {
        readonly hostname: string;
        readonly status: "ATTACHED";
      }[],
    ),
  });
}

function lengthPrefixed(value: string | number): string {
  const serialized = String(value);
  return `${serialized.length}:${serialized}`;
}

export function deploymentIdempotencyKey(intent: DeploymentIntent): string {
  const domains = intent.domains
    .map((domain) => `${domain.hostname}=${String(domain.canonical)}`)
    .sort()
    .join(",");
  const infrastructureOwnership = intent.infrastructureOwnership
    .map((ownership) => `${ownership.kind}=${ownership.owner}`)
    .sort()
    .join(",");
  const handoff =
    intent.handoff === undefined ? "NONE" : JSON.stringify(intent.handoff);

  return [
    "deployment-intent-v1",
    intent.projectIdentity,
    intent.configurationId,
    intent.configurationVersion,
    intent.deliveryMode,
    intent.ownership.operationalOwner,
    intent.ownership.hostingAccountOwner,
    intent.ownership.sourceRepositoryOwner,
    intent.ownership.domainOwner,
    domains,
    infrastructureOwnership,
    handoff,
    intent.requestedProvenance.applicationVersion,
    intent.requestedProvenance.templateVersion,
    intent.requestedProvenance.sourceRevision,
  ]
    .map(lengthPrefixed)
    .join("|");
}

function providerRequest(
  intent: DeploymentIntent,
  idempotencyKey: string,
  attempt: number,
): DeploymentProviderRequest {
  return Object.freeze({
    schemaVersion: 1,
    projectIdentity: intent.projectIdentity,
    clientId: intent.clientId,
    deploymentId: intent.deploymentId,
    configurationId: intent.configurationId,
    configurationVersion: intent.configurationVersion,
    deliveryMode: intent.deliveryMode,
    domains: Object.freeze(
      intent.domains.map((domain) => Object.freeze({ ...domain })),
    ),
    requestedProvenance: Object.freeze({
      ...intent.requestedProvenance,
    }),
    idempotencyKey,
    attempt,
  });
}

function deploymentManifest(
  intent: DeploymentIntent,
  observation: DeploymentProviderObservation,
): DeploymentManifest {
  return Object.freeze({
    schemaVersion: 1,
    deploymentId: intent.deploymentId,
    clientId: intent.clientId,
    configurationId: intent.configurationId,
    configurationVersion: intent.configurationVersion,
    applicationVersion: intent.requestedProvenance.applicationVersion,
    deliveryMode: intent.deliveryMode,
    infrastructureOwnership: Object.freeze(
      intent.infrastructureOwnership.map((ownership) =>
        Object.freeze({ ...ownership }),
      ),
    ),
    domains: Object.freeze(
      intent.domains.map((domain) => Object.freeze({ ...domain })),
    ),
    buildProvenance: Object.freeze({
      buildId: observation.buildId,
      sourceRevision: observation.sourceRevision,
      generatedAt: observation.observedAt,
    }),
    ...(intent.handoff === undefined
      ? {}
      : { handoff: Object.freeze({ ...intent.handoff }) }),
  });
}

function validMaxAttempts(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}

export async function executeDeployment(
  intent: DeploymentIntent,
  provider: DeploymentProvider,
  options: DeploymentExecutionOptions = {},
): Promise<DeploymentExecutionResult> {
  const maxAttempts = options.maxAttempts ?? 3;
  if (!validMaxAttempts(maxAttempts)) {
    return failure(
      "INVALID_EXECUTION_OPTIONS",
      "maxAttempts must be an integer between 1 and 5",
      false,
      0,
    );
  }

  const idempotencyKey = deploymentIdempotencyKey(intent);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const request = providerRequest(intent, idempotencyKey, attempt);
    emit(options.logger, {
      type: "ATTEMPT_STARTED",
      projectIdentity: intent.projectIdentity,
      providerName: provider.providerName,
      attempt,
    });

    let rawResult: unknown;
    try {
      rawResult = await provider.deploy(request);
    } catch {
      rawResult = {
        success: false,
        error: { code: "UNAVAILABLE" },
      };
    }

    const observation = validateProviderObservation(
      rawResult,
      provider.providerName,
      request,
    );
    if (observation !== undefined) {
      const manifest = deploymentManifest(intent, observation);
      emit(options.logger, {
        type: "DEPLOYMENT_SUCCEEDED",
        projectIdentity: intent.projectIdentity,
        providerName: provider.providerName,
        attempts: attempt,
      });
      return Object.freeze({
        success: true,
        attempts: attempt,
        idempotencyKey,
        projectIdentity: intent.projectIdentity,
        providerObservation: observation,
        manifest,
      });
    }

    const providerFailureCode = validateProviderFailure(rawResult);
    if (providerFailureCode === undefined) {
      const malformed = malformedProviderFailure(attempt);
      emit(options.logger, {
        type: "ATTEMPT_FAILED",
        projectIdentity: intent.projectIdentity,
        providerName: provider.providerName,
        attempt,
        code: malformed.error.code,
        retryable: false,
      });
      return malformed;
    }

    const normalized = normalizedProviderFailure(providerFailureCode);
    emit(options.logger, {
      type: "ATTEMPT_FAILED",
      projectIdentity: intent.projectIdentity,
      providerName: provider.providerName,
      attempt,
      code: normalized.code,
      retryable: normalized.retryable,
    });

    if (!normalized.retryable || attempt === maxAttempts) {
      return failure(
        normalized.code,
        normalized.message,
        normalized.retryable,
        attempt,
      );
    }

    emit(options.logger, {
      type: "RETRY_SCHEDULED",
      projectIdentity: intent.projectIdentity,
      providerName: provider.providerName,
      nextAttempt: attempt + 1,
    });
  }

  return failure(
    "PROVIDER_UNAVAILABLE",
    "Deployment provider is unavailable",
    true,
    maxAttempts,
  );
}
