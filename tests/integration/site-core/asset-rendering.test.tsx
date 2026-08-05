import { fileURLToPath } from "node:url";

import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
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
  managedWebsiteDefinition,
} from "./fixtures";

const managedWebPublicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

describe("managed website asset rendering", () => {
  it("renders a resolved local image through Next.js with safe metadata", () => {
    const result = composeManagedWebsite(
      managedWebsiteDefinition("client-a", {
        clientId: "client-a",
        publicDirectory: managedWebPublicDirectory,
        assets: [
          {
            assetId: "hero-primary",
            kind: "IMAGE",
            sourcePath: "assets/hero/primary.png",
            mediaType: "image/png",
            width: 1672,
            height: 941,
          },
        ],
      }),
      {
        templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
        modules: createWebsiteModuleRegistry([
          analyticsContract,
          bookingCtaContract,
        ]),
      },
    );
    if (!result.success) {
      throw new Error("Valid local asset fixture must compose.");
    }

    const html = renderToStaticMarkup(
      <ManagedWebsiteShell
        composition={result.data}
        renderers={createManagedModuleRendererRegistry([bookingCtaRenderer])}
      />,
    );
    const imageMarkup = html.match(/<img [^>]+>/)?.[0];

    expect(imageMarkup).toBeDefined();
    expect(imageMarkup).toContain(
      'alt="Business client-a local electrical service illustration"',
    );
    expect(imageMarkup).toContain('width="1672"');
    expect(imageMarkup).toContain('height="941"');
    expect(imageMarkup).toContain("assets%2Fhero%2Fprimary.png");
    expect(html).toContain('rel="preload" as="image"');
    expect(imageMarkup).not.toMatch(/src="(?:https?:|data:|blob:|\/\/)/);
    expect(html).not.toContain("client-b");
  });
});
