import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { generateClientWebsiteSnapshot } from "../../../apps/managed-web/src/generation";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/web01b/neutral-v2", import.meta.url),
);
const publicDirectory = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);
const legacyDefinitionPath = fileURLToPath(
  new URL(
    "../../../apps/managed-web/client/client-website.json",
    import.meta.url,
  ),
);

let definitionText: string;
let manifest: unknown;

beforeAll(async () => {
  definitionText = await readFile(`${fixtureRoot}/client-website.json`, "utf8");
  manifest = JSON.parse(
    await readFile(`${fixtureRoot}/experience/manifest.json`, "utf8"),
  ) as unknown;
});

function snapshotOf(
  mutate: (value: Record<string, unknown>) => void = () => undefined,
) {
  const value = JSON.parse(definitionText) as Record<string, unknown>;
  mutate(value);
  return generateClientWebsiteSnapshot(value, publicDirectory, {
    clientExperienceManifest: manifest,
  });
}

describe("page-aware Foundation Search", () => {
  it("projects records onto real routes, never one-page anchors", () => {
    const { foundationSearch } = snapshotOf();

    expect(foundationSearch.schemaVersion).toBe(2);
    expect(foundationSearch.enabled).toBe(true);
    expect(foundationSearch.reason).toBe("EXPLICIT_ON");
    expect(foundationSearch.records.length).toBeGreaterThan(0);
    for (const record of foundationSearch.records) {
      expect(record.url.startsWith("/")).toBe(true);
      // A v2 record must never be a fragment on one shared document.
      expect(record.url.startsWith("/#")).toBe(false);
    }
  });

  it("lands a project result directly on that project's route", () => {
    const { foundationSearch } = snapshotOf();
    const urls = foundationSearch.records.map(({ url }) => url);

    expect(urls).toContain("/projects/northcote-residence");
    expect(urls).toContain("/projects/brighton-house");
    expect(urls).toContain("/projects/kew-renovation");

    const northcote = foundationSearch.records.find(
      ({ url }) => url === "/projects/northcote-residence",
    );
    expect(northcote?.content).toContain("Northcote Residence");
    // The project's ordered narrative is searchable, not just its title.
    expect(northcote?.content).toContain("fictional brief");
    expect(northcote?.content).toContain("Outcome");
    expect(northcote?.filters.sectionType).toEqual(["PROJECT_DETAIL"]);
  });

  it("honours page scope and indexes nothing the client excluded", () => {
    const { foundationSearch } = snapshotOf();
    const urls = foundationSearch.records.map(({ url }) => url);

    // The fixture deliberately excludes /contact from the index.
    expect(urls).not.toContain("/contact");
    expect(urls).toContain("/about");
  });

  it("rejects a page scope naming a page the graph does not contain", () => {
    expect(() =>
      snapshotOf((value) => {
        value.foundationSearch = {
          schemaVersion: 2,
          mode: "ON",
          includePageIds: ["home", "not-a-page"],
        };
      }),
    ).toThrow(/unknown pages: not-a-page/);
  });

  it("refuses one-page section scope for an authored definition", () => {
    expect(() =>
      snapshotOf((value) => {
        value.foundationSearch = {
          schemaVersion: 1,
          mode: "ON",
          includeSectionIds: ["services"],
        };
      }),
    ).toThrow(/must use schemaVersion 2 Foundation Search/);
  });

  it("keeps OFF meaning no records at all", () => {
    const { foundationSearch } = snapshotOf((value) => {
      value.foundationSearch = { schemaVersion: 2, mode: "OFF" };
    });

    expect(foundationSearch.enabled).toBe(false);
    expect(foundationSearch.reason).toBe("EXPLICIT_OFF");
    expect(foundationSearch.records).toEqual([]);
  });

  it("keeps an omitted configuration off, so no site gains an index silently", () => {
    const { foundationSearch } = snapshotOf((value) => {
      delete value.foundationSearch;
    });

    expect(foundationSearch.enabled).toBe(false);
    expect(foundationSearch.reason).toBe("DEFAULT_OFF");
    expect(foundationSearch.records).toEqual([]);
  });

  it("resolves AUTO from real route content", () => {
    const { foundationSearch } = snapshotOf((value) => {
      value.foundationSearch = { schemaVersion: 2, mode: "AUTO" };
    });

    expect(foundationSearch.mode).toBe("AUTO");
    // Nine routes with substantial project narrative clears the threshold.
    expect(foundationSearch.enabled).toBe(true);
    expect(foundationSearch.reason).toBe("AUTO_ENABLED");
  });

  it("indexes no private, connector or secret material", () => {
    const snapshot = snapshotOf();
    const serialized = JSON.stringify(snapshot.foundationSearch.records);

    for (const binding of snapshot.runtimeSecretBindings) {
      expect(serialized).not.toContain(binding.secretReferenceId);
      expect(serialized).not.toContain(binding.environmentVariable);
    }
    for (const connector of snapshot.configuration.connectors) {
      expect(serialized).not.toContain(String(connector.connectorId));
    }
    expect(serialized).not.toContain(
      String(snapshot.configuration.entitlementId),
    );
    expect(serialized).not.toContain("secretReferenceId");
  });

  it("always discloses demonstration content it indexes", () => {
    const { foundationSearch } = snapshotOf();
    const projectRecords = foundationSearch.records.filter(({ url }) =>
      url.startsWith("/projects/"),
    );

    expect(projectRecords.length).toBe(3);
    for (const record of projectRecords) {
      expect(record.content).toContain("not completed client work");
    }
  });

  it("leaves the legacy one-page projection untouched", async () => {
    const legacy = JSON.parse(
      await readFile(legacyDefinitionPath, "utf8"),
    ) as Record<string, unknown>;
    const snapshot = generateClientWebsiteSnapshot(
      { ...legacy, foundationSearch: { schemaVersion: 1, mode: "ON" } },
      publicDirectory,
    );

    expect(snapshot.foundationSearch.schemaVersion).toBe(1);
    expect(snapshot.foundationSearch.enabled).toBe(true);
    expect(snapshot.foundationSearch.records.length).toBeGreaterThan(0);
    // Legacy records remain section anchors on the single document.
    for (const record of snapshot.foundationSearch.records) {
      expect(record.url.startsWith("/#")).toBe(true);
    }
  });
});
