import type {
  ValidationIssue,
  ValidationResult,
} from "@melbourne-local-growth-ops/contracts";

import {
  validateClientExperienceManifestForPageGraph,
  type ClientExperienceManifest,
} from "./client-experience-manifest.js";
import {
  validateWebsitePageGraph,
  type WebsitePageGraph,
} from "./page-graph.js";
import {
  validateWebsiteProjectCollection,
  type WebsiteProjectCollection,
} from "./project-content.js";
import {
  serviceItemById,
  type WebsiteProfileContent,
} from "./profile-content.js";

export type WebsiteRenderingMode =
  | "LEGACY_SHELL"
  | "AUTHORED_CLIENT_EXPERIENCE";

/**
 * The top-level client-definition schema version is the rendering-model switch.
 * Version 1 remains the accepted legacy one-page definition. Version 2 requires
 * the complete authored Page Graph model. A caller must never infer v2 merely
 * from the presence of one optional field.
 */
export interface WebsiteV2Input {
  readonly schemaVersion: unknown;
  readonly pageGraph?: unknown;
  readonly projects?: unknown;
  readonly clientExperienceManifest?: unknown;
  /**
   * Already-validated Profile Semantics. Required for schemaVersion 2 so
   * SERVICE_DETAIL pages can be bound to stable service IDs rather than to
   * editable display titles.
   */
  readonly profile?: WebsiteProfileContent;
}

export interface ValidatedWebsiteV2Model {
  readonly schemaVersion: 2;
  readonly renderingMode: "AUTHORED_CLIENT_EXPERIENCE";
  readonly pageGraph: WebsitePageGraph;
  readonly projects: WebsiteProjectCollection;
  readonly clientExperienceManifest: ClientExperienceManifest;
}

/**
 * Resolves the explicit top-level rendering model.
 *
 * - schemaVersion 1 selects legacy rendering and rejects v2-only fields;
 * - schemaVersion 2 requires pageGraph, projects and a resolved clientExperienceManifest together;
 * - every other version fails closed.
 */
export function validateWebsiteV2Model(
  input: WebsiteV2Input,
): ValidationResult<ValidatedWebsiteV2Model | undefined> {
  const suppliedV2Fields = [
    input.pageGraph !== undefined,
    input.projects !== undefined,
    input.clientExperienceManifest !== undefined,
  ];

  if (input.schemaVersion === 1) {
    if (suppliedV2Fields.some(Boolean)) {
      return {
        success: false,
        issues: Object.freeze([
          issue(
            "UNSUPPORTED_SCHEMA_VERSION",
            ["schemaVersion"],
            "Legacy client definitions use schemaVersion 1 and cannot contain pageGraph, projects, or clientExperience. Upgrade the complete definition to schemaVersion 2.",
          ),
        ]),
      };
    }
    return { success: true, data: undefined };
  }

  if (input.schemaVersion !== 2) {
    return {
      success: false,
      issues: Object.freeze([
        issue(
          "UNSUPPORTED_SCHEMA_VERSION",
          ["schemaVersion"],
          "Client website definition schemaVersion must be 1 or 2.",
        ),
      ]),
    };
  }

  if (suppliedV2Fields.some((value) => !value)) {
    return {
      success: false,
      issues: Object.freeze([
        issue(
          "INVALID_INPUT",
          [],
          "Client definition schemaVersion 2 requires pageGraph, projects, and a resolved clientExperienceManifest together. Partial v2 input cannot fall back to the legacy shell.",
        ),
      ]),
    };
  }

  const graphValidation = validateWebsitePageGraph(input.pageGraph);
  if (!graphValidation.success) return graphValidation;
  const projectValidation = validateWebsiteProjectCollection(input.projects);
  if (!projectValidation.success) return projectValidation;
  const manifestValidation = validateClientExperienceManifestForPageGraph(
    input.clientExperienceManifest,
    graphValidation.data,
  );
  if (!manifestValidation.success) return manifestValidation;

  if (input.profile === undefined) {
    return {
      success: false,
      issues: Object.freeze([
        issue(
          "INVALID_INPUT",
          ["profile"],
          "Client definition schemaVersion 2 requires validated profile content so service detail routes can resolve stable service IDs.",
        ),
      ]),
    };
  }

  const issues = [
    ...validateProjectPageCoverage(
      graphValidation.data,
      projectValidation.data,
    ),
    ...validateServicePageCoverage(graphValidation.data, input.profile),
  ];
  if (issues.length > 0) {
    return { success: false, issues: Object.freeze(issues) };
  }

  return {
    success: true,
    data: deepFreeze({
      schemaVersion: 2 as const,
      renderingMode: "AUTHORED_CLIENT_EXPERIENCE" as const,
      pageGraph: graphValidation.data,
      projects: projectValidation.data,
      clientExperienceManifest: manifestValidation.data,
    }),
  };
}

function validateProjectPageCoverage(
  pageGraph: WebsitePageGraph,
  projects: WebsiteProjectCollection,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const projectIds = new Set(projects.projects.map(({ projectId }) => projectId));
  const pageCounts = new Map<string, number>();
  const projectsIndexes = pageGraph.pages.filter(
    ({ content }) => content.kind === "PROJECTS_INDEX",
  );

  for (const [pageIndex, page] of pageGraph.pages.entries()) {
    if (page.content.kind !== "PROJECT") continue;
    const projectId = page.content.projectId;
    pageCounts.set(projectId, (pageCounts.get(projectId) ?? 0) + 1);
    if (!projectIds.has(projectId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["pageGraph", "pages", pageIndex, "content", "projectId"],
          `Project page references missing project "${projectId}".`,
        ),
      );
    }
  }

  for (const [projectIndex, project] of projects.projects.entries()) {
    const count = pageCounts.get(project.projectId) ?? 0;
    if (count === 0) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["projects", "projects", projectIndex, "projectId"],
          `Public project "${project.projectId}" has no PROJECT_DETAIL page.`,
        ),
      );
    } else if (count > 1) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["projects", "projects", projectIndex, "projectId"],
          `Public project "${project.projectId}" is referenced by ${count} PROJECT_DETAIL pages.`,
        ),
      );
    }
  }

  if (projects.projects.length > 0 && projectsIndexes.length !== 1) {
    issues.push(
      issue(
        "INVALID_INPUT",
        ["pageGraph", "pages"],
        `A public Project collection requires exactly one PROJECTS_INDEX page. Found ${projectsIndexes.length}.`,
      ),
    );
  }

  return issues;
}

/**
 * Binds SERVICE_DETAIL pages to exact stable service IDs declared by the
 * validated profile. Title and slug matching are never attempted, so editing a
 * service display title cannot silently move or break a route.
 */
function validateServicePageCoverage(
  pageGraph: WebsitePageGraph,
  profile: WebsiteProfileContent,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pagesByServiceId = new Map<string, number>();

  for (const [pageIndex, page] of pageGraph.pages.entries()) {
    if (page.content.kind !== "SERVICE") continue;
    const serviceId = page.content.serviceId;

    if (serviceItemById(profile, serviceId) === undefined) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["pageGraph", "pages", pageIndex, "content", "serviceId"],
          `Service detail page references service "${serviceId}", which no validated profile service item declares as a stable serviceId.`,
        ),
      );
    }

    const previous = pagesByServiceId.get(serviceId);
    if (previous === undefined) {
      pagesByServiceId.set(serviceId, pageIndex);
    } else {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["pageGraph", "pages", pageIndex, "content", "serviceId"],
          `Service "${serviceId}" already has a detail page at index ${previous}.`,
        ),
      );
    }
  }

  return issues;
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
