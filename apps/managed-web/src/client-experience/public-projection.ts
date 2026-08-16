import type {
  RuntimeMediaReference,
  RuntimePageGraph,
  RuntimeProjectCollection,
  RuntimeWebsiteProfileContent,
} from "../runtime-types";

import type {
  ClientExperienceResolvedMedia,
  ClientExperienceSiteIdentity,
} from "./contract";

export interface ClientExperiencePublicProjectionInput {
  readonly configuration: {
    readonly clientId: string;
    readonly display: {
      readonly businessName: string;
      readonly tagline?: string | undefined;
    };
    readonly domains: readonly {
      readonly hostname: string;
      readonly canonical: boolean;
    }[];
  };
  readonly pageGraph: RuntimePageGraph;
  readonly profile: RuntimeWebsiteProfileContent;
  readonly projects: RuntimeProjectCollection;
  readonly media: readonly ClientExperienceResolvedMedia[];
}

export interface ClientExperiencePublicProjection {
  readonly site: ClientExperienceSiteIdentity;
  readonly pageGraph: RuntimePageGraph;
  readonly profile: RuntimeWebsiteProfileContent;
  readonly projects: RuntimeProjectCollection;
  readonly media: readonly ClientExperienceResolvedMedia[];
}

/**
 * Creates the only data projection passed to authored Client Experience source.
 * The input intentionally omits modules, connectors, entitlements, secret
 * bindings and internal operational state. Passing a structurally wider object
 * is safe because the returned value selects only these fields.
 */
export function createClientExperiencePublicProjection(
  input: ClientExperiencePublicProjectionInput,
): ClientExperiencePublicProjection {
  const canonicalHostname = input.configuration.domains.find(
    ({ canonical }) => canonical,
  )?.hostname;

  return deepFreeze({
    site: {
      clientId: input.configuration.clientId,
      businessName: input.configuration.display.businessName,
      ...(input.configuration.display.tagline === undefined
        ? {}
        : { tagline: input.configuration.display.tagline }),
      ...(canonicalHostname === undefined ? {} : { canonicalHostname }),
    },
    pageGraph: input.pageGraph,
    profile: input.profile,
    projects: input.projects,
    media: input.media,
  });
}

export function resolvePublicMedia(
  media: readonly ClientExperienceResolvedMedia[],
  reference: RuntimeMediaReference,
): ClientExperienceResolvedMedia {
  const resolved = media.find(
    ({ reference: candidate }) => candidate.assetId === reference.assetId,
  );
  if (resolved === undefined) {
    throw new Error(`Validated client media "${reference.assetId}" is missing.`);
  }
  return resolved;
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
