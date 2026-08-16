import { describe, expect, it } from "vitest";

import {
  navigationHref,
  resolveWebsitePageByPath,
  staticRouteParams,
  validateWebsitePageGraph,
  type WebsitePageGraph,
} from "./page-graph.js";

function validGraph(): unknown {
  return {
    schemaVersion: 1,
    homePageId: "home",
    pages: [
      {
        pageId: "home",
        path: "/",
        kind: "HOME",
        experienceRouteId: "home",
        title: "Home",
        metadata: {
          title: "Northline Electrical",
          description: "Premium residential electrical work.",
        },
        content: { kind: "STATIC", contentKey: "home" },
        anchors: [{ anchorId: "proof", label: "Proof" }],
        relatedPageIds: ["projects"],
        search: { include: true },
      },
      {
        pageId: "projects",
        path: "/projects",
        kind: "PROJECTS_INDEX",
        experienceRouteId: "projects-index",
        title: "Projects",
        metadata: {
          title: "Projects | Northline Electrical",
          description: "Selected project stories.",
        },
        content: { kind: "PROJECTS_INDEX" },
        anchors: [],
        parentPageId: "home",
        relatedPageIds: ["project-northcote"],
        search: { include: true },
      },
      {
        pageId: "project-northcote",
        path: "/projects/northcote-residence",
        kind: "PROJECT_DETAIL",
        experienceRouteId: "project-detail",
        title: "Northcote Residence",
        metadata: {
          title: "Northcote Residence | Northline Electrical",
          description: "A fictional project story for platform acceptance.",
        },
        content: { kind: "PROJECT", projectId: "northcote-residence" },
        anchors: [{ anchorId: "gallery", label: "Gallery" }],
        parentPageId: "projects",
        relatedPageIds: ["projects"],
        search: { include: true },
      },
      {
        pageId: "contact",
        path: "/contact",
        kind: "CONTACT",
        experienceRouteId: "contact",
        title: "Contact",
        metadata: {
          title: "Contact | Northline Electrical",
          description: "Start a project conversation.",
        },
        content: { kind: "PROFILE_SECTIONS", sectionIds: ["contact", "primary"] },
        anchors: [{ anchorId: "enquiry", label: "Enquiry" }],
        parentPageId: "home",
        relatedPageIds: [],
        search: { include: false },
      },
    ],
    navigation: {
      primary: [
        { navigationId: "home", label: "Home", target: { kind: "ROUTE", pageId: "home" } },
        { navigationId: "projects", label: "Projects", target: { kind: "ROUTE", pageId: "projects" } },
      ],
      utility: [],
      footer: [
        { navigationId: "footer-proof", label: "Proof", target: { kind: "ANCHOR", pageId: "home", anchorId: "proof" } },
      ],
      primaryAction: {
        navigationId: "contact-action",
        label: "Start a project",
        target: { kind: "ROUTE", pageId: "contact" },
      },
    },
  };
}

function parsedGraph(): WebsitePageGraph {
  const result = validateWebsitePageGraph(validGraph());
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return result.data;
}

describe("validateWebsitePageGraph", () => {
  it("accepts a bounded multi-route graph and freezes it", () => {
    const result = validateWebsitePageGraph(validGraph());
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(result.data.pages).toHaveLength(4);
  });

  it("rejects the reserved API route namespace", () => {
    const changed = validGraph() as { pages: Array<Record<string, unknown>> };
    changed.pages[1]!.path = "/api";
    const result = validateWebsitePageGraph(changed);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ message }) => message.includes("reserved /api"))).toBe(true);
  });

  it("rejects duplicate page IDs", () => {
    const fixture = validGraph() as { pages: Array<Record<string, unknown>> };
    fixture.pages[1]!.pageId = "home";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.issues.some(
        ({ code, path }) =>
          code === "DUPLICATE_IDENTIFIER" && path.at(-1) === "pageId",
      ),
    ).toBe(true);
  });

  it("rejects a home page that is not mounted at the root path", () => {
    const fixture = validGraph() as {
      pages: Array<Record<string, unknown>>;
    };
    fixture.pages[0]!.path = "/welcome";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.issues.some(({ message }) => message.includes("root path /")),
    ).toBe(true);
  });

  it("rejects a home page reference that no page satisfies", () => {
    const fixture = validGraph() as { homePageId: string };
    fixture.homePageId = "missing";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.issues.some(
        ({ code, path }) =>
          code === "REFERENCE_NOT_FOUND" && path[0] === "homePageId",
      ),
    ).toBe(true);
  });

  it("rejects a root page that does not use page kind HOME", () => {
    const fixture = validGraph() as { pages: Array<Record<string, unknown>> };
    fixture.pages[0]!.kind = "STANDARD";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.issues.some(({ message }) => message.includes("page kind HOME")),
    ).toBe(true);
  });

  it("rejects duplicate navigation IDs across every navigation group", () => {
    const fixture = validGraph() as {
      navigation: { footer: Array<Record<string, unknown>> };
    };
    fixture.navigation.footer.push({
      navigationId: "projects",
      label: "Projects",
      target: { kind: "ROUTE", pageId: "projects" },
    });
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.issues.some(
        ({ code, path }) =>
          code === "DUPLICATE_IDENTIFIER" && path.at(-1) === "navigationId",
      ),
    ).toBe(true);
  });

  it("rejects duplicate paths", () => {
    const fixture = validGraph() as { pages: Array<Record<string, unknown>> };
    fixture.pages[1]!.path = "/";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ code }) => code === "DUPLICATE_IDENTIFIER")).toBe(true);
  });

  it("rejects invalid path grammar", () => {
    const fixture = validGraph() as { pages: Array<Record<string, unknown>> };
    fixture.pages[1]!.path = "/Projects/?preview=1";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
  });

  it("rejects a project page that references static content", () => {
    const fixture = validGraph() as { pages: Array<Record<string, unknown>> };
    fixture.pages[2]!.content = { kind: "STATIC", contentKey: "wrong" };
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ message }) => message.includes("PROJECT_DETAIL"))).toBe(true);
  });

  it("rejects missing navigation pages and anchors", () => {
    const fixture = validGraph() as {
      navigation: { primary: Array<Record<string, unknown>>; footer: Array<Record<string, unknown>> };
    };
    fixture.navigation.primary[0]!.target = { kind: "ROUTE", pageId: "missing" };
    fixture.navigation.footer[0]!.target = {
      kind: "ANCHOR",
      pageId: "home",
      anchorId: "missing",
    };
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.filter(({ code }) => code === "REFERENCE_NOT_FOUND")).toHaveLength(2);
  });

  it("rejects parent cycles", () => {
    const fixture = validGraph() as { pages: Array<Record<string, unknown>> };
    fixture.pages[0]!.parentPageId = "projects";
    const result = validateWebsitePageGraph(fixture);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ message }) => message.includes("cycle"))).toBe(true);
  });
});

describe("page graph helpers", () => {
  it("resolves exact normalized paths", () => {
    const graph = parsedGraph();
    expect(resolveWebsitePageByPath(graph, "/projects/")?.pageId).toBe("projects");
    expect(resolveWebsitePageByPath(graph, "/projects?from=home")?.pageId).toBe("projects");
    expect(resolveWebsitePageByPath(graph, "/missing")).toBeUndefined();
  });

  it("generates static params for all non-root routes", () => {
    expect(staticRouteParams(parsedGraph())).toEqual([
      { segments: ["projects"] },
      { segments: ["projects", "northcote-residence"] },
      { segments: ["contact"] },
    ]);
  });

  it("builds route and anchor hrefs independently from page headings", () => {
    const graph = parsedGraph();
    expect(navigationHref(graph, { kind: "ROUTE", pageId: "projects" })).toBe("/projects");
    // Navigation renders on every route, so a home anchor must keep its leading
    // route. A bare "#proof" would resolve against whatever page the visitor is
    // currently on.
    expect(navigationHref(graph, { kind: "ANCHOR", pageId: "home", anchorId: "proof" })).toBe("/#proof");
    expect(
      navigationHref(graph, {
        kind: "ANCHOR",
        pageId: "project-northcote",
        anchorId: "gallery",
      }),
    ).toBe("/projects/northcote-residence#gallery");
  });
});
