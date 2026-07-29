import type {
  RuntimeAnalyticsModule,
  RuntimeModuleReference,
  RuntimeWebsiteModule,
} from "../runtime-types";
import { Ga4Runtime } from "../analytics/Ga4Runtime";
import {
  ManagedWebsiteRenderError,
  type ManagedModuleRenderer,
} from "./module-renderer-registry";

const reference: RuntimeModuleReference = Object.freeze({
  type: "ANALYTICS",
  moduleVersion: "1.0.0",
});

function renderAnalytics(module: RuntimeWebsiteModule) {
  if (
    module.type !== "ANALYTICS" ||
    module.configuration.type !== "ANALYTICS" ||
    module.connector.type !== "GOOGLE_ANALYTICS_4"
  ) {
    throw new ManagedWebsiteRenderError({
      code: "INCOMPATIBLE_MODULE_RENDERER",
      reference,
      moduleId: module.moduleId,
    });
  }

  const analyticsModule = module as RuntimeAnalyticsModule;
  if (
    analyticsModule.connector.accountOwner !== "CLIENT" ||
    analyticsModule.connector.portability !== "CLIENT_OWNED"
  ) {
    throw new ManagedWebsiteRenderError({
      code: "INCOMPATIBLE_MODULE_RENDERER",
      reference,
      moduleId: module.moduleId,
    });
  }
  return (
    <Ga4Runtime measurementId={analyticsModule.connector.measurementId} />
  );
}

export const analyticsRenderer: ManagedModuleRenderer = Object.freeze({
  reference,
  render: renderAnalytics,
});
