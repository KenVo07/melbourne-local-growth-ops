import type {
  RuntimeNavigationTarget,
  RuntimePageDefinition,
  RuntimePageGraph,
  RuntimeProject,
  RuntimeProjectCollection,
  RuntimeServiceItem,
  RuntimeWebsiteProfileContent,
} from "../runtime-types";

/**
 * Pure relationship helpers exposed to authored client source.
 *
 * They resolve stable identifiers only and deliberately contain no
 * presentation. Nothing here matches a display title or a slugified heading, so
 * editing visible copy can never change what a route resolves.
 */

export function pageById(
  graph: RuntimePageGraph,
  pageId: string,
): RuntimePageDefinition | undefined {
  return graph.pages.find((page) => page.pageId === pageId);
}

/**
 * The pages that declare this page as their parent, in graph order.
 *
 * The second navigation level is derived from the page graph rather than
 * authored beside it, so a service added to the site cannot be missing from the
 * menu and a menu entry cannot point at a page somebody removed.
 */
export function childPages(
  graph: RuntimePageGraph,
  pageId: string,
): readonly RuntimePageDefinition[] {
  return Object.freeze(graph.pages.filter((page) => page.parentPageId === pageId));
}

export function pageByPath(
  graph: RuntimePageGraph,
  path: string,
): RuntimePageDefinition | undefined {
  return graph.pages.find((page) => page.path === path);
}

/**
 * Resolves a navigation target to an absolute in-site href. An anchor target
 * keeps its leading route, including on the home page, because navigation
 * renders on every route and a bare fragment would resolve against whichever
 * page the visitor is currently viewing.
 */
export function navigationHref(
  graph: RuntimePageGraph,
  target: RuntimeNavigationTarget,
): string {
  const page = pageById(graph, target.pageId);
  if (page === undefined) {
    throw new Error(`Navigation target page "${target.pageId}" is missing.`);
  }
  return target.kind === "ROUTE" ? page.path : `${page.path}#${target.anchorId}`;
}

export function projectById(
  projects: RuntimeProjectCollection,
  projectId: string,
): RuntimeProject | undefined {
  return projects.projects.find((project) => project.projectId === projectId);
}

export function projectBySlug(
  projects: RuntimeProjectCollection,
  slug: string,
): RuntimeProject | undefined {
  return projects.projects.find((project) => project.slug === slug);
}

/** Projects this project explicitly relates to, in the authored order. */
export function relatedProjects(
  projects: RuntimeProjectCollection,
  project: RuntimeProject,
): readonly RuntimeProject[] {
  return Object.freeze(
    project.relatedProjectIds
      .map((id) => projectById(projects, id))
      .filter((candidate): candidate is RuntimeProject => candidate !== undefined),
  );
}

/**
 * Previous and next project in collection order, for continued exploration.
 * The collection does not wrap: the first project has no previous.
 */
export function siblingProjects(
  projects: RuntimeProjectCollection,
  project: RuntimeProject,
): Readonly<{
  previous: RuntimeProject | undefined;
  next: RuntimeProject | undefined;
}> {
  const index = projects.projects.findIndex(
    (candidate) => candidate.projectId === project.projectId,
  );
  return Object.freeze({
    previous: index > 0 ? projects.projects[index - 1] : undefined,
    next:
      index >= 0 && index < projects.projects.length - 1
        ? projects.projects[index + 1]
        : undefined,
  });
}

/**
 * Resolves a service by its stable identifier only. Title and slug matching are
 * deliberately unsupported.
 */
export function serviceById(
  profile: RuntimeWebsiteProfileContent,
  serviceId: string,
): RuntimeServiceItem | undefined {
  for (const section of profile.sections) {
    if (section.type !== "SERVICES") continue;
    const match = section.items.find((item) => item.serviceId === serviceId);
    if (match !== undefined) return match;
  }
  return undefined;
}
