import type { ReactNode } from "react";

import { clientWebsite } from "../client-website";
import type {
  RuntimeExternalAction,
  RuntimePageDefinition,
} from "../runtime-types";
import { authoredClientExperience } from "./authored";
import type { ClientExperiencePlatformComponents } from "./contract";
import { createClientExperiencePlatformComponents } from "./platform-components";
import { createClientExperienceRegistry } from "./registry";
import type { ClientExperienceRegistry } from "./registry";
import {
  createClientExperiencePublicProjection,
  type ClientExperiencePublicProjection,
} from "./public-projection";
import { resolveClientExperienceMedia } from "./resolve-media";

/**
 * Everything one authored route render needs, resolved from the validated
 * snapshot. Building this is deliberately cheap and synchronous so a static
 * export can call it per route.
 */
export interface AuthoredClientExperienceContext {
  readonly projection: ClientExperiencePublicProjection;
  readonly registry: ClientExperienceRegistry;
  readonly pages: readonly RuntimePageDefinition[];
  readonly homePageId: string;
  createPlatform(
    renderRegion: (regionId: string) => ReactNode,
  ): ClientExperiencePlatformComponents;
}

/**
 * True when the validated snapshot selected the authored path. Every route
 * checks this before touching authored source, so a legacy definition never
 * reaches the client experience runtime.
 */
export function isAuthoredClientWebsite(): boolean {
  return clientWebsite.renderingMode === "AUTHORED_CLIENT_EXPERIENCE";
}

let cached: AuthoredClientExperienceContext | undefined;

/**
 * Resolves the authored context once per process. Throws rather than degrading
 * when the snapshot claims the authored mode but its data is incomplete: a
 * malformed authored site must fail the build, not silently render less.
 */
export function authoredClientExperienceContext(): AuthoredClientExperienceContext {
  if (cached !== undefined) return cached;

  const { pageGraph, projects, clientExperience, profile, assetManifest } =
    clientWebsite;
  if (
    pageGraph === undefined ||
    projects === undefined ||
    clientExperience === undefined ||
    profile === undefined
  ) {
    throw new Error(
      "Client website snapshot selected the authored experience but is missing its validated page graph, projects, manifest or profile.",
    );
  }
  if (authoredClientExperience === undefined) {
    throw new Error(
      "Client website snapshot selected the authored experience but no authored source is present at src/client-experience/authored.",
    );
  }

  const media = resolveClientExperienceMedia(
    assetManifest ?? {
      schemaVersion: 1,
      clientId: clientWebsite.configuration.clientId,
      assets: [],
    },
    projects,
    pageGraph.pages,
  );

  const projection = createClientExperiencePublicProjection({
    configuration: clientWebsite.configuration,
    pageGraph,
    profile,
    projects,
    media,
  });

  const registry = createClientExperienceRegistry(
    authoredClientExperience,
    clientExperience,
    pageGraph,
  );

  const knownRegionIds = new Set(
    clientWebsite.regions.map(({ regionId }) => regionId),
  );
  const actions = externalActionsById();

  cached = Object.freeze({
    projection,
    registry,
    pages: pageGraph.pages,
    homePageId: pageGraph.homePageId,
    createPlatform(renderRegion: (regionId: string) => ReactNode) {
      return createClientExperiencePlatformComponents({
        media,
        actions,
        knownRegionIds,
        renderRegion,
        search: {
          enabled: clientWebsite.foundationSearch.enabled,
          businessName: clientWebsite.configuration.display.businessName,
        },
      });
    },
  });
  return cached;
}

/** Every external action the validated profile declares, keyed by action ID. */
function externalActionsById(): ReadonlyMap<string, RuntimeExternalAction> {
  const actions = new Map<string, RuntimeExternalAction>();
  for (const section of clientWebsite.profile?.sections ?? []) {
    if (section.type !== "ACTIONS") continue;
    for (const action of section.actions) actions.set(action.actionId, action);
  }
  return actions;
}
