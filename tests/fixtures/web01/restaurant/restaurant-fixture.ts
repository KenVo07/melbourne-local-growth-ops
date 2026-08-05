import { fileURLToPath } from "node:url";

import type {
  ManagedWebsiteDefinition,
} from "@melbourne-local-growth-ops/site-core";

import {
  restaurantDemoAssets,
  restaurantDemoBusinessName,
  restaurantDemoClientId,
  restaurantDemoProfileContent,
  type RestaurantDemoImageAsset,
} from "../../../../packages/templates/src/profiles/restaurant/restaurant-demo-profile.js";

/**
 * Points at the real, owned portable image assets in
 * `apps/managed-web/public/examples/restaurant`, so fixture-driven tests
 * exercise the same files the demo actually ships instead of throwaway
 * temporary binaries.
 */
export const restaurantExamplePublicDirectory = fileURLToPath(
  new URL(
    "../../../../apps/managed-web/public/examples/restaurant",
    import.meta.url,
  ),
);

export function restaurantConfiguration(clientId: string) {
  return {
    schemaVersion: 1 as const,
    configurationId: `configuration-${clientId}`,
    configurationVersion: 1,
    clientId,
    entitlementId: `entitlement-${clientId}`,
    deploymentId: `deployment-${clientId}`,
    display: {
      businessName: restaurantDemoBusinessName,
      tagline: "A fictional demonstration share-plate restaurant in Melbourne.",
      locationIds: [`location-${clientId}`],
    },
    domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
    modules: [
      {
        schemaVersion: 1 as const,
        moduleId: "lead-primary",
        connectorId: "email-primary",
        type: "LEAD_FORM" as const,
        fields: ["NAME", "EMAIL", "PHONE", "MESSAGE"] as const,
      },
      {
        schemaVersion: 1 as const,
        moduleId: "analytics-primary",
        connectorId: "analytics-primary",
        type: "ANALYTICS" as const,
      },
    ],
    connectors: [
      {
        schemaVersion: 1 as const,
        connectorId: "email-primary",
        accountOwner: "CLIENT" as const,
        portability: "TRANSFERABLE" as const,
        type: "EMAIL_DELIVERY" as const,
        provider: "RESEND" as const,
        fromAddress: `website@${clientId}.example.com.au`,
        recipientAddresses: [`owner@${clientId}.example.com.au`],
        secretReferenceId: `resend-${clientId}`,
      },
      {
        schemaVersion: 1 as const,
        connectorId: "analytics-primary",
        accountOwner: "CLIENT" as const,
        portability: "CLIENT_OWNED" as const,
        type: "GOOGLE_ANALYTICS_4" as const,
        measurementId: "G-MLGOREST01",
      },
    ],
    configuredInfrastructure: [] as const,
  };
}

/**
 * Shape consumed by `composeManagedWebsite` (site-core), reusing the exact
 * profile content shipped in the templates package so profile-local tests
 * and integration tests cannot drift apart.
 */
export function restaurantManagedWebsiteDefinition(
  clientId: string = restaurantDemoClientId,
  assetOverrides?: readonly RestaurantDemoImageAsset[],
): ManagedWebsiteDefinition {
  return {
    configuration: restaurantConfiguration(clientId),
    profile: restaurantDemoProfileContent(),
    template: { templateId: "restaurant", templateVersion: "1.0.0" },
    modules: [
      { type: "LEAD_FORM", moduleVersion: "1.0.0" },
      { type: "ANALYTICS", moduleVersion: "1.0.0" },
    ],
    assets: {
      clientId,
      publicDirectory: restaurantExamplePublicDirectory,
      assets: assetOverrides ?? restaurantDemoAssets,
    },
  };
}

/**
 * Shape consumed by `generateClientWebsiteSnapshot` / `assembleClientSourceArtifact`
 * in `apps/managed-web/src/generation`, matching the committed
 * `apps/managed-web/client/examples/restaurant/client-website.json` fixture.
 */
export function restaurantClientWebsiteDefinitionInput(
  clientId: string = restaurantDemoClientId,
) {
  return {
    schemaVersion: 1 as const,
    configuration: restaurantConfiguration(clientId),
    profile: restaurantDemoProfileContent(),
    template: { templateId: "restaurant", templateVersion: "1.0.0" },
    modules: [
      { type: "LEAD_FORM" as const, moduleVersion: "1.0.0" },
      { type: "ANALYTICS" as const, moduleVersion: "1.0.0" },
    ],
    assets: restaurantDemoAssets,
  };
}

export {
  restaurantDemoAssets,
  restaurantDemoBusinessName,
  restaurantDemoClientId,
  restaurantDemoProfileContent,
};
