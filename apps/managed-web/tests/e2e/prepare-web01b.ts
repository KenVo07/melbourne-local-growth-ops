import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { assembleClientSourceArtifact } from "../../src/generation";
import { createIsolatedBuildEnvironment } from "../../src/generation/build-environment";

const applicationRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(applicationRoot, "../..");
const artifactRoot = "/tmp/proportion-web01b-e2e";

interface ArtifactFixture {
  readonly id: string;
  readonly definitionPath: string;
  readonly publicDirectory: string;
  readonly foundationSearch?: Record<string, unknown>;
}

const fixtures: readonly ArtifactFixture[] = [
  {
    id: "contractor-reference",
    definitionPath: "tests/fixtures/web01b/contractor/reference-client-website.json",
    publicDirectory: "apps/managed-web/client/examples/contractor/public",
  },
  {
    id: "contractor-field-guide",
    definitionPath: "tests/fixtures/web01b/contractor/field-guide-client-website.json",
    publicDirectory: "apps/managed-web/client/examples/contractor/public",
    foundationSearch: {
      schemaVersion: 1,
      mode: "ON",
      includeSectionIds: ["services", "trust", "faq", "contact"],
    },
  },
  {
    id: "restaurant",
    definitionPath: "apps/managed-web/client/examples/restaurant/client-website.json",
    publicDirectory: "apps/managed-web/client/examples/restaurant/public",
  },
  {
    id: "retailer",
    definitionPath: "apps/managed-web/client/examples/retailer/client-website.json",
    publicDirectory: "apps/managed-web/client/examples/retailer/public",
  },
];

await rm(artifactRoot, { force: true, recursive: true });
await runPnpm(applicationRoot, ["build"]);

for (const fixture of fixtures) {
  const parsed = JSON.parse(
    await readFile(resolve(repositoryRoot, fixture.definitionPath), "utf8"),
  ) as Record<string, unknown>;
  const definition = fixture.foundationSearch === undefined
    ? parsed
    : { ...parsed, foundationSearch: fixture.foundationSearch };
  const publicDirectory = await fixturePublicDirectory(fixture, definition);
  const artifact = await assembleClientSourceArtifact({
    definition,
    publicDirectory,
    outputDirectory: resolve(artifactRoot, fixture.id),
    factoryRevision: "web01b-production-e2e",
  });
  await runPnpm(artifact.sourceDirectory, [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
  ]);
  await runPnpm(artifact.sourceDirectory, ["build"]);
}

async function fixturePublicDirectory(
  fixture: ArtifactFixture,
  definition: Record<string, unknown>,
): Promise<string> {
  const declaredDirectory = resolve(repositoryRoot, fixture.publicDirectory);
  if (fixture.id.startsWith("contractor-")) return declaredDirectory;

  const generatedDirectory = resolve(artifactRoot, "fixture-public", fixture.id);
  const sourceImage = resolve(
    repositoryRoot,
    "apps/managed-web/client/examples/contractor/public/assets/hero/primary.png",
  );
  const assets = Array.isArray(definition.assets)
    ? definition.assets
    : [];
  for (const asset of assets) {
    if (
      typeof asset !== "object" ||
      asset === null ||
      !("sourcePath" in asset) ||
      typeof asset.sourcePath !== "string"
    ) {
      throw new TypeError(`Fixture ${fixture.id} contains an invalid asset entry.`);
    }
    const destination = resolve(generatedDirectory, asset.sourcePath);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(sourceImage, destination);
  }
  return generatedDirectory;
}

async function runPnpm(directory: string, arguments_: readonly string[]) {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("pnpm", [...arguments_], {
      cwd: directory,
      env: createIsolatedBuildEnvironment(process.env),
      stdio: "inherit",
    });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else {
        rejectPromise(
          new Error(`E2E preparation failed during pnpm ${arguments_.join(" ")}.`),
        );
      }
    });
  });
}
