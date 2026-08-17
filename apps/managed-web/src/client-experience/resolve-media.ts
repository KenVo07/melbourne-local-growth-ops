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

  /*
   * Integrity pass. Every reference the validated content already makes must
   * resolve, and it must fail here — during generation, naming the exact
   * reference — rather than as a broken image in a browser.
   */
  for (const use of collectReferences(projects)) {
    if (!entries.has(use.reference.assetId)) {
      throw new ClientExperienceMediaError(
        use.reference.assetId,
        use.referencedBy,
      );
    }
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

  /*
   * Resolution set. Every validated client asset is resolvable, not only the
   * ones a project happens to reference, because an authored route legitimately
   * uses site-level media — a home plate, an about portrait — that belongs to no
   * project. The asset manifest is the client's validated media, so it is the
   * correct boundary: an authored route can render any asset the client owns
   * and nothing else.
   *
   * Alt text, role and responsive presentation always come from the reference
   * the route passes, never from here, so media semantics stay client-owned
   * per usage.
   */
  const referenceByAssetId = new Map(
    collectReferences(projects).map((use) => [use.reference.assetId, use.reference]),
  );

  return Object.freeze(
    [...entries.values()]
      .sort((left, right) =>
        left.assetId < right.assetId ? -1 : left.assetId > right.assetId ? 1 : 0,
      )
      .map((asset) =>
        Object.freeze({
          reference:
            referenceByAssetId.get(asset.assetId) ??
            defaultReference(asset.assetId),
          src: asset.publicPath,
          width: asset.width,
          height: asset.height,
          mediaType: asset.mediaType,
        }),
      ),
  );
}

/**
 * Placeholder reference for an asset no project references. It is only ever the
 * key in the resolution map: a route that renders this asset supplies its own
 * reference, carrying the alt text and presentation that usage requires.
 */
function defaultReference(assetId: string): RuntimeMediaReference {
  return {
    assetId,
    role: "CONTENT",
    decorative: false,
    alt: "",
    presentation: { aspect: "NATURAL", fit: "COVER" },
  };
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
