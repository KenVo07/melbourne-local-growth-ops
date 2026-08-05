import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
} from "@melbourne-local-growth-ops/site-core";
import { contractorTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ManagedWebsiteShell,
  createManagedModuleRendererRegistry,
} from "../../../apps/managed-web/src/rendering";
import { bookingCtaRenderer } from "../../../apps/managed-web/src/rendering/booking-cta-renderer";
import {
  analyticsContract,
  bookingCtaContract,
  managedWebsiteDefinition,
} from "./fixtures";

function realRegistries() {
  return {
    templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
    modules: createWebsiteModuleRegistry([
      analyticsContract,
      bookingCtaContract,
    ]),
  };
}

describe("configuration-to-rendering pipeline", () => {
  it("renders a valid client booking CTA through real registries and template", () => {
    const result = composeManagedWebsite(
      managedWebsiteDefinition("client-a"),
      realRegistries(),
    );
    if (!result.success) {
      throw new Error("Valid integration fixture must compose.");
    }

    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    );

    expect(html).toContain("Business client-a");
    expect(html).toContain("Trusted local service for client-a");
    expect(html).toContain('href="https://client-a.example.com.au/book"');
    expect(html).toContain(">Book client-a</a>");
    expect(html).toContain('data-template-id="contractor"');
    expect(html).toContain('data-template-version="1.0.0"');
    expect(html).toContain('data-module-id="booking-client-a"');
    expect(html).toContain('data-module-version="1.0.0"');
    expect(html).not.toContain("analytics-client-a");
    expect(html).not.toContain('aria-label="analytics modules"');
  });

  it("derives navigation and footer anchors from validated profile sections with no invented content", () => {
    const result = composeManagedWebsite(
      managedWebsiteDefinition("client-a"),
      realRegistries(),
    );
    if (!result.success) {
      throw new Error("Valid integration fixture must compose.");
    }
    if (result.data.profile === undefined) {
      throw new Error("Fixture requires profile content.");
    }

    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    );

    for (const section of result.data.profile.sections) {
      expect(html).toContain(`href="#profile-section-${section.sectionId}"`);
      expect(html).toContain(`>${section.heading}</a>`);
    }
    expect(html).toContain('class="skip-to-content"');
    expect(html).toContain('href="#primary-content"');
    expect(html).toContain("<footer");
    expect(html).toContain("Business client-a");
  });

  it("stops invalid configuration before template composition and rendering", () => {
    const compose = vi.fn();
    const result = composeManagedWebsite(
      {
        configuration: { schemaVersion: 2 },
        template: {
          templateId: "contractor",
          templateVersion: "1.0.0",
        },
        modules: [],
      },
      {
        templates: createWebsiteTemplateRegistry([
          {
            ...contractorTemplateV1,
            compose,
          },
        ]),
        modules: createWebsiteModuleRegistry([]),
      },
    );

    expect(result.success).toBe(false);
    expect(compose).not.toHaveBeenCalled();
  });
});
