import { fileURLToPath } from "node:url";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
} from "@melbourne-local-growth-ops/site-core";
import { restaurantTemplateV1, retailerTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { describe, expect, it } from "vitest";

import { composeCurrentManagedWebsite } from "../../../apps/managed-web/src/managed-website";
import { managedWebsiteModuleContracts } from "../../../apps/managed-web/src/module-contracts";
import type { ManagedWebsiteRuntime } from "../../../apps/managed-web/src/runtime-types";
import {
  buildManagedWebsiteJsonLd,
  buildManagedWebsiteMetadata,
  resolveCanonicalSiteUrl,
  serializeStructuredData,
} from "../../../apps/managed-web/src/structured-data";
import { restaurantManagedWebsiteDefinition } from "../../fixtures/web01/restaurant/restaurant-fixture";
import {
  analyticsContract as retailerAnalyticsContract,
  leadFormContract as retailerLeadFormContract,
  managedWebsiteDefinition as retailerManagedWebsiteDefinition,
} from "../../fixtures/web01/retailer/fixtures";

const retailerPublicDirectory = fileURLToPath(
  new URL(
    "../../../apps/managed-web/public/examples/retailer",
    import.meta.url,
  ),
);

describe("production default (CONTRACTOR) metadata and structured data", () => {
  it("derives title, description, canonical url, and Open Graph website metadata from the canonical hostname and hero image", () => {
    const runtime = composeCurrentManagedWebsite();
    const metadata = buildManagedWebsiteMetadata(runtime);

    expect(metadata.title).toEqual({
      default: "Harbour Electrical & Air",
      template: "%s | Harbour Electrical & Air",
    });
    expect(metadata.description).toBe(
      "Straightforward electrical and split-system service across Melbourne.",
    );
    expect(metadata.alternates).toEqual({
      canonical: "https://harbour-electrical.example.com.au",
    });
    expect(metadata.openGraph).toMatchObject({
      type: "website",
      url: "https://harbour-electrical.example.com.au",
      images: [
        {
          url: "https://harbour-electrical.example.com.au/assets/hero/primary.png",
        },
      ],
    });
  });

  it("maps CONTRACTOR to HomeAndConstructionBusiness and includes the configured phone number and hero image", () => {
    const jsonLd = buildManagedWebsiteJsonLd(composeCurrentManagedWebsite());

    expect(jsonLd).toMatchObject({
      "@context": "https://schema.org",
      "@type": "HomeAndConstructionBusiness",
      name: "Harbour Electrical & Air",
      url: "https://harbour-electrical.example.com.au",
      description:
        "Straightforward electrical and split-system service across Melbourne.",
      telephone: "+61355500001",
      image: "https://harbour-electrical.example.com.au/assets/hero/primary.png",
    });
  });

  it("truthfully omits address and openingHours when the profile has no LOCATION or HOURS section", () => {
    const jsonLd = buildManagedWebsiteJsonLd(composeCurrentManagedWebsite());

    expect(jsonLd).not.toHaveProperty("address");
    expect(jsonLd).not.toHaveProperty("openingHours");
  });
});

describe("RESTAURANT profile metadata and structured data", () => {
  const registries = {
    templates: createWebsiteTemplateRegistry([restaurantTemplateV1]),
    modules: createWebsiteModuleRegistry(managedWebsiteModuleContracts),
  };

  function composeRestaurant(clientId: string): ManagedWebsiteRuntime {
    const result = composeManagedWebsite(
      restaurantManagedWebsiteDefinition(clientId),
      registries,
    );
    if (!result.success) {
      throw new Error(
        `Restaurant fixture must compose: ${JSON.stringify(result.issues)}`,
      );
    }
    return result.data;
  }

  it("maps RESTAURANT to schema.org Restaurant with truthful location, hours, phone, and hero image", () => {
    const runtime = composeRestaurant("lantern-and-vine");
    const jsonLd = buildManagedWebsiteJsonLd(runtime);

    expect(jsonLd).toMatchObject({
      "@type": "Restaurant",
      name: "Lantern & Vine",
      telephone: "+61355500002",
      address: {
        "@type": "PostalAddress",
        streetAddress: "12 Lantern Lane",
        addressLocality: "Melbourne",
        addressRegion: "VIC",
        postalCode: "3000",
      },
      openingHours: [
        "Tuesday–Thursday 5:30pm–9:30pm",
        "Friday–Saturday 5:30pm–10:30pm",
        "Sunday 12:00pm–3:00pm, 5:30pm–9:00pm",
      ],
    });
    expect(jsonLd?.image).toBe(
      `${resolveCanonicalSiteUrl(runtime)}/assets/hero/primary.png`,
    );
  });

  it("keeps two composed restaurant clients isolated by canonical hostname", () => {
    const clientA = composeRestaurant("restaurant-client-a");
    const clientB = composeRestaurant("restaurant-client-b");

    expect(resolveCanonicalSiteUrl(clientA)).toBe(
      "https://restaurant-client-a.example.com.au",
    );
    expect(resolveCanonicalSiteUrl(clientB)).toBe(
      "https://restaurant-client-b.example.com.au",
    );
  });
});

describe("RETAILER profile metadata and structured data", () => {
  const registries = {
    templates: createWebsiteTemplateRegistry([retailerTemplateV1]),
    modules: createWebsiteModuleRegistry([
      retailerLeadFormContract,
      retailerAnalyticsContract,
    ]),
  };

  function composeRetailer(
    clientId: string,
    withHero: boolean,
  ): ManagedWebsiteRuntime {
    const definition = retailerManagedWebsiteDefinition(
      clientId,
      withHero
        ? {
            clientId,
            publicDirectory: retailerPublicDirectory,
            assets: [
              {
                assetId: "hero-primary",
                kind: "IMAGE",
                sourcePath: "assets/hero/primary.png",
                mediaType: "image/png",
                width: 1600,
                height: 900,
              },
            ],
          }
        : undefined,
    );
    const result = composeManagedWebsite(definition, registries);
    if (!result.success) {
      throw new Error(
        `Retailer fixture must compose: ${JSON.stringify(result.issues)}`,
      );
    }
    return result.data;
  }

  it("maps RETAILER to schema.org Store with truthful location, hours, and phone", () => {
    const jsonLd = buildManagedWebsiteJsonLd(composeRetailer("client-a", false));

    expect(jsonLd).toMatchObject({
      "@type": "Store",
      telephone: "+61355500200",
      address: {
        "@type": "PostalAddress",
        streetAddress: "1 Example Street",
        addressLocality: "Melbourne",
        addressRegion: "VIC",
        postalCode: "3000",
      },
      openingHours: ["Monday-Friday 9:00am-5:30pm", "Saturday 9:00am-4:00pm"],
    });
  });

  it("truthfully omits the image field and Open Graph image when no hero asset is resolved", () => {
    const runtime = composeRetailer("client-a", false);

    expect(buildManagedWebsiteJsonLd(runtime)).not.toHaveProperty("image");
    expect(buildManagedWebsiteMetadata(runtime).openGraph).not.toHaveProperty(
      "images",
    );
  });

  it("includes the resolved hero image url in structured data and Open Graph when configured", () => {
    const runtime = composeRetailer("client-a", true);
    const expectedUrl = `${resolveCanonicalSiteUrl(runtime)}/assets/hero/primary.png`;

    expect(buildManagedWebsiteJsonLd(runtime)?.image).toBe(expectedUrl);
    expect(buildManagedWebsiteMetadata(runtime).openGraph).toMatchObject({
      images: [{ url: expectedUrl }],
    });
  });
});

describe("backward-compatible profile-absent M1 callers", () => {
  const profileAbsentRuntime: ManagedWebsiteRuntime = {
    configuration: {
      configurationId: "configuration-profile-absent",
      configurationVersion: 1,
      clientId: "profile-absent-client",
      deploymentId: "deployment-profile-absent",
      display: {
        businessName: "Profile Absent Co.",
        tagline: "Existing M1 caller without validated profile content.",
      },
      domains: [
        { hostname: "profile-absent.example.com.au", canonical: true },
      ],
    },
    provenance: {
      configurationId: "configuration-profile-absent",
      configurationVersion: 1,
      template: { templateId: "flat", templateVersion: "1.0.0" },
      foundationSearch: { mode: "OFF", enabled: false },
    },
    foundationSearch: {
      schemaVersion: 1,
      mode: "OFF",
      enabled: false,
      reason: "DEFAULT_OFF",
      records: [],
    },
    assets: [],
    regions: [],
  };

  it("keeps existing title and description behavior when no profile is present", () => {
    const metadata = buildManagedWebsiteMetadata(profileAbsentRuntime);

    expect(metadata.title).toEqual({
      default: "Profile Absent Co.",
      template: "%s | Profile Absent Co.",
    });
    expect(metadata.description).toBe(
      "Existing M1 caller without validated profile content.",
    );
  });

  it("falls back to schema.org LocalBusiness with only truthful configuration-derived fields", () => {
    const jsonLd = buildManagedWebsiteJsonLd(profileAbsentRuntime);

    expect(jsonLd).toEqual({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Profile Absent Co.",
      url: "https://profile-absent.example.com.au",
      description: "Existing M1 caller without validated profile content.",
    });
  });
});

describe("JSON-LD serialization safety and determinism", () => {
  it("produces the same serialized payload for the same runtime", () => {
    const runtime = composeManagedWebsite(
      restaurantManagedWebsiteDefinition("lantern-and-vine"),
      {
        templates: createWebsiteTemplateRegistry([restaurantTemplateV1]),
        modules: createWebsiteModuleRegistry(managedWebsiteModuleContracts),
      },
    );
    if (!runtime.success) {
      throw new Error("Restaurant fixture must compose.");
    }

    const first = buildManagedWebsiteJsonLd(runtime.data);
    const second = buildManagedWebsiteJsonLd(runtime.data);
    expect(first).toBeDefined();
    if (first === undefined) return;

    expect(serializeStructuredData(first)).toBe(serializeStructuredData(second!));
  });

  it("scrubs every '<' from an explicit script-terminator payload so no literal script element can be injected", () => {
    const maliciousBusinessName =
      'Acme "</script><script>alert(1)</script>" Co.';
    const runtime: ManagedWebsiteRuntime = {
      configuration: {
        configurationId: "configuration-script-payload",
        configurationVersion: 1,
        clientId: "script-payload-client",
        deploymentId: "deployment-script-payload",
        display: { businessName: maliciousBusinessName },
        domains: [
          { hostname: "script-payload.example.com.au", canonical: true },
        ],
      },
      provenance: {
        configurationId: "configuration-script-payload",
        configurationVersion: 1,
        template: { templateId: "flat", templateVersion: "1.0.0" },
        foundationSearch: { mode: "OFF", enabled: false },
      },
      foundationSearch: {
        schemaVersion: 1,
        mode: "OFF",
        enabled: false,
        reason: "DEFAULT_OFF",
        records: [],
      },
      assets: [],
      regions: [],
    };

    const jsonLd = buildManagedWebsiteJsonLd(runtime);
    expect(jsonLd).toBeDefined();
    if (jsonLd === undefined) return;
    const serialized = serializeStructuredData(jsonLd);

    expect(serialized).not.toContain("</script>");
    expect(serialized).not.toContain("<script>");
    expect(serialized).not.toContain("<");
    expect((JSON.parse(serialized) as { name: string }).name).toBe(
      maliciousBusinessName,
    );
  });
});
