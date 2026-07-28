import type {
  DeploymentProvider,
  DeploymentProviderFailureCode,
  DeploymentProviderRequest,
  DeploymentProviderResult,
} from "./provider-boundary.js";

export interface DeterministicFakeVercelOptions {
  readonly observedAt: string;
  readonly failuresBeforeSuccess?: number;
  readonly failureCode?: DeploymentProviderFailureCode;
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
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

function providerFailure(
  code: DeploymentProviderFailureCode,
): DeploymentProviderResult {
  return Object.freeze({
    success: false,
    error: Object.freeze({ code }),
  });
}

function providerSuccess(
  request: DeploymentProviderRequest,
  observedAt: string,
): DeploymentProviderResult {
  const projectHash = stableHash(request.projectIdentity);
  const deploymentHash = stableHash(request.idempotencyKey);

  return Object.freeze({
    success: true,
    observation: Object.freeze({
      providerName: "FAKE_VERCEL",
      projectIdentity: request.projectIdentity,
      idempotencyKey: request.idempotencyKey,
      providerProjectId: `fake-project-${projectHash}`,
      providerDeploymentId: `fake-deployment-${deploymentHash}`,
      previewUrl:
        `https://preview-${deploymentHash}.fake-vercel.invalid`,
      buildId: `fake-build-${deploymentHash}`,
      sourceRevision: request.requestedProvenance.sourceRevision,
      observedAt,
    }),
  });
}

/**
 * In-memory adapter for deterministic deployment tests. It performs no network,
 * credential, filesystem, DNS, or Vercel API access.
 */
export class DeterministicFakeVercelAdapter
  implements DeploymentProvider
{
  readonly providerName = "FAKE_VERCEL";

  readonly #observedAt: string;
  readonly #failuresBeforeSuccess: number;
  readonly #failureCode: DeploymentProviderFailureCode;
  readonly #attemptsByKey = new Map<string, number>();
  readonly #fingerprintsByKey = new Map<string, string>();
  readonly #successfulResults = new Map<
    string,
    DeploymentProviderResult
  >();
  readonly #receivedIdempotencyKeys: string[] = [];

  constructor(options: DeterministicFakeVercelOptions) {
    const failuresBeforeSuccess = options.failuresBeforeSuccess ?? 0;
    if (
      !Number.isInteger(failuresBeforeSuccess) ||
      failuresBeforeSuccess < 0
    ) {
      throw new RangeError(
        "failuresBeforeSuccess must be a non-negative integer",
      );
    }

    this.#observedAt = options.observedAt;
    this.#failuresBeforeSuccess = failuresBeforeSuccess;
    this.#failureCode = options.failureCode ?? "UNAVAILABLE";
  }

  get createdDeploymentCount(): number {
    return this.#successfulResults.size;
  }

  get receivedIdempotencyKeys(): readonly string[] {
    return Object.freeze([...this.#receivedIdempotencyKeys]);
  }

  async deploy(
    request: DeploymentProviderRequest,
  ): Promise<DeploymentProviderResult> {
    this.#receivedIdempotencyKeys.push(request.idempotencyKey);

    const fingerprint = requestFingerprint(request);
    const existingFingerprint = this.#fingerprintsByKey.get(
      request.idempotencyKey,
    );
    if (
      existingFingerprint !== undefined &&
      existingFingerprint !== fingerprint
    ) {
      return providerFailure("IDEMPOTENCY_CONFLICT");
    }
    this.#fingerprintsByKey.set(request.idempotencyKey, fingerprint);

    const existingResult = this.#successfulResults.get(
      request.idempotencyKey,
    );
    if (existingResult !== undefined) {
      return existingResult;
    }

    const attemptCount =
      (this.#attemptsByKey.get(request.idempotencyKey) ?? 0) + 1;
    this.#attemptsByKey.set(request.idempotencyKey, attemptCount);
    if (attemptCount <= this.#failuresBeforeSuccess) {
      return providerFailure(this.#failureCode);
    }

    const result = providerSuccess(request, this.#observedAt);
    this.#successfulResults.set(request.idempotencyKey, result);
    return result;
  }
}
