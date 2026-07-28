import { validateWebsiteRuntimeConfig } from "@melbourne-local-growth-ops/contracts";
import type {
  InfrastructureKind,
  ModuleId,
  Portability,
  ValidationResult,
  WebsiteModule,
  WebsiteRuntimeConfig,
} from "@melbourne-local-growth-ops/contracts";
import { createTemplateProvenanceMismatchError } from "./template-registry.js";
import type {
  WebsiteTemplateReference,
  WebsiteTemplateRegistry,
} from "./template-registry.js";

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
}

export interface WebsiteTemplate {
  readonly templateId: string;
  readonly version: string;
  compose(
    configuration: ValidatedWebsiteConfiguration,
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

  const composition = template.compose(configuration.data);

  if (
    composition.templateId !== template.templateId ||
    composition.templateVersion !== template.version
  ) {
    throw createTemplateProvenanceMismatchError(template, composition);
  }

  return {
    success: true,
    data: composition,
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
  createWebsiteTemplateRegistry,
  WebsiteTemplatePipelineError,
} from "./template-registry.js";
export type {
  WebsiteTemplatePipelineErrorCode,
  WebsiteTemplateReference,
  WebsiteTemplateRegistry,
} from "./template-registry.js";
