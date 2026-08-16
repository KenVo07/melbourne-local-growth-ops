import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildFoundationSearchIndex } from "../../../apps/managed-web/src/search/build-foundation-search";
import type { RuntimeFoundationSearch } from "../../../apps/managed-web/src/runtime-types";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("Foundation Search build output", () => {
  it("removes stale output and returns before starting Pagefind when disabled", async () => {
    const outputDirectory = await temporaryOutput();
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "stale.js"), "stale");

    const result = await buildFoundationSearchIndex(disabledSearch, outputDirectory);

    expect(result).toEqual({ enabled: false, recordCount: 0, outputDirectory });
    await expect(readdir(outputDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("writes an isolated index for the deterministic validated record set", async () => {
    const firstOutput = await temporaryOutput();
    const secondOutput = await temporaryOutput();

    const first = await buildFoundationSearchIndex(enabledSearch, firstOutput);
    const second = await buildFoundationSearchIndex(enabledSearch, secondOutput);

    expect(first).toEqual({ enabled: true, recordCount: 2, outputDirectory: firstOutput });
    expect(second).toEqual({ enabled: true, recordCount: 2, outputDirectory: secondOutput });
    expect(await normalizedInventory(firstOutput)).toEqual(
      await normalizedInventory(secondOutput),
    );
    expect(await normalizedInventory(firstOutput)).toContain("pagefind.js");

    const joinedOutput = (
      await Promise.all(
        (await recursiveFiles(firstOutput)).map((path) => readFile(path)),
      )
    ).map((content) => content.toString("latin1")).join("\n");
    expect(joinedOutput).not.toContain("connector-secret");
    expect(joinedOutput).not.toContain("https://private.example.test/action");
  });
});

const disabledSearch: RuntimeFoundationSearch = {
  schemaVersion: 1,
  mode: "OFF",
  enabled: false,
  reason: "EXPLICIT_OFF",
  records: [],
};

const enabledSearch: RuntimeFoundationSearch = {
  schemaVersion: 1,
  mode: "ON",
  enabled: true,
  reason: "EXPLICIT_ON",
  records: [
    {
      url: "/#services",
      content: "Harbour Electrical residential electrical service",
      language: "en",
      meta: {
        title: "Electrical services",
        businessName: "Harbour Electrical",
        sectionId: "services",
        profile: "CONTRACTOR",
      },
      filters: { profile: ["CONTRACTOR"], sectionType: ["SERVICES"] },
    },
    {
      url: "/#faq",
      content: "Harbour Electrical common service questions",
      language: "en",
      meta: {
        title: "Common questions",
        businessName: "Harbour Electrical",
        sectionId: "faq",
        profile: "CONTRACTOR",
      },
      filters: { profile: ["CONTRACTOR"], sectionType: ["FAQ"] },
    },
  ],
};

async function temporaryOutput(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "web01b-pagefind-test-"));
  temporaryDirectories.push(root);
  return join(root, "pagefind");
}

async function normalizedInventory(root: string) {
  const files = await recursiveFiles(root);
  return files.map((path) =>
    relative(root, path)
      .replaceAll("\\", "/")
      .replace(/_[0-9a-f]+(?=\.)/g, "_<content-hash>"),
  ).sort();
}

async function recursiveFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? recursiveFiles(path) : [path];
  }))).flat();
}
