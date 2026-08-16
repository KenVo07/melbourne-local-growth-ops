import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  readonly stress?: boolean;
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
    id: "contractor-stress",
    definitionPath: "tests/fixtures/web01b/contractor/field-guide-client-website.json",
    publicDirectory: "apps/managed-web/client/examples/contractor/public",
    stress: true,
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

const candidateRevision = await gitOutput(["rev-parse", "HEAD"]);
const trackedChanges = await gitOutput(["status", "--porcelain", "--untracked-files=no"]);
if (trackedChanges !== "") {
  throw new Error(
    `Production evidence must run from a clean candidate tree. Tracked changes:\n${trackedChanges}`,
  );
}

await rm(artifactRoot, { force: true, recursive: true });
await mkdir(artifactRoot, { recursive: true });
await writeFile(resolve(artifactRoot, "candidate-sha.txt"), `${candidateRevision}\n`);
await runPnpm(applicationRoot, ["build"]);

for (const fixture of fixtures) {
  const parsed = JSON.parse(
    await readFile(resolve(repositoryRoot, fixture.definitionPath), "utf8"),
  ) as Record<string, unknown>;
  let definition = fixture.foundationSearch === undefined
    ? parsed
    : { ...parsed, foundationSearch: fixture.foundationSearch };
  if (fixture.stress === true) definition = stressDefinition(definition);
  const publicDirectory = await fixturePublicDirectory(fixture, definition);
  const artifact = await assembleClientSourceArtifact({
    definition,
    publicDirectory,
    outputDirectory: resolve(artifactRoot, fixture.id),
    factoryRevision: candidateRevision,
  });
  await runPnpm(artifact.sourceDirectory, [
    "install",
    "--frozen-lockfile",
    "--ignore-scripts",
  ]);
  await runPnpm(artifact.sourceDirectory, ["build"]);
}

process.stdout.write(`WEB-01B production fixtures prepared for ${candidateRevision}.\n`);

function stressDefinition(
  definition: Record<string, unknown>,
): Record<string, unknown> {
  const stressed = structuredClone(definition);
  if (!isRecord(stressed.profile) || !Array.isArray(stressed.profile.sections)) {
    throw new TypeError("Contractor stress fixture has no profile sections.");
  }

  stressed.profile.sections = stressed.profile.sections.map((value) => {
    if (!isRecord(value)) return value;
    if (value.type === "SERVICES") {
      return {
        ...value,
        heading: "Illustrative Services with Long, Awkward and Many-item Content",
        items: Array.from({ length: 18 }, (_, index) => ({
          title: `Stress service ${index + 1}: switchboards, lighting and split systems`,
          description:
            `This deliberately long service description ${index + 1} verifies that detailed scope, exclusions, access constraints, scheduling notes, and client-verification caveats remain readable at narrow widths. ` +
            "unbroken-reference-abcdefghijklmnopqrstuvwxyz0123456789-abcdefghijklmnopqrstuvwxyz0123456789",
        })),
      };
    }
    if (value.type === "CONTACT") {
      return {
        ...value,
        body: "Use this form for an unusually detailed enquiry covering multiple rooms, access constraints, preferred dates, switchboard history, appliance symptoms, and follow-up questions. The long copy is intentional stress evidence; sensitive information must still not be submitted.",
      };
    }
    if (value.type === "ACTIONS" && Array.isArray(value.actions)) {
      return {
        ...value,
        actions: value.actions.map((action) => isRecord(action)
          ? {
              ...action,
              label: "Phone and emergency call-out contact remains unavailable in this stress fixture",
              message: "No verified phone number or emergency service is configured. Use the enquiry form and do not interpret this deliberately long fallback as a live or urgent-response channel.",
            }
          : action),
      };
    }
    if (value.type === "FAQ") {
      return {
        ...value,
        items: Array.from({ length: 18 }, (_, index) => ({
          question: `Detailed stress question ${index + 1} about service scope and scheduling?`,
          answer: `Answer ${index + 1} remains illustrative and intentionally verbose so repeated disclosure, scheduling, scope, and verification language can be checked without clipping or overlap on a 320px viewport.`,
        })),
      };
    }
    return value;
  });
  return stressed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function gitOutput(arguments_: readonly string[]): Promise<string> {
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn("git", [...arguments_], {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise(stdout.trim());
      else rejectPromise(new Error(`git ${arguments_.join(" ")} failed: ${stderr.trim()}`));
    });
  });
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
