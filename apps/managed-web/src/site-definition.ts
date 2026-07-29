import type {
  ManagedWebsiteDefinition,
  WebsiteModuleContract,
} from "@melbourne-local-growth-ops/site-core";

export const managedWebsiteDefinition: ManagedWebsiteDefinition = {
  configuration: {
    schemaVersion: 1,
    configurationId: "configuration-harbour-electrical",
    configurationVersion: 1,
    clientId: "harbour-electrical",
    entitlementId: "entitlement-harbour-electrical",
    deploymentId: "deployment-harbour-electrical",
    display: {
      businessName: "Harbour Electrical & Air",
      tagline:
        "Straightforward electrical and split-system service across Melbourne.",
      locationIds: ["location-melbourne"],
    },
    domains: [
      {
        hostname: "harbour-electrical.example.com.au",
        canonical: true,
      },
    ],
    modules: [
      {
        schemaVersion: 1,
        moduleId: "booking-primary",
        connectorId: "booking-primary",
        type: "BOOKING_CTA",
        label: "Request a service time",
      },
      {
        schemaVersion: 1,
        moduleId: "analytics-primary",
        connectorId: "analytics-primary",
        type: "ANALYTICS",
      },
    ],
    connectors: [
      {
        schemaVersion: 1,
        connectorId: "booking-primary",
        accountOwner: "CLIENT",
        portability: "CLIENT_OWNED",
        type: "BOOKING_LINK",
        bookingUrl: "https://harbour-electrical.example.com.au/book",
      },
      {
        schemaVersion: 1,
        connectorId: "analytics-primary",
        accountOwner: "CLIENT",
        portability: "CLIENT_OWNED",
        type: "GOOGLE_ANALYTICS_4",
        measurementId: "G-MLGO123456",
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
};

export const managedWebsiteModuleContracts: readonly WebsiteModuleContract[] =
  Object.freeze([
    Object.freeze({
      type: "BOOKING_CTA",
      version: "1.0.0",
      executionBoundary: "RENDER_ONLY",
      dependencies: Object.freeze([]),
      portability: "TRANSFERABLE",
      analyticsEvents: Object.freeze(["booking_cta_clicked"]),
      fallback: Object.freeze({
        strategy: "ERROR",
        description: "Online booking is temporarily unavailable.",
      }),
    }),
    Object.freeze({
      type: "ANALYTICS",
      version: "1.0.0",
      executionBoundary: "RENDER_ONLY",
      dependencies: Object.freeze([]),
      portability: "CLIENT_OWNED",
      analyticsEvents: Object.freeze(["page_view"]),
      fallback: Object.freeze({
        strategy: "HIDE",
        description: "Analytics does not render visible content.",
      }),
    }),
  ]);
