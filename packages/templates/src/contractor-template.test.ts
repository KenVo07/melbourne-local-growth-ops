import {
  validateWebsiteConfiguration,
  type ValidatedWebsiteConfiguration,
} from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it } from "vitest";

import { contractorTemplateV1 } from "./index.js";

function configurationFixture(
  clientId: string,
  modules: readonly {
    readonly moduleId: string;
    readonly type: "BOOKING_CTA" | "ANALYTICS";
  }[],
): ValidatedWebsiteConfiguration {
  const result = validateWebsiteConfiguration({
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
    modules: modules.map((module) =>
      module.type === "BOOKING_CTA"
        ? {
            schemaVersion: 1,
            moduleId: module.moduleId,
            connectorId: `connector-${module.moduleId}`,
            type: module.type,
            label: `Book ${clientId}`,
          }
        : {
            schemaVersion: 1,
            moduleId: module.moduleId,
            connectorId: `connector-${module.moduleId}`,
            type: module.type,
          },
    ),
    connectors: modules.map((module) =>
      module.type === "BOOKING_CTA"
        ? {
            schemaVersion: 1,
            connectorId: `connector-${module.moduleId}`,
            accountOwner: "CLIENT",
            portability: "CLIENT_OWNED",
            type: "BOOKING_LINK",
            bookingUrl: `https://${clientId}.example.com.au/book`,
          }
        : {
            schemaVersion: 1,
            connectorId: `connector-${module.moduleId}`,
            accountOwner: "CLIENT",
            portability: "CLIENT_OWNED",
            type: "GOOGLE_ANALYTICS_4",
            measurementId: "G-ABCDEF1234",
          },
    ),
    configuredInfrastructure: [],
  });

  if (!result.success) {
    throw new Error("Template fixture must be valid.");
  }

  return result.data;
}

describe("contractorTemplateV1", () => {
  it("uses stable template provenance and fixed region order", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-z", type: "ANALYTICS" },
      { moduleId: "booking-z", type: "BOOKING_CTA" },
      { moduleId: "booking-a", type: "BOOKING_CTA" },
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);

    const composition = contractorTemplateV1.compose(configuration);

    expect(composition).toEqual({
      templateId: "contractor",
      templateVersion: "1.0.0",
      regions: [
        {
          regionId: "primary",
          moduleIds: ["booking-a", "booking-z"],
        },
        {
          regionId: "analytics",
          moduleIds: ["analytics-a", "analytics-z"],
        },
      ],
    });
  });

  it("does not retain module placements between clients", async () => {
    const [clientA, clientB] = await Promise.all([
      Promise.resolve().then(() =>
        contractorTemplateV1.compose(
          configurationFixture("client-a", [
            { moduleId: "booking-a", type: "BOOKING_CTA" },
          ]),
        ),
      ),
      Promise.resolve().then(() =>
        contractorTemplateV1.compose(
          configurationFixture("client-b", [
            { moduleId: "booking-b", type: "BOOKING_CTA" },
          ]),
        ),
      ),
    ]);

    expect(clientA.regions[0]?.moduleIds).toEqual(["booking-a"]);
    expect(clientB.regions[0]?.moduleIds).toEqual(["booking-b"]);
    expect(JSON.stringify(clientA)).not.toContain("booking-b");
    expect(JSON.stringify(clientB)).not.toContain("booking-a");
  });
});
