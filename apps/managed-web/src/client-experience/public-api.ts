/**
 * The only module authored client source may import from the Platform.
 * Keep this surface narrow, public and free of private runtime/configuration
 * types. The generated standalone artifact maps the same authoring alias to
 * this local file through tsconfig paths.
 */
export { defineClientExperience } from "./contract";
export type {
  ClientExperienceActionProps,
  ClientExperienceDefinition,
  ClientExperienceMainProps,
  ClientExperienceNotFoundComponent,
  ClientExperienceNotFoundProps,
  ClientExperienceImageProps,
  ClientExperienceLinkProps,
  ClientExperiencePlatformComponents,
  ClientExperienceRegionProps,
  ClientExperienceResolvedMedia,
  ClientExperienceRouteComponent,
  ClientExperienceRouteProps,
  ClientExperienceSearchProps,
  ClientExperienceSkipLinkProps,
  ClientExperienceSignatureComponent,
  ClientExperienceSignatureProps,
  ClientExperienceSiteIdentity,
} from "./contract";
/**
 * Content types come from the portable runtime mirror, never from a workspace
 * package, so a generated client artifact carries no private dependency.
 */
export type {
  RuntimeClientExperienceManifest,
  RuntimeMediaAspect,
  RuntimeMediaFit,
  RuntimeMediaFocalPoint,
  RuntimeMediaPresentation,
  RuntimeMediaReference,
  RuntimeMediaRole,
  RuntimeNavigationItem,
  RuntimeNavigationTarget,
  RuntimePageDefinition,
  RuntimePageGraph,
  RuntimePageKind,
  RuntimeProject,
  RuntimeProjectCollection,
  RuntimeProjectFact,
  RuntimeProjectStoryBlock,
  RuntimeProjectTruthMode,
  RuntimeTitledItem,
  RuntimeWebsiteProfileContent,
  RuntimeProfileSection,
} from "../runtime-types";
export {
  navigationHref,
  pageById,
  pageByPath,
  projectById,
  projectBySlug,
  relatedProjects,
  serviceById,
  siblingProjects,
} from "./content-helpers";
