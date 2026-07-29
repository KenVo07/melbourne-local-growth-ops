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

import { generateClientWebsiteSnapshot } from "./generate-client-website";
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
  "src/app/page.tsx",
  "src/managed-website.ts",
  "src/rendering/analytics-renderer.tsx",
  "src/rendering/booking-cta-renderer.tsx",
  "src/rendering/index.ts",
  "src/rendering/LeadForm.tsx",
  "src/rendering/lead-form-renderer.tsx",
  "src/rendering/ManagedWebsiteShell.tsx",
  "src/rendering/module-renderer-registry.ts",
  "src/rendering/TrackedBookingLink.tsx",
  "src/runtime-types.ts",
  "src/server/contact-form-runtime.ts",
  "src/server/managed-contact-runtime.ts",
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
  const snapshot = generateClientWebsiteSnapshot(
    options.definition,
    options.publicDirectory,
  );
  const sourceDirectory = join(options.outputDirectory, "source");
  const repositoryName = `${snapshot.configuration.clientId}-managed-website`;
  await mkdir(sourceDirectory, { recursive: true });

  await writeText(
    sourceDirectory,
    "package.json",
    `${JSON.stringify(portablePackage(repositoryName), null, 2)}\n`,
  );
  await writeText(
    sourceDirectory,
    ".gitignore",
    "node_modules/\n.next/\nbuild/\n.env\n.env.*\n!.env.example\n",
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
      'import snapshot from "./generated/managed-website.json";',
      'import type { ManagedWebsiteRuntime } from "./runtime-types";',
      "",
      "export const clientWebsite = snapshot as unknown as ManagedWebsiteRuntime;",
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

  for (const asset of snapshot.assetManifest.assets) {
    const destination = join(sourceDirectory, "public", ...asset.sourcePath.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(
      join(options.publicDirectory, ...asset.sourcePath.split("/")),
      destination,
    );
  }

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
  };

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

async function createInventory(
  sourceDirectory: string,
  clientId: string,
  version: string,
) {
  const files = await recursiveFiles(sourceDirectory);
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
  if (path.startsWith("public/assets/")) return "ASSET";
  if (path === "package.json" || path === "pnpm-lock.yaml") return "PACKAGE";
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

function portablePackage(repositoryName: string) {
  return {
    name: repositoryName,
    version: "1.0.0",
    private: true,
    type: "module",
    packageManager: "pnpm@11.9.0",
    engines: { node: "24.18.0", pnpm: "11.9.0" },
    scripts: {
      dev: "next dev",
      build: "next build",
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
    },
    devDependencies: {
      "@types/node": "26.1.1",
      "@types/react": "19.2.17",
      "@types/react-dom": "19.2.3",
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

function portableRuntimeTest(clientId: string): string {
  return [
    'import assert from "node:assert/strict";',
    'import { readFile } from "node:fs/promises";',
    'import test from "node:test";',
    "",
    "test('contains only the assembled client identity', async () => {",
    "  const snapshot = JSON.parse(",
    "    await readFile(new URL('../src/generated/managed-website.json', import.meta.url), 'utf8'),",
    "  );",
    `  assert.equal(snapshot.configuration.clientId, ${JSON.stringify(clientId)});`,
    "  assert.equal(snapshot.assetManifest.clientId, snapshot.configuration.clientId);",
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
        env: process.env,
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
