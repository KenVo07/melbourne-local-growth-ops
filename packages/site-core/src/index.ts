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
