import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { generateClientWebsiteSnapshot } from "../../../apps/managed-web/src/generation";
import {
  ClientExperienceMediaError,
  resolveClientExperienceMedia,
} from "../../../apps/managed-web/src/client-experience/resolve-media";
import {
  buildManagedRouteMetadata,
  buildManagedWebsiteJsonLd,
} from "../../../apps/managed-web/src/structured-data";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/web01b/neutral-v2", import.meta.url),
);
const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);

let definitionText: string;
let manifest: unknown;

beforeAll(async () => {
  definitionText = await readFile(
    `${fixtureRoot}/client-website.json`,
    "utf8",
  );
  manifest = JSON.parse(
    await readFile(`${fixtureRoot}/experience/manifest.json`, "utf8"),
  ) as unknown;
});

function definition(
  mutate: (value: Record<string, unknown>) => void = () => undefined,
): Record<string, unknown> {
  const value = JSON.parse(definitionText) as Record<string, unknown>;
  mutate(value);
  return value;
}

function snapshotOf(value: Record<string, unknown>) {
  return generateClientWebsiteSnapshot(value, publicDirectory, {
    clientExperienceManifest: manifest,
  });
}

describe("client-owned media replaces the legacy fixed slots", () => {
  it("carries no template asset slot on the authored path", () => {
    const snapshot = snapshotOf(definition());

    // The Contractor template hard-codes hero and gallery slots with
    // template-authored alt text. That is a legacy-adapter behaviour and must
    // not reach an authored client, which owns its own media semantics.
    expect(snapshot.assets).toEqual([]);
  });

  it("keeps the template asset slots on the legacy path", async () => {
    const legacy = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL(
            "../../../apps/managed-web/client/client-website.json",
            import.meta.url,
          ),
        ),
        "utf8",
      ),
    ) as unknown;
    const snapshot = generateClientWebsiteSnapshot(legacy, publicDirectory);

    expect(snapshot.renderingMode).toBe("LEGACY_SHELL");
    expect(snapshot.assets.length).toBeGreaterThan(0);
    expect(snapshot.assets.some(({ slotId }) => slotId === "hero")).toBe(true);
  });

  it("resolves arbitrary client-owned asset IDs, not a fixed slot vocabulary", () => {
    // Rename every asset to an ID the Contractor template has never heard of.
    const snapshot = snapshotOf(
      definition((value) => {
        const renamed = JSON.parse(
          JSON.stringify(value).replaceAll(
            "hero-primary",
            "studio-northcote-frame-07",
          ),
        ) as Record<string, unknown>;
        for (const key of Object.keys(value)) delete value[key];
        Object.assign(value, renamed);
      }),
    );

    if (snapshot.projects === undefined || snapshot.pageGraph === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }
    const media = resolveClientExperienceMedia(
      snapshot.assetManifest!,
      snapshot.projects,
      snapshot.pageGraph.pages,
    );

    // Every validated client asset is resolvable, not only the ones a project
    // references, because an authored route legitimately uses site-level media.
    expect(media).toHaveLength(1);
    expect(media[0]?.reference.assetId).toBe("studio-northcote-frame-07");
    expect(media[0]?.src).toContain("/assets/hero/primary.png");
    expect(media[0]?.width).toBe(1672);
    // Alt text is supplied per usage by the reference the route passes, never
    // by the template and never by this resolution map, which only carries the
    // asset's file facts. PlatformImage's own tests cover that binding.
    expect(media[0]?.reference.alt).toContain("Illustrative");
  });

  it("fails generation when a project references media the manifest lacks", () => {
    const snapshot = snapshotOf(definition());
    if (snapshot.projects === undefined || snapshot.pageGraph === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }

    expect(() =>
      resolveClientExperienceMedia(
        { schemaVersion: 1, clientId: "x", assets: [] },
        snapshot.projects!,
        snapshot.pageGraph!.pages,
      ),
    ).toThrow(ClientExperienceMediaError);

    // The failure names the exact reference at fault so it is actionable.
    try {
      resolveClientExperienceMedia(
        { schemaVersion: 1, clientId: "x", assets: [] },
        snapshot.projects,
        snapshot.pageGraph.pages,
      );
    } catch (error) {
      expect(error).toBeInstanceOf(ClientExperienceMediaError);
      const media = error as ClientExperienceMediaError;
      expect(media.assetId).toBe("hero-primary");
      expect(media.referencedBy).toContain("northcote-residence");
      expect(media.referencedBy).toContain("hero");
    }
  });

  it("fails generation when an Open Graph asset ID does not exist", () => {
    const snapshot = snapshotOf(definition());
    if (snapshot.projects === undefined || snapshot.pageGraph === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }
    const pages = snapshot.pageGraph.pages.map((page, index) =>
      index === 0
        ? {
            ...page,
            metadata: { ...page.metadata, openGraphImageAssetId: "missing/og" },
          }
        : page,
    );

    expect(() =>
      resolveClientExperienceMedia(
        snapshot.assetManifest!,
        snapshot.projects!,
        pages,
      ),
    ).toThrow(/missing\/og/);
  });

  it("fails generation when a project detail page references a missing project", () => {
    expect(() =>
      snapshotOf(
        definition((value) => {
          const graph = value.pageGraph as {
            pages: Record<string, unknown>[];
          };
          const detail = graph.pages.find(
            (page) => page.pageId === "project-northcote-residence",
          );
          if (detail === undefined) throw new Error("Fixture page missing.");
          detail.content = { kind: "PROJECT", projectId: "never-existed" };
        }),
      ),
    ).toThrow(/never-existed/);
  });

  it("fails generation when a service detail page references a missing service", () => {
    expect(() =>
      snapshotOf(
        definition((value) => {
          const graph = value.pageGraph as {
            pages: Record<string, unknown>[];
          };
          const detail = graph.pages.find(
            (page) => page.pageId === "service-lighting",
          );
          if (detail === undefined) throw new Error("Fixture page missing.");
          detail.content = { kind: "SERVICE", serviceId: "not-a-service" };
        }),
      ),
    ).toThrow(/not-a-service/);
  });
});

describe("structured data makes no unverifiable claim", () => {
  it("emits no review, rating, licence, award or result claim", () => {
    const snapshot = snapshotOf(definition());
    const jsonLd = buildManagedWebsiteJsonLd(snapshot);
    const serialized = JSON.stringify(jsonLd);

    for (const forbidden of [
      "review",
      "Review",
      "aggregateRating",
      "ratingValue",
      "AggregateRating",
      "hasCredential",
      "license",
      "licence",
      "award",
      "priceRange",
      "offers",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
    // Only identity and configured, verifiable facts.
    expect(Object.keys(jsonLd ?? {}).sort()).toEqual(
      expect.arrayContaining(["@context", "@type", "name", "url"]),
    );
    expect(
      Object.keys(jsonLd ?? {}).every((key) =>
        [
          "@context",
          "@type",
          "name",
          "url",
          "description",
          "telephone",
          "image",
          "address",
          "openingHours",
        ].includes(key),
      ),
    ).toBe(true);
  });

  it("does not present demonstration project media as verified business imagery", () => {
    const snapshot = snapshotOf(definition());
    const jsonLd = buildManagedWebsiteJsonLd(snapshot);

    // The legacy hero slot is the only image source for site-level JSON-LD, and
    // an authored client carries no template slots, so no demonstration project
    // image is promoted into business-level structured data.
    expect(jsonLd).not.toHaveProperty("image");
  });

  it("emits no Open Graph image for a route that declares none", () => {
    const snapshot = snapshotOf(definition());
    if (snapshot.pageGraph === undefined) {
      throw new Error("Fixture must produce an authored snapshot.");
    }
    const home = snapshot.pageGraph.pages[0];
    if (home === undefined) throw new Error("Fixture home page missing.");

    const metadata = buildManagedRouteMetadata(snapshot, home);
    expect(metadata.openGraph).not.toHaveProperty("images");
  });
});
