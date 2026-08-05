import {
  validateWebsiteConfiguration,
  type ResolvedWebsiteImage,
  type ValidatedWebsiteConfiguration,
  type WebsiteTemplateAssetContext,
} from "@melbourne-local-growth-ops/site-core";
import { describe, expect, it, vi } from "vitest";

import { retailerTemplateV1 } from "./index.js";

function configurationFixture(
  clientId: string,
  modules: readonly {
    readonly moduleId: string;
    readonly type: "LEAD_FORM" | "ANALYTICS";
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
      module.type === "LEAD_FORM"
        ? {
            schemaVersion: 1,
            moduleId: module.moduleId,
            connectorId: `connector-${module.moduleId}`,
            type: module.type,
            fields: ["NAME", "EMAIL", "MESSAGE"],
          }
        : {
            schemaVersion: 1,
            moduleId: module.moduleId,
            connectorId: `connector-${module.moduleId}`,
            type: module.type,
          },
    ),
    connectors: modules.map((module) =>
      module.type === "LEAD_FORM"
        ? {
            schemaVersion: 1,
            connectorId: `connector-${module.moduleId}`,
            accountOwner: "CLIENT",
            portability: "TRANSFERABLE",
            type: "EMAIL_DELIVERY",
            provider: "RESEND",
            fromAddress: `website@${clientId}.example.com.au`,
            recipientAddresses: [`owner@${clientId}.example.com.au`],
            secretReferenceId: `resend-${clientId}`,
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

describe("retailerTemplateV1", () => {
  it("uses stable template provenance and fixed region order", () => {
    const configuration = configurationFixture("client-a", [
      { moduleId: "analytics-z", type: "ANALYTICS" },
      { moduleId: "lead-z", type: "LEAD_FORM" },
      { moduleId: "lead-a", type: "LEAD_FORM" },
      { moduleId: "analytics-a", type: "ANALYTICS" },
    ]);

    const composition = retailerTemplateV1.compose(configuration);

    expect(composition).toEqual({
      templateId: "retailer",
      templateVersion: "1.0.0",
      regions: [
        {
          regionId: "primary",
          moduleIds: ["lead-a", "lead-z"],
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
        retailerTemplateV1.compose(
          configurationFixture("client-a", [
            { moduleId: "lead-a", type: "LEAD_FORM" },
          ]),
        ),
      ),
      Promise.resolve().then(() =>
        retailerTemplateV1.compose(
          configurationFixture("client-b", [
            { moduleId: "lead-b", type: "LEAD_FORM" },
          ]),
        ),
      ),
    ]);

    expect(clientA.regions[0]?.moduleIds).toEqual(["lead-a"]);
    expect(clientB.regions[0]?.moduleIds).toEqual(["lead-b"]);
    expect(JSON.stringify(clientA)).not.toContain("lead-b");
    expect(JSON.stringify(clientB)).not.toContain("lead-a");
  });

  it("selects an optional hero while keeping usage metadata in the template", () => {
    const selectedHero: ResolvedWebsiteImage = {
      slotId: "hero",
      asset: {
        assetId: "hero-primary",
        kind: "IMAGE",
        sourcePath: "assets/hero/primary.png",
        publicPath: "/assets/hero/primary.png",
        mediaType: "image/png",
        width: 1600,
        height: 900,
      },
      alt: "Business client-a storefront and featured products",
      sizes: "(min-width: 48rem) 50vw, 100vw",
      priority: true,
    };
    const selectImage = vi
      .fn<WebsiteTemplateAssetContext["selectImage"]>()
      .mockImplementation(({ slotId }) =>
        slotId === "hero" ? selectedHero : undefined,
      );

    const composition = retailerTemplateV1.compose(
      configurationFixture("client-a", []),
      { selectImage },
    );

    expect(selectImage).toHaveBeenCalledWith({
      slotId: "hero",
      assetId: "hero-primary",
      required: false,
      alt: "Business client-a storefront and featured products",
      sizes: "(min-width: 48rem) 50vw, 100vw",
      priority: true,
    });
    expect(composition.assets).toEqual([selectedHero]);
  });

  it("omits the optional hero when no matching asset is available", () => {
    const composition = retailerTemplateV1.compose(
      configurationFixture("client-a", []),
      { selectImage: () => undefined },
    );

    expect(composition).not.toHaveProperty("assets");
  });

  const productAssetIds = [
    "ceramic-vase",
    "linen-table-runner",
    "glass-tumbler-set",
    "storage-basket",
    "cushion-cover",
    "candle-snuffer",
    "plant-pot",
  ] as const;

  it("resolves hero and every product image under distinct, deterministic slot ids", () => {
    const configuration = configurationFixture("client-a", []);
    const selectImage = vi.fn(
      ({ slotId, assetId }: { slotId: string; assetId: string }) => ({
        slotId,
        asset: {
          assetId,
          kind: "IMAGE" as const,
          sourcePath: `assets/products/${assetId}.png`,
          mediaType: "image/png" as const,
          width: 1000,
          height: 1000,
          publicPath: `/assets/products/${assetId}.png`,
        },
        alt: `alt for ${assetId}`,
        sizes: "100vw",
        priority: false,
      }),
    );

    const composition = retailerTemplateV1.compose(configuration, {
      selectImage,
    });

    expect(selectImage).toHaveBeenCalledTimes(1 + productAssetIds.length);
    for (const assetId of productAssetIds) {
      expect(selectImage).toHaveBeenCalledWith(
        expect.objectContaining({
          slotId: `product-${assetId}`,
          assetId,
          required: false,
        }),
      );
    }
    expect(composition.assets?.map((image) => image.slotId)).toEqual([
      "hero",
      ...productAssetIds.map((assetId) => `product-${assetId}`),
    ]);
  });

  it("drops individual product slots that the asset context cannot resolve, keeping the rest", () => {
    const configuration = configurationFixture("client-a", []);
    const selectImage = vi.fn(({ slotId, assetId }: { slotId: string; assetId: string }) =>
      slotId === "product-cushion-cover"
        ? undefined
        : {
            slotId,
            asset: {
              assetId,
              kind: "IMAGE" as const,
              sourcePath: `assets/products/${assetId}.png`,
              mediaType: "image/png" as const,
              width: 1000,
              height: 1000,
              publicPath: `/assets/products/${assetId}.png`,
            },
            alt: `alt for ${assetId}`,
            sizes: "100vw",
            priority: false,
          },
    );

    const composition = retailerTemplateV1.compose(configuration, {
      selectImage,
    });

    expect(composition.assets?.map((image) => image.slotId)).not.toContain(
      "product-cushion-cover",
    );
    expect(composition.assets).toHaveLength(productAssetIds.length);
  });

  it("does not retain product image placements between clients", async () => {
    const [clientA, clientB] = await Promise.all([
      Promise.resolve().then(() =>
        retailerTemplateV1.compose(configurationFixture("client-a", []), {
          selectImage: ({ slotId, assetId }) => ({
            slotId,
            asset: {
              assetId: `client-a-${assetId}`,
              kind: "IMAGE" as const,
              sourcePath: `assets/products/${assetId}.png`,
              mediaType: "image/png" as const,
              width: 1000,
              height: 1000,
              publicPath: `/assets/products/client-a-${assetId}.png`,
            },
            alt: "client-a product",
            sizes: "100vw",
            priority: false,
          }),
        }),
      ),
      Promise.resolve().then(() =>
        retailerTemplateV1.compose(configurationFixture("client-b", []), {
          selectImage: ({ slotId, assetId }) => ({
            slotId,
            asset: {
              assetId: `client-b-${assetId}`,
              kind: "IMAGE" as const,
              sourcePath: `assets/products/${assetId}.png`,
              mediaType: "image/png" as const,
              width: 1000,
              height: 1000,
              publicPath: `/assets/products/client-b-${assetId}.png`,
            },
            alt: "client-b product",
            sizes: "100vw",
            priority: false,
          }),
        }),
      ),
    ]);

    expect(JSON.stringify(clientA)).not.toContain("client-b");
    expect(JSON.stringify(clientB)).not.toContain("client-a");
  });
});
