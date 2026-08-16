import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
  validateClientExperienceReference,
  validateWebsiteConfiguration,
  validateWebsiteProfileContent,
  type ManagedWebsiteDefinition,
} from "@melbourne-local-growth-ops/site-core";
import {
  assertWebsiteProfileTemplateConsistency,
  contractorTemplateV1,
  restaurantTemplateV1,
  retailerTemplateV1,
} from "@melbourne-local-growth-ops/templates";

import { managedWebsiteModuleContracts } from "../module-contracts";
import type {
  ClientRuntimeSecretBinding,
  ClientWebsiteDefinitionInput,
  ClientWebsiteSnapshot,
} from "./types";

const registries = Object.freeze({
  templates: createWebsiteTemplateRegistry([
    contractorTemplateV1,
    restaurantTemplateV1,
    retailerTemplateV1,
  ]),
  modules: createWebsiteModuleRegistry(managedWebsiteModuleContracts),
});

const definitionKeys = new Set([
  "schemaVersion",
  "configuration",
  "profile",
  "template",
  "modules",
  "assets",
  "experience",
  "pageGraph",
  "projects",
  "clientExperience",
  "foundationSearch",
]);

export interface GenerateClientWebsiteOptions {
  /**
   * Contents of `<input-directory>/experience/manifest.json`, already read from
   * disk by the caller. Required for a schemaVersion 2 definition and rejected
   * for a legacy one. The pure generator never resolves a filesystem path, so
   * configuration cannot select an arbitrary manifest location.
   */
  readonly clientExperienceManifest?: unknown;
}

export function generateClientWebsiteSnapshot(
  input: unknown,
  publicDirectory: string,
  options: GenerateClientWebsiteOptions = {},
): ClientWebsiteSnapshot {
  const managedDefinition = createManagedWebsiteDefinition(
    input,
    publicDirectory,
    options,
  );
  const composition = composeManagedWebsite(managedDefinition, registries);
  if (!composition.success) {
    throw new Error(formatValidationFailure(composition.issues));
  }
  if (composition.data.profile === undefined) {
    throw new Error("Managed website composition requires validated profile content.");
  }

  const analyticsMeasurementIds = Object.freeze(
    composition.data.regions
      .flatMap(({ modules }) => modules)
      .filter(
        (module) =>
          module.type === "ANALYTICS" &&
          module.connector.type === "GOOGLE_ANALYTICS_4",
      )
      .map((module) =>
        module.connector.type === "GOOGLE_ANALYTICS_4"
          ? module.connector.measurementId
          : "",
      )
      .sort(compareText),
  );

  return deepFreeze({
    schemaVersion: composition.data.schemaVersion,
    renderingMode: composition.data.renderingMode,
    configuration: composition.data.configuration,
    profile: composition.data.profile,
    ...(composition.data.experience === undefined
      ? {}
      : { experience: composition.data.experience }),
    ...(composition.data.pageGraph === undefined
      ? {}
      : { pageGraph: composition.data.pageGraph }),
    ...(composition.data.projects === undefined
      ? {}
      : { projects: composition.data.projects }),
    ...(composition.data.clientExperience === undefined
      ? {}
      : { clientExperience: composition.data.clientExperience }),
    foundationSearch: composition.data.foundationSearch,
    provenance: composition.data.provenance,
    assetManifest: composition.data.assetManifest,
    assets: composition.data.assets,
    regions: composition.data.regions,
    analyticsMeasurementIds,
    runtimeSecretBindings: runtimeSecretBindings(composition.data.configuration),
  });
}

export function createManagedWebsiteDefinition(
  input: unknown,
  publicDirectory: string,
  options: GenerateClientWebsiteOptions = {},
): ManagedWebsiteDefinition {
  const definition = parseDefinitionInput(input);
  const configuration = validateWebsiteConfiguration(definition.configuration);
  if (!configuration.success) {
    throw new Error(formatValidationFailure(configuration.issues));
  }
  const profile = validateWebsiteProfileContent(definition.profile);
  if (!profile.success) {
    throw new Error(formatValidationFailure(profile.issues));
  }
  assertWebsiteProfileTemplateConsistency(profile.data, definition.template);

  const clientExperienceManifest = resolveClientExperienceManifest(
    definition,
    options,
  );

  return {
    schemaVersion: definition.schemaVersion,
    configuration: configuration.data,
    profile: profile.data,
    ...(definition.experience === undefined
      ? {}
      : { experience: definition.experience }),
    ...(definition.pageGraph === undefined
      ? {}
      : { pageGraph: definition.pageGraph }),
    ...(definition.projects === undefined
      ? {}
      : { projects: definition.projects }),
    ...(clientExperienceManifest === undefined
      ? {}
      : { clientExperienceManifest }),
    ...(definition.foundationSearch === undefined
      ? {}
      : { foundationSearch: definition.foundationSearch }),
    template: definition.template,
    modules: definition.modules,
    assets: {
      clientId: configuration.data.clientId,
      publicDirectory,
      assets: definition.assets,
    },
  };
}

/**
 * Binds the definition's fixed manifest *reference* to the manifest *contents*
 * the caller loaded from `<input-directory>/experience/manifest.json`.
 *
 * The reference is validated as data first, so a definition can never name an
 * arbitrary path. Supplying manifest contents without a declared reference, or
 * declaring a reference without supplying contents, is a hard failure rather
 * than a silent downgrade to the legacy shell.
 */
function resolveClientExperienceManifest(
  definition: ClientWebsiteDefinitionInput,
  options: GenerateClientWebsiteOptions,
): unknown {
  if (definition.clientExperience === undefined) {
    if (options.clientExperienceManifest !== undefined) {
      throw new Error(
        "A client experience manifest was supplied, but the client definition declares no clientExperience reference.",
      );
    }
    return undefined;
  }

  const reference = validateClientExperienceReference(
    definition.clientExperience,
  );
  if (!reference.success) {
    throw new Error(formatValidationFailure(reference.issues));
  }
  if (options.clientExperienceManifest === undefined) {
    throw new Error(
      `Client definition references "${reference.data.manifestPath}", but its contents were not supplied. Load the manifest from the client input directory and pass it as clientExperienceManifest.`,
    );
  }
  return options.clientExperienceManifest;
}

export function parseDefinitionInput(
  input: unknown,
): ClientWebsiteDefinitionInput {
  if (isRecord(input)) {
    const unknownKeys = Object.keys(input)
      .filter((key) => !definitionKeys.has(key))
      .sort(compareText);
    if (unknownKeys.length > 0) {
      throw new TypeError(
        `Client website input contains unknown top-level field(s): ${unknownKeys.join(", ")}.`,
      );
    }
  }

  if (
    !isRecord(input) ||
    (input.schemaVersion !== 1 && input.schemaVersion !== 2) ||
    !isRecord(input.template) ||
    !Array.isArray(input.modules) ||
    !Array.isArray(input.assets) ||
    !("configuration" in input) ||
    !("profile" in input)
  ) {
    throw new TypeError(
      "Client website input must include schemaVersion 1 or 2, configuration, profile, template, modules, and assets.",
    );
  }

  const schemaVersion = input.schemaVersion;
  const authoredFields = ["pageGraph", "projects", "clientExperience"] as const;
  const supplied = authoredFields.filter(
    (field) => input[field] !== undefined,
  );

  if (schemaVersion === 1 && supplied.length > 0) {
    throw new TypeError(
      `Legacy client website input uses schemaVersion 1 and cannot contain ${supplied.join(", ")}. Upgrade the complete definition to schemaVersion 2.`,
    );
  }
  if (schemaVersion === 2 && supplied.length !== authoredFields.length) {
    const missing = authoredFields.filter(
      (field) => input[field] === undefined,
    );
    throw new TypeError(
      `Client website input with schemaVersion 2 requires ${authoredFields.join(", ")} together. Missing: ${missing.join(", ")}. Partial authored input cannot fall back to the legacy shell.`,
    );
  }

  return {
    schemaVersion,
    configuration: input.configuration,
    profile: input.profile,
    ...(input.experience === undefined
      ? {}
      : { experience: input.experience }),
    ...(input.pageGraph === undefined ? {} : { pageGraph: input.pageGraph }),
    ...(input.projects === undefined ? {} : { projects: input.projects }),
    ...(input.clientExperience === undefined
      ? {}
      : { clientExperience: input.clientExperience }),
    ...(input.foundationSearch === undefined
      ? {}
      : { foundationSearch: input.foundationSearch }),
    template: input.template as unknown as ClientWebsiteDefinitionInput["template"],
    modules: input.modules as unknown as ClientWebsiteDefinitionInput["modules"],
    assets: input.assets as unknown as ClientWebsiteDefinitionInput["assets"],
  };
}

function runtimeSecretBindings(
  configuration: ClientWebsiteSnapshot["configuration"],
): readonly ClientRuntimeSecretBinding[] {
  const usedConnectorIds = new Set(
    configuration.modules
      .filter((module) => module.type === "LEAD_FORM")
      .map((module) => String(module.connectorId)),
  );
  const emailConnectors = configuration.connectors
    .filter(
      (
        connector,
      ): connector is Extract<
        (typeof configuration.connectors)[number],
        { type: "EMAIL_DELIVERY" }
      > =>
        connector.type === "EMAIL_DELIVERY" &&
        usedConnectorIds.has(String(connector.connectorId)),
    )
    .sort((left, right) =>
      compareText(String(left.connectorId), String(right.connectorId)),
    );

  return Object.freeze(
    emailConnectors.map((connector, index) =>
      Object.freeze({
        connectorId: String(connector.connectorId),
        secretReferenceId: String(connector.secretReferenceId),
        environmentVariable: `MLGO_RESEND_API_KEY_${String(index + 1).padStart(2, "0")}`,
      }),
    ),
  );
}

function formatValidationFailure(
  issues: readonly { readonly path: readonly (string | number)[]; readonly message: string }[],
): string {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
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
