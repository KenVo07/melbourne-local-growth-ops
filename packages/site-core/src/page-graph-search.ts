import type { WebsitePageDefinition, WebsitePageGraph } from "./page-graph.js";
import type {
  WebsiteProject,
  WebsiteProjectCollection,
} from "./project-content.js";
import { sectionSearchText } from "./foundation-search.js";
import {
  serviceItemById,
  type WebsiteProfileContent,
} from "./profile-content.js";

export interface PageGraphFoundationSearchRecord {
  readonly url: string;
  readonly content: string;
  readonly language: "en";
  readonly meta: Readonly<{
    title: string;
    businessName: string;
    pageId: string;
    pageKind: string;
    profile: string;
    projectId?: string;
  }>;
  readonly filters: Readonly<{
    profile: readonly string[];
    pageKind: readonly string[];
    project: readonly string[];
  }>;
}

export interface PageGraphFoundationSearchContext {
  readonly businessName: string;
  readonly profile: WebsiteProfileContent;
  readonly pageGraph: WebsitePageGraph;
  readonly projects: WebsiteProjectCollection;
}

/**
 * Projects only validated public Page Graph content into explicit route-aware
 * Pagefind custom records. Legacy one-page section projection remains separate.
 */
export function projectPageGraphSearchRecords(
  context: PageGraphFoundationSearchContext,
): readonly PageGraphFoundationSearchRecord[] {
  const projectById = new Map(
    context.projects.projects.map((project) => [project.projectId, project]),
  );
  return deepFreeze(
    context.pageGraph.pages
      .filter(({ search }) => search.include)
      .map((page) => {
        const project =
          page.content.kind === "PROJECT"
            ? projectById.get(page.content.projectId)
            : undefined;
        if (page.content.kind === "PROJECT" && project === undefined) {
          throw new Error(
            `Validated Page Graph references missing Project "${page.content.projectId}".`,
          );
        }
        const title = page.search.title ?? page.title;
        const content = normalizeText(
          [
            context.businessName,
            title,
            page.metadata.title,
            page.metadata.description,
            page.search.summary ?? "",
            pageContentText(page, context.profile, project),
          ].join(" "),
        );
        return {
          url: page.path,
          content,
          language: "en" as const,
          meta: {
            title,
            businessName: context.businessName,
            pageId: page.pageId,
            pageKind: page.kind,
            profile: context.profile.profile,
            ...(project === undefined ? {} : { projectId: project.projectId }),
          },
          filters: {
            profile: Object.freeze([context.profile.profile]),
            pageKind: Object.freeze([page.kind]),
            project: Object.freeze(
              project === undefined ? [] : [project.projectId],
            ),
          },
        };
      }),
  );
}

function pageContentText(
  page: WebsitePageDefinition,
  profile: WebsiteProfileContent,
  project: WebsiteProject | undefined,
): string {
  switch (page.content.kind) {
    case "STATIC":
      return page.content.contentKey;
    case "PROFILE_SECTIONS": {
      const sectionIds = new Set(page.content.sectionIds);
      return profile.sections
        .filter(({ sectionId }) => sectionIds.has(sectionId))
        .map(sectionSearchText)
        .join(" ");
    }
    case "SERVICES_INDEX":
      return profile.sections
        .filter(({ type }) => type === "SERVICES")
        .map(sectionSearchText)
        .join(" ");
    case "SERVICE": {
      const service = serviceItemById(profile, page.content.serviceId);
      return service === undefined
        ? ""
        : `${service.title} ${service.description}`;
    }
    case "PROJECTS_INDEX":
      return "Projects case studies past work";
    case "PROJECT":
      return project === undefined ? "" : projectText(project);
    default: {
      const exhaustive: never = page.content;
      return exhaustive;
    }
  }
}

function projectText(project: WebsiteProject): string {
  return [
    project.title,
    project.summary,
    project.locationLabel ?? "",
    ...project.serviceIds,
    ...project.facts.flatMap(({ label, value }) => [label, value]),
    ...project.story.flatMap(({ heading, body }) => [heading, body]),
    project.demonstrationDisclosure ?? "",
  ].join(" ");
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
