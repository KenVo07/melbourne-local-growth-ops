import {
  composeManagedWebsite,
  createWebsiteModuleRegistry,
  createWebsiteTemplateRegistry,
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

export function generateClientWebsiteSnapshot(
  input: unknown,
  publicDirectory: string,
): ClientWebsiteSnapshot {
  const managedDefinition = createManagedWebsiteDefinition(
    input,
    publicDirectory,
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
    schemaVersion: 1,
    configuration: composition.data.configuration,
    profile: composition.data.profile,
    provenance: composition.data.provenance,
    assetManifest: composition.data.assetManifest,
    assets: composition.data.assets,
    regions: composition.data.regions,
    analyticsMeasurementIds,
    runtimeSecretBindings: runtimeSecretBindings(composition.data.configuration),
  }) as ClientWebsiteSnapshot;
}

export function createManagedWebsiteDefinition(
  input: unknown,
  publicDirectory: string,
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

  return {
    configuration: configuration.data,
    profile: profile.data,
    template: definition.template,
    modules: definition.modules,
    assets: {
      clientId: configuration.data.clientId,
      publicDirectory,
      assets: definition.assets,
    },
  };
}

export function parseDefinitionInput(
  input: unknown,
): ClientWebsiteDefinitionInput {
  if (
    !isRecord(input) ||
    input.schemaVersion !== 1 ||
    !isRecord(input.template) ||
    !Array.isArray(input.modules) ||
    !Array.isArray(input.assets) ||
    !("configuration" in input) ||
    !("profile" in input)
  ) {
    throw new TypeError(
      "Client website input must include schemaVersion 1, configuration, profile, template, modules, and assets.",
    );
  }

  return {
    schemaVersion: 1,
    configuration: input.configuration,
    profile: input.profile,
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
