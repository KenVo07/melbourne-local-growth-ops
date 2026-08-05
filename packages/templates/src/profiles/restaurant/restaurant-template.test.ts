import {
  validateWebsiteConfiguration,
  type ValidatedWebsiteConfiguration,
} from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it, vi } from "vitest";

import { restaurantTemplateV1 } from "../../restaurant-template.js";

function configurationFixture(
  clientId: string,
  modules: readonly {
    readonly moduleId: string;
    readonly type: "BOOKING_CTA" | "LEAD_FORM" | "ANALYTICS";
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
    modules: modules.map((module) => {
      if (module.type === "BOOKING_CTA") {
        return {
          schemaVersion: 1,
          moduleId: module.moduleId,
          connectorId: `connector-${module.moduleId}`,
          type: module.type,
          label: `Book ${clientId}`,
        };
      }
      if (module.type === "LEAD_FORM") {
        return {
          schemaVersion: 1,
          moduleId: module.moduleId,
          connectorId: `connector-${module.moduleId}`,
          type: module.type,
          fields: ["NAME", "EMAIL", "MESSAGE"],
        };
      }
      return {
        schemaVersion: 1,
        moduleId: module.moduleId,
        connectorId: `connector-${module.moduleId}`,
        type: module.type,
      };
    }),
    connectors: modules.map((module) => {
      if (module.type === "BOOKING_CTA") {
        return {
          schemaVersion: 1,
          connectorId: `connector-${module.moduleId}`,
          accountOwner: "CLIENT",
          portability: "CLIENT_OWNED",
          type: "BOOKING_LINK",
          bookingUrl: `https://${clientId}.example.com.au/book`,
        };
      }
      if (module.type === "LEAD_FORM") {
        return {
          schemaVersion: 1,
          connectorId: `connector-${module.moduleId}`,
          accountOwner: "CLIENT",
          portability: "TRANSFERABLE",
          type: "EMAIL_DELIVERY",
          provider: "RESEND",
          fromAddress: `website@${clientId}.example.com.au`,
          recipientAddresses: [`owner@${clientId}.example.com.au`],
          secretReferenceId: `resend-${clientId}`,
        };
      }
      return {
        schemaVersion: 1,
        connectorId: `connector-${module.moduleId}`,
        accountOwner: "CLIENT",
        portability: "CLIENT_OWNED",
        type: "GOOGLE_ANALYTICS_4",
        measurementId: "G-ABCDEF1234",
      };
    }),
    configuredInfrastructure: [],
  });

  if (!result.success) {
    throw new Error(`Template fixture must be valid: ${JSON.stringify(result.issues)}`);
  }

  return result.data;
}

describe("restaurantTemplateV1", () => {
  it("uses stable template provenance and deterministic region order regardless of module array order", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-z", type: "ANALYTICS" },
      { moduleId: "lead-z", type: "LEAD_FORM" },
      { moduleId: "lead-a", type: "LEAD_FORM" },
    ]);

    const composition = restaurantTemplateV1.compose(configuration);

    expect(composition.templateId).toBe("restaurant");
    expect(composition.templateVersion).toBe("1.0.0");
    expect(composition.regions).toEqual([
      { regionId: "primary", moduleIds: ["lead-a", "lead-z"] },
      { regionId: "analytics", moduleIds: ["analytics-z"] },
    ]);
  });

  it("does not attach a hero image when no asset context is provided", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);

    const composition = restaurantTemplateV1.compose(configuration);

    expect(composition.assets).toBeUndefined();
  });

  it("selects only the hero-primary asset when the asset context resolves nothing else", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);
    const resolvedHero = {
      slotId: "hero",
      asset: {
        assetId: "hero-primary",
        kind: "IMAGE" as const,
        sourcePath: "assets/hero/primary.png",
        mediaType: "image/png" as const,
        width: 1600,
        height: 900,
        publicPath: "/assets/hero/primary.png",
      },
      alt: "Business client-a dining room set for service",
      sizes: "(min-width: 48rem) 50vw, 100vw",
      priority: true,
    };
    const selectImage = vi.fn(({ assetId }: { assetId: string }) =>
      assetId === "hero-primary" ? resolvedHero : undefined,
    );

    const composition = restaurantTemplateV1.compose(configuration, {
      selectImage,
    });

    expect(selectImage).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "hero", assetId: "hero-primary", required: false }),
    );
    expect(composition.assets).toEqual([resolvedHero]);
  });

  it("selects hero and every gallery image under distinct, deterministic slot ids", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);
    const selectImage = vi.fn(
      ({ slotId, assetId }: { slotId: string; assetId: string }) => ({
        slotId,
        asset: {
          assetId,
          kind: "IMAGE" as const,
          sourcePath: `assets/${assetId}.png`,
          mediaType: "image/png" as const,
          width: 1200,
          height: 800,
          publicPath: `/assets/${assetId}.png`,
        },
        alt: `alt for ${assetId}`,
        sizes: "100vw",
        priority: false,
      }),
    );

    const composition = restaurantTemplateV1.compose(configuration, { selectImage });

    expect(selectImage).toHaveBeenCalledTimes(4);
    expect(selectImage).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "gallery-1", assetId: "dining-room", required: false }),
    );
    expect(selectImage).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "gallery-2", assetId: "share-plate", required: false }),
    );
    expect(selectImage).toHaveBeenCalledWith(
      expect.objectContaining({ slotId: "gallery-3", assetId: "bar-service", required: false }),
    );
    expect(composition.assets?.map((image) => image.slotId)).toEqual([
      "hero",
      "gallery-1",
      "gallery-2",
      "gallery-3",
    ]);
  });

  it("drops individual gallery slots that the asset context cannot resolve, keeping the rest", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);
    const selectImage = vi.fn(({ slotId, assetId }: { slotId: string; assetId: string }) =>
      slotId === "gallery-2"
        ? undefined
        : {
            slotId,
            asset: {
              assetId,
              kind: "IMAGE" as const,
              sourcePath: `assets/${assetId}.png`,
              mediaType: "image/png" as const,
              width: 1200,
              height: 800,
              publicPath: `/assets/${assetId}.png`,
            },
            alt: `alt for ${assetId}`,
            sizes: "100vw",
            priority: false,
          },
    );

    const composition = restaurantTemplateV1.compose(configuration, { selectImage });

    expect(composition.assets?.map((image) => image.slotId)).toEqual([
      "hero",
      "gallery-1",
      "gallery-3",
    ]);
  });

  it("leaves assets unset when the asset context has no matching image", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);
    const composition = restaurantTemplateV1.compose(configuration, {
      selectImage: () => undefined,
    });

    expect(composition.assets).toBeUndefined();
  });
});
