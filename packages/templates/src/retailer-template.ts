import type {
  ResolvedWebsiteImage,
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
  WebsiteTemplateAssetContext,
} from "@melbourne-local-growth-ops/site-core";

const productImageSlots = Object.freeze([
  {
    assetId: "ceramic-vase",
    alt: "Hand-thrown ceramic vase in sage, a fictional demonstration product photograph",
  },
  {
    assetId: "linen-table-runner",
    alt: "Stonewashed linen table runner in natural oat, a fictional demonstration product photograph",
  },
  {
    assetId: "glass-tumbler-set",
    alt: "Set of four hand-blown recycled glass tumblers, a fictional demonstration product photograph",
  },
  {
    assetId: "storage-basket",
    alt: "Woven seagrass storage basket with cotton handles, a fictional demonstration product photograph",
  },
  {
    assetId: "cushion-cover",
    alt: "Textured oat boucle cushion cover, a fictional demonstration product photograph",
  },
  {
    assetId: "candle-snuffer",
    alt: "Brushed brass candle snuffer with a walnut handle, a fictional demonstration product photograph",
  },
  {
    assetId: "plant-pot",
    alt: "Hand-finished terracotta plant pot with a drainage saucer, a fictional demonstration product photograph",
  },
] as const);

function sortedModuleIds(
  configuration: ValidatedWebsiteConfiguration,
  type: ValidatedWebsiteConfiguration["modules"][number]["type"],
) {
  return Object.freeze(
    configuration.modules
      .filter((module) => module.type === type)
      .map(({ moduleId }) => moduleId)
      .sort(),
  );
}

function composeRetailerWebsite(
  configuration: ValidatedWebsiteConfiguration,
  assets?: WebsiteTemplateAssetContext,
): WebsiteComposition {
  const primaryModuleIds = sortedModuleIds(configuration, "LEAD_FORM");
  const analyticsModuleIds = sortedModuleIds(configuration, "ANALYTICS");
  const hero = assets?.selectImage({
    slotId: "hero",
    assetId: "hero-primary",
    required: false,
    alt: `${configuration.display.businessName} storefront and featured products`,
    sizes: "(min-width: 48rem) 50vw, 100vw",
    priority: true,
  });
  const products = productImageSlots
    .map(({ assetId, alt }) =>
      assets?.selectImage({
        slotId: `product-${assetId}`,
        assetId,
        required: false,
        alt,
        sizes: "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw",
        priority: false,
      }),
    )
    .filter((image): image is ResolvedWebsiteImage => image !== undefined);
  const resolvedAssets = [
    ...(hero === undefined ? [] : [hero]),
    ...products,
  ];

  return Object.freeze({
    templateId: "retailer",
    templateVersion: "1.0.0",
    regions: Object.freeze([
      Object.freeze({
        regionId: "primary",
        moduleIds: primaryModuleIds,
      }),
      Object.freeze({
        regionId: "analytics",
        moduleIds: analyticsModuleIds,
      }),
    ]),
    ...(resolvedAssets.length === 0
      ? {}
      : { assets: Object.freeze(resolvedAssets) }),
  });
}

/**
 * Framework-neutral retailer composition. Registration order and client
 * module array order cannot change the emitted region/module order.
 */
export const retailerTemplateV1: WebsiteTemplate = Object.freeze({
  templateId: "retailer",
  version: "1.0.0",
  compose: composeRetailerWebsite,
});
