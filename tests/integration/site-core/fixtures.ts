import type {
  ManagedWebsiteDefinition,
  WebsiteModuleContract,
} from "@melbourne-local-growth-ops/site-core";

export function managedWebsiteDefinition(
  clientId: string,
  assets?: ManagedWebsiteDefinition["assets"],
): ManagedWebsiteDefinition {
  return {
    configuration: {
      schemaVersion: 1,
      configurationId: `configuration-${clientId}`,
      configurationVersion: 4,
      clientId,
      entitlementId: `entitlement-${clientId}`,
      deploymentId: `deployment-${clientId}`,
      display: {
        businessName: `Business ${clientId}`,
        tagline: `Trusted local service for ${clientId}`,
        locationIds: [`location-${clientId}`],
      },
      domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
      modules: [
        {
          schemaVersion: 1,
          moduleId: `booking-${clientId}`,
          connectorId: `booking-connector-${clientId}`,
          type: "BOOKING_CTA",
          label: `Book ${clientId}`,
        },
        {
          schemaVersion: 1,
          moduleId: `analytics-${clientId}`,
          connectorId: `analytics-connector-${clientId}`,
          type: "ANALYTICS",
        },
      ],
      connectors: [
        {
          schemaVersion: 1,
          connectorId: `booking-connector-${clientId}`,
          accountOwner: "CLIENT",
          portability: "CLIENT_OWNED",
          type: "BOOKING_LINK",
          bookingUrl: `https://${clientId}.example.com.au/book`,
        },
        {
          schemaVersion: 1,
          connectorId: `analytics-connector-${clientId}`,
          accountOwner: "CLIENT",
          portability: "CLIENT_OWNED",
          type: "GOOGLE_ANALYTICS_4",
          measurementId: "G-ABCDEF1234",
        },
      ],
      configuredInfrastructure: [],
    },
    template: {
      templateId: "contractor",
      templateVersion: "1.0.0",
    },
    modules: [
      { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
      { type: "ANALYTICS", moduleVersion: "1.0.0" },
    ],
    ...(assets === undefined ? {} : { assets }),
  };
}

export const bookingCtaContract: WebsiteModuleContract = {
  type: "BOOKING_CTA",
  version: "1.0.0",
  executionBoundary: "RENDER_ONLY",
  dependencies: [],
  portability: "TRANSFERABLE",
  analyticsEvents: ["booking_cta_clicked"],
  fallback: {
    strategy: "ERROR",
    description: "Booking is temporarily unavailable.",
  },
};

export const analyticsContract: WebsiteModuleContract = {
  type: "ANALYTICS",
  version: "1.0.0",
  executionBoundary: "RENDER_ONLY",
  dependencies: [],
  portability: "CLIENT_OWNED",
  analyticsEvents: ["page_view"],
  fallback: {
    strategy: "HIDE",
    description: "Analytics does not render visible content.",
  },
};
