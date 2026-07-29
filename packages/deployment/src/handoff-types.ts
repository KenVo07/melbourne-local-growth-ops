import type {
  AccountOwner,
  ClientId,
  ConnectorId,
  DeploymentId,
  InfrastructureKind,
  ModuleId,
  Portability,
  WebsiteConnector,
  WebsiteConfigurationId,
  WebsiteModule,
} from "@melbourne-local-growth-ops/contracts";

import type { DeploymentManifest } from "./index.js";

export type HandoffArtifactCategory =
  | "SOURCE"
  | "ASSET"
  | "CONFIGURATION"
  | "VENDORED_RUNTIME"
  | "TEST"
  | "PACKAGE";

export interface HandoffArtifactInput {
  readonly path: string;
  readonly content: string | Uint8Array;
  readonly category: HandoffArtifactCategory;
  readonly clientId: string;
  readonly provenance: {
    readonly origin:
      | "GENERATED"
      | "CLIENT_ASSET"
      | "TRANSFORMED_FACTORY_RUNTIME";
    readonly version: string;
  };
}

export interface HandoffModuleSelection {
  readonly moduleId: ModuleId | string;
  readonly type: WebsiteModule["type"];
  readonly version: string;
  readonly portability: Portability;
}

export interface HandoffConnectorSelection {
  readonly connectorId: ConnectorId | string;
  readonly type: WebsiteConnector["type"];
  readonly version: string;
  readonly portability: Portability;
}

export interface RequiredEnvironmentVariable {
  readonly name: string;
  readonly description: string;
  readonly required: boolean;
  readonly owner: "CLIENT";
}

export interface OptionalDataResourceDeclaration {
  readonly kind: InfrastructureKind;
  readonly provider: string;
  readonly dataOwner: "CLIENT";
  readonly backupOwner: "CLIENT";
  readonly restoreOwner: "CLIENT";
  readonly backupProcedure: string;
  readonly restoreProcedure: string;
  readonly verificationProcedure: string;
}

export type OptionalDataRestorePlan =
  | {
      readonly status: "NOT_APPLICABLE";
      readonly reason: "No optional persistent infrastructure is configured";
    }
  | {
      readonly status: "REQUIRED";
      readonly resources: readonly OptionalDataResourceDeclaration[];
    };

export type OptionalDataRestorePlanResult =
  | {
      readonly success: true;
      readonly data: OptionalDataRestorePlan;
    }
  | {
      readonly success: false;
      readonly issues: readonly ClientHandoffIssue[];
    };

export interface ClientHandoffOwnership {
  readonly sourceRepository: AccountOwner;
  readonly hosting: AccountOwner;
  readonly analytics: AccountOwner;
  readonly domains: "CLIENT";
}

export interface ClientHandoffExportInput {
  readonly configuration: unknown;
  readonly deploymentManifest: DeploymentManifest;
  readonly repositoryName: string;
  readonly exportedAt: string;
  readonly ownership: ClientHandoffOwnership;
  readonly artifacts: readonly HandoffArtifactInput[];
  readonly artifactAllowlist: readonly string[];
  readonly moduleSelections: readonly HandoffModuleSelection[];
  readonly connectorSelections: readonly HandoffConnectorSelection[];
  readonly publicDependencyAllowlist: readonly string[];
  readonly requiredEnvironmentVariables:
    readonly RequiredEnvironmentVariable[];
  readonly otherClientIdentifiers: readonly string[];
  readonly optionalDataResources:
    readonly OptionalDataResourceDeclaration[];
}

export interface HandoffFileInventoryRecord {
  readonly path: string;
  readonly category: HandoffArtifactCategory | "GENERATED_HANDOFF";
  readonly size: number;
  readonly sha256: string;
  readonly provenance: {
    readonly origin:
      | "GENERATED"
      | "CLIENT_ASSET"
      | "TRANSFORMED_FACTORY_RUNTIME";
    readonly version: string;
  };
}

export interface ClientHandoffManifest {
  readonly schemaVersion: 1;
  readonly clientId: ClientId;
  readonly deploymentId: DeploymentId;
  readonly configurationId: WebsiteConfigurationId;
  readonly configurationVersion: number;
  readonly repositoryName: string;
  readonly exportedAt: string;
  readonly ownership: {
    readonly sourceRepository: "CLIENT";
    readonly hosting: "CLIENT";
    readonly analytics: "CLIENT";
    readonly domains: "CLIENT";
  };
  readonly domains: readonly {
    readonly hostname: string;
    readonly canonical: boolean;
  }[];
  readonly requiredEnvironmentVariables:
    readonly RequiredEnvironmentVariable[];
  readonly includedFiles: readonly HandoffFileInventoryRecord[];
  readonly includedAssets: readonly HandoffFileInventoryRecord[];
  readonly modules: readonly HandoffModuleSelection[];
  readonly connectors: readonly HandoffConnectorSelection[];
  readonly publicDependencies: readonly {
    readonly name: string;
    readonly version: string;
  }[];
  readonly buildProvenance: {
    readonly applicationVersion: string;
    readonly buildId: string;
    readonly sourceRevision: string;
    readonly generatedAt: string;
  };
  readonly optionalDataRestorePlan: OptionalDataRestorePlan;
  readonly verification: {
    readonly packageManager: "pnpm@11.9.0";
    readonly nodeVersion: "24.18.0";
    readonly integrityAlgorithm: "SHA256";
    readonly manifestDigestPath: "handoff-manifest.sha256";
    readonly verifierPath: "scripts/verify-handoff.mjs";
    readonly commands: readonly [
      "pnpm install --frozen-lockfile --ignore-scripts",
      "pnpm typecheck",
      "pnpm build",
      "pnpm test",
      "pnpm verify:handoff",
    ];
  };
  readonly scans: {
    readonly privateDependencies: "PASSED";
    readonly secrets: "PASSED";
    readonly clientIsolation: "PASSED";
  };
}

export interface ClientHandoffExportFile {
  readonly path: string;
  readonly content: Uint8Array;
  readonly size: number;
  readonly sha256: string;
}

export interface ClientHandoffExport {
  readonly repositoryName: string;
  readonly exportedAt: string;
  readonly manifest: ClientHandoffManifest;
  readonly manifestDigest: string;
  readonly files: readonly ClientHandoffExportFile[];
}

export type ClientHandoffIssueCode =
  | "INVALID_HANDOFF_INPUT"
  | "INVALID_HANDOFF_MANIFEST"
  | "UNSAFE_EXPORT_PATH"
  | "FACTORY_PRIVATE_FILE"
  | "UNALLOWLISTED_ARTIFACT"
  | "MISSING_REQUIRED_ARTIFACT"
  | "DUPLICATE_ARTIFACT"
  | "SECRET_MATERIAL"
  | "PRIVATE_DEPENDENCY"
  | "CLIENT_ISOLATION_VIOLATION"
  | "UNSUPPORTED_PORTABILITY"
  | "MISSING_PORTABILITY_SELECTION"
  | "UNDOCUMENTED_ENVIRONMENT_VARIABLE"
  | "INVALID_PACKAGE_LAYOUT"
  | "MISSING_OPTIONAL_DATA_PLAN"
  | "INTEGRITY_MISMATCH"
  | "UNEXPECTED_EXPORTED_FILE"
  | "MISSING_EXPORTED_FILE"
  | "RECOVERY_VERIFICATION_FAILED"
  | "EXPORT_DIRECTORY_NOT_EMPTY"
  | "EXPORT_IO_FAILED";

export interface ClientHandoffIssue {
  readonly code: ClientHandoffIssueCode;
  readonly path: string;
  readonly message: string;
}

export type ClientHandoffExportResult =
  | {
      readonly success: true;
      readonly export: ClientHandoffExport;
    }
  | {
      readonly success: false;
      readonly issues: readonly ClientHandoffIssue[];
    };

export type ClientHandoffManifestValidationResult =
  | {
      readonly success: true;
      readonly data: ClientHandoffManifest;
    }
  | {
      readonly success: false;
      readonly issues: readonly ClientHandoffIssue[];
    };

export type ClientHandoffVerificationResult =
  | {
      readonly success: true;
      readonly manifest: ClientHandoffManifest;
      readonly checks: {
        readonly integrity: "PASSED";
        readonly portability: "PASSED";
        readonly recovery: "PASSED";
      };
    }
  | {
      readonly success: false;
      readonly issues: readonly ClientHandoffIssue[];
    };

export interface ClientHandoffDirectoryWriteResult {
  readonly success: true;
  readonly directory: string;
  readonly fileCount: number;
  readonly manifestDigest: string;
}

export type ClientHandoffDirectoryResult =
  | ClientHandoffDirectoryWriteResult
  | {
      readonly success: false;
      readonly issues: readonly ClientHandoffIssue[];
    };
