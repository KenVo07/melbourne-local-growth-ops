import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { validateClientExperienceManifest } from "@melbourne-local-growth-ops/site-core";

import { inspectClientExperienceSource } from "../src/generation/client-experience-source-policy";

/**
 * Stages one client input directory into the private Factory application so the
 * multi-route runtime can be built and served against real data.
 *
 * This is a development and evidence tool, not the delivery path. Client
 * delivery goes through `assembleClientSourceArtifact`, which performs the same
 * inspection and writes a standalone artifact. Both share the source policy, so
 * staging can never introduce source that the artifact path would reject.
 *
 * Usage:
 *   tsx scripts/stage-client-input.ts <input-directory>
 *   tsx scripts/stage-client-input.ts --restore
 */
const applicationRoot = resolve(import.meta.dirname, "..");
const canonicalDefinition = resolve(applicationRoot, "client/client-website.json");
const authoredDirectory = resolve(applicationRoot, "src/client-experience/authored");
const legacyPlaceholder = `import type { ClientExperienceDefinition } from "../contract";

/**
 * Authored client experience source slot.
 *
 * A legacy (\`schemaVersion: 1\`) client has no authored experience, so this
 * placeholder exports \`undefined\` and nothing in the client-experience runtime
 * is reached. The generator replaces this directory with the client's inspected
 * \`experience/\` source when assembling an authored artifact, which is why the
 * import path is fixed rather than configurable.
 *
 * This file is the only module the Kernel imports from authored source. Do not
 * add Platform logic here.
 */
export const authoredClientExperience: ClientExperienceDefinition | undefined =
  undefined;
`;

const [argument] = process.argv.slice(2);
if (argument === undefined) {
  throw new TypeError(
    "Usage: tsx scripts/stage-client-input.ts <input-directory> | --restore",
  );
}

if (argument === "--restore") {
  await restoreLegacyPlaceholder();
  process.stdout.write("Restored the legacy authored-source placeholder.\n");
} else {
  await stage(resolve(argument));
}

async function stage(inputDirectory: string): Promise<void> {
  const definition = JSON.parse(
    await readFile(resolve(inputDirectory, "client-website.json"), "utf8"),
  ) as { readonly schemaVersion?: unknown };

  if (definition.schemaVersion !== 2) {
    await restoreLegacyPlaceholder();
    await cp(
      resolve(inputDirectory, "client-website.json"),
      canonicalDefinition,
    );
    process.stdout.write("Staged a legacy client input.\n");
    return;
  }

  const manifest = validateClientExperienceManifest(
    JSON.parse(
      await readFile(
        resolve(inputDirectory, "experience/manifest.json"),
        "utf8",
      ),
    ),
  );
  if (!manifest.success) {
    throw new Error(
      `Client experience manifest is invalid: ${manifest.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  // The same gate the artifact assembler applies. Nothing is copied first.
  const inspected = await inspectClientExperienceSource({
    inputDirectory,
    manifest: manifest.data,
    approvedPublicDependencies: manifest.data.publicDependencies.map(
      ({ name }) => name,
    ),
  });

  await rm(authoredDirectory, { force: true, recursive: true });
  await cp(resolve(inputDirectory, "experience"), authoredDirectory, {
    recursive: true,
  });
  await cp(resolve(inputDirectory, "client-website.json"), canonicalDefinition);

  process.stdout.write(
    `Staged authored experience "${manifest.data.experienceId}" ` +
      `(${inspected.files.length} inspected files) from ${inputDirectory}.\n`,
  );
}

async function restoreLegacyPlaceholder(): Promise<void> {
  await rm(authoredDirectory, { force: true, recursive: true });
  await mkdir(authoredDirectory, { recursive: true });
  await writeFile(resolve(authoredDirectory, "index.tsx"), legacyPlaceholder);
  // A legacy client has no manifest. The slot still needs the file so the
  // static import in client-website.ts always resolves.
  await writeFile(resolve(authoredDirectory, "manifest.json"), "null\n");
}
