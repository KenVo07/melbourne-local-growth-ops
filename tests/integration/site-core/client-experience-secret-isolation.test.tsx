import { fileURLToPath } from "node:url";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import contractorInput from "../../../apps/managed-web/client/client-website.json";
import { generateClientWebsiteSnapshot } from "../../../apps/managed-web/src/generation";
import { createClientExperiencePublicProjection } from "../../../apps/managed-web/src/client-experience/public-projection";
import { renderClientRoute } from "../../../apps/managed-web/src/client-experience/render-client-route";
import { createClientExperienceRegistry } from "../../../apps/managed-web/src/client-experience/registry";
import type { ClientExperienceRouteProps } from "../../../apps/managed-web/src/client-experience/contract";

const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

/**
 * Field names that must never reach authored client source, whatever the
 * snapshot happens to carry.
 */
const forbiddenKeys = [
  "secretReferenceId",
  "runtimeSecretBindings",
  "environmentVariable",
  "connectors",
  "connectorId",
  "entitlementId",
  "modules",
  "regions",
  "assetManifest",
  "deploymentId",
  "configurationId",
  "recipients",
  "recipientAddress",
  "apiKey",
];

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

function authoredInput(): Record<string, unknown> {
  return {
    ...(contractorInput as unknown as Record<string, unknown>),
    schemaVersion: 2,
    pageGraph: {
      schemaVersion: 1,
      homePageId: "home",
      pages: [
        page("home", "/", "HOME", "home", {
          kind: "STATIC",
          contentKey: "home",
        }),
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
        ],
        utility: [],
        footer: [],
      },
    },
    projects: {
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
            assetId: "hero-primary",
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
    },
    clientExperience: {
      schemaVersion: 1,
      kind: "AUTHORED_CLIENT_EXPERIENCE",
      manifestPath: "experience/manifest.json",
    },
  };
}

function manifest(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    kind: "AUTHORED_CLIENT_EXPERIENCE",
    experienceId: "isolation-demo",
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

describe("authored client source receives no private data", () => {
  it("omits every secret, connector and commercial field from the projection", () => {
    const snapshot = generateClientWebsiteSnapshot(
      authoredInput(),
      publicDirectory,
      { clientExperienceManifest: manifest() },
    );
    if (snapshot.pageGraph === undefined || snapshot.projects === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }

    // The private snapshot really does carry the sensitive material, so the
    // assertions below are meaningful rather than vacuous.
    const privateSerialized = JSON.stringify(snapshot);
    expect(privateSerialized).toContain("secretReferenceId");
    expect(privateSerialized).toContain("connectors");

    const projection = createClientExperiencePublicProjection({
      configuration: snapshot.configuration,
      pageGraph: snapshot.pageGraph,
      profile: snapshot.profile,
      projects: snapshot.projects,
      media: [],
    });

    const serialized = JSON.stringify(projection);
    for (const key of forbiddenKeys) {
      expect(serialized).not.toContain(key);
    }
    expect(Object.keys(projection).sort()).toEqual([
      "media",
      "pageGraph",
      "profile",
      "projects",
      "site",
    ]);
    expect(Object.keys(projection.site).sort()).toEqual([
      "businessName",
      "canonicalHostname",
      "clientId",
      "tagline",
    ]);
  });

  it("omits every secret value from the serialized route props", () => {
    const snapshot = generateClientWebsiteSnapshot(
      authoredInput(),
      publicDirectory,
      { clientExperienceManifest: manifest() },
    );
    if (snapshot.pageGraph === undefined || snapshot.projects === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }

    const projection = createClientExperiencePublicProjection({
      configuration: snapshot.configuration,
      pageGraph: snapshot.pageGraph,
      profile: snapshot.profile,
      projects: snapshot.projects,
      media: [],
    });

    let captured: ClientExperienceRouteProps | undefined;
    const registry = createClientExperienceRegistry(
      {
        schemaVersion: 1,
        experienceId: "isolation-demo",
        experienceVersion: "0.1.0",
        routes: {
          home: (props) => {
            captured = props;
            return null;
          },
          "projects-index": () => null,
          "project-detail": () => null,
        },
      },
      snapshot.clientExperience as never,
      snapshot.pageGraph,
    );

    // renderClientRoute only builds the element; render it so the authored route
    // component actually receives its props.
    renderToStaticMarkup(
      renderClientRoute({
      routeId: "home",
      pageId: "home",
      projection,
      registry,
      platform: {
        Link: () => null,
        Image: () => null,
        Region: () => null,
        Action: () => null,
      },
      }),
    );

    expect(captured).toBeDefined();
    if (captured === undefined) return;

    const { platform, ...serializableProps } = captured;
    const serialized = JSON.stringify(serializableProps);
    for (const key of forbiddenKeys) {
      expect(serialized).not.toContain(key);
    }

    // Every concrete secret-bearing value from the private snapshot must be
    // absent, not merely the field names that carry them.
    for (const binding of snapshot.runtimeSecretBindings) {
      expect(serialized).not.toContain(binding.secretReferenceId);
      expect(serialized).not.toContain(binding.environmentVariable);
      expect(serialized).not.toContain(binding.connectorId);
    }
    for (const connector of snapshot.configuration.connectors) {
      expect(serialized).not.toContain(String(connector.connectorId));
    }
    expect(serialized).not.toContain(
      String(snapshot.configuration.entitlementId),
    );
    expect(serialized).not.toContain(
      String(snapshot.configuration.deploymentId),
    );
  });
});
