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
      configurationVersion: 3,
      clientId,
      entitlementId: `entitlement-${clientId}`,
      deploymentId: `deployment-${clientId}`,
      display: {
        businessName: `Business ${clientId}`,
        tagline: `Fictional homewares retailer for ${clientId}`,
        locationIds: [`location-${clientId}`],
      },
      domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
      modules: [
        {
          schemaVersion: 1,
          moduleId: `lead-${clientId}`,
          connectorId: `lead-connector-${clientId}`,
          type: "LEAD_FORM",
          fields: ["NAME", "EMAIL", "MESSAGE"],
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
          connectorId: `lead-connector-${clientId}`,
          accountOwner: "CLIENT",
          portability: "TRANSFERABLE",
          type: "EMAIL_DELIVERY",
          provider: "RESEND",
          fromAddress: `website@${clientId}.example.com.au`,
          recipientAddresses: [`owner@${clientId}.example.com.au`],
          secretReferenceId: `resend-${clientId}`,
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
    profile: retailerProfileContent(clientId),
    template: {
      templateId: "retailer",
      templateVersion: "1.0.0",
    },
    modules: [
      { type: "LEAD_FORM", moduleVersion: "1.0.0" },
      { type: "ANALYTICS", moduleVersion: "1.0.0" },
    ],
    ...(assets === undefined ? {} : { assets }),
  };
}

export function retailerProfileContent(clientId: string) {
  return {
    schemaVersion: 1,
    profile: "RETAILER",
    archetype: "CATALOGUE_LED",
    brand: {
      eyebrow: `Homewares retailer for ${clientId}`,
      accentColor: "#1f6f5c",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fbf7f0",
      textColor: "#1c2321",
    },
    sections: [
      {
        type: "COLLECTIONS",
        sectionId: "collections",
        heading: `Shop by category at ${clientId}`,
        items: [
          {
            title: "Kitchen & dining",
            description: `Fictional demonstration category for ${clientId}.`,
          },
          {
            title: "Home textiles",
            description: `Fictional demonstration category for ${clientId}.`,
          },
        ],
      },
      {
        type: "PRODUCTS",
        sectionId: "featured-products",
        heading: "Featured products",
        items: [
          {
            name: "Ceramic vase",
            description: `Fictional demonstration product copy for ${clientId}.`,
            price: "$68.00",
            assetId: "ceramic-vase",
            purchaseActionId: "purchase",
          },
          {
            name: "Linen table runner",
            description: `Fictional demonstration product copy for ${clientId}.`,
            price: "$45.00",
            assetId: "missing-product-asset",
            purchaseActionId: "purchase",
          },
        ],
      },
      {
        type: "POLICIES",
        sectionId: "policies",
        heading: "Returns, pickup & other policies",
        items: [
          {
            title: "Returns & exchanges",
            body: `Fictional demonstration returns policy copy for ${clientId}.`,
          },
          {
            title: "Click & collect",
            body: `Fictional demonstration pickup policy copy for ${clientId}. Online ordering is not configured.`,
          },
        ],
      },
      {
        type: "EVENTS",
        sectionId: "promotions",
        heading: "Promotions & in-store events",
        items: [
          {
            title: "Seasonal display refresh (fictional demonstration promotion)",
            description: `Fictional demonstration promotional copy for ${clientId}. No real offer is implied.`,
          },
        ],
      },
      {
        type: "TRUST_SIGNALS",
        sectionId: "trust",
        heading: "Why shop with us",
        items: ["Locally packed orders"],
        disclaimer: `${clientId} is a fictional demonstration retailer. No claim is real.`,
      },
      {
        type: "HOURS",
        sectionId: "hours",
        heading: "Store hours",
        periods: [
          { days: "Monday-Friday", hours: "9:00am-5:30pm" },
          { days: "Saturday", hours: "9:00am-4:00pm" },
        ],
        exceptions: ["Closed on public holidays (fictional demonstration hours)."],
      },
      {
        type: "LOCATION",
        sectionId: "location",
        heading: "Visit the store",
        location: {
          name: `${clientId} demonstration store`,
          addressLines: ["1 Example Street"],
          locality: "Melbourne",
          region: "VIC",
          postalCode: "3000",
          directionsUrl:
            "https://www.google.com/maps/search/?api=1&query=1+Example+Street%2C+Melbourne+VIC+3000",
        },
      },
      {
        type: "STORY",
        sectionId: "story",
        heading: "Our story",
        body: `A clearly fictional retailer story for ${clientId}. No real business is described.`,
      },
      {
        type: "TESTIMONIALS",
        sectionId: "testimonials",
        heading: "Illustrative Customer Voices",
        eyebrow: "Fictional Scenarios",
        items: [
          {
            quote: `Illustrative scenario quote about shopping at ${clientId}.`,
            attribution: "Illustrative customer voice — fictional scenario",
            disclosure: "Fictional demonstration testimonial for presentation only; it is not customer evidence or a sales-result claim.",
          },
        ],
      },
      {
        type: "CONTACT",
        sectionId: "contact",
        heading: "Get in touch",
        body: `Send a basic enquiry to ${clientId}. Do not include sensitive information.`,
      },
      {
        type: "ACTIONS",
        sectionId: "primary",
        heading: "Visit or contact the store",
        actions: [
          {
            actionId: "call",
            kind: "PHONE",
            state: "CONFIGURED",
            label: `Call ${clientId}`,
            href: "tel:+61355500200",
          },
          {
            actionId: "purchase",
            kind: "PURCHASE",
            state: "NOT_CONFIGURED",
            label: "Buy online",
            message: "Online purchase is not yet configured for this fictional demonstration store.",
          },
          {
            actionId: "pickup-order",
            kind: "ORDERING",
            state: "NOT_CONFIGURED",
            label: "Order for pickup",
            message: "Online pickup ordering is not yet configured for this fictional demonstration store.",
          },
        ],
      },
    ],
  };
}

export const leadFormContract: WebsiteModuleContract = {
  type: "LEAD_FORM",
  version: "1.0.0",
  executionBoundary: "HYBRID",
  dependencies: [],
  portability: "TRANSFERABLE",
  analyticsEvents: ["generate_lead"],
  fallback: {
    strategy: "STATIC",
    description: "The enquiry form is temporarily unavailable.",
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
