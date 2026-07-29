import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  type WebsiteModuleContract,
} from "@melbourne-local-growth-ops/site-core";
import { contractorTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ManagedWebsiteRenderError,
  ManagedWebsiteShell,
  createManagedModuleRendererRegistry,
} from "../../../apps/managed-web/src/rendering";
import { bookingCtaRenderer } from "../../../apps/managed-web/src/rendering/booking-cta-renderer";
import {
  analyticsContract,
  bookingCtaContract,
  managedWebsiteDefinition,
} from "./fixtures";

describe("managed module renderer behavior", () => {
  it("rejects duplicate exact renderer registrations", () => {
    expect(() =>
      createManagedModuleRendererRegistry([
        bookingCtaRenderer,
        bookingCtaRenderer,
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<ManagedWebsiteRenderError>>({
        code: "DUPLICATE_MODULE_RENDERER",
      }),
    );
  });

  it("uses the contract's static fallback when no renderer is registered", () => {
    const staticBookingContract: WebsiteModuleContract = {
      ...bookingCtaContract,
      fallback: {
        strategy: "STATIC",
        description: "Call our team to arrange a service time.",
      },
    };
    const result = composeManagedWebsite(
      managedWebsiteDefinition("client-a"),
      {
        templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
        modules: createWebsiteModuleRegistry([
          analyticsContract,
          staticBookingContract,
        ]),
      },
    );
    if (!result.success) {
      throw new Error("Valid fallback fixture must compose.");
    }

    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([])}
      />,
    );

    expect(html).toContain("Call our team to arrange a service time.");
    expect(html).toContain('role="status"');
    expect(html).not.toContain("analytics-client-a");
  });

  it("throws a typed error when an ERROR fallback has no renderer", () => {
    const result = composeManagedWebsite(
      managedWebsiteDefinition("client-a"),
      {
        templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
        modules: createWebsiteModuleRegistry([
          analyticsContract,
          bookingCtaContract,
        ]),
      },
    );
    if (!result.success) {
      throw new Error("Valid renderer fixture must compose.");
    }

    expect(() =>
      renderToStaticMarkup(
        <ManagedWebsiteShell
          composition={result.data}
          renderers={createManagedModuleRendererRegistry([])}
        />,
      ),
    ).toThrowError(
      expect.objectContaining<Partial<ManagedWebsiteRenderError>>({
        code: "MISSING_MODULE_RENDERER",
        moduleId: "booking-client-a",
      }),
    );
  });

  it("throws a typed error when a resolved module is incompatible with its renderer", () => {
    const result = composeManagedWebsite(
      managedWebsiteDefinition("client-a"),
      {
        templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
        modules: createWebsiteModuleRegistry([
          analyticsContract,
          bookingCtaContract,
        ]),
      },
    );
    if (!result.success) {
      throw new Error("Valid renderer fixture must compose.");
    }

    const bookingModule = result.data.regions
      .flatMap((region) => region.modules)
      .find((module) => module.type === "BOOKING_CTA");
    const analyticsModule = result.data.regions
      .flatMap((region) => region.modules)
      .find((module) => module.type === "ANALYTICS");
    if (bookingModule === undefined || analyticsModule === undefined) {
      throw new Error("Renderer fixture must include both modules.");
    }

    expect(() =>
      bookingCtaRenderer.render({
        ...bookingModule,
        connector: analyticsModule.connector,
      }),
    ).toThrowError(
      expect.objectContaining<Partial<ManagedWebsiteRenderError>>({
        code: "INCOMPATIBLE_MODULE_RENDERER",
        moduleId: "booking-client-a",
      }),
    );
  });
});
