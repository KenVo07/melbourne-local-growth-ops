/**
 * What a client's own content offers an interaction, stated before any decision
 * is taken about whether to accept the offer.
 *
 * This module knows nothing about accordions, dialogs, Profiles or clients. It
 * reads the semantic model and answers one question per opportunity: *what
 * shape is this content, and how does a reader use it?* Whether the shape
 * becomes an interaction is decided in `interaction-decisions.ts`, from this
 * plus the client's own Motion & Interaction Language.
 *
 * The separation is the point. Without it the generator ends up holding a table
 * of content types mapped to components — FAQ means accordion, gallery means
 * lightbox — which is a page builder with extra steps, and which produces the
 * same site for every client who happens to carry the same section types. With
 * it, two clients whose profiles carry identical section types can legitimately
 * receive different interactions, because the judgement reads the shape of the
 * actual content and the client's own language rather than the type name.
 */

/**
 * How a reader uses a run of titled detail. This, not the section's name, is
 * what decides whether folding the run away helps or hurts.
 *
 * LOOKUP   — the reader arrives holding one question and wants the one item
 *            that answers it. The other items are noise to them. Collapsing
 *            trades a scroll for a click and turns a wall into an index, so
 *            disclosure is a genuine improvement.
 * SEQUENCE — the items are ordered and the reader means to read all of them,
 *            in order, because the order carries the meaning. Collapsing costs
 *            one click per item and destroys the continuity that was the
 *            content, so disclosure is a loss however long the run is.
 * BROWSE   — the reader is comparing items against each other and needs them
 *            side by side. Collapsing makes comparison impossible.
 *
 * Only LOOKUP folds. A run being *long* is a reason to fold a LOOKUP and is not
 * a reason to fold a SEQUENCE: length is why we check, access is why we act.
 */
export type AccessPattern = "LOOKUP" | "SEQUENCE" | "BROWSE";

/**
 * A run of titled items each carrying a body of prose — the one content shape
 * in the semantic model that progressive disclosure can act on at all.
 *
 * FAQ, PROCESS and POLICIES are all this shape. That they are the same shape is
 * exactly why the treatment must be decided from `access` rather than from
 * `sectionType`: three sections that are structurally identical are used by
 * readers in three different ways.
 */
export interface DetailRun {
  /** Stable key, used for the emitted anchor namespace and in the report. */
  readonly key: string;
  /** The section type it came from, kept for the generation report only. */
  readonly sectionType: string;
  /** A sentence fragment naming the run, for the justification. */
  readonly label: string;
  readonly access: AccessPattern;
  readonly itemCount: number;
  /** Median body length in characters, across the run's items. */
  readonly medianBodyLength: number;
}

/**
 * Where a composition offers to reveal something on entrance, and what kind of
 * thing it is.
 *
 * ARGUMENT   — the composition that carries why the page exists. If a page
 *              reveals exactly one thing, this is the one.
 * SUPPORTING — material that substantiates the argument. Worth revealing on a
 *              site that wants a page to assemble itself; worth leaving still
 *              on a site that wants only its case to land.
 * MEDIA      — a photograph or plate. Kept distinct from prose not because it
 *              is more important but because it enters differently: prose
 *              lifts into place, a photograph resolves where it already is.
 */
export type RevealRole = "ARGUMENT" | "SUPPORTING" | "MEDIA";

/** The reveal roles an `entrance` value accepts. */
const entranceAccepts: Readonly<
  Record<"NONE" | "KEY_MOMENTS" | "EVERY_SECTION", readonly RevealRole[]>
> = {
  NONE: [],
  KEY_MOMENTS: ["ARGUMENT"],
  EVERY_SECTION: ["ARGUMENT", "SUPPORTING", "MEDIA"],
};

/**
 * Whether a composition's reveal opportunity of this role is taken, for a
 * client whose language asks for this much entrance.
 *
 * This is what makes `entrance` an honest control rather than a boolean: the
 * emitters declare every opportunity they have, and the three values genuinely
 * accept different subsets of them, so a KEY_MOMENTS site and an EVERY_SECTION
 * site differ in how many things move and in which things move.
 */
export function revealsRole(
  entrance: "NONE" | "KEY_MOMENTS" | "EVERY_SECTION",
  role: RevealRole,
): boolean {
  return entranceAccepts[entrance].includes(role);
}

/**
 * The optional pointer/focus feedback opportunities a composition carries.
 *
 * NAVIGATION — feedback on something that navigates: a row, a record, a link.
 *              A reader uses this to tell what is clickable, so it is the first
 *              expressive feedback a site should buy.
 * SURFACE    — feedback on a surface that is not itself a destination: a plate
 *              settling, a photograph acknowledging that it can be opened. Pure
 *              character; a site can be complete without it.
 *
 * Neither is an accessibility affordance. Focus rings, disabled states and the
 * open/closed marker are emitted at every `pointerFeedback` value including
 * NONE, and are not modelled here, because they are not optional.
 */
export type FeedbackRole = "NAVIGATION" | "SURFACE";

const feedbackAccepts: Readonly<
  Record<"NONE" | "ESSENTIAL" | "GENEROUS", readonly FeedbackRole[]>
> = {
  NONE: [],
  ESSENTIAL: ["NAVIGATION"],
  GENEROUS: ["NAVIGATION", "SURFACE"],
};

export function feedsBack(
  pointerFeedback: "NONE" | "ESSENTIAL" | "GENEROUS",
  role: FeedbackRole,
): boolean {
  return feedbackAccepts[pointerFeedback].includes(role);
}

/** The minimum shape this module needs from a validated profile section. */
interface SectionLike {
  readonly type?: unknown;
  readonly heading?: unknown;
  readonly items?: unknown;
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (upper === undefined) return 0;
  if (sorted.length % 2 === 1) return upper;
  return Math.round(((lower ?? upper) + upper) / 2);
}

/**
 * The body field each detail-shaped section carries, and how its readers use
 * it.
 *
 * A section type absent from this table offers no detail run — not because it
 * is unimportant, but because it is not this shape. TRUST_SIGNALS is a run of
 * bare strings with nothing behind them; TESTIMONIALS is attributed quotation
 * rather than titled detail; HOURS and LOCATION are tabular fact. Folding any
 * of them would produce controls that open onto nothing, or hide a fact a
 * reader came for. That judgement belongs here, once, in the open.
 */
const detailShapes: Readonly<
  Record<string, { readonly title: string; readonly body: string; readonly access: AccessPattern; readonly label: string }>
> = {
  FAQ: {
    title: "question",
    body: "answer",
    access: "LOOKUP",
    label: "Questions",
  },
  POLICIES: {
    title: "title",
    body: "body",
    access: "LOOKUP",
    label: "Policies",
  },
  PROCESS: {
    title: "title",
    body: "description",
    access: "SEQUENCE",
    label: "The method",
  },
  SERVICES: {
    title: "title",
    body: "description",
    access: "BROWSE",
    label: "Services",
  },
};

/**
 * Reads every detail run a client's sections offer.
 *
 * Returns opportunities, not decisions: a run appears here whether or not it
 * will end up folded, because the reason a run stayed visible is worth
 * reporting and cannot be given if the run was never noticed.
 */
export function readDetailRuns(
  sections: readonly SectionLike[],
): readonly DetailRun[] {
  const runs: DetailRun[] = [];
  for (const section of sections) {
    const type = typeof section.type === "string" ? section.type : undefined;
    if (type === undefined) continue;
    const shape = detailShapes[type];
    if (shape === undefined) continue;
    const items = Array.isArray(section.items) ? section.items : [];
    const bodies = items
      .map((item) =>
        typeof item === "object" && item !== null
          ? (item as Record<string, unknown>)[shape.body]
          : undefined,
      )
      .filter((value): value is string => typeof value === "string");
    if (bodies.length === 0) continue;
    runs.push(
      Object.freeze({
        key: type.toLowerCase(),
        sectionType: type,
        label:
          typeof section.heading === "string" && section.heading.trim() !== ""
            ? section.heading
            : shape.label,
        access: shape.access,
        itemCount: bodies.length,
        medianBodyLength: median(bodies.map((body) => body.length)),
      }),
    );
  }
  return Object.freeze(runs);
}
