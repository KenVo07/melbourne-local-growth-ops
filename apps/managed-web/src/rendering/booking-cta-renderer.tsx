import type {
  RuntimeBookingModule,
  RuntimeModuleReference,
  RuntimeWebsiteModule,
} from "../runtime-types";
import {
  ManagedWebsiteRenderError,
  type ManagedModuleRenderer,
} from "./module-renderer-registry";
import { TrackedBookingLink } from "./TrackedBookingLink";

const reference: RuntimeModuleReference = Object.freeze({
  type: "BOOKING_CTA",
  moduleVersion: "1.0.0",
});

function renderBookingCta(module: RuntimeWebsiteModule) {
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

  const bookingModule = module as RuntimeBookingModule;
  return (
    <TrackedBookingLink
      eventName="booking_cta_clicked"
      href={bookingModule.connector.bookingUrl}
    >
      {bookingModule.configuration.label}
    </TrackedBookingLink>
  );
}

export const bookingCtaRenderer: ManagedModuleRenderer = Object.freeze({
  reference,
  render: renderBookingCta,
});
