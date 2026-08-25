import {
  featuredServices,
  groupedServices,
  serviceSections,
  type WebsiteProfileContent,
  type WebsiteServiceItem,
} from "./profile-content.js";
import {
  featuredProjects,
  projectsForService,
  type WebsiteProject,
  type WebsiteProjectCollection,
} from "./project-content.js";

/**
 * How a collection should be presented at the size this client actually is.
 *
 * These are **decisions, not layouts**. Nothing here emits markup, chooses a
 * grid, or knows what a card looks like. Each function reads validated client
 * truth and returns the architectural shape a renderer must satisfy, so that the
 * generated P1 site, a hand-authored premium experience, and the operator's
 * readiness report all answer the cardinality question the same way instead of
 * three implementations each guessing a threshold.
 *
 * The thresholds are the ones the post-Stone design briefs recorded as the
 * ranges to design against. They are stated once, here, rather than reappearing
 * as magic numbers in an emitter.
 */

export type ProjectPresentationMode =
  | "CURATED"
  | "TRANSITIONAL"
  | "ARCHIVE";

/**
 * Whether the reader is given the whole set at once or a portion of it.
 *
 * `PROGRESSIVE` is a *visual* budget, not a data-loading one. Every record's
 * link is in the initial HTML regardless — a validated collection is capped at
 * 250 records and is already fully present in the page — so progressive reveal
 * costs a crawler nothing and costs a reader no request. This is the reason the
 * archive needs neither pagination routes nor a fetch endpoint: the retrieval
 * problem here is attention, not bytes.
 */
export type ProjectRetrieval = "NONE" | "PROGRESSIVE";

export interface ProjectPresentationPlan {
  readonly mode: ProjectPresentationMode;
  readonly total: number;
  /** Records told as stories above the archive. Empty when none are featured. */
  readonly curatedCount: number;
  /** Whether an archive region exists at all beneath the curated set. */
  readonly archive: boolean;
  readonly retrieval: ProjectRetrieval;
  /**
   * How many archive records are visible before the reader asks for more. Zero
   * when retrieval is `NONE`, which means every record is visible immediately.
   */
  readonly initialArchiveCount: number;
  /** Whether facet controls are worth rendering at this size. */
  readonly filtering: boolean;
}

/**
 * The size boundaries, stated once.
 *
 * 12 is where a composition told as a story stops being read as a story and
 * starts being read as a long page; 25 is where a reader stops browsing and
 * starts searching for their own job. Between them is a transition zone that
 * wants the archive's structure without its machinery.
 */
const CURATED_CEILING = 12;
const ARCHIVE_FLOOR = 25;
/**
 * A filter over a handful of records is theatre: it costs a control, a label,
 * an empty state and a focus contract, and it saves the reader nothing they
 * could not have done by looking. Eight is where narrowing starts to pay.
 */
const FILTER_FLOOR = 8;
/** Enough to establish the grid's rhythm without asking for a long first scroll. */
const INITIAL_ARCHIVE_COUNT = 12;

export function resolveProjectPresentation(
  collection: WebsiteProjectCollection,
): ProjectPresentationPlan {
  return resolveProjectPresentationFromCounts(
    collection.projects.length,
    featuredProjects(collection).length,
  );
}

/**
 * The same decision from raw counts.
 *
 * Exists because the P1 source generator reads an unvalidated definition and
 * holds counts rather than a validated collection, and the one thing that must
 * not happen is the generator inventing its own threshold. One rule, two
 * callers.
 */
export function resolveProjectPresentationFromCounts(
  total: number,
  curatedCount: number,
): ProjectPresentationPlan {
  const mode: ProjectPresentationMode =
    total >= ARCHIVE_FLOOR
      ? "ARCHIVE"
      : total > CURATED_CEILING
        ? "TRANSITIONAL"
        : "CURATED";
  /*
   * In CURATED mode the whole set is the composition, so an "archive" beneath it
   * would be the same records twice. Above the ceiling the two jobs separate:
   * the featured records persuade, the archive answers "have you done my job".
   */
  const archive = mode !== "CURATED";
  return Object.freeze({
    mode,
    total,
    curatedCount,
    archive,
    retrieval: mode === "ARCHIVE" ? "PROGRESSIVE" : "NONE",
    initialArchiveCount: mode === "ARCHIVE" ? INITIAL_ARCHIVE_COUNT : 0,
    filtering: total >= FILTER_FLOOR,
  });
}

export interface CollectionFacetValue {
  readonly facetId: string;
  readonly label: string;
  readonly count: number;
}

export interface CollectionFacet {
  readonly kind: "SERVICE" | "LOCATION" | "YEAR";
  readonly label: string;
  readonly values: readonly CollectionFacetValue[];
}

/**
 * The facets a project archive can offer, derived entirely from relations the
 * client definition already carries.
 *
 * There is deliberately **no declared category vocabulary**. A trade business
 * asked to invent a taxonomy invents one that duplicates its own service list
 * and then drifts from it, and asking for it at all contradicts the done-for-you
 * principle: the client answers factual questions, not information-architecture
 * ones. `serviceIds` is already how a trade customer thinks — "have you done a
 * re-roof?" — and it is already a validated relation with a stable identity, so
 * the facet is free and cannot disagree with the service list.
 *
 * A facet with fewer than two values is omitted: a control with one option is a
 * label pretending to be a choice.
 */
export function deriveProjectFacets(
  profile: WebsiteProfileContent,
  collection: WebsiteProjectCollection,
): readonly CollectionFacet[] {
  const services = serviceSections(profile).flatMap((section) => section.items);
  const serviceValues = services
    .filter(
      (service): service is WebsiteServiceItem & { serviceId: string } =>
        service.serviceId !== undefined,
    )
    .map((service) => ({
      facetId: service.serviceId,
      label: service.title,
      count: projectsForService(collection, service.serviceId).length,
    }))
    .filter(({ count }) => count > 0);

  const locationCounts = new Map<string, number>();
  for (const project of collection.projects) {
    if (project.locationLabel === undefined) continue;
    locationCounts.set(
      project.locationLabel,
      (locationCounts.get(project.locationLabel) ?? 0) + 1,
    );
  }
  const locationValues = [...locationCounts.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([label, count]) => ({ facetId: facetId(label), label, count }));

  const yearCounts = new Map<number, number>();
  for (const project of collection.projects) {
    if (project.completedYear === undefined) continue;
    yearCounts.set(
      project.completedYear,
      (yearCounts.get(project.completedYear) ?? 0) + 1,
    );
  }
  const yearValues = [...yearCounts.entries()]
    .sort(([left], [right]) => right - left)
    .map(([year, count]) => ({
      facetId: String(year),
      label: String(year),
      count,
    }));

  return Object.freeze(
    (
      [
        { kind: "SERVICE" as const, label: "Service", values: serviceValues },
        { kind: "LOCATION" as const, label: "Area", values: locationValues },
        { kind: "YEAR" as const, label: "Year", values: yearValues },
      ] satisfies CollectionFacet[]
    )
      .filter(({ values }) => values.length >= 2)
      .map((facet) => Object.freeze({ ...facet, values: Object.freeze(facet.values) })),
  );
}

function facetId(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "unlabelled"
  );
}

export type ServicePresentationMode = "FLAT" | "GROUPED";

export interface ServicePresentationPlan {
  readonly mode: ServicePresentationMode;
  readonly total: number;
  readonly groupCount: number;
  readonly ungroupedCount: number;
  readonly featuredCount: number;
  /**
   * True when the flat list has grown past the point where a reader can hold it
   * in mind and the client has declared no grouping. Not an error — a business
   * genuinely may have eleven peers — but the operator should be told, because
   * the usual cause is that nobody asked the grouping question at intake.
   */
  readonly ungroupedAtScale: boolean;
}

/**
 * Nine is where a flat list stops being scannable in one pass on a phone. Below
 * it, grouping is optional structure; above it, its absence is worth reporting.
 */
const FLAT_SERVICE_CEILING = 8;

export function resolveServicePresentation(
  profile: WebsiteProfileContent,
): ServicePresentationPlan {
  const grouped = groupedServices(profile);
  const total = grouped.ungrouped.length +
    grouped.groups.reduce((sum, { services }) => sum + services.length, 0);
  return Object.freeze({
    mode: grouped.groups.length > 0 ? "GROUPED" : "FLAT",
    total,
    groupCount: grouped.groups.length,
    ungroupedCount: grouped.ungrouped.length,
    featuredCount: featuredServices(profile).length,
    ungroupedAtScale:
      grouped.groups.length === 0 && total > FLAT_SERVICE_CEILING,
  });
}

/**
 * How many of the customer's decision questions this service can actually
 * answer, counting project evidence as one.
 *
 * This is the measure behind "what is the minimum truth for a service to
 * deserve a detail route". It counts *kinds* of answer rather than words: a
 * service with fourteen bullet points under one heading knows one thing.
 */
export function serviceDecisionDepth(
  service: WebsiteServiceItem,
  evidenceCount: number,
): number {
  const decision = service.decision;
  const filled = [
    service.narrative !== undefined,
    (decision?.suitedTo.length ?? 0) > 0,
    (decision?.covers.length ?? 0) > 0,
    (decision?.excludes.length ?? 0) > 0,
    (decision?.whenToCall.length ?? 0) > 0,
    (decision?.stages.length ?? 0) > 0,
    (decision?.customerProvides.length ?? 0) > 0,
    (decision?.commercial.length ?? 0) > 0,
    (decision?.questions.length ?? 0) > 0,
    evidenceCount > 0,
  ];
  return filled.filter(Boolean).length;
}

/**
 * A service earns its own route when it can answer at least two of the
 * customer's decision questions.
 *
 * Two rather than one because a page carrying a single answer is a row that has
 * been given a URL, and a reader who follows a link to find one sentence trusts
 * the next link less. Below the threshold the service belongs on the index.
 *
 * This is **advisory**. It is reported to the operator and never enforced by a
 * validator, because the page graph is authored and a client who has a thin
 * service today may have a rich one next week — and because refusing here would
 * invalidate definitions that are already live.
 */
export const SERVICE_DETAIL_ROUTE_THRESHOLD = 2;

export function deservesServiceDetailRoute(
  service: WebsiteServiceItem,
  evidenceCount: number,
): boolean {
  return (
    service.serviceId !== undefined &&
    serviceDecisionDepth(service, evidenceCount) >=
      SERVICE_DETAIL_ROUTE_THRESHOLD
  );
}

export type NavigationSectionMode = "SIMPLE" | "EXPANDED";

export interface NavigationPlan {
  readonly services: NavigationSectionMode;
  readonly projects: NavigationSectionMode;
  /**
   * Services to show inside an expanded services panel — the declared groups if
   * there are any, otherwise the featured services, otherwise every service.
   */
  readonly servicePanelItems: readonly WebsiteServiceItem[];
  /** Featured projects worth previewing inside an expanded projects panel. */
  readonly projectPanelItems: readonly WebsiteProject[];
  /**
   * True when the primary bar is at or past the width where a flat header stops
   * being comfortable. Reported so an operator sees it before a reviewer does.
   */
  readonly primaryAtLimit: boolean;
}

/** A flat header is proven at 3–5 links and near its limit at 6–8. */
const PRIMARY_LINK_LIMIT = 6;
/**
 * Below seven services a panel shows a reader what a single click would have
 * shown them anyway. At seven the structure starts being worth exposing.
 */
const EXPANDED_SERVICES_FLOOR = 7;
/**
 * A projects panel previews selected work. It needs enough featured records to
 * be a selection rather than a list, and enough total records that the index is
 * not simply the better destination.
 */
const PROJECT_PANEL_FLOOR = 3;

export function resolveNavigationPlan(
  profile: WebsiteProfileContent,
  collection: WebsiteProjectCollection,
  primaryLinkCount: number,
): NavigationPlan {
  const services = resolveServicePresentation(profile);
  const grouped = groupedServices(profile);
  const featuredService = featuredServices(profile);
  const allServices = serviceSections(profile).flatMap(
    (section) => section.items,
  );
  const projectPlan = resolveProjectPresentation(collection);
  const featuredProject = featuredProjects(collection);

  const servicesExpanded =
    services.mode === "GROUPED" || services.total >= EXPANDED_SERVICES_FLOOR;
  const projectsExpanded =
    featuredProject.length >= PROJECT_PANEL_FLOOR && projectPlan.archive;

  /*
   * A grouped panel lists its groups' services in group order so the panel and
   * the index agree; an ungrouped one prefers the agency's featured selection
   * and falls back to the whole list, which is only reached below the expansion
   * floor and is therefore short by construction.
   */
  const servicePanelItems =
    services.mode === "GROUPED"
      ? grouped.groups.flatMap(({ services: members }) => members)
      : featuredService.length > 0
        ? featuredService
        : allServices;

  return Object.freeze({
    services: servicesExpanded ? "EXPANDED" : "SIMPLE",
    projects: projectsExpanded ? "EXPANDED" : "SIMPLE",
    servicePanelItems: Object.freeze(servicePanelItems),
    projectPanelItems: Object.freeze(featuredProject),
    primaryAtLimit: primaryLinkCount >= PRIMARY_LINK_LIMIT,
  });
}
