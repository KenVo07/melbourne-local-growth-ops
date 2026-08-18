/**
 * Asserts the Creative Delivery System's load-bearing structural property:
 *
 *   Nothing under `docs/creative/` or `scripts/creative/` is reachable from a
 *   client website's runtime.
 *
 * `docs/creative/creative-delivery-system.md` §7 R3 states this is "asserted by
 * test rather than by intent". This is that test. Without it the claim is a
 * promise, and R3's own finding was that anything importable eventually gets
 * imported.
 *
 *   node --test scripts/creative/creative-commands.test.mjs
 */
import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

const CREATIVE_DIRECTORIES = ["docs/creative", "scripts/creative"];

const SKIPPED_DIRECTORIES = new Set([
  "node_modules",
  ".git",
  ".next",
  ".vercel",
  "dist",
]);

/** Every file in the tree, excluding build output and dependencies. */
async function walk(directory, collected = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
      await walk(join(directory, entry.name), collected);
    } else if (entry.isFile()) {
      collected.push(join(directory, entry.name));
    }
  }
  return collected;
}

async function workspacePackageJsonPaths() {
  const files = await walk(repositoryRoot);
  return files.filter((file) => file.endsWith("package.json"));
}

test("no workspace package declares a creative path as a dependency or file", async () => {
  for (const path of await workspacePackageJsonPaths()) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const declarations = [
      ...Object.entries(manifest.dependencies ?? {}),
      ...Object.entries(manifest.devDependencies ?? {}),
      ...Object.entries(manifest.peerDependencies ?? {}),
      ...Object.entries(manifest.optionalDependencies ?? {}),
    ];

    for (const [name, specifier] of declarations) {
      for (const directory of CREATIVE_DIRECTORIES) {
        assert.ok(
          !String(specifier).includes(directory),
          `${path} declares dependency "${name}" resolving into ${directory}`,
        );
      }
    }

    for (const entry of manifest.files ?? []) {
      for (const directory of CREATIVE_DIRECTORIES) {
        assert.ok(
          !String(entry).includes(directory),
          `${path} publishes ${entry}, which reaches into ${directory}`,
        );
      }
    }

    /* The root package legitimately names the scripts as command entry points.
     * Every other manifest must not mention them at all. */
    if (resolve(path) !== resolve(repositoryRoot, "package.json")) {
      const raw = await readFile(path, "utf8");
      for (const directory of CREATIVE_DIRECTORIES) {
        assert.ok(
          !raw.includes(directory),
          `${path} references ${directory}; only the root package may name the creative commands`,
        );
      }
    }
  }
});

test("neither creative directory is itself a workspace package", async () => {
  for (const directory of CREATIVE_DIRECTORIES) {
    const manifest = resolve(repositoryRoot, directory, "package.json");
    await assert.rejects(
      stat(manifest),
      /ENOENT/,
      `${directory}/package.json exists; a workspace package is resolvable from client source`,
    );
  }
});

test("no source file imports from a creative directory", async () => {
  const sourceRoots = ["apps", "packages", "tests"];
  const importPattern = /(?:from\s+|import\s*\(|require\s*\()\s*["'`]([^"'`]+)["'`]/g;

  for (const root of sourceRoots) {
    const rootPath = resolve(repositoryRoot, root);
    let files;
    try {
      files = await walk(rootPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!/\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file)) continue;
      const contents = await readFile(file, "utf8");
      for (const match of contents.matchAll(importPattern)) {
        const specifier = match[1];
        for (const directory of CREATIVE_DIRECTORIES) {
          assert.ok(
            !specifier.includes(directory),
            `${file} imports "${specifier}", reaching into ${directory}`,
          );
        }
      }
    }
  }
});

test("no client artifact file list carries a creative path", async () => {
  const files = await walk(repositoryRoot);
  const artifactManifests = files.filter(
    (file) =>
      file.endsWith("client-artifact.json") ||
      file.endsWith("handoff-manifest.json") ||
      file.endsWith("client-website.json"),
  );

  for (const path of artifactManifests) {
    const raw = await readFile(path, "utf8");
    for (const directory of CREATIVE_DIRECTORIES) {
      assert.ok(
        !raw.includes(directory),
        `${path} lists a path inside ${directory}; the creative system reached an artifact`,
      );
    }
  }
});

test("the creative system ships no importable runtime module", async () => {
  const files = await walk(resolve(repositoryRoot, "scripts/creative"));
  for (const file of files) {
    assert.ok(
      !file.endsWith(".d.ts"),
      `${file} publishes types, which is the first step to being imported`,
    );
  }

  const docs = await walk(resolve(repositoryRoot, "docs/creative"));
  for (const file of docs) {
    assert.ok(
      /\.(?:md|json)$/.test(file),
      `${file} is not documentation; docs/creative must hold only Markdown and generated JSON`,
    );
  }
});
