import {
  createAssetResolver,
  createEmptyAssetManifest,
  generateAssetManifest,
  type AssetManifest,
  type AssetManifestSource,
} from "@melbourne-local-growth-ops/asset-pipeline";
import type {
  InfrastructureKind,
  ModuleId,
  ValidationResult,
  WebsiteConnector,
  WebsiteModule,
  WebsiteConfigurationId,
} from "@melbourne-local-growth-ops/contracts";

import { createWebsiteTemplateAssetContext } from "./asset-composition.js";
import { composeValidatedWebsite } from "./composition.js";
import {
  resolveWebsiteExperience,
  type ResolvedWebsiteExperience,
} from "./experience.js";
import {
  resolveFoundationSearch,
  type ResolvedFoundationSearch,
} from "./foundation-search.js";
import {
  compareText,
  WebsiteModulePipelineError,
} from "./module-registry.js";
import type {
  WebsiteModuleReference,
  WebsiteModuleRegistry,
} from "./module-registry.js";
import type {
  ValidatedWebsiteConfiguration,
  ResolvedWebsiteImage,
  WebsiteComposition,
  WebsiteModuleContract,
  WebsiteModuleType,
  WebsiteTemplateReference,
  WebsiteTemplateRegistry,
} from "./index.js";
import type { WebsiteProfileContent } from "./profile-content.js";
import { validateWebsiteProfileContent } from "./profile-content.js";
import { validateWebsiteConfiguration } from "./index.js";

export interface ManagedWebsiteDefinition {
  readonly configuration: unknown;
  readonly profile?: unknown;
  readonly experience?: unknown;
  readonly foundationSearch?: unknown;
  readonly template: WebsiteTemplateReference;
  readonly modules: readonly WebsiteModuleReference[];
  readonly assets?: AssetManifestSource;
}

export interface ManagedWebsiteRegistries {
  readonly templates: WebsiteTemplateRegistry;
  readonly modules: WebsiteModuleRegistry;
}

export interface WebsiteModuleProvenance {
  readonly moduleId: ModuleId;
  readonly type: WebsiteModuleType;
  readonly moduleVersion: string;
}

export interface ResolvedWebsiteModule extends WebsiteModuleProvenance {
  readonly configuration: WebsiteModule;
  readonly connector: WebsiteConnector;
  readonly contract: WebsiteModuleContract;
}

export interface ManagedWebsiteCompositionRegion {
  readonly regionId: string;
  readonly modules: readonly ResolvedWebsiteModule[];
}

export interface ManagedWebsiteCompositionProvenance {
  readonly configurationId: WebsiteConfigurationId;
  readonly configurationVersion: number;
  readonly template: WebsiteTemplateReference;
  readonly modules: readonly WebsiteModuleProvenance[];
  readonly experience?: Readonly<{
    experienceId: string;
    experienceVersion: string;
    source: "EXPLICIT" | "LEGACY_PROFILE_DEFAULT";
  }>;
  readonly foundationSearch: Readonly<{
    mode: "OFF" | "AUTO" | "ON";
    enabled: boolean;
  }>;
}

export interface ManagedWebsiteComposition {
  readonly configuration: ValidatedWebsiteConfiguration;
  readonly profile?: WebsiteProfileContent;
  readonly experience?: ResolvedWebsiteExperience;
  readonly foundationSearch: ResolvedFoundationSearch;
  readonly assetManifest: AssetManifest;
  readonly assets: readonly ResolvedWebsiteImage[];
  readonly template: WebsiteComposition;
  readonly regions: readonly ManagedWebsiteCompositionRegion[];
  readonly provenance: ManagedWebsiteCompositionProvenance;
}

export function composeManagedWebsite(
  definition: ManagedWebsiteDefinition,
  registries: ManagedWebsiteRegistries,
): ValidationResult<ManagedWebsiteComposition> {
  const validation = validateWebsiteConfiguration(definition.configuration);
  if (!validation.success) {
    return validation;
  }

  const profileValidation = definition.profile === undefined
    ? undefined
    : validateWebsiteProfileContent(definition.profile);
  if (profileValidation !== undefined && !profileValidation.success) {
    return profileValidation;
  }

  const experienceValidation = resolveWebsiteExperience(
    definition.experience,
    profileValidation?.data,
  );
  if (!experienceValidation.success) {
    return experienceValidation;
  }

  const foundationSearchValidation = resolveFoundationSearch(
    definition.foundationSearch,
    profileValidation?.data === undefined
      ? undefined
      : {
          businessName: validation.data.display.businessName,
          profile: profileValidation.data,
        },
  );
  if (!foundationSearchValidation.success) {
    return foundationSearchValidation;
  }

  const configuration = deepFreeze(validation.data);
  const profile = profileValidation?.data;
  const experience = experienceValidation.data;
  const foundationSearch = foundationSearchValidation.data;
  const assetManifest =
    definition.assets === undefined
      ? createEmptyAssetManifest(configuration.clientId)
      : generateAssetManifest(definition.assets);
  const assetResolver = createAssetResolver(
    assetManifest,
    configuration.clientId,
  );
  const assetContext = createWebsiteTemplateAssetContext(assetResolver);
  const selections = validateSelections(configuration, definition.modules);
  const resolvedById = resolveModules(
    configuration,
    selections,
    registries.modules,
  );
  const template = registries.templates.resolve(definition.template);
  const templateComposition = composeValidatedWebsite(
    configuration,
    template,
    assetContext,
  );
  const assets = Object.freeze([...(templateComposition.assets ?? [])]);
  const regions = resolveRegions(templateComposition, resolvedById);
  const orderedModules = regions.flatMap((region) => region.modules);

  return {
    success: true,
    data: Object.freeze({
      configuration,
      ...(profile === undefined ? {} : { profile }),
      ...(experience === undefined ? {} : { experience }),
      foundationSearch,
      assetManifest,
      assets,
      template: templateComposition,
      regions,
      provenance: Object.freeze({
        configurationId: configuration.configurationId,
        configurationVersion: configuration.configurationVersion,
        template: Object.freeze({
          templateId: templateComposition.templateId,
          templateVersion: templateComposition.templateVersion,
        }),
        modules: Object.freeze(
          orderedModules.map(({ moduleId, type, moduleVersion }) =>
            Object.freeze({ moduleId, type, moduleVersion }),
          ),
        ),
        ...(experience === undefined
          ? {}
          : {
              experience: Object.freeze({
                experienceId: experience.experienceId,
                experienceVersion: experience.experienceVersion,
                source: experience.source,
              }),
            }),
        foundationSearch: Object.freeze({
          mode: foundationSearch.mode,
          enabled: foundationSearch.enabled,
        }),
      }),
    }),
  };
}

function validateSelections(
  configuration: ValidatedWebsiteConfiguration,
  references: readonly WebsiteModuleReference[],
): ReadonlyMap<WebsiteModuleType, WebsiteModuleReference> {
  const selections = new Map<WebsiteModuleType, WebsiteModuleReference>();

  for (const reference of references) {
    if (selections.has(reference.type)) {
      throw new WebsiteModulePipelineError({
        code: "DUPLICATE_MODULE_SELECTION",
        type: reference.type,
        moduleVersion: reference.moduleVersion,
      });
    }

    selections.set(reference.type, Object.freeze({ ...reference }));
  }

  const enabledTypes = new Set(
    configuration.modules.map(({ type }) => type),
  );
  const missing = [...enabledTypes]
    .filter((type) => !selections.has(type))
    .sort(compareText);
  if (missing[0] !== undefined) {
    throw new WebsiteModulePipelineError({
      code: "MISSING_MODULE_SELECTION",
      type: missing[0],
    });
  }

  const unexpected = [...selections.keys()]
    .filter((type) => !enabledTypes.has(type))
    .sort(compareText);
  if (unexpected[0] !== undefined) {
    const reference = selections.get(unexpected[0]);
    if (reference === undefined) {
      throw new Error("Selected module type is missing its reference.");
    }
    throw new WebsiteModulePipelineError({
      code: "UNEXPECTED_MODULE_SELECTION",
      type: unexpected[0],
      moduleVersion: reference.moduleVersion,
    });
  }

  return selections;
}

function resolveModules(
  configuration: ValidatedWebsiteConfiguration,
  selections: ReadonlyMap<WebsiteModuleType, WebsiteModuleReference>,
  registry: WebsiteModuleRegistry,
): ReadonlyMap<ModuleId, ResolvedWebsiteModule> {
  const connectors = new Map(
    configuration.connectors.map((connector) => [
      connector.connectorId,
      connector,
    ]),
  );
  const configuredInfrastructure = new Set(
    configuration.configuredInfrastructure.map(({ kind }) => kind),
  );
  const resolved = new Map<ModuleId, ResolvedWebsiteModule>();

  for (const module of configuration.modules) {
    const reference = selections.get(module.type);
    if (reference === undefined) {
      throw new WebsiteModulePipelineError({
        code: "MISSING_MODULE_SELECTION",
        type: module.type,
        moduleId: module.moduleId,
      });
    }

    const contract = registry.resolve(reference);
    const expectedDependencies = normalizedDependencies(contract.dependencies);
    const actualDependencies = normalizedDependencies(
      module.infrastructureDependencies ?? [],
    );

    if (!sameDependencies(expectedDependencies, actualDependencies)) {
      throw new WebsiteModulePipelineError({
        code: "MODULE_DEPENDENCY_MISMATCH",
        type: module.type,
        moduleVersion: reference.moduleVersion,
        moduleId: module.moduleId,
        expectedDependencies,
        actualDependencies,
      });
    }

    const unsatisfied = expectedDependencies.filter(
      (dependency) => !configuredInfrastructure.has(dependency),
    );
    if (unsatisfied.length > 0) {
      throw new WebsiteModulePipelineError({
        code: "UNSATISFIED_MODULE_DEPENDENCY",
        type: module.type,
        moduleVersion: reference.moduleVersion,
        moduleId: module.moduleId,
        expectedDependencies,
        actualDependencies: [...configuredInfrastructure].sort(compareText),
      });
    }

    const connector = connectors.get(module.connectorId);
    if (connector === undefined) {
      throw new Error(
        `Validated module "${module.moduleId}" has no connector.`,
      );
    }

    resolved.set(
      module.moduleId,
      Object.freeze({
        moduleId: module.moduleId,
        type: module.type,
        moduleVersion: reference.moduleVersion,
        configuration: module,
        connector,
        contract,
      }),
    );
  }

  return resolved;
}

function resolveRegions(
  composition: WebsiteComposition,
  resolvedById: ReadonlyMap<ModuleId, ResolvedWebsiteModule>,
): readonly ManagedWebsiteCompositionRegion[] {
  const regionIds = new Set<string>();
  const placedModuleIds = new Set<ModuleId>();
  const regions: ManagedWebsiteCompositionRegion[] = [];

  for (const region of composition.regions) {
    if (regionIds.has(region.regionId)) {
      throw new WebsiteModulePipelineError({
        code: "DUPLICATE_COMPOSITION_REGION",
        regionId: region.regionId,
      });
    }
    regionIds.add(region.regionId);

    const modules = region.moduleIds.map((moduleId) => {
      const resolved = resolvedById.get(moduleId);
      if (resolved === undefined) {
        throw new WebsiteModulePipelineError({
          code: "UNKNOWN_COMPOSITION_MODULE",
          moduleId,
          regionId: region.regionId,
        });
      }
      if (placedModuleIds.has(moduleId)) {
        throw new WebsiteModulePipelineError({
          code: "DUPLICATE_COMPOSITION_MODULE",
          moduleId,
          regionId: region.regionId,
        });
      }

      placedModuleIds.add(moduleId);
      return resolved;
    });
    regions.push(
      Object.freeze({
        regionId: region.regionId,
        modules: Object.freeze(modules),
      }),
    );
  }

  const unplaced = [...resolvedById.keys()]
    .filter((moduleId) => !placedModuleIds.has(moduleId))
    .sort(compareText);
  if (unplaced[0] !== undefined) {
    throw new WebsiteModulePipelineError({
      code: "UNPLACED_CONFIGURATION_MODULE",
      moduleId: unplaced[0],
    });
  }

  return Object.freeze(regions);
}

function normalizedDependencies(
  dependencies: readonly InfrastructureKind[],
): InfrastructureKind[] {
  return [...new Set(dependencies)].sort(compareText);
}

function sameDependencies(
  left: readonly InfrastructureKind[],
  right: readonly InfrastructureKind[],
): boolean {
  return (
    left.length === right.length &&
    left.every((dependency, index) => dependency === right[index])
  );
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return Object.freeze(value);
}
