import type { DeploymentIntent } from "./deployment-intent.js";
import {
  deploymentIdempotencyKey,
  executeDeployment,
} from "./execute-deployment.js";
import type {
  DeploymentExecutionOptions,
  DeploymentExecutionResult,
} from "./execute-deployment.js";
import type {
  DeploymentProvider,
  DeploymentProviderFailureCode,
  DeploymentProviderObservation,
  DeploymentProviderRequest,
  DeploymentProviderResult,
} from "./provider-boundary.js";
import type {
  VercelHttpRequest,
  VercelHttpResponse,
  VercelHttpTransport,
} from "./vercel-http.js";
import {
  planVercelDeployment,
  vercelProjectName,
} from "./vercel-plan.js";
import type { VercelDeploymentPlan } from "./vercel-plan.js";
import type {
  VercelDomainStatus,
  VercelGitSource,
  VercelInspectionErrorCode,
  VercelInspectionResult,
  VercelLifecycleEvent,
  VercelLifecycleLogger,
  VercelObservedDomain,
  VercelObservedState,
  VercelRollbackErrorCode,
  VercelRollbackOptions,
  VercelRollbackResult,
} from "./vercel-lifecycle-types.js";

interface ProviderProject {
  readonly id: string;
  readonly name: string;
}

interface ReadyDeployment {
  readonly id: string;
  readonly projectId: string;
  readonly previewUrl: string;
  readonly sourceRevision: string;
  readonly observedAt: string;
}

type HttpFailureKind =
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "UNAVAILABLE"
  | "REJECTED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "MALFORMED_RESPONSE";

type Parsed<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly code: HttpFailureKind };

export interface VercelDeploymentAdapterOptions {
  readonly transport: VercelHttpTransport;
  readonly gitSource: VercelGitSource;
  readonly teamId?: string;
  readonly logger?: VercelLifecycleLogger;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function query(teamId: string | undefined): Readonly<Record<string, string>> {
  return teamId === undefined
    ? Object.freeze({})
    : Object.freeze({ teamId });
}

function httpFailure(status: number): HttpFailureKind {
  if (status === 404) {
    return "NOT_FOUND";
  }
  if (status === 409) {
    return "CONFLICT";
  }
  if (status === 408 || status === 504) {
    return "TIMEOUT";
  }
  if (status === 429) {
    return "RATE_LIMITED";
  }
  if (status >= 500) {
    return "UNAVAILABLE";
  }
  return "REJECTED";
}

function providerFailure(
  code: DeploymentProviderFailureCode,
): DeploymentProviderResult {
  return Object.freeze({
    success: false,
    error: Object.freeze({ code }),
  });
}

function providerCode(code: HttpFailureKind): DeploymentProviderFailureCode {
  switch (code) {
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
      return "TIMEOUT";
    case "UNAVAILABLE":
      return "UNAVAILABLE";
    case "CONFLICT":
      return "IDEMPOTENCY_CONFLICT";
    case "MALFORMED_RESPONSE":
      return "MALFORMED_RESPONSE";
    case "NOT_FOUND":
    case "REJECTED":
      return "REJECTED";
  }
}

function requestFingerprint(request: DeploymentProviderRequest): string {
  return JSON.stringify({
    schemaVersion: request.schemaVersion,
    projectIdentity: request.projectIdentity,
    clientId: request.clientId,
    deploymentId: request.deploymentId,
    configurationId: request.configurationId,
    configurationVersion: request.configurationVersion,
    deliveryMode: request.deliveryMode,
    domains: request.domains,
    requestedProvenance: request.requestedProvenance,
    idempotencyKey: request.idempotencyKey,
  });
}

function httpsUrl(hostname: unknown): string | undefined {
  if (
    !isNonEmptyString(hostname) ||
    hostname.includes("/") ||
    hostname.includes("@") ||
    /\s/.test(hostname)
  ) {
    return undefined;
  }
  return `https://${hostname}`;
}

function exactIsoFromEpoch(value: unknown): string | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  try {
    return new Date(value).toISOString();
  } catch {
    return undefined;
  }
}

function validOptions(options: VercelDeploymentAdapterOptions): void {
  if (
    typeof options.transport?.request !== "function" ||
    options.gitSource.type !== "github" ||
    !isNonEmptyString(options.gitSource.org) ||
    !isNonEmptyString(options.gitSource.repo) ||
    !isNonEmptyString(options.gitSource.ref) ||
    (options.teamId !== undefined && !isNonEmptyString(options.teamId))
  ) {
    throw new TypeError("Invalid Vercel deployment adapter options");
  }
}

function freezeEvent(event: VercelLifecycleEvent): VercelLifecycleEvent {
  return Object.freeze(event);
}

/**
 * Production-oriented Vercel lifecycle adapter. Authentication belongs to the
 * injected transport, so this adapter never accepts or emits credentials.
 */
export class VercelDeploymentAdapter implements DeploymentProvider {
  readonly providerName = "VERCEL";

  readonly #transport: VercelHttpTransport;
  readonly #gitSource: VercelGitSource;
  readonly #teamId: string | undefined;
  readonly #logger: VercelLifecycleLogger | undefined;
  readonly #fingerprints = new Map<string, string>();
  readonly #deploymentIds = new Map<string, string>();
  readonly #successful = new Map<string, DeploymentProviderResult>();
  readonly #deploymentsInFlight = new Map<
    string,
    Promise<DeploymentProviderResult>
  >();
  readonly #rollbacks = new Map<string, VercelRollbackResult>();
  readonly #rollbacksInFlight = new Map<
    string,
    Promise<VercelRollbackResult>
  >();

  constructor(options: VercelDeploymentAdapterOptions) {
    validOptions(options);
    this.#transport = options.transport;
    this.#gitSource = Object.freeze({
      type: "github",
      org: options.gitSource.org,
      repo: options.gitSource.repo,
      ref: options.gitSource.ref,
    });
    this.#teamId = options.teamId;
    this.#logger = options.logger;
  }

  plan(intent: DeploymentIntent): VercelDeploymentPlan {
    return planVercelDeployment(
      intent,
      this.#teamId === undefined ? {} : { teamId: this.#teamId },
    );
  }

  apply(
    intent: DeploymentIntent,
    options: DeploymentExecutionOptions = {},
  ): Promise<DeploymentExecutionResult> {
    return executeDeployment(intent, this, options);
  }

  async deploy(
    request: DeploymentProviderRequest,
  ): Promise<DeploymentProviderResult> {
    const fingerprint = requestFingerprint(request);
    const previousFingerprint = this.#fingerprints.get(request.idempotencyKey);
    if (
      previousFingerprint !== undefined &&
      previousFingerprint !== fingerprint
    ) {
      return providerFailure("IDEMPOTENCY_CONFLICT");
    }
    this.#fingerprints.set(request.idempotencyKey, fingerprint);

    const successful = this.#successful.get(request.idempotencyKey);
    if (successful !== undefined) {
      return successful;
    }
    const existing = this.#deploymentsInFlight.get(request.idempotencyKey);
    if (existing !== undefined) {
      return existing;
    }

    const inFlight = this.#deploy(request);
    this.#deploymentsInFlight.set(request.idempotencyKey, inFlight);
    try {
      const result = await inFlight;
      if (result.success) {
        this.#successful.set(request.idempotencyKey, result);
      }
      return result;
    } finally {
      this.#deploymentsInFlight.delete(request.idempotencyKey);
    }
  }

  async inspect(
    intent: DeploymentIntent,
    observation: DeploymentProviderObservation,
  ): Promise<VercelInspectionResult> {
    if (!this.#validTarget(intent, observation)) {
      return inspectionFailure(
        "INVALID_INSPECTION_TARGET",
        "Inspection target does not match the deployment intent",
        false,
      );
    }

    const projectName = vercelProjectName(intent);
    const projectResponse = await this.#request({
      operation: "GET_PROJECT",
      method: "GET",
      path: `/v9/projects/${encodeURIComponent(projectName)}`,
      query: query(this.#teamId),
    });
    if (!projectResponse.success) {
      return inspectionHttpFailure(projectResponse.code, "project");
    }
    const project = parseProject(
      projectResponse.value,
      projectName,
      observation.providerProjectId,
    );
    if (!project.success) {
      return inspectionHttpFailure(project.code, "project");
    }

    const deploymentResponse = await this.#request({
      operation: "GET_DEPLOYMENT",
      method: "GET",
      path: `/v13/deployments/${
        encodeURIComponent(observation.providerDeploymentId)
      }`,
      query: query(this.#teamId),
    });
    if (!deploymentResponse.success) {
      return inspectionHttpFailure(deploymentResponse.code, "deployment");
    }
    const deployment = parseReadyDeployment(
      deploymentResponse.value,
      project.value.id,
      observation.providerDeploymentId,
      observation.sourceRevision,
    );
    if (!deployment.success) {
      return inspectionHttpFailure(deployment.code, "deployment");
    }

    const domains: VercelObservedDomain[] = [];
    for (const domain of [...intent.domains].sort((left, right) =>
      left.hostname.localeCompare(right.hostname)
    )) {
      const observedDomain = await this.#inspectDomain(
        project.value.id,
        domain.hostname,
      );
      if (!observedDomain.success) {
        return inspectionHttpFailure(observedDomain.code, "domain");
      }
      domains.push(observedDomain.value);
      this.#emit({
        type: "DOMAIN_OBSERVED",
        projectIdentity: intent.projectIdentity,
        hostname: domain.hostname,
        status: observedDomain.value.status,
      });
    }

    const state: VercelObservedState = Object.freeze({
      providerName: "VERCEL",
      projectIdentity: intent.projectIdentity,
      providerProjectId: project.value.id,
      providerDeploymentId: deployment.value.id,
      deploymentStatus: "READY",
      sourceRevision: deployment.value.sourceRevision,
      previewUrl: deployment.value.previewUrl,
      observedAt: deployment.value.observedAt,
      domains: Object.freeze(domains),
    });
    return Object.freeze({ success: true, state });
  }

  async rollback(
    intent: DeploymentIntent,
    target: DeploymentProviderObservation,
    options: VercelRollbackOptions = {},
  ): Promise<VercelRollbackResult> {
    const maxAttempts = options.maxAttempts ?? 3;
    if (
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 5
    ) {
      return rollbackFailure(
        "INVALID_ROLLBACK_OPTIONS",
        "maxAttempts must be an integer between 1 and 5",
        false,
        0,
      );
    }
    if (!this.#validTarget(intent, target)) {
      return rollbackFailure(
        "INVALID_ROLLBACK_TARGET",
        "Rollback target does not match the deployment intent",
        false,
        0,
      );
    }

    const key = `${target.providerProjectId}:${target.providerDeploymentId}`;
    const completed = this.#rollbacks.get(key);
    if (completed !== undefined) {
      return completed;
    }
    const existing = this.#rollbacksInFlight.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const inFlight = this.#rollback(intent, target, maxAttempts);
    this.#rollbacksInFlight.set(key, inFlight);
    try {
      const result = await inFlight;
      if (result.success) {
        this.#rollbacks.set(key, result);
      }
      return result;
    } finally {
      this.#rollbacksInFlight.delete(key);
    }
  }

  async #deploy(
    request: DeploymentProviderRequest,
  ): Promise<DeploymentProviderResult> {
    const projectName = projectNameFromRequest(request);
    const projectResult = await this.#reconcileProject(
      request.projectIdentity,
      projectName,
    );
    if (!projectResult.success) {
      return providerFailure(providerCode(projectResult.code));
    }

    let deploymentId = this.#deploymentIds.get(request.idempotencyKey);
    if (deploymentId === undefined) {
      const creation = await this.#request({
        operation: "CREATE_DEPLOYMENT",
        method: "POST",
        path: "/v13/deployments",
        query: query(this.#teamId),
        body: Object.freeze({
          name: projectName,
          project: projectResult.value.id,
          target: "production",
          gitSource: Object.freeze({
            type: this.#gitSource.type,
            org: this.#gitSource.org,
            repo: this.#gitSource.repo,
            ref: this.#gitSource.ref,
            sha: request.requestedProvenance.sourceRevision,
          }),
          meta: Object.freeze({
            mlgoIdempotencyKey: stableHash(request.idempotencyKey),
            mlgoProjectIdentity: stableHash(request.projectIdentity),
          }),
        }),
      });
      if (!creation.success) {
        return providerFailure(providerCode(creation.code));
      }
      deploymentId = parseDeploymentCreation(creation.value);
      if (deploymentId === undefined) {
        return providerFailure("MALFORMED_RESPONSE");
      }
      this.#deploymentIds.set(request.idempotencyKey, deploymentId);
    }

    const deploymentResponse = await this.#request({
      operation: "GET_DEPLOYMENT",
      method: "GET",
      path: `/v13/deployments/${encodeURIComponent(deploymentId)}`,
      query: query(this.#teamId),
    });
    if (!deploymentResponse.success) {
      return providerFailure(providerCode(deploymentResponse.code));
    }
    const deployment = parseReadyDeployment(
      deploymentResponse.value,
      projectResult.value.id,
      deploymentId,
      request.requestedProvenance.sourceRevision,
    );
    if (!deployment.success) {
      return providerFailure(providerCode(deployment.code));
    }
    this.#emit({
      type: "DEPLOYMENT_OBSERVED",
      projectIdentity: request.projectIdentity,
      status: "READY",
    });

    const domainObservations: {
      readonly hostname: string;
      readonly status: "ATTACHED";
    }[] = [];
    for (const domain of [...request.domains].sort((left, right) =>
      left.hostname.localeCompare(right.hostname)
    )) {
      const attached = await this.#reconcileDomain(
        request.projectIdentity,
        projectResult.value.id,
        domain.hostname,
      );
      if (!attached.success) {
        const code = attached.code === "CONFLICT"
          ? "DOMAIN_CONFLICT"
          : attached.code === "DOMAIN_PENDING"
          ? "DOMAIN_PENDING_VERIFICATION"
          : providerCode(attached.code);
        return providerFailure(code);
      }
      domainObservations.push(Object.freeze({
        hostname: domain.hostname,
        status: "ATTACHED",
      }));
    }

    return Object.freeze({
      success: true,
      observation: Object.freeze({
        providerName: "VERCEL",
        projectIdentity: request.projectIdentity,
        idempotencyKey: request.idempotencyKey,
        providerProjectId: projectResult.value.id,
        providerDeploymentId: deployment.value.id,
        previewUrl: deployment.value.previewUrl,
        buildId: deployment.value.id,
        sourceRevision: deployment.value.sourceRevision,
        observedAt: deployment.value.observedAt,
        domainObservations: Object.freeze(domainObservations),
      }),
    });
  }

  async #reconcileProject(
    projectIdentity: string,
    projectName: string,
  ): Promise<Parsed<ProviderProject>> {
    const found = await this.#request({
      operation: "GET_PROJECT",
      method: "GET",
      path: `/v9/projects/${encodeURIComponent(projectName)}`,
      query: query(this.#teamId),
    });
    if (found.success) {
      const project = parseProject(found.value, projectName);
      if (project.success) {
        this.#emit({
          type: "PROJECT_RECONCILED",
          projectIdentity,
          action: "REUSED",
        });
      }
      return project;
    }
    if (found.code !== "NOT_FOUND") {
      return found;
    }

    const created = await this.#request({
      operation: "CREATE_PROJECT",
      method: "POST",
      path: "/v11/projects",
      query: query(this.#teamId),
      body: Object.freeze({ name: projectName, framework: "nextjs" }),
    });
    if (!created.success) {
      return created;
    }
    const project = parseProject(created.value, projectName);
    if (project.success) {
      this.#emit({
        type: "PROJECT_RECONCILED",
        projectIdentity,
        action: "CREATED",
      });
    }
    return project;
  }

  async #reconcileDomain(
    projectIdentity: string,
    projectId: string,
    hostname: string,
  ): Promise<
    Parsed<{ readonly hostname: string; readonly status: "ATTACHED" }> |
      { readonly success: false; readonly code: "DOMAIN_PENDING" }
  > {
    let observed = await this.#request({
      operation: "GET_PROJECT_DOMAIN",
      method: "GET",
      path:
        `/v9/projects/${encodeURIComponent(projectId)}/domains/${
          encodeURIComponent(hostname)
        }`,
      query: query(this.#teamId),
    });
    if (!observed.success && observed.code === "NOT_FOUND") {
      const attached = await this.#request({
        operation: "ADD_PROJECT_DOMAIN",
        method: "POST",
        path:
          `/v10/projects/${encodeURIComponent(projectId)}/domains`,
        query: query(this.#teamId),
        body: Object.freeze({ name: hostname }),
      });
      if (!attached.success) {
        return attached;
      }
      if (!parseDomain(attached.value, projectId, hostname).success) {
        return { success: false, code: "MALFORMED_RESPONSE" };
      }
      observed = await this.#request({
        operation: "GET_PROJECT_DOMAIN",
        method: "GET",
        path:
          `/v9/projects/${encodeURIComponent(projectId)}/domains/${
            encodeURIComponent(hostname)
          }`,
        query: query(this.#teamId),
      });
    }
    if (!observed.success) {
      return observed;
    }
    const domain = parseDomain(observed.value, projectId, hostname);
    if (!domain.success) {
      return domain;
    }
    const status: VercelDomainStatus = domain.value.verified
      ? "ATTACHED"
      : "PENDING_VERIFICATION";
    this.#emit({
      type: "DOMAIN_OBSERVED",
      projectIdentity,
      hostname,
      status,
    });
    return status === "ATTACHED"
      ? {
        success: true,
        value: Object.freeze({ hostname, status }),
      }
      : { success: false, code: "DOMAIN_PENDING" };
  }

  async #inspectDomain(
    projectId: string,
    hostname: string,
  ): Promise<Parsed<VercelObservedDomain>> {
    const response = await this.#request({
      operation: "GET_PROJECT_DOMAIN",
      method: "GET",
      path:
        `/v9/projects/${encodeURIComponent(projectId)}/domains/${
          encodeURIComponent(hostname)
        }`,
      query: query(this.#teamId),
    });
    if (!response.success && response.code === "NOT_FOUND") {
      return {
        success: true,
        value: Object.freeze({ hostname, status: "NOT_ATTACHED" }),
      };
    }
    if (!response.success) {
      return response;
    }
    const domain = parseDomain(response.value, projectId, hostname);
    if (!domain.success) {
      return domain;
    }
    return {
      success: true,
      value: Object.freeze({
        hostname,
        status: domain.value.verified
          ? "ATTACHED"
          : "PENDING_VERIFICATION",
      }),
    };
  }

  async #rollback(
    intent: DeploymentIntent,
    target: DeploymentProviderObservation,
    maxAttempts: number,
  ): Promise<VercelRollbackResult> {
    const before = await this.inspect(intent, target);
    if (!before.success) {
      return before.error.code === "INSPECTION_TARGET_NOT_FOUND"
        ? rollbackFailure(
          "ROLLBACK_TARGET_NOT_FOUND",
          "Rollback target was not found",
          false,
          0,
        )
        : rollbackFailure(
          rollbackCodeFromInspection(before.error.code),
          "Rollback target could not be validated",
          before.error.retryable,
          0,
        );
    }
    if (before.state.domains.some((domain) => domain.status !== "ATTACHED")) {
      return rollbackFailure(
        "ROLLBACK_DOMAIN_NOT_READY",
        "Rollback target domains are not attached and verified",
        false,
        0,
      );
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      this.#emit({
        type: "ROLLBACK_ATTEMPT_STARTED",
        projectIdentity: intent.projectIdentity,
        attempt,
      });
      const response = await this.#request({
        operation: "REQUEST_ROLLBACK",
        method: "POST",
        path:
          `/v1/projects/${encodeURIComponent(target.providerProjectId)}/rollback/${
            encodeURIComponent(target.providerDeploymentId)
          }`,
        query: query(this.#teamId),
      });
      if (
        response.success &&
        (response.value.status === 200 ||
          response.value.status === 201 ||
          response.value.status === 204)
      ) {
        if (
          response.value.body !== null &&
          response.value.body !== undefined
        ) {
          return rollbackFailure(
            "MALFORMED_PROVIDER_RESPONSE",
            "Vercel returned an invalid rollback response",
            false,
            attempt,
          );
        }
        const after = await this.inspect(intent, target);
        if (!after.success) {
          return rollbackFailure(
            rollbackCodeFromInspection(after.error.code),
            "Rolled back deployment could not be validated",
            after.error.retryable,
            attempt,
          );
        }
        this.#emit({
          type: "ROLLBACK_SUCCEEDED",
          projectIdentity: intent.projectIdentity,
          attempts: attempt,
        });
        return Object.freeze({
          success: true,
          projectIdentity: intent.projectIdentity,
          providerProjectId: target.providerProjectId,
          providerDeploymentId: target.providerDeploymentId,
          attempts: attempt,
          observedState: after.state,
        });
      }

      const rawCode = response.success
        ? httpFailure(response.value.status)
        : response.code;
      const normalized = rollbackCode(rawCode);
      const retryable = rawCode === "RATE_LIMITED" ||
        rawCode === "TIMEOUT" ||
        rawCode === "UNAVAILABLE";
      this.#emit({
        type: "ROLLBACK_ATTEMPT_FAILED",
        projectIdentity: intent.projectIdentity,
        attempt,
        code: normalized,
        retryable,
      });
      if (!retryable || attempt === maxAttempts) {
        return rollbackFailure(
          normalized,
          rollbackMessage(normalized),
          retryable,
          attempt,
        );
      }
    }
    return rollbackFailure(
      "ROLLBACK_PROVIDER_UNAVAILABLE",
      "Vercel rollback is unavailable",
      true,
      maxAttempts,
    );
  }

  #validTarget(
    intent: DeploymentIntent,
    target: DeploymentProviderObservation,
  ): boolean {
    const expectedDomains = intent.domains
      .map((domain) => domain.hostname)
      .sort();
    const actualDomains = target.domainObservations
      .filter((domain) => domain.status === "ATTACHED")
      .map((domain) => domain.hostname)
      .sort();
    return target.providerName === "VERCEL" &&
      target.projectIdentity === intent.projectIdentity &&
      target.idempotencyKey === deploymentIdempotencyKey(intent) &&
      target.sourceRevision === intent.requestedProvenance.sourceRevision &&
      JSON.stringify(actualDomains) === JSON.stringify(expectedDomains);
  }

  async #request(request: VercelHttpRequest): Promise<Parsed<VercelHttpResponse>> {
    try {
      const response = await this.#transport.request(Object.freeze(request));
      if (
        !isRecord(response) ||
        typeof response.status !== "number" ||
        !Number.isInteger(response.status) ||
        response.status < 100 ||
        response.status > 599
      ) {
        return { success: false, code: "MALFORMED_RESPONSE" };
      }
      if (response.status >= 200 && response.status < 300) {
        return {
          success: true,
          value: Object.freeze({
            status: response.status,
            body: response.body,
          }),
        };
      }
      return { success: false, code: httpFailure(response.status) };
    } catch {
      return { success: false, code: "UNAVAILABLE" };
    }
  }

  #emit(event: VercelLifecycleEvent): void {
    if (this.#logger === undefined) {
      return;
    }
    try {
      this.#logger.log(freezeEvent(event));
    } catch {
      // Closed observability cannot alter lifecycle behavior.
    }
  }
}

function projectNameFromRequest(request: DeploymentProviderRequest): string {
  const intentLike = {
    clientId: request.clientId,
    deploymentId: request.deploymentId,
    projectIdentity: request.projectIdentity,
  } as DeploymentIntent;
  return vercelProjectName(intentLike);
}

function parseProject(
  response: VercelHttpResponse,
  expectedName: string,
  expectedId?: string,
): Parsed<ProviderProject> {
  const body = response.body;
  if (
    !isRecord(body) ||
    !isNonEmptyString(body.id) ||
    body.name !== expectedName ||
    (expectedId !== undefined && body.id !== expectedId)
  ) {
    return { success: false, code: "MALFORMED_RESPONSE" };
  }
  return {
    success: true,
    value: Object.freeze({ id: body.id, name: body.name }),
  };
}

function parseDeploymentCreation(response: VercelHttpResponse): string | undefined {
  return isRecord(response.body) && isNonEmptyString(response.body.id)
    ? response.body.id
    : undefined;
}

function parseReadyDeployment(
  response: VercelHttpResponse,
  expectedProjectId: string,
  expectedDeploymentId: string,
  expectedSourceRevision: string,
): Parsed<ReadyDeployment> {
  const body = response.body;
  if (!isRecord(body)) {
    return { success: false, code: "MALFORMED_RESPONSE" };
  }
  if (
    body.readyState === "QUEUED" ||
    body.readyState === "INITIALIZING" ||
    body.readyState === "BUILDING"
  ) {
    return { success: false, code: "UNAVAILABLE" };
  }
  if (body.readyState === "ERROR" || body.readyState === "CANCELED") {
    return { success: false, code: "REJECTED" };
  }
  const previewUrl = httpsUrl(body.url);
  const observedAt = exactIsoFromEpoch(body.ready);
  const gitSource = body.gitSource;
  if (
    body.readyState !== "READY" ||
    body.id !== expectedDeploymentId ||
    body.projectId !== expectedProjectId ||
    !isRecord(gitSource) ||
    gitSource.sha !== expectedSourceRevision ||
    previewUrl === undefined ||
    observedAt === undefined
  ) {
    return { success: false, code: "MALFORMED_RESPONSE" };
  }
  return {
    success: true,
    value: Object.freeze({
      id: expectedDeploymentId,
      projectId: expectedProjectId,
      previewUrl,
      sourceRevision: expectedSourceRevision,
      observedAt,
    }),
  };
}

function parseDomain(
  response: VercelHttpResponse,
  expectedProjectId: string,
  expectedHostname: string,
): Parsed<{ readonly verified: boolean }> {
  const body = response.body;
  if (
    !isRecord(body) ||
    body.name !== expectedHostname ||
    body.projectId !== expectedProjectId ||
    typeof body.verified !== "boolean"
  ) {
    return { success: false, code: "MALFORMED_RESPONSE" };
  }
  return {
    success: true,
    value: Object.freeze({ verified: body.verified }),
  };
}

function inspectionFailure(
  code: VercelInspectionErrorCode,
  message: string,
  retryable: boolean,
): VercelInspectionResult {
  return Object.freeze({
    success: false,
    error: Object.freeze({ code, message, retryable }),
  });
}

function inspectionHttpFailure(
  code: HttpFailureKind,
  target: "project" | "deployment" | "domain",
): VercelInspectionResult {
  switch (code) {
    case "NOT_FOUND":
      return inspectionFailure(
        "INSPECTION_TARGET_NOT_FOUND",
        `Vercel ${target} was not found`,
        false,
      );
    case "RATE_LIMITED":
      return inspectionFailure(
        "INSPECTION_PROVIDER_RATE_LIMITED",
        "Vercel inspection was rate limited",
        true,
      );
    case "TIMEOUT":
      return inspectionFailure(
        "INSPECTION_PROVIDER_TIMEOUT",
        "Vercel inspection timed out",
        true,
      );
    case "UNAVAILABLE":
      return inspectionFailure(
        "INSPECTION_PROVIDER_UNAVAILABLE",
        "Vercel inspection is unavailable",
        true,
      );
    case "MALFORMED_RESPONSE":
      return inspectionFailure(
        "MALFORMED_PROVIDER_RESPONSE",
        "Vercel returned an invalid inspection response",
        false,
      );
    case "CONFLICT":
    case "REJECTED":
      return inspectionFailure(
        "INSPECTION_PROVIDER_REJECTED",
        "Vercel rejected the inspection request",
        false,
      );
  }
}

function rollbackFailure(
  code: VercelRollbackErrorCode,
  message: string,
  retryable: boolean,
  attempts: number,
): VercelRollbackResult {
  return Object.freeze({
    success: false,
    error: Object.freeze({ code, message, retryable, attempts }),
  });
}

function rollbackCode(code: HttpFailureKind): VercelRollbackErrorCode {
  switch (code) {
    case "RATE_LIMITED":
      return "ROLLBACK_PROVIDER_RATE_LIMITED";
    case "TIMEOUT":
      return "ROLLBACK_PROVIDER_TIMEOUT";
    case "UNAVAILABLE":
      return "ROLLBACK_PROVIDER_UNAVAILABLE";
    case "MALFORMED_RESPONSE":
      return "MALFORMED_PROVIDER_RESPONSE";
    case "NOT_FOUND":
      return "ROLLBACK_TARGET_NOT_FOUND";
    case "CONFLICT":
    case "REJECTED":
      return "ROLLBACK_PROVIDER_REJECTED";
  }
}

function rollbackCodeFromInspection(
  code: VercelInspectionErrorCode,
): VercelRollbackErrorCode {
  switch (code) {
    case "INSPECTION_TARGET_NOT_FOUND":
      return "ROLLBACK_TARGET_NOT_FOUND";
    case "INSPECTION_PROVIDER_RATE_LIMITED":
      return "ROLLBACK_PROVIDER_RATE_LIMITED";
    case "INSPECTION_PROVIDER_TIMEOUT":
      return "ROLLBACK_PROVIDER_TIMEOUT";
    case "INSPECTION_PROVIDER_UNAVAILABLE":
      return "ROLLBACK_PROVIDER_UNAVAILABLE";
    case "MALFORMED_PROVIDER_RESPONSE":
      return "MALFORMED_PROVIDER_RESPONSE";
    case "INVALID_INSPECTION_TARGET":
      return "INVALID_ROLLBACK_TARGET";
    case "INSPECTION_PROVIDER_REJECTED":
      return "ROLLBACK_PROVIDER_REJECTED";
  }
}

function rollbackMessage(code: VercelRollbackErrorCode): string {
  switch (code) {
    case "ROLLBACK_TARGET_NOT_FOUND":
      return "Rollback target was not found";
    case "ROLLBACK_PROVIDER_RATE_LIMITED":
      return "Vercel rollback was rate limited";
    case "ROLLBACK_PROVIDER_TIMEOUT":
      return "Vercel rollback timed out";
    case "ROLLBACK_PROVIDER_UNAVAILABLE":
      return "Vercel rollback is unavailable";
    case "MALFORMED_PROVIDER_RESPONSE":
      return "Vercel returned an invalid rollback response";
    case "INVALID_ROLLBACK_OPTIONS":
      return "Rollback options are invalid";
    case "INVALID_ROLLBACK_TARGET":
      return "Rollback target is invalid";
    case "ROLLBACK_DOMAIN_NOT_READY":
      return "Rollback domains are not ready";
    case "ROLLBACK_PROVIDER_REJECTED":
      return "Vercel rejected the rollback request";
  }
}
