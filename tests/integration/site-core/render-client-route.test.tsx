import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { defineClientExperience } from "../../../apps/managed-web/src/client-experience/contract";
import { createClientExperienceRegistry } from "../../../apps/managed-web/src/client-experience/registry";
import { renderClientRoute } from "../../../apps/managed-web/src/client-experience/render-client-route";

function fixture() {
  const graph = {
    schemaVersion: 1,
    homePageId: "home",
    pages: [
      {
        pageId: "home",
        path: "/",
        kind: "HOME",
        experienceRouteId: "home",
        title: "Home",
        metadata: { title: "Home", description: "Home description" },
        content: { kind: "STATIC", contentKey: "home" },
        anchors: [],
        relatedPageIds: [],
        search: { include: true },
      },
    ],
    navigation: {
      primary: [
        {
          navigationId: "home",
          label: "Home",
          target: { kind: "ROUTE", pageId: "home" },
        },
      ],
      utility: [],
      footer: [],
    },
  } as never;
  const manifest = {
    schemaVersion: 1,
    kind: "AUTHORED_CLIENT_EXPERIENCE",
    experienceId: "reference",
    experienceVersion: "1.0.0",
    entrypoint: "index.tsx",
    designDnaPath: "design-dna.json",
    routeIds: ["home"],
    signatureIds: [],
    publicDependencies: [],
    runtime: {
      clientJavaScript: "NONE",
      motion: "NONE",
      reducedMotion: "REQUIRED",
    },
  } as never;
  const definition = defineClientExperience({
    schemaVersion: 1,
    experienceId: "reference",
    experienceVersion: "1.0.0",
    routes: {
      home: ({ site }) => <h1>{site.businessName}</h1>,
    },
  });
  return {
    graph,
    registry: createClientExperienceRegistry(definition, manifest, graph),
  };
}

describe("renderClientRoute", () => {
  it("renders the exact registered route from public props", () => {
    const { graph, registry } = fixture();
    const html = renderToStaticMarkup(
      renderClientRoute({
        routeId: "home",
        pageId: "home",
        registry,
        projection: {
          site: { clientId: "client-a", businessName: "Client A" },
          pageGraph: graph,
          profile: { sections: [] } as never,
          projects: { schemaVersion: 1, projects: [] },
          media: [],
        },
        platform: {
          Link: ({ children }) => <>{children}</>,
          Image: () => null,
          Region: () => null,
          Action: () => null,
          Search: () => null,
        },
      }),
    );
    expect(html).toBe("<h1>Client A</h1>");
  });

  it("rejects a route/page mismatch", () => {
    const { graph, registry } = fixture();
    expect(() =>
      renderClientRoute({
        routeId: "other",
        pageId: "home",
        registry,
        projection: {
          site: { clientId: "client-a", businessName: "Client A" },
          pageGraph: graph,
          profile: { sections: [] } as never,
          projects: { schemaVersion: 1, projects: [] },
          media: [],
        },
        platform: {
          Link: ({ children }) => <>{children}</>,
          Image: () => null,
          Region: () => null,
          Action: () => null,
          Search: () => null,
        },
      }),
    ).toThrow(/requires experience route/);
  });
});
