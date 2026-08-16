import { describe, expect, it } from "vitest";

import {
  clientStaticParams,
  homePage,
  resolveClientRoute,
  segmentsToPath,
} from "../../../apps/managed-web/src/routing/resolve-client-route";

const graph = {
  schemaVersion: 1,
  homePageId: "home",
  pages: [
    { pageId: "home", path: "/" },
    { pageId: "projects", path: "/projects" },
    { pageId: "project-one", path: "/projects/project-one" },
  ],
} as never;

describe("client route resolution", () => {
  it("resolves root and nested routes", () => {
    expect(resolveClientRoute(graph, undefined)?.page.pageId).toBe("home");
    expect(resolveClientRoute(graph, ["projects"])?.page.pageId).toBe("projects");
    expect(resolveClientRoute(graph, ["projects", "project-one"])?.page.pageId).toBe("project-one");
  });

  it("returns undefined for unknown routes", () => {
    expect(resolveClientRoute(graph, ["missing"])).toBeUndefined();
  });

  it("does not normalize unsafe or malformed segments", () => {
    expect(segmentsToPath(["..", "secret"])).toBe("/__invalid-client-route__");
    expect(segmentsToPath(["Project One"])).toBe("/__invalid-client-route__");
    expect(segmentsToPath(["projects", "project-one"])).toBe("/projects/project-one");
  });

  it("generates build-time params for non-root routes", () => {
    expect(clientStaticParams(graph)).toEqual([
      { segments: ["projects"] },
      { segments: ["projects", "project-one"] },
    ]);
  });

  it("fails loudly if a validated graph loses its home page", () => {
    expect(homePage(graph).pageId).toBe("home");
    expect(() => homePage({ ...(graph as object), homePageId: "missing" } as never)).toThrow(/missing/);
  });
});
