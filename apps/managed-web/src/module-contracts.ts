import type { WebsiteModuleContract } from "@melbourne-local-growth-ops/site-core";

export const managedWebsiteModuleContracts: readonly WebsiteModuleContract[] =
  Object.freeze([
    Object.freeze({
      type: "BOOKING_CTA",
      version: "1.0.0",
      executionBoundary: "RENDER_ONLY",
      dependencies: Object.freeze([]),
      portability: "TRANSFERABLE",
      analyticsEvents: Object.freeze(["booking_cta_clicked"]),
      fallback: Object.freeze({
        strategy: "ERROR",
        description: "Online booking is temporarily unavailable.",
      }),
    }),
    Object.freeze({
      type: "LEAD_FORM",
      version: "1.0.0",
      executionBoundary: "HYBRID",
      dependencies: Object.freeze([]),
      portability: "TRANSFERABLE",
      analyticsEvents: Object.freeze(["generate_lead"]),
      fallback: Object.freeze({
        strategy: "STATIC",
        description: "The enquiry form is temporarily unavailable.",
      }),
    }),
    Object.freeze({
      type: "ANALYTICS",
      version: "1.0.0",
      executionBoundary: "RENDER_ONLY",
      dependencies: Object.freeze([]),
      portability: "CLIENT_OWNED",
      analyticsEvents: Object.freeze(["page_view"]),
      fallback: Object.freeze({
        strategy: "HIDE",
        description: "Analytics does not render visible content.",
      }),
    }),
  ]);
