import type {
  RuntimeAssetManifest,
  RuntimeMediaReference,
  RuntimePageDefinition,
  RuntimeProjectCollection,
} from "../runtime-types";
import type { ClientExperienceResolvedMedia } from "./contract";

export class ClientExperienceMediaError extends Error {
  readonly assetId: string;
  readonly referencedBy: string;

  constructor(assetId: string, referencedBy: string) {
    super(
      `Client media "${assetId}" referenced by ${referencedBy} is not present in the validated asset manifest.`,
    );
    this.name = "ClientExperienceMediaError";
    this.assetId = assetId;
    this.referencedBy = referencedBy;
  }
}

interface ReferenceUse {
  readonly reference: RuntimeMediaReference;
  readonly referencedBy: string;
}

/**
 * Collects every client-owned media reference reachable from the validated
 * snapshot and resolves it against the asset manifest.
 *
 * Resolution happens during generation, not during render, so a missing asset
 * fails the build with the exact reference that caused it rather than producing
 * a broken image in the browser.
 */
export function resolveClientExperienceMedia(
  assetManifest: RuntimeAssetManifest,
  projects: RuntimeProjectCollection,
  pages: readonly RuntimePageDefinition[],
): readonly ClientExperienceResolvedMedia[] {
  const entries = new Map(
    assetManifest.assets.map((asset) => [asset.assetId, asset]),
  );
  const resolved = new Map<string, ClientExperienceResolvedMedia>();

  for (const use of collectReferences(projects)) {
    if (resolved.has(use.reference.assetId)) continue;
    const asset = entries.get(use.reference.assetId);
    if (asset === undefined) {
      throw new ClientExperienceMediaError(
        use.reference.assetId,
        use.referencedBy,
      );
    }
    resolved.set(
      use.reference.assetId,
      Object.freeze({
        reference: use.reference,
        src: asset.publicPath,
        width: asset.width,
        height: asset.height,
        mediaType: asset.mediaType,
      }),
    );
  }

  // Open Graph images are page metadata rather than composed media, but they
  // must still name a real asset.
  for (const page of pages) {
    const assetId = page.metadata.openGraphImageAssetId;
    if (assetId === undefined) continue;
    if (!entries.has(assetId)) {
      throw new ClientExperienceMediaError(
        assetId,
        `page "${page.pageId}" Open Graph metadata`,
      );
    }
  }

  return Object.freeze(
    [...resolved.values()].sort((left, right) =>
      left.reference.assetId < right.reference.assetId
        ? -1
        : left.reference.assetId > right.reference.assetId
          ? 1
          : 0,
    ),
  );
}

function collectReferences(
  projects: RuntimeProjectCollection,
): readonly ReferenceUse[] {
  const uses: ReferenceUse[] = [];
  for (const project of projects.projects) {
    uses.push({
      reference: project.hero,
      referencedBy: `project "${project.projectId}" hero`,
    });
    for (const [index, reference] of project.gallery.entries()) {
      uses.push({
        reference,
        referencedBy: `project "${project.projectId}" gallery[${index}]`,
      });
    }
    for (const block of project.story) {
      for (const [index, reference] of block.media.entries()) {
        uses.push({
          reference,
          referencedBy: `project "${project.projectId}" story block "${block.blockId}" media[${index}]`,
        });
      }
    }
  }
  return uses;
}
