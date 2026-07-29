import {
  realpathSync,
  statSync,
} from "node:fs";
import {
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

import { assetError } from "./errors.js";

export type SupportedImageMediaType =
  | "image/png"
  | "image/jpeg"
  | "image/webp"
  | "image/avif";

export interface PortableImageAssetReference {
  readonly assetId: string;
  readonly kind: "IMAGE";
  readonly sourcePath: string;
  readonly mediaType: SupportedImageMediaType;
  readonly width: number;
  readonly height: number;
}

export interface AssetManifestSource {
  readonly clientId: string;
  readonly publicDirectory: string;
  readonly assets: readonly PortableImageAssetReference[];
}

export interface ImageAssetManifestEntry
  extends PortableImageAssetReference {
  readonly publicPath: string;
}

export interface AssetManifest {
  readonly schemaVersion: 1;
  readonly clientId: string;
  readonly assets: readonly ImageAssetManifestEntry[];
}

const SAFE_IDENTIFIER = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const MAX_IMAGE_DIMENSION = 32_768;
const MEDIA_TYPE_BY_EXTENSION = new Map<
  string,
  SupportedImageMediaType
>([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".avif", "image/avif"],
]);

export function generateAssetManifest(input: unknown): AssetManifest {
  const source = validateSource(input);
  const publicDirectory = validatePublicDirectory(source.publicDirectory);
  const assets = validateReferences(source.assets);

  for (const asset of assets) {
    validateAssetFile(publicDirectory, asset);
  }

  return freezeManifest(source.clientId, assets);
}

export function createEmptyAssetManifest(clientId: string): AssetManifest {
  validateClientId(clientId);
  return freezeManifest(clientId, []);
}

export function validateAssetManifest(input: unknown): AssetManifest {
  if (!isRecord(input) || input.schemaVersion !== 1) {
    throw assetError({
      code: "INVALID_ASSET_MANIFEST",
      message: "Asset manifest must use schemaVersion 1.",
    });
  }

  const clientId = input.clientId;
  validateClientId(clientId);
  if (!Array.isArray(input.assets)) {
    throw assetError({
      code: "INVALID_ASSET_MANIFEST",
      message: "Asset manifest assets must be an array.",
      clientId,
    });
  }

  const references = input.assets.map((asset) => {
    if (!isRecord(asset) || typeof asset.publicPath !== "string") {
      throw assetError({
        code: "INVALID_ASSET_MANIFEST",
        message: "Every manifest asset must include a publicPath.",
        clientId,
      });
    }

    const reference = validateReference(asset);
    const expectedPublicPath = publicPathFor(reference.sourcePath);
    if (asset.publicPath !== expectedPublicPath) {
      throw assetError({
        code: "INVALID_PUBLIC_PATH",
        message: `Asset "${reference.assetId}" must use deployment-local public path "${expectedPublicPath}".`,
        assetId: reference.assetId,
        sourcePath: reference.sourcePath,
        clientId,
      });
    }

    return reference;
  });

  validateUniqueness(references);
  return freezeManifest(clientId, references);
}

function validateSource(input: unknown): AssetManifestSource {
  if (
    !isRecord(input) ||
    typeof input.publicDirectory !== "string" ||
    !Array.isArray(input.assets)
  ) {
    throw assetError({
      code: "INVALID_ASSET_MANIFEST",
      message:
        "Asset source must include clientId, publicDirectory, and an assets array.",
    });
  }

  validateClientId(input.clientId);
  return {
    clientId: input.clientId,
    publicDirectory: input.publicDirectory,
    assets: input.assets as readonly PortableImageAssetReference[],
  };
}

function validateReferences(input: readonly unknown[]) {
  const references = input.map(validateReference);
  validateUniqueness(references);
  return references;
}

function validateReference(input: unknown): PortableImageAssetReference {
  if (!isRecord(input)) {
    throw assetError({
      code: "INVALID_ASSET_MANIFEST",
      message: "Asset reference must be an object.",
    });
  }

  const assetId = input.assetId;
  validateAssetId(assetId);
  if (input.kind !== "IMAGE") {
    throw assetError({
      code: "INVALID_ASSET_MANIFEST",
      message: `Asset "${assetId}" must use kind "IMAGE".`,
      assetId,
    });
  }

  const sourcePath = input.sourcePath;
  validateSourcePath(sourcePath, assetId);
  const mediaType = validateMediaType(sourcePath, input.mediaType, assetId);
  const width = validateDimension(input.width, "width", assetId);
  const height = validateDimension(input.height, "height", assetId);

  return Object.freeze({
    assetId,
    kind: "IMAGE",
    sourcePath,
    mediaType,
    width,
    height,
  });
}

function validateClientId(input: unknown): asserts input is string {
  if (typeof input !== "string" || !SAFE_IDENTIFIER.test(input)) {
    throw assetError({
      code: "INVALID_CLIENT_ID",
      message:
        "Asset clientId must contain lowercase letters, digits, hyphens, or underscores.",
    });
  }
}

function validateAssetId(input: unknown): asserts input is string {
  if (typeof input !== "string" || !SAFE_IDENTIFIER.test(input)) {
    throw assetError({
      code: "INVALID_ASSET_ID",
      message:
        "Asset ID must contain lowercase letters, digits, hyphens, or underscores.",
      ...(typeof input === "string" ? { assetId: input } : {}),
    });
  }
}

function validateSourcePath(
  input: unknown,
  assetId: string,
): asserts input is string {
  const sourcePath = typeof input === "string" ? input : "";
  const segments = sourcePath.split("/");
  if (
    sourcePath.length === 0 ||
    isAbsolute(sourcePath) ||
    sourcePath.includes("\\") ||
    sourcePath.includes("?") ||
    sourcePath.includes("#") ||
    sourcePath.includes(":") ||
    segments[0] !== "assets" ||
    segments.length < 2 ||
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        !SAFE_PATH_SEGMENT.test(segment),
    )
  ) {
    throw assetError({
      code: "INVALID_ASSET_PATH",
      message: `Asset "${assetId}" must use a safe path beneath the deployment assets directory.`,
      assetId,
      ...(sourcePath.length > 0 ? { sourcePath } : {}),
    });
  }
}

function validateMediaType(
  sourcePath: string,
  input: unknown,
  assetId: string,
): SupportedImageMediaType {
  const expected = MEDIA_TYPE_BY_EXTENSION.get(
    extname(sourcePath).toLowerCase(),
  );
  if (expected === undefined) {
    throw assetError({
      code: "UNSUPPORTED_ASSET_FORMAT",
      message: `Asset "${assetId}" uses an unsupported image format. Supported formats are PNG, JPEG, WebP, and AVIF.`,
      assetId,
      sourcePath,
    });
  }
  if (input !== expected) {
    throw assetError({
      code: "ASSET_MEDIA_TYPE_MISMATCH",
      message: `Asset "${assetId}" media type must be "${expected}" for "${sourcePath}".`,
      assetId,
      sourcePath,
    });
  }

  return expected;
}

function validateDimension(
  input: unknown,
  name: "width" | "height",
  assetId: string,
): number {
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < 1 ||
    input > MAX_IMAGE_DIMENSION
  ) {
    throw assetError({
      code: "INVALID_IMAGE_METADATA",
      message: `Asset "${assetId}" ${name} must be an integer between 1 and ${MAX_IMAGE_DIMENSION}.`,
      assetId,
    });
  }

  return input;
}

function validateUniqueness(
  references: readonly PortableImageAssetReference[],
): void {
  const assetIds = new Set<string>();
  const sourcePaths = new Set<string>();
  for (const reference of references) {
    if (assetIds.has(reference.assetId)) {
      throw assetError({
        code: "DUPLICATE_ASSET_ID",
        message: `Asset ID "${reference.assetId}" is declared more than once.`,
        assetId: reference.assetId,
        sourcePath: reference.sourcePath,
      });
    }
    assetIds.add(reference.assetId);

    const portablePathKey = reference.sourcePath.toLowerCase();
    if (sourcePaths.has(portablePathKey)) {
      throw assetError({
        code: "DUPLICATE_ASSET_PATH",
        message: `Asset path "${reference.sourcePath}" is declared more than once.`,
        assetId: reference.assetId,
        sourcePath: reference.sourcePath,
      });
    }
    sourcePaths.add(portablePathKey);
  }
}

function validatePublicDirectory(input: string): string {
  if (!isAbsolute(input)) {
    throw assetError({
      code: "INVALID_PUBLIC_DIRECTORY",
      message: "Asset publicDirectory must be an absolute directory path.",
    });
  }

  try {
    const directory = realpathSync(input);
    if (!statSync(directory).isDirectory()) {
      throw new Error("Not a directory.");
    }
    return directory;
  } catch {
    throw assetError({
      code: "INVALID_PUBLIC_DIRECTORY",
      message: `Asset publicDirectory "${input}" does not exist or is not a directory.`,
    });
  }
}

function validateAssetFile(
  publicDirectory: string,
  asset: PortableImageAssetReference,
): void {
  const candidate = resolve(
    publicDirectory,
    ...asset.sourcePath.split("/"),
  );
  if (!isInside(publicDirectory, candidate)) {
    throw assetError({
      code: "INVALID_ASSET_PATH",
      message: `Asset "${asset.assetId}" resolves outside the public directory.`,
      assetId: asset.assetId,
      sourcePath: asset.sourcePath,
    });
  }

  let realFile: string;
  try {
    realFile = realpathSync(candidate);
    if (!statSync(realFile).isFile()) {
      throw new Error("Not a file.");
    }
  } catch {
    throw assetError({
      code: "MISSING_ASSET_FILE",
      message: `Asset "${asset.assetId}" file "${asset.sourcePath}" does not exist.`,
      assetId: asset.assetId,
      sourcePath: asset.sourcePath,
    });
  }

  if (!isInside(publicDirectory, realFile)) {
    throw assetError({
      code: "INVALID_ASSET_PATH",
      message: `Asset "${asset.assetId}" resolves outside the public directory.`,
      assetId: asset.assetId,
      sourcePath: asset.sourcePath,
    });
  }
}

function isInside(parent: string, candidate: string): boolean {
  const pathFromParent = relative(parent, candidate);
  return (
    pathFromParent !== "" &&
    pathFromParent !== ".." &&
    !pathFromParent.startsWith(`..${sep}`) &&
    !isAbsolute(pathFromParent)
  );
}

function freezeManifest(
  clientId: string,
  references: readonly PortableImageAssetReference[],
): AssetManifest {
  const assets = Object.freeze(
    [...references]
      .sort(
        (left, right) =>
          compareText(left.assetId, right.assetId) ||
          compareText(left.sourcePath, right.sourcePath),
      )
      .map((reference) =>
        Object.freeze({
          ...reference,
          publicPath: publicPathFor(reference.sourcePath),
        }),
      ),
  );

  return Object.freeze({
    schemaVersion: 1,
    clientId,
    assets,
  });
}

function publicPathFor(sourcePath: string): string {
  return `/${sourcePath}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
