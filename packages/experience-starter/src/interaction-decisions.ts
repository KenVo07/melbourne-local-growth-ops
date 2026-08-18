import type { ResolvedInteraction } from "./decisions.js";

/**
 * Which interaction a piece of content is *allowed* to become.
 *
 * Three things decide, in order: the semantics say what is valid, the shape of
 * the actual content says whether it would help, and the client's Motion &
 * Interaction Language says whether this client wants it. No rule here maps a
 * content type to a fixed component, and none of them reads the Profile — a
 * CONTRACTOR site does not get an accordion because it is a CONTRACTOR site.
 *
 * Every decision carries the sentence that justifies it, which goes into the
 * generation report so an operator can see why a site folded its questions away
 * and another did not.
 */

export type DisclosureTreatment = "STATIC" | "PROGRESSIVE_DISCLOSURE";
export type MediaTreatment = "STATIC" | "DIALOG_EXPLORER";

export interface InteractionDecision<T extends string> {
  readonly treatment: T;
  readonly reason: string;
}

/**
 * How long a run of collapsible items has to be before folding it away earns
 * its keep, per appetite. A disclosure trades one glance for one click, so a
 * short list is simply worse closed.
 */
const disclosureThreshold = {
  WHEN_LONG: { faq: 3, questions: 4 },
  PREFERRED: { faq: 2, questions: 3 },
} as const;

function decideDisclosure(
  kind: "faq" | "questions",
  label: string,
  itemCount: number,
  interaction: ResolvedInteraction,
): InteractionDecision<DisclosureTreatment> {
  const appetite = interaction.appetite.disclosure;
  if (appetite === "ALWAYS_VISIBLE") {
    return {
      treatment: "STATIC",
      reason: `${label} stays visible: this client's interaction language keeps content in the open.`,
    };
  }
  const threshold = disclosureThreshold[appetite][kind];
  if (itemCount < threshold) {
    return {
      treatment: "STATIC",
      reason: `${label} stays visible: ${itemCount} item${itemCount === 1 ? "" : "s"} reads better in place than behind ${itemCount === 1 ? "a control" : "controls"} (this client folds at ${threshold}).`,
    };
  }
  return {
    treatment: "PROGRESSIVE_DISCLOSURE",
    reason: `${label} folds away: ${itemCount} items are long enough that scanning beats reading, and this client's language permits disclosure.`,
  };
}

/** Contact-page questions: the concrete gap A3 left behind. */
export function decideContactFaqTreatment(input: {
  readonly itemCount: number;
  readonly interaction: ResolvedInteraction;
}): InteractionDecision<DisclosureTreatment> {
  return decideDisclosure(
    "faq",
    "Contact questions",
    input.itemCount,
    input.interaction,
  );
}

/** The per-service question rail. Held to a longer run than the FAQ, because
 * it sits inside a reading column rather than being the section's whole point. */
export function decideServiceQuestionTreatment(input: {
  readonly itemCount: number;
  readonly interaction: ResolvedInteraction;
}): InteractionDecision<DisclosureTreatment> {
  return decideDisclosure(
    "questions",
    "Service questions",
    input.itemCount,
    input.interaction,
  );
}

/**
 * How many photographs a beat needs before the overlay is offered, or `null`
 * when this client never offers one.
 *
 * The count is a *runtime* property — one project detail route serves every
 * project, and projects do not carry the same number of photographs — so
 * generation decides the capability and embeds this threshold in the emitted
 * source, which applies it per project. That split is what keeps the decision
 * honest: a client with one photograph on one project and six on another gets
 * exploration where it means something and not where it does not.
 */
export function projectMediaThreshold(
  interaction: ResolvedInteraction,
): number | null {
  switch (interaction.appetite.mediaExploration) {
    case "EDITORIAL_ONLY":
      return null;
    case "PREFERRED":
      return 1;
    default:
      return 2;
  }
}

/**
 * Project media exploration.
 *
 * The overlay is always an addition. Every photograph stays composed on the
 * page whatever this returns, so nothing becomes reachable only by opening a
 * dialog.
 */
export function decideProjectMediaTreatment(input: {
  readonly mediaCount: number;
  readonly interaction: ResolvedInteraction;
}): InteractionDecision<MediaTreatment> {
  const appetite = input.interaction.appetite.mediaExploration;
  if (appetite === "EDITORIAL_ONLY") {
    return {
      treatment: "STATIC",
      reason:
        "Project media stays editorial: this client's language presents photographs as composed rather than as a collection to browse.",
    };
  }
  const threshold = appetite === "PREFERRED" ? 1 : 2;
  if (input.mediaCount < threshold) {
    return {
      treatment: "STATIC",
      reason: `Project media stays editorial: ${input.mediaCount} photograph${input.mediaCount === 1 ? "" : "s"} does not amount to a sequence worth stepping through.`,
    };
  }
  return {
    treatment: "DIALOG_EXPLORER",
    reason:
      input.mediaCount > 1
        ? `${input.mediaCount} project photographs form a sequence, so the page offers optional focused exploration alongside the visible media.`
        : "This client's language prefers photographs to be openable at full size alongside the visible media.",
  };
}

/**
 * Everything the emitters need to know about this client's interaction, decided
 * once.
 *
 * Emission is conditional on this plan: a client whose language selects nothing
 * receives no helper source, no helper CSS and no client JavaScript, so a still
 * site pays nothing for the existence of the capability.
 */
export interface InteractionPlan {
  readonly contactFaq: InteractionDecision<DisclosureTreatment>;
  readonly serviceQuestions: InteractionDecision<DisclosureTreatment>;
  readonly projectMedia: InteractionDecision<MediaTreatment>;
  /** Photographs a project beat needs before the overlay is offered. */
  readonly projectMediaThreshold: number;
  readonly usesDisclosure: boolean;
  readonly usesMediaExplorer: boolean;
  readonly usesReveal: boolean;
}

export function planInteractions(input: {
  readonly interaction: ResolvedInteraction;
  /**
   * The routes this client's page graph actually carries. A capability whose
   * route does not exist is not a capability, and emitting its helper would put
   * dead source and a dead client chunk into the artifact.
   */
  readonly routeIds: readonly string[];
  /** Questions the client's own FAQ section carries, 0 when it has none. */
  readonly faqCount: number;
  /**
   * The *fewest* questions any service carries. One service detail route serves
   * every service, so a site that folded some rails and not others would read
   * as inconsistent rather than as considered.
   */
  readonly serviceQuestionCount: number;
}): InteractionPlan {
  const { interaction } = input;
  const has = (routeId: string) => input.routeIds.includes(routeId);

  const contactFaq = has("contact")
    ? decideContactFaqTreatment({ itemCount: input.faqCount, interaction })
    : ({
        treatment: "STATIC",
        reason: "This client has no contact route.",
      } as const);
  const serviceQuestions = has("service-detail")
    ? decideServiceQuestionTreatment({
        itemCount: input.serviceQuestionCount,
        interaction,
      })
    : ({
        treatment: "STATIC",
        reason: "This client has no service detail route.",
      } as const);

  /*
   * A capability decision rather than a count decision: how many photographs a
   * given project carries is only known at render time, so the emitted source
   * applies the threshold per project.
   */
  const threshold = projectMediaThreshold(interaction);
  const projectMedia: InteractionDecision<MediaTreatment> = !has("project-detail")
    ? { treatment: "STATIC", reason: "This client has no project detail route." }
    : threshold === null
      ? decideProjectMediaTreatment({ mediaCount: 0, interaction })
      : {
          treatment: "DIALOG_EXPLORER",
          reason: `Projects offer focused exploration alongside their visible media, for any project carrying ${threshold} photograph${threshold === 1 ? "" : "s"} or more.`,
        };

  return Object.freeze({
    contactFaq,
    serviceQuestions,
    projectMedia,
    projectMediaThreshold: threshold ?? 0,
    usesDisclosure:
      contactFaq.treatment === "PROGRESSIVE_DISCLOSURE" ||
      serviceQuestions.treatment === "PROGRESSIVE_DISCLOSURE",
    usesMediaExplorer: projectMedia.treatment === "DIALOG_EXPLORER",
    usesReveal: interaction.reveals,
  });
}
