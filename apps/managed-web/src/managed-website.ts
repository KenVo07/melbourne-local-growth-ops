import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  type ManagedWebsiteComposition,
} from "@melbourne-local-growth-ops/site-core";
import { contractorTemplateV1 } from "@melbourne-local-growth-ops/templates";

import {
  bookingCtaRenderer,
  createManagedModuleRendererRegistry,
} from "./rendering";
import {
  managedWebsiteDefinition,
  managedWebsiteModuleContracts,
} from "./site-definition";

const registries = Object.freeze({
  templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
  modules: createWebsiteModuleRegistry(managedWebsiteModuleContracts),
});

export const managedWebsiteRenderers =
  createManagedModuleRendererRegistry([bookingCtaRenderer]);

export function composeCurrentManagedWebsite(): ManagedWebsiteComposition {
  const result = composeManagedWebsite(managedWebsiteDefinition, registries);
  if (!result.success) {
    const summary = result.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Managed website configuration is invalid: ${summary}`);
  }

  return result.data;
}
