import {
  resolveProjectPresentationFromCounts,
  type ProjectPresentationPlan,
} from "@melbourne-local-growth-ops/site-core";

/**
 * What this client's cardinality means for the source about to be written.
 *
 * The generator reads an unvalidated definition and holds counts, so it asks
 * site-core's collection policy rather than inventing thresholds of its own.
 * Three files then emit against one decision: the projects route, the services
 * route and the stylesheet.
 */
export interface ClientScale {
  /** Every declared stable service ID, used to emit the archive's facet rules. */
  readonly serviceIds: readonly string[];
  readonly projects: ProjectPresentationPlan;
  /**
   * How many archive rows are shown before the reader asks for the rest.
   *
   * Zero means every row is shown. The budget applies only to the unfiltered
   * view: once a facet narrows the set, the narrowed set is short by
   * construction and showing all of it is the correct answer.
   */
  readonly archiveBudget: number;
  /**
   * Whether the header exposes a second level.
   *
   * Count-driven, and off by default: below seven services a panel shows a
   * reader what one click would have shown them anyway, and a business with four
   * sections keeps the flat header that is proven for it. A grouped business
   * expands at any size, because the group structure is the thing worth
   * exposing.
   */
  readonly expandedNavigation: boolean;
}

/** Rows past this point are folded away until the reader asks for them. */
const ARCHIVE_BUDGET = 14;

/** Below this, the flat header is still the better answer. */
const EXPANDED_NAVIGATION_FLOOR = 7;

export function readClientScale(facts: {
  readonly serviceIds: readonly string[];
  readonly serviceGroupCount: number;
  readonly projectCount: number;
  readonly featuredProjectCount: number;
}): ClientScale {
  const projects = resolveProjectPresentationFromCounts(
    facts.projectCount,
    facts.featuredProjectCount,
  );
  return Object.freeze({
    serviceIds: Object.freeze([...facts.serviceIds]),
    projects,
    archiveBudget:
      projects.archive && facts.projectCount > ARCHIVE_BUDGET ? ARCHIVE_BUDGET : 0,
    expandedNavigation:
      facts.serviceGroupCount > 0 ||
      facts.serviceIds.length >= EXPANDED_NAVIGATION_FLOOR,
  });
}
