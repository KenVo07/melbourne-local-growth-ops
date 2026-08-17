import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";

import authoredExperience from "../../fixtures/web01b/neutral-v2/experience/index";
import { generateClientWebsiteSnapshot } from "../../../apps/managed-web/src/generation";
import { createClientExperiencePlatformComponents } from "../../../apps/managed-web/src/client-experience/platform-components";
import { createClientExperiencePublicProjection } from "../../../apps/managed-web/src/client-experience/public-projection";
import { createClientExperienceRegistry } from "../../../apps/managed-web/src/client-experience/registry";
import { renderClientRoute } from "../../../apps/managed-web/src/client-experience/render-client-route";
import { resolveClientExperienceMedia } from "../../../apps/managed-web/src/client-experience/resolve-media";
import {
  clientStaticParams,
  segmentsToPath,
} from "../../../apps/managed-web/src/routing/resolve-client-route";
import { buildManagedRouteMetadata } from "../../../apps/managed-web/src/structured-data";
import type { ClientWebsiteSnapshot } from "../../../apps/managed-web/src/generation";
import type {
  RuntimeExternalAction,
  RuntimePageDefinition,
} from "../../../apps/managed-web/src/runtime-types";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/web01b/neutral-v2", import.meta.url),
);
const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

let snapshot: ClientWebsiteSnapshot;

beforeAll(async () => {
  const definition = JSON.parse(
    await readFile(`${fixtureRoot}/client-website.json`, "utf8"),
  ) as unknown;
  const manifest = JSON.parse(
    await readFile(`${fixtureRoot}/experience/manifest.json`, "utf8"),
  ) as unknown;
  snapshot = generateClientWebsiteSnapshot(definition, publicDirectory, {
    clientExperienceManifest: manifest,
  });
});

function requireAuthored() {
  const { pageGraph, projects, clientExperience, profile, assetManifest } =
    snapshot;
  if (
    pageGraph === undefined ||
    projects === undefined ||
    clientExperience === undefined ||
    assetManifest === undefined
  ) {
    throw new Error("Fixture must produce a complete authored snapshot.");
  }
  return { pageGraph, projects, clientExperience, profile, assetManifest };
}

function renderPath(path: string): string {
  const { pageGraph, projects, clientExperience, profile, assetManifest } =
    requireAuthored();
  const page = pageGraph.pages.find((candidate) => candidate.path === path);
  if (page === undefined) throw new Error(`No validated page for ${path}.`);

  const media = resolveClientExperienceMedia(
    assetManifest,
    projects,
    pageGraph.pages,
  );
  const projection = createClientExperiencePublicProjection({
    configuration: snapshot.configuration,
    pageGraph,
    profile,
    projects,
    media,
  });
  const registry = createClientExperienceRegistry(
    authoredExperience,
    clientExperience,
    pageGraph,
  );
  const actions = new Map<string, RuntimeExternalAction>(
    profile.sections.flatMap((section) =>
      section.type === "ACTIONS"
        ? section.actions.map(
            (action) => [action.actionId, action] as const,
          )
        : [],
    ),
  );
  const platform = createClientExperiencePlatformComponents({
    media,
    actions,
    knownRegionIds: new Set(snapshot.regions.map(({ regionId }) => regionId)),
    renderRegion: (regionId) => `[region:${regionId}]`,
  });

  return renderToStaticMarkup(
    renderClientRoute({
      routeId: page.experienceRouteId,
      pageId: page.pageId,
      projection,
      registry,
      platform,
    }),
  );
}

/**
 * Guards the multi-route runtime against regression without needing a manual
 * staging run. The fixture is deliberately undesigned: these assertions are
 * about routing, resolution, truthfulness and metadata, never about craft.
 */
describe("authored multi-route rendering", () => {
  it("selects the authored rendering mode for the v2 fixture", () => {
    expect(snapshot.schemaVersion).toBe(2);
    expect(snapshot.renderingMode).toBe("AUTHORED_CLIENT_EXPERIENCE");
  });

  it("generates every non-root route and excludes the root", () => {
    const { pageGraph } = requireAuthored();
    const paths = clientStaticParams(pageGraph).map(({ segments }) =>
      segmentsToPath([...segments]),
    );

    expect(paths).toEqual([
      "/services",
      "/services/architectural-lighting",
      "/projects",
      "/projects/northcote-residence",
      "/projects/brighton-house",
      "/projects/kew-renovation",
      "/about",
      "/contact",
    ]);
    expect(paths).not.toContain("/");
  });

  it("resolves no page for an unknown path, which is what makes it a 404", () => {
    const { pageGraph } = requireAuthored();
    for (const unknown of ["/does-not-exist", "/projects/nope", "/a/b/c"]) {
      expect(
        pageGraph.pages.some((page) => page.path === unknown),
      ).toBe(false);
    }
  });

  it("gives every route a unique title, description and canonical URL", () => {
    const { pageGraph } = requireAuthored();
    const metadata = pageGraph.pages.map((page: RuntimePageDefinition) =>
      buildManagedRouteMetadata(snapshot, page),
    );
    const canonicals = metadata.map(
      (entry) => entry.alternates?.canonical as string,
    );
    const titles = metadata.map(
      (entry) => (entry.title as { absolute: string }).absolute,
    );

    expect(new Set(canonicals).size).toBe(canonicals.length);
    expect(new Set(titles).size).toBe(titles.length);
    expect(canonicals[0]).toMatch(/^https:\/\/[^/]+$/);
    expect(canonicals).toContain(
      `${canonicals[0]}/projects/northcote-residence`,
    );
    // The business name appears exactly once per title.
    for (const title of titles) {
      expect(title.split("Harbour Electrical & Air")).toHaveLength(2);
    }
  });

  it("renders materially different content per route", () => {
    const home = renderPath("/");
    const projects = renderPath("/projects");
    const detail = renderPath("/projects/northcote-residence");

    expect(home).toContain("<h1>Home</h1>");
    expect(projects).toContain("<h1>Projects</h1>");
    expect(detail).toContain("<h1>Northcote Residence</h1>");
    expect(new Set([home, projects, detail]).size).toBe(3);
  });

  it("renders three distinct project detail routes", () => {
    const slugs = [
      "northcote-residence",
      "brighton-house",
      "kew-renovation",
    ] as const;
    const rendered = slugs.map((slug) => renderPath(`/projects/${slug}`));

    expect(new Set(rendered).size).toBe(3);
    expect(rendered[0]).toContain("Northcote Residence");
    expect(rendered[1]).toContain("Brighton House");
    expect(rendered[2]).toContain("Kew Renovation");
  });

  it("always discloses demonstration projects", () => {
    const { projects } = requireAuthored();
    for (const project of projects.projects) {
      expect(project.truthMode).toBe("DEMONSTRATION");
      const markup = renderPath(`/projects/${project.slug}`);
      expect(markup).toContain('data-disclosure="demonstration"');
      expect(markup).toContain("not completed client work");
    }
  });

  it("carries the ordered story, facts and relationships", () => {
    const markup = renderPath("/projects/northcote-residence");
    expect(markup.indexOf("Brief")).toBeLessThan(markup.indexOf("Approach"));
    expect(markup.indexOf("Approach")).toBeLessThan(markup.indexOf("Outcome"));
    expect(markup).toContain("Related projects");
    expect(markup).toContain("Project sequence");
    expect(markup).toContain("Brighton House");
  });

  it("renders client-owned media with responsive focal points", () => {
    const markup = renderPath("/projects/northcote-residence");
    expect(markup).toContain("Illustrative hero image for Northcote Residence");
    expect(markup).toContain("--platform-media-position-desktop:50% 45%");
    expect(markup).toContain("--platform-media-position-mobile:60% 40%");
  });

  it("binds a service detail route to an exact stable service ID", () => {
    const markup = renderPath("/services/architectural-lighting");
    expect(markup).toContain('data-service-id="architectural-lighting"');
  });

  it("renders validated external actions and a module region on contact", () => {
    const markup = renderPath("/contact");
    expect(markup).toContain("data-platform-action");
    expect(markup).toContain('data-platform-region="primary"');
    expect(markup).toContain("[region:primary]");
  });

  it("renders navigation labels that are independent from page headings", () => {
    const { pageGraph } = requireAuthored();
    const labels = pageGraph.navigation.primary.map(({ label }) => label);
    const headings = pageGraph.pages.map(({ title }) => title);

    expect(labels).toEqual(["Services", "Projects", "About", "Contact"]);
    // The Projects heading and its nav label may coincide, but a long editorial
    // page title must never be forced to serve as a navigation label.
    expect(
      labels.every((label) => label.length <= 24),
    ).toBe(true);
    expect(headings).toContain("Northcote Residence");
    expect(labels).not.toContain("Northcote Residence");
  });
});
