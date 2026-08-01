import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createClientHandoffExport,
  writeClientHandoffDirectory,
} from "../../packages/deployment/dist/index.js";
import { exportClientRepositoryCommand } from "./export.mjs";
import { planClientHandoffCommand } from "./plan.mjs";
import { verifyHandoffRecoveryCommand } from "./recovery.mjs";
import { verifyHandoffOnCleanMachine } from "./verify.mjs";

function capture() {
  const lines = [];
  return {
    lines,
    write: (line) => lines.push(line),
  };
}

function artifact(path, content, category) {
  return {
    path,
    content,
    category,
    clientId: "client_command_fixture",
    provenance: {
      origin: category === "VENDORED_RUNTIME"
        ? "TRANSFORMED_FACTORY_RUNTIME"
        : "GENERATED",
      version: "1.0.0",
    },
  };
}

function handoffInput() {
  const packageJson = `${JSON.stringify({
    name: "command-fixture-site",
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
  const artifacts = [
    artifact("package.json", packageJson, "PACKAGE"),
    artifact(
      "pnpm-lock.yaml",
      "lockfileVersion: '9.0'\n\nsettings:\n  autoInstallPeers: true\n  excludeLinksFromLockfile: false\n\nimporters:\n\n  .: {}\n",
      "PACKAGE",
    ),
    artifact(
      ".gitignore",
      "node_modules/\n.next/\nbuild/\n.env\n.env.*\n!.env.example\n",
      "CONFIGURATION",
    ),
    artifact(
      "src/index.mjs",
      "export const site = 'client_command_fixture';\n",
      "SOURCE",
    ),
    artifact(
      "src/vendor/runtime.mjs",
      "export const runtimeVersion = '1.0.0';\n",
      "VENDORED_RUNTIME",
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
      "import assert from 'node:assert/strict';\n" +
        "import test from 'node:test';\n" +
        "test('portable site', () => assert.equal(1, 1));\n",
      "TEST",
    ),
  ];
  return {
    configuration: {
      schemaVersion: 1,
      configurationId: "website_command_fixture",
      configurationVersion: 1,
      clientId: "client_command_fixture",
      entitlementId: "entitlement_command_fixture",
      deploymentId: "deployment_command_fixture",
      display: {
        businessName: "Command Fixture",
        locationIds: ["location_command_fixture"],
      },
      domains: [{ hostname: "command-fixture.example", canonical: true }],
      modules: [{
        schemaVersion: 1,
        moduleId: "booking_command_fixture",
        connectorId: "booking_command_fixture",
        type: "BOOKING_CTA",
        label: "Book",
      }],
      connectors: [{
        schemaVersion: 1,
        connectorId: "booking_command_fixture",
        accountOwner: "CLIENT",
        portability: "CLIENT_OWNED",
        type: "BOOKING_LINK",
        bookingUrl: "https://command-fixture.example/book",
      }],
      configuredInfrastructure: [],
    },
    deploymentManifest: {
      schemaVersion: 1,
      deploymentId: "deployment_command_fixture",
      clientId: "client_command_fixture",
      configurationId: "website_command_fixture",
      configurationVersion: 1,
      applicationVersion: "1.0.0",
      deliveryMode: "CLIENT_HANDOFF",
      infrastructureOwnership: [],
      domains: [{ hostname: "command-fixture.example", canonical: true }],
      buildProvenance: {
        buildId: "build_command_fixture",
        sourceRevision: "abcdef0123456789abcdef0123456789",
        generatedAt: "2026-07-29T09:00:00.000Z",
      },
      handoff: { status: "IN_PROGRESS", targetOwner: "CLIENT" },
    },
    repositoryName: "command-fixture-site",
    exportedAt: "2026-07-29T10:00:00.000Z",
    ownership: {
      sourceRepository: "CLIENT",
      hosting: "CLIENT",
      analytics: "CLIENT",
      domains: "CLIENT",
    },
    artifacts,
    artifactAllowlist: artifacts.map(({ path }) => path),
    moduleSelections: [{
      moduleId: "booking_command_fixture",
      type: "BOOKING_CTA",
      version: "1.0.0",
      portability: "TRANSFERABLE",
    }],
    connectorSelections: [{
      connectorId: "booking_command_fixture",
      type: "BOOKING_LINK",
      version: "1.0.0",
      portability: "CLIENT_OWNED",
    }],
    publicDependencyAllowlist: [],
    requiredEnvironmentVariables: [],
    otherClientIdentifiers: ["client_not_this_fixture"],
    optionalDataResources: [],
  };
}

function successfulExport() {
  const result = createClientHandoffExport(handoffInput());
  assert.equal(result.success, true);
  return result.export;
}

test("plan is deterministic and has no filesystem apply side effect", async () => {
  const output = capture();
  const result = await planClientHandoffCommand({
    input: handoffInput(),
    createExport: (input) => {
      const planned = createClientHandoffExport(input);
      return planned;
    },
    write: output.write,
  });

  assert.equal(result.success, true);
  assert.equal(result.plan.secretScan, "PASSED");
  assert.deepEqual(JSON.parse(output.lines[0]), result);
});

test("export applies only through the injected directory writer", async () => {
  const output = capture();
  let writes = 0;
  const result = await exportClientRepositoryCommand({
    input: handoffInput(),
    destination: "ignored-fixture-directory",
    writeDirectory: async (exported) => {
      writes += 1;
      return {
        success: true,
        directory: "client-owned-repository",
        fileCount: exported.files.length,
        manifestDigest: exported.manifestDigest,
      };
    },
    write: output.write,
  });

  assert.equal(writes, 1);
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(output.lines[0]), result);
});

test("recovery command verifies without provider or DNS mutation", async () => {
  const output = capture();
  const result = await verifyHandoffRecoveryCommand({
    directory: "ignored-fixture-directory",
    verify: async () => ({
      success: true,
      manifest: successfulExport().manifest,
      checks: {
        integrity: "PASSED",
        portability: "PASSED",
        recovery: "PASSED",
      },
    }),
    write: output.write,
  });

  assert.equal(result.success, true);
  assert.equal(result.externalProviderMutation, false);
  assert.deepEqual(JSON.parse(output.lines[0]), result);
});

test("clean-machine verifier performs offline install, typecheck, build, tests, and integrity", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mlgo-command-handoff-"));
  const destination = join(temporaryRoot, "transferred-repository");
  try {
    const exported = successfulExport();
    const materialized = await writeClientHandoffDirectory(
      exported,
      destination,
    );
    assert.equal(materialized.success, true);

    const result = await verifyHandoffOnCleanMachine({
      sourceDirectory: destination,
      offline: true,
    });

    assert.deepEqual(result, {
      success: true,
      checks: ["install", "typecheck", "build", "test", "integrity"],
      sourceClientId: "client_command_fixture",
      sourceDeploymentId: "deployment_command_fixture",
      ambientSecretsForwarded: false,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("clean-machine verifier does not forward ambient credential variables", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "mlgo-command-handoff-"));
  const destination = join(temporaryRoot, "transferred-repository");
  const markerName = "HANDOFF_CREDENTIAL_SHAPED_FIXTURE";
  const markerValue = "credential-shaped-environment-fixture";
  process.env[markerName] = markerValue;
  try {
    const materialized = await writeClientHandoffDirectory(
      successfulExport(),
      destination,
    );
    assert.equal(materialized.success, true);
    const environments = [];
    const result = await verifyHandoffOnCleanMachine({
      sourceDirectory: destination,
      run: async ({ environment }) => {
        environments.push(environment);
        return true;
      },
    });

    assert.equal(result.success, true);
    assert.equal(JSON.stringify(environments).includes(markerName), false);
    assert.equal(JSON.stringify(environments).includes(markerValue), false);
  } finally {
    delete process.env[markerName];
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("command failures are closed and do not reveal thrown payloads", async () => {
  const marker = "credential-shaped-command-marker";
  const output = capture();
  const result = await planClientHandoffCommand({
    input: handoffInput(),
    createExport: () => {
      throw new Error(marker);
    },
    write: output.write,
  });

  assert.deepEqual(result, {
    success: false,
    error: {
      code: "HANDOFF_COMMAND_FAILED",
      message: "Client handoff command failed",
    },
  });
  assert.equal(output.lines[0].includes(marker), false);
});
