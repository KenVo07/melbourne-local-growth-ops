import { describe, expect, it } from "vitest";

import { buildWebsiteRouteMetadataModel } from "./route-metadata-model.js";

const basePage = {
  pageId: "projects",
  path: "/projects",
  kind: "PROJECTS_INDEX",
  experienceRouteId: "projects-index",
  title: "Projects",
  metadata: {
    title: "Residential electrical projects",
    description: "Explore representative project stories.",
    openGraphImageAssetId: "projects/og",
  },
  content: { kind: "PROJECTS_INDEX" },
  anchors: [],
  relatedPageIds: [],
  search: { include: true },
} as const;

 describe("buildWebsiteRouteMetadataModel", () => {
  it("builds a canonical non-root URL and branded title", () => {
    expect(
      buildWebsiteRouteMetadataModel(
        { businessName: "Northline Electric", canonicalHostname: "northline.example.com.au" },
        basePage as never,
      ),
    ).toEqual({
      title: "Residential electrical projects | Northline Electric",
      description: "Explore representative project stories.",
      canonicalUrl: "https://northline.example.com.au/projects",
      openGraphImageAssetId: "projects/og",
    });
  });

  it("does not duplicate an existing business name", () => {
    const page = {
      ...basePage,
      path: "/",
      metadata: {
        title: "Northline Electric",
        description: "Home",
      },
    };
    expect(
      buildWebsiteRouteMetadataModel(
        { businessName: "Northline Electric", canonicalHostname: "northline.example.com.au" },
        page as never,
      ).title,
    ).toBe("Northline Electric");
  });
});
