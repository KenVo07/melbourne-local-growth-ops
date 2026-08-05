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
    profile: contractorProfileContent(clientId),
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

export function contractorProfileContent(clientId: string) {
  return {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: `Local service for ${clientId}`,
      accentColor: "#b94c2f",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fffdf8",
      textColor: "#18201d",
    },
    sections: [
      { type: "SERVICES", sectionId: "services", heading: `Services for ${clientId}`, items: [{ title: "Repairs", description: `Fictional service content for ${clientId}.` }] },
      { type: "TRUST_SIGNALS", sectionId: "trust", heading: "Trust", items: ["Credentials confirmed before launch"], disclaimer: "Fictional demonstration content." },
      { type: "GALLERY", sectionId: "gallery", heading: "Gallery", items: [{ assetId: "hero-primary", alt: `Business ${clientId} electrician providing a local service` }] },
      { type: "PROCESS", sectionId: "process", heading: "Process", items: [{ title: "Talk", description: `Contact ${clientId} to discuss the work.` }] },
      { type: "TESTIMONIALS", sectionId: "testimonials", heading: "Feedback", items: [{ quote: `Fictional testimonial for ${clientId}.`, attribution: "Demo customer", disclosure: "Fictional demonstration content." }] },
      { type: "FAQ", sectionId: "faq", heading: "Questions", items: [{ question: "How do I start?", answer: `Use the basic contact path for ${clientId}.` }] },
      { type: "CONTACT", sectionId: "contact", heading: "Contact", body: `Send a basic enquiry to ${clientId}.` },
      { type: "ACTIONS", sectionId: "primary", heading: "Get started", actions: [{ actionId: "call", kind: "PHONE", state: "CONFIGURED", label: `Call ${clientId}`, href: "tel:+61355500001" }] },
    ],
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
