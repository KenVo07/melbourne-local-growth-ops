import { readFile } from "node:fs/promises";
import { join } from "node:path";
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
import { analyticsRenderer } from "../../../apps/managed-web/src/rendering/analytics-renderer";
import { bookingCtaRenderer } from "../../../apps/managed-web/src/rendering/booking-cta-renderer";
import {
  analyticsContract,
  bookingCtaContract,
  managedWebsiteDefinition,
} from "./fixtures";

const managedWebPublicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

describe("managed website client isolation", () => {
  it("keeps concurrent composition and rendered HTML client-specific", async () => {
    const registries = {
      templates: createWebsiteTemplateRegistry([contractorTemplateV1]),
      modules: createWebsiteModuleRegistry([
        analyticsContract,
        bookingCtaContract,
      ]),
    };
    const renderers = createManagedModuleRendererRegistry([
      bookingCtaRenderer,
      analyticsRenderer,
    ]);

    const clientConfigs = [
      {
        clientId: "client-a",
        measurementId: "G-CLIENTA123",
        domain: "client-a.example.com.au",
      },
      {
        clientId: "client-b",
        measurementId: "G-CLIENTB456",
        domain: "client-b.example.com.au",
      },
    ];

    const [clientA, clientB] = await Promise.all(
      clientConfigs.map(async (cfg) => {
        const def = managedWebsiteDefinition(cfg.clientId, {
          clientId: cfg.clientId,
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
        });

        const rawConfig = def.configuration as {
          connectors: Array<Record<string, unknown>>;
          domains: Array<Record<string, unknown>>;
        };

        rawConfig.connectors = rawConfig.connectors.map((conn) =>
          conn.type === "GOOGLE_ANALYTICS_4"
            ? { ...conn, measurementId: cfg.measurementId }
            : conn,
        );
        rawConfig.domains = [{ hostname: cfg.domain, canonical: true }];

        const result = composeManagedWebsite(def, registries);
        if (!result.success) {
          throw new Error(`Valid ${cfg.clientId} fixture must compose.`);
        }

        return renderToStaticMarkup(
          <ManagedWebsiteShell
            composition={result.data}
            renderers={renderers}
          />,
        );
      }),
    );

    expect(clientA).toContain("Business client-a");
    expect(clientA).toContain("booking-client-a");
    expect(clientA).toContain("analytics-client-a");
    expect(clientA).toContain("client-a.example.com.au");
    expect(clientA).toContain(
      "Business client-a local electrical service illustration",
    );
    expect(clientA).not.toContain("client-b");
    expect(clientA).not.toContain("client-b.example.com.au");
    expect(clientA).not.toContain("analytics-client-b");

    expect(clientB).toContain("Business client-b");
    expect(clientB).toContain("booking-client-b");
    expect(clientB).toContain("analytics-client-b");
    expect(clientB).toContain("client-b.example.com.au");
    expect(clientB).toContain(
      "Business client-b local electrical service illustration",
    );
    expect(clientB).not.toContain("client-a");
    expect(clientB).not.toContain("client-a.example.com.au");
    expect(clientB).not.toContain("analytics-client-a");
  });
});

describe("profile CSS ownership isolation", () => {
  const profilesDirectory = fileURLToPath(
    new URL("../../../apps/managed-web/src/app/profiles/", import.meta.url),
  );
  const profileFiles: Record<string, string> = {
    CONTRACTOR: "contractor.css",
    RESTAURANT: "restaurant.css",
    RETAILER: "retailer.css",
  };

  it("keeps each profile-local stylesheet scoped to its own profile selector only", async () => {
    for (const [profile, filename] of Object.entries(profileFiles)) {
      const css = await readFile(join(profilesDirectory, filename), "utf8");
      expect(css).toContain(`data-profile="${profile}"`);
      for (const otherProfile of Object.keys(profileFiles)) {
        if (otherProfile === profile) continue;
        expect(css).not.toContain(`data-profile="${otherProfile}"`);
      }
    }
  });
});
