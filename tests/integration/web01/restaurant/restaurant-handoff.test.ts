import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createClientHandoffExport,
  type ClientHandoffExportInput,
  type DeploymentManifest,
} from "@melbourne-local-growth-ops/deployment";
import { afterEach, describe, expect, it } from "vitest";

import {
  assembleClientSourceArtifact,
  generateClientWebsiteSnapshot,
} from "../../../../apps/managed-web/src/generation";
import {
  restaurantClientWebsiteDefinitionInput,
  restaurantExamplePublicDirectory,
} from "../../../fixtures/web01/restaurant/restaurant-fixture";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("restaurant demo client website generation", () => {
  it("generates a deterministic snapshot from the real owned example assets", () => {
    const definition = restaurantClientWebsiteDefinitionInput();

    const first = generateClientWebsiteSnapshot(definition, restaurantExamplePublicDirectory);
    const second = generateClientWebsiteSnapshot(definition, restaurantExamplePublicDirectory);

    expect(first).toEqual(second);
    expect(first.configuration.clientId).toBe("lantern-and-vine");
    expect(first.profile.profile).toBe("RESTAURANT");
    expect(first.assetManifest.assets.map((asset) => asset.assetId).sort()).toEqual([
      "bar-service",
      "dining-room",
      "hero-primary",
      "share-plate",
    ]);
    expect(first.analyticsMeasurementIds).toEqual(["G-MLGOREST01"]);
    expect(first.regions.flatMap((region) => region.modules.map(({ type }) => type)))
      .toEqual(["LEAD_FORM", "ANALYTICS"]);
    expect(first.configuration.configuredInfrastructure).toEqual([]);
  });

  it("keeps reservation/ordering state external or NOT_CONFIGURED with no booking backend module wired", () => {
    const definition = restaurantClientWebsiteDefinitionInput();
    const snapshot = generateClientWebsiteSnapshot(definition, restaurantExamplePublicDirectory);

    expect(
      snapshot.regions.flatMap(({ modules }) => modules.map(({ type }) => type)),
    ).not.toContain("BOOKING_CTA");

    const actions = snapshot.profile.sections.find((section) => section.type === "ACTIONS");
    if (actions?.type !== "ACTIONS") throw new Error("Snapshot requires an ACTIONS section.");
    const reservation = actions.actions.find((action) => action.kind === "RESERVATION");
    const ordering = actions.actions.find((action) => action.kind === "ORDERING");
    expect(reservation?.state).toBe("NOT_CONFIGURED");
    expect(ordering?.state).toBe("NOT_CONFIGURED");
  });
});

describe("restaurant demo client source artifact", () => {
  it("assembles a portable, handoff-compatible source artifact with no cross-profile identity", async () => {
    const definition = restaurantClientWebsiteDefinitionInput();
    const outputDirectory = await temporaryDirectory("restaurant-client-artifact");

    const artifact = await assembleClientSourceArtifact({
      definition,
      publicDirectory: restaurantExamplePublicDirectory,
      outputDirectory,
      factoryRevision: "d6670376c81c48a3f1fcb5f64e4ce9fc511da50d",
    });

    expect(artifact.descriptor.kind).toBe("MANAGED_WEBSITE_SOURCE");
    expect(artifact.descriptor.clientId).toBe("lantern-and-vine");
    expect(artifact.descriptor.buildVerification.outputPolicy).toBe("TEMPORARY_ONLY");
    expect(artifact.descriptor.handoff.artifactAllowlist).toEqual(
      artifact.descriptor.handoff.artifacts.map(({ path }) => path),
    );
    expect(artifact.descriptor.handoff.optionalDataResources).toEqual([]);
    expect(
      artifact.descriptor.handoff.moduleSelections.some(({ type }) => type === "BOOKING_CTA"),
    ).toBe(false);

    const sourcePackage = JSON.parse(
      await readFile(join(outputDirectory, "source", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const packageText = JSON.stringify(sourcePackage);
    expect(packageText).not.toContain("workspace:");
    expect(packageText).not.toContain("@melbourne-local-growth-ops/");

    for (const assetPath of [
      "public/assets/hero/primary.png",
      "public/assets/gallery/dining-room.png",
      "public/assets/gallery/share-plate.png",
      "public/assets/gallery/bar-service.png",
    ]) {
      await expect(readFile(join(outputDirectory, "source", assetPath))).resolves.toBeInstanceOf(
        Buffer,
      );
    }
  });

  it("keeps the provenance-recorded gallery and hero imagery portable and within the frozen per-asset source budget (P20, D-R5)", async () => {
    const definition = restaurantClientWebsiteDefinitionInput();
    const outputDirectory = await temporaryDirectory("restaurant-imagery-budget");

    await assembleClientSourceArtifact({
      definition,
      publicDirectory: restaurantExamplePublicDirectory,
      outputDirectory,
      factoryRevision: "d6670376c81c48a3f1fcb5f64e4ce9fc511da50d",
    });

    for (const assetPath of [
      "public/assets/hero/primary.png",
      "public/assets/gallery/dining-room.png",
      "public/assets/gallery/share-plate.png",
      "public/assets/gallery/bar-service.png",
    ]) {
      const { size } = await stat(join(outputDirectory, "source", assetPath));
      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThanOrEqual(600_000);
    }
  });

  it("maps without private imports into the public ClientHandoffExportInput contract", async () => {
    const definition = restaurantClientWebsiteDefinitionInput();
    const outputDirectory = await temporaryDirectory("restaurant-handoff-export");
    const assembled = await assembleClientSourceArtifact({
      definition,
      publicDirectory: restaurantExamplePublicDirectory,
      outputDirectory,
      factoryRevision: "factory-revision",
    });
    const artifacts = await Promise.all(
      assembled.descriptor.handoff.artifacts.map(async (artifact) => ({
        path: artifact.path,
        content: artifact.path.endsWith(".png")
          ? await readFile(join(assembled.sourceDirectory, ...artifact.path.split("/")))
          : await readFile(join(assembled.sourceDirectory, ...artifact.path.split("/")), "utf8"),
        category: artifact.category,
        clientId: artifact.clientId,
        provenance: artifact.provenance,
      })),
    );
    const configuration = definition.configuration;
    const deploymentManifest = {
      schemaVersion: 1,
      deploymentId: configuration.deploymentId,
      clientId: configuration.clientId,
      configurationId: configuration.configurationId,
      configurationVersion: configuration.configurationVersion,
      applicationVersion: "1.0.0",
      deliveryMode: "CLIENT_HANDOFF",
      infrastructureOwnership: [],
      domains: configuration.domains,
      buildProvenance: {
        buildId: assembled.descriptor.artifactId,
        sourceRevision: "0123456789abcdef0123456789abcdef",
        generatedAt: "2026-08-05T08:00:00.000Z",
      },
      handoff: { status: "IN_PROGRESS", targetOwner: "CLIENT" },
    } as unknown as DeploymentManifest;
    const handoffInput: ClientHandoffExportInput = {
      configuration,
      deploymentManifest,
      repositoryName: assembled.descriptor.repositoryName,
      exportedAt: "2026-08-05T08:30:00.000Z",
      ownership: {
        sourceRepository: "CLIENT",
        hosting: "CLIENT",
        analytics: "CLIENT",
        domains: "CLIENT",
      },
      artifacts,
      artifactAllowlist: assembled.descriptor.handoff.artifactAllowlist,
      moduleSelections: assembled.descriptor.handoff.moduleSelections,
      connectorSelections: assembled.descriptor.handoff.connectorSelections,
      publicDependencyAllowlist: assembled.descriptor.handoff.publicDependencyAllowlist,
      requiredEnvironmentVariables: assembled.descriptor.handoff.requiredEnvironmentVariables,
      otherClientIdentifiers: [],
      optionalDataResources: [],
    };

    const result = createClientHandoffExport(handoffInput);

    expect(result.success, result.success ? "" : JSON.stringify(result.issues, null, 2)).toBe(
      true,
    );
    if (result.success) {
      expect(result.export.manifest.clientId).toBe("lantern-and-vine");
      expect(result.export.files.some(({ path }) => path === "handoff-manifest.json")).toBe(true);
    }
  });
});

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `mlgo-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}
