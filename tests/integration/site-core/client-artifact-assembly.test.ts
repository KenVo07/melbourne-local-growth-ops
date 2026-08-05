import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import {
  createClientHandoffExport,
  type ClientHandoffExportInput,
  type DeploymentManifest,
} from "@melbourne-local-growth-ops/deployment";

import {
  assembleClientSourceArtifact,
  generateClientWebsiteSnapshot,
  verifyClientSourceArtifact,
} from "../../../apps/managed-web/src/generation";
import { contractorProfileContent } from "./fixtures";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("client website generation", () => {
  it("generates the same canonical snapshot for the same validated client input", async () => {
    const input = await createClientInput("client-a", "G-CLIENTA123");

    const first = generateClientWebsiteSnapshot(input.definition, input.publicDirectory);
    const second = generateClientWebsiteSnapshot(input.definition, input.publicDirectory);

    expect(first).toEqual(second);
    expect(first.configuration.clientId).toBe("client-a");
    expect(first.assetManifest.clientId).toBe("client-a");
    expect(first.profile.profile).toBe("CONTRACTOR");
    expect(first.analyticsMeasurementIds).toEqual(["G-CLIENTA123"]);
    expect(first.regions.flatMap((region) => region.modules.map(({ type }) => type)))
      .toEqual(["BOOKING_CTA", "LEAD_FORM", "ANALYTICS"]);
  });

  it("keeps two generated client snapshots isolated", async () => {
    const clientA = await createClientInput("client-a", "G-CLIENTA123");
    const clientB = await createClientInput("client-b", "G-CLIENTB456");

    const snapshotA = generateClientWebsiteSnapshot(
      clientA.definition,
      clientA.publicDirectory,
    );
    const snapshotB = generateClientWebsiteSnapshot(
      clientB.definition,
      clientB.publicDirectory,
    );

    const serializedA = JSON.stringify(snapshotA);
    const serializedB = JSON.stringify(snapshotB);

    expect(serializedA).toContain("client-a");
    expect(serializedA).toContain("G-CLIENTA123");
    expect(serializedA).not.toContain("client-b");
    expect(serializedA).not.toContain("G-CLIENTB456");
    expect(serializedB).toContain("client-b");
    expect(serializedB).toContain("G-CLIENTB456");
    expect(serializedB).not.toContain("client-a");
    expect(serializedB).not.toContain("G-CLIENTA123");
  });

  it("generates no analytics runtime reference when analytics is intentionally absent", async () => {
    const input = await createClientInput("client-a", "G-CLIENTA123");
    const definition = {
      ...input.definition,
      configuration: {
        ...input.definition.configuration,
        modules: input.definition.configuration.modules.filter(
          ({ type }) => type !== "ANALYTICS",
        ),
        connectors: input.definition.configuration.connectors.filter(
          ({ type }) => type !== "GOOGLE_ANALYTICS_4",
        ),
      },
      modules: input.definition.modules.filter(
        ({ type }) => type !== "ANALYTICS",
      ),
    };

    const snapshot = generateClientWebsiteSnapshot(
      definition,
      input.publicDirectory,
    );

    expect(snapshot.analyticsMeasurementIds).toEqual([]);
    expect(
      snapshot.regions.flatMap(({ modules }) =>
        modules.filter(({ type }) => type === "ANALYTICS"),
      ),
    ).toEqual([]);
  });
});

describe("client source artifact assembly", () => {
  it("writes a source-only portable artifact with a handoff-compatible inventory", async () => {
    const input = await createClientInput("client-a", "G-CLIENTA123");
    const outputDirectory = await temporaryDirectory("client-artifact-output");

    const artifact = await assembleClientSourceArtifact({
      definition: input.definition,
      publicDirectory: input.publicDirectory,
      outputDirectory,
      factoryRevision: "d6670376c81c48a3f1fcb5f64e4ce9fc511da50d",
    });

    expect(artifact.descriptor.kind).toBe("MANAGED_WEBSITE_SOURCE");
    expect(artifact.descriptor.clientId).toBe("client-a");
    expect(artifact.descriptor.sourceDirectory).toBe("source");
    expect(artifact.descriptor.buildVerification.outputPolicy).toBe(
      "TEMPORARY_ONLY",
    );
    expect(artifact.descriptor.handoff.artifactAllowlist).toEqual(
      artifact.descriptor.handoff.artifacts.map(({ path }) => path),
    );
    expect(artifact.descriptor.handoff.optionalDataResources).toEqual([]);
    expect(artifact.descriptor.handoff.publicDependencyAllowlist).toEqual(
      expect.arrayContaining(["next", "react", "react-dom", "resend", "zod"]),
    );
    await expect(unresolvedRelativeRuntimeImports(artifact.sourceDirectory))
      .resolves.toEqual([]);

    const sourcePackage = JSON.parse(
      await readFile(join(outputDirectory, "source", "package.json"), "utf8"),
    ) as { dependencies?: Record<string, string> };
    const packageText = JSON.stringify(sourcePackage);
    expect(packageText).not.toContain("workspace:");
    expect(packageText).not.toContain("file:");
    expect(packageText).not.toContain("@melbourne-local-growth-ops/");

    await expect(readFile(join(outputDirectory, "build"))).rejects.toThrow();
  });

  it("does not place another client's configuration, analytics, assets, or identity in an artifact", async () => {
    const clientA = await createClientInput("client-a", "G-CLIENTA123");
    const clientB = await createClientInput("client-b", "G-CLIENTB456");
    const outputA = await temporaryDirectory("client-a-artifact");
    const outputB = await temporaryDirectory("client-b-artifact");

    const [artifactA, artifactB] = await Promise.all([
      assembleClientSourceArtifact({
        definition: clientA.definition,
        publicDirectory: clientA.publicDirectory,
        outputDirectory: outputA,
        factoryRevision: "factory-revision",
      }),
      assembleClientSourceArtifact({
        definition: clientB.definition,
        publicDirectory: clientB.publicDirectory,
        outputDirectory: outputB,
        factoryRevision: "factory-revision",
      }),
    ]);

    const sourceA = await readArtifactText(outputA, artifactA.descriptor.handoff.artifactAllowlist);
    const sourceB = await readArtifactText(outputB, artifactB.descriptor.handoff.artifactAllowlist);

    expect(sourceA).toContain("client-a");
    expect(sourceA).toContain("G-CLIENTA123");
    expect(sourceA).not.toContain("client-b");
    expect(sourceA).not.toContain("G-CLIENTB456");
    expect(sourceB).toContain("client-b");
    expect(sourceB).toContain("G-CLIENTB456");
    expect(sourceB).not.toContain("client-a");
    expect(sourceB).not.toContain("G-CLIENTA123");
    expect(artifactA.descriptor.artifactId).not.toBe(
      artifactB.descriptor.artifactId,
    );
    await expect(
      readFile(
        join(outputA, "source", "public", "assets", "hero", "primary.png"),
        "utf8",
      ),
    ).resolves.toBe("portable-image-client-a");
    await expect(
      readFile(
        join(outputB, "source", "public", "assets", "hero", "primary.png"),
        "utf8",
      ),
    ).resolves.toBe("portable-image-client-b");
  });

  it("verifies frozen install, typecheck, tests, and production build in a temporary directory", async () => {
    const input = await createClientInput("client-a", "G-CLIENTA123");
    const outputDirectory = await temporaryDirectory("verified-client-artifact");
    const artifact = await assembleClientSourceArtifact({
      definition: input.definition,
      publicDirectory: input.publicDirectory,
      outputDirectory,
      factoryRevision: "factory-revision",
    });
    await writeFile(
      join(artifact.sourceDirectory, "tests", "environment.test.mjs"),
      [
        'import assert from "node:assert/strict";',
        'import test from "node:test";',
        "",
        "test('does not inherit ambient credentials', () => {",
        "  assert.equal(process.env.MLGO_TEST_AMBIENT_SECRET, undefined);",
        "});",
        "",
      ].join("\n"),
    );
    process.env.MLGO_TEST_AMBIENT_SECRET = "must-not-reach-build";
    let verification;
    try {
      verification = await verifyClientSourceArtifact(
        artifact.sourceDirectory,
      );
    } finally {
      delete process.env.MLGO_TEST_AMBIENT_SECRET;
    }

    expect(verification).toEqual({
      success: true,
      checks: ["INSTALL", "TYPECHECK", "TEST", "BUILD"],
      outputPolicy: "TEMPORARY_ONLY",
    });
  }, 120_000);

  it("maps without private imports into Codex B's public ClientHandoffExportInput", async () => {
    const input = await createClientInput("client-a", "G-CLIENTA123");
    const outputDirectory = await temporaryDirectory("handoff-compatible-artifact");
    const assembled = await assembleClientSourceArtifact({
      definition: input.definition,
      publicDirectory: input.publicDirectory,
      outputDirectory,
      factoryRevision: "factory-revision",
    });
    const artifacts = await Promise.all(
      assembled.descriptor.handoff.artifacts.map(async (artifact) => ({
        path: artifact.path,
        content: artifact.path.endsWith(".png")
          ? await readFile(
              join(assembled.sourceDirectory, ...artifact.path.split("/")),
            )
          : await readFile(
              join(assembled.sourceDirectory, ...artifact.path.split("/")),
              "utf8",
            ),
        category: artifact.category,
        clientId: artifact.clientId,
        provenance: artifact.provenance,
      })),
    );
    const configuration = input.definition.configuration;
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
        generatedAt: "2026-07-29T08:00:00.000Z",
      },
      handoff: { status: "IN_PROGRESS", targetOwner: "CLIENT" },
    } as unknown as DeploymentManifest;
    const handoffInput: ClientHandoffExportInput = {
      configuration,
      deploymentManifest,
      repositoryName: assembled.descriptor.repositoryName,
      exportedAt: "2026-07-29T08:30:00.000Z",
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
      publicDependencyAllowlist:
        assembled.descriptor.handoff.publicDependencyAllowlist,
      requiredEnvironmentVariables:
        assembled.descriptor.handoff.requiredEnvironmentVariables,
      otherClientIdentifiers: ["client-b", "G-CLIENTB456"],
      optionalDataResources: [],
    };

    const result = createClientHandoffExport(handoffInput);

    expect(
      result.success,
      result.success ? "" : JSON.stringify(result.issues, null, 2),
    ).toBe(true);
    if (result.success) {
      expect(result.export.manifest.clientId).toBe("client-a");
      expect(result.export.files.some(({ path }) => path === "handoff-manifest.json"))
        .toBe(true);
      expect(result.export.files.some(({ path }) => path.startsWith("build/")))
        .toBe(false);
    }
  });

  it("rejects client handoff export if an assembled artifact contains a cross-client identifier", async () => {
    const input = await createClientInput("client-a", "G-CLIENTA123");
    const outputDirectory = await temporaryDirectory("handoff-cross-client-reject");
    const assembled = await assembleClientSourceArtifact({
      definition: input.definition,
      publicDirectory: input.publicDirectory,
      outputDirectory,
      factoryRevision: "factory-revision",
    });
    const artifacts = await Promise.all(
      assembled.descriptor.handoff.artifacts.map(async (artifact) => {
        const isTarget = artifact.path.endsWith("package.json");
        const baseContent = await readFile(
          join(assembled.sourceDirectory, ...artifact.path.split("/")),
          "utf8",
        );
        return {
          path: artifact.path,
          content: isTarget ? baseContent + "\n// reference: client-b" : baseContent,
          category: artifact.category,
          clientId: artifact.clientId,
          provenance: artifact.provenance,
        };
      }),
    );
    const configuration = input.definition.configuration;
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
        generatedAt: "2026-07-29T08:00:00.000Z",
      },
      handoff: { status: "IN_PROGRESS", targetOwner: "CLIENT" },
    } as unknown as DeploymentManifest;
    const handoffInput: ClientHandoffExportInput = {
      configuration,
      deploymentManifest,
      repositoryName: assembled.descriptor.repositoryName,
      exportedAt: "2026-07-29T08:30:00.000Z",
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
      publicDependencyAllowlist:
        assembled.descriptor.handoff.publicDependencyAllowlist,
      requiredEnvironmentVariables:
        assembled.descriptor.handoff.requiredEnvironmentVariables,
      otherClientIdentifiers: ["client-b", "G-CLIENTB456"],
      optionalDataResources: [],
    };

    const result = createClientHandoffExport(handoffInput);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "CLIENT_ISOLATION_VIOLATION",
          }),
        ]),
      );
    }
  });
});

async function createClientInput(clientId: string, measurementId: string) {
  const inputDirectory = await temporaryDirectory(`${clientId}-input`);
  const publicDirectory = join(inputDirectory, "public");
  await mkdir(join(publicDirectory, "assets", "hero"), { recursive: true });
  await writeFile(
    join(publicDirectory, "assets", "hero", "primary.png"),
    `portable-image-${clientId}`,
  );

  return {
    publicDirectory,
    definition: {
      schemaVersion: 1,
      configuration: {
        schemaVersion: 1,
        configurationId: `configuration-${clientId}`,
        configurationVersion: 1,
        clientId,
        entitlementId: `entitlement-${clientId}`,
        deploymentId: `deployment-${clientId}`,
        display: {
          businessName: `Business ${clientId}`,
          tagline: `Service for ${clientId}`,
          locationIds: [`location-${clientId}`],
        },
        domains: [{ hostname: `${clientId}.example.com.au`, canonical: true }],
        modules: [
          {
            schemaVersion: 1,
            moduleId: `booking-${clientId}`,
            connectorId: `booking-connector-${clientId}`,
            type: "BOOKING_CTA",
            label: `Book ${clientId}`,
          },
          {
            schemaVersion: 1,
            moduleId: `lead-${clientId}`,
            connectorId: `email-connector-${clientId}`,
            type: "LEAD_FORM",
            fields: ["NAME", "EMAIL", "MESSAGE"],
          },
          {
            schemaVersion: 1,
            moduleId: `analytics-${clientId}`,
            connectorId: `analytics-connector-${clientId}`,
            type: "ANALYTICS",
          },
        ],
        connectors: [
          {
            schemaVersion: 1,
            connectorId: `booking-connector-${clientId}`,
            accountOwner: "CLIENT",
            portability: "CLIENT_OWNED",
            type: "BOOKING_LINK",
            bookingUrl: `https://${clientId}.example.com.au/book`,
          },
          {
            schemaVersion: 1,
            connectorId: `email-connector-${clientId}`,
            accountOwner: "CLIENT",
            portability: "TRANSFERABLE",
            type: "EMAIL_DELIVERY",
            provider: "RESEND",
            fromAddress: `website@${clientId}.example.com.au`,
            recipientAddresses: [`owner@${clientId}.example.com.au`],
            secretReferenceId: `resend-${clientId}`,
          },
          {
            schemaVersion: 1,
            connectorId: `analytics-connector-${clientId}`,
            accountOwner: "CLIENT",
            portability: "CLIENT_OWNED",
            type: "GOOGLE_ANALYTICS_4",
            measurementId,
          },
        ],
        configuredInfrastructure: [],
      },
      profile: contractorProfileContent(clientId),
      template: { templateId: "contractor", templateVersion: "1.0.0" },
      modules: [
        { type: "BOOKING_CTA", moduleVersion: "1.0.0" },
        { type: "LEAD_FORM", moduleVersion: "1.0.0" },
        { type: "ANALYTICS", moduleVersion: "1.0.0" },
      ],
      assets: [
        {
          assetId: "hero-primary",
          kind: "IMAGE",
          sourcePath: "assets/hero/primary.png",
          mediaType: "image/png",
          width: 1200,
          height: 800,
        },
      ],
    },
  };
}

async function unresolvedRelativeRuntimeImports(
  sourceDirectory: string,
): Promise<string[]> {
  const roots = [
    "src/app/layout.tsx",
    "src/app/page.tsx",
    "src/app/api/contact/route.ts",
  ];
  const pending = [...roots];
  const visited = new Set<string>();
  const missing: string[] = [];

  while (pending.length > 0) {
    const relativePath = pending.shift();
    if (relativePath === undefined || visited.has(relativePath)) continue;
    visited.add(relativePath);
    const content = await readFile(join(sourceDirectory, relativePath), "utf8");
    const importSpecifiers = [...content.matchAll(
      /(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g,
    )].map((match) => match[1]).filter((value): value is string => value !== undefined);

    for (const specifier of importSpecifiers) {
      const resolved = await resolvePortableImport(sourceDirectory, relativePath, specifier);
      if (resolved === undefined) {
        missing.push(`${relativePath} -> ${specifier}`);
      } else if (/\.(?:ts|tsx|js|mjs)$/.test(resolved)) {
        pending.push(resolved);
      }
    }
  }

  return missing.sort();
}

async function resolvePortableImport(
  sourceDirectory: string,
  importer: string,
  specifier: string,
): Promise<string | undefined> {
  const base = join(sourceDirectory, importer, "..", specifier);
  const candidates = /\.[a-z]+$/i.test(specifier)
    ? [base]
    : [
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.mjs`,
        `${base}.json`,
        `${base}.css`,
        join(base, "index.ts"),
        join(base, "index.tsx"),
        join(base, "index.js"),
      ];
  for (const candidate of candidates) {
    try {
      await readFile(candidate);
      return candidate.slice(sourceDirectory.length + 1).replaceAll("\\", "/");
    } catch {
      // Continue through the closed list of supported runtime extensions.
    }
  }
  return undefined;
}

async function temporaryDirectory(label: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `mlgo-${label}-`));
  temporaryDirectories.push(directory);
  return directory;
}

async function readArtifactText(
  outputDirectory: string,
  paths: readonly string[],
): Promise<string> {
  const chunks = await Promise.all(
    paths
      .filter((path) => !path.endsWith(".png"))
      .map((path) => readFile(join(outputDirectory, "source", path), "utf8")),
  );
  return chunks.join("\n");
}
