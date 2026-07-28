import { describe, expect, it } from "vitest";

import { createDeploymentIntent } from "./index.js";

interface FixtureOverrides {
  readonly clientId?: string;
  readonly deploymentId?: string;
  readonly configurationId?: string;
  readonly hostname?: string;
}

function makeInput(overrides: FixtureOverrides = {}) {
  const clientId = overrides.clientId ?? "client_acme";
  const deploymentId = overrides.deploymentId ?? "deployment_acme";
  const configurationId = overrides.configurationId ?? "website_acme";

  return {
    runtimeConfiguration: {
      schemaVersion: 1,
      configurationId,
      configurationVersion: 3,
      clientId,
      entitlementId: "entitlement_website",
      deploymentId,
      display: {
        businessName: "Acme Plumbing",
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
    },
    requestedProvenance: {
      applicationVersion: "1.4.0",
      templateVersion: "contractor@2.1.0",
      sourceRevision: "0123456789abcdef",
    },
  };
}

function expectSuccess(
  result: ReturnType<typeof createDeploymentIntent>,
) {
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected deployment intent generation to succeed");
  }
  return result.data;
}

describe("createDeploymentIntent", () => {
  it("returns the same intent for the same caller-provided input", () => {
    const input = makeInput();

    const first = expectSuccess(createDeploymentIntent(input));
    const second = expectSuccess(createDeploymentIntent(input));

    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first).toMatchObject({
      projectIdentity: "client_acme:deployment_acme",
      requestedProvenance: input.requestedProvenance,
    });
    expect(first).not.toHaveProperty("buildProvenance");
    expect(first).not.toHaveProperty("deploymentManifest");
  });

  it("does not mutate or retain mutable state from its input", () => {
    const input = makeInput();
    const before = JSON.stringify(input);

    const first = expectSuccess(createDeploymentIntent(input));
    const second = expectSuccess(createDeploymentIntent(input));

    expect(JSON.stringify(input)).toBe(before);
    expect(first).not.toBe(second);
    expect(first.domains).not.toBe(second.domains);
    expect(first.requestedProvenance).not.toBe(
      second.requestedProvenance,
    );
  });

  it("creates separate project identities for clients using the same application version", () => {
    const acme = expectSuccess(
      createDeploymentIntent(
        makeInput({
          clientId: "client_acme",
          deploymentId: "deployment_acme",
          configurationId: "website_acme",
        }),
      ),
    );
    const other = expectSuccess(
      createDeploymentIntent(
        makeInput({
          clientId: "client_other",
          deploymentId: "deployment_other",
          configurationId: "website_other",
          hostname: "other.example",
        }),
      ),
    );

    expect(acme.requestedProvenance.applicationVersion).toBe(
      other.requestedProvenance.applicationVersion,
    );
    expect(acme.projectIdentity).not.toBe(other.projectIdentity);
  });

  it("rejects mismatched client and deployment identities", () => {
    const input = makeInput();
    input.deploymentRecord.clientId = "client_other";
    input.deploymentRecord.deploymentId = "deployment_other";

    const result = createDeploymentIntent(input);

    expect(result).toMatchObject({
      success: false,
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "REFERENCE_NOT_FOUND",
          path: ["deploymentRecord", "clientId"],
        }),
        expect.objectContaining({
          code: "REFERENCE_NOT_FOUND",
          path: ["deploymentRecord", "deploymentId"],
        }),
      ]),
    });
  });

  it("returns stable issues for unsupported and invalid input", () => {
    const unsupported = makeInput();
    unsupported.runtimeConfiguration.schemaVersion = 2;

    expect(createDeploymentIntent(unsupported)).toMatchObject({
      success: false,
      issues: [
        expect.objectContaining({
          code: "UNSUPPORTED_SCHEMA_VERSION",
          path: ["runtimeConfiguration", "schemaVersion"],
        }),
      ],
    });
    expect(createDeploymentIntent(undefined)).toEqual({
      success: false,
      issues: [
        {
          code: "INVALID_TYPE",
          path: [],
          message: "Deployment intent input must be an object",
        },
      ],
    });
  });

  it("never includes secret values in an intent or validation error", () => {
    const valid = expectSuccess(createDeploymentIntent(makeInput()));
    const invalid = makeInput() as ReturnType<typeof makeInput> & {
      deploymentRecord: ReturnType<
        typeof makeInput
      >["deploymentRecord"] & { secretValue: string };
    };
    invalid.deploymentRecord.secretValue =
      "must-never-appear-in-output-or-errors";

    const failure = createDeploymentIntent(invalid);

    expect(JSON.stringify(valid)).not.toContain("secretValue");
    expect(JSON.stringify(failure)).not.toContain(
      "must-never-appear-in-output-or-errors",
    );
  });
});
