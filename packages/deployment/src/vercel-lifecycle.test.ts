import { describe, expect, it } from "vitest";

import {
  VercelDeploymentAdapter,
  createDeploymentIntent,
  planVercelDeployment,
} from "./index.js";
import type {
  DeploymentIntent,
  DeploymentProviderObservation,
  VercelHttpRequest,
  VercelHttpResponse,
  VercelHttpTransport,
  VercelLifecycleEvent,
} from "./index.js";

interface IntentOverrides {
  readonly clientId?: string;
  readonly deploymentId?: string;
  readonly configurationId?: string;
  readonly hostname?: string;
  readonly sourceRevision?: string;
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
        businessName: "Managed Website",
        locationIds: ["location_melbourne"],
      },
      domains: [{
        hostname: overrides.hostname ?? "acme.example",
        canonical: true,
      }],
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
    },
    requestedProvenance: {
      applicationVersion: "2.0.0",
      templateVersion: "contractor@3.0.0",
      sourceRevision:
        overrides.sourceRevision ?? "0123456789abcdef0123456789abcdef",
    },
  });

  if (!result.success) {
    throw new Error("Expected lifecycle intent fixture to be valid");
  }
  return result.data;
}

interface FixtureOptions {
  readonly projectExists?: boolean;
  readonly domainAlreadyAttached?: boolean;
  readonly domainPending?: boolean;
  readonly domainConflict?: boolean;
  readonly deploymentRejected?: boolean;
  readonly deploymentConflict?: boolean;
  readonly rollbackRejected?: boolean;
  readonly malformedOperation?: VercelHttpRequest["operation"];
  readonly transientOperation?: VercelHttpRequest["operation"];
  readonly transientFailures?: number;
}

class DeterministicVercelHttpFixture implements VercelHttpTransport {
  readonly requests: VercelHttpRequest[] = [];
  readonly mutationCounts = new Map<string, number>();
  rollbackTargetMissing = false;

  readonly #options: FixtureOptions;
  readonly #projects = new Map<string, { id: string; name: string }>();
  readonly #deployments = new Map<
    string,
    {
      id: string;
      projectId: string;
      sourceRevision: string;
      url: string;
    }
  >();
  readonly #domains = new Map<string, boolean>();
  #transientFailures = 0;

  constructor(options: FixtureOptions = {}) {
    this.#options = options;
  }

  count(operation: VercelHttpRequest["operation"]): number {
    return this.requests.filter((request) => request.operation === operation)
      .length;
  }

  async request(request: VercelHttpRequest): Promise<VercelHttpResponse> {
    this.requests.push(
      JSON.parse(JSON.stringify(request)) as VercelHttpRequest,
    );

    if (
      this.#options.transientOperation === request.operation &&
      this.#transientFailures < (this.#options.transientFailures ?? 1)
    ) {
      this.#transientFailures += 1;
      return { status: 503, body: { error: { code: "unavailable" } } };
    }
    if (this.#options.malformedOperation === request.operation) {
      return { status: 200, body: { unexpected: true } };
    }

    switch (request.operation) {
      case "GET_PROJECT":
        return this.#getProject(request);
      case "CREATE_PROJECT":
        return this.#createProject(request);
      case "CREATE_DEPLOYMENT":
        return this.#createDeployment(request);
      case "GET_DEPLOYMENT":
        return this.#getDeployment(request);
      case "GET_PROJECT_DOMAIN":
        return this.#getDomain(request);
      case "ADD_PROJECT_DOMAIN":
        return this.#addDomain(request);
      case "REQUEST_ROLLBACK":
        return this.#rollback(request);
    }
  }

  #increment(operation: VercelHttpRequest["operation"]): void {
    this.mutationCounts.set(
      operation,
      (this.mutationCounts.get(operation) ?? 0) + 1,
    );
  }

  #projectName(request: VercelHttpRequest): string {
    const encoded = request.path.split("/").at(-1);
    if (encoded === undefined) {
      throw new Error("Missing project name in fixture request");
    }
    return decodeURIComponent(encoded);
  }

  #getProject(request: VercelHttpRequest): VercelHttpResponse {
    const name = this.#projectName(request);
    let project = this.#projects.get(name);
    if (
      project === undefined &&
      this.#options.projectExists === true
    ) {
      project = { id: `prj_${stableHash(name)}`, name };
      this.#projects.set(name, project);
    }
    return project === undefined
      ? { status: 404, body: { error: { code: "not_found" } } }
      : { status: 200, body: project };
  }

  #createProject(request: VercelHttpRequest): VercelHttpResponse {
    this.#increment(request.operation);
    const body = request.body as { readonly name: string };
    const project = {
      id: `prj_${stableHash(body.name)}`,
      name: body.name,
    };
    this.#projects.set(body.name, project);
    return { status: 200, body: project };
  }

  #createDeployment(request: VercelHttpRequest): VercelHttpResponse {
    this.#increment(request.operation);
    if (this.#options.deploymentRejected === true) {
      return { status: 400, body: { error: { code: "invalid_request" } } };
    }
    if (this.#options.deploymentConflict === true) {
      return { status: 409, body: { error: { code: "conflict" } } };
    }

    const body = request.body as {
      readonly project: string;
      readonly gitSource: { readonly sha: string };
      readonly meta: { readonly mlgoIdempotencyKey: string };
    };
    const id = `dpl_${body.meta.mlgoIdempotencyKey}`;
    const deployment = {
      id,
      projectId: body.project,
      sourceRevision: body.gitSource.sha,
      url: `${id}.vercel.app`,
    };
    this.#deployments.set(id, deployment);
    return { status: 200, body: { id, readyState: "QUEUED" } };
  }

  #getDeployment(request: VercelHttpRequest): VercelHttpResponse {
    if (this.rollbackTargetMissing) {
      return { status: 404, body: { error: { code: "not_found" } } };
    }
    const id = decodeURIComponent(request.path.split("/").at(-1) ?? "");
    const deployment = this.#deployments.get(id);
    if (deployment === undefined) {
      return { status: 404, body: { error: { code: "not_found" } } };
    }
    return {
      status: 200,
      body: {
        id: deployment.id,
        projectId: deployment.projectId,
        url: deployment.url,
        readyState: "READY",
        ready: 1_785_307_200_000,
        gitSource: { sha: deployment.sourceRevision },
      },
    };
  }

  #domainKey(projectId: string, hostname: string): string {
    return `${projectId}:${hostname}`;
  }

  #domainPath(request: VercelHttpRequest): {
    readonly projectId: string;
    readonly hostname: string;
  } {
    const parts = request.path.split("/");
    return {
      projectId: decodeURIComponent(parts.at(-3) ?? ""),
      hostname: decodeURIComponent(parts.at(-1) ?? ""),
    };
  }

  #getDomain(request: VercelHttpRequest): VercelHttpResponse {
    const { projectId, hostname } = this.#domainPath(request);
    const key = this.#domainKey(projectId, hostname);
    if (
      !this.#domains.has(key) &&
      this.#options.domainAlreadyAttached !== true
    ) {
      return { status: 404, body: { error: { code: "not_found" } } };
    }
    const verified = this.#domains.get(key) ??
      !this.#options.domainPending;
    this.#domains.set(key, verified);
    return {
      status: 200,
      body: { name: hostname, projectId, verified },
    };
  }

  #addDomain(request: VercelHttpRequest): VercelHttpResponse {
    this.#increment(request.operation);
    if (this.#options.domainConflict === true) {
      return {
        status: 409,
        body: { error: { code: "domain_already_in_use" } },
      };
    }
    const projectId = decodeURIComponent(request.path.split("/").at(-2) ?? "");
    const body = request.body as { readonly name: string };
    const verified = !this.#options.domainPending;
    this.#domains.set(this.#domainKey(projectId, body.name), verified);
    return {
      status: 200,
      body: { name: body.name, projectId, verified },
    };
  }

  #rollback(request: VercelHttpRequest): VercelHttpResponse {
    this.#increment(request.operation);
    return this.#options.rollbackRejected === true
      ? { status: 403, body: { error: { code: "forbidden" } } }
      : { status: 201, body: null };
  }
}

function stableHash(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeAdapter(
  transport: VercelHttpTransport,
  events: VercelLifecycleEvent[] = [],
): VercelDeploymentAdapter {
  return new VercelDeploymentAdapter({
    transport,
    teamId: "team_fixture",
    gitSource: {
      type: "github",
      org: "agency",
      repo: "managed-web",
      ref: "main",
    },
    logger: { log: (event) => events.push(event) },
  });
}

function expectObservation(
  result: Awaited<ReturnType<VercelDeploymentAdapter["apply"]>>,
): DeploymentProviderObservation {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected Vercel lifecycle apply to succeed");
  }
  return result.providerObservation;
}

describe("Vercel deployment planning", () => {
  it("returns a deterministic secret-free plan without side effects or DNS mutation", () => {
    const intent = makeIntent();
    const transport = new DeterministicVercelHttpFixture();

    const first = planVercelDeployment(intent, { teamId: "team_fixture" });
    const second = planVercelDeployment(intent, { teamId: "team_fixture" });

    expect(first).toEqual(second);
    expect(first.projectIdentity).toBe(intent.projectIdentity);
    expect(first.actions.map((action) => action.operation)).toEqual([
      "GET_PROJECT",
      "CREATE_PROJECT",
      "CREATE_DEPLOYMENT",
      "GET_DEPLOYMENT",
      "GET_PROJECT_DOMAIN",
      "ADD_PROJECT_DOMAIN",
      "GET_PROJECT_DOMAIN",
    ]);
    expect(first.actions.some((action) => action.path.includes("/dns"))).toBe(
      false,
    );
    expect(transport.requests).toHaveLength(0);
  });
});

describe("Vercel apply lifecycle", () => {
  it("reuses an existing isolated project", async () => {
    const transport = new DeterministicVercelHttpFixture({
      projectExists: true,
    });
    const result = await makeAdapter(transport).apply(makeIntent());

    expect(result.success).toBe(true);
    expect(transport.count("CREATE_PROJECT")).toBe(0);
    expect(transport.count("CREATE_DEPLOYMENT")).toBe(1);
  });

  it("creates a missing project before deploying", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const result = await makeAdapter(transport).apply(makeIntent());

    expect(result.success).toBe(true);
    expect(transport.count("CREATE_PROJECT")).toBe(1);
    expect(transport.count("CREATE_DEPLOYMENT")).toBe(1);
  });

  it("creates a manifest only after a READY deployment and attached domain", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const result = await makeAdapter(transport).apply(makeIntent());
    const observation = expectObservation(result);

    expect(observation).toMatchObject({
      providerName: "VERCEL",
      sourceRevision: "0123456789abcdef0123456789abcdef",
      domainObservations: [
        { hostname: "acme.example", status: "ATTACHED" },
      ],
    });
    expect(result).toMatchObject({
      success: true,
      manifest: {
        buildProvenance: {
          buildId: observation.providerDeploymentId,
          sourceRevision: observation.sourceRevision,
          generatedAt: "2026-07-29T06:40:00.000Z",
        },
      },
    });
    expect(transport.count("GET_DEPLOYMENT")).toBeGreaterThan(0);
    expect(transport.count("GET_PROJECT_DOMAIN")).toBeGreaterThan(0);
  });

  it("retries a transient provider failure without duplicating mutations", async () => {
    const transport = new DeterministicVercelHttpFixture({
      transientOperation: "GET_PROJECT",
      transientFailures: 1,
    });
    const result = await makeAdapter(transport).apply(makeIntent(), {
      maxAttempts: 2,
    });

    expect(result).toMatchObject({ success: true, attempts: 2 });
    expect(transport.count("CREATE_PROJECT")).toBe(1);
    expect(transport.count("CREATE_DEPLOYMENT")).toBe(1);
  });

  it.each(["GET_DEPLOYMENT", "GET_PROJECT_DOMAIN"] as const)(
    "retries transient %s after mutation without duplicating writes",
    async (operation) => {
      const transport = new DeterministicVercelHttpFixture({
        transientOperation: operation,
        transientFailures: 1,
      });
      const result = await makeAdapter(transport).apply(makeIntent(), {
        maxAttempts: 2,
      });

      expect(result).toMatchObject({ success: true, attempts: 2 });
      expect(transport.count("CREATE_PROJECT")).toBe(1);
      expect(transport.count("CREATE_DEPLOYMENT")).toBe(1);
      expect(transport.count("ADD_PROJECT_DOMAIN")).toBe(1);
    },
  );

  it.each([
    {
      options: { deploymentRejected: true },
      code: "PROVIDER_REJECTED",
    },
    {
      options: { deploymentConflict: true },
      code: "IDEMPOTENCY_CONFLICT",
    },
    {
      options: { malformedOperation: "GET_PROJECT" as const },
      code: "MALFORMED_PROVIDER_RESPONSE",
    },
    {
      options: { malformedOperation: "CREATE_DEPLOYMENT" as const },
      code: "MALFORMED_PROVIDER_RESPONSE",
    },
    {
      options: { malformedOperation: "GET_DEPLOYMENT" as const },
      code: "MALFORMED_PROVIDER_RESPONSE",
    },
    {
      options: { malformedOperation: "GET_PROJECT_DOMAIN" as const },
      code: "MALFORMED_PROVIDER_RESPONSE",
    },
  ])("fails closed for $code", async ({ options, code }) => {
    const transport = new DeterministicVercelHttpFixture(options);
    const result = await makeAdapter(transport).apply(makeIntent(), {
      maxAttempts: 1,
    });

    expect(result).toMatchObject({ success: false, error: { code } });
    expect(result).not.toHaveProperty("manifest");
  });

  it("reuses one deployment for repeated and concurrent apply", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const adapter = makeAdapter(transport);
    const intent = makeIntent();

    const [first, second] = await Promise.all([
      adapter.apply(intent),
      adapter.apply(intent),
    ]);
    const third = await adapter.apply(intent);

    expect(first).toEqual(second);
    expect(second).toEqual(third);
    expect(transport.count("CREATE_PROJECT")).toBe(1);
    expect(transport.count("CREATE_DEPLOYMENT")).toBe(1);
    expect(transport.count("ADD_PROJECT_DOMAIN")).toBe(1);
  });

  it("isolates provider projects, deployments, and domains for two clients", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const adapter = makeAdapter(transport);
    const acme = makeIntent();
    const other = makeIntent({
      clientId: "client_other",
      deploymentId: "deployment_other",
      configurationId: "website_other",
      hostname: "other.example",
    });

    const [acmeResult, otherResult] = await Promise.all([
      adapter.apply(acme),
      adapter.apply(other),
    ]);
    const acmeObservation = expectObservation(acmeResult);
    const otherObservation = expectObservation(otherResult);

    expect(acmeObservation.providerProjectId).not.toBe(
      otherObservation.providerProjectId,
    );
    expect(acmeObservation.providerDeploymentId).not.toBe(
      otherObservation.providerDeploymentId,
    );
    expect(acmeObservation.domainObservations).toEqual([
      { hostname: "acme.example", status: "ATTACHED" },
    ]);
    expect(otherObservation.domainObservations).toEqual([
      { hostname: "other.example", status: "ATTACHED" },
    ]);
  });

  it("does not reattach an already attached domain", async () => {
    const transport = new DeterministicVercelHttpFixture({
      projectExists: true,
      domainAlreadyAttached: true,
    });

    const result = await makeAdapter(transport).apply(makeIntent());

    expect(result.success).toBe(true);
    expect(transport.count("ADD_PROJECT_DOMAIN")).toBe(0);
  });

  it.each([
    {
      options: { domainPending: true },
      code: "DOMAIN_PENDING_VERIFICATION",
    },
    {
      options: { domainConflict: true },
      code: "DOMAIN_CONFLICT",
    },
  ])("fails closed for domain state $code", async ({ options, code }) => {
    const transport = new DeterministicVercelHttpFixture(options);
    const result = await makeAdapter(transport).apply(makeIntent(), {
      maxAttempts: 1,
    });

    expect(result).toMatchObject({ success: false, error: { code } });
    expect(result).not.toHaveProperty("manifest");
  });
});

describe("Vercel inspection and rollback", () => {
  it("returns validated domain inspection without changing DNS", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const adapter = makeAdapter(transport);
    const intent = makeIntent();
    const observation = expectObservation(await adapter.apply(intent));
    const mutationCountBefore = [...transport.mutationCounts.values()]
      .reduce((total, count) => total + count, 0);

    const result = await adapter.inspect(intent, observation);

    expect(result).toMatchObject({
      success: true,
      state: {
        deploymentStatus: "READY",
        domains: [{ hostname: "acme.example", status: "ATTACHED" }],
      },
    });
    expect(
      [...transport.mutationCounts.values()]
        .reduce((total, count) => total + count, 0),
    ).toBe(mutationCountBefore);
    expect(transport.requests.some((request) => request.path.includes("/dns")))
      .toBe(false);
  });

  it("rolls back to a previously observed valid deployment", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const adapter = makeAdapter(transport);
    const intent = makeIntent();
    const target = expectObservation(await adapter.apply(intent));

    const result = await adapter.rollback(intent, target);

    expect(result).toMatchObject({
      success: true,
      projectIdentity: intent.projectIdentity,
      providerDeploymentId: target.providerDeploymentId,
    });
    expect(transport.count("REQUEST_ROLLBACK")).toBe(1);
  });

  it("rejects a rollback target that cannot be found", async () => {
    const transport = new DeterministicVercelHttpFixture();
    const adapter = makeAdapter(transport);
    const intent = makeIntent();
    const target = expectObservation(await adapter.apply(intent));
    transport.rollbackTargetMissing = true;

    const result = await adapter.rollback(intent, target, { maxAttempts: 1 });

    expect(result).toMatchObject({
      success: false,
      error: { code: "ROLLBACK_TARGET_NOT_FOUND" },
    });
    expect(transport.count("REQUEST_ROLLBACK")).toBe(0);
  });

  it("normalizes rollback provider rejection", async () => {
    const transport = new DeterministicVercelHttpFixture({
      rollbackRejected: true,
    });
    const adapter = makeAdapter(transport);
    const intent = makeIntent();
    const target = expectObservation(await adapter.apply(intent));

    const result = await adapter.rollback(intent, target, { maxAttempts: 1 });

    expect(result).toMatchObject({
      success: false,
      error: {
        code: "ROLLBACK_PROVIDER_REJECTED",
        retryable: false,
      },
    });
  });

  it("retries transient rollback once and deduplicates concurrent rollback", async () => {
    const transport = new DeterministicVercelHttpFixture({
      transientOperation: "REQUEST_ROLLBACK",
      transientFailures: 1,
    });
    const adapter = makeAdapter(transport);
    const intent = makeIntent();
    const target = expectObservation(await adapter.apply(intent));

    const [first, second] = await Promise.all([
      adapter.rollback(intent, target, { maxAttempts: 2 }),
      adapter.rollback(intent, target, { maxAttempts: 2 }),
    ]);
    const repeated = await adapter.rollback(intent, target);

    expect(first).toEqual(second);
    expect(second).toEqual(repeated);
    expect(first).toMatchObject({ success: true, attempts: 2 });
    expect(transport.count("REQUEST_ROLLBACK")).toBe(2);
  });
});

describe("Vercel lifecycle security", () => {
  it("keeps transport failures, events, plans, and results secret-safe", async () => {
    const secret = "vercel-token-must-never-escape";
    const events: VercelLifecycleEvent[] = [];
    const transport: VercelHttpTransport = {
      request: async () => {
        throw new Error(`Authorization: Bearer ${secret}`);
      },
    };
    const adapter = makeAdapter(transport, events);
    const intent = makeIntent();
    const plan = adapter.plan(intent);

    const result = await adapter.apply(intent, { maxAttempts: 1 });

    expect(result).toMatchObject({
      success: false,
      error: { code: "PROVIDER_UNAVAILABLE" },
    });
    expect(JSON.stringify({ plan, result, events })).not.toContain(secret);
    expect(JSON.stringify(events)).not.toMatch(
      /authorization|credential|payload|token/i,
    );
    expect({
      plan: {
        providerName: plan.providerName,
        projectIdentity: plan.projectIdentity,
        operations: plan.actions.map((action) => action.operation),
        externalDnsMutation: plan.externalDnsMutation,
      },
      result,
      events,
    }).toMatchInlineSnapshot(`
      {
        "events": [],
        "plan": {
          "externalDnsMutation": false,
          "operations": [
            "GET_PROJECT",
            "CREATE_PROJECT",
            "CREATE_DEPLOYMENT",
            "GET_DEPLOYMENT",
            "GET_PROJECT_DOMAIN",
            "ADD_PROJECT_DOMAIN",
            "GET_PROJECT_DOMAIN",
          ],
          "projectIdentity": "client_acme:deployment_acme",
          "providerName": "VERCEL",
        },
        "result": {
          "error": {
            "attempts": 1,
            "code": "PROVIDER_UNAVAILABLE",
            "message": "Deployment provider is unavailable",
            "retryable": true,
          },
          "success": false,
        },
      }
    `);
  });

  it("drops unrecognized runtime source fields before transport mapping", async () => {
    const secret = "unrecognized-source-secret";
    const transport = new DeterministicVercelHttpFixture();
    const gitSource = {
      type: "github" as const,
      org: "agency",
      repo: "managed-web",
      ref: "main",
      token: secret,
    };
    const adapter = new VercelDeploymentAdapter({ transport, gitSource });

    const result = await adapter.apply(makeIntent());

    expect(result.success).toBe(true);
    expect(JSON.stringify(transport.requests)).not.toContain(secret);
    expect(JSON.stringify(transport.requests)).not.toMatch(
      /authorization|credential|password|token/i,
    );
  });
});
