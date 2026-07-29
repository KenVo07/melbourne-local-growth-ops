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
    ]);

    const [clientA, clientB] = await Promise.all(
      ["client-a", "client-b"].map(async (clientId) => {
        const result = composeManagedWebsite(
          managedWebsiteDefinition(clientId),
          registries,
        );
        if (!result.success) {
          throw new Error(`Valid ${clientId} fixture must compose.`);
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
    expect(clientA).not.toContain("client-b");
    expect(clientB).toContain("Business client-b");
    expect(clientB).toContain("booking-client-b");
    expect(clientB).not.toContain("client-a");
  });
});
