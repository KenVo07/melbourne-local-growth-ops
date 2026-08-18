import type { ResolvedInteraction } from "./decisions.js";
import {
  feedsBack,
  readDetailRuns,
  revealsRole,
  type DetailRun,
  type FeedbackRole,
  type RevealRole,
} from "./semantic-opportunities.js";

/**
 * Which interaction a piece of content is *allowed* to become.
 *
 * Three things decide, in order: the semantics say what shape the content is
 * and how a reader uses it, the shape of the actual content says whether an
 * interaction would help, and the client's Motion & Interaction Language says
 * whether this client wants it. No rule here maps a section type to a fixed
 * component, and none of them reads the Profile — a CONTRACTOR site does not
 * get an accordion because it is a CONTRACTOR site.
 *
 * The decisions are taken over *opportunities* read from the semantic model
 * (`semantic-opportunities.ts`) rather than over a fixed list of named places.
 * Adding FAQ folding as a special case would have been a third of the code; it
 * would also have meant that the next client whose content wants folding gets
 * nothing, and that the Factory's capability is really a Contact-page feature
 * wearing a general name.
 *
 * Every decision carries the sentence that justifies it, which goes into the
 * generation report so an operator can see why a site folded one run away and
 * left another in the open.
 */

export type DisclosureTreatment = "STATIC" | "PROGRESSIVE_DISCLOSURE";
export type MediaTreatment = "STATIC" | "DIALOG_EXPLORER";

export interface InteractionDecision<T extends string> {
  readonly treatment: T;
  readonly reason: string;
}

/** A disclosure decision, kept alongside the opportunity that produced it. */
export interface DisclosureDecision
  extends InteractionDecision<DisclosureTreatment> {
  readonly run: DetailRun;
}

/**
 * How long a run has to be before folding it away earns its keep, per appetite.
 * A disclosure trades one glance for one click, so a short run is simply worse
 * closed however a reader uses it.
 */
const disclosureThreshold = {
  WHEN_LONG: 3,
  PREFERRED: 2,
} as const;

/**
 * How much prose an item needs to carry before hiding it is worth a click. A
 * run of one-line answers is a table; folding a table produces a column of
 * controls that each reveal a sentence, which is worse than the table.
 */
const disclosureBodyFloor = {
  WHEN_LONG: 90,
  PREFERRED: 40,
} as const;

/**
 * Decides one run.
 *
 * Semantics first: a SEQUENCE or a BROWSE run is refused before the client's
 * appetite is consulted at all, because no amount of client preference makes
 * folding an ordered method or a comparison table into an improvement. Only
 * once the content is known to be the kind a reader dips into does length,
 * substance and appetite get a say.
 */
export function decideDisclosure(
  run: DetailRun,
  interaction: ResolvedInteraction,
): DisclosureDecision {
  const appetite = interaction.appetite.disclosure;

  if (run.access === "SEQUENCE") {
    return {
      run,
      treatment: "STATIC",
      reason: `${run.label} stays visible: its items are an ordered sequence a reader follows through, and folding each step behind a control would cost a click per step to destroy the continuity that is the content.`,
    };
  }
  if (run.access === "BROWSE") {
    return {
      run,
      treatment: "STATIC",
      reason: `${run.label} stays visible: a reader is comparing these against each other, which cannot be done one at a time.`,
    };
  }

  if (appetite === "ALWAYS_VISIBLE") {
    return {
      run,
      treatment: "STATIC",
      reason: `${run.label} stays visible: this client's interaction language keeps content in the open.`,
    };
  }

  const threshold = disclosureThreshold[appetite];
  if (run.itemCount < threshold) {
    return {
      run,
      treatment: "STATIC",
      reason: `${run.label} stays visible: ${run.itemCount} item${run.itemCount === 1 ? "" : "s"} reads better in place than behind ${run.itemCount === 1 ? "a control" : "controls"} (this client folds at ${threshold}).`,
    };
  }

  const floor = disclosureBodyFloor[appetite];
  if (run.medianBodyLength < floor) {
    return {
      run,
      treatment: "STATIC",
      reason: `${run.label} stays visible: its items carry about ${run.medianBodyLength} characters each, which is less than it costs a reader to open them.`,
    };
  }

  return {
    run,
    treatment: "PROGRESSIVE_DISCLOSURE",
    reason: `${run.label} folds away: ${run.itemCount} items of around ${run.medianBodyLength} characters each are a run a reader dips into rather than reads through, so scanning beats reading, and this client's language permits disclosure.`,
  };
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
 * Emission is conditional on this plan: a client whose language and content
 * select nothing receives no helper source, no helper CSS and no client
 * JavaScript, so a still site pays nothing for the existence of the capability.
 */
export interface InteractionPlan {
  /** Every detail run the client's content offered, decided, in section order. */
  readonly disclosures: readonly DisclosureDecision[];
  readonly projectMedia: InteractionDecision<MediaTreatment>;
  /** Photographs a project beat needs before the overlay is offered. */
  readonly projectMediaThreshold: number;
  readonly usesDisclosure: boolean;
  readonly usesMediaExplorer: boolean;
  readonly usesReveal: boolean;
  /**
   * Whether the collapsed navigation gets a close that moves.
   *
   * Tied to the same appetite that buys its *open*, so the two are symmetric at
   * every value a client can author: a client that buys no navigation feedback
   * gets a menu that snaps both ways, which is a coherent expression, and one
   * that buys it gets movement both ways. What is not available is the
   * accidental middle — arriving with movement and leaving without it.
   */
  readonly usesMenuMotion: boolean;
  /** Whether a composition's reveal opportunity of this role is taken. */
  readonly reveals: (role: RevealRole) => boolean;
  /** Whether this client buys this kind of optional pointer/focus feedback. */
  readonly feedback: (role: FeedbackRole) => boolean;
  /**
   * Whether anything this client received actually animates.
   *
   * Read by the manifest. Disclosure and media exploration carry their own
   * movement and are decided from content semantics, so a client can select no
   * entrance and no pointer feedback and still be a site that animates. The
   * artifact has to say so.
   */
  readonly animates: boolean;
}

/** The disclosure decision for one section type, if that run was offered. */
export function disclosureFor(
  plan: InteractionPlan,
  sectionType: string,
): DisclosureDecision | undefined {
  return plan.disclosures.find(
    (decision) => decision.run.sectionType === sectionType,
  );
}

/** Whether the run from this section type folds. */
export function foldsAway(plan: InteractionPlan, sectionType: string): boolean {
  return disclosureFor(plan, sectionType)?.treatment === "PROGRESSIVE_DISCLOSURE";
}

export function planInteractions(input: {
  readonly interaction: ResolvedInteraction;
  /**
   * The routes this client's page graph actually carries. A capability whose
   * route does not exist is not a capability, and emitting its helper would put
   * dead source and a dead client chunk into the artifact.
   */
  readonly routeIds: readonly string[];
  /** The client's validated profile sections, in their authored order. */
  readonly sections: readonly { readonly type?: unknown }[];
}): InteractionPlan {
  const { interaction } = input;
  const has = (routeId: string) => input.routeIds.includes(routeId);

  /*
   * A run whose route does not exist is not an opportunity: folding a section
   * nobody can navigate to would emit a helper and a client chunk for a page
   * that is not in the artifact.
   */
  const routeForSection: Readonly<Record<string, string>> = {
    FAQ: "contact",
    POLICIES: "contact",
    PROCESS: "about",
    SERVICES: "services-index",
  };
  const disclosures = readDetailRuns(input.sections)
    .filter((run) => {
      const routeId = routeForSection[run.sectionType];
      return routeId === undefined ? false : has(routeId);
    })
    .map((run) => decideDisclosure(run, interaction));

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

  const usesDisclosure = disclosures.some(
    (decision) => decision.treatment === "PROGRESSIVE_DISCLOSURE",
  );
  const usesMediaExplorer = projectMedia.treatment === "DIALOG_EXPLORER";

  return Object.freeze({
    disclosures: Object.freeze(disclosures),
    projectMedia,
    projectMediaThreshold: threshold ?? 0,
    usesDisclosure,
    usesMediaExplorer,
    usesReveal: interaction.reveals,
    /*
     * Structured briefs only. A legacy brief asked for the A3 entrance floor,
     * and regenerating one of those approved clients has to produce the site
     * that was approved — a new client chunk it never shipped is exactly the
     * kind of drift that pin exists to prevent. A client that wants a menu
     * which closes as it opened says so in a Motion & Interaction Language.
     */
    usesMenuMotion:
      interaction.source === "STRUCTURED" &&
      feedsBack(interaction.appetite.pointerFeedback, "NAVIGATION"),
    reveals: (role: RevealRole) =>
      revealsRole(interaction.appetite.entrance, role),
    feedback: (role: FeedbackRole) =>
      feedsBack(interaction.appetite.pointerFeedback, role),
    animates: interaction.enabled || usesDisclosure || usesMediaExplorer,
  });
}
