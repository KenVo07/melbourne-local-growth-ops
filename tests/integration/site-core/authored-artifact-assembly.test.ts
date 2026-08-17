import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { afterEach, describe, expect, it } from "vitest";

const run = promisify(execFile);

import { assembleClientSourceArtifact } from "../../../apps/managed-web/src/generation";

const fixtureRoot = fileURLToPath(
  new URL("../../fixtures/web01b/neutral-v2", import.meta.url),
);
const applicationPublic = fileURLToPath(
  new URL("../../../apps/managed-web/public", import.meta.url),
);
const legacyDefinition = fileURLToPath(
  new URL(
    "../../fixtures/web01b/contractor/reference-client-website.json",
    import.meta.url,
  ),
);
const legacyPublic = fileURLToPath(
  new URL(
    "../../../apps/managed-web/client/examples/contractor/public",
    import.meta.url,
  ),
);

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

async function temporary(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** Builds a client input package, optionally injecting one attacking file. */
async function authoredInput(
  attack?: { readonly path: string; readonly source: string },
): Promise<string> {
  const input = await temporary("web01b-authored-input-");
  await mkdir(join(input, "public"), { recursive: true });
  await cp(applicationPublic, join(input, "public"), { recursive: true });
  await cp(
    join(fixtureRoot, "client-website.json"),
    join(input, "client-website.json"),
  );
  await cp(join(fixtureRoot, "experience"), join(input, "experience"), {
    recursive: true,
  });
  if (attack !== undefined) {
    await writeFile(
      join(input, "experience", ...attack.path.split("/")),
      attack.source,
    );
  }
  return input;
}

async function assembleAuthored(input: string) {
  const output = join(await temporary("web01b-authored-out-"), "artifact");
  return assembleClientSourceArtifact({
    definition: JSON.parse(
      await readFile(join(input, "client-website.json"), "utf8"),
    ) as unknown,
    publicDirectory: join(input, "public"),
    inputDirectory: input,
    outputDirectory: output,
    factoryRevision: "test-revision",
  });
}

describe("authored client artifact assembly", () => {
  it("records the authored experience identity, runtime posture and source hashes", async () => {
    const artifact = await assembleAuthored(await authoredInput());
    const authored = artifact.descriptor.clientExperience;

    expect(authored).toBeDefined();
    expect(authored?.experienceId).toBe("neutral-functional");
    expect(authored?.experienceVersion).toBe("1.0.0");
    expect(authored?.entrypoint).toBe("index.tsx");
    expect(authored?.runtime).toEqual({
      clientJavaScript: "NONE",
      motion: "NONE",
      reducedMotion: "REQUIRED",
    });
    expect(authored?.source.map(({ path }) => path).sort()).toEqual([
      "design-dna.json",
      "index.tsx",
      "manifest.json",
      "routes/projects.tsx",
      "routes/shell.tsx",
      "routes/simple.tsx",
    ]);
    expect(
      authored?.source.every(({ sha256 }) => /^[0-9a-f]{64}$/.test(sha256)),
    ).toBe(true);
  });

  it("copies the inspected source into the artifact's fixed slot", async () => {
    const artifact = await assembleAuthored(await authoredInput());
    const slot = join(
      artifact.sourceDirectory,
      "src/client-experience/authored",
    );

    expect((await readdir(slot)).sort()).toEqual([
      "design-dna.json",
      "index.tsx",
      "manifest.json",
      "routes",
    ]);
    // Authored imports are preserved byte for byte, never rewritten, so the
    // recorded hashes still describe the shipped bytes.
    const entrypoint = await readFile(join(slot, "index.tsx"), "utf8");
    expect(entrypoint).toContain('from "@proportion/client-experience"');
  });

  it("maps the authoring alias in the portable tsconfig", async () => {
    const artifact = await assembleAuthored(await authoredInput());
    const tsconfig = JSON.parse(
      await readFile(join(artifact.sourceDirectory, "tsconfig.json"), "utf8"),
    ) as { compilerOptions: { paths?: Record<string, string[]> } };

    expect(tsconfig.compilerOptions.paths).toEqual({
      "@proportion/client-experience": [
        "./src/client-experience/public-api.ts",
      ],
    });
    // TypeScript 7 removed baseUrl; paths resolve relative to the tsconfig.
    expect(tsconfig.compilerOptions).not.toHaveProperty("baseUrl");
  });

  it("writes a deterministic route inventory", async () => {
    const artifact = await assembleAuthored(await authoredInput());
    const inventory = JSON.parse(
      await readFile(
        join(artifact.sourceDirectory, "src/generated/route-inventory.json"),
        "utf8",
      ),
    ) as {
      experienceId: string;
      homePageId: string;
      routes: { path: string }[];
    };

    expect(inventory.experienceId).toBe("neutral-functional");
    expect(inventory.homePageId).toBe("home");
    expect(inventory.routes.map(({ path }) => path)).toEqual([
      "/",
      "/about",
      "/contact",
      "/projects",
      "/projects/brighton-house",
      "/projects/kew-renovation",
      "/projects/northcote-residence",
      "/services",
      "/services/architectural-lighting",
    ]);
  });

  it("adds no dependency the experience does not declare", async () => {
    const artifact = await assembleAuthored(await authoredInput());
    const packageJson = JSON.parse(
      await readFile(join(artifact.sourceDirectory, "package.json"), "utf8"),
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };

    // The neutral experience declares no public dependency, so a static site
    // carries no motion or interaction library cost whatsoever.
    expect(artifact.descriptor.clientExperience?.publicDependencies).toEqual([]);
    expect(packageJson.dependencies).not.toHaveProperty("motion");
    expect(packageJson.dependencies).not.toHaveProperty("gsap");
    // The Factory's own build-time parser must never reach a client artifact.
    expect(packageJson.dependencies).not.toHaveProperty("@babel/parser");
    expect(packageJson.devDependencies).not.toHaveProperty("@babel/parser");
    for (const version of Object.values(packageJson.dependencies)) {
      expect(version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    }
  });

  it("ships a working integrity manifest and verify script", async () => {
    const artifact = await assembleAuthored(await authoredInput());
    const manifest = JSON.parse(
      await readFile(
        join(artifact.sourceDirectory, "handoff-manifest.json"),
        "utf8",
      ),
    ) as { artifactId: string; files: { path: string; sha256: string }[] };

    expect(manifest.artifactId).toBe(artifact.descriptor.artifactId);
    expect(manifest.files.length).toBeGreaterThan(0);
    // Three runbooks and the governance definition of done tell a client to run
    // this, so the script must exist rather than only be declared.
    const script = await readFile(
      join(artifact.sourceDirectory, "scripts/verify-handoff.mjs"),
      "utf8",
    );
    expect(script).toContain("handoff integrity");
    const digest = await readFile(
      join(artifact.sourceDirectory, "handoff-manifest.sha256"),
      "utf8",
    );
    expect(digest).toMatch(/^[0-9a-f]{64} {2}handoff-manifest\.json\n$/);
    // Products of the handoff process are covered by their own digest rather
    // than by the client-artifact inventory, which the export contract
    // deliberately excludes them from.
    for (const generated of [
      "handoff-manifest.json",
      "handoff-manifest.sha256",
      "scripts/verify-handoff.mjs",
    ]) {
      expect(manifest.files.some(({ path }) => path === generated)).toBe(false);
    }

    // The script has to actually pass on the artifact it was written for.
    // Asserting only that the file exists let a broken verifier ship.
    const clean = await run(process.execPath, ["scripts/verify-handoff.mjs"], {
      cwd: artifact.sourceDirectory,
    });
    expect(clean.stdout).toContain("handoff integrity PASS");

    // The first command in the handoff runbook is an install. A recipient using
    // npm or yarn gets a second lock file beside the pnpm one the artifact
    // ships, and that must not read as tampering — otherwise verification fails
    // for everyone who follows the runbook in order.
    await writeFile(
      join(artifact.sourceDirectory, "package-lock.json"),
      '{"lockfileVersion":3}\n',
    );
    const afterInstall = await run(
      process.execPath,
      ["scripts/verify-handoff.mjs"],
      { cwd: artifact.sourceDirectory },
    );
    expect(afterInstall.stdout).toContain("handoff integrity PASS");
    expect(afterInstall.stdout).toContain("package-lock.json");

    // Anything else genuinely unexpected still fails.
    await writeFile(
      join(artifact.sourceDirectory, "src/smuggled.ts"),
      "export const payload = 1;\n",
    );
    await expect(
      run(process.execPath, ["scripts/verify-handoff.mjs"], {
        cwd: artifact.sourceDirectory,
      }),
    ).rejects.toThrow(/unexpected: src\/smuggled\.ts/);
  });

  it("ships a legacy artifact with no authored source and no experience provenance", async () => {
    const input = await temporary("web01b-legacy-input-");
    await mkdir(join(input, "public"), { recursive: true });
    await cp(legacyPublic, join(input, "public"), { recursive: true });
    await cp(legacyDefinition, join(input, "client-website.json"));
    const output = join(await temporary("web01b-legacy-out-"), "artifact");

    const artifact = await assembleClientSourceArtifact({
      definition: JSON.parse(
        await readFile(join(input, "client-website.json"), "utf8"),
      ) as unknown,
      publicDirectory: join(input, "public"),
      inputDirectory: input,
      outputDirectory: output,
      factoryRevision: "test-revision",
    });

    expect(artifact.descriptor.clientExperience).toBeUndefined();
    const slot = join(
      artifact.sourceDirectory,
      "src/client-experience/authored",
    );
    expect((await readdir(slot)).sort()).toEqual([
      "index.tsx",
      "manifest.json",
    ]);
    expect(
      await readFile(join(slot, "manifest.json"), "utf8"),
    ).toBe("null\n");
  });

  it.each([
    ["escapes the source root", 'import s from "../../client-website.json";\nexport const X = () => String(s);\n', "PATH_ESCAPE"],
    ["imports a private workspace package", 'import x from "@melbourne-local-growth-ops/site-core";\nexport const X = () => String(x);\n', "IMPORT_FORBIDDEN"],
    ["reads the environment", "export const X = () => process.env.SECRET;\n", "ENVIRONMENT_ACCESS_FORBIDDEN"],
    ["declares a server action", 'export async function s(d: FormData) { "use server"; return d; }\n', "EXECUTION_PRIMITIVE_FORBIDDEN"],
    ["reaches the network", 'export const X = () => fetch("https://evil.example");\n', "NETWORK_ACCESS_FORBIDDEN"],
    ["traverses out of an approved package", 'import L from "motion/../next/link";\nexport const X = () => String(L);\n', "IMPORT_FORBIDDEN"],
  ])(
    "refuses source that %s, before writing any artifact file",
    async (_name, source, code) => {
      const input = await authoredInput({
        path: "routes/attack.tsx",
        source,
      });
      const output = join(await temporary("web01b-attack-out-"), "artifact");

      await expect(
        assembleClientSourceArtifact({
          definition: JSON.parse(
            await readFile(join(input, "client-website.json"), "utf8"),
          ) as unknown,
          publicDirectory: join(input, "public"),
          inputDirectory: input,
          outputDirectory: output,
          factoryRevision: "test-revision",
        }),
      ).rejects.toMatchObject({ code });

      // Nothing may be written before the source policy has cleared the
      // package. The output directory may exist, but it must be empty.
      const written = await readdir(output).catch(() => []);
      expect(written).toEqual([]);
    },
  );
});
