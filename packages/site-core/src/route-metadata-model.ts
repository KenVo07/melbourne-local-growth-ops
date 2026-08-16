import type { WebsitePageDefinition } from "./page-graph.js";

export interface WebsiteRouteMetadataSiteIdentity {
  readonly businessName: string;
  readonly canonicalHostname: string;
}

export interface WebsiteRouteMetadataModel {
  readonly title: string;
  readonly description: string;
  readonly canonicalUrl: string;
  readonly openGraphImageAssetId?: string;
}

/**
 * Produces framework-neutral metadata. The Next.js runtime converts this model
 * to its Metadata type; client-authored source does not inject arbitrary head
 * markup.
 */
export function buildWebsiteRouteMetadataModel(
  site: WebsiteRouteMetadataSiteIdentity,
  page: WebsitePageDefinition,
): WebsiteRouteMetadataModel {
  const title = page.metadata.title.includes(site.businessName)
    ? page.metadata.title
    : `${page.metadata.title} | ${site.businessName}`;
  const canonicalUrl = `https://${site.canonicalHostname}${
    page.path === "/" ? "" : page.path
  }`;
  return Object.freeze({
    title,
    description: page.metadata.description,
    canonicalUrl,
    ...(page.metadata.openGraphImageAssetId === undefined
      ? {}
      : { openGraphImageAssetId: page.metadata.openGraphImageAssetId }),
  });
}
