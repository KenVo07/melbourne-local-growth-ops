import { describe, expect, it } from "vitest";

import { quietBrief, testDefinition } from "./fixtures.js";
import { generateExperienceStarter } from "./generate.js";
import { readClientScale } from "./scale.js";

/**
 * What a client's size changes about the source that gets written, and — just
 * as importantly — what it does not change for a small one.
 *
 * P1 is the professional floor and most clients are small. A business with four
 * services and three jobs must receive exactly the site it received before this
 * work existed: no archive region, no facet rules, no reading budget, and no
 * markup for a control nobody can see.
 */

function generate(overrides: Record<string, unknown>, briefOverrides: Record<string, unknown> = {}) {
  const definition = { ...testDefinition, ...overrides };
  return generateExperienceStarter({
    definition,
    brief: { ...quietBrief, ...briefOverrides },
  });
}

function fileNamed(generated: ReturnType<typeof generate>, path: string): string {
  const found = generated.files.find((file) => file.path === path);
  expect(found, `expected ${path} to be generated`).toBeDefined();
  return found?.contents ?? "";
}

const hero = {
  assetId: "hero",
  role: "PROJECT",
  decorative: false,
  alt: "A job.",
  presentation: { aspect: "LANDSCAPE", fit: "COVER" },
} as const;

function project(index: number, extra: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    projectId: `job-${index}`,
    slug: `job-${index}`,
    title: `Job ${index}`,
    summary: "A synthetic job.",
    truthMode: "VERIFIED_CLIENT",
    serviceIds: ["first-service"],
    hero,
    gallery: [],
    facts: [],
    story: [{ blockId: "brief", type: "BRIEF", heading: "Brief", body: "A block." }],
    relatedProjectIds: [],
    featured: false,
    ...extra,
  };
}

function withProjects(count: number, featured = 0) {
  const projects = Array.from({ length: count }, (_unused, index) =>
    project(index, { featured: index < featured }),
  );
  return {
    projects: { schemaVersion: 1, projects },
    pageGraph: {
      ...testDefinition.pageGraph,
      pages: [
        ...testDefinition.pageGraph.pages,
        {
          pageId: "projects",
          path: "/projects",
          kind: "PROJECTS_INDEX",
          experienceRouteId: "projects-index",
        },
      ],
    },
  };
}

describe("a small client is untouched", () => {
  it("gets no archive, no facets and no reading budget", () => {
    const generated = generate(withProjects(3, 1));
    const route = fileNamed(generated, "routes/ProjectsRoutes.tsx");
    const styles = fileNamed(generated, "styles/site.css");
    expect(route).not.toContain("archive");
    expect(route).not.toContain("data-facet");
    expect(styles).not.toContain("-archive");
    expect(styles).not.toContain("data-facet");
  });

  it("still ships no scroll listener and no animation-frame loop", () => {
    const generated = generate(withProjects(3));
    for (const file of generated.files) {
      expect(file.contents, file.path).not.toContain("requestAnimationFrame");
      expect(file.contents, file.path).not.toContain('addEventListener("scroll"');
    }
  });

  it("keeps twelve records as one composition", () => {
    const scale = readClientScale({
      serviceIds: [],
      serviceGroupCount: 0,
      projectCount: 12,
      featuredProjectCount: 3,
    });
    expect(scale.projects.mode).toBe("CURATED");
    expect(scale.projects.archive).toBe(false);
    expect(scale.archiveBudget).toBe(0);
    expect(generate(withProjects(12, 3)).files.find((file) => file.path === "routes/ProjectsRoutes.tsx")?.contents)
      .not.toContain("archive");
  });
});

describe("an archive-scale client", () => {
  it("gets a curated set and a browsable archive, not one long page", () => {
    const generated = generate(withProjects(40, 4));
    const route = fileNamed(generated, "routes/ProjectsRoutes.tsx");
    expect(route).toContain("const curated = projects.projects.filter");
    expect(route).toContain("const archive = projects.projects;");
    expect(route).toContain("data-services=");
  });

  it("renders every record's link, so nothing is hidden from a crawler", () => {
    const route = fileNamed(generate(withProjects(40, 4)), "routes/ProjectsRoutes.tsx");
    /* The archive maps the whole collection; the budget is a CSS rule, not a slice. */
    expect(route).toContain("{archive.map((project) => (");
    expect(route).not.toContain("archive.slice(");
  });

  it("hides overflow rows in CSS and only while nothing is narrowing the set", () => {
    const styles = fileNamed(generate(withProjects(40, 4)), "styles/site.css");
    expect(styles).toContain('[data-facet="all"]:checked');
    expect(styles).toContain("#archive-show-all:checked");
    expect(styles).toContain("nth-child(n + 15)");
  });

  it("emits one facet rule per declared service and no more", () => {
    const styles = fileNamed(generate(withProjects(40, 4)), "styles/site.css");
    const rules = styles.match(/\[data-facet="[a-z-]+"\]:checked/g) ?? [];
    const facets = new Set(rules);
    /* Two services in the fixture, plus the "all" control. */
    expect(facets.size).toBe(3);
  });

  it("never puts a raw form in generated source", () => {
    for (const file of generate(withProjects(40, 4)).files) {
      expect(file.contents, file.path).not.toMatch(/<form[\s>]/);
    }
  });
});

describe("a service without a photograph", () => {
  it("generates, and the emitted narrative carries no photograph", () => {
    const generated = generate(
      {},
      {
        serviceNarratives: [
          { serviceId: "first-service", body: "What this covers.", questions: [] },
          { serviceId: "second-service", body: "What this one covers.", questions: [] },
        ],
      },
    );
    const content = fileNamed(generated, "content/site-content.ts");
    expect(content).toContain('"first-service"');
    expect(content).not.toContain("photograph: {");
    const route = fileNamed(generated, "routes/ServicesRoutes.tsx");
    expect(route).toContain("narrative?.photograph === undefined");
  });

  it("generates from decision content alone, with no brief entry at all", () => {
    const definition = {
      ...testDefinition,
      profile: {
        ...testDefinition.profile,
        sections: [
          {
            ...testDefinition.profile.sections[0],
            items: [
              {
                serviceId: "first-service",
                title: "First",
                description: "One.",
                decision: { covers: ["What is included"], excludes: ["What is not"] },
              },
              {
                serviceId: "second-service",
                title: "Second",
                description: "Two.",
                narrative: "The longer read for the second service.",
              },
            ],
          },
        ],
      },
    };
    const generated = generateExperienceStarter({
      definition,
      brief: { ...quietBrief, serviceNarratives: [] },
    });
    const route = fileNamed(generated, "routes/ServicesRoutes.tsx");
    expect(route).toContain("function Decision(");
    expect(route).toContain("What this does not cover");
  });
});

describe("navigation at scale", () => {
  const manyServices = (count: number, groups: readonly { groupId: string; title: string }[] = []) => ({
    ...testDefinition,
    profile: {
      ...testDefinition.profile,
      sections: [
        {
          ...testDefinition.profile.sections[0],
          groups,
          items: Array.from({ length: count }, (_unused, index) => ({
            serviceId: `service-${index}`,
            title: `Service ${index}`,
            description: "One.",
            narrative: "A longer read.",
            ...(groups.length > 0 ? { groupId: groups[0]?.groupId } : {}),
          })),
        },
      ],
    },
    pageGraph: {
      ...testDefinition.pageGraph,
      pages: [
        ...testDefinition.pageGraph.pages.filter((page) => page.kind !== "SERVICE_DETAIL"),
        ...Array.from({ length: count }, (_unused, index) => ({
          pageId: `service-${index}`,
          path: `/services/service-${index}`,
          kind: "SERVICE_DETAIL",
          experienceRouteId: "service-detail",
          parentPageId: "services",
        })),
      ],
    },
  });

  it("leaves a small business on a flat header", () => {
    const shell = fileNamed(
      generateExperienceStarter({ definition: manyServices(4), brief: { ...quietBrief, serviceNarratives: [] } }),
      "components/Shell.tsx",
    );
    expect(shell).not.toContain("NavigationSection");
    expect(shell).not.toContain("childPages");
  });

  it("exposes a second level once there are enough services to be worth it", () => {
    const shell = fileNamed(
      generateExperienceStarter({ definition: manyServices(9), brief: { ...quietBrief, serviceNarratives: [] } }),
      "components/Shell.tsx",
    );
    expect(shell).toContain("NavigationSection");
    /* Derived from the page graph's parent relation, never authored twice. */
    expect(shell).toContain("childPages(graph, pageId)");
  });

  it("expands a grouped business at any size", () => {
    const shell = fileNamed(
      generateExperienceStarter({
        definition: manyServices(2, [{ groupId: "power", title: "Power" }]),
        brief: { ...quietBrief, serviceNarratives: [] },
      }),
      "components/Shell.tsx",
    );
    expect(shell).toContain("NavigationSection");
  });

  it("is a disclosure, not a menu, and never opens on hover", () => {
    const generated = generateExperienceStarter({
      definition: manyServices(9),
      brief: { ...quietBrief, serviceNarratives: [] },
    });
    const shell = fileNamed(generated, "components/Shell.tsx");
    const styles = fileNamed(generated, "styles/site.css");
    expect(shell).toContain("<details className=");
    expect(shell).toContain("<summary className=");
    expect(shell).not.toContain('role="menu"');
    expect(shell).not.toContain("onMouseEnter");
    expect(styles).not.toMatch(/-nav-section:hover/);
  });

  it("caps the panel and always offers the whole set", () => {
    const shell = fileNamed(
      generateExperienceStarter({ definition: manyServices(20), brief: { ...quietBrief, serviceNarratives: [] } }),
      "components/Shell.tsx",
    );
    expect(shell).toContain("NAVIGATION_PANEL_LIMIT = 8");
    expect(shell).toContain("selected.slice(0, NAVIGATION_PANEL_LIMIT)");
    expect(shell).toContain("All {item.label.toLowerCase()}");
  });

  it("offers only selected records, never the whole archive", () => {
    const shell = fileNamed(
      generateExperienceStarter({ definition: manyServices(9), brief: { ...quietBrief, serviceNarratives: [] } }),
      "components/Shell.tsx",
    );
    expect(shell).toContain('page.content.kind !== "PROJECT" || featured.has');
  });
});

describe("a grouped service list", () => {
  it("renders a heading level per group", () => {
    const definition = {
      ...testDefinition,
      profile: {
        ...testDefinition.profile,
        sections: [
          {
            ...testDefinition.profile.sections[0],
            groups: [{ groupId: "power", title: "Power" }],
            items: [
              {
                serviceId: "first-service",
                title: "First",
                description: "One.",
                groupId: "power",
                decision: { covers: ["What is included"] },
              },
              {
                serviceId: "second-service",
                title: "Second",
                description: "Two.",
                narrative: "The longer read for the second service.",
              },
            ],
          },
        ],
      },
    };
    const route = fileNamed(
      generateExperienceStarter({ definition, brief: quietBrief }),
      "routes/ServicesRoutes.tsx",
    );
    expect(route).toContain("const groups = sections.flatMap((section) => section.groups)");
    expect(route).toContain("-group-title");
    expect(route).toContain('key: "ungrouped"');
  });
});
