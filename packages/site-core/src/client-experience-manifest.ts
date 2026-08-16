import {
  translateZodIssues,
  type ValidationIssue,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

import type { WebsitePageGraph } from "./page-graph.js";

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const semanticVersion = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/);
const packageName = z
  .string()
  .trim()
  .min(1)
  .max(214)
  .regex(/^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/);
const exactPackageVersion = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);

const uniqueIds = z.array(boundedId).max(128).superRefine((ids, context) => {
  const seen = new Set<string>();
  for (const [index, id] of ids.entries()) {
    if (seen.has(id)) {
      context.addIssue({
        code: "custom",
        path: [index],
        message: `ID "${id}" is duplicated.`,
      });
    }
    seen.add(id);
  }
});

export const ClientExperienceDependencySchema = z.strictObject({
  name: packageName,
  version: exactPackageVersion,
});

export const ClientExperienceRuntimeSchema = z.strictObject({
  clientJavaScript: z.enum(["NONE", "ROUTE_SCOPED", "COMPONENT_SCOPED"]),
  motion: z.enum(["NONE", "NATIVE", "CLIENT_LIBRARY"]),
  reducedMotion: z.literal("REQUIRED"),
});

export const ClientExperienceManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  kind: z.literal("AUTHORED_CLIENT_EXPERIENCE"),
  experienceId: boundedId,
  experienceVersion: semanticVersion,
  entrypoint: z.literal("index.tsx"),
  designDnaPath: z.literal("design-dna.json"),
  routeIds: uniqueIds.min(1),
  signatureIds: uniqueIds.default([]),
  publicDependencies: z.array(ClientExperienceDependencySchema).max(16).default([]),
  runtime: ClientExperienceRuntimeSchema,
});

export type ClientExperienceDependency = z.infer<
  typeof ClientExperienceDependencySchema
>;
export type ClientExperienceRuntime = z.infer<
  typeof ClientExperienceRuntimeSchema
>;
export type ClientExperienceManifest = z.infer<
  typeof ClientExperienceManifestSchema
>;

export function validateClientExperienceManifest(
  input: unknown,
): ValidationResult<ClientExperienceManifest> {
  const parsed = ClientExperienceManifestSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: deepFreeze(parsed.data) }
    : { success: false, issues: translateZodIssues(parsed.error.issues) };
}

export function validateClientExperienceManifestForPageGraph(
  input: unknown,
  graph: WebsitePageGraph,
): ValidationResult<ClientExperienceManifest> {
  const validation = validateClientExperienceManifest(input);
  if (!validation.success) return validation;

  const manifest = validation.data;
  const referenced = new Set(
    graph.pages.map(({ experienceRouteId }) => experienceRouteId),
  );
  const declared = new Set(manifest.routeIds);
  const missing = [...referenced].filter((id) => !declared.has(id)).sort();
  const stale = [...declared].filter((id) => !referenced.has(id)).sort();
  const duplicateDependencies = duplicateValues(
    manifest.publicDependencies.map(({ name }) => name),
  );
  const issues: ValidationIssue[] = [];

  if (missing.length > 0 || stale.length > 0) {
    issues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        ["routeIds"],
        `Client experience route coverage must exactly match the page graph. Missing: ${missing.join(", ") || "none"}; unreferenced: ${stale.join(", ") || "none"}.`,
      ),
    );
  }
  for (const dependencyName of duplicateDependencies) {
    issues.push(
      issue(
        "DUPLICATE_IDENTIFIER",
        ["publicDependencies"],
        `Public dependency "${dependencyName}" is declared more than once.`,
      ),
    );
  }
  if (
    manifest.runtime.motion === "CLIENT_LIBRARY" &&
    manifest.publicDependencies.length === 0
  ) {
    issues.push(
      issue(
        "INVALID_INPUT",
        ["runtime", "motion"],
        "CLIENT_LIBRARY motion requires at least one exact public dependency declaration.",
      ),
    );
  }
  if (
    manifest.runtime.clientJavaScript === "NONE" &&
    manifest.runtime.motion === "CLIENT_LIBRARY"
  ) {
    issues.push(
      issue(
        "INVALID_INPUT",
        ["runtime"],
        "A client-library motion experience cannot declare clientJavaScript NONE.",
      ),
    );
  }

  return issues.length === 0
    ? { success: true, data: manifest }
    : { success: false, issues: Object.freeze(issues) };
}

function duplicateValues(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Object.freeze([...duplicates].sort());
}

function issue(
  code: ValidationIssue["code"],
  path: readonly (string | number)[],
  message: string,
): ValidationIssue {
  return Object.freeze({ code, path: Object.freeze([...path]), message });
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
