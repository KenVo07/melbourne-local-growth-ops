import type {
  AssetManifest,
  AssetManifestSource,
  AssetResolver,
  ImageAssetManifestEntry,
} from "@melbourne-local-growth-ops/asset-pipeline";

export type {
  AssetManifest,
  AssetManifestSource,
  ImageAssetManifestEntry,
};

export interface WebsiteImageSelection {
  readonly slotId: string;
  readonly assetId: string;
  readonly required: boolean;
  readonly alt: string;
  readonly sizes: string;
  readonly priority: boolean;
}

export interface ResolvedWebsiteImage {
  readonly slotId: string;
  readonly asset: ImageAssetManifestEntry;
  readonly alt: string;
  readonly sizes: string;
  readonly priority: boolean;
}

export interface WebsiteTemplateAssetContext {
  selectImage(
    selection: WebsiteImageSelection,
  ): ResolvedWebsiteImage | undefined;
}

export function createWebsiteTemplateAssetContext(
  resolver: AssetResolver,
): WebsiteTemplateAssetContext {
  return Object.freeze({
    selectImage(
      selection: WebsiteImageSelection,
    ): ResolvedWebsiteImage | undefined {
      const asset = selection.required
        ? resolver.resolveImage(selection.assetId)
        : resolver.findImage(selection.assetId);
      if (asset === undefined) {
        return undefined;
      }

      return Object.freeze({
        slotId: selection.slotId,
        asset,
        alt: selection.alt,
        sizes: selection.sizes,
        priority: selection.priority,
      });
    },
  });
}
