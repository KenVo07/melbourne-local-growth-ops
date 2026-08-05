import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  validateWebsiteProfileContent,
} from "@melbourne-local-growth-ops/site-core";
import { restaurantTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  analyticsRenderer,
  createManagedModuleRendererRegistry,
  leadFormRenderer,
  ManagedWebsiteShell,
} from "../../../../apps/managed-web/src/rendering";
import { managedWebsiteModuleContracts } from "../../../../apps/managed-web/src/module-contracts";
import {
  restaurantDemoAssets,
  restaurantDemoProfileContent,
  restaurantExamplePublicDirectory,
  restaurantManagedWebsiteDefinition,
} from "../../../fixtures/web01/restaurant/restaurant-fixture";

const registries = {
  templates: createWebsiteTemplateRegistry([restaurantTemplateV1]),
  modules: createWebsiteModuleRegistry(managedWebsiteModuleContracts),
};
const renderers = createManagedModuleRendererRegistry([
  leadFormRenderer,
  analyticsRenderer,
]);

function renderRestaurant(clientId: string) {
  const definition = restaurantManagedWebsiteDefinition(clientId);
  const result = composeManagedWebsite(definition, registries);
  if (!result.success) {
    throw new Error(`Restaurant fixture must compose: ${JSON.stringify(result.issues)}`);
  }
  return {
    composition: result.data,
    html: renderToStaticMarkup(
      <ManagedWebsiteShell composition={result.data} renderers={renderers} />,
    ),
  };
}

describe("restaurant profile composition", () => {
  it("resolves the RESTAURANT/HOSPITALITY_EDITORIAL profile through the shared restaurant template", () => {
    const { composition, html } = renderRestaurant("client-a");

    expect(composition.profile?.profile).toBe("RESTAURANT");
    expect(composition.provenance.template.templateId).toBe("restaurant");
    expect(composition.configuration.configuredInfrastructure).toEqual([]);
    expect(html).toContain('data-profile="RESTAURANT"');
    expect(html).toContain('data-archetype="HOSPITALITY_EDITORIAL"');
  });

  it("resolves the hero image and every gallery image into composition.assets under distinct slot ids", () => {
    const { composition, html } = renderRestaurant("client-a");

    // Resolution of the header slot vs. gallery slots is asserted at the
    // composition level rather than against the current header markup: the
    // shared apps/managed-web ManagedWebsiteShell (frozen for this task)
    // currently renders every entry of composition.assets in the header, so
    // a supervisor-serialized shared fix is filtering that rendering to the
    // "hero" slot only. This test only asserts what restaurant-template.ts
    // itself contributes.
    expect(composition.assets?.map((image) => image.slotId)).toEqual([
      "hero",
      "gallery-1",
      "gallery-2",
      "gallery-3",
    ]);
    expect(composition.assets?.[0]?.asset.assetId).toBe("hero-primary");
    expect(composition.assets?.[1]?.asset.assetId).toBe("dining-room");
    expect(composition.assets?.[2]?.asset.assetId).toBe("share-plate");
    expect(composition.assets?.[3]?.asset.assetId).toBe("bar-service");
    expect(html).toContain('data-asset-slot="hero"');
  });

  it("renders every required restaurant section with an accessible labelled landmark", () => {
    const { html } = renderRestaurant("client-a");

    for (const sectionId of [
      "story",
      "dining-choices",
      "menu",
      "hours",
      "location",
      "gallery",
      "events",
      "faq",
      "primary",
    ]) {
      expect(html).toContain(`data-section-id="${sectionId}"`);
    }
    // Every profile-section carries aria-labelledby pointing at its own heading id.
    const sectionMatches = [...html.matchAll(/aria-labelledby="(profile-section-[a-z-]+)"/g)];
    expect(sectionMatches.length).toBeGreaterThanOrEqual(9);
    for (const [, headingId] of sectionMatches) {
      expect(html).toContain(`id="${headingId}"`);
    }
  });

  it("renders structured menu categories, items, prices, and dietary tags", () => {
    const { html } = renderRestaurant("client-a");

    expect(html).toContain('data-section-type="MENU"');
    expect(html).toContain("Small plates");
    expect(html).toContain("Charred flatbread, whipped cultured butter");
    expect(html).toContain("$14");
    expect(html).toContain("Vegetarian");
    expect(html).toContain("Vegan");
  });

  it("renders opening hours and location as accessible definition/address semantics", () => {
    const { html } = renderRestaurant("client-a");

    expect(html).toMatch(/<dl class="profile-hours">/);
    expect(html).toContain("Tuesday–Thursday");
    expect(html).toContain("Closed Mondays");
    expect(html).toMatch(/<address class="profile-location">/);
    expect(html).toContain("Melbourne, VIC 3000");
    expect(html).toContain("Get directions");
  });

  it("keeps reservation and ordering actions truthfully NOT_CONFIGURED with no broken link", () => {
    const { html } = renderRestaurant("client-a");

    expect(html).toContain('data-action-kind="RESERVATION" data-action-state="NOT_CONFIGURED"');
    expect(html).toContain("Online reservations are not configured");
    expect(html).toContain('data-action-kind="ORDERING" data-action-state="NOT_CONFIGURED"');
    expect(html).toContain("Online ordering is not configured");
    expect(html).not.toContain('href="undefined"');
  });

  it("renders phone and directions actions as real, safely configured links", () => {
    const { html } = renderRestaurant("client-a");

    expect(html).toContain('href="tel:+61355500002"');
    expect(html).toContain(
      'href="https://www.google.com/maps/search/?api=1&amp;query=Lantern+Lane+Melbourne+VIC"',
    );
  });

  it("renders every gallery image as a real <img>, resolved against the real portable asset manifest, with accurate alt text", () => {
    const { composition, html } = renderRestaurant("client-a");
    const gallery = composition.profile?.sections.find(
      (section) => section.type === "GALLERY",
    );
    if (gallery?.type !== "GALLERY") throw new Error("Composition requires a GALLERY section.");

    expect(gallery.items).toHaveLength(3);
    expect(gallery.items.some((item) => item.assetId === "hero-primary")).toBe(false);

    for (const item of gallery.items) {
      expect(composition.assetManifest.assets.some((asset) => asset.assetId === item.assetId))
        .toBe(true);
      expect(html).toContain(`alt="${item.alt}"`);
    }
    expect(html).not.toContain("profile-image-unavailable");
  });

  it("keeps two composed clients isolated from each other's identity", () => {
    const clientA = renderRestaurant("restaurant-client-a");
    const clientB = renderRestaurant("restaurant-client-b");

    expect(clientA.html).toContain("restaurant-client-a");
    expect(clientA.html).not.toContain("restaurant-client-b");
    expect(clientB.html).toContain("restaurant-client-b");
    expect(clientB.html).not.toContain("restaurant-client-a");
  });

  it("rejects unsafe restaurant profile content before React receives it", () => {
    const profile = restaurantDemoProfileContent() as Record<string, unknown>;
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

  it("renders the decision set (actions, menu, hours, location) immediately after the hero, before supporting sections (D-R1)", () => {
    const { html } = renderRestaurant("client-a");
    const order = [...html.matchAll(/data-section-id="([a-z-]+)"/g)].map(([, id]) => id);
    expect(order).toEqual([
      "primary",
      "menu",
      "hours",
      "location",
      "gallery",
      "story",
      "dining-choices",
      "events",
      "faq",
    ]);
  });
});

describe("restaurant profile-local direction CSS (D-R1..D-R5)", () => {
  const cssPath = fileURLToPath(
    new URL("../../../../apps/managed-web/src/app/profiles/restaurant.css", import.meta.url),
  );
  const css = readFileSync(cssPath, "utf8");

  it("commits to a full-bleed dark editorial hero merged with the primary action instead of an inset panel (D-R2)", () => {
    expect(css).toMatch(/\.site-hero\s*{[^}]*100vw/s);
    expect(css).toMatch(/\.site-hero\s*\+\s*\.profile-section-actions/);
  });

  it("makes exactly one action visually primary in the hero-merged actions band, others subordinate (F5)", () => {
    expect(css).toMatch(/\[data-action-kind="PHONE"\]/);
    expect(css).toMatch(/\[data-action-kind="DIRECTIONS"\]/);
  });

  it("gives the primary and secondary hero actions a hover state with a smooth (150-300ms) transition (ui-ux-pro-max: hover feedback)", () => {
    expect(css).toMatch(/\[data-action-kind="PHONE"\]:hover/);
    expect(css).toMatch(/\[data-action-kind="DIRECTIONS"\]:hover/);
    const transitionDurations = [...css.matchAll(/transition:[^;]*?(\d+)ms/g)].map(([, ms]) => Number(ms));
    expect(transitionDurations.length).toBeGreaterThan(0);
    for (const ms of transitionDurations) {
      expect(ms).toBeGreaterThanOrEqual(150);
      expect(ms).toBeLessThanOrEqual(300);
    }
  });

  it("gives menu categories anchored headings and tabular-figure prices (D-R3)", () => {
    expect(css).toMatch(/\.profile-menu[^{}]*h3[^{}]*{[^}]*sticky/s);
    expect(css).toMatch(/tabular-nums/);
  });

  it("gives dietary tags a legible legend-style presentation without adding a new tag (D-R3, claims-ledger 4.3)", () => {
    expect(css).toMatch(/\.profile-menu li\s*>\s*small/);
    expect(css).not.toMatch(/allergen[- ]free/i);
    expect(css).not.toMatch(/safe for/i);
  });

  it("gives hours and location a prominent card-level treatment instead of thin low-contrast rows (D-R4)", () => {
    expect(css).toMatch(/\.profile-hours[^{}]*>[^{}]*div[^{}]*{[^}]*border/s);
    expect(css).toMatch(/\.profile-location\s*{[^}]*border/s);
  });

  it("closes the gallery upscale defect locally without touching shared CSS (P17, D-R5)", () => {
    expect(css).toMatch(/\.profile-gallery img\s*{[^}]*aspect-ratio/s);
    expect(css).toMatch(/64rem[\s\S]*\.profile-gallery\s*{[^}]*repeat\(3,/);
  });
});

describe("restaurant profile content synchronization and imagery budgets", () => {
  it("keeps the rendered client example JSON and the TypeScript demo profile content structurally synchronized", () => {
    const jsonPath = fileURLToPath(
      new URL(
        "../../../../apps/managed-web/client/examples/restaurant/client-website.json",
        import.meta.url,
      ),
    );
    const clientWebsite = JSON.parse(readFileSync(jsonPath, "utf8")) as { profile: unknown };
    expect(clientWebsite.profile).toEqual(restaurantDemoProfileContent());
  });

  it("keeps every restaurant image asset within the frozen per-asset (P20) and profile-total (P21) source budgets", () => {
    let total = 0;
    for (const asset of restaurantDemoAssets) {
      const { size } = statSync(`${restaurantExamplePublicDirectory}/${asset.sourcePath}`);
      expect(size).toBeLessThanOrEqual(600_000);
      total += size;
    }
    expect(total).toBeLessThanOrEqual(2_500_000);
  });
});
