import { clientWebsite } from "./client-website";
import {
  bookingCtaRenderer,
  createManagedModuleRendererRegistry,
  leadFormRenderer,
  analyticsRenderer,
} from "./rendering";
import type { ManagedWebsiteRuntime } from "./runtime-types";

export const managedWebsiteRenderers =
  createManagedModuleRendererRegistry([
    bookingCtaRenderer,
    leadFormRenderer,
    analyticsRenderer,
  ]);

export function composeCurrentManagedWebsite(): ManagedWebsiteRuntime {
  return clientWebsite;
}
