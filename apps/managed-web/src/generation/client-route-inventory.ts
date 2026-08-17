import type {
  ClientExperienceManifest,
  WebsitePageGraph,
} from "@melbourne-local-growth-ops/site-core";

export interface ClientRouteInventoryEntry {
  readonly pageId: string;
  readonly path: string;
  readonly kind: string;
  readonly experienceRouteId: string;
  readonly searchIncluded: boolean;
}

export interface ClientRouteInventory {
  readonly schemaVersion: 1;
  readonly experienceId: string;
  readonly experienceVersion: string;
  readonly homePageId: string;
  readonly routes: readonly ClientRouteInventoryEntry[];
}

export function createClientRouteInventory(
  pageGraph: WebsitePageGraph,
  manifest: ClientExperienceManifest,
): ClientRouteInventory {
  const manifestRoutes = new Set(manifest.routeIds);
  for (const page of pageGraph.pages) {
    if (!manifestRoutes.has(page.experienceRouteId)) {
      throw new Error(
        `Page "${page.pageId}" references undeclared experience route "${page.experienceRouteId}".`,
      );
    }
  }
  return deepFreeze({
    schemaVersion: 1 as const,
    experienceId: manifest.experienceId,
    experienceVersion: manifest.experienceVersion,
    homePageId: pageGraph.homePageId,
    routes: [...pageGraph.pages]
      .sort((left, right) => compareText(left.path, right.path))
      .map((page) => ({
        pageId: page.pageId,
        path: page.path,
        kind: page.kind,
        experienceRouteId: page.experienceRouteId,
        searchIncluded: page.search.include,
      })),
  });
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
