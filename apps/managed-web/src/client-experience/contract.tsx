import type { ComponentType, ReactNode } from "react";
import type {
  RuntimeMediaReference,
  RuntimePageDefinition,
  RuntimePageGraph,
  RuntimeProject,
  RuntimeProjectCollection,
  RuntimeWebsiteProfileContent,
} from "../runtime-types";

/**
 * Public, non-secret identity exposed to trusted authored client experience
 * code. Do not add connector secrets, environment bindings, recipient addresses,
 * internal entitlement state, or agency-only operational data to this type.
 */
export interface ClientExperienceSiteIdentity {
  readonly clientId: string;
  readonly businessName: string;
  readonly tagline?: string;
  readonly canonicalHostname?: string;
}

export interface ClientExperienceResolvedMedia {
  readonly reference: RuntimeMediaReference;
  readonly src: string;
  readonly width: number;
  readonly height: number;
  readonly mediaType: string;
}

export interface ClientExperienceLinkProps {
  readonly href: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly prefetch?: boolean;
  readonly "aria-label"?: string;
}

/**
 * Authored source passes the client-owned media *reference* it already holds
 * (a project hero, a story block image). The Kernel resolves it against the
 * validated asset manifest, so client code never names a file path or URL.
 *
 * `sizes` is required because only the authored layout knows what the image
 * actually occupies.
 */
export interface ClientExperienceImageProps {
  readonly reference: RuntimeMediaReference;
  readonly className?: string;
  readonly sizes: string;
  readonly priority?: boolean;
}

export interface ClientExperienceRegionProps {
  readonly regionId: string;
  readonly className?: string;
}

/**
 * Renders one external action the validated profile already declares, by its
 * stable action ID. Client source cannot supply an arbitrary URL, and the
 * truthful NOT_CONFIGURED state is preserved rather than hidden.
 */
export interface ClientExperienceActionProps {
  readonly actionId: string;
  readonly className?: string;
}

export interface ClientExperiencePlatformComponents {
  readonly Link: ComponentType<ClientExperienceLinkProps>;
  readonly Image: ComponentType<ClientExperienceImageProps>;
  readonly Region: ComponentType<ClientExperienceRegionProps>;
  readonly Action: ComponentType<ClientExperienceActionProps>;
}

export interface ClientExperienceRouteProps {
  readonly site: ClientExperienceSiteIdentity;
  readonly page: RuntimePageDefinition;
  readonly pageGraph: RuntimePageGraph;
  readonly profile: RuntimeWebsiteProfileContent;
  readonly projects: RuntimeProjectCollection;
  readonly project?: RuntimeProject;
  readonly media: readonly ClientExperienceResolvedMedia[];
  readonly platform: ClientExperiencePlatformComponents;
}

export type ClientExperienceRouteComponent = ComponentType<
  ClientExperienceRouteProps
>;

export interface ClientExperienceSignatureProps {
  readonly site: ClientExperienceSiteIdentity;
  readonly page: RuntimePageDefinition;
  readonly profile: RuntimeWebsiteProfileContent;
  readonly projects: RuntimeProjectCollection;
  readonly media: readonly ClientExperienceResolvedMedia[];
  readonly platform: ClientExperiencePlatformComponents;
}

export type ClientExperienceSignatureComponent = ComponentType<
  ClientExperienceSignatureProps
>;

export interface ClientExperienceDefinition {
  readonly schemaVersion: 1;
  readonly experienceId: string;
  readonly experienceVersion: string;
  readonly routes: Readonly<Record<string, ClientExperienceRouteComponent>>;
  readonly signatures?: Readonly<
    Record<string, ClientExperienceSignatureComponent>
  >;
}

/**
 * Type-level boundary for trusted authored client source. This is intentionally
 * not a runtime plugin loader and it does not accept HTML/CSS/JavaScript strings
 * from configuration. The source is compiled, reviewed and copied into the
 * standalone client artifact.
 */
export function defineClientExperience<
  const Definition extends ClientExperienceDefinition,
>(definition: Definition): Definition {
  return Object.freeze({
    ...definition,
    routes: Object.freeze({ ...definition.routes }),
    ...(definition.signatures === undefined
      ? {}
      : { signatures: Object.freeze({ ...definition.signatures }) }),
  }) as Definition;
}
