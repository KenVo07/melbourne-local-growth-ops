import type {
  AssetManifest,
  ImageAssetManifestEntry,
  PortableImageAssetReference,
} from "@melbourne-local-growth-ops/asset-pipeline";
import type {
  ClientExperienceManifest,
  ManagedWebsiteCompositionRegion,
  ManagedWebsiteCompositionProvenance,
  ResolvedFoundationSearch,
  ResolvedWebsiteExperience,
  ValidatedWebsiteConfiguration,
  WebsiteModuleReference,
  WebsitePageGraph,
  WebsiteProfileContent,
  WebsiteProjectCollection,
  WebsiteRenderingMode,
  WebsiteTemplateReference,
} from "@melbourne-local-growth-ops/site-core";

export interface ClientWebsiteDefinitionInput {
  /**
   * 1 selects the legacy one-page definition. 2 selects the authored Page Graph
   * model and requires `pageGraph`, `projects` and `clientExperience` together.
   */
  readonly schemaVersion: 1 | 2;
  readonly configuration: unknown;
  readonly profile: unknown;
  /** v1 finite visual preset. Legacy/provenance path only. */
  readonly experience?: unknown;
  readonly pageGraph?: unknown;
  readonly projects?: unknown;
  /**
   * Non-executable reference to the fixed `experience/manifest.json` path. The
   * definition never carries manifest contents, source bytes or an arbitrary
   * path; the assembler loads the manifest from the client input directory.
   */
  readonly clientExperience?: unknown;
  readonly foundationSearch?: unknown;
  readonly template: WebsiteTemplateReference;
  readonly modules: readonly WebsiteModuleReference[];
  readonly assets: readonly PortableImageAssetReference[];
}

export interface ClientRuntimeSecretBinding {
  readonly connectorId: string;
  readonly secretReferenceId: string;
  readonly environmentVariable: string;
}

export interface ClientWebsiteSnapshot {
  readonly schemaVersion: 1 | 2;
  /**
   * Exactly one rendering path is selected by validation. `LEGACY_SHELL` keeps
   * the existing one-page `ManagedWebsiteShell`; `AUTHORED_CLIENT_EXPERIENCE`
   * renders the validated Page Graph through the authored route registry.
   */
  readonly renderingMode: WebsiteRenderingMode;
  readonly configuration: ValidatedWebsiteConfiguration;
  readonly profile: WebsiteProfileContent;
  readonly experience?: ResolvedWebsiteExperience;
  readonly pageGraph?: WebsitePageGraph;
  readonly projects?: WebsiteProjectCollection;
  readonly clientExperience?: ClientExperienceManifest;
  readonly foundationSearch: ResolvedFoundationSearch;
  readonly provenance: ManagedWebsiteCompositionProvenance;
  readonly assetManifest: AssetManifest;
  readonly assets: readonly {
    readonly slotId: string;
    readonly asset: ImageAssetManifestEntry;
    readonly alt: string;
    readonly sizes: string;
    readonly priority: boolean;
  }[];
  readonly regions: readonly ManagedWebsiteCompositionRegion[];
  readonly analyticsMeasurementIds: readonly string[];
  readonly runtimeSecretBindings: readonly ClientRuntimeSecretBinding[];
}

export interface AssembleClientSourceArtifactOptions {
  readonly definition: unknown;
  readonly publicDirectory: string;
  readonly outputDirectory: string;
  readonly factoryRevision: string;
}

export type HandoffArtifactCategory =
  | "SOURCE"
  | "ASSET"
  | "CONFIGURATION"
  | "VENDORED_RUNTIME"
  | "TEST"
  | "PACKAGE";

export interface ClientArtifactDescriptor {
  readonly schemaVersion: 1;
  readonly kind: "MANAGED_WEBSITE_SOURCE";
  readonly artifactId: string;
  readonly clientId: string;
  readonly repositoryName: string;
  readonly sourceDirectory: "source";
  readonly factoryRevision: string;
  readonly configuration: {
    readonly configurationId: string;
    readonly configurationVersion: number;
    readonly deploymentId: string;
  };
  readonly buildVerification: {
    readonly outputPolicy: "TEMPORARY_ONLY";
    readonly nodeVersion: "24.18.0";
    readonly packageManager: "pnpm@11.9.0";
    readonly commands: readonly [
      "pnpm install --frozen-lockfile --ignore-scripts",
      "pnpm typecheck",
      "pnpm build",
      "pnpm test",
    ];
  };
  readonly handoff: {
    readonly artifacts: readonly {
      readonly path: string;
      readonly category: HandoffArtifactCategory;
      readonly clientId: string;
      readonly size: number;
      readonly sha256: string;
      readonly provenance: {
        readonly origin:
          | "GENERATED"
          | "CLIENT_ASSET"
          | "TRANSFORMED_FACTORY_RUNTIME";
        readonly version: string;
      };
    }[];
    readonly artifactAllowlist: readonly string[];
    readonly moduleSelections: readonly {
      readonly moduleId: string;
      readonly type: "LEAD_FORM" | "BOOKING_CTA" | "ANALYTICS";
      readonly version: string;
      readonly portability: "TRANSFERABLE" | "CLIENT_OWNED";
    }[];
    readonly connectorSelections: readonly {
      readonly connectorId: string;
      readonly type:
        | "EMAIL_DELIVERY"
        | "BOOKING_LINK"
        | "GOOGLE_ANALYTICS_4";
      readonly version: "1.0.0";
      readonly portability: "TRANSFERABLE" | "CLIENT_OWNED";
    }[];
    readonly publicDependencyAllowlist: readonly string[];
    readonly requiredEnvironmentVariables: readonly {
      readonly name: string;
      readonly description: string;
      readonly required: true;
      readonly owner: "CLIENT";
    }[];
    readonly optionalDataResources: readonly [];
  };
}

export interface AssembledClientSourceArtifact {
  readonly directory: string;
  readonly sourceDirectory: string;
  readonly descriptor: ClientArtifactDescriptor;
}
