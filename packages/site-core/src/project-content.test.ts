import { describe, expect, it } from "vitest";

import {
  projectById,
  projectBySlug,
  validateWebsiteProjectCollection,
} from "./project-content.js";

function media(assetId: string) {
  return {
    assetId,
    role: "PROJECT",
    decorative: false,
    alt: `Representative image for ${assetId}`,
    presentation: {
      aspect: "LANDSCAPE",
      fit: "COVER",
      focalPoint: { x: 0.5, y: 0.5 },
    },
  };
}

function project(projectId: string, relatedProjectIds: string[] = []) {
  return {
    schemaVersion: 1,
    projectId,
    slug: projectId,
    title: `Project ${projectId}`,
    summary: "A fictional project used to prove page and storytelling contracts.",
    truthMode: "DEMONSTRATION",
    demonstrationDisclosure:
      "Fictional demonstration project. It is not evidence of completed client work.",
    serviceIds: ["architectural-lighting"],
    locationLabel: "Melbourne",
    hero: media(`${projectId}/hero`),
    gallery: [media(`${projectId}/gallery-1`)],
    facts: [{ label: "Project type", value: "Fictional residential concept" }],
    story: [
      {
        blockId: "brief",
        type: "BRIEF",
        heading: "Brief",
        body: "Demonstrate a substantial project narrative without making a real-world claim.",
        media: [],
      },
    ],
    relatedProjectIds,
  };
}

describe("website project collection", () => {
  it("accepts and freezes a truthful demonstration collection", () => {
    const result = validateWebsiteProjectCollection({
      schemaVersion: 1,
      projects: [
        project("northcote-residence", ["brighton-house"]),
        project("brighton-house", ["northcote-residence"]),
      ],
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(Object.isFrozen(result.data)).toBe(true);
    expect(projectById(result.data, "northcote-residence")?.title).toContain("northcote");
    expect(projectBySlug(result.data, "brighton-house")?.projectId).toBe("brighton-house");
  });

  it("requires disclosure for fictional work", () => {
    const fixture = project("northcote-residence") as Record<string, unknown>;
    delete fixture.demonstrationDisclosure;
    const result = validateWebsiteProjectCollection({ schemaVersion: 1, projects: [fixture] });
    expect(result.success).toBe(false);
  });

  it("rejects demonstration disclosure on verified client work", () => {
    const fixture = project("northcote-residence") as Record<string, unknown>;
    fixture.truthMode = "VERIFIED_CLIENT";
    const result = validateWebsiteProjectCollection({ schemaVersion: 1, projects: [fixture] });
    expect(result.success).toBe(false);
  });

  it("rejects duplicate IDs and slugs", () => {
    const result = validateWebsiteProjectCollection({
      schemaVersion: 1,
      projects: [project("same"), project("same")],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.filter(({ code }) => code === "DUPLICATE_IDENTIFIER").length).toBeGreaterThanOrEqual(2);
  });

  it("rejects missing, duplicate and self related-project references", () => {
    const result = validateWebsiteProjectCollection({
      schemaVersion: 1,
      projects: [project("northcote", ["northcote", "missing", "missing"])],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ code }) => code === "REFERENCE_NOT_FOUND")).toBe(true);
    expect(result.issues.some(({ message }) => message.includes("cannot relate to itself"))).toBe(true);
  });

  it("rejects duplicate story block IDs", () => {
    const fixture = project("northcote") as { story: unknown[] };
    fixture.story.push({
      blockId: "brief",
      type: "APPROACH",
      heading: "Approach",
      body: "Duplicate ID should fail.",
      media: [],
    });
    const result = validateWebsiteProjectCollection({ schemaVersion: 1, projects: [fixture] });
    expect(result.success).toBe(false);
  });
});
