import type {
  RuntimeClientExperienceManifest,
  RuntimePageGraph,
} from "../runtime-types";

import type {
  ClientExperienceDefinition,
  ClientExperienceRouteComponent,
  ClientExperienceSignatureComponent,
} from "./contract";

export type ClientExperienceRegistryErrorCode =
  | "IDENTITY_MISMATCH"
  | "ROUTE_COVERAGE_MISMATCH"
  | "SIGNATURE_COVERAGE_MISMATCH"
  | "UNKNOWN_ROUTE"
  | "UNKNOWN_SIGNATURE";

export class ClientExperienceRegistryError extends Error {
  readonly code: ClientExperienceRegistryErrorCode;
  readonly detail: Readonly<Record<string, unknown>>;

  constructor(
    code: ClientExperienceRegistryErrorCode,
    message: string,
    detail: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "ClientExperienceRegistryError";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

export interface ClientExperienceRegistry {
  readonly experienceId: string;
  readonly experienceVersion: string;
  resolveRoute(routeId: string): ClientExperienceRouteComponent;
  resolveSignature(signatureId: string): ClientExperienceSignatureComponent;
}

export function createClientExperienceRegistry(
  definition: ClientExperienceDefinition,
  manifest: RuntimeClientExperienceManifest,
  pageGraph: RuntimePageGraph,
): ClientExperienceRegistry {
  if (
    definition.experienceId !== manifest.experienceId ||
    definition.experienceVersion !== manifest.experienceVersion
  ) {
    throw new ClientExperienceRegistryError(
      "IDENTITY_MISMATCH",
      "Client experience source identity must match its manifest.",
      {
        definitionId: definition.experienceId,
        definitionVersion: definition.experienceVersion,
        manifestId: manifest.experienceId,
        manifestVersion: manifest.experienceVersion,
      },
    );
  }

  const requiredRouteIds = new Set(
    pageGraph.pages.map(({ experienceRouteId }) => experienceRouteId),
  );
  const definitionRouteIds = Object.keys(definition.routes).sort();
  const missingRoutes = [...requiredRouteIds]
    .filter((id) => definition.routes[id] === undefined)
    .sort();
  const extraRoutes = definitionRouteIds
    .filter((id) => !requiredRouteIds.has(id))
    .sort();
  if (missingRoutes.length > 0 || extraRoutes.length > 0) {
    throw new ClientExperienceRegistryError(
      "ROUTE_COVERAGE_MISMATCH",
      `Client experience route source must exactly cover the page graph. Missing: ${missingRoutes.join(", ") || "none"}; extra: ${extraRoutes.join(", ") || "none"}.`,
      { missingRoutes, extraRoutes },
    );
  }

  const manifestRoutes = [...manifest.routeIds].sort();
  if (!sameStrings(manifestRoutes, definitionRouteIds)) {
    throw new ClientExperienceRegistryError(
      "ROUTE_COVERAGE_MISMATCH",
      "Client experience route source must exactly match manifest route IDs.",
      { manifestRoutes, definitionRouteIds },
    );
  }

  const manifestSignatures = [...manifest.signatureIds].sort();
  const definitionSignatures = Object.keys(definition.signatures ?? {}).sort();
  if (!sameStrings(manifestSignatures, definitionSignatures)) {
    throw new ClientExperienceRegistryError(
      "SIGNATURE_COVERAGE_MISMATCH",
      "Client experience signature source must exactly match manifest signature IDs.",
      { manifestSignatures, definitionSignatures },
    );
  }

  return Object.freeze({
    experienceId: definition.experienceId,
    experienceVersion: definition.experienceVersion,
    resolveRoute(routeId: string): ClientExperienceRouteComponent {
      const route = definition.routes[routeId];
      if (route === undefined) {
        throw new ClientExperienceRegistryError(
          "UNKNOWN_ROUTE",
          `Client experience route "${routeId}" is not registered.`,
          { routeId },
        );
      }
      return route;
    },
    resolveSignature(signatureId: string): ClientExperienceSignatureComponent {
      const signature = definition.signatures?.[signatureId];
      if (signature === undefined) {
        throw new ClientExperienceRegistryError(
          "UNKNOWN_SIGNATURE",
          `Client experience signature "${signatureId}" is not registered.`,
          { signatureId },
        );
      }
      return signature;
    },
  });
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
