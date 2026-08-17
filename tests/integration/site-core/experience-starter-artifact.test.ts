import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  generateExperienceStarter,
  loudBrief,
  quietBrief,
  testDefinition,
} from "./starter-support";
import { inspectClientExperienceSource } from "../../../apps/managed-web/src/generation/client-experience-source-policy";
import { approvedClientExperienceDependencies } from "../../../apps/managed-web/src/generation/approved-client-dependencies";
import { validateClientExperienceManifest } from "@melbourne-local-growth-ops/site-core";

/**
 * The two properties the whole source-generation design rests on:
 *
 *   1. what the starter emits survives the Platform's own source policy —
 *      unmodified, on the first pass, with no exemption;
 *   2. nothing the starter emits, and nothing the starter *is*, reaches a
 *      standalone client artifact.
 *
 * If either fails, the starter has become a shared runtime template.
 */

let root: string;

async function writeGenerated(brief: unknown, directory: string) {
  const generated = generateExperienceStarter({
    definition: testDefinition,
    brief,
  });
  for (const file of generated.files) {
    const destination = join(directory, "experience", ...file.path.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, file.contents);
  }
  return generated;
}

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "starter-policy-"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("generated experience source passes the Platform source policy", () => {
  for (const [name, brief] of [
    ["quiet brief", quietBrief],
    ["loud brief", loudBrief],
  ] as const) {
    it(`accepts the ${name} unmodified`, async () => {
      const directory = join(root, name.replaceAll(" ", "-"));
      await mkdir(directory, { recursive: true });
      const generated = await writeGenerated(brief, directory);

      const manifest = validateClientExperienceManifest(
        JSON.parse(
          generated.files.find((file) => file.path === "manifest.json")
            ?.contents ?? "null",
        ) as unknown,
      );
      expect(manifest.success).toBe(true);
      if (!manifest.success) return;

      const inspected = await inspectClientExperienceSource({
        inputDirectory: directory,
        manifest: manifest.data,
        approvedPublicDependencies: approvedClientExperienceDependencies.map(
          ({ name: dependency }) => dependency,
        ),
      });

      expect(inspected.files.length).toBe(generated.files.length);
      expect(inspected.publicDependencies).toEqual([]);
      // Only the motion helper may declare itself a client component, and only
      // when the brief asked for entrance motion.
      const clientRuntimeFiles = inspected.files
        .filter((file) => file.clientRuntime)
        .map((file) => file.path);
      expect(clientRuntimeFiles).toEqual(
        brief.motion === "ENTRANCE" ? ["components/Reveal.tsx"] : [],
      );
    });
  }
});

describe("the starter cannot reach a client artifact", () => {
  const assembler = fileURLToPath(
    new URL(
      "../../../apps/managed-web/src/generation/assemble-client-artifact.ts",
      import.meta.url,
    ),
  );

  it("is absent from the artifact's runtime file list and vendored packages", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(assembler, "utf8");
    // The assembler copies exactly two things it does not generate: a fixed
    // runtime file list, and a fixed vendor package list. The starter is in
    // neither, so a generated client physically cannot carry it.
    expect(source).not.toContain("experience-starter");
  });

  it("is not a dependency of the app that assembles artifacts", async () => {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(
      await readFile(
        fileURLToPath(
          new URL("../../../apps/managed-web/package.json", import.meta.url),
        ),
        "utf8",
      ),
    ) as { dependencies?: Record<string, string> };
    expect(Object.keys(manifest.dependencies ?? {})).not.toContain(
      "@melbourne-local-growth-ops/experience-starter",
    );
  });
});
