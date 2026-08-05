import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAssetManifest } from "@melbourne-local-growth-ops/asset-pipeline";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const exampleRoot = resolve(here, "..", "..", "..", "..", "apps", "managed-web");
const publicDirectory = join(exampleRoot, "public", "examples", "retailer");
const clientWebsiteJsonPath = join(
  exampleRoot,
  "client",
  "examples",
  "retailer",
  "client-website.json",
);

async function loadDefinition(): Promise<{
  readonly configuration: { readonly clientId: string };
  readonly profile: {
    readonly sections: readonly { readonly type: string; readonly items?: readonly { readonly assetId: string }[] }[];
  };
  readonly assets: readonly {
    readonly assetId: string;
    readonly sourcePath: string;
    readonly width: number;
    readonly height: number;
  }[];
}> {
  const raw = await readFile(clientWebsiteJsonPath, "utf8");
  return JSON.parse(raw);
}

async function readPngDimensions(
  path: string,
): Promise<{ readonly width: number; readonly height: number }> {
  const buffer = await readFile(path);
  const signature = buffer.subarray(0, 8);
  const expected = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (!signature.equals(expected)) {
    throw new Error(`"${path}" is not a valid PNG file.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

describe("retailer demo asset portability", () => {
  it("declares only images rooted at the portable assets/ path", async () => {
    const definition = await loadDefinition();

    expect(definition.assets.length).toBeGreaterThan(0);
    for (const asset of definition.assets) {
      expect(asset.sourcePath.startsWith("assets/")).toBe(true);
    }
  });

  it("generates a valid asset manifest from real, repository-owned files", async () => {
    const definition = await loadDefinition();

    const manifest = generateAssetManifest({
      clientId: definition.configuration.clientId,
      publicDirectory,
      assets: definition.assets,
    });

    expect(manifest.assets).toHaveLength(definition.assets.length);
    for (const asset of manifest.assets) {
      expect(asset.publicPath).toBe(`/${asset.sourcePath}`);
    }
  });

  it("matches declared width/height metadata to the actual generated PNG files", async () => {
    const definition = await loadDefinition();

    for (const asset of definition.assets) {
      const dimensions = await readPngDimensions(
        join(publicDirectory, ...asset.sourcePath.split("/")),
      );
      expect(dimensions).toEqual({ width: asset.width, height: asset.height });
    }
  });

  it("declares exactly the single template-selected hero asset, with no gallery duplication risk", async () => {
    const definition = await loadDefinition();
    const declaredAssetIds = definition.assets.map(({ assetId }) => assetId);

    expect(declaredAssetIds).toEqual(["hero-primary"]);

    const sectionAssetIds = definition.profile.sections
      .flatMap((section) => section.items ?? [])
      .map((item) => item.assetId)
      .filter((assetId): assetId is string => assetId !== undefined);
    expect(sectionAssetIds).toEqual([]);
  });
});
