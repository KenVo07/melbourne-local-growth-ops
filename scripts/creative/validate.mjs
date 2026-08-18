/**
 * Validates a creative delivery directory.
 *
 *   pnpm creative:validate <directory>
 *   pnpm creative:validate:self-test
 *
 * Checks presence, traceability, provenance and internal consistency — never
 * taste. Every failure names the artifact, the field and the thing to write,
 * because the intended operator is a Digital Experience specialist who does not
 * write source and should not have to read a JSON pointer to fix a document.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ARTIFACTS } from "./artifact-model.mjs";
import {
  loadEnvelope,
  parseFrontMatter,
  validateArtifacts,
} from "./validate-core.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

async function readDelivery(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const documents = [];
  const skipped = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const text = await readFile(join(directory, entry.name), "utf8");
    const { frontMatter, body } = parseFrontMatter(text);
    if (frontMatter === null || frontMatter.kind === undefined) {
      skipped.push(entry.name);
      continue;
    }
    if (ARTIFACTS[frontMatter.kind] === undefined) {
      skipped.push(`${entry.name} (unknown kind "${frontMatter.kind}")`);
      continue;
    }
    documents.push({
      name: entry.name,
      kind: frontMatter.kind,
      frontMatter,
      body,
    });
  }
  return { documents, skipped };
}

async function main() {
  const args = process.argv.slice(2);
  const envelope = loadEnvelope(
    await readFile(
      resolve(repositoryRoot, "docs/creative/signature-capability-envelope.json"),
      "utf8",
    ),
  );

  if (args.includes("--self-test")) {
    const { runSelfTest } = await import("./self-test.mjs");
    const failures = runSelfTest(envelope);
    if (failures.length > 0) {
      for (const failure of failures) process.stdout.write(`FAIL  ${failure}\n`);
      process.stdout.write(`\nCREATIVE VALIDATOR SELF-TEST: FAIL (${failures.length})\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write("CREATIVE VALIDATOR SELF-TEST: PASS\n");
    return;
  }

  const target = args.find((value) => !value.startsWith("--"));
  if (target === undefined) {
    process.stdout.write(
      "usage: pnpm creative:validate <delivery-directory>\n       pnpm creative:validate --self-test\n",
    );
    process.exitCode = 1;
    return;
  }

  const directory = resolve(target);
  const { documents, skipped } = await readDelivery(directory);
  if (documents.length === 0) {
    process.stdout.write(
      `No creative artifacts found in ${directory}.\nAn artifact is a Markdown file whose front-matter declares a "kind".\n`,
    );
    process.exitCode = 1;
    return;
  }

  const problems = validateArtifacts(documents, envelope);
  const counts = [...new Set(documents.map(({ kind }) => kind))]
    .sort()
    .map((kind) => `${documents.filter((d) => d.kind === kind).length}× ${kind}`)
    .join(", ");

  process.stdout.write(`${basename(directory)}: ${documents.length} artifact(s) — ${counts}\n`);
  for (const name of skipped) process.stdout.write(`  skipped ${name}\n`);

  if (problems.length === 0) {
    process.stdout.write(`\nCREATIVE DELIVERY VALIDATION: PASS\n`);
    return;
  }
  process.stdout.write("\n");
  for (const { file, message } of problems) {
    process.stdout.write(`  ${file} ${message}\n`);
  }
  process.stdout.write(
    `\nCREATIVE DELIVERY VALIDATION: FAIL (${problems.length} problem${problems.length === 1 ? "" : "s"})\n`,
  );
  process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
