import { assetError } from "./errors.js";
import {
  validateAssetManifest,
  type AssetManifest,
  type ImageAssetManifestEntry,
} from "./manifest.js";

export interface AssetResolver {
  readonly manifest: AssetManifest;
  findImage(assetId: string): ImageAssetManifestEntry | undefined;
  resolveImage(assetId: string): ImageAssetManifestEntry;
}

export function createAssetResolver(
  input: unknown,
  expectedClientId: string,
): AssetResolver {
  const manifest = validateAssetManifest(input);
  if (manifest.clientId !== expectedClientId) {
    throw assetError({
      code: "ASSET_CLIENT_MISMATCH",
      message: `Asset manifest belongs to client "${manifest.clientId}", not "${expectedClientId}".`,
      clientId: manifest.clientId,
      expectedClientId,
    });
  }

  const assetsById = new Map(
    manifest.assets.map((asset) => [asset.assetId, asset]),
  );

  return Object.freeze({
    manifest,
    findImage(assetId: string): ImageAssetManifestEntry | undefined {
      return assetsById.get(assetId);
    },
    resolveImage(assetId: string): ImageAssetManifestEntry {
      const asset = assetsById.get(assetId);
      if (asset === undefined) {
        throw assetError({
          code: "UNKNOWN_ASSET_ID",
          message: `Asset "${assetId}" is not present in client "${manifest.clientId}" manifest.`,
          assetId,
          clientId: manifest.clientId,
          expectedClientId,
        });
      }
      return asset;
    },
  });
}
