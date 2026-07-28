import { describe, expect, it, vi } from "vitest";

import {
  composeWebsite,
  type ValidatedWebsiteConfiguration,
  type WebsiteComposition,
  type WebsiteTemplate,
} from "./index.js";

interface ConfigurationFixtureOptions {
  readonly clientId: string;
  readonly configurationId: string;
  readonly deploymentId: string;
  readonly moduleId: string;
}

function configurationFixture({
  clientId,
  configurationId,
  deploymentId,
  moduleId,
}: ConfigurationFixtureOptions): unknown {
  return {
    schemaVersion: 1,
    configurationId,
    configurationVersion: 1,
    clientId,
    entitlementId: `entitlement-${clientId}`,
    deploymentId,
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
  configuration: ValidatedWebsiteConfiguration,
): WebsiteComposition {
  return {
    templateId: "contractor",
    templateVersion: "1.0.0",
    regions: [
      {
        regionId: "main",
        moduleIds: configuration.modules.map(({ moduleId }) => moduleId),
      },
    ],
  };
}

function template(
  compose: WebsiteTemplate["compose"] = compositionFor,
): WebsiteTemplate {
  return {
    templateId: "contractor",
    version: "1.0.0",
    compose,
  };
}

describe("composeWebsite", () => {
  it("does not call the template for invalid configuration", () => {
    const compose = vi.fn<WebsiteTemplate["compose"]>(compositionFor);

    const result = composeWebsite({ schemaVersion: 2 }, template(compose));

    expect(result.success).toBe(false);
    expect(compose).not.toHaveBeenCalled();
  });

  it("does not mutate the input configuration", () => {
    const input = configurationFixture({
      clientId: "client-a",
      configurationId: "configuration-a",
      deploymentId: "deployment-a",
      moduleId: "module-a",
    });
    const inputBeforeComposition = JSON.stringify(input);
    const compose = vi.fn<WebsiteTemplate["compose"]>((configuration) => {
      expect(configuration).not.toBe(input);
      return compositionFor(configuration);
    });

    const result = composeWebsite(input, template(compose));

    expect(result.success).toBe(true);
    expect(JSON.stringify(input)).toBe(inputBeforeComposition);
  });

  it("keeps concurrent client compositions independent", async () => {
    const clientA = configurationFixture({
      clientId: "client-a",
      configurationId: "configuration-a",
      deploymentId: "deployment-a",
      moduleId: "module-a",
    });
    const clientB = configurationFixture({
      clientId: "client-b",
      configurationId: "configuration-b",
      deploymentId: "deployment-b",
      moduleId: "module-b",
    });
    const sharedTemplate = template();

    const [resultA, resultB] = await Promise.all([
      Promise.resolve().then(() => composeWebsite(clientA, sharedTemplate)),
      Promise.resolve().then(() => composeWebsite(clientB, sharedTemplate)),
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

  it("does not translate template exceptions into validation issues", () => {
    const input = configurationFixture({
      clientId: "client-a",
      configurationId: "configuration-a",
      deploymentId: "deployment-a",
      moduleId: "module-a",
    });
    const templateError = new Error("Template composition failed");

    expect(() =>
      composeWebsite(
        input,
        template(() => {
          throw templateError;
        }),
      ),
    ).toThrow(templateError);
  });
});
