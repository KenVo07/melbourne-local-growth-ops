import { describe, expect, it } from "vitest";

import { projectPageGraphSearchRecords } from "./page-graph-search.js";

const media = {
  assetId: "projects/one",
  role: "PROJECT",
  decorative: false,
  alt: "Illustrative project image",
  presentation: { aspect: "LANDSCAPE", fit: "COVER" },
};

const profile = {
  schemaVersion: 1,
  profile: "CONTRACTOR",
  archetype: "SERVICE_LED",
  brand: {
    eyebrow: "Electrical service",
    accentColor: "#123456",
    accentContrastColor: "#ffffff",
    surfaceColor: "#ffffff",
    textColor: "#111111",
  },
  sections: [
    {
      type: "SERVICES",
      sectionId: "services",
      heading: "Services",
      items: [{ title: "Lighting", description: "Architectural lighting planning." }],
    },
  ],
} as never;

const pageGraph = {
  schemaVersion: 1,
  homePageId: "home",
  pages: [
    {
      pageId: "home",
      path: "/",
      kind: "HOME",
      experienceRouteId: "home",
      title: "Home",
      metadata: { title: "Home", description: "Home page" },
      content: { kind: "PROFILE_SECTIONS", sectionIds: ["services"] },
      anchors: [],
      relatedPageIds: [],
      search: { include: true },
    },
    {
      pageId: "project-one",
      path: "/projects/project-one",
      kind: "PROJECT_DETAIL",
      experienceRouteId: "project-detail",
      title: "Project one",
      metadata: { title: "Project one", description: "Project story" },
      content: { kind: "PROJECT", projectId: "project-one" },
      anchors: [],
      relatedPageIds: [],
      search: { include: true, title: "Northcote lighting project" },
    },
  ],
  navigation: { primary: [], utility: [], footer: [] },
} as never;

const projects = {
  schemaVersion: 1,
  projects: [
    {
      schemaVersion: 1,
      projectId: "project-one",
      slug: "project-one",
      title: "Project one",
      summary: "Illustrative lighting concept.",
      truthMode: "DEMONSTRATION",
      demonstrationDisclosure: "Concept only, not client evidence.",
      serviceIds: ["lighting"],
      hero: media,
      gallery: [],
      facts: [{ label: "Type", value: "Residential" }],
      story: [{ blockId: "brief", type: "BRIEF", heading: "Brief", body: "Shape a calm lighting plan.", media: [] }],
      relatedProjectIds: [],
    },
  ],
} as never;

describe("projectPageGraphSearchRecords", () => {
  it("creates real multi-route URLs and Project metadata", () => {
    const records = projectPageGraphSearchRecords({
      businessName: "Northline Electric",
      profile,
      pageGraph,
      projects,
    });
    expect(records.map(({ url }) => url)).toEqual(["/", "/projects/project-one"]);
    const project = records[1];
    expect(project?.meta.projectId).toBe("project-one");
    expect(project?.content).toContain("Shape a calm lighting plan");
    expect(project?.content).toContain("Concept only");
  });

  it("omits pages the client excluded from search", () => {
    const excluded = structuredClone(pageGraph) as unknown as {
      pages: { search: { include: boolean } }[];
    };
    excluded.pages[1]!.search.include = false;
    const records = projectPageGraphSearchRecords({
      businessName: "Northline Electric",
      profile,
      pageGraph: excluded as never,
      projects,
    });
    expect(records.map(({ url }) => url)).toEqual(["/"]);
  });

  it("projects resolved service copy rather than the bare service ID", () => {
    const withService = structuredClone(pageGraph) as unknown as {
      pages: Record<string, unknown>[];
    };
    const serviceProfile = structuredClone(profile) as unknown as {
      sections: { items: Record<string, unknown>[] }[];
    };
    serviceProfile.sections[0]!.items[0]!.serviceId = "lighting";
    withService.pages.push({
      pageId: "lighting",
      path: "/services/lighting",
      kind: "SERVICE_DETAIL",
      experienceRouteId: "service-detail",
      title: "Lighting",
      metadata: { title: "Lighting", description: "Lighting service" },
      content: { kind: "SERVICE", serviceId: "lighting" },
      anchors: [],
      relatedPageIds: [],
      search: { include: true },
    });
    const records = projectPageGraphSearchRecords({
      businessName: "Northline Electric",
      profile: serviceProfile as never,
      pageGraph: withService as never,
      projects,
    });
    const service = records.find(({ url }) => url === "/services/lighting");
    expect(service?.content).toContain("Architectural lighting planning");
  });

  it("deep-freezes projected records", () => {
    const records = projectPageGraphSearchRecords({
      businessName: "Northline Electric",
      profile,
      pageGraph,
      projects,
    });
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0]?.meta)).toBe(true);
  });
});
