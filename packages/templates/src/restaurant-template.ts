import type {
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
  WebsiteTemplateAssetContext,
} from "@melbourne-local-growth-ops/site-core";

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

function composeRestaurantWebsite(
  configuration: ValidatedWebsiteConfiguration,
  assets?: WebsiteTemplateAssetContext,
): WebsiteComposition {
  const primaryModuleIds = Object.freeze([
    ...sortedModuleIds(configuration, "BOOKING_CTA"),
    ...sortedModuleIds(configuration, "LEAD_FORM"),
  ]);
  const analyticsModuleIds = sortedModuleIds(configuration, "ANALYTICS");
  const hero = assets?.selectImage({
    slotId: "hero",
    assetId: "hero-primary",
    required: false,
    alt: `${configuration.display.businessName} dining room set for service`,
    sizes: "(min-width: 48rem) 50vw, 100vw",
    priority: true,
  });
  const gallerySlots = Object.freeze([
    {
      slotId: "gallery-1",
      assetId: "dining-room",
      alt: `${configuration.display.businessName} dining room table setting`,
    },
    {
      slotId: "gallery-2",
      assetId: "share-plate",
      alt: `${configuration.display.businessName} share-plate dish`,
    },
    {
      slotId: "gallery-3",
      assetId: "bar-service",
      alt: `${configuration.display.businessName} bar counter`,
    },
  ] as const);
  const gallery = gallerySlots
    .map(({ slotId, assetId, alt }) =>
      assets?.selectImage({
        slotId,
        assetId,
        required: false,
        alt,
        sizes: "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw",
        priority: false,
      }),
    )
    .filter((image) => image !== undefined);
  const resolvedAssets = [
    ...(hero === undefined ? [] : [hero]),
    ...gallery,
  ];

  return Object.freeze({
    templateId: "restaurant",
    templateVersion: "1.0.0",
    regions: Object.freeze([
      Object.freeze({ regionId: "primary", moduleIds: primaryModuleIds }),
      Object.freeze({ regionId: "analytics", moduleIds: analyticsModuleIds }),
    ]),
    ...(resolvedAssets.length === 0 ? {} : { assets: Object.freeze(resolvedAssets) }),
  });
}

/**
 * Framework-neutral restaurant composition. Registration order and client
 * module array order cannot change the emitted region/module order.
 */
export const restaurantTemplateV1: WebsiteTemplate = Object.freeze({
  templateId: "restaurant",
  version: "1.0.0",
  compose: composeRestaurantWebsite,
});
