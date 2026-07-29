import type {
  ResolvedWebsiteModule,
  WebsiteModuleReference,
} from "@melbourne-local-growth-ops/site-core";

import {
  ManagedWebsiteRenderError,
  type ManagedModuleRenderer,
} from "./module-renderer-registry";

const reference: WebsiteModuleReference = Object.freeze({
  type: "BOOKING_CTA",
  moduleVersion: "1.0.0",
});

function renderBookingCta(module: ResolvedWebsiteModule) {
  if (
    module.type !== "BOOKING_CTA" ||
    module.configuration.type !== "BOOKING_CTA" ||
    module.connector.type !== "BOOKING_LINK"
  ) {
    throw new ManagedWebsiteRenderError({
      code: "INCOMPATIBLE_MODULE_RENDERER",
      reference,
      moduleId: module.moduleId,
    });
  }

  return (
    <a className="booking-cta" href={module.connector.bookingUrl}>
      {module.configuration.label}
    </a>
  );
}

export const bookingCtaRenderer: ManagedModuleRenderer = Object.freeze({
  reference,
  render: renderBookingCta,
});
