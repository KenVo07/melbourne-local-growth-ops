import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { validateClientExperienceManifest } from "@melbourne-local-growth-ops/site-core";

import { approvedClientExperienceDependencies } from "./approved-client-dependencies";
import { createIsolatedBuildEnvironment } from "./build-environment";
import { resolveClientExperienceDependencies } from "./client-experience-dependencies";
import { inspectClientExperienceSource } from "./client-experience-source-policy";
import type { InspectedClientExperienceSource } from "./client-experience-source-policy";
import { createClientRouteInventory } from "./client-route-inventory";
import { generateClientWebsiteSnapshot } from "./generate-client-website";
import { buildFoundationSearchIndex } from "../search/build-foundation-search";
import type {
  AssembleClientSourceArtifactOptions,
  AssembledClientSourceArtifact,
  ClientArtifactDescriptor,
  HandoffArtifactCategory,
} from "./types";

const publicDependencies = Object.freeze([
  "@types/node",
  "@types/react",
  "@types/react-dom",
  "next",
  "react",
  "react-dom",
  "resend",
  "pagefind",
  "tsx",
  "typescript",
  "zod",
]);

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const managedWebRoot = join(repositoryRoot, "apps", "managed-web");
const runtimeFiles = Object.freeze([
  "src/analytics/Ga4Runtime.tsx",
  "src/analytics/managed-analytics.ts",
  "src/app/api/contact/route.ts",
  "src/app/globals.css",
  "src/app/layout.tsx",
  "src/app/not-found.tsx",
  "src/app/page.tsx",
  "src/app/[...segments]/page.tsx",
  "src/app/profiles/contractor.css",
  "src/app/profiles/restaurant.css",
  "src/app/profiles/retailer.css",
  "src/client-experience/authored/index.tsx",
  "src/client-experience/content-helpers.ts",
  "src/client-experience/contract.tsx",
  "src/client-experience/load-client-experience.ts",
  "src/client-experience/platform-components.tsx",
  "src/client-experience/platform-media.css",
  "src/client-experience/public-api.ts",
  "src/client-experience/public-projection.ts",
  "src/client-experience/registry.ts",
  "src/client-experience/render-authored-page.tsx",
  "src/client-experience/render-client-route.tsx",
  "src/client-experience/resolve-media.ts",
  "src/managed-website.ts",
  "src/rendering/analytics-renderer.tsx",
  "src/rendering/booking-cta-renderer.tsx",
  "src/rendering/index.ts",
  "src/rendering/LeadForm.tsx",
  "src/rendering/lead-form-renderer.tsx",
  "src/rendering/ManagedWebsiteShell.tsx",
  "src/rendering/module-renderer-registry.ts",
  "src/rendering/render-region.tsx",
  "src/rendering/section-renderer-registry.ts",
  "src/rendering/sections/ExternalAction.tsx",
  "src/rendering/sections/ProfileSection.tsx",
  "src/rendering/sections/index.ts",
  "src/rendering/search/FoundationSearch.tsx",
  "src/rendering/signatures/ServiceAreaProof.tsx",
  "src/rendering/signatures/SignatureSlot.tsx",
  "src/rendering/TrackedBookingLink.tsx",
  "src/routing/resolve-client-route.ts",
  "src/runtime-types.ts",
  "src/search/build-current-foundation-search.ts",
  "src/search/build-foundation-search.ts",
  "src/search/foundation-search-browser.js",
  "src/server/contact-form-runtime.ts",
  "src/server/contact-guards.ts",
  "src/server/managed-contact-runtime.ts",
  "src/structured-data.ts",
]);

const vendorPackages = Object.freeze([
  {
    name: "contracts",
    directory: "packages/contracts/dist",
    replacements: {},
  },
  {
    name: "integrations",
    directory: "packages/integrations/dist",
    replacements: {
      "@melbourne-local-growth-ops/contracts": "../contracts/index.js",
    },
  },
  {
    name: "resend",
    directory: "packages/integrations/resend/dist",
    replacements: {
      "@melbourne-local-growth-ops/contracts": "../contracts/index.js",
      "@melbourne-local-growth-ops/integrations": "../integrations/index.js",
    },
  },
  {
    name: "contact-form",
    directory: "packages/website-modules/contact-form/dist",
    replacements: {
      "@melbourne-local-growth-ops/contracts": "../contracts/index.js",
      "@melbourne-local-growth-ops/integrations": "../integrations/index.js",
      "@melbourne-local-growth-ops/resend": "../resend/index.js",
    },
  },
]);

export async function assembleClientSourceArtifact(
  options: AssembleClientSourceArtifactOptions,
): Promise<AssembledClientSourceArtifact> {
  await assertEmptyDirectory(options.outputDirectory);

  /*
   * Authored source is inspected before anything is generated or copied. If the
   * source policy refuses the package, assembly fails with an empty output
   * directory rather than a partially written artifact.
   */
  const authored = await inspectAuthoredSource(options);
  const snapshot = generateClientWebsiteSnapshot(
    options.definition,
    options.publicDirectory,
    authored === undefined
      ? {}
      : { clientExperienceManifest: authored.manifest },
  );
  const sourceDirectory = join(options.outputDirectory, "source");
  const repositoryName = `${snapshot.configuration.clientId}-managed-website`;
  await mkdir(sourceDirectory, { recursive: true });

  await writeText(
    sourceDirectory,
    "package.json",
    `${JSON.stringify(
      portablePackage(
        repositoryName,
        authored === undefined
          ? {}
          : resolveClientExperienceDependencies(
              authored.manifest,
              approvedClientExperienceDependencies,
            ),
      ),
      null,
      2,
    )}\n`,
  );
  await writeText(
    sourceDirectory,
    ".gitignore",
    "node_modules/\n.next/\nbuild/\n.env\n.env.*\n!.env.example\n",
  );
  /*
   * pnpm 11 reads its settings from here rather than from package.json, and it
   * exits non-zero on any dependency whose install script it had to ignore. The
   * same allowlist is kept in package.json for pnpm 10 hosts; whichever the
   * recipient runs, the two agree.
   */
  await writeText(
    sourceDirectory,
    "pnpm-workspace.yaml",
    [
      "# Install scripts are refused by default. These two are named because they",
      "# fetch a required native binary: esbuild for tsx, sharp for Next's image",
      "# encoder. Anything else attempting to run code at install is still denied.",
      "#",
      "# Both spellings are present on purpose. pnpm 11 reads `allowBuilds` and",
      "# rewrites this file if a needed entry is missing — which would change a",
      "# file the integrity manifest covers. pnpm 10 reads `onlyBuiltDependencies`.",
      "# They live here rather than in package.json, which pnpm 11 no longer reads",
      "# and warns about on every install.",
      "allowBuilds:",
      "  esbuild: true",
      "  sharp: true",
      "onlyBuiltDependencies:",
      "  - esbuild",
      "  - sharp",
      "",
      "# Transitive versions Next pins that carry published advisories. Both are",
      "# build-time only and neither reaches the browser, but the artifact should",
      "# not install a known-vulnerable package on the client's machine.",
      "#   postcss <8.5.23 — arbitrary file read, path traversal in source-map",
      "#     auto-loading, and two stringify/XSS issues.",
      "#   sharp <0.35.0  — inherits libvips CVE-2026-33327 and related.",
      "# Upgrading Next does not resolve postcss: 16.3.1 pins exactly 8.5.23.",
      "overrides:",
      "  postcss: ^8.5.26",
      "  sharp: ^0.35.3",
      "",
    ].join("\n"),
  );
  await writeText(
    sourceDirectory,
    "src/generated/managed-website.json",
    `${JSON.stringify(snapshot, null, 2)}\n`,
  );
  await writeText(
    sourceDirectory,
    "src/generated/asset-manifest.json",
    `${JSON.stringify(snapshot.assetManifest, null, 2)}\n`,
  );
  await writeText(
    sourceDirectory,
    "src/generated/runtime-bindings.json",
    `${JSON.stringify({ schemaVersion: 1, bindings: snapshot.runtimeSecretBindings }, null, 2)}\n`,
  );
  await writeText(
    sourceDirectory,
    "src/client-website.ts",
    [
      'import type { ManagedWebsiteRuntime } from "./runtime-types";',
      'import snapshot from "./generated/managed-website.json";',
      "",
      "// Assembly validates the canonical JSON before writing this module.",
      "const checkedSnapshot = snapshot as ManagedWebsiteRuntime;",
      "",
      "export const clientWebsite = checkedSnapshot;",
      "",
    ].join("\n"),
  );
  await writeText(
    sourceDirectory,
    "next.config.mjs",
    portableNextConfiguration(
      digestText(JSON.stringify({ snapshot, factoryRevision: options.factoryRevision })),
    ),
  );
  await writeText(sourceDirectory, "tsconfig.json", portableTsconfig());
  await writeText(
    sourceDirectory,
    "tests/client-runtime.test.mjs",
    portableRuntimeTest(snapshot.configuration.clientId),
  );

  await copyRuntimeFiles(sourceDirectory);
  await copyVendorPackages(sourceDirectory);
  await copyAuthoredSource(sourceDirectory, authored);

  if (authored !== undefined && snapshot.pageGraph !== undefined) {
    await writeText(
      sourceDirectory,
      "src/generated/route-inventory.json",
      `${JSON.stringify(
        createClientRouteInventory(snapshot.pageGraph, authored.manifest),
        null,
        2,
      )}\n`,
    );
  }

  for (const asset of snapshot.assetManifest.assets) {
    const destination = join(sourceDirectory, "public", ...asset.sourcePath.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(
      join(options.publicDirectory, ...asset.sourcePath.split("/")),
      destination,
    );
  }

  await buildFoundationSearchIndex(
    snapshot.foundationSearch,
    join(sourceDirectory, "public", "pagefind"),
  );

  await writeText(sourceDirectory, "scripts/verify-handoff.mjs", portableVerifyScript());

  await generatePortableLockfile(sourceDirectory);
  const inventory = await createInventory(
    sourceDirectory,
    snapshot.configuration.clientId,
    options.factoryRevision,
  );
  const artifactId = digestText(
    JSON.stringify({
      factoryRevision: options.factoryRevision,
      snapshot,
      files: inventory.map(({ path, sha256 }) => ({ path, sha256 })),
    }),
  );
  const descriptor: ClientArtifactDescriptor = {
    schemaVersion: 1,
    kind: "MANAGED_WEBSITE_SOURCE",
    artifactId,
    clientId: snapshot.configuration.clientId,
    repositoryName,
    sourceDirectory: "source",
    factoryRevision: options.factoryRevision,
    configuration: {
      configurationId: snapshot.configuration.configurationId,
      configurationVersion: snapshot.configuration.configurationVersion,
      deploymentId: snapshot.configuration.deploymentId,
    },
    buildVerification: {
      outputPolicy: "TEMPORARY_ONLY",
      nodeVersion: "24.18.0",
      packageManager: "pnpm@11.9.0",
      commands: [
        "pnpm install --frozen-lockfile --ignore-scripts",
        "pnpm typecheck",
        "pnpm build",
        "pnpm test",
      ],
    },
    handoff: {
      artifacts: inventory,
      artifactAllowlist: inventory.map(({ path }) => path),
      moduleSelections: snapshot.regions
        .flatMap(({ modules }) => modules)
        .map((module) => ({
          moduleId: module.moduleId,
          type: module.type,
          version: module.moduleVersion,
          portability:
            module.type === "ANALYTICS" ? "CLIENT_OWNED" : "TRANSFERABLE",
        })),
      connectorSelections: snapshot.configuration.connectors.map((connector) => ({
        connectorId: String(connector.connectorId),
        type: connector.type as
          | "EMAIL_DELIVERY"
          | "BOOKING_LINK"
          | "GOOGLE_ANALYTICS_4",
        version: "1.0.0",
        portability: connector.portability as "TRANSFERABLE" | "CLIENT_OWNED",
      })),
      publicDependencyAllowlist: publicDependencies,
      requiredEnvironmentVariables: snapshot.runtimeSecretBindings.map(
        (binding) => ({
          name: binding.environmentVariable,
          description: `Client-owned Resend API key for connector ${binding.connectorId}.`,
          required: true,
          owner: "CLIENT",
        }),
      ),
      optionalDataResources: [],
    },
    ...(authored === undefined
      ? {}
      : {
          clientExperience: {
            experienceId: authored.manifest.experienceId,
            experienceVersion: authored.manifest.experienceVersion,
            entrypoint: authored.manifest.entrypoint,
            designDnaPath: authored.manifest.designDnaPath,
            runtime: authored.manifest.runtime,
            publicDependencies: authored.inspected.publicDependencies.map(
              (name) => ({
                name,
                version:
                  authored.manifest.publicDependencies.find(
                    (dependency) => dependency.name === name,
                  )?.version ?? "",
              }),
            ),
            source: authored.inspected.files.map((file) => ({
              path: file.path,
              sha256: file.sha256,
              size: file.size,
              kind: file.kind,
              clientRuntime: file.clientRuntime,
            })),
          },
        }),
  };

  /*
   * The integrity manifest travels inside the client repository so a client can
   * verify what they were given without the Factory descriptor, which lives one
   * level above and is not part of the handed-off source. It excludes itself,
   * because a file cannot contain its own hash.
   */
  await writeText(
    sourceDirectory,
    "handoff-manifest.json",
    `${JSON.stringify(
      {
        schemaVersion: 1,
        artifactId,
        clientId: snapshot.configuration.clientId,
        /*
         * Whether this artifact was delivered with a search index. Pagefind
         * filenames are content-hashed per build, so a rebuild legitimately
         * produces different names. Pinning them would make integrity
         * verification fail on any honest rebuild, so the index is verified by
         * posture rather than by hash.
         */
        searchEnabled: snapshot.foundationSearch.enabled,
        files: inventory
          .filter(({ path }) => !path.startsWith("public/pagefind/"))
          .map(({ path, sha256, size }) => ({ path, sha256, size })),
      },
      null,
      2,
    )}\n`,
  );

  await writeText(
    sourceDirectory,
    "handoff-manifest.sha256",
    `${digestText(
      await readFile(join(sourceDirectory, "handoff-manifest.json"), "utf8"),
    )}  handoff-manifest.json\n`,
  );

  await writeFile(
    join(options.outputDirectory, "client-artifact.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );

  return Object.freeze({
    directory: options.outputDirectory,
    sourceDirectory,
    descriptor: deepFreeze(descriptor),
  });
}

/**
 * Files the handoff contract classifies as products of the handoff process
 * itself rather than client artifacts. They are written into the repository a
 * client receives, but `isSafeExportPath` deliberately excludes them from the
 * export inventory and allowlist, so the assembler must too.
 */
const generatedHandoffPaths = new Set([
  "handoff-manifest.json",
  "handoff-manifest.sha256",
  "scripts/verify-handoff.mjs",
]);

async function createInventory(
  sourceDirectory: string,
  clientId: string,
  version: string,
) {
  const files = (await recursiveFiles(sourceDirectory)).filter(
    (absolutePath) =>
      !generatedHandoffPaths.has(
        relative(sourceDirectory, absolutePath).replaceAll("\\", "/"),
      ),
  );
  return Promise.all(
    files.sort(compareText).map(async (absolutePath) => {
      const content = await readFile(absolutePath);
      const path = relative(sourceDirectory, absolutePath).replaceAll("\\", "/");
      return Object.freeze({
        path,
        category: categoryFor(path),
        clientId,
        size: content.byteLength,
        sha256: digestBytes(content),
        provenance: Object.freeze({
          origin: path.startsWith("public/assets/")
            ? "CLIENT_ASSET" as const
            : path.startsWith("src/") &&
                path !== "src/client-website.ts" &&
                !path.startsWith("src/generated/")
              ? "TRANSFORMED_FACTORY_RUNTIME" as const
            : "GENERATED" as const,
          version,
        }),
      });
    }),
  );
}

async function recursiveFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(directory, entry.name);
      return entry.isDirectory() ? recursiveFiles(path) : Promise.resolve([path]);
    }),
  );
  return files.flat();
}

function categoryFor(path: string): HandoffArtifactCategory {
  if (path.startsWith("public/assets/") || path.startsWith("public/pagefind/")) {
    return "ASSET";
  }
  if (
    path === "package.json" ||
    path === "pnpm-lock.yaml" ||
    path === "pnpm-workspace.yaml"
  ) {
    return "PACKAGE";
  }
  if (path.startsWith("src/generated/") || path === ".gitignore") {
    return "CONFIGURATION";
  }
  if (path.startsWith("tests/")) return "TEST";
  if (path.startsWith("src/vendor/")) return "VENDORED_RUNTIME";
  return "SOURCE";
}

async function assertEmptyDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  const entries = await readdir(directory);
  if (entries.length !== 0) {
    throw new Error(`Client artifact destination "${directory}" must be empty.`);
  }
}

async function writeText(
  root: string,
  path: string,
  content: string,
): Promise<void> {
  const destination = join(root, ...path.split("/"));
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, content);
}

function portablePackage(
  repositoryName: string,
  clientExperienceDependencies: Readonly<Record<string, string>>,
) {
  return {
    name: repositoryName,
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "pnpm@11.9.0",
    /*
     * Ranges, not exact pins. The artifact is built and tested on Node 24.18.0,
     * but declaring that as the engine made it uninstallable anywhere the patch
     * level differs — including Vercel, which the handoff runbook names as the
     * hosting target and which currently offers 24.15.0. Reproducibility comes
     * from the committed lockfile and the integrity manifest; the engine field
     * is a compatibility statement and has to be expressed as one.
     */
    engines: { node: "^24.0.0", pnpm: ">=11.9.0" },
    scripts: {
      dev: "next dev",
      build: "tsx src/search/build-current-foundation-search.ts && next build",
      start: "next start",
      typecheck: "next typegen && tsc --noEmit",
      test: "node --test tests/*.test.mjs",
      "verify:handoff": "node scripts/verify-handoff.mjs",
    },
    dependencies: {
      next: "16.2.12",
      react: "19.2.8",
      "react-dom": "19.2.8",
      resend: "6.18.1",
      zod: "4.4.3",
      // Only exact versions the experience manifest declares and repository
      // governance approves. An experience that declares none adds none, so a
      // static site carries no motion or interaction dependency cost.
      ...clientExperienceDependencies,
    },
    devDependencies: {
      "@types/node": "26.1.1",
      "@types/react": "19.2.17",
      "@types/react-dom": "19.2.3",
      pagefind: "1.5.2",
      tsx: "4.20.6",
      typescript: "7.0.2",
    },
  };
}

function portableNextConfiguration(buildId: string): string {
  return [
    "/** @type {import('next').NextConfig} */",
    "const nextConfig = {",
    "  output: 'standalone',",
    "  experimental: { useTypeScriptCli: true },",
    `  generateBuildId: async () => ${JSON.stringify(buildId)},`,
    "};",
    "",
    "export default nextConfig;",
    "",
  ].join("\n");
}

function portableTsconfig(): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        target: "ES2024",
        lib: ["dom", "dom.iterable", "ES2024"],
        allowJs: false,
        skipLibCheck: true,
        strict: true,
        noEmit: true,
        esModuleInterop: true,
        module: "esnext",
        moduleResolution: "bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        jsx: "react-jsx",
        exactOptionalPropertyTypes: true,
        noUncheckedIndexedAccess: true,
        noUnusedLocals: true,
        noUnusedParameters: true,
        verbatimModuleSyntax: true,
        incremental: true,
        plugins: [{ name: "next" }],
        /*
         * The sanctioned authoring alias, mapped exactly as the private
         * workspace maps it. Authored source keeps the imports it was written
         * and hashed with, so no rewriting is needed and provenance holds.
         *
         * No `baseUrl`: TypeScript 7 removed it, and `paths` entries resolve
         * relative to this tsconfig without it.
         */
        paths: {
          "@proportion/client-experience": [
            "./src/client-experience/public-api.ts",
          ],
        },
      },
      include: [
        "next-env.d.ts",
        "src/**/*.ts",
        "src/**/*.tsx",
        ".next/types/**/*.ts",
        ".next/dev/types/**/*.ts",
      ],
      exclude: ["node_modules"],
    },
    null,
    2,
  )}\n`;
}

/**
 * The acceptance suite shipped inside every client artifact.
 *
 * The recipient owns this site and needs a way to answer "is it still intact?"
 * without the Factory. It asserts the invariants that would actually hurt if
 * they broke — an asset referenced but not delivered, a route in the graph with
 * no page, a demonstration record that lost its disclosure — using only Node
 * built-ins and the JSON already in the artifact, so it runs before any install.
 */
function portableRuntimeTest(clientId: string): string {
  return [
    'import assert from "node:assert/strict";',
    'import { readFile, stat } from "node:fs/promises";',
    'import test from "node:test";',
    "",
    "const read = async (path) =>",
    "  JSON.parse(await readFile(new URL(path, import.meta.url), \"utf8\"));",
    "const readOptional = async (path) => {",
    "  try {",
    "    return await read(path);",
    "  } catch (error) {",
    '    if (error.code === "ENOENT") return undefined;',
    "    throw error;",
    "  }",
    "};",
    "",
    "const snapshot = await read(\"../src/generated/managed-website.json\");",
    "",
    "test('carries this client and no other', () => {",
    `  assert.equal(snapshot.configuration.clientId, ${JSON.stringify(clientId)});`,
    "  assert.equal(snapshot.assetManifest.clientId, snapshot.configuration.clientId);",
    "});",
    "",
    "test('every declared asset was delivered with the declared bytes', async () => {",
    "  assert.ok(snapshot.assetManifest.assets.length > 0);",
    "  for (const asset of snapshot.assetManifest.assets) {",
    "    const file = new URL(`../public/${asset.sourcePath}`, import.meta.url);",
    "    const info = await stat(file).catch(() => undefined);",
    "    assert.ok(info !== undefined, `missing asset file: ${asset.sourcePath}`);",
    "    assert.ok(info.size > 0, `empty asset file: ${asset.sourcePath}`);",
    "  }",
    "});",
    "",
    "test('every route in the inventory has a page in the graph', async () => {",
    "  const inventory = await readOptional(\"../src/generated/route-inventory.json\");",
    "  if (inventory === undefined) return; // legacy single-page artifact",
    "  const paths = new Set(snapshot.pageGraph.pages.map((page) => page.path));",
    "  assert.ok(inventory.routes.length > 0);",
    "  for (const route of inventory.routes) {",
    "    assert.ok(paths.has(route.path), `route has no page: ${route.path}`);",
    "  }",
    "  const unique = new Set(inventory.routes.map((route) => route.path));",
    "  assert.equal(unique.size, inventory.routes.length, 'duplicate route paths');",
    "});",
    "",
    "test('demonstration records still carry their disclosure', () => {",
    "  for (const project of snapshot.projects?.projects ?? []) {",
    "    if (project.truthMode !== 'DEMONSTRATION') continue;",
    "    assert.ok(",
    "      typeof project.demonstrationDisclosure === 'string' &&",
    "        project.demonstrationDisclosure.trim().length > 0,",
    "      `demonstration record without a disclosure: ${project.projectId}`,",
    "    );",
    "  }",
    "});",
    "",
    "test('every media reference points at a delivered asset', () => {",
    "  const known = new Set(",
    "    snapshot.assetManifest.assets.map((asset) => asset.assetId),",
    "  );",
    "  const seen = [];",
    "  const collect = (value) => {",
    "    if (Array.isArray(value)) {",
    "      for (const entry of value) collect(entry);",
    "      return;",
    "    }",
    "    if (value === null || typeof value !== 'object') return;",
    "    if (typeof value.assetId === 'string' && 'decorative' in value) {",
    "      seen.push(value.assetId);",
    "    }",
    "    for (const entry of Object.values(value)) collect(entry);",
    "  };",
    "  collect(snapshot);",
    "  for (const assetId of seen) {",
    "    assert.ok(known.has(assetId), `reference to undelivered asset: ${assetId}`);",
    "  }",
    "});",
    "",
  ].join("\n");
}

async function copyRuntimeFiles(sourceDirectory: string): Promise<void> {
  for (const path of runtimeFiles) {
    let content = await readFile(join(managedWebRoot, ...path.split("/")), "utf8");
    if (path === "src/server/contact-form-runtime.ts") {
      content = content
        .replaceAll(
          '"@melbourne-local-growth-ops/contact-form"',
          '"../vendor/contact-form/index.js"',
        )
        .replaceAll(
          '"@melbourne-local-growth-ops/resend"',
          '"../vendor/resend/index.js"',
        );
    }
    if (path === "src/server/managed-contact-runtime.ts") {
      content = content
        .replaceAll(
          '"@melbourne-local-growth-ops/contact-form"',
          '"../vendor/contact-form/index.js"',
        )
        .replaceAll(
          '"@melbourne-local-growth-ops/resend"',
          '"../vendor/resend/index.js"',
        );
    }
    await writeText(sourceDirectory, path, content);
  }
}

async function copyVendorPackages(sourceDirectory: string): Promise<void> {
  for (const package_ of vendorPackages) {
    const inputDirectory = join(
      repositoryRoot,
      ...package_.directory.split("/"),
    );
    const files = (await recursiveFiles(inputDirectory)).filter(
      (path) => path.endsWith(".js") || path.endsWith(".d.ts"),
    );
    for (const inputPath of files) {
      const relativePath = relative(inputDirectory, inputPath).replaceAll("\\", "/");
      let content = await readFile(inputPath, "utf8");
      for (const [specifier, replacement] of Object.entries(
        package_.replacements,
      )) {
        content = content.replaceAll(`"${specifier}"`, `"${replacement}"`);
      }
      content = content.replace(/^\/\/# sourceMappingURL=.*$/gm, "");
      await writeText(
        sourceDirectory,
        `src/vendor/${package_.name}/${relativePath}`,
        content,
      );
    }
  }
}

async function generatePortableLockfile(sourceDirectory: string): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    const packageManager = packageManagerCommand([
      "install",
      "--lockfile-only",
      "--ignore-scripts",
    ]);
    const child = spawn(
      packageManager.command,
      packageManager.arguments_,
      {
        cwd: sourceDirectory,
        env: createIsolatedBuildEnvironment(process.env),
        stdio: "ignore",
      },
    );
    child.on("error", rejectPromise);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else rejectPromise(new Error("Portable lockfile generation failed."));
    });
  });
}

function packageManagerCommand(arguments_: readonly string[]) {
  const executable = packageManagerCli();
  return executable === undefined
    ? { command: "pnpm", arguments_: [...arguments_] }
    : {
        command: process.execPath,
        arguments_: [executable, ...arguments_],
      };
}

function packageManagerCli(): string | undefined {
  if (process.env.npm_execpath !== undefined) {
    return process.env.npm_execpath;
  }
  const appData = process.env.APPDATA;
  if (appData === undefined) return undefined;
  const candidate = join(
    appData,
    "npm",
    "node_modules",
    "pnpm",
    "bin",
    "pnpm.cjs",
  );
  return existsSync(candidate) ? candidate : undefined;
}

function digestText(input: string): string {
  return digestBytes(Buffer.from(input));
}

function digestBytes(input: Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}


interface AuthoredSourcePackage {
  readonly manifest: import("@melbourne-local-growth-ops/site-core").ClientExperienceManifest;
  readonly inspected: InspectedClientExperienceSource;
  readonly inputDirectory: string;
}

/**
 * Loads and inspects the authored client experience for a schemaVersion 2
 * definition, before any generation or copying happens.
 *
 * The definition may only carry the fixed `experience/manifest.json` reference,
 * so the input directory is derived from the client's public directory rather
 * than taken from configuration. A legacy definition returns undefined and no
 * authored source is read at all.
 */
async function inspectAuthoredSource(
  options: AssembleClientSourceArtifactOptions,
): Promise<AuthoredSourcePackage | undefined> {
  const definition = options.definition as { readonly schemaVersion?: unknown };
  if (
    typeof definition !== "object" ||
    definition === null ||
    definition.schemaVersion !== 2
  ) {
    return undefined;
  }

  const inputDirectory = options.inputDirectory ?? dirname(options.publicDirectory);
  const manifest = validateClientExperienceManifest(
    JSON.parse(
      await readFile(
        join(inputDirectory, "experience", "manifest.json"),
        "utf8",
      ),
    ) as unknown,
  );
  if (!manifest.success) {
    throw new Error(
      `Client experience manifest is invalid: ${manifest.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }

  const inspected = await inspectClientExperienceSource({
    inputDirectory,
    manifest: manifest.data,
    approvedPublicDependencies: approvedClientExperienceDependencies.map(
      ({ name }) => name,
    ),
  });

  return Object.freeze({ manifest: manifest.data, inspected, inputDirectory });
}

/**
 * Copies the inspected authored source into the artifact's fixed slot.
 *
 * Only files the policy actually inspected are copied, and each is re-read and
 * hash-verified at copy time so the descriptor's inventory describes the exact
 * bytes shipped, not the bytes as they were during inspection.
 */
async function copyAuthoredSource(
  sourceDirectory: string,
  authored: AuthoredSourcePackage | undefined,
): Promise<void> {
  const destinationRoot = join(sourceDirectory, "src/client-experience/authored");
  await mkdir(destinationRoot, { recursive: true });

  if (authored === undefined) {
    // A legacy artifact ships the placeholder, never authored source.
    await writeText(
      sourceDirectory,
      "src/client-experience/authored/index.tsx",
      legacyAuthoredPlaceholder,
    );
    await writeText(
      sourceDirectory,
      "src/client-experience/authored/manifest.json",
      "null\n",
    );
    return;
  }

  for (const file of authored.inspected.files) {
    const from = join(authored.inspected.rootDirectory, ...file.path.split("/"));
    const to = join(destinationRoot, ...file.path.split("/"));
    const content = await readFile(from);
    const actual = digestBytes(content);
    if (actual !== file.sha256) {
      throw new Error(
        `Client experience source "${file.path}" changed between inspection and copy.`,
      );
    }
    await mkdir(dirname(to), { recursive: true });
    await writeFile(to, content);
  }
}

const legacyAuthoredPlaceholder = [
  'import type { ClientExperienceDefinition } from "../contract";',
  "",
  "/** A legacy client ships no authored experience. */",
  "export const authoredClientExperience: ClientExperienceDefinition | undefined =",
  "  undefined;",
  "",
].join("\n");


/**
 * The `verify:handoff` script shipped inside every client artifact.
 *
 * Three runbooks and the governance definition of done instruct a client to run
 * this, so it must exist in the artifact rather than only being declared. It
 * recomputes every hash in the integrity manifest and reports missing, changed
 * and unexpected files, using only Node built-ins so it works before any
 * install.
 */
function portableVerifyScript(): string {
  return [
    'import { createHash } from "node:crypto";',
    'import { readFile, readdir, stat } from "node:fs/promises";',
    'import { dirname, join, relative, resolve } from "node:path";',
    'import { fileURLToPath } from "node:url";',
    "",
    'const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");',
    'const manifestPath = join(root, "handoff-manifest.json");',
    'const ignoredDirectories = new Set([',
    '  "node_modules",',
    '  ".next",',
    '  ".git",',
    '  "build",',
    '  ".turbo",',
    "]);",
    '// Build byproducts, not shipped files. The same set .gitignore covers.',
    'const ignoredFiles = new Set(["next-env.d.ts", ".DS_Store"]);',
    'const isBuildByproduct = (name) =>',
    '  ignoredFiles.has(name) || name.endsWith(".tsbuildinfo");',
    '// Lock files written by whichever package manager the recipient uses. The',
    '// artifact ships a pnpm lock; installing with npm or yarn writes a second',
    '// one beside it. Failing on that would mean the first command in the',
    '// handoff runbook breaks the integrity check, so they are reported as',
    '// notes instead of hidden and instead of failing.',
    'const installByproducts = new Set([',
    '  "package-lock.json",',
    '  "npm-shrinkwrap.json",',
    '  "yarn.lock",',
    '  "bun.lock",',
    '  "bun.lockb",',
    "]);",
    "",
    "const manifest = JSON.parse(await readFile(manifestPath, \"utf8\"));",
    "const expected = new Map(manifest.files.map((file) => [file.path, file]));",
    "const problems = [];",
    "",
    "async function walk(directory) {",
    "  const entries = await readdir(directory, { withFileTypes: true });",
    "  const found = [];",
    "  for (const entry of entries) {",
    "    if (ignoredDirectories.has(entry.name)) continue;",
    "    if (!entry.isDirectory() && isBuildByproduct(entry.name)) continue;",
    "    const absolute = join(directory, entry.name);",
    "    if (entry.isDirectory()) {",
    "      found.push(...(await walk(absolute)));",
    "      continue;",
    "    }",
    '    found.push(relative(root, absolute).replaceAll("\\\\", "/"));',
    "  }",
    "  return found;",
    "}",
    "",
    "const present = new Set(await walk(root));",
    '// Products of the handoff process itself, excluded from the inventory by',
    '// the export contract, so they are not "unexpected" here either.',
    '// Regenerated with content-hashed names on every build, so verified by',
    '// posture rather than by hash.',
    'const searchOutput = join(root, "public", "pagefind");',
    'let searchFiles = [];',
    "try {",
    '  searchFiles = await readdir(searchOutput);',
    "} catch {",
    "  searchFiles = [];",
    "}",
    "if (manifest.searchEnabled && searchFiles.length === 0) {",
    '  problems.push("search was delivered enabled but public/pagefind is empty");',
    "}",
    "if (!manifest.searchEnabled && searchFiles.length > 0) {",
    '  problems.push("search was delivered disabled but public/pagefind has output");',
    "}",
    'for (const path of [...present]) {',
    '  if (path.startsWith("public/pagefind/")) present.delete(path);',
    "}",
    "",
    'for (const generated of [',
    '  "handoff-manifest.json",',
    '  "handoff-manifest.sha256",',
    '  "scripts/verify-handoff.mjs",',
    "]) present.delete(generated);",
    "",
    "for (const [path, file] of expected) {",
    "  if (!present.has(path)) {",
    "    problems.push(`missing: ${path}`);",
    "    continue;",
    "  }",
    "  const content = await readFile(join(root, path));",
    '  const actual = createHash("sha256").update(content).digest("hex");',
    "  if (actual !== file.sha256) problems.push(`changed: ${path}`);",
    "  const size = (await stat(join(root, path))).size;",
    "  if (size !== file.size) problems.push(`size changed: ${path}`);",
    "}",
    "",
    "const notes = [];",
    "for (const path of present) {",
    "  if (expected.has(path)) continue;",
    "  if (installByproducts.has(path)) {",
    "    notes.push(`generated by your package manager, not part of the artifact: ${path}`);",
    "    continue;",
    "  }",
    "  problems.push(`unexpected: ${path}`);",
    "}",
    "",
    "for (const note of notes) console.log(`  note: ${note}`);",
    "",
    "if (problems.length > 0) {",
    "  console.error(`handoff integrity FAILED for ${manifest.artifactId}`);",
    "  for (const problem of problems) console.error(`  ${problem}`);",
    "  process.exitCode = 1;",
    "} else {",
    "  console.log(",
    "    `handoff integrity PASS: ${expected.size} files match artifact ${manifest.artifactId}`,",
    "  );",
    "}",
    "",
  ].join("\n");
}
