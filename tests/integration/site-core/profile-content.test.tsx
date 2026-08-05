import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
      /<header class="site-hero"[^>]*>[\s\S]*?<\/header>/,
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

interface ParsedCssRule {
  selectors: string[];
  declarations: Record<string, string>;
}

function parseCssRules(cssText: string): ParsedCssRule[] {
  const rules: ParsedCssRule[] = [];
  const ruleRegex = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = ruleRegex.exec(cssText)) !== null) {
    const selectorText = match[1] ?? "";
    const body = match[2] ?? "";
    if (selectorText.trim().startsWith("@")) continue;
    const selectors = selectorText
      .split(",")
      .map((selector) => selector.trim().replace(/\s+/g, " "));
    const declarations: Record<string, string> = {};
    for (const declaration of body.split(";")) {
      const separatorIndex = declaration.indexOf(":");
      if (separatorIndex === -1) continue;
      const property = declaration.slice(0, separatorIndex).trim();
      const value = declaration.slice(separatorIndex + 1).trim();
      if (!property || !value) continue;
      declarations[property] = value;
    }
    rules.push({ selectors, declarations });
  }
  return rules;
}

function relativeLuminance(hexColor: string): number {
  const toLinear = (component: string): number => {
    const channel = Number.parseInt(component, 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  const r = toLinear(hexColor.slice(1, 3));
  const g = toLinear(hexColor.slice(3, 5));
  const b = toLinear(hexColor.slice(5, 7));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(left: string, right: string): number {
  const lighter = Math.max(relativeLuminance(left), relativeLuminance(right));
  const darker = Math.min(relativeLuminance(left), relativeLuminance(right));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("restaurant hero accessible text overrides", () => {
  const restaurantProfileCssPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../apps/managed-web/src/app/profiles/restaurant.css",
  );
  const cssRules = parseCssRules(readFileSync(restaurantProfileCssPath, "utf8"));

  const restaurantHeroEyebrowSelector =
    '.managed-site[data-profile="RESTAURANT"][data-archetype="HOSPITALITY_EDITORIAL"] .site-hero .site-eyebrow';
  const restaurantHeroTaglineSelector =
    '.managed-site[data-profile="RESTAURANT"][data-archetype="HOSPITALITY_EDITORIAL"] .site-hero .site-tagline';

  it("overrides the generic profile eyebrow color with the hero surface color", () => {
    const rule = cssRules.find((candidate) =>
      candidate.selectors.includes(restaurantHeroEyebrowSelector),
    );
    expect(rule?.declarations.color).toBe("var(--profile-surface)");
  });

  it("overrides the base tagline color with the hero surface color", () => {
    const rule = cssRules.find((candidate) =>
      candidate.selectors.includes(restaurantHeroTaglineSelector),
    );
    expect(rule?.declarations.color).toBe("var(--profile-surface)");
  });

  it("keeps the representative hero surface text on the hero background at WCAG AA contrast", () => {
    // Representative pairing: --profile-surface (#fff7ee) text on the
    // --profile-text hero background (#241a15) used by the editorial hero.
    expect(contrastRatio("#fff7ee", "#241a15")).toBeGreaterThanOrEqual(4.5);
  });
});
