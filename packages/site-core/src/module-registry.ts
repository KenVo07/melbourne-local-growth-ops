import type {
  InfrastructureKind,
  ModuleId,
} from "@melbourne-local-growth-ops/contracts";

import type {
  WebsiteModuleContract,
  WebsiteModuleType,
} from "./index.js";

export interface WebsiteModuleReference {
  readonly type: WebsiteModuleType;
  readonly moduleVersion: string;
}

export type WebsiteModulePipelineErrorCode =
  | "DUPLICATE_MODULE_REGISTRATION"
  | "UNKNOWN_MODULE"
  | "UNSUPPORTED_MODULE_VERSION"
  | "DUPLICATE_MODULE_SELECTION"
  | "MISSING_MODULE_SELECTION"
  | "UNEXPECTED_MODULE_SELECTION"
  | "MODULE_DEPENDENCY_MISMATCH"
  | "UNSATISFIED_MODULE_DEPENDENCY"
  | "DUPLICATE_COMPOSITION_REGION"
  | "UNKNOWN_COMPOSITION_MODULE"
  | "DUPLICATE_COMPOSITION_MODULE"
  | "UNPLACED_CONFIGURATION_MODULE";

interface WebsiteModulePipelineErrorDetails {
  readonly code: WebsiteModulePipelineErrorCode;
  readonly type?: WebsiteModuleType;
  readonly moduleVersion?: string;
  readonly availableVersions?: readonly string[];
  readonly moduleId?: ModuleId;
  readonly regionId?: string;
  readonly expectedDependencies?: readonly InfrastructureKind[];
  readonly actualDependencies?: readonly InfrastructureKind[];
}

export class WebsiteModulePipelineError extends Error {
  override readonly name = "WebsiteModulePipelineError";
  readonly code: WebsiteModulePipelineErrorCode;
  readonly type: WebsiteModuleType | undefined;
  readonly moduleVersion: string | undefined;
  readonly availableVersions: readonly string[];
  readonly moduleId: ModuleId | undefined;
  readonly regionId: string | undefined;
  readonly expectedDependencies: readonly InfrastructureKind[];
  readonly actualDependencies: readonly InfrastructureKind[];

  constructor(details: WebsiteModulePipelineErrorDetails) {
    super(modulePipelineErrorMessage(details));
    this.code = details.code;
    this.type = details.type;
    this.moduleVersion = details.moduleVersion;
    this.availableVersions = Object.freeze([
      ...(details.availableVersions ?? []),
    ]);
    this.moduleId = details.moduleId;
    this.regionId = details.regionId;
    this.expectedDependencies = Object.freeze([
      ...(details.expectedDependencies ?? []),
    ]);
    this.actualDependencies = Object.freeze([
      ...(details.actualDependencies ?? []),
    ]);
  }
}

export interface WebsiteModuleRegistry {
  readonly registrations: readonly WebsiteModuleReference[];
  resolve(reference: WebsiteModuleReference): WebsiteModuleContract;
}

interface RegisteredModule extends WebsiteModuleReference {
  readonly contract: WebsiteModuleContract;
}

export function compareText(left: string, right: string): number {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareRegisteredModules(
  left: RegisteredModule,
  right: RegisteredModule,
): number {
  return (
    compareText(left.type, right.type) ||
    compareText(left.moduleVersion, right.moduleVersion)
  );
}

function snapshotContract(
  contract: WebsiteModuleContract,
): WebsiteModuleContract {
  return Object.freeze({
    type: contract.type,
    version: contract.version,
    executionBoundary: contract.executionBoundary,
    dependencies: Object.freeze([...contract.dependencies]),
    portability: contract.portability,
    analyticsEvents: Object.freeze([...contract.analyticsEvents]),
    fallback: Object.freeze({
      strategy: contract.fallback.strategy,
      description: contract.fallback.description,
    }),
  });
}

export function createWebsiteModuleRegistry(
  contracts: readonly WebsiteModuleContract[],
): WebsiteModuleRegistry {
  const registrations = contracts
    .map((contract): RegisteredModule => {
      const snapshot = snapshotContract(contract);
      return {
        type: snapshot.type,
        moduleVersion: snapshot.version,
        contract: snapshot,
      };
    })
    .sort(compareRegisteredModules);
  const contractsByType = new Map<
    WebsiteModuleType,
    Map<string, WebsiteModuleContract>
  >();

  for (const registration of registrations) {
    const versions =
      contractsByType.get(registration.type) ??
      new Map<string, WebsiteModuleContract>();

    if (versions.has(registration.moduleVersion)) {
      throw new WebsiteModulePipelineError({
        code: "DUPLICATE_MODULE_REGISTRATION",
        type: registration.type,
        moduleVersion: registration.moduleVersion,
      });
    }

    versions.set(registration.moduleVersion, registration.contract);
    contractsByType.set(registration.type, versions);
  }

  const publicRegistrations = Object.freeze(
    registrations.map(({ type, moduleVersion }) =>
      Object.freeze({ type, moduleVersion }),
    ),
  );

  return Object.freeze({
    registrations: publicRegistrations,
    resolve(reference: WebsiteModuleReference): WebsiteModuleContract {
      const versions = contractsByType.get(reference.type);
      if (versions === undefined) {
        throw new WebsiteModulePipelineError({
          code: "UNKNOWN_MODULE",
          type: reference.type,
          moduleVersion: reference.moduleVersion,
        });
      }

      const contract = versions.get(reference.moduleVersion);
      if (contract === undefined) {
        throw new WebsiteModulePipelineError({
          code: "UNSUPPORTED_MODULE_VERSION",
          type: reference.type,
          moduleVersion: reference.moduleVersion,
          availableVersions: [...versions.keys()].sort(compareText),
        });
      }

      return contract;
    },
  });
}

function modulePipelineErrorMessage(
  details: WebsiteModulePipelineErrorDetails,
): string {
  const type = String(details.type);
  const version = String(details.moduleVersion);
  const moduleId = String(details.moduleId);

  switch (details.code) {
    case "DUPLICATE_MODULE_REGISTRATION":
      return `Module "${type}" version "${version}" is registered more than once.`;
    case "UNKNOWN_MODULE":
      return `No module contract is registered for type "${type}".`;
    case "UNSUPPORTED_MODULE_VERSION":
      return `Module "${type}" does not support version "${version}". Available versions: ${(details.availableVersions ?? []).join(", ")}.`;
    case "DUPLICATE_MODULE_SELECTION":
      return `Module type "${type}" has more than one version selection.`;
    case "MISSING_MODULE_SELECTION":
      return `Module type "${type}" requires an exact version selection.`;
    case "UNEXPECTED_MODULE_SELECTION":
      return `Module type "${type}" is selected but is not enabled in the configuration.`;
    case "MODULE_DEPENDENCY_MISMATCH":
      return `Module "${moduleId}" dependencies do not match its "${type}" version "${version}" contract.`;
    case "UNSATISFIED_MODULE_DEPENDENCY":
      return `Module "${moduleId}" requires configured infrastructure that is not present.`;
    case "DUPLICATE_COMPOSITION_REGION":
      return `Composition region "${String(details.regionId)}" is declared more than once.`;
    case "UNKNOWN_COMPOSITION_MODULE":
      return `Composition references unknown module "${moduleId}".`;
    case "DUPLICATE_COMPOSITION_MODULE":
      return `Composition places module "${moduleId}" more than once.`;
    case "UNPLACED_CONFIGURATION_MODULE":
      return `Enabled module "${moduleId}" is not placed in the composition.`;
  }
}
