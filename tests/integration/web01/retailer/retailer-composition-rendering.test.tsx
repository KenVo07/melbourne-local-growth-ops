import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
} from "@melbourne-local-growth-ops/site-core";
import { retailerTemplateV1 } from "@melbourne-local-growth-ops/templates";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

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

  it("resolves the hero asset to a real image exactly once, with no unavailable fallback", () => {
    const { html } = renderRetailerSite("client-a", true);

    expect(html).not.toContain("profile-image-unavailable");
    expect(html).toMatch(/data-asset-id="hero-primary"[^]*?<img/);
    expect(html.match(/data-asset-id="hero-primary"/g)).toHaveLength(1);
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
