import { createTemplateProvenanceMismatchError } from "./template-registry.js";
import type {
  ValidatedWebsiteConfiguration,
  WebsiteComposition,
  WebsiteTemplate,
  WebsiteTemplateAssetContext,
} from "./index.js";

/**
 * Internal validated seam shared by direct and managed composition. External
 * callers still enter through a public function that validates unknown input.
 */
export function composeValidatedWebsite(
  configuration: ValidatedWebsiteConfiguration,
  template: WebsiteTemplate,
  assets?: WebsiteTemplateAssetContext,
): WebsiteComposition {
  const composition = template.compose(configuration, assets);

  if (
    composition.templateId !== template.templateId ||
    composition.templateVersion !== template.version
  ) {
    throw createTemplateProvenanceMismatchError(template, composition);
  }

  return composition;
}
