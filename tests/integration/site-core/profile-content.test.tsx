import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  validateWebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";
import { contractorTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ManagedWebsiteShell,
  createManagedModuleRendererRegistry,
} from "../../../apps/managed-web/src/rendering";
import { bookingCtaRenderer } from "../../../apps/managed-web/src/rendering/booking-cta-renderer";
import {
  analyticsContract,
  bookingCtaContract,
  contractorProfileContent,
  managedWebsiteDefinition,
} from "./fixtures";

const registries = {
  templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
  modules: createWebsiteModuleRegistry([analyticsContract, bookingCtaContract]),
};

describe("profile content rendering", () => {
  it("keeps profile content separate and interleaves a matching module region once", () => {
    const definition = managedWebsiteDefinition("client-a");
    const result = composeManagedWebsite(definition, registries);
    if (!result.success) throw new Error("Valid profile fixture must compose.");

    expect(result.data.configuration).not.toHaveProperty("profile");
    expect(result.data.profile?.profile).toBe("CONTRACTOR");
    expect(result.data.configuration.configuredInfrastructure).toEqual([]);
    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    );

    expect(html).toContain('data-profile="CONTRACTOR"');
    expect(html).toContain('data-archetype="SERVICE_LED"');
    expect(html).toContain('data-section-id="primary"');
    expect(html.match(/data-module-id="booking-client-a"/g)).toHaveLength(1);
    expect(html).toContain("Services for client-a");
  });

  it("renders only hero slots in the hero while preserving gallery assets for sections", () => {
    const definition = managedWebsiteDefinition("client-a");
    const result = composeManagedWebsite(definition, registries);
    if (!result.success) throw new Error("Valid profile fixture must compose.");
    if (result.data.profile === undefined) {
      throw new Error("Profile fixture must retain profile content.");
    }

    const composition = {
      ...result.data,
      profile: {
        ...result.data.profile,
        sections: result.data.profile.sections.map((section) =>
          section.type === "GALLERY"
            ? {
                ...section,
                items: [
                  {
                    assetId: "gallery-project",
                    alt: "Completed fictional electrical project",
                  },
                ],
              }
            : section,
        ),
      },
      assets: [
        {
          slotId: "hero",
          alt: "Business client-a electrician providing a local service",
          sizes: "(min-width: 48rem) 50vw, 100vw",
          priority: true,
          asset: {
            assetId: "hero-primary",
            mediaType: "image/png",
            publicPath: "/assets/hero/primary.png",
            width: 1672,
            height: 941,
          },
        },
        {
          slotId: "gallery-project",
          alt: "Completed fictional electrical project",
          sizes: "(min-width: 64rem) 33vw, 100vw",
          priority: false,
          asset: {
            assetId: "gallery-project",
            mediaType: "image/png",
            publicPath: "/assets/gallery/project.png",
            width: 1200,
            height: 800,
          },
        },
      ],
    };
    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={composition}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    );
    const heroMarkup = html.match(
      /<header class="site-hero">[\s\S]*?<\/header>/,
    )?.[0];
    const galleryMarkup = html.match(
      /<section[^>]+data-section-type="GALLERY"[^>]*>[\s\S]*?<\/section>/,
    )?.[0];

    expect(heroMarkup).toContain('data-asset-slot="hero"');
    expect(heroMarkup).not.toContain('data-asset-slot="gallery-project"');
    expect(galleryMarkup).toContain('data-asset-id="gallery-project"');
    expect(
      html.match(/<figure[^>]+data-asset-id="gallery-project"/g),
    ).toHaveLength(1);
  });

  it("renders not-configured external actions as status text without a link", () => {
    const profile = contractorProfileContent("client-a");
    const actions = profile.sections.find(({ type }) => type === "ACTIONS");
    if (actions?.type !== "ACTIONS") throw new Error("Fixture requires actions.");
    const mutableActions = actions.actions as unknown as Array<Record<string, unknown>>;
    mutableActions.splice(0, mutableActions.length, {
      actionId: "booking",
      kind: "RESERVATION",
      state: "NOT_CONFIGURED",
      label: "Reserve online",
      message: "Online reservations are not configured. Please call instead.",
    });
    const result = composeManagedWebsite(
      { ...managedWebsiteDefinition("client-a"), profile },
      registries,
    );
    if (!result.success) throw new Error("Truthful fallback fixture must compose.");

    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    );
    expect(html).toContain('data-action-state="NOT_CONFIGURED"');
    expect(html).toContain("Online reservations are not configured");
    expect(html).not.toContain('href="undefined"');
  });

  it("rejects unsafe profile output before React receives it", () => {
    const profile = contractorProfileContent("client-a") as Record<string, unknown>;
    profile.injectedHtml = "<script>alert(1)</script>";
    const result = validateWebsiteProfileContent(profile);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual({
      code: "UNKNOWN_FIELD",
      path: ["injectedHtml"],
      message: "Unknown field: injectedHtml",
    });
  });
});
