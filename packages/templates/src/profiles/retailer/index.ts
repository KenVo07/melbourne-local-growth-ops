import {
  validateWebsiteProfileContent,
  type WebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";

/**
 * A compact, schema-covering RETAILER profile fixture. It satisfies every
 * strict structural requirement (required sections, non-empty collections,
 * safe action hrefs, AA brand contrast) so package-local template tests can
 * exercise real validated content without duplicating the full fictional
 * demonstration catalogue that lives in the managed-web retailer example.
 */
export function createRetailerReferenceProfileContent(
  clientId: string,
): WebsiteProfileContent {
  const result = validateWebsiteProfileContent({
    schemaVersion: 1,
    profile: "RETAILER",
    archetype: "CATALOGUE_LED",
    brand: {
      eyebrow: `Local retailer for ${clientId}`,
      accentColor: "#1f6f5c",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fbf7f0",
      textColor: "#1c2321",
    },
    sections: [
      {
        type: "COLLECTIONS",
        sectionId: "collections",
        heading: "Shop by category",
        items: [
          {
            title: "Home goods",
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
            name: "Demonstration product",
            description: `Fictional demonstration product copy for ${clientId}.`,
            price: "$25.00",
            purchaseActionId: "purchase",
          },
        ],
      },
      {
        type: "POLICIES",
        sectionId: "policies",
        heading: "Store policies",
        items: [
          {
            title: "Returns",
            body: `Fictional demonstration returns policy copy for ${clientId}.`,
          },
        ],
      },
      {
        type: "HOURS",
        sectionId: "hours",
        heading: "Store hours",
        periods: [{ days: "Monday–Friday", hours: "9am–5pm" }],
        exceptions: [],
      },
      {
        type: "LOCATION",
        sectionId: "location",
        heading: "Visit the store",
        location: {
          name: `Demo store for ${clientId}`,
          addressLines: ["1 Example Street"],
          locality: "Melbourne",
          region: "VIC",
          postalCode: "3000",
        },
      },
      {
        type: "STORY",
        sectionId: "story",
        heading: "Our story",
        body: `A clearly fictional retailer story for ${clientId}.`,
      },
      {
        type: "ACTIONS",
        sectionId: "primary",
        heading: "Visit or contact the store",
        actions: [
          {
            actionId: "purchase",
            kind: "PURCHASE",
            state: "NOT_CONFIGURED",
            label: "Buy online",
            message:
              "Online purchase is not configured for this fictional demonstration store.",
          },
        ],
      },
    ],
  });

  if (!result.success) {
    throw new Error("Retailer reference profile content must be valid.");
  }

  return result.data;
}
