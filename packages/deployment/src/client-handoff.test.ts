import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createClientHandoffExport,
  createOptionalDataRestorePlan,
  validateClientHandoffManifest,
  verifyClientHandoffDirectory,
  verifyClientHandoffExport,
  writeClientHandoffDirectory,
} from "./index.js";
import type {
  ClientHandoffExportInput,
  DeploymentManifest,
  HandoffArtifactInput,
} from "./index.js";

const CLIENT_ID = "client_acme";
const OTHER_CLIENT_ID = "client_other";
const DEPLOYMENT_ID = "deployment_acme";
const CONFIGURATION_ID = "website_acme";
const EXPORTED_AT = "2026-07-29T08:00:00.000Z";

const packageJson = `${JSON.stringify({
  name: "acme-client-site",
  version: "1.0.0",
  private: true,
  type: "module",
  packageManager: "pnpm@11.9.0",
  engines: { node: "24.18.0", pnpm: "11.9.0" },
  scripts: {
    dev: "node src/index.mjs",
    build: "node scripts/build.mjs",
    typecheck: "node --check src/index.mjs",
    test: "node --test tests/site.test.mjs",
    "verify:handoff": "node scripts/verify-handoff.mjs",
  },
  dependencies: {},
  devDependencies: {},
}, null, 2)}\n`;

const pnpmLock = `lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

importers:

  .: {}
`;

function artifact(
  path: string,
  content: string,
  category: HandoffArtifactInput["category"],
  clientId = CLIENT_ID,
): HandoffArtifactInput {
  return {
    path,
    content,
    category,
    clientId,
    provenance: {
      origin: category === "VENDORED_RUNTIME"
        ? "TRANSFORMED_FACTORY_RUNTIME"
        : "GENERATED",
      version: "1.0.0",
    },
  };
}

function defaultArtifacts(): readonly HandoffArtifactInput[] {
  return [
    artifact("package.json", packageJson, "PACKAGE"),
    artifact("pnpm-lock.yaml", pnpmLock, "PACKAGE"),
    artifact(
      ".gitignore",
      "node_modules/\n.next/\nbuild/\n.env\n.env.*\n!.env.example\n",
      "CONFIGURATION",
    ),
    artifact(
      "src/index.mjs",
      "export const clientSite = 'client_acme';\n",
      "SOURCE",
    ),
    artifact(
      "src/vendor/runtime.mjs",
      "export const runtimeVersion = '1.0.0';\n",
      "VENDORED_RUNTIME",
    ),
    artifact(
      "public/brand.svg",
      "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n",
      "ASSET",
    ),
    artifact(
      "scripts/build.mjs",
      "import { mkdir, writeFile } from 'node:fs/promises';\n" +
        "await mkdir('build', { recursive: true });\n" +
        "await writeFile('build/site.txt', 'portable build\\n');\n",
      "SOURCE",
    ),
    artifact(
      "tests/site.test.mjs",
      "import test from 'node:test';\n" +
        "import assert from 'node:assert/strict';\n" +
        "test('client site', () => assert.equal(1, 1));\n",
      "TEST",
    ),
  ];
}

function deploymentManifest(
  clientId = CLIENT_ID,
  deploymentId = DEPLOYMENT_ID,
  configurationId = CONFIGURATION_ID,
  hostname = "acme.example",
): DeploymentManifest {
  return {
    schemaVersion: 1,
    deploymentId,
    clientId,
    configurationId,
    configurationVersion: 3,
    applicationVersion: "2.0.0",
    deliveryMode: "CLIENT_HANDOFF",
    infrastructureOwnership: [],
    domains: [{ hostname, canonical: true }],
    buildProvenance: {
      buildId: `build_${clientId}_20260729`,
      sourceRevision: "0123456789abcdef0123456789abcdef",
      generatedAt: "2026-07-29T07:30:00.000Z",
    },
    handoff: { status: "IN_PROGRESS", targetOwner: "CLIENT" },
  } as unknown as DeploymentManifest;
}

function baseInput(
  overrides: Partial<ClientHandoffExportInput> = {},
): ClientHandoffExportInput {
  const artifacts = overrides.artifacts ?? defaultArtifacts();
  return {
    configuration: {
      schemaVersion: 1,
      configurationId: CONFIGURATION_ID,
      configurationVersion: 3,
      clientId: CLIENT_ID,
      entitlementId: "entitlement_website",
      deploymentId: DEPLOYMENT_ID,
      display: {
        businessName: "Acme Electrical",
        locationIds: ["location_melbourne"],
      },
      domains: [{ hostname: "acme.example", canonical: true }],
      modules: [{
        schemaVersion: 1,
        moduleId: "booking_primary",
        connectorId: "booking_primary",
        type: "BOOKING_CTA",
        label: "Book now",
      }],
      connectors: [{
        schemaVersion: 1,
        connectorId: "booking_primary",
        accountOwner: "CLIENT",
        portability: "CLIENT_OWNED",
        type: "BOOKING_LINK",
        bookingUrl: "https://acme.example/book",
      }],
      configuredInfrastructure: [],
    },
    deploymentManifest: deploymentManifest(),
    repositoryName: "acme-client-site",
    exportedAt: EXPORTED_AT,
    ownership: {
      sourceRepository: "CLIENT",
      hosting: "CLIENT",
      analytics: "CLIENT",
      domains: "CLIENT",
    },
    artifacts,
    artifactAllowlist: artifacts.map(({ path }) => path),
    moduleSelections: [{
      moduleId: "booking_primary",
      type: "BOOKING_CTA",
      version: "1.0.0",
      portability: "TRANSFERABLE",
    }],
    connectorSelections: [{
      connectorId: "booking_primary",
      type: "BOOKING_LINK",
      version: "1.0.0",
      portability: "CLIENT_OWNED",
    }],
    publicDependencyAllowlist: [],
    requiredEnvironmentVariables: [],
    otherClientIdentifiers: [OTHER_CLIENT_ID],
    optionalDataResources: [],
    ...overrides,
  };
}

function successfulExport(input = baseInput()) {
  const result = createClientHandoffExport(input);
  expect(result.success).toBe(true);
  if (!result.success) {
    throw new Error("Expected client handoff export to succeed");
  }
  return result.export;
}

function textFile(
  exported: ReturnType<typeof successfulExport>,
  path: string,
): string {
  const file = exported.files.find((candidate) => candidate.path === path);
  if (file === undefined) {
    throw new Error(`Missing fixture export file: ${path}`);
  }
  return new TextDecoder().decode(file.content);
}

describe("client handoff export", () => {
  it("returns a stable issue for a malformed public input envelope", () => {
    const result = createClientHandoffExport(
      undefined as unknown as ClientHandoffExportInput,
    );

    expect(result).toEqual({
      success: false,
      issues: [{
        code: "INVALID_HANDOFF_INPUT",
        path: ".",
        message: "Client handoff input is incomplete or malformed",
      }],
    });
  });

  it("creates a deterministic client-owned repository with manifest, README, checklist, and verifier", () => {
    const first = successfulExport();
    const second = successfulExport();

    expect(first).toEqual(second);
    expect(first.repositoryName).toBe("acme-client-site");
    expect(first.manifest).toMatchObject({
      schemaVersion: 1,
      clientId: CLIENT_ID,
      deploymentId: DEPLOYMENT_ID,
      exportedAt: EXPORTED_AT,
      ownership: {
        sourceRepository: "CLIENT",
        hosting: "CLIENT",
        analytics: "CLIENT",
        domains: "CLIENT",
      },
      modules: [{
        moduleId: "booking_primary",
        type: "BOOKING_CTA",
        version: "1.0.0",
      }],
      connectors: [{
        connectorId: "booking_primary",
        type: "BOOKING_LINK",
        version: "1.0.0",
      }],
      scans: {
        privateDependencies: "PASSED",
        secrets: "PASSED",
        clientIsolation: "PASSED",
      },
    });
    expect(first.files.map(({ path }) => path)).toEqual(
      [...first.files.map(({ path }) => path)].sort(),
    );
    expect(first.files.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        ".env.example",
        "HANDOFF-CHECKLIST.md",
        "README.md",
        "handoff-manifest.json",
        "handoff-manifest.sha256",
        "scripts/verify-handoff.mjs",
      ]),
    );
    expect(first.manifest.includedAssets).toEqual([
      expect.objectContaining({ path: "public/brand.svg" }),
    ]);
    expect(textFile(first, "README.md")).toMatch(
      /Install|Development|Build|Deployment|Environment setup|Domain ownership|Analytics ownership|Contact-form provider setup|Rollback|Recovery/,
    );
  });

  it("keeps two client exports isolated", () => {
    const acme = successfulExport();
    const otherArtifacts = defaultArtifacts().map((file) => {
      let content = typeof file.content === "string"
        ? file.content.replaceAll(CLIENT_ID, OTHER_CLIENT_ID)
        : file.content;
      if (file.path === "package.json" && typeof content === "string") {
        content = content.replace("acme-client-site", "other-client-site");
      }
      return { ...file, clientId: OTHER_CLIENT_ID, content };
    });
    const other = successfulExport(baseInput({
      configuration: {
        ...(baseInput().configuration as Record<string, unknown>),
        clientId: OTHER_CLIENT_ID,
        deploymentId: "deployment_other",
        configurationId: "website_other",
        domains: [{ hostname: "other.example", canonical: true }],
      },
      deploymentManifest: deploymentManifest(
        OTHER_CLIENT_ID,
        "deployment_other",
        "website_other",
        "other.example",
      ),
      repositoryName: "other-client-site",
      artifacts: otherArtifacts,
      artifactAllowlist: otherArtifacts.map(({ path }) => path),
      otherClientIdentifiers: [CLIENT_ID],
    }));

    expect(JSON.stringify(acme)).not.toContain(OTHER_CLIENT_ID);
    expect(JSON.stringify(other)).not.toContain(CLIENT_ID);
    expect(acme.manifest.clientId).not.toBe(other.manifest.clientId);
  });

  it.each([
    "../outside.mjs",
    "/absolute.mjs",
    "src\\windows-path.mjs",
    "src/../../outside.mjs",
    "src/CON.mjs",
    "src/trailing.",
  ])("rejects unsafe artifact path %s", (unsafePath) => {
    const artifacts = [
      ...defaultArtifacts(),
      artifact(unsafePath, "export {};\n", "SOURCE"),
    ];
    const result = createClientHandoffExport(baseInput({
      artifacts,
      artifactAllowlist: artifacts.map(({ path }) => path),
    }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ code: "UNSAFE_EXPORT_PATH" })],
    });
  });

  it("rejects credential-shaped content without echoing it", () => {
    const marker = "credential-shaped-fixture";
    const artifacts = defaultArtifacts().map((file) =>
      file.path === "src/index.mjs"
        ? {
          ...file,
          content: `const apiToken = "${marker}";\n`,
        }
        : file
    );
    const result = createClientHandoffExport(baseInput({ artifacts }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ code: "SECRET_MATERIAL" })],
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects credential-shaped handoff metadata without echoing it", () => {
    const marker = "credential-shaped-metadata-fixture";
    const result = createClientHandoffExport(baseInput({
      requiredEnvironmentVariables: [{
        name: "FORM_ENDPOINT",
        description: `apiToken = "${marker}"`,
        required: true,
        owner: "CLIENT",
      }],
    }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ code: "SECRET_MATERIAL" })],
    });
    expect(JSON.stringify(result)).not.toContain(marker);
  });

  it("rejects private and workspace dependency references", () => {
    const privatePackage = `${JSON.stringify({
      ...JSON.parse(packageJson) as Record<string, unknown>,
      dependencies: {
        "@agency/private-runtime": "workspace:*",
      },
    }, null, 2)}\n`;
    const artifacts = defaultArtifacts().map((file) =>
      file.path === "package.json"
        ? { ...file, content: privatePackage }
        : file
    );
    const result = createClientHandoffExport(baseInput({
      artifacts,
      publicDependencyAllowlist: ["@agency/private-runtime"],
    }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "PRIVATE_DEPENDENCY" }),
      ]));
    }
  });

  it("rejects factory-only files even when explicitly allowlisted", () => {
    const artifacts = [
      ...defaultArtifacts(),
      artifact("factory/internal-runtime.mjs", "export {};\n", "SOURCE"),
    ];
    const result = createClientHandoffExport(baseInput({
      artifacts,
      artifactAllowlist: artifacts.map(({ path }) => path),
    }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ code: "FACTORY_PRIVATE_FILE" })],
    });
  });

  it("rejects an allowlisted artifact that is missing", () => {
    const result = createClientHandoffExport(baseInput({
      artifactAllowlist: [
        ...defaultArtifacts().map(({ path }) => path),
        "public/missing.svg",
      ],
    }));

    expect(result).toMatchObject({
      success: false,
      issues: [
        expect.objectContaining({ code: "MISSING_REQUIRED_ARTIFACT" }),
      ],
    });
  });

  it.each([
    {
      field: "moduleSelections" as const,
      value: [{
        moduleId: "booking_primary",
        type: "BOOKING_CTA" as const,
        version: "1.0.0",
        portability: "AGENCY_MANAGED" as const,
      }],
    },
    {
      field: "connectorSelections" as const,
      value: [{
        connectorId: "booking_primary",
        type: "BOOKING_LINK" as const,
        version: "1.0.0",
        portability: "AGENCY_MANAGED" as const,
      }],
    },
  ])("rejects unsupported $field portability", ({ field, value }) => {
    const result = createClientHandoffExport(baseInput({
      [field]: value,
    }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({
        code: "UNSUPPORTED_PORTABILITY",
      })],
    });
  });

  it("rejects agency-owned runtime infrastructure", () => {
    const configuration = baseInput().configuration as Record<string, unknown>;
    const configuredModules = configuration.modules as readonly Record<
      string,
      unknown
    >[];
    const result = createClientHandoffExport(baseInput({
      configuration: {
        ...configuration,
        modules: configuredModules.map((module) => ({
          ...module,
          infrastructureDependencies: ["BACKGROUND_JOBS"],
        })),
        configuredInfrastructure: [{
          kind: "BACKGROUND_JOBS",
          provider: "agency-runtime",
          accountOwner: "AGENCY",
        }],
      },
    }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({
        code: "UNSUPPORTED_PORTABILITY",
        path: "configuration.configuredInfrastructure",
      })],
    });
  });

  it("rejects cross-client identifiers inside an artifact", () => {
    const artifacts = defaultArtifacts().map((file) =>
      file.path === "src/index.mjs"
        ? { ...file, content: `export const client = "${OTHER_CLIENT_ID}";\n` }
        : file
    );
    const result = createClientHandoffExport(baseInput({ artifacts }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({
        code: "CLIENT_ISOLATION_VIOLATION",
      })],
    });
  });

  it("rejects an environment variable used without documentation", () => {
    const artifacts = defaultArtifacts().map((file) =>
      file.path === "src/index.mjs"
        ? { ...file, content: "export const endpoint = process.env.FORM_ENDPOINT;\n" }
        : file
    );
    const result = createClientHandoffExport(baseInput({ artifacts }));

    expect(result).toMatchObject({
      success: false,
      issues: [expect.objectContaining({
        code: "UNDOCUMENTED_ENVIRONMENT_VARIABLE",
      })],
    });
  });
});

describe("handoff integrity and recovery", () => {
  it("materializes deterministic bytes into an empty client directory", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "mlgo-handoff-"));
    const destination = join(temporaryRoot, "client-repository");
    try {
      const exported = successfulExport();
      const written = await writeClientHandoffDirectory(exported, destination);

      expect(written).toEqual({
        success: true,
        directory: destination,
        fileCount: exported.files.length,
        manifestDigest: exported.manifestDigest,
      });
      expect(
        new Uint8Array(await readFile(join(destination, "src", "index.mjs"))),
      ).toEqual(
        exported.files.find((file) => file.path === "src/index.mjs")?.content,
      );
      expect(await verifyClientHandoffDirectory(destination)).toMatchObject({
        success: true,
        checks: {
          integrity: "PASSED",
          portability: "PASSED",
          recovery: "PASSED",
        },
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("refuses to replace files in a non-empty handoff directory", async () => {
    const destination = await mkdtemp(join(tmpdir(), "mlgo-handoff-nonempty-"));
    try {
      await writeFile(join(destination, "owner-file.txt"), "preserve me");
      const result = await writeClientHandoffDirectory(
        successfulExport(),
        destination,
      );

      expect(result).toMatchObject({
        success: false,
        issues: [
          expect.objectContaining({ code: "EXPORT_DIRECTORY_NOT_EMPTY" }),
        ],
      });
      expect(await readFile(join(destination, "owner-file.txt"), "utf8"))
        .toBe("preserve me");
    } finally {
      await rm(destination, { recursive: true, force: true });
    }
  });

  it("fails recovery verification after a transferred file is tampered", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "mlgo-handoff-"));
    const destination = join(temporaryRoot, "client-repository");
    try {
      const written = await writeClientHandoffDirectory(
        successfulExport(),
        destination,
      );
      expect(written.success).toBe(true);
      await writeFile(
        join(destination, "src", "index.mjs"),
        "export const tampered = true;\n",
      );

      expect(await verifyClientHandoffDirectory(destination)).toMatchObject({
        success: false,
        issues: [
          expect.objectContaining({ code: "INTEGRITY_MISMATCH" }),
        ],
      });
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("validates the generated handoff manifest", () => {
    const exported = successfulExport();

    expect(validateClientHandoffManifest(exported.manifest)).toEqual({
      success: true,
      data: exported.manifest,
    });
    expect(validateClientHandoffManifest({
      ...exported.manifest,
      ownership: {
        ...exported.manifest.ownership,
        hosting: "AGENCY",
      },
    })).toMatchObject({
      success: false,
      issues: [expect.objectContaining({ code: "INVALID_HANDOFF_MANIFEST" })],
    });
  });

  it("detects a tampered exported file", () => {
    const exported = successfulExport();
    const tampered = exported.files.map((file) =>
      file.path === "src/index.mjs"
        ? {
          ...file,
          content: new TextEncoder().encode("export const tampered = true;\n"),
        }
        : file
    );

    const result = verifyClientHandoffExport(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "INTEGRITY_MISMATCH" }),
      ]));
    }
  });

  it("verifies integrity, portability, checklist, and recovery after export", () => {
    const exported = successfulExport();

    expect(verifyClientHandoffExport(exported.files)).toMatchObject({
      success: true,
      manifest: {
        clientId: CLIENT_ID,
        optionalDataRestorePlan: { status: "NOT_APPLICABLE" },
      },
      checks: {
        integrity: "PASSED",
        portability: "PASSED",
        recovery: "PASSED",
      },
    });
  });

  it("returns a no-persistence restore plan for a standard site", () => {
    expect(createOptionalDataRestorePlan([], [])).toEqual({
      success: true,
      data: {
        status: "NOT_APPLICABLE",
        reason: "No optional persistent infrastructure is configured",
      },
    });
  });

  it("requires an explicit client-owned restore plan for purchased persistence", () => {
    const result = createOptionalDataRestorePlan(
      [{
        kind: "DATABASE",
        provider: "portable-database-provider",
        accountOwner: "CLIENT",
      }],
      [{
        kind: "DATABASE",
        provider: "portable-database-provider",
        dataOwner: "CLIENT",
        backupOwner: "CLIENT",
        restoreOwner: "CLIENT",
        backupProcedure: "Export the provider backup in its portable format.",
        restoreProcedure: "Import the selected backup into the client account.",
        verificationProcedure: "Run the purchased feature recovery tests.",
      }],
    );

    expect(result).toEqual({
      success: true,
      data: {
        status: "REQUIRED",
        resources: [{
          kind: "DATABASE",
          provider: "portable-database-provider",
          dataOwner: "CLIENT",
          backupOwner: "CLIENT",
          restoreOwner: "CLIENT",
          backupProcedure: "Export the provider backup in its portable format.",
          restoreProcedure: "Import the selected backup into the client account.",
          verificationProcedure: "Run the purchased feature recovery tests.",
        }],
      },
    });
  });
});
