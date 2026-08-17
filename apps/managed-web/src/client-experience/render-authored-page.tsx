import { createElement, type ReactElement } from "react";

import {
  composeCurrentManagedWebsite,
  managedWebsiteRenderers,
} from "../managed-website";
import { renderManagedRegion } from "../rendering";
import type { RuntimePageDefinition } from "../runtime-types";
import { authoredClientExperienceContext } from "./load-client-experience";
import { renderClientRoute } from "./render-client-route";

/**
 * Builds the platform primitives for one render pass.
 *
 * Region rendering stays here in the Kernel: authored source receives a
 * callback, never module or connector data.
 */
function createPlatformForRender() {
  const context = authoredClientExperienceContext();
  const composition = composeCurrentManagedWebsite();
  return context.createPlatform((regionId) => {
    const region = composition.regions.find(
      (candidate) => candidate.regionId === regionId,
    );
    if (region === undefined) {
      throw new Error(`Validated region "${regionId}" is missing.`);
    }
    return renderManagedRegion(region, managedWebsiteRenderers);
  });
}

/**
 * Renders the authored not-found route, when the experience registers one.
 *
 * Returns undefined otherwise, so the Kernel can fall back to its own neutral
 * page rather than inventing a layout the client never authored. The component
 * is deliberately not told which path was requested.
 */
export function renderAuthoredNotFound(): ReactElement | undefined {
  const context = authoredClientExperienceContext();
  if (context.notFound === undefined) {
    return undefined;
  }
  return createElement(context.notFound, {
    site: context.projection.site,
    pageGraph: context.projection.pageGraph,
    platform: createPlatformForRender(),
  });
}

/**
 * Renders one validated page through its authored route component.
 *
 * Root and catch-all segments share this function so both paths resolve
 * content, media and regions identically.
 */
export function renderAuthoredPage(page: RuntimePageDefinition): ReactElement {
  const context = authoredClientExperienceContext();
  return renderClientRoute({
    routeId: page.experienceRouteId,
    pageId: page.pageId,
    projection: context.projection,
    registry: context.registry,
    platform: createPlatformForRender(),
  });
}

/** The validated page for one resolved route path, or undefined. */
export function authoredPageForPath(
  path: string,
): RuntimePageDefinition | undefined {
  return authoredClientExperienceContext().pages.find(
    (page) => page.path === path,
  );
}

/** The validated home page of the authored graph. */
export function authoredHomePage(): RuntimePageDefinition {
  const context = authoredClientExperienceContext();
  const page = context.pages.find(
    ({ pageId }) => pageId === context.homePageId,
  );
  if (page === undefined) {
    throw new Error("Validated page graph is missing its home page.");
  }
  return page;
}
