import type {
  RuntimePageDefinition,
  RuntimePageGraph,
} from "../runtime-types";

export interface ClientRouteResolution {
  readonly path: string;
  readonly page: RuntimePageDefinition;
}

export function resolveClientRoute(
  graph: RuntimePageGraph,
  segments: readonly string[] | undefined,
): ClientRouteResolution | undefined {
  const path = segmentsToPath(segments);
  const page = graph.pages.find((candidate) => candidate.path === path);
  return page === undefined ? undefined : Object.freeze({ path, page });
}

export function segmentsToPath(
  segments: readonly string[] | undefined,
): string {
  if (segments === undefined || segments.length === 0) return "/";
  if (segments.some((segment) => !isValidSegment(segment))) {
    return "/__invalid-client-route__";
  }
  return `/${segments.join("/")}`;
}

export function clientStaticParams(
  graph: RuntimePageGraph,
): readonly Readonly<{ segments: readonly string[] }>[] {
  return Object.freeze(
    graph.pages
      .filter(({ path }) => path !== "/")
      .map(({ path }) =>
        Object.freeze({
          segments: Object.freeze(path.slice(1).split("/")),
        }),
      ),
  );
}

export function homePage(graph: RuntimePageGraph): RuntimePageDefinition {
  const page = graph.pages.find(({ pageId }) => pageId === graph.homePageId);
  if (page === undefined) {
    throw new Error(`Home page "${graph.homePageId}" is missing from the validated graph.`);
  }
  return page;
}

function isValidSegment(segment: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment);
}
