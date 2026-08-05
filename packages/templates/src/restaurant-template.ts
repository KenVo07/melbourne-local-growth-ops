import type {
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
} from "@melbourne-local-growth-ops/site-core";

function composeRestaurantWebsite(
  configuration: ValidatedWebsiteConfiguration,
): WebsiteComposition {
  return composition("restaurant", configuration);
}

function composition(
  templateId: string,
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
    templateId,
    templateVersion: "1.0.0",
    regions: Object.freeze([
      Object.freeze({ regionId: "primary", moduleIds: Object.freeze(primary) }),
      Object.freeze({ regionId: "analytics", moduleIds: Object.freeze(analytics) }),
    ]),
  });
}

export const restaurantTemplateV1: WebsiteTemplate = Object.freeze({
  templateId: "restaurant",
  version: "1.0.0",
  compose: composeRestaurantWebsite,
});
