import type {
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
} from "@melbourne-local-growth-ops/site-core";

function composeRetailerWebsite(
  configuration: ValidatedWebsiteConfiguration,
): WebsiteComposition {
  const primary = configuration.modules
    .filter(({ type }) => type !== "ANALYTICS")
    .map(({ moduleId }) => moduleId)
    .sort();
  const analytics = configuration.modules
    .filter(({ type }) => type === "ANALYTICS")
    .map(({ moduleId }) => moduleId)
    .sort();
  return Object.freeze({
    templateId: "retailer",
    templateVersion: "1.0.0",
    regions: Object.freeze([
      Object.freeze({ regionId: "primary", moduleIds: Object.freeze(primary) }),
      Object.freeze({ regionId: "analytics", moduleIds: Object.freeze(analytics) }),
    ]),
  });
}

export const retailerTemplateV1: WebsiteTemplate = Object.freeze({
  templateId: "retailer",
  version: "1.0.0",
  compose: composeRetailerWebsite,
});
