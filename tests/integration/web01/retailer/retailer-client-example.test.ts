import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  assembleClientSourceArtifact,
  generateClientWebsiteSnapshot,
  verifyClientSourceArtifact,
} from "../../../../apps/managed-web/src/generation";

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, "..", "..", "..", "..", "apps", "managed-web");
const publicDirectory = join(exampleRoot, "public", "examples", "retailer");
const clientWebsiteJsonPath = join(
  exampleRoot,
  "client",
  "examples",
  "retailer",
  "client-website.json",
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function loadDefinition(): Promise<unknown> {
  return JSON.parse(await readFile(clientWebsiteJsonPath, "utf8"));
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `mlgo-retailer-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

describe("retailer representative demo client website", () => {
  it("generates a canonical, portable, catalogue-only snapshot", async () => {
    const definition = await loadDefinition();

    const snapshot = generateClientWebsiteSnapshot(definition, publicDirectory);

    expect(snapshot.configuration.clientId).toBe("fernbank-trading-co");
    expect(snapshot.profile.profile).toBe("RETAILER");
    expect(snapshot.profile.archetype).toBe("CATALOGUE_LED");
    expect(snapshot.provenance.template).toEqual({
      templateId: "retailer",
      templateVersion: "1.0.0",
    });
    expect(
      snapshot.regions.flatMap((region) => region.modules.map(({ type }) => type)),
    ).toEqual(["LEAD_FORM", "ANALYTICS"]);
    expect(snapshot.configuration.configuredInfrastructure).toEqual([]);
    expect(snapshot.analyticsMeasurementIds).toEqual(["G-MLGO654321"]);
  });

  it("is deterministic across repeated generation", async () => {
    const definition = await loadDefinition();

    const first = generateClientWebsiteSnapshot(definition, publicDirectory);
    const second = generateClientWebsiteSnapshot(definition, publicDirectory);

    expect(first).toEqual(second);
  });

  it("assembles a portable, handoff-compatible source artifact with no leftover build output", async () => {
    const definition = await loadDefinition();
    const outputDirectory = await temporaryDirectory("client-artifact-output");

    const artifact = await assembleClientSourceArtifact({
      definition,
      publicDirectory,
      outputDirectory,
      factoryRevision: "retailer-demo-verification",
    });

    expect(artifact.descriptor.kind).toBe("MANAGED_WEBSITE_SOURCE");
    expect(artifact.descriptor.clientId).toBe("fernbank-trading-co");
    expect(artifact.descriptor.handoff.artifactAllowlist).toEqual(
      artifact.descriptor.handoff.artifacts.map(({ path }) => path),
    );
    expect(artifact.descriptor.handoff.optionalDataResources).toEqual([]);

    const sourcePackage = JSON.parse(
      await readFile(join(outputDirectory, "source", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const packageText = JSON.stringify(sourcePackage);
    expect(packageText).not.toContain("workspace:");
    expect(packageText).not.toContain("@melbourne-local-growth-ops/");

    await expect(readFile(join(outputDirectory, "build"))).rejects.toThrow();
  });

  it(
    "passes frozen install, typecheck, test, and production build in a temporary directory",
    async () => {
      const definition = await loadDefinition();
      const outputDirectory = await temporaryDirectory("verified-client-artifact");
      const artifact = await assembleClientSourceArtifact({
        definition,
        publicDirectory,
        outputDirectory,
        factoryRevision: "retailer-demo-verification",
      });

      const verification = await verifyClientSourceArtifact(artifact.sourceDirectory);

      expect(verification).toEqual({
        success: true,
        checks: ["INSTALL", "TYPECHECK", "TEST", "BUILD"],
        outputPolicy: "TEMPORARY_ONLY",
      });
    },
    180_000,
  );
});
