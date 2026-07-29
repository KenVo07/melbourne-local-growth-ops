import { describe, expect, it } from "vitest";

import {
  DeterministicFakeVercelAdapter,
  createDeploymentIntent,
  executeDeployment,
} from "./index.js";
import type {
  DeploymentIntent,
  DeploymentLogEvent,
  DeploymentProvider,
  DeploymentProviderFailureCode,
  DeploymentProviderRequest,
  DeploymentProviderResult,
} from "./index.js";

interface IntentOverrides {
  readonly clientId?: string;
  readonly deploymentId?: string;
  readonly configurationId?: string;
  readonly hostname?: string;
  readonly handoff?: {
    readonly status: "PLANNED";
    readonly targetOwner: "CLIENT";
  };
}

function makeIntent(overrides: IntentOverrides = {}): DeploymentIntent {
  const clientId = overrides.clientId ?? "client_acme";
  const deploymentId = overrides.deploymentId ?? "deployment_acme";
  const configurationId = overrides.configurationId ?? "website_acme";
  const result = createDeploymentIntent({
    runtimeConfiguration: {
      schemaVersion: 1,
      configurationId,
      configurationVersion: 3,
      clientId,
      entitlementId: "entitlement_website",
      deploymentId,
      display: {
        businessName: "Shared Contractor Template",
        locationIds: ["location_melbourne"],
      },
      domains: [
        {
          hostname: overrides.hostname ?? "acme.example",
          canonical: true,
        },
      ],
      modules: [],
      connectors: [],
      configuredInfrastructure: [],
    },
    deploymentRecord: {
      schemaVersion: 1,
      deploymentId,
      clientId,
      websiteConfigurationId: configurationId,
      deliveryMode: "MANAGED_ISOLATED",
      operationalOwner: "AGENCY",
      hostingAccountOwner: "AGENCY",
      sourceRepositoryOwner: "AGENCY",
      domainOwner: "CLIENT",
      privateAgencyRepositoryDependency: true,
      secretReferences: [],
      ...(overrides.handoff === undefined
        ? {}
        : { handoff: overrides.handoff }),
    },
    requestedProvenance: {
      applicationVersion: "1.4.0",
      templateVersion: "contractor@2.1.0",
      sourceRevision: "0123456789abcdef",
    },
  });

  if (!result.success) {
    throw new Error("Expected deployment intent fixture to be valid");
  }
  return result.data;
}

const observedAt = "2026-07-28T12:00:00.000Z";

function providerRequestFromIntent(
  intent: DeploymentIntent,
  idempotencyKey: string,
): DeploymentProviderRequest {
  return {
    schemaVersion: 1,
    projectIdentity: intent.projectIdentity,
    clientId: intent.clientId,
    deploymentId: intent.deploymentId,
    configurationId: intent.configurationId,
    configurationVersion: intent.configurationVersion,
    deliveryMode: intent.deliveryMode,
    domains: intent.domains,
    requestedProvenance: intent.requestedProvenance,
    idempotencyKey,
    attempt: 1,
  };
}

describe("executeDeployment", () => {
  it("creates an observed manifest only after successful provider execution", async () => {
    const intent = makeIntent({
      handoff: { status: "PLANNED", targetOwner: "CLIENT" },
    });
    const provider = new DeterministicFakeVercelAdapter({ observedAt });

    const result = await executeDeployment(intent, provider);

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("Expected deployment execution to succeed");
    }
    expect(result.attempts).toBe(1);
    expect(result.projectIdentity).toBe(intent.projectIdentity);
    expect(result.providerObservation).toMatchObject({
      providerName: "FAKE_VERCEL",
      projectIdentity: intent.projectIdentity,
      sourceRevision: intent.requestedProvenance.sourceRevision,
      observedAt,
    });
    expect(result.manifest).toEqual({
      schemaVersion: 1,
      deploymentId: intent.deploymentId,
      clientId: intent.clientId,
      configurationId: intent.configurationId,
      configurationVersion: intent.configurationVersion,
      applicationVersion:
        intent.requestedProvenance.applicationVersion,
      deliveryMode: intent.deliveryMode,
      infrastructureOwnership: [],
      domains: intent.domains,
      buildProvenance: {
        buildId: result.providerObservation.buildId,
        sourceRevision: intent.requestedProvenance.sourceRevision,
        generatedAt: observedAt,
      },
      handoff: { status: "PLANNED", targetOwner: "CLIENT" },
    });
  });

  it("reuses one observed deployment for repeated and concurrent execution", async () => {
    const intent = makeIntent();
    const provider = new DeterministicFakeVercelAdapter({ observedAt });

    const [first, second] = await Promise.all([
      executeDeployment(intent, provider),
      executeDeployment(intent, provider),
    ]);
    const third = await executeDeployment(intent, provider);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(provider.createdDeploymentCount).toBe(1);
  });

  it("retries bounded transient failures with one stable idempotency key", async () => {
    const intent = makeIntent();
    const provider = new DeterministicFakeVercelAdapter({
      observedAt,
      failuresBeforeSuccess: 2,
      failureCode: "UNAVAILABLE",
    });
    const events: DeploymentLogEvent[] = [];

    const result = await executeDeployment(intent, provider, {
      maxAttempts: 3,
      logger: { log: (event) => events.push(event) },
    });

    expect(result).toMatchObject({ success: true, attempts: 3 });
    expect(provider.receivedIdempotencyKeys).toHaveLength(3);
    expect(new Set(provider.receivedIdempotencyKeys).size).toBe(1);
    expect(events.map((event) => event.type)).toEqual([
      "ATTEMPT_STARTED",
      "ATTEMPT_FAILED",
      "RETRY_SCHEDULED",
      "ATTEMPT_STARTED",
      "ATTEMPT_FAILED",
      "RETRY_SCHEDULED",
      "ATTEMPT_STARTED",
      "DEPLOYMENT_SUCCEEDED",
    ]);
  });

  it.each<{
    providerCode: DeploymentProviderFailureCode;
    expectedCode: string;
    retryable: boolean;
  }>([
    {
      providerCode: "RATE_LIMITED",
      expectedCode: "PROVIDER_RATE_LIMITED",
      retryable: true,
    },
    {
      providerCode: "TIMEOUT",
      expectedCode: "PROVIDER_TIMEOUT",
      retryable: true,
    },
    {
      providerCode: "UNAVAILABLE",
      expectedCode: "PROVIDER_UNAVAILABLE",
      retryable: true,
    },
    {
      providerCode: "REJECTED",
      expectedCode: "PROVIDER_REJECTED",
      retryable: false,
    },
    {
      providerCode: "IDEMPOTENCY_CONFLICT",
      expectedCode: "IDEMPOTENCY_CONFLICT",
      retryable: false,
    },
  ])(
    "normalizes $providerCode without exposing provider details",
    async ({ providerCode, expectedCode, retryable }) => {
      const provider = new DeterministicFakeVercelAdapter({
        observedAt,
        failuresBeforeSuccess: 10,
        failureCode: providerCode,
      });

      const result = await executeDeployment(makeIntent(), provider, {
        maxAttempts: 1,
      });

      expect(result).toMatchObject({
        success: false,
        error: {
          code: expectedCode,
          retryable,
          attempts: 1,
        },
      });
      expect(result).not.toHaveProperty("manifest");
    },
  );

  it("stops after the configured retry bound", async () => {
    const provider = new DeterministicFakeVercelAdapter({
      observedAt,
      failuresBeforeSuccess: 3,
      failureCode: "TIMEOUT",
    });

    const result = await executeDeployment(makeIntent(), provider, {
      maxAttempts: 2,
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "PROVIDER_TIMEOUT",
        retryable: true,
        attempts: 2,
      },
    });
    expect(provider.createdDeploymentCount).toBe(0);
  });

  it("rejects an invalid retry bound before calling the provider", async () => {
    const provider = new DeterministicFakeVercelAdapter({ observedAt });

    const result = await executeDeployment(makeIntent(), provider, {
      maxAttempts: 0,
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: "INVALID_EXECUTION_OPTIONS",
        message: "maxAttempts must be an integer between 1 and 5",
        retryable: false,
        attempts: 0,
      },
    });
    expect(provider.receivedIdempotencyKeys).toHaveLength(0);
  });

  it("fails closed on malformed or mismatched provider success", async () => {
    const intent = makeIntent();
    const malformedProvider: DeploymentProvider = {
      providerName: "MALFORMED_PROVIDER",
      deploy: async (request): Promise<DeploymentProviderResult> =>
        ({
          success: true,
          observation: {
            providerName: "MALFORMED_PROVIDER",
            projectIdentity: "client_other:deployment_other",
            idempotencyKey: request.idempotencyKey,
            providerProjectId: "project-1",
            providerDeploymentId: "deployment-1",
            previewUrl: "http://unsafe.example",
            buildId: "",
            sourceRevision: "wrong-revision",
            observedAt: "not-a-timestamp",
          },
        }) as DeploymentProviderResult,
    };

    const result = await executeDeployment(intent, malformedProvider);

    expect(result).toEqual({
      success: false,
      error: {
        code: "MALFORMED_PROVIDER_RESPONSE",
        message: "Deployment provider returned an invalid response",
        retryable: false,
        attempts: 1,
      },
    });
    expect(result).not.toHaveProperty("manifest");
  });

  it("does not expose thrown provider errors or secret values in logs", async () => {
    const secretValue = "provider-token-must-stay-secret";
    const events: DeploymentLogEvent[] = [];
    const provider: DeploymentProvider = {
      providerName: "THROWING_PROVIDER",
      deploy: async (_request: DeploymentProviderRequest) => {
        throw new Error(`Provider failed with ${secretValue}`);
      },
    };

    const result = await executeDeployment(makeIntent(), provider, {
      maxAttempts: 1,
      logger: { log: (event) => events.push(event) },
    });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "PROVIDER_UNAVAILABLE",
        retryable: true,
        attempts: 1,
      },
    });
    expect(JSON.stringify({ result, events })).not.toContain(secretValue);
  });

  it("isolates logger failures from an observed provider success", async () => {
    const provider = new DeterministicFakeVercelAdapter({ observedAt });

    const result = await executeDeployment(makeIntent(), provider, {
      logger: {
        log: () => {
          throw new Error("logger unavailable");
        },
      },
    });

    expect(result.success).toBe(true);
    expect(provider.createdDeploymentCount).toBe(1);
  });

  it("isolates provider resources and observed state across clients", async () => {
    const acme = makeIntent();
    const other = makeIntent({
      clientId: "client_other",
      deploymentId: "deployment_other",
      configurationId: "website_other",
      hostname: "other.example",
    });
    const provider = new DeterministicFakeVercelAdapter({ observedAt });

    const [acmeResult, otherResult] = await Promise.all([
      executeDeployment(acme, provider),
      executeDeployment(other, provider),
    ]);

    expect(acmeResult.success).toBe(true);
    expect(otherResult.success).toBe(true);
    if (!acmeResult.success || !otherResult.success) {
      throw new Error("Expected both isolated deployments to succeed");
    }
    expect(acmeResult.manifest.clientId).toBe("client_acme");
    expect(otherResult.manifest.clientId).toBe("client_other");
    expect(
      acmeResult.providerObservation.providerProjectId,
    ).not.toBe(otherResult.providerObservation.providerProjectId);
    expect(
      acmeResult.providerObservation.providerDeploymentId,
    ).not.toBe(otherResult.providerObservation.providerDeploymentId);
    expect(provider.createdDeploymentCount).toBe(2);
  });
});

describe("DeterministicFakeVercelAdapter", () => {
  it("rejects conflicting requests that reuse an idempotency key", async () => {
    const provider = new DeterministicFakeVercelAdapter({ observedAt });
    const acme = makeIntent();
    const other = makeIntent({
      clientId: "client_other",
      deploymentId: "deployment_other",
      configurationId: "website_other",
      hostname: "other.example",
    });

    const first = await provider.deploy(
      providerRequestFromIntent(acme, "shared-idempotency-key"),
    );
    const conflict = await provider.deploy(
      providerRequestFromIntent(other, "shared-idempotency-key"),
    );

    expect(first.success).toBe(true);
    expect(conflict).toEqual({
      success: false,
      error: { code: "IDEMPOTENCY_CONFLICT" },
    });
    expect(provider.createdDeploymentCount).toBe(1);
  });
});
