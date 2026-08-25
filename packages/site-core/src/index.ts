import { validateWebsiteRuntimeConfig } from "@melbourne-local-growth-ops/contracts";
import type {
  InfrastructureKind,
  ModuleId,
  Portability,
  ValidationResult,
  WebsiteModule,
  WebsiteRuntimeConfig,
} from "@melbourne-local-growth-ops/contracts";
import { composeValidatedWebsite } from "./composition.js";
import type {
  WebsiteTemplateReference,
  WebsiteTemplateRegistry,
} from "./template-registry.js";
import type {
  ResolvedWebsiteImage,
  WebsiteTemplateAssetContext,
} from "./asset-composition.js";

/**
 * This alias deliberately reuses the TSK-45 runtime model. Site core must not
 * introduce a second website configuration schema.
 */
export type ValidatedWebsiteConfiguration = WebsiteRuntimeConfig;

export function validateWebsiteConfiguration(
  input: unknown,
): ValidationResult<ValidatedWebsiteConfiguration> {
  return validateWebsiteRuntimeConfig(input);
}

export interface WebsiteCompositionRegion {
  readonly regionId: string;
  readonly moduleIds: readonly ModuleId[];
}

export interface WebsiteComposition {
  readonly templateId: string;
  readonly templateVersion: string;
  readonly regions: readonly WebsiteCompositionRegion[];
  readonly assets?: readonly ResolvedWebsiteImage[];
}

export interface WebsiteTemplate {
  readonly templateId: string;
  readonly version: string;
  compose(
    configuration: ValidatedWebsiteConfiguration,
    assets?: WebsiteTemplateAssetContext,
  ): WebsiteComposition;
}

/**
 * Composes through an explicit template after validating unknown configuration.
 * Registry orchestration resolves a stable template reference before reusing
 * this boundary.
 */
export function composeWebsite(
  input: unknown,
  template: WebsiteTemplate,
): ValidationResult<WebsiteComposition> {
  const configuration = validateWebsiteConfiguration(input);

  if (!configuration.success) {
    return configuration;
  }

  return {
    success: true,
    data: composeValidatedWebsite(configuration.data, template),
  };
}

/**
 * Resolves one exact template ID/version pair and composes through the same
 * validation and provenance boundary as direct template composition.
 */
export function composeWebsiteFromRegistry(
  input: unknown,
  reference: WebsiteTemplateReference,
  registry: WebsiteTemplateRegistry,
): ValidationResult<WebsiteComposition> {
  return composeWebsite(input, registry.resolve(reference));
}

export type WebsiteModuleType = WebsiteModule["type"];

export type {
  AssetManifest,
  AssetManifestSource,
  ImageAssetManifestEntry,
  ResolvedWebsiteImage,
  WebsiteImageSelection,
  WebsiteTemplateAssetContext,
} from "./asset-composition.js";

export interface WebsiteModuleContract {
  readonly type: WebsiteModuleType;
  readonly version: string;
  readonly executionBoundary: "RENDER_ONLY" | "SERVER_HANDLER" | "HYBRID";
  readonly dependencies: readonly InfrastructureKind[];
  readonly portability: Portability;
  readonly analyticsEvents: readonly string[];
  readonly fallback: {
    readonly strategy: "HIDE" | "STATIC" | "ERROR";
    readonly description: string;
  };
}

export {
  composeManagedWebsite,
} from "./managed-composition.js";
export type {
  ManagedWebsiteComposition,
  ManagedWebsiteCompositionProvenance,
  ManagedWebsiteCompositionRegion,
  ManagedWebsiteDefinition,
  ManagedWebsiteRegistries,
  ResolvedWebsiteModule,
  WebsiteModuleProvenance,
} from "./managed-composition.js";
export {
  ContractorProfileContentSchema,
  RestaurantProfileContentSchema,
  RetailerProfileContentSchema,
  WebsiteArchetypeSchema,
  WebsiteBrandSchema,
  WebsiteCatalogueItemSchema,
  WebsiteExternalActionKindSchema,
  WebsiteExternalActionSchema,
  WebsiteLocationSchema,
  WebsiteMenuCategorySchema,
  WebsiteMenuItemSchema,
  WebsitePolicySchema,
  WebsiteProfileContentSchema,
  WebsiteProfileSchema,
  WebsiteProfileSectionSchema,
  WebsiteServiceCommercialFactSchema,
  WebsiteServiceDecisionSchema,
  WebsiteServiceGroupSchema,
  WebsiteServiceItemSchema,
  WebsiteTestimonialSchema,
  featuredServices,
  groupedServices,
  serviceItemById,
  serviceSections,
  stableServiceIds,
  validateWebsiteProfileContent,
} from "./profile-content.js";
export type {
  WebsiteArchetype,
  WebsiteBrand,
  WebsiteExternalAction,
  WebsiteGroupedServices,
  WebsiteProfile,
  WebsiteProfileContent,
  WebsiteProfileSection,
  WebsiteServiceCommercialFact,
  WebsiteServiceDecision,
  WebsiteServiceGroup,
  WebsiteServiceItem,
  WebsiteServiceSection,
} from "./profile-content.js";
export {
  SERVICE_DETAIL_ROUTE_THRESHOLD,
  deriveProjectFacets,
  deservesServiceDetailRoute,
  resolveNavigationPlan,
  resolveProjectPresentation,
  resolveServicePresentation,
  serviceDecisionDepth,
} from "./collection-scale.js";
export type {
  CollectionFacet,
  CollectionFacetValue,
  NavigationPlan,
  NavigationSectionMode,
  ProjectPresentationMode,
  ProjectPresentationPlan,
  ProjectRetrieval,
  ServicePresentationMode,
  ServicePresentationPlan,
} from "./collection-scale.js";
export {
  WebsiteDesignDnaSchema,
  WebsiteExperiencePaletteSchema,
  WebsiteExperienceSchema,
  WebsiteSignatureReferenceSchema,
  resolveWebsiteExperience,
  validateWebsiteExperience,
} from "./experience.js";
export type {
  ResolvedWebsiteExperience,
  WebsiteDesignDna,
  WebsiteExperience,
  WebsiteExperienceSource,
  WebsiteSignatureReference,
} from "./experience.js";
export {
  ClientDesignDnaSchema,
  validateClientDesignDna,
} from "./client-design-dna.js";
export type { ClientDesignDna } from "./client-design-dna.js";
export {
  ClientExperienceReferenceSchema,
  validateClientExperienceReference,
} from "./client-experience-reference.js";
export type { ClientExperienceReference } from "./client-experience-reference.js";
export {
  WebsiteNavigationItemSchema,
  WebsiteNavigationTargetSchema,
  WebsitePageAnchorSchema,
  WebsitePageContentReferenceSchema,
  WebsitePageDefinitionSchema,
  WebsitePageGraphSchema,
  WebsitePageKindSchema,
  WebsitePageMetadataSchema,
  WebsitePageSearchSchema,
  WebsiteRoutePathSchema,
  navigationHref,
  resolveWebsitePageById,
  resolveWebsitePageByPath,
  routeSegments,
  staticRouteParams,
  validateWebsitePageGraph,
} from "./page-graph.js";
export type {
  WebsiteNavigationItem,
  WebsiteNavigationTarget,
  WebsitePageContentReference,
  WebsitePageDefinition,
  WebsitePageGraph,
  WebsitePageKind,
  WebsiteRoutePath,
} from "./page-graph.js";
export {
  WebsiteMediaAspectSchema,
  WebsiteMediaFitSchema,
  WebsiteMediaFocalPointSchema,
  WebsiteMediaPresentationSchema,
  WebsiteMediaReferenceSchema,
  WebsiteMediaRoleSchema,
  WebsiteMediaViewportOverrideSchema,
  mediaObjectPosition,
  validateWebsiteMediaReference,
} from "./media-reference.js";
export type {
  WebsiteMediaAspect,
  WebsiteMediaFit,
  WebsiteMediaFocalPoint,
  WebsiteMediaPresentation,
  WebsiteMediaReference,
  WebsiteMediaRole,
  WebsiteMediaViewportOverride,
} from "./media-reference.js";
export {
  WebsiteProjectCollectionSchema,
  WebsiteProjectFactSchema,
  WebsiteProjectSchema,
  WebsiteProjectStoryBlockSchema,
  WebsiteProjectStoryBlockTypeSchema,
  WebsiteProjectTruthModeSchema,
  featuredProjects,
  projectById,
  projectBySlug,
  projectsForService,
  validateWebsiteProjectCollection,
} from "./project-content.js";
export type {
  WebsiteProject,
  WebsiteProjectCollection,
  WebsiteProjectStoryBlock,
  WebsiteProjectTruthMode,
} from "./project-content.js";
export {
  ClientExperienceDependencySchema,
  ClientExperienceManifestSchema,
  ClientExperienceRuntimeSchema,
  validateClientExperienceManifest,
  validateClientExperienceManifestForPageGraph,
} from "./client-experience-manifest.js";
export type {
  ClientExperienceDependency,
  ClientExperienceManifest,
  ClientExperienceRuntime,
} from "./client-experience-manifest.js";
export { validateWebsiteV2Model } from "./website-v2-model.js";
export type {
  ValidatedWebsiteV2Model,
  WebsiteRenderingMode,
  WebsiteV2Input,
} from "./website-v2-model.js";
export { buildWebsiteRouteMetadataModel } from "./route-metadata-model.js";
export type {
  WebsiteRouteMetadataModel,
  WebsiteRouteMetadataSiteIdentity,
} from "./route-metadata-model.js";
export { projectPageGraphSearchRecords } from "./page-graph-search.js";
export type {
  PageGraphFoundationSearchContext,
  PageGraphFoundationSearchRecord,
} from "./page-graph-search.js";
export {
  FOUNDATION_SEARCH_AUTO_MIN_CHARACTERS,
  FOUNDATION_SEARCH_AUTO_MIN_SECTION_COUNT,
  FoundationSearchConfigSchema,
  projectProfileSearchRecords,
  resolveFoundationSearch,
  validateFoundationSearchConfig,
} from "./foundation-search.js";
export type {
  FoundationSearchConfig,
  FoundationSearchContext,
  FoundationSearchRecord,
  FoundationSearchResolutionReason,
  ResolvedFoundationSearch,
} from "./foundation-search.js";
export {
  createWebsiteModuleRegistry,
  WebsiteModulePipelineError,
} from "./module-registry.js";
export type {
  WebsiteModulePipelineErrorCode,
  WebsiteModuleReference,
  WebsiteModuleRegistry,
} from "./module-registry.js";
export {
  createWebsiteTemplateRegistry,
  WebsiteTemplatePipelineError,
} from "./template-registry.js";
export type {
  WebsiteTemplatePipelineErrorCode,
  WebsiteTemplateReference,
  WebsiteTemplateRegistry,
} from "./template-registry.js";
