import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import contractorInput from "../../../apps/managed-web/client/client-website.json";
import {
  generateClientWebsiteSnapshot,
  parseDefinitionInput,
} from "../../../apps/managed-web/src/generation";

const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

const clientExperienceReference = {
  schemaVersion: 1,
  kind: "AUTHORED_CLIENT_EXPERIENCE",
  manifestPath: "experience/manifest.json",
} as const;

function manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "AUTHORED_CLIENT_EXPERIENCE",
    experienceId: "authored-demo",
    experienceVersion: "0.1.0",
    entrypoint: "index.tsx",
    designDnaPath: "design-dna.json",
    routeIds: ["home", "projects-index", "project-detail"],
    signatureIds: [],
    publicDependencies: [],
    runtime: {
      clientJavaScript: "NONE",
      motion: "NONE",
      reducedMotion: "REQUIRED",
    },
  };
}

function page(
  pageId: string,
  path: string,
  kind: string,
  experienceRouteId: string,
  content: Record<string, unknown>,
): Record<string, unknown> {
  return {
    pageId,
    path,
    kind,
    experienceRouteId,
    title: pageId,
    metadata: { title: pageId, description: `Route description for ${pageId}.` },
    content,
    anchors: [],
    relatedPageIds: [],
    search: { include: true },
  };
}

function pageGraph(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    homePageId: "home",
    pages: [
      page("home", "/", "HOME", "home", { kind: "STATIC", contentKey: "home" }),
      page("projects", "/projects", "PROJECTS_INDEX", "projects-index", {
        kind: "PROJECTS_INDEX",
      }),
      page(
        "project-one",
        "/projects/project-one",
        "PROJECT_DETAIL",
        "project-detail",
        { kind: "PROJECT", projectId: "project-one" },
      ),
    ],
    navigation: {
      primary: [
        {
          navigationId: "nav-home",
          label: "Home",
          target: { kind: "ROUTE", pageId: "home" },
        },
        {
          navigationId: "nav-projects",
          label: "Projects",
          target: { kind: "ROUTE", pageId: "projects" },
        },
      ],
      utility: [],
      footer: [],
    },
  };
}

function projects(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projects: [
      {
        schemaVersion: 1,
        projectId: "project-one",
        slug: "project-one",
        title: "Project one",
        summary: "Illustrative demonstration project.",
        truthMode: "DEMONSTRATION",
        demonstrationDisclosure:
          "Concept work created to prove the platform, not completed client work.",
        serviceIds: ["repairs"],
        hero: {
          assetId: "projects/project-one/hero",
          role: "PROJECT",
          decorative: false,
          alt: "Illustrative project hero image",
          presentation: { aspect: "LANDSCAPE", fit: "COVER" },
        },
        gallery: [],
        facts: [],
        story: [
          {
            blockId: "brief",
            type: "BRIEF",
            heading: "Brief",
            body: "A fictional brief used to prove route and story architecture.",
            media: [],
          },
        ],
        relatedProjectIds: [],
      },
    ],
  };
}

function authoredInput(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ...(contractorInput as unknown as Record<string, unknown>),
    schemaVersion: 2,
    pageGraph: pageGraph(),
    projects: projects(),
    clientExperience: clientExperienceReference,
    ...overrides,
  };
}

describe("authored client definition parsing and snapshot dispatch", () => {
  it("keeps the accepted legacy definition on the legacy shell", () => {
    const snapshot = generateClientWebsiteSnapshot(
      contractorInput,
      publicDirectory,
    );

    expect(snapshot.schemaVersion).toBe(1);
    expect(snapshot.renderingMode).toBe("LEGACY_SHELL");
    expect(snapshot.pageGraph).toBeUndefined();
    expect(snapshot.projects).toBeUndefined();
    expect(snapshot.clientExperience).toBeUndefined();
    expect(snapshot.provenance).not.toHaveProperty("clientExperience");
  });

  it("carries authored data through parse, JSON round trip and snapshot", () => {
    const parsed = parseDefinitionInput(authoredInput());
    const reRead = JSON.parse(JSON.stringify(parsed)) as unknown;
    const snapshot = generateClientWebsiteSnapshot(reRead, publicDirectory, {
      clientExperienceManifest: manifest(),
    });

    expect(parsed.schemaVersion).toBe(2);
    expect(parsed.clientExperience).toEqual(clientExperienceReference);
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.renderingMode).toBe("AUTHORED_CLIENT_EXPERIENCE");
    expect(snapshot.pageGraph?.pages.map(({ path }) => path)).toEqual([
      "/",
      "/projects",
      "/projects/project-one",
    ]);
    expect(snapshot.projects?.projects[0]?.projectId).toBe("project-one");
    expect(snapshot.clientExperience?.experienceId).toBe("authored-demo");
    expect(snapshot.provenance.clientExperience).toMatchObject({
      experienceId: "authored-demo",
      experienceVersion: "0.1.0",
      routeCount: 3,
      projectCount: 1,
    });
    expect(Object.isFrozen(snapshot.pageGraph)).toBe(true);
    expect(Object.isFrozen(snapshot.projects)).toBe(true);
  });

  it("rejects authored fields carried by a legacy schemaVersion 1 definition", () => {
    expect(() =>
      parseDefinitionInput(authoredInput({ schemaVersion: 1 })),
    ).toThrow(/schemaVersion 1 and cannot contain/);
  });

  it("rejects partial authored input rather than downgrading it", () => {
    expect(() =>
      parseDefinitionInput(authoredInput({ projects: undefined })),
    ).toThrow(/Partial authored input cannot fall back/);
    expect(() =>
      parseDefinitionInput(authoredInput({ clientExperience: undefined })),
    ).toThrow(/Partial authored input cannot fall back/);
    expect(() =>
      parseDefinitionInput(authoredInput({ pageGraph: undefined })),
    ).toThrow(/Partial authored input cannot fall back/);
  });

  it("rejects an unknown top-level schema version", () => {
    expect(() => parseDefinitionInput(authoredInput({ schemaVersion: 3 }))).toThrow(
      /schemaVersion 1 or 2/,
    );
  });

  it("rejects a manifest reference that names any other path", () => {
    expect(() =>
      generateClientWebsiteSnapshot(
        authoredInput({
          clientExperience: {
            ...clientExperienceReference,
            manifestPath: "../../etc/manifest.json",
          },
        }),
        publicDirectory,
        { clientExperienceManifest: manifest() },
      ),
    ).toThrow(/manifestPath/);
  });

  it("requires the referenced manifest contents to be supplied by the caller", () => {
    expect(() =>
      generateClientWebsiteSnapshot(authoredInput(), publicDirectory),
    ).toThrow(/contents were not supplied/);
  });

  it("rejects manifest contents supplied without a declared reference", () => {
    expect(() =>
      generateClientWebsiteSnapshot(contractorInput, publicDirectory, {
        clientExperienceManifest: manifest(),
      }),
    ).toThrow(/declares no clientExperience reference/);
  });

  it("fails a route coverage mismatch instead of rendering a stale route", () => {
    const stale = manifest();
    stale.routeIds = ["home", "projects-index"];

    expect(() =>
      generateClientWebsiteSnapshot(authoredInput(), publicDirectory, {
        clientExperienceManifest: stale,
      }),
    ).toThrow(/route coverage must exactly match/);
  });

  it("fails a project detail page that references missing content", () => {
    const graph = pageGraph();
    (graph.pages as Record<string, unknown>[])[2]!.content = {
      kind: "PROJECT",
      projectId: "does-not-exist",
    };

    expect(() =>
      generateClientWebsiteSnapshot(
        authoredInput({ pageGraph: graph }),
        publicDirectory,
        { clientExperienceManifest: manifest() },
      ),
    ).toThrow(/missing project "does-not-exist"/);
  });

  it("produces a deterministic snapshot for identical authored input", () => {
    const first = generateClientWebsiteSnapshot(
      authoredInput(),
      publicDirectory,
      { clientExperienceManifest: manifest() },
    );
    const second = generateClientWebsiteSnapshot(
      authoredInput(),
      publicDirectory,
      { clientExperienceManifest: manifest() },
    );

    expect(JSON.stringify(first)).toEqual(JSON.stringify(second));
  });
});
