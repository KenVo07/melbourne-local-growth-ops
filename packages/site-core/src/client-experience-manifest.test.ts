import { describe, expect, it } from "vitest";

import {
  validateClientExperienceManifest,
  validateClientExperienceManifestForPageGraph,
} from "./client-experience-manifest.js";
import { validateWebsitePageGraph } from "./page-graph.js";

function graph() {
  const result = validateWebsitePageGraph({
    schemaVersion: 1,
    homePageId: "home",
    pages: [
      {
        pageId: "home",
        path: "/",
        kind: "HOME",
        experienceRouteId: "home",
        title: "Home",
        metadata: { title: "Home", description: "Home page." },
        content: { kind: "STATIC", contentKey: "home" },
        anchors: [],
        relatedPageIds: [],
        search: { include: true },
      },
      {
        pageId: "projects",
        path: "/projects",
        kind: "PROJECTS_INDEX",
        experienceRouteId: "projects-index",
        title: "Projects",
        metadata: { title: "Projects", description: "Projects index." },
        content: { kind: "PROJECTS_INDEX" },
        anchors: [],
        parentPageId: "home",
        relatedPageIds: [],
        search: { include: true },
      },
      {
        pageId: "project-one",
        path: "/projects/project-one",
        kind: "PROJECT_DETAIL",
        experienceRouteId: "project-detail",
        title: "Project One",
        metadata: { title: "Project One", description: "Project detail." },
        content: { kind: "PROJECT", projectId: "project-one" },
        anchors: [],
        parentPageId: "projects",
        relatedPageIds: [],
        search: { include: true },
      },
    ],
    navigation: {
      primary: [
        { navigationId: "home", label: "Home", target: { kind: "ROUTE", pageId: "home" } },
        { navigationId: "projects", label: "Projects", target: { kind: "ROUTE", pageId: "projects" } },
      ],
      utility: [],
      footer: [],
    },
  });
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return result.data;
}

function manifest(): unknown {
  return {
    schemaVersion: 1,
    kind: "AUTHORED_CLIENT_EXPERIENCE",
    experienceId: "northline-reference",
    experienceVersion: "1.0.0",
    entrypoint: "index.tsx",
    designDnaPath: "design-dna.json",
    routeIds: ["home", "projects-index", "project-detail"],
    signatureIds: ["project-reveal"],
    publicDependencies: [{ name: "motion", version: "12.43.0" }],
    runtime: {
      clientJavaScript: "COMPONENT_SCOPED",
      motion: "CLIENT_LIBRARY",
      reducedMotion: "REQUIRED",
    },
  };
}

describe("client experience manifest", () => {
  it("accepts exact route coverage and pinned dependencies", () => {
    const result = validateClientExperienceManifestForPageGraph(manifest(), graph());
    expect(result.success).toBe(true);
  });

  it("rejects ranges instead of exact dependency versions", () => {
    const fixture = manifest() as {
      publicDependencies: Array<{ name: string; version: string }>;
    };
    fixture.publicDependencies[0]!.version = "^12.43.0";
    expect(validateClientExperienceManifest(fixture).success).toBe(false);
  });

  it("rejects missing and stale route declarations", () => {
    const fixture = manifest() as { routeIds: string[] };
    fixture.routeIds = ["home", "unused"];
    const result = validateClientExperienceManifestForPageGraph(fixture, graph());
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.message).toContain("Missing: project-detail, projects-index");
    expect(result.issues[0]?.message).toContain("unreferenced: unused");
  });

  it("rejects duplicate signature IDs", () => {
    const input = manifest() as { signatureIds: string[] };
    input.signatureIds = ["project-reveal", "project-reveal"];
    const result = validateClientExperienceManifest(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ path }) => path[0] === "signatureIds")).toBe(true);
  });

  it("rejects duplicate route IDs", () => {
    const input = manifest() as { routeIds: string[] };
    input.routeIds = ["home", "home"];
    const result = validateClientExperienceManifest(input);
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ path }) => path[0] === "routeIds")).toBe(true);
  });

  it("rejects duplicate dependency names", () => {
    const fixture = manifest() as {
      publicDependencies: Array<{ name: string; version: string }>;
    };
    fixture.publicDependencies.push({ name: "motion", version: "12.43.0" });
    const result = validateClientExperienceManifestForPageGraph(fixture, graph());
    expect(result.success).toBe(false);
  });

  it("rejects client-library motion without client JavaScript", () => {
    const fixture = manifest() as {
      runtime: { clientJavaScript: string; motion: string; reducedMotion: string };
    };
    fixture.runtime.clientJavaScript = "NONE";
    const result = validateClientExperienceManifestForPageGraph(fixture, graph());
    expect(result.success).toBe(false);
  });
});
