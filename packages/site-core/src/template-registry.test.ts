import { describe, expect, it, vi } from "vitest";

import {
  composeWebsite,
  composeWebsiteFromRegistry,
  createWebsiteTemplateRegistry,
  WebsiteTemplatePipelineError,
  type ValidatedWebsiteConfiguration,
  type WebsiteComposition,
  type WebsiteTemplate,
} from "./index.js";

interface ConfigurationFixtureOptions {
  readonly clientId: string;
  readonly moduleId: string;
}

function configurationFixture({
  clientId,
  moduleId,
}: ConfigurationFixtureOptions): unknown {
  return {
    schemaVersion: 1,
    configurationId: `configuration-${clientId}`,
    configurationVersion: 1,
    clientId,
    entitlementId: `entitlement-${clientId}`,
    deploymentId: `deployment-${clientId}`,
    display: {
      businessName: `Business ${clientId}`,
      locationIds: [`location-${clientId}`],
    },
    domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
    modules: [
      {
        schemaVersion: 1,
        moduleId,
        connectorId: `connector-${clientId}`,
        type: "BOOKING_CTA",
        label: "Book now",
      },
    ],
    connectors: [
      {
        schemaVersion: 1,
        connectorId: `connector-${clientId}`,
        accountOwner: "CLIENT",
        portability: "CLIENT_OWNED",
        type: "BOOKING_LINK",
        bookingUrl: `https://${clientId}.example.com.au/book`,
      },
    ],
    configuredInfrastructure: [],
  };
}

function compositionFor(
  templateId: string,
  templateVersion: string,
  regionId: string,
  configuration: ValidatedWebsiteConfiguration,
): WebsiteComposition {
  return {
    templateId,
    templateVersion,
    regions: [
      {
        regionId,
        moduleIds: configuration.modules.map(({ moduleId }) => moduleId),
      },
    ],
  };
}

function templateFixture(
  templateId: string,
  version: string,
  regionId = "main",
  compose = (
    configuration: ValidatedWebsiteConfiguration,
  ): WebsiteComposition =>
    compositionFor(templateId, version, regionId, configuration),
): WebsiteTemplate {
  return {
    templateId,
    version,
    compose,
  };
}

function capturePipelineError(
  operation: () => unknown,
): WebsiteTemplatePipelineError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(WebsiteTemplatePipelineError);
    return error as WebsiteTemplatePipelineError;
  }

  throw new Error("Expected a WebsiteTemplatePipelineError");
}

describe("WebsiteTemplateRegistry", () => {
  it("lists registrations deterministically regardless of input order", () => {
    const contractorV2 = templateFixture("contractor", "2.0.0");
    const restaurantV1 = templateFixture("restaurant", "1.0.0");
    const contractorV1 = templateFixture("contractor", "1.0.0");

    const forward = createWebsiteTemplateRegistry([
      contractorV2,
      restaurantV1,
      contractorV1,
    ]);
    const reverse = createWebsiteTemplateRegistry([
      contractorV1,
      restaurantV1,
      contractorV2,
    ]);

    const expectedRegistrations = [
      { templateId: "contractor", templateVersion: "1.0.0" },
      { templateId: "contractor", templateVersion: "2.0.0" },
      { templateId: "restaurant", templateVersion: "1.0.0" },
    ];
    expect(forward.registrations).toEqual(expectedRegistrations);
    expect(reverse.registrations).toEqual(expectedRegistrations);
  });

  it("resolves the exact stable template ID and requested version", () => {
    const contractorV1Compose = vi.fn<WebsiteTemplate["compose"]>(
      (configuration) =>
        compositionFor("contractor", "1.0.0", "legacy", configuration),
    );
    const contractorV2Compose = vi.fn<WebsiteTemplate["compose"]>(
      (configuration) =>
        compositionFor("contractor", "2.0.0", "current", configuration),
    );
    const registry = createWebsiteTemplateRegistry([
      templateFixture(
        "contractor",
        "1.0.0",
        "legacy",
        contractorV1Compose,
      ),
      templateFixture(
        "contractor",
        "2.0.0",
        "current",
        contractorV2Compose,
      ),
    ]);

    const result = composeWebsiteFromRegistry(
      configurationFixture({ clientId: "client-a", moduleId: "module-a" }),
      { templateId: "contractor", templateVersion: "2.0.0" },
      registry,
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        templateId: "contractor",
        templateVersion: "2.0.0",
        regions: [{ regionId: "current", moduleIds: ["module-a"] }],
      },
    });
    expect(contractorV1Compose).not.toHaveBeenCalled();
    expect(contractorV2Compose).toHaveBeenCalledOnce();
  });

  it("reports an unknown template ID without case or fallback matching", () => {
    const registry = createWebsiteTemplateRegistry([
      templateFixture("contractor", "1.0.0"),
    ]);

    const error = capturePipelineError(() =>
      composeWebsiteFromRegistry(
        configurationFixture({
          clientId: "client-a",
          moduleId: "module-a",
        }),
        {
          templateId: "Contractor",
          templateVersion: "1.0.0",
        },
        registry,
      ),
    );

    expect(error).toMatchObject({
      code: "UNKNOWN_TEMPLATE",
      templateId: "Contractor",
      templateVersion: "1.0.0",
      availableVersions: [],
    });
  });

  it("reports unsupported versions with deterministic available versions", () => {
    const registry = createWebsiteTemplateRegistry([
      templateFixture("contractor", "2.0.0"),
      templateFixture("contractor", "1.0.0"),
    ]);

    const error = capturePipelineError(() =>
      composeWebsiteFromRegistry(
        configurationFixture({
          clientId: "client-a",
          moduleId: "module-a",
        }),
        {
          templateId: "contractor",
          templateVersion: "3.0.0",
        },
        registry,
      ),
    );

    expect(error).toMatchObject({
      code: "UNSUPPORTED_TEMPLATE_VERSION",
      templateId: "contractor",
      templateVersion: "3.0.0",
      availableVersions: ["1.0.0", "2.0.0"],
    });
  });

  it("rejects duplicate template ID and version registrations", () => {
    const error = capturePipelineError(() =>
      createWebsiteTemplateRegistry([
        templateFixture("contractor", "1.0.0", "first"),
        templateFixture("contractor", "1.0.0", "second"),
      ]),
    );

    expect(error).toMatchObject({
      code: "DUPLICATE_TEMPLATE_REGISTRATION",
      templateId: "contractor",
      templateVersion: "1.0.0",
    });
  });
});

describe("template resolution and composition pipeline", () => {
  it("retains the existing validation boundary after template resolution", () => {
    const compose = vi.fn<WebsiteTemplate["compose"]>();
    const registry = createWebsiteTemplateRegistry([
      templateFixture("contractor", "1.0.0", "main", compose),
    ]);

    const result = composeWebsiteFromRegistry(
      { schemaVersion: 2 },
      { templateId: "contractor", templateVersion: "1.0.0" },
      registry,
    );

    expect(result.success).toBe(false);
    expect(compose).not.toHaveBeenCalled();
  });

  it("rejects composition provenance that differs from the template", () => {
    const template = templateFixture(
      "contractor",
      "1.0.0",
      "main",
      (configuration) =>
        compositionFor("restaurant", "9.0.0", "main", configuration),
    );

    const error = capturePipelineError(() =>
      composeWebsite(
        configurationFixture({
          clientId: "client-a",
          moduleId: "module-a",
        }),
        template,
      ),
    );

    expect(error).toMatchObject({
      code: "TEMPLATE_PROVENANCE_MISMATCH",
      templateId: "contractor",
      templateVersion: "1.0.0",
      actualTemplateId: "restaurant",
      actualTemplateVersion: "9.0.0",
    });
  });

  it("keeps concurrent clients isolated through one shared registry", async () => {
    const registry = createWebsiteTemplateRegistry([
      templateFixture("contractor", "1.0.0"),
    ]);
    const reference = {
      templateId: "contractor",
      templateVersion: "1.0.0",
    } as const;

    const [resultA, resultB] = await Promise.all([
      Promise.resolve().then(() =>
        composeWebsiteFromRegistry(
          configurationFixture({
            clientId: "client-a",
            moduleId: "module-a",
          }),
          reference,
          registry,
        ),
      ),
      Promise.resolve().then(() =>
        composeWebsiteFromRegistry(
          configurationFixture({
            clientId: "client-b",
            moduleId: "module-b",
          }),
          reference,
          registry,
        ),
      ),
    ]);

    expect(resultA).toMatchObject({
      success: true,
      data: { regions: [{ moduleIds: ["module-a"] }] },
    });
    expect(resultB).toMatchObject({
      success: true,
      data: { regions: [{ moduleIds: ["module-b"] }] },
    });
  });
});
