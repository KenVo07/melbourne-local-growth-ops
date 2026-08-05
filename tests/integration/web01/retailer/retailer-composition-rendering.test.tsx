import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
} from "@melbourne-local-growth-ops/site-core";
import { retailerTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  createManagedModuleRendererRegistry,
  ManagedWebsiteShell,
} from "../../../../apps/managed-web/src/rendering";
import { analyticsRenderer } from "../../../../apps/managed-web/src/rendering/analytics-renderer";
import { leadFormRenderer } from "../../../../apps/managed-web/src/rendering/lead-form-renderer";
import {
  analyticsContract,
  leadFormContract,
  managedWebsiteDefinition,
} from "../../../fixtures/web01/retailer/fixtures";

const here = dirname(fileURLToPath(import.meta.url));
const retailerPublicDirectory = resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "managed-web",
  "public",
  "examples",
  "retailer",
);

const registries = {
  templates: createWebsiteTemplateRegistry([retailerTemplateV1]),
  modules: createWebsiteModuleRegistry([leadFormContract, analyticsContract]),
};

const renderers = createManagedModuleRendererRegistry([
  leadFormRenderer,
  analyticsRenderer,
]);

function renderRetailerSite(clientId: string, withAssets = false) {
  const definition = managedWebsiteDefinition(
    clientId,
    withAssets
      ? {
          clientId,
          publicDirectory: retailerPublicDirectory,
          assets: [
            {
              assetId: "hero-primary",
              kind: "IMAGE",
              sourcePath: "assets/hero/primary.png",
              mediaType: "image/png",
              width: 1600,
              height: 900,
            },
            {
              assetId: "ceramic-vase",
              kind: "IMAGE",
              sourcePath: "assets/products/ceramic-vase.png",
              mediaType: "image/png",
              width: 1000,
              height: 1000,
            },
          ],
        }
      : undefined,
  );
  const result = composeManagedWebsite(definition, registries);
  if (!result.success) {
    throw new Error(
      `Retailer fixture must compose: ${JSON.stringify(result.issues)}`,
    );
  }
  return {
    composition: result.data,
    html: renderToStaticMarkup(
      <ManagedWebsiteShell composition={result.data} renderers={renderers} />,
    ),
  };
}

describe("retailer catalogue/trust rendering", () => {
  it("renders distinct RETAILER identity attributes and catalogue sections", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html).toContain('data-profile="RETAILER"');
    expect(html).toContain('data-archetype="CATALOGUE_LED"');
    expect(html).toContain('data-section-type="COLLECTIONS"');
    expect(html).toContain('data-section-type="PRODUCTS"');
    expect(html).toContain('data-section-type="POLICIES"');
    expect(html).toContain('data-section-type="HOURS"');
    expect(html).toContain('data-section-type="LOCATION"');
    expect(html).toContain('data-section-type="STORY"');
    expect(html).toContain('data-section-type="ACTIONS"');
    expect(html).toContain("Shop by category at client-a");
  });

  it("renders semantic headings and landmark structure for catalogue content", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html.match(/<h2[^>]*id="profile-section-/g)?.length).toBeGreaterThan(5);
    expect(html).toContain('aria-labelledby="profile-section-featured-products"');
    expect(html).toContain("<address");
  });

  it("resolves the hero asset to a real image exactly once", () => {
    const { html } = renderRetailerSite("client-a", true);

    expect(html).toMatch(/data-asset-id="hero-primary"[^]*?<img/);
    expect(html.match(/data-asset-id="hero-primary"/g)).toHaveLength(1);
  });

  it("resolves a product's assetId to a real image through the shared asset seam", () => {
    const { html } = renderRetailerSite("client-a", true);

    expect(html).toMatch(/data-asset-id="ceramic-vase"[^]*?<img/);
  });

  it("shows the truthful unavailable-image fallback, not a broken image, for a product assetId the asset context cannot resolve", () => {
    const { html } = renderRetailerSite("client-a", true);

    expect(html).toContain('data-asset-id="missing-product-asset"');
    expect(html).toMatch(
      /data-asset-id="missing-product-asset"[^]*?profile-image-unavailable/,
    );
  });

  it("truthfully shows the unavailable fallback (never a broken image) for every declared assetId when no assets are configured at all", () => {
    const { html } = renderRetailerSite("client-a", false);

    expect(html.match(/profile-image-unavailable/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).not.toContain("<img");
  });

  it("gives truthful treatment to the not-configured PURCHASE action without a link", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html).toContain('data-action-kind="PURCHASE"');
    expect(html).toContain('data-action-state="NOT_CONFIGURED"');
    expect(html).toContain(
      "Online purchase is not yet configured for this fictional demonstration store.",
    );
    expect(html).not.toMatch(/data-action-kind="PURCHASE"[^]*?<a /);
  });

  it("renders the configured PHONE action as a real tel link using an ACMA-reserved fictional number", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html).toMatch(
      /<a[^>]*data-action-kind="PHONE"[^>]*href="tel:\+61355500200"/,
    );
  });

  it("renders a functional HTTPS directions link for the fictional demo address", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html).toContain(
      '<a href="https://www.google.com/maps/search/?api=1&amp;query=1+Example+Street%2C+Melbourne+VIC+3000">Get directions</a>',
    );
  });

  it("compresses the page: drops the standalone FAQ section and merges new-arrivals into featured-products", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html).not.toContain('data-section-type="FAQ"');
    expect(html.match(/data-section-id="[a-z-]+"/g)?.length).toBeLessThanOrEqual(11);
  });

  it("places the policies section ahead of promotions/trust as a selling point, not page overflow", () => {
    const { html } = renderRetailerSite("client-a");

    const policiesIndex = html.indexOf('data-section-id="policies"');
    const promotionsIndex = html.indexOf('data-section-id="promotions"');
    expect(policiesIndex).toBeGreaterThan(-1);
    expect(promotionsIndex).toBeGreaterThan(-1);
    expect(policiesIndex).toBeLessThan(promotionsIndex);
  });

  it("gives the testimonial a plausible fictional customer voice, not implementation vocabulary", () => {
    const { html } = renderRetailerSite("client-a");

    expect(html).not.toContain("Example customer evidence treatment");
    expect(html).not.toContain("placeholder demonstration copy");
    expect(html).toContain("Illustrative Customer Voices");
    expect(html).toMatch(/Illustrative customer voice/);
    expect(html).toContain("profile-disclaimer");
    for (const forbidden of ["★", "stars", "rating", "5/5", "verified purchase"]) {
      expect(html.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the trust disclaimer in the same rendered block as the trust items it qualifies, without repeated parentheticals", () => {
    const { html } = renderRetailerSite("client-a");

    const trustSectionMatch = html.match(
      /<section[^>]*data-section-type="TRUST_SIGNALS"[^]*?<\/section>/,
    );
    expect(trustSectionMatch).not.toBeNull();
    const trustSection = trustSectionMatch?.[0] ?? "";
    expect(trustSection).not.toContain("(fictional demonstration claim)");
    expect(trustSection).toContain("profile-disclaimer");
    expect(trustSection).toContain("is a fictional demonstration retailer");
  });

  it("contains no cart, checkout, or payment surface", () => {
    const { html } = renderRetailerSite("client-a");

    for (const forbidden of [
      "add to cart",
      "checkout",
      "card number",
      "payment",
    ]) {
      expect(html.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("keeps two retailer clients isolated end to end", () => {
    const clientA = renderRetailerSite("client-a");
    const clientB = renderRetailerSite("client-b");

    expect(clientA.html).toContain("client-a");
    expect(clientA.html).not.toContain("client-b");
    expect(clientB.html).toContain("client-b");
    expect(clientB.html).not.toContain("client-a");
    expect(JSON.stringify(clientA.composition)).not.toContain("client-b");
    expect(JSON.stringify(clientB.composition)).not.toContain("client-a");
  });
});

interface MinimalPlaywrightPage {
  setContent(html: string): Promise<void>;
  evaluate<T>(pageFunction: () => T): Promise<T>;
}
interface MinimalPlaywrightContext {
  newPage(): Promise<MinimalPlaywrightPage>;
  close(): Promise<void>;
}
interface MinimalPlaywrightBrowser {
  newContext(options: {
    viewport: { width: number; height: number };
  }): Promise<MinimalPlaywrightContext>;
  close(): Promise<void>;
}

const require_ = createRequire(
  resolve(here, "..", "..", "..", "..", "apps", "managed-web", "package.json"),
);
const { chromium } = require_("@playwright/test") as {
  chromium: { launch(): Promise<MinimalPlaywrightBrowser> };
};

const globalsCssPath = resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "managed-web",
  "src",
  "app",
  "globals.css",
);
const retailerCssPath = resolve(
  here,
  "..",
  "..",
  "..",
  "..",
  "apps",
  "managed-web",
  "src",
  "app",
  "profiles",
  "retailer.css",
);

/**
 * Renders the real `globals.css` + `retailer.css` source (read live from
 * disk, not copied or paraphrased) against a synthetic product grid with
 * `itemCount` cards, so the D-T2 regression test below measures actual
 * browser-computed flexbox geometry, not source-text presence.
 */
function productGridHtml(itemCount: number): string {
  const globalsCss = readFileSync(globalsCssPath, "utf8").replaceAll(
    /@import[^;]+;/g,
    "",
  );
  const retailerCss = readFileSync(retailerCssPath, "utf8");
  const items = Array.from(
    { length: itemCount },
    (_, index) =>
      `<li data-asset-id="product-${index}"><h3>Product ${index + 1}</h3><p>Fictional demonstration product copy.</p><p class="profile-price">$10.00</p></li>`,
  ).join("");
  return `<!doctype html><html><head><style>${globalsCss}\n${retailerCss}</style></head><body>
    <main class="managed-site" data-profile="RETAILER" data-archetype="CATALOGUE_LED">
      <ul class="profile-product-grid">${items}</ul>
    </main>
  </body></html>`;
}

describe("retailer product grid layout — D-T2 regression (real computed geometry, not source presence)", () => {
  let browser: MinimalPlaywrightBrowser;

  beforeAll(async () => {
    browser = await chromium.launch();
  }, 30_000);

  afterAll(async () => {
    await browser.close();
  });

  it.each([5, 6, 7, 8, 9])(
    "centers an incomplete final row instead of stranding or oversizing it, for %i products at 1440x900 and 1920x1080",
    async (itemCount) => {
      for (const viewport of [
        { width: 1440, height: 900 },
        { width: 1920, height: 1080 },
      ] as const) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        await page.setContent(productGridHtml(itemCount));

        const measurement = await page.evaluate(() => {
          const container = document.querySelector(".profile-product-grid");
          if (container === null) throw new Error("grid container missing");
          const containerBox = container.getBoundingClientRect();
          const items = [...document.querySelectorAll(".profile-product-grid > li")].map(
            (li) => {
              const box = li.getBoundingClientRect();
              return { top: Math.round(box.top), left: box.left, right: box.right, width: box.width };
            },
          );
          return { containerLeft: containerBox.left, containerRight: containerBox.right, items };
        });

        const rows = new Map<number, typeof measurement.items>();
        for (const item of measurement.items) {
          const bucket = rows.get(item.top) ?? [];
          bucket.push(item);
          rows.set(item.top, bucket);
        }
        const lastRow = [...rows.values()].at(-1);
        if (lastRow === undefined) throw new Error("no rows measured");

        const rowLeft = Math.min(...lastRow.map((row) => row.left));
        const rowRight = Math.max(...lastRow.map((row) => row.right));
        const leftGap = rowLeft - measurement.containerLeft;
        const rightGap = measurement.containerRight - rowRight;

        // Not stranded: an incomplete final row is centered — leftover space
        // is split evenly on both sides, never dumped entirely on one side
        // (which is what a stranded/orphaned card looks like).
        expect(
          Math.abs(leftGap - rightGap),
          `viewport ${viewport.width}x${viewport.height}, ${itemCount} items: last row leftGap=${leftGap} rightGap=${rightGap} should be ~equal (centered), not stranded to one side`,
        ).toBeLessThan(2);

        // Not oversized: every card in the last row keeps its fixed 16rem
        // (256px) card size instead of growing to fill leftover row space.
        for (const row of lastRow) {
          expect(
            row.width,
            `viewport ${viewport.width}x${viewport.height}, ${itemCount} items: card width ${row.width}px should stay at the fixed ~256px card size, not grow to fill the row`,
          ).toBeLessThanOrEqual(257);
        }

        await context.close();
      }
    },
    30_000,
  );
});
