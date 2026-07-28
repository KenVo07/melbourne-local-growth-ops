import { validateWebsiteRuntimeConfig } from "@melbourne-local-growth-ops/contracts";
import type {
  InfrastructureKind,
  ModuleId,
  Portability,
  ValidationResult,
  WebsiteModule,
  WebsiteRuntimeConfig,
} from "@melbourne-local-growth-ops/contracts";

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
