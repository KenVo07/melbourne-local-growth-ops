import type {
  ResolvedWebsiteImage,
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

function composeContractorWebsite(
  configuration: ValidatedWebsiteConfiguration,
  assets?: WebsiteTemplateAssetContext,
): WebsiteComposition {
  const primaryModuleIds = Object.freeze([
    ...sortedModuleIds(configuration, "BOOKING_CTA"),
    ...sortedModuleIds(configuration, "LEAD_FORM"),
  ]);
  const analyticsModuleIds = sortedModuleIds(configuration, "ANALYTICS");

  const resolvedAssets: ResolvedWebsiteImage[] = [];

  const hero = assets?.selectImage({
    slotId: "hero",
    assetId: "hero-primary",
    required: false,
    alt: `${configuration.display.businessName} local electrical service illustration`,
    sizes: "(min-width: 48rem) 50vw, 100vw",
    priority: true,
  });
  if (hero !== undefined) {
    resolvedAssets.push(hero);
  }

  const gallerySwitchboardDetail = assets?.selectImage({
    slotId: "gallery-switchboard-detail",
    assetId: "gallery-switchboard-detail",
    required: false,
    alt: "Illustrative close view of an open residential switchboard showing circuit protection devices and wiring",
    sizes: "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw",
    priority: false,
  });
  if (
    gallerySwitchboardDetail !== undefined &&
    gallerySwitchboardDetail.asset.assetId === "gallery-switchboard-detail"
  ) {
    resolvedAssets.push(gallerySwitchboardDetail);
  }

  const galleryWorkContext = assets?.selectImage({
    slotId: "gallery-work-context",
    assetId: "gallery-work-context",
    required: false,
    alt: "Illustrative residential context view of an open switchboard, tool belt, and workspace",
    sizes: "(min-width: 64rem) 33vw, (min-width: 40rem) 50vw, 100vw",
    priority: false,
  });
  if (
    galleryWorkContext !== undefined &&
    galleryWorkContext.asset.assetId === "gallery-work-context"
  ) {
    resolvedAssets.push(galleryWorkContext);
  }

  return Object.freeze({
    templateId: "contractor",
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
 * Framework-neutral contractor composition. Registration order and client
 * module array order cannot change the emitted region/module order.
 */
export const contractorTemplateV1: WebsiteTemplate = Object.freeze({
  templateId: "contractor",
  version: "1.0.0",
  compose: composeContractorWebsite,
});
