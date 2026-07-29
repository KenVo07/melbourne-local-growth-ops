import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  AssetPipelineError,
  createAssetResolver,
  createEmptyAssetManifest,
  generateAssetManifest,
  validateAssetManifest,
  type AssetManifest,
} from "./index.js";

const temporaryDirectories: string[] = [];

function publicDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "mlgo-assets-"));
  temporaryDirectories.push(directory);
  return directory;
}

function writeAsset(
  root: string,
  sourcePath: string,
  contents = "structural image fixture",
): void {
  const file = join(root, ...sourcePath.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, contents);
}

function image(
  assetId: string,
  sourcePath: string,
  mediaType = "image/webp",
) {
  return {
    assetId,
    kind: "IMAGE",
    sourcePath,
    mediaType,
    width: 1600,
    height: 900,
  } as const;
}

function captureError(operation: () => unknown): AssetPipelineError {
  try {
    operation();
  } catch (error) {
    expect(error).toBeInstanceOf(AssetPipelineError);
    return error as AssetPipelineError;
  }

  throw new Error("Expected an AssetPipelineError.");
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("generateAssetManifest", () => {
  it("generates a deterministic frozen manifest with deployment-local paths", () => {
    const root = publicDirectory();
    writeAsset(root, "assets/gallery/team.png");
    writeAsset(root, "assets/hero/primary.webp");

    const manifest = generateAssetManifest({
      clientId: "client-a",
      publicDirectory: root,
      assets: [
        image("team", "assets/gallery/team.png", "image/png"),
        image("hero-primary", "assets/hero/primary.webp"),
      ],
    });

    expect(manifest).toEqual({
      schemaVersion: 1,
      clientId: "client-a",
      assets: [
        {
          assetId: "hero-primary",
          kind: "IMAGE",
          sourcePath: "assets/hero/primary.webp",
          publicPath: "/assets/hero/primary.webp",
          mediaType: "image/webp",
          width: 1600,
          height: 900,
        },
        {
          assetId: "team",
          kind: "IMAGE",
          sourcePath: "assets/gallery/team.png",
          publicPath: "/assets/gallery/team.png",
          mediaType: "image/png",
          width: 1600,
          height: 900,
        },
      ],
    });
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.assets)).toBe(true);
    expect(Object.isFrozen(manifest.assets[0])).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain(root);
    expect(manifest).not.toHaveProperty("publicDirectory");
  });

  it.each([
    ["absolute path", "C:/agency/hero.webp", "INVALID_ASSET_PATH"],
    ["path traversal", "assets/../private.webp", "INVALID_ASSET_PATH"],
    ["backslashes", "assets\\hero.webp", "INVALID_ASSET_PATH"],
    ["query string", "assets/hero.webp?token=secret", "INVALID_ASSET_PATH"],
    ["fragment", "assets/hero.webp#hero", "INVALID_ASSET_PATH"],
    ["external URL", "https://example.com/hero.webp", "INVALID_ASSET_PATH"],
    ["outside asset namespace", "hero.webp", "INVALID_ASSET_PATH"],
  ])("rejects %s", (_label, sourcePath, code) => {
    const error = captureError(() =>
      generateAssetManifest({
        clientId: "client-a",
        publicDirectory: publicDirectory(),
        assets: [image("hero-primary", sourcePath)],
      }),
    );

    expect(error.code).toBe(code);
  });

  it.each([
    ["assets/hero/logo.svg", "image/svg+xml"],
    ["assets/hero/animation.gif", "image/gif"],
  ])("rejects unsupported %s assets", (sourcePath, mediaType) => {
    const error = captureError(() =>
      generateAssetManifest({
        clientId: "client-a",
        publicDirectory: publicDirectory(),
        assets: [image("hero-primary", sourcePath, mediaType)],
      }),
    );

    expect(error.code).toBe("UNSUPPORTED_ASSET_FORMAT");
  });

  it("rejects an extension and media type mismatch", () => {
    const error = captureError(() =>
      generateAssetManifest({
        clientId: "client-a",
        publicDirectory: publicDirectory(),
        assets: [
          image("hero-primary", "assets/hero/primary.png", "image/webp"),
        ],
      }),
    );

    expect(error.code).toBe("ASSET_MEDIA_TYPE_MISMATCH");
  });

  it("rejects invalid identifiers, dimensions, and duplicate IDs or paths", () => {
    const root = publicDirectory();
    writeAsset(root, "assets/hero/primary.webp");
    writeAsset(root, "assets/hero/secondary.webp");

    expect(
      captureError(() =>
        generateAssetManifest({
          clientId: "client-a",
          publicDirectory: root,
          assets: [image("Hero Primary", "assets/hero/primary.webp")],
        }),
      ).code,
    ).toBe("INVALID_ASSET_ID");
    expect(
      captureError(() =>
        generateAssetManifest({
          clientId: "client-a",
          publicDirectory: root,
          assets: [
            {
              ...image("hero-primary", "assets/hero/primary.webp"),
              width: 0,
            },
          ],
        }),
      ).code,
    ).toBe("INVALID_IMAGE_METADATA");
    expect(
      captureError(() =>
        generateAssetManifest({
          clientId: "client-a",
          publicDirectory: root,
          assets: [
            image("hero-primary", "assets/hero/primary.webp"),
            image("hero-primary", "assets/hero/secondary.webp"),
          ],
        }),
      ).code,
    ).toBe("DUPLICATE_ASSET_ID");
    expect(
      captureError(() =>
        generateAssetManifest({
          clientId: "client-a",
          publicDirectory: root,
          assets: [
            image("hero-primary", "assets/hero/primary.webp"),
            image("hero-secondary", "assets/HERO/PRIMARY.WEBP"),
          ],
        }),
      ).code,
    ).toBe("DUPLICATE_ASSET_PATH");
  });

  it("rejects missing files and files that escape through a symlink", () => {
    const root = publicDirectory();
    const missing = captureError(() =>
      generateAssetManifest({
        clientId: "client-a",
        publicDirectory: root,
        assets: [image("hero-primary", "assets/hero/missing.webp")],
      }),
    );
    expect(missing.code).toBe("MISSING_ASSET_FILE");

    const external = publicDirectory();
    writeAsset(external, "private.webp");
    mkdirSync(join(root, "assets"), { recursive: true });
    symlinkSync(
      external,
      join(root, "assets", "linked"),
      "junction",
    );
    const escaped = captureError(() =>
      generateAssetManifest({
        clientId: "client-a",
        publicDirectory: root,
        assets: [image("hero-primary", "assets/linked/private.webp")],
      }),
    );
    expect(escaped.code).toBe("INVALID_ASSET_PATH");
  });
});

describe("validateAssetManifest", () => {
  it("validates and canonicalizes portable manifest data", () => {
    const manifest = validateAssetManifest({
      schemaVersion: 1,
      clientId: "client-a",
      assets: [
        {
          ...image("team", "assets/gallery/team.jpeg", "image/jpeg"),
          publicPath: "/assets/gallery/team.jpeg",
        },
        {
          ...image("hero-primary", "assets/hero/primary.avif", "image/avif"),
          publicPath: "/assets/hero/primary.avif",
        },
      ],
    });

    expect(manifest.assets.map(({ assetId }) => assetId)).toEqual([
      "hero-primary",
      "team",
    ]);
  });

  it("rejects a non-canonical public path", () => {
    const error = captureError(() =>
      validateAssetManifest({
        schemaVersion: 1,
        clientId: "client-a",
        assets: [
          {
            ...image("hero-primary", "assets/hero/primary.webp"),
            publicPath: "/assets/client-a/hero/primary.webp",
          },
        ],
      }),
    );

    expect(error.code).toBe("INVALID_PUBLIC_PATH");
  });
});

describe("asset resolution", () => {
  const manifest: AssetManifest = createEmptyAssetManifest("client-a");

  it("binds a resolver to the expected client identity", () => {
    const error = captureError(() =>
      createAssetResolver(manifest, "client-b"),
    );

    expect(error).toMatchObject({
      code: "ASSET_CLIENT_MISMATCH",
      clientId: "client-a",
      expectedClientId: "client-b",
    });
  });

  it("returns undefined for optional lookup and throws for required lookup", () => {
    const resolver = createAssetResolver(manifest, "client-a");

    expect(resolver.findImage("hero-primary")).toBeUndefined();
    expect(
      captureError(() => resolver.resolveImage("hero-primary")).code,
    ).toBe("UNKNOWN_ASSET_ID");
  });

  it("keeps same-named assets isolated between clients", () => {
    const rootA = publicDirectory();
    const rootB = publicDirectory();
    writeAsset(rootA, "assets/hero/primary.webp", "client a");
    writeAsset(rootB, "assets/hero/primary.webp", "client b");
    const clientA = generateAssetManifest({
      clientId: "client-a",
      publicDirectory: rootA,
      assets: [image("hero-primary", "assets/hero/primary.webp")],
    });
    const clientB = generateAssetManifest({
      clientId: "client-b",
      publicDirectory: rootB,
      assets: [image("hero-primary", "assets/hero/primary.webp")],
    });

    expect(
      createAssetResolver(clientA, "client-a").resolveImage("hero-primary"),
    ).toMatchObject({ publicPath: "/assets/hero/primary.webp" });
    expect(
      createAssetResolver(clientB, "client-b").resolveImage("hero-primary"),
    ).toMatchObject({ publicPath: "/assets/hero/primary.webp" });
    expect(() => createAssetResolver(clientA, "client-b")).toThrow(
      AssetPipelineError,
    );
  });
});
