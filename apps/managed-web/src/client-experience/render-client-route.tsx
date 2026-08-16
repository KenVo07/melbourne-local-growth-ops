import { createElement, type ReactElement } from "react";
import { projectById } from "./content-helpers";

import type {
  ClientExperiencePlatformComponents,
  ClientExperienceRouteProps,
} from "./contract";
import type { ClientExperiencePublicProjection } from "./public-projection";
import type { ClientExperienceRegistry } from "./registry";

export interface RenderClientRouteOptions {
  readonly routeId: string;
  readonly pageId: string;
  readonly projection: ClientExperiencePublicProjection;
  readonly platform: ClientExperiencePlatformComponents;
  readonly registry: ClientExperienceRegistry;
}

/**
 * Resolves one validated page and its exact authored route component. Content
 * references are resolved before React receives props so missing Project data
 * fails deterministically instead of producing a broken page.
 */
export function renderClientRoute(
  options: RenderClientRouteOptions,
): ReactElement {
  const page = options.projection.pageGraph.pages.find(
    ({ pageId }) => pageId === options.pageId,
  );
  if (page === undefined) {
    throw new Error(`Client route page "${options.pageId}" is missing.`);
  }
  if (page.experienceRouteId !== options.routeId) {
    throw new Error(
      `Page "${page.pageId}" requires experience route "${page.experienceRouteId}", not "${options.routeId}".`,
    );
  }

  const project =
    page.content.kind === "PROJECT"
      ? projectById(options.projection.projects, page.content.projectId)
      : undefined;
  if (page.content.kind === "PROJECT" && project === undefined) {
    throw new Error(
      `Project "${page.content.projectId}" for page "${page.pageId}" is missing.`,
    );
  }

  const props: ClientExperienceRouteProps = Object.freeze({
    site: options.projection.site,
    page,
    pageGraph: options.projection.pageGraph,
    profile: options.projection.profile,
    projects: options.projection.projects,
    ...(project === undefined ? {} : { project }),
    media: options.projection.media,
    platform: options.platform,
  });
  return createElement(options.registry.resolveRoute(options.routeId), props);
}
