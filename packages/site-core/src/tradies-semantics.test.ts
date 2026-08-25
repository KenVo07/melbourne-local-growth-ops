import { describe, expect, it } from "vitest";

import {
  deriveProjectFacets,
  deservesServiceDetailRoute,
  resolveNavigationPlan,
  resolveProjectPresentation,
  resolveServicePresentation,
  serviceDecisionDepth,
} from "./collection-scale.js";
import {
  featuredServices,
  groupedServices,
  validateWebsiteProfileContent,
  type WebsiteProfileContent,
  type WebsiteServiceItem,
} from "./profile-content.js";
import {
  featuredProjects,
  projectsForService,
  validateWebsiteProjectCollection,
  type WebsiteProjectCollection,
} from "./project-content.js";

/**
 * Tradies semantics: service decision content, one-level service groups,
 * project archive fields, and the cardinality policy that reads them.
 *
 * Every fixture here is synthetic and named for a fictional trade. None of it
 * carries any real client's truth, and nothing in it is a default: these are
 * shapes the contract must accept or refuse, not content the Factory ships.
 */

const brand = {
  eyebrow: "Synthetic fixture",
  accentColor: "#8a3324",
  accentContrastColor: "#ffffff",
  surfaceColor: "#ffffff",
  textColor: "#1a1a1a",
} as const;

function contractorProfile(
  services: readonly Record<string, unknown>[],
  groups: readonly Record<string, unknown>[] = [],
): unknown {
  return {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand,
    sections: [
      {
        type: "SERVICES",
        sectionId: "services",
        heading: "What we do",
        items: services,
        ...(groups.length > 0 ? { groups } : {}),
      },
      {
        type: "TRUST_SIGNALS",
        sectionId: "trust",
        heading: "Credentials",
        items: ["Synthetic fixture credential"],
      },
      {
        type: "PROCESS",
        sectionId: "process",
        heading: "How it works",
        items: [{ title: "Call", description: "A synthetic process step." }],
      },
      {
        type: "FAQ",
        sectionId: "faq",
        heading: "Questions",
        items: [{ question: "Do you?", answer: "A synthetic answer." }],
      },
      {
        type: "CONTACT",
        sectionId: "contact",
        heading: "Get in touch",
        body: "A synthetic contact body.",
      },
      {
        type: "ACTIONS",
        sectionId: "actions",
        heading: "Direct contact",
        actions: [
          {
            actionId: "call-office",
            kind: "PHONE",
            state: "CONFIGURED",
            label: "Call",
            href: "tel:+61300000000",
          },
        ],
      },
    ],
  };
}

function validProfile(
  services: readonly Record<string, unknown>[],
  groups: readonly Record<string, unknown>[] = [],
): WebsiteProfileContent {
  const result = validateWebsiteProfileContent(contractorProfile(services, groups));
  if (!result.success) {
    throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.data;
}

function service(
  serviceId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    serviceId,
    title: `Service ${serviceId}`,
    description: "A synthetic service description.",
    ...overrides,
  };
}

const hero = {
  assetId: "synthetic-hero",
  role: "PROJECT",
  decorative: false,
  alt: "A synthetic project photograph.",
  presentation: { aspect: "LANDSCAPE", fit: "COVER" },
} as const;

function project(
  index: number,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    projectId: `job-${index}`,
    slug: `job-${index}`,
    title: `Job ${index}`,
    summary: "A synthetic job summary.",
    truthMode: "VERIFIED_CLIENT",
    serviceIds: ["switchboard"],
    hero,
    story: [
      {
        blockId: "brief",
        type: "BRIEF",
        heading: "Brief",
        body: "A synthetic story block.",
      },
    ],
    ...overrides,
  };
}

function collection(
  projects: readonly Record<string, unknown>[],
): WebsiteProjectCollection {
  const result = validateWebsiteProjectCollection({
    schemaVersion: 1,
    projects,
  });
  if (!result.success) {
    throw new Error(`fixture invalid: ${JSON.stringify(result.issues)}`);
  }
  return result.data;
}

function many(count: number, make: (index: number) => Record<string, unknown>) {
  return Array.from({ length: count }, (_unused, index) => make(index));
}

describe("service decision content", () => {
  it("accepts a service that answers every decision question", () => {
    const profile = validProfile([
      service("switchboard", {
        narrative: "The longer read a detail route opens with.",
        decision: {
          suitedTo: ["Fuses that keep tripping"],
          covers: ["Board replacement"],
          excludes: ["Solar inverter faults"],
          whenToCall: ["Burning smell at the board"],
          stages: [{ title: "Attend", description: "A synthetic stage." }],
          customerProvides: ["Access to the meter box"],
          commercial: [
            { label: "Call-out", value: "$0", qualifier: "Waived on acceptance" },
          ],
          questions: [{ question: "How long?", answer: "A synthetic answer." }],
          nextActionId: "call-office",
        },
      }),
    ]);
    const item = profile.sections.flatMap((section) =>
      section.type === "SERVICES" ? section.items : [],
    )[0] as WebsiteServiceItem;
    expect(item.decision?.excludes).toEqual(["Solar inverter faults"]);
    expect(item.decision?.nextActionId).toBe("call-office");
  });

  it("leaves a service with no decision truth entirely valid", () => {
    const profile = validProfile([service("switchboard")]);
    const item = profile.sections.flatMap((section) =>
      section.type === "SERVICES" ? section.items : [],
    )[0] as WebsiteServiceItem;
    expect(item.decision).toBeUndefined();
    expect(item.featured).toBe(false);
  });

  it("refuses a next action the business has not declared", () => {
    const result = validateWebsiteProfileContent(
      contractorProfile([
        service("switchboard", { decision: { nextActionId: "book-online" } }),
      ]),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map(({ message }) => message).join(" ")).toContain(
      'Service next action "book-online" is not declared',
    );
  });
});

describe("service groups", () => {
  it("collects services under their declared group and leaves the rest ungrouped", () => {
    const profile = validProfile(
      [
        service("switchboard", { groupId: "power" }),
        service("rewiring", { groupId: "power" }),
        service("ev-charger", {}),
      ],
      [{ groupId: "power", title: "Power and wiring" }],
    );
    const grouped = groupedServices(profile);
    expect(grouped.groups).toHaveLength(1);
    expect(grouped.groups[0]?.services.map(({ serviceId }) => serviceId)).toEqual([
      "switchboard",
      "rewiring",
    ]);
    expect(grouped.ungrouped.map(({ serviceId }) => serviceId)).toEqual([
      "ev-charger",
    ]);
  });

  it("refuses a service pointing at an undeclared group", () => {
    const result = validateWebsiteProfileContent(
      contractorProfile([service("switchboard", { groupId: "power" })]),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map(({ message }) => message).join(" ")).toContain(
      'Service group "power" is not declared',
    );
  });

  it("refuses a declared group that no service belongs to", () => {
    const result = validateWebsiteProfileContent(
      contractorProfile(
        [service("switchboard")],
        [{ groupId: "power", title: "Power and wiring" }],
      ),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map(({ message }) => message).join(" ")).toContain(
      'Service group "power" contains no services',
    );
  });

  it("refuses a duplicated group identifier", () => {
    const result = validateWebsiteProfileContent(
      contractorProfile(
        [service("switchboard", { groupId: "power" })],
        [
          { groupId: "power", title: "Power" },
          { groupId: "power", title: "Power again" },
        ],
      ),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.map(({ message }) => message).join(" ")).toContain(
      'Service group ID "power" is duplicated',
    );
  });

  it("has no way to express a second level of nesting", () => {
    const result = validateWebsiteProfileContent(
      contractorProfile(
        [service("switchboard", { groupId: "power" })],
        [{ groupId: "power", title: "Power", parentGroupId: "trades" }],
      ),
    );
    expect(result.success).toBe(false);
  });
});

describe("project archive fields", () => {
  it("carries an authored featured flag and a known completion year", () => {
    const projects = collection([
      project(1, { featured: true, completedYear: 2024 }),
      project(2),
    ]);
    expect(featuredProjects(projects).map(({ projectId }) => projectId)).toEqual([
      "job-1",
    ]);
    expect(projects.projects[0]?.completedYear).toBe(2024);
    expect(projects.projects[1]?.completedYear).toBeUndefined();
    expect(projects.projects[1]?.featured).toBe(false);
  });

  it("reads the service relation backwards", () => {
    const projects = collection([
      project(1, { serviceIds: ["switchboard", "rewiring"] }),
      project(2, { serviceIds: ["rewiring"] }),
    ]);
    expect(
      projectsForService(projects, "rewiring").map(({ projectId }) => projectId),
    ).toEqual(["job-1", "job-2"]);
    expect(projectsForService(projects, "ev-charger")).toEqual([]);
  });
});

describe("project presentation at every cardinality", () => {
  const cases = [
    { count: 1, mode: "CURATED", archive: false, filtering: false },
    { count: 3, mode: "CURATED", archive: false, filtering: false },
    { count: 5, mode: "CURATED", archive: false, filtering: false },
    { count: 8, mode: "CURATED", archive: false, filtering: true },
    { count: 12, mode: "CURATED", archive: false, filtering: true },
    { count: 13, mode: "TRANSITIONAL", archive: true, filtering: true },
    { count: 24, mode: "TRANSITIONAL", archive: true, filtering: true },
    { count: 25, mode: "ARCHIVE", archive: true, filtering: true },
    { count: 30, mode: "ARCHIVE", archive: true, filtering: true },
    { count: 100, mode: "ARCHIVE", archive: true, filtering: true },
  ] as const;

  for (const expected of cases) {
    it(`resolves ${expected.count} projects as ${expected.mode}`, () => {
      const plan = resolveProjectPresentation(
        collection(many(expected.count, (index) => project(index))),
      );
      expect(plan.mode).toBe(expected.mode);
      expect(plan.archive).toBe(expected.archive);
      expect(plan.filtering).toBe(expected.filtering);
      expect(plan.total).toBe(expected.count);
    });
  }

  it("reveals progressively only once the set is an archive", () => {
    expect(
      resolveProjectPresentation(collection(many(12, (i) => project(i))))
        .retrieval,
    ).toBe("NONE");
    const archive = resolveProjectPresentation(
      collection(many(60, (i) => project(i))),
    );
    expect(archive.retrieval).toBe("PROGRESSIVE");
    expect(archive.initialArchiveCount).toBeGreaterThan(0);
    expect(archive.initialArchiveCount).toBeLessThan(archive.total);
  });

  it("does not look broken with a single project", () => {
    const plan = resolveProjectPresentation(collection([project(1)]));
    expect(plan.mode).toBe("CURATED");
    expect(plan.archive).toBe(false);
    expect(plan.initialArchiveCount).toBe(0);
  });
});

describe("derived project facets", () => {
  it("derives service facets from the existing relation, never a declared vocabulary", () => {
    const profile = validProfile([
      service("switchboard"),
      service("rewiring"),
      service("ev-charger"),
    ]);
    const projects = collection([
      project(1, { serviceIds: ["switchboard"], locationLabel: "Brunswick" }),
      project(2, { serviceIds: ["rewiring"], locationLabel: "Coburg" }),
      project(3, { serviceIds: ["rewiring"], locationLabel: "Brunswick" }),
    ]);
    const facets = deriveProjectFacets(profile, projects);
    const services = facets.find(({ kind }) => kind === "SERVICE");
    expect(services?.values.map(({ facetId }) => facetId)).toEqual([
      "switchboard",
      "rewiring",
    ]);
    expect(services?.values.find(({ facetId }) => facetId === "rewiring")?.count).toBe(2);
    expect(facets.find(({ kind }) => kind === "LOCATION")?.values).toHaveLength(2);
  });

  it("omits a facet that would offer one option", () => {
    const profile = validProfile([service("switchboard")]);
    const projects = collection([
      project(1, { locationLabel: "Brunswick" }),
      project(2, { locationLabel: "Brunswick" }),
    ]);
    const facets = deriveProjectFacets(profile, projects);
    expect(facets.find(({ kind }) => kind === "SERVICE")).toBeUndefined();
    expect(facets.find(({ kind }) => kind === "LOCATION")).toBeUndefined();
  });

  it("omits the year facet when no project states a year", () => {
    const profile = validProfile([service("switchboard"), service("rewiring")]);
    const projects = collection([
      project(1, { serviceIds: ["switchboard"] }),
      project(2, { serviceIds: ["rewiring"] }),
    ]);
    expect(
      deriveProjectFacets(profile, projects).find(({ kind }) => kind === "YEAR"),
    ).toBeUndefined();
  });
});

describe("service presentation and detail-route depth", () => {
  it("reports an ungrouped list that has outgrown flat presentation", () => {
    const profile = validProfile(
      many(11, (index) => service(`service-${index}`)),
    );
    const plan = resolveServicePresentation(profile);
    expect(plan.mode).toBe("FLAT");
    expect(plan.total).toBe(11);
    expect(plan.ungroupedAtScale).toBe(true);
  });

  it("does not report eight peers as a problem", () => {
    expect(
      resolveServicePresentation(
        validProfile(many(8, (index) => service(`service-${index}`))),
      ).ungroupedAtScale,
    ).toBe(false);
  });

  it("counts kinds of answer, not words", () => {
    const thin = validProfile([service("switchboard")]);
    const thinItem = thin.sections.flatMap((section) =>
      section.type === "SERVICES" ? section.items : [],
    )[0] as WebsiteServiceItem;
    expect(serviceDecisionDepth(thinItem, 0)).toBe(0);
    expect(deservesServiceDetailRoute(thinItem, 0)).toBe(false);
    /* One project of evidence alone is still one answer. */
    expect(deservesServiceDetailRoute(thinItem, 1)).toBe(false);

    const rich = validProfile([
      service("switchboard", {
        narrative: "A longer read.",
        decision: { covers: ["Board replacement"] },
      }),
    ]);
    const richItem = rich.sections.flatMap((section) =>
      section.type === "SERVICES" ? section.items : [],
    )[0] as WebsiteServiceItem;
    expect(serviceDecisionDepth(richItem, 0)).toBe(2);
    expect(deservesServiceDetailRoute(richItem, 0)).toBe(true);
  });

  it("refuses a detail route to a service with no stable identity", () => {
    const profile = validProfile([
      {
        title: "Unnamed",
        description: "A synthetic service description.",
        narrative: "A longer read.",
        decision: { covers: ["Something"] },
      },
    ]);
    const item = profile.sections.flatMap((section) =>
      section.type === "SERVICES" ? section.items : [],
    )[0] as WebsiteServiceItem;
    expect(deservesServiceDetailRoute(item, 3)).toBe(false);
  });
});

describe("navigation plan", () => {
  it("keeps a small business on a simple header", () => {
    const profile = validProfile(many(4, (index) => service(`service-${index}`)));
    const projects = collection(many(3, (index) => project(index)));
    const plan = resolveNavigationPlan(profile, projects, 4);
    expect(plan.services).toBe("SIMPLE");
    expect(plan.projects).toBe("SIMPLE");
    expect(plan.primaryAtLimit).toBe(false);
  });

  it("expands services once the structure is worth exposing", () => {
    const profile = validProfile(many(9, (index) => service(`service-${index}`)));
    const projects = collection(many(3, (index) => project(index)));
    expect(resolveNavigationPlan(profile, projects, 4).services).toBe("EXPANDED");
  });

  it("expands services for a grouped business of any size", () => {
    const profile = validProfile(
      [
        service("switchboard", { groupId: "power" }),
        service("rewiring", { groupId: "power" }),
      ],
      [{ groupId: "power", title: "Power" }],
    );
    const projects = collection([project(1)]);
    expect(resolveNavigationPlan(profile, projects, 3).services).toBe("EXPANDED");
  });

  it("never puts a whole archive into a dropdown", () => {
    const profile = validProfile(many(4, (index) => service(`service-${index}`)));
    const projects = collection(
      many(50, (index) => project(index, { featured: index < 4 })),
    );
    const plan = resolveNavigationPlan(profile, projects, 4);
    expect(plan.projects).toBe("EXPANDED");
    expect(plan.projectPanelItems).toHaveLength(4);
    expect(plan.projectPanelItems.length).toBeLessThan(projects.projects.length);
  });

  it("leaves the projects panel simple when nothing was selected for it", () => {
    const profile = validProfile(many(4, (index) => service(`service-${index}`)));
    const projects = collection(many(50, (index) => project(index)));
    expect(resolveNavigationPlan(profile, projects, 4).projects).toBe("SIMPLE");
  });

  it("prefers the agency's featured services in an ungrouped panel", () => {
    const profile = validProfile(
      many(9, (index) => service(`service-${index}`, { featured: index < 3 })),
    );
    expect(featuredServices(profile)).toHaveLength(3);
    const plan = resolveNavigationPlan(profile, collection([project(1)]), 4);
    expect(plan.servicePanelItems).toHaveLength(3);
  });

  it("reports a primary bar at the limit of a flat header", () => {
    const profile = validProfile([service("switchboard")]);
    expect(
      resolveNavigationPlan(profile, collection([project(1)]), 6).primaryAtLimit,
    ).toBe(true);
  });
});
