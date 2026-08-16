import { describe, expect, it } from "vitest";

import {
  validateWebsiteProfileContent,
  type WebsiteProfileContent,
} from "./profile-content.js";
import { validateWebsiteV2Model } from "./website-v2-model.js";

function pageGraph() {
  return {
    schemaVersion: 1,
    homePageId: "home",
    pages: [
      page("home", "/", "HOME", "home", { kind: "STATIC", contentKey: "home" }),
      page("projects", "/projects", "PROJECTS_INDEX", "projects-index", { kind: "PROJECTS_INDEX" }),
      page("project-one", "/projects/project-one", "PROJECT_DETAIL", "project-detail", { kind: "PROJECT", projectId: "project-one" }),
    ],
    navigation: {
      primary: [
        { navigationId: "home", label: "Home", target: { kind: "ROUTE", pageId: "home" } },
        { navigationId: "projects", label: "Projects", target: { kind: "ROUTE", pageId: "projects" } },
      ],
      utility: [],
      footer: [],
    },
  };
}

function rawProfile(serviceItems?: readonly Record<string, unknown>[]): unknown {
  return {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: "Local electrical specialists",
      accentColor: "#b94c2f",
      accentContrastColor: "#ffffff",
      surfaceColor: "#fffdf8",
      textColor: "#18201d",
    },
    sections: [
      {
        type: "SERVICES",
        sectionId: "services",
        heading: "Services",
        items: serviceItems ?? [
          { serviceId: "lighting", title: "Architectural lighting", description: "Considered lighting design and installation." },
        ],
      },
      { type: "TRUST_SIGNALS", sectionId: "trust", heading: "Trust", items: ["Fully insured"], disclaimer: "Fictional demonstration content." },
      { type: "GALLERY", sectionId: "gallery", heading: "Work", items: [{ assetId: "hero-primary", alt: "Electrician working at a switchboard" }] },
      { type: "PROCESS", sectionId: "process", heading: "Process", items: [{ title: "Talk", description: "Tell us what you need." }] },
      { type: "TESTIMONIALS", sectionId: "testimonials", heading: "Feedback", items: [{ quote: "A fictional example testimonial.", attribution: "Demo customer", disclosure: "Fictional demonstration content." }] },
      { type: "FAQ", sectionId: "faq", heading: "Questions", items: [{ question: "Where do you work?", answer: "Across inner Melbourne." }] },
      { type: "CONTACT", sectionId: "contact", heading: "Contact", body: "Call or send a basic enquiry." },
      { type: "ACTIONS", sectionId: "primary", heading: "Get started", actions: [{ actionId: "call", kind: "PHONE", state: "CONFIGURED", label: "Call us", href: "tel:+61355500001" }] },
    ],
  };
}

function profile(serviceItems?: readonly Record<string, unknown>[]): WebsiteProfileContent {
  const result = validateWebsiteProfileContent(rawProfile(serviceItems));
  if (!result.success) throw new Error(JSON.stringify(result.issues));
  return result.data;
}

function servicePage() {
  return page("lighting", "/services/lighting", "SERVICE_DETAIL", "service-detail", {
    kind: "SERVICE",
    serviceId: "lighting",
  });
}

function page(
  pageId: string,
  path: string,
  kind: string,
  experienceRouteId: string,
  content: Record<string, unknown>,
) {
  return {
    pageId,
    path,
    kind,
    experienceRouteId,
    title: pageId,
    metadata: { title: pageId, description: `Description for ${pageId}` },
    content,
    anchors: [],
    relatedPageIds: [],
    search: { include: true },
  };
}

function media(assetId: string) {
  return {
    assetId,
    role: "PROJECT",
    decorative: false,
    alt: `Illustrative ${assetId}`,
    presentation: { aspect: "LANDSCAPE", fit: "COVER" },
  };
}

function projects() {
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
        demonstrationDisclosure: "This is demonstration content, not completed client work.",
        serviceIds: ["lighting"],
        hero: media("project-one/hero"),
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

function manifest() {
  return {
    schemaVersion: 1,
    kind: "AUTHORED_CLIENT_EXPERIENCE",
    experienceId: "reference-contractor",
    experienceVersion: "1.0.0",
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

describe("validateWebsiteV2Model", () => {
  it("selects legacy mode when all authored fields are omitted", () => {
    expect(validateWebsiteV2Model({ schemaVersion: 1 })).toEqual({ success: true, data: undefined });
  });

  it("rejects v2 fields under legacy schemaVersion 1", () => {
    const result = validateWebsiteV2Model({
      schemaVersion: 1,
      pageGraph: pageGraph(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("rejects unknown top-level schema versions", () => {
    const result = validateWebsiteV2Model({ schemaVersion: 3 });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.path).toEqual(["schemaVersion"]);
  });

  it("rejects partial authored input instead of falling back", () => {
    const result = validateWebsiteV2Model({ schemaVersion: 2, pageGraph: pageGraph() });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.message).toContain("Partial v2 input");
  });

  it("accepts and freezes exact public Project/page coverage", () => {
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: pageGraph(),
      projects: projects(),
      clientExperienceManifest: manifest(),
      profile: profile(),
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data?.renderingMode).toBe("AUTHORED_CLIENT_EXPERIENCE");
    expect(Object.isFrozen(result.data)).toBe(true);
  });

  it("rejects an orphan public Project", () => {
    const graph = pageGraph();
    graph.pages = graph.pages.filter((candidate) => candidate.kind !== "PROJECT_DETAIL");
    const changedManifest = manifest();
    changedManifest.routeIds = ["home", "projects-index"];
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: changedManifest,
      profile: profile(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ message }) => message.includes("has no PROJECT_DETAIL page"))).toBe(true);
  });

  it("rejects a Project page that references missing content", () => {
    const graph = pageGraph();
    const detail = graph.pages.find((candidate) => candidate.kind === "PROJECT_DETAIL");
    if (detail === undefined) throw new Error("Fixture requires detail page.");
    detail.content = { kind: "PROJECT", projectId: "missing" };
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: manifest(),
      profile: profile(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ code }) => code === "REFERENCE_NOT_FOUND")).toBe(true);
  });

  it("requires validated profile content for authored definitions", () => {
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: pageGraph(),
      projects: projects(),
      clientExperienceManifest: manifest(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues[0]?.path).toEqual(["profile"]);
  });

  it("resolves a service detail page through an exact stable service ID", () => {
    const graph = pageGraph();
    graph.pages.push(servicePage());
    const changedManifest = manifest();
    changedManifest.routeIds = [...changedManifest.routeIds, "service-detail"];
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: changedManifest,
      profile: profile(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a service detail page whose service ID no profile item declares", () => {
    const graph = pageGraph();
    graph.pages.push(servicePage());
    const changedManifest = manifest();
    changedManifest.routeIds = [...changedManifest.routeIds, "service-detail"];
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: changedManifest,
      // The service item carries no stable serviceId at all, so no route can bind to it.
      profile: profile([
        { title: "Architectural lighting", description: "Considered lighting design and installation." },
      ]),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(
      result.issues.some(
        ({ code, path }) =>
          code === "REFERENCE_NOT_FOUND" && path.at(-1) === "serviceId",
      ),
    ).toBe(true);
  });

  it("does not fall back to display-title matching when the ID is absent", () => {
    const graph = pageGraph();
    graph.pages.push(
      page("lighting", "/services/lighting", "SERVICE_DETAIL", "service-detail", {
        kind: "SERVICE",
        // Deliberately the slugified display title. Title matching is prohibited,
        // so this must fail rather than silently resolve.
        serviceId: "architectural-lighting",
      }),
    );
    const changedManifest = manifest();
    changedManifest.routeIds = [...changedManifest.routeIds, "service-detail"];
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: changedManifest,
      profile: profile(),
    });
    expect(result.success).toBe(false);
  });

  it("keeps route identity stable when a service display title is edited", () => {
    const graph = pageGraph();
    graph.pages.push(servicePage());
    const changedManifest = manifest();
    changedManifest.routeIds = [...changedManifest.routeIds, "service-detail"];
    const renamed = profile([
      { serviceId: "lighting", title: "Lighting design and installation", description: "Considered lighting design and installation." },
    ]);
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: changedManifest,
      profile: renamed,
    });
    expect(result.success).toBe(true);
  });

  it("rejects two detail pages competing for one service ID", () => {
    const graph = pageGraph();
    graph.pages.push(servicePage());
    graph.pages.push(
      page("lighting-alias", "/services/lighting-design", "SERVICE_DETAIL", "service-detail", {
        kind: "SERVICE",
        serviceId: "lighting",
      }),
    );
    const changedManifest = manifest();
    changedManifest.routeIds = [...changedManifest.routeIds, "service-detail"];
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: graph,
      projects: projects(),
      clientExperienceManifest: changedManifest,
      profile: profile(),
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues.some(({ code }) => code === "DUPLICATE_IDENTIFIER")).toBe(true);
  });

  it("allows a service with no detail page", () => {
    const result = validateWebsiteV2Model({
      schemaVersion: 2,
      pageGraph: pageGraph(),
      projects: projects(),
      clientExperienceManifest: manifest(),
      profile: profile([
        { serviceId: "lighting", title: "Architectural lighting", description: "Considered lighting design and installation." },
        { serviceId: "switchboards", title: "Switchboard upgrades", description: "Safe, compliant switchboard replacement." },
      ]),
    });
    expect(result.success).toBe(true);
  });
});
