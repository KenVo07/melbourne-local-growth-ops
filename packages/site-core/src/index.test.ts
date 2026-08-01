import {
  ClientIdSchema,
  ConnectorIdSchema,
  DeploymentIdSchema,
  EntitlementIdSchema,
  ModuleIdSchema,
  WebsiteConfigurationIdSchema,
} from "@melbourne-local-growth-ops/contracts";
import { describe, expect, it } from "vitest";

import { validateWebsiteConfiguration } from "./index.js";

describe("validateWebsiteConfiguration", () => {
  it("uses the TSK-45 validator for a database-free website", () => {
    const result = validateWebsiteConfiguration({
      schemaVersion: 1,
      configurationId: WebsiteConfigurationIdSchema.parse("config-1"),
      configurationVersion: 1,
      clientId: ClientIdSchema.parse("client-1"),
      entitlementId: EntitlementIdSchema.parse("entitlement-1"),
      deploymentId: DeploymentIdSchema.parse("deployment-1"),
      display: {
        businessName: "Example Local Business",
        locationIds: ["location-1"],
      },
      domains: [{ hostname: "example.com.au", canonical: true }],
      modules: [
        {
          schemaVersion: 1,
          moduleId: ModuleIdSchema.parse("booking-module"),
          connectorId: ConnectorIdSchema.parse("booking-connector"),
          type: "BOOKING_CTA",
          label: "Book now",
        },
      ],
      connectors: [
        {
          schemaVersion: 1,
          connectorId: ConnectorIdSchema.parse("booking-connector"),
          accountOwner: "CLIENT",
          portability: "CLIENT_OWNED",
          type: "BOOKING_LINK",
          bookingUrl: "https://example.com.au/book",
        },
      ],
      configuredInfrastructure: [],
    });

    expect(result.success).toBe(true);
  });

  it("retains the stable contracts validation result", () => {
    const result = validateWebsiteConfiguration({ schemaVersion: 2 });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues[0]?.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    }
  });
});
