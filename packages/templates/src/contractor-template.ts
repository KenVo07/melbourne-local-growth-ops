import type {
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
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
): WebsiteComposition {
  const primaryModuleIds = Object.freeze([
    ...sortedModuleIds(configuration, "BOOKING_CTA"),
    ...sortedModuleIds(configuration, "LEAD_FORM"),
  ]);
  const analyticsModuleIds = sortedModuleIds(configuration, "ANALYTICS");

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
