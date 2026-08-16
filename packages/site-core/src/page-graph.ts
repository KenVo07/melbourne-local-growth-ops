import {
  translateZodIssues,
  type ValidationIssue,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

const boundedId = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const shortText = z.string().trim().min(1).max(200);
const longText = z.string().trim().min(1).max(2_000);
const assetId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._/-]*$/);

export const WebsiteRoutePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(256)
  .superRefine((path, context) => {
    if (path === "/") return;
    if (!/^\/[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/.test(path)) {
      context.addIssue({
        code: "custom",
        message:
          "Route path must be / or a lowercase, slash-separated, kebab-case path without a trailing slash, query, fragment, dot segment, or encoded separator.",
      });
    }
    const firstSegment = path.split("/")[1];
    if (firstSegment === "api") {
      context.addIssue({
        code: "custom",
        message: "Client page routes cannot use the reserved /api namespace.",
      });
    }
  });

export const WebsitePageKindSchema = z.enum([
  "HOME",
  "STANDARD",
  "SERVICES_INDEX",
  "SERVICE_DETAIL",
  "PROJECTS_INDEX",
  "PROJECT_DETAIL",
  "ABOUT",
  "SERVICE_AREAS",
  "CONTACT",
]);

export const WebsitePageAnchorSchema = z.strictObject({
  anchorId: boundedId,
  label: shortText,
});

const staticContentReferenceSchema = z.strictObject({
  kind: z.literal("STATIC"),
  contentKey: boundedId,
});
const profileSectionsContentReferenceSchema = z.strictObject({
  kind: z.literal("PROFILE_SECTIONS"),
  sectionIds: z.array(boundedId).min(1).max(64),
});
const servicesIndexContentReferenceSchema = z.strictObject({
  kind: z.literal("SERVICES_INDEX"),
});
const serviceContentReferenceSchema = z.strictObject({
  kind: z.literal("SERVICE"),
  serviceId: boundedId,
});
const projectsIndexContentReferenceSchema = z.strictObject({
  kind: z.literal("PROJECTS_INDEX"),
});
const projectContentReferenceSchema = z.strictObject({
  kind: z.literal("PROJECT"),
  projectId: boundedId,
});

export const WebsitePageContentReferenceSchema = z.discriminatedUnion("kind", [
  staticContentReferenceSchema,
  profileSectionsContentReferenceSchema,
  servicesIndexContentReferenceSchema,
  serviceContentReferenceSchema,
  projectsIndexContentReferenceSchema,
  projectContentReferenceSchema,
]);

export const WebsitePageMetadataSchema = z.strictObject({
  title: shortText,
  description: longText,
  openGraphImageAssetId: assetId.optional(),
});

export const WebsitePageSearchSchema = z.strictObject({
  include: z.boolean(),
  title: shortText.optional(),
  summary: longText.optional(),
});

export const WebsitePageDefinitionSchema = z.strictObject({
  pageId: boundedId,
  path: WebsiteRoutePathSchema,
  kind: WebsitePageKindSchema,
  experienceRouteId: boundedId,
  title: shortText,
  metadata: WebsitePageMetadataSchema,
  content: WebsitePageContentReferenceSchema,
  anchors: z.array(WebsitePageAnchorSchema).max(64).default([]),
  parentPageId: boundedId.optional(),
  relatedPageIds: z.array(boundedId).max(32).default([]),
  search: WebsitePageSearchSchema,
});

const routeTargetSchema = z.strictObject({
  kind: z.literal("ROUTE"),
  pageId: boundedId,
});
const anchorTargetSchema = z.strictObject({
  kind: z.literal("ANCHOR"),
  pageId: boundedId,
  anchorId: boundedId,
});

export const WebsiteNavigationTargetSchema = z.discriminatedUnion("kind", [
  routeTargetSchema,
  anchorTargetSchema,
]);

export const WebsiteNavigationItemSchema = z.strictObject({
  navigationId: boundedId,
  label: shortText,
  target: WebsiteNavigationTargetSchema,
});

export const WebsitePageGraphSchema = z.strictObject({
  schemaVersion: z.literal(1),
  homePageId: boundedId,
  pages: z.array(WebsitePageDefinitionSchema).min(1).max(128),
  navigation: z.strictObject({
    primary: z.array(WebsiteNavigationItemSchema).min(1).max(12),
    utility: z.array(WebsiteNavigationItemSchema).max(12).default([]),
    footer: z.array(WebsiteNavigationItemSchema).max(32).default([]),
    primaryAction: WebsiteNavigationItemSchema.optional(),
  }),
});

export type WebsiteRoutePath = z.infer<typeof WebsiteRoutePathSchema>;
export type WebsitePageKind = z.infer<typeof WebsitePageKindSchema>;
export type WebsitePageContentReference = z.infer<
  typeof WebsitePageContentReferenceSchema
>;
export type WebsitePageDefinition = z.infer<typeof WebsitePageDefinitionSchema>;
export type WebsiteNavigationTarget = z.infer<
  typeof WebsiteNavigationTargetSchema
>;
export type WebsiteNavigationItem = z.infer<
  typeof WebsiteNavigationItemSchema
>;
export type WebsitePageGraph = z.infer<typeof WebsitePageGraphSchema>;

export function validateWebsitePageGraph(
  input: unknown,
): ValidationResult<WebsitePageGraph> {
  const parsed = WebsitePageGraphSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, issues: translateZodIssues(parsed.error.issues) };
  }

  const issues = validateGraphReferences(parsed.data);
  return issues.length === 0
    ? { success: true, data: deepFreeze(parsed.data) }
    : { success: false, issues: Object.freeze(issues) };
}

export function resolveWebsitePageByPath(
  graph: WebsitePageGraph,
  path: string,
): WebsitePageDefinition | undefined {
  const normalized = normalizeRoutePath(path);
  return graph.pages.find((page) => page.path === normalized);
}

export function resolveWebsitePageById(
  graph: WebsitePageGraph,
  pageId: string,
): WebsitePageDefinition | undefined {
  return graph.pages.find((page) => page.pageId === pageId);
}

export function routeSegments(path: WebsiteRoutePath): readonly string[] {
  return path === "/"
    ? Object.freeze([])
    : Object.freeze(path.slice(1).split("/"));
}

export function staticRouteParams(
  graph: WebsitePageGraph,
): readonly Readonly<{ segments: readonly string[] }>[] {
  return deepFreeze(
    graph.pages
      .filter(({ path }) => path !== "/")
      .map(({ path }) => ({ segments: routeSegments(path) })),
  );
}

/**
 * Resolves a navigation target to an absolute in-site href.
 *
 * Anchor targets always keep their leading route, including for the home page.
 * Navigation renders on every route, so a bare `#anchor` fragment would resolve
 * against whatever page the visitor is currently on instead of the intended
 * destination.
 */
export function navigationHref(
  graph: WebsitePageGraph,
  target: WebsiteNavigationTarget,
): string {
  const page = resolveWebsitePageById(graph, target.pageId);
  if (page === undefined) {
    throw new Error(`Navigation target page "${target.pageId}" is missing.`);
  }
  return target.kind === "ROUTE" ? page.path : `${page.path}#${target.anchorId}`;
}

function validateGraphReferences(graph: WebsitePageGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pageById = new Map<string, WebsitePageDefinition>();
  const pageByPath = new Map<string, WebsitePageDefinition>();

  for (const [index, page] of graph.pages.entries()) {
    if (pageById.has(page.pageId)) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["pages", index, "pageId"],
          `Page ID "${page.pageId}" is duplicated.`,
        ),
      );
    } else {
      pageById.set(page.pageId, page);
    }

    if (pageByPath.has(page.path)) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["pages", index, "path"],
          `Route path "${page.path}" is duplicated.`,
        ),
      );
    } else {
      pageByPath.set(page.path, page);
    }

    validateUniqueAnchors(page, index, issues);
    validatePageKindContent(page, index, issues);
  }

  const home = pageById.get(graph.homePageId);
  if (home === undefined) {
    issues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        ["homePageId"],
        `Home page "${graph.homePageId}" does not exist.`,
      ),
    );
  } else {
    if (home.path !== "/") {
      issues.push(
        issue(
          "INVALID_INPUT",
          ["homePageId"],
          "The home page must use the root path /.",
        ),
      );
    }
    if (home.kind !== "HOME") {
      issues.push(
        issue(
          "INVALID_INPUT",
          ["homePageId"],
          "The home page must use page kind HOME.",
        ),
      );
    }
  }

  const rootPages = graph.pages.filter(({ path }) => path === "/");
  if (rootPages.length !== 1) {
    issues.push(
      issue(
        "INVALID_INPUT",
        ["pages"],
        `Exactly one page must use the root path /. Found ${rootPages.length}.`,
      ),
    );
  }

  for (const [index, page] of graph.pages.entries()) {
    if (
      page.parentPageId !== undefined &&
      !pageById.has(page.parentPageId)
    ) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          ["pages", index, "parentPageId"],
          `Parent page "${page.parentPageId}" does not exist.`,
        ),
      );
    }
    for (const [relatedIndex, relatedId] of page.relatedPageIds.entries()) {
      if (relatedId === page.pageId) {
        issues.push(
          issue(
            "INVALID_INPUT",
            ["pages", index, "relatedPageIds", relatedIndex],
            "A page cannot relate to itself.",
          ),
        );
      } else if (!pageById.has(relatedId)) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            ["pages", index, "relatedPageIds", relatedIndex],
            `Related page "${relatedId}" does not exist.`,
          ),
        );
      }
    }
  }

  validateParentCycles(graph.pages, pageById, issues);
  validateNavigation(graph, pageById, issues);
  return issues;
}

function validateUniqueAnchors(
  page: WebsitePageDefinition,
  pageIndex: number,
  issues: ValidationIssue[],
): void {
  const seen = new Set<string>();
  for (const [index, anchor] of page.anchors.entries()) {
    if (seen.has(anchor.anchorId)) {
      issues.push(
        issue(
          "DUPLICATE_IDENTIFIER",
          ["pages", pageIndex, "anchors", index, "anchorId"],
          `Anchor "${anchor.anchorId}" is duplicated on page "${page.pageId}".`,
        ),
      );
    }
    seen.add(anchor.anchorId);
  }
}

function validatePageKindContent(
  page: WebsitePageDefinition,
  index: number,
  issues: ValidationIssue[],
): void {
  const expected = new Map<WebsitePageKind, readonly WebsitePageContentReference["kind"][]>([
    ["HOME", ["STATIC", "PROFILE_SECTIONS"]],
    ["STANDARD", ["STATIC", "PROFILE_SECTIONS"]],
    ["SERVICES_INDEX", ["SERVICES_INDEX"]],
    ["SERVICE_DETAIL", ["SERVICE"]],
    ["PROJECTS_INDEX", ["PROJECTS_INDEX"]],
    ["PROJECT_DETAIL", ["PROJECT"]],
    ["ABOUT", ["STATIC", "PROFILE_SECTIONS"]],
    ["SERVICE_AREAS", ["STATIC", "PROFILE_SECTIONS"]],
    ["CONTACT", ["STATIC", "PROFILE_SECTIONS"]],
  ]);
  const allowed = expected.get(page.kind) ?? [];
  if (!allowed.includes(page.content.kind)) {
    issues.push(
      issue(
        "INVALID_INPUT",
        ["pages", index, "content", "kind"],
        `Page kind ${page.kind} cannot use content kind ${page.content.kind}. Allowed: ${allowed.join(", ")}.`,
      ),
    );
  }
}

function validateParentCycles(
  pages: readonly WebsitePageDefinition[],
  pageById: ReadonlyMap<string, WebsitePageDefinition>,
  issues: ValidationIssue[],
): void {
  for (const [index, start] of pages.entries()) {
    const visited = new Set<string>([start.pageId]);
    let current = start;
    while (current.parentPageId !== undefined) {
      const parent = pageById.get(current.parentPageId);
      if (parent === undefined) break;
      if (visited.has(parent.pageId)) {
        issues.push(
          issue(
            "INVALID_INPUT",
            ["pages", index, "parentPageId"],
            `Page parent relationship contains a cycle involving "${parent.pageId}".`,
          ),
        );
        break;
      }
      visited.add(parent.pageId);
      current = parent;
    }
  }
}

function validateNavigation(
  graph: WebsitePageGraph,
  pageById: ReadonlyMap<string, WebsitePageDefinition>,
  issues: ValidationIssue[],
): void {
  const groups = [
    ["primary", graph.navigation.primary] as const,
    ["utility", graph.navigation.utility] as const,
    ["footer", graph.navigation.footer] as const,
    ...(graph.navigation.primaryAction === undefined
      ? []
      : [["primaryAction", [graph.navigation.primaryAction]] as const]),
  ];
  const seenIds = new Set<string>();

  for (const [groupName, items] of groups) {
    for (const [index, item] of items.entries()) {
      if (seenIds.has(item.navigationId)) {
        issues.push(
          issue(
            "DUPLICATE_IDENTIFIER",
            ["navigation", groupName, index, "navigationId"],
            `Navigation ID "${item.navigationId}" is duplicated.`,
          ),
        );
      }
      seenIds.add(item.navigationId);

      const target = item.target;
      const page = pageById.get(target.pageId);
      if (page === undefined) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            ["navigation", groupName, index, "target", "pageId"],
            `Navigation target page "${target.pageId}" does not exist.`,
          ),
        );
        continue;
      }
      if (
        target.kind === "ANCHOR" &&
        !page.anchors.some(({ anchorId }) => anchorId === target.anchorId)
      ) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            ["navigation", groupName, index, "target", "anchorId"],
            `Anchor "${target.anchorId}" does not exist on page "${page.pageId}".`,
          ),
        );
      }
    }
  }
}

function normalizeRoutePath(input: string): string {
  const withoutQuery = input.split(/[?#]/, 1)[0] || "/";
  if (withoutQuery === "/") return "/";
  return withoutQuery.endsWith("/")
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
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
