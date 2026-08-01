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

function composeContractorWebsite(
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
    alt: `${configuration.display.businessName} electrician providing a local service`,
    sizes: "(min-width: 48rem) 50vw, 100vw",
    priority: true,
  });

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
    ...(hero === undefined
      ? {}
      : { assets: Object.freeze([hero]) }),
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
