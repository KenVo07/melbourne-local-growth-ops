import {
  translateZodIssues,
  type ValidationResult,
} from "@melbourne-local-growth-ops/contracts";
import { z } from "zod";

/**
 * The creative and editorial input to source generation.
 *
 * This is deliberately **not** a layout tree, a component registry or an
 * executable configuration. It records design *decisions* — type expression,
 * spatial rhythm, ground, media scale, which composition grammar each page kind
 * opens with — plus the client-specific copy and media assignments that the
 * validated client definition does not carry (alt text, service narrative, the
 * closing step). The generator turns those decisions into concrete client-local
 * source; nothing in this file reaches the built website.
 *
 * Two clients on the same Profile with different briefs must be able to produce
 * materially different websites. Everything continuous here (weights, tracking,
 * ratios, measures, units, densities) exists so variation is a design space
 * rather than a short list of themes.
 */

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9-]*$/);
const semanticVersion = z
  .string()
  .trim()
  .regex(/^\d+\.\d+\.\d+$/);
const shortText = z.string().trim().min(1).max(240);
const longText = z.string().trim().min(1).max(1200);
const hexColour = z
  .string()
  .trim()
  .regex(/^#[0-9a-f]{6}$/i);

/**
 * A CSS class prefix. Short, because it is repeated in every selector and every
 * className in the generated source, and lowercase so it never collides with a
 * component name.
 */
const namespace = z
  .string()
  .trim()
  .min(2)
  .max(6)
  .regex(/^[a-z][a-z0-9]*$/);

const focalPoint = z.strictObject({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
});

/**
 * Type families are named by their typographic character, not by a font file.
 * The generator resolves each to a system-available stack, so a generated site
 * ships no webfont request and no dependency, and an operator who later licenses
 * a real face edits one line of the generated stylesheet.
 */
export const StarterTypeFamilySchema = z.enum([
  "HUMANIST_SANS",
  "GEOMETRIC_SANS",
  "GROTESQUE_SANS",
  "TRANSITIONAL_SERIF",
  "MODERN_SERIF",
]);

export const StarterTypographySchema = z.strictObject({
  displayFamily: StarterTypeFamilySchema,
  textFamily: StarterTypeFamilySchema,
  /** Display weight. Light display type reads calm; heavy reads industrial. */
  displayWeight: z.number().int().min(200).max(800),
  /** Display letter-spacing in em. Negative tightens large type. */
  displayTracking: z.number().min(-0.06).max(0.08),
  /** Display line-height as a unitless ratio. */
  displayLeading: z.number().min(0.85).max(1.4),
  /** Modular scale ratio between type steps. */
  scaleRatio: z.number().min(1.1).max(1.8),
  /** Body size in rem. */
  baseSize: z.number().min(0.9375).max(1.1875),
  /** Body line-height. */
  bodyLeading: z.number().min(1.3).max(1.9),
  /** Reading measure in rem. Controls line length everywhere prose appears. */
  measure: z.number().min(24).max(48),
  /** How a display line emphasises its operative phrase. */
  emphasis: z.enum(["ITALIC", "WEIGHT", "ACCENT", "NONE"]),
  label: z.strictObject({
    case: z.enum(["UPPER", "SENTENCE"]),
    tracking: z.number().min(-0.02).max(0.3),
    weight: z.number().int().min(300).max(800),
    size: z.number().min(0.625).max(1),
  }),
});

export const StarterSpaceSchema = z.strictObject({
  /** The spacing unit every other space is a multiple of, in rem. */
  unit: z.number().min(0.25).max(1),
  /** Maximum content width in rem. */
  shell: z.number().min(60).max(104),
  /** Vertical generosity. Multiplies every section's block padding. */
  density: z.enum(["COMPACT", "MEASURED", "EXPANSIVE"]),
  /** Column gap between the two halves of a split composition, in units. */
  gutter: z.number().min(2).max(16),
  /** Viewport inset at small sizes, in units. */
  inset: z.number().min(2).max(10),
});

export const StarterColourSchema = z.strictObject({
  /**
   * The page ground. Accent, surface and ink are bound from the validated
   * `profile.brand` at runtime and are never written into generated CSS; the
   * ground is the one colour decision the brand contract does not carry.
   */
  ground: z.enum([
    "WARM_PAPER",
    "COOL_STONE",
    "MINERAL_CLAY",
    "NEUTRAL_LIGHT",
    "DEEP_INK",
  ]),
  /** How hard the neutral scale separates. */
  contrast: z.enum(["SOFT", "CRISP"]),
});

export const StarterMediaSchema = z.strictObject({
  /** How much of a composition photography is allowed to take. */
  scale: z.enum(["RESTRAINED", "BALANCED", "DOMINANT"]),
  /** Where a photograph's provenance line sits. */
  caption: z.enum(["BELOW", "MARGIN"]),
  /** Corner treatment of every framed photograph, in rem. */
  radius: z.number().min(0).max(1.5),
  /** The provenance line every photograph carries. */
  provenanceCaption: shortText,
});

/**
 * The opening grammar each page kind uses. These are generation-time source
 * strategies, not runtime configuration: the generator emits concrete,
 * hand-shaped TSX for the chosen one and nothing for the others. There is no
 * arbitrary component tree and no visual-builder schema — a page kind picks one
 * coherent composition and the emitted source is then free to diverge.
 */
export const StarterCompositionSchema = z.strictObject({
  home: z.enum(["SPLIT_STATEMENT", "IMAGE_LED"]),
  servicesIndex: z.enum(["ALTERNATING_ROWS", "STAGGERED_COLUMNS"]),
  serviceDetail: z.enum(["READING_COLUMN_RAIL", "MEDIA_INTERRUPT"]),
  projectsIndex: z.enum(["EDITORIAL_RECORDS", "STAGGERED_INDEX"]),
  projectDetail: z.enum(["DOCUMENT", "STAGGERED_BEATS"]),
  about: z.enum(["PROSE_PORTRAIT", "METHOD_LED"]),
  contact: z.enum(["PANEL_SPLIT", "STACKED_DIRECT"]),
});

export const StarterMotionSchema = z.enum(["NONE", "MICRO", "ENTRANCE"]);

/**
 * The client's Motion & Interaction Language.
 *
 * This describes *character and rules* — how state changes should feel and how
 * willing the site is to fold detail away — in the same vocabulary the rest of
 * this brief uses. It is deliberately **not** a timeline, a per-element script,
 * or a set of engine values: nothing here is a millisecond, a cubic-bezier
 * control point or a pixel. A trained delivery specialist (or AWOS) writing a
 * brief should be describing a client's temperament, not tuning an animation.
 *
 * `decisions.ts` resolves these into the concrete durations, curves and travel
 * distances the emitters write, exactly as it already does for typography,
 * spacing, colour and media. Two clients on one Profile can therefore differ in
 * *kind* — one folds its questions away and explores media in an overlay, the
 * other keeps everything visible and still — rather than differing by a
 * constant.
 */
export const StarterInteractionSchema = z.strictObject({
  /** The pace of every state change. Sets the tempo the whole site keeps. */
  tempo: z.enum(["BRISK", "MEASURED", "UNHURRIED"]),
  /**
   * How a movement begins and resolves. IMMEDIATE responds the instant it is
   * asked and stops crisply; EASED is the familiar considered curve; SETTLED
   * takes its time leaving and arrives slowly, which reads as weight.
   */
  attack: z.enum(["IMMEDIATE", "EASED", "SETTLED"]),
  /**
   * How far things move when they move. 0 is a site that changes state without
   * travelling at all; 1 is generous movement. Also scales how much a revealed
   * element fades, because something that travels far should arrive rather than
   * simply appear.
   */
  travel: z.number().min(0).max(1),
  /**
   * Tolerance for a movement passing its destination and returning. 0 never
   * overshoots. Higher values read as springy and suit a livelier client; they
   * are applied only to entering and state movement, never to exits.
   */
  overshoot: z.number().min(0).max(1),
  /**
   * How much *optional* expressive feedback the site gives a pointer or the
   * keyboard.
   *
   * This is a genuine three-way choice, not a dial with two ends: each value
   * selects a different set of the interactive opportunities a page actually
   * carries. NONE responds only where a response is information — a control
   * that is doing something. ESSENTIAL adds the things that navigate, so a row
   * that is a link says so under the pointer. GENEROUS adds the optional
   * surface feedback on top of that: photographs that can be opened, secondary
   * links, plate settling.
   *
   * It never governs accessibility. Focus rings, disabled states and every
   * other piece of feedback a reader *needs* in order to operate the page are
   * emitted at every value including NONE, because they are usability rather
   * than expression.
   */
  pointerFeedback: z.enum(["NONE", "ESSENTIAL", "GENEROUS"]),
  /**
   * How much of a page arrives rather than simply being present.
   *
   * KEY_MOMENTS reveals only the compositions that carry a page's argument,
   * which is what keeps a site from reading as generic fade-up on every
   * section; EVERY_SECTION reveals the supporting material too. Each value
   * selects a different set of the reveal opportunities the composition
   * declares, so the count of things that move genuinely differs between them
   * rather than the choice collapsing into on/off.
   */
  entrance: z.enum(["NONE", "KEY_MOMENTS", "EVERY_SECTION"]),
  /**
   * Appetite for folding secondary detail away in place. ALWAYS_VISIBLE never
   * collapses content; WHEN_LONG collapses only where the run of content is
   * genuinely long enough that scanning beats reading; PREFERRED collapses
   * wherever the semantics permit it.
   */
  disclosure: z.enum(["ALWAYS_VISIBLE", "WHEN_LONG", "PREFERRED"]),
  /**
   * Appetite for focused media exploration. EDITORIAL_ONLY leaves photographs
   * as composed; the others add an optional overlay *in addition to* the
   * visible media, never instead of it.
   */
  mediaExploration: z.enum(["EDITORIAL_ONLY", "WHEN_PLURAL", "PREFERRED"]),
  /**
   * What a reader who asks for reduced motion is left with. INSTANT changes
   * state with no travel and no duration; BRIEF_FADE keeps a short opacity
   * acknowledgement so a change still registers. Neither hides content, and
   * both preserve open/closed/selected/submitted meaning.
   */
  reducedMotion: z.enum(["INSTANT", "BRIEF_FADE"]),
});

export const StarterNavigationSchema = z.strictObject({
  /** Width in rem below which primary navigation collapses into a disclosure. */
  collapseAt: z.number().min(30).max(80),
  wordmark: z.enum(["UPPER", "AS_WRITTEN"]),
  menuLabel: shortText,
});

/** A site-level photograph the client definition does not attach to a project. */
export const StarterMediaPlacementSchema = z.strictObject({
  assetId: identifier,
  alt: longText,
  focal: focalPoint.default({ x: 0.5, y: 0.5 }),
  mobileFocal: focalPoint.optional(),
});

/**
 * Client copy the validated definition has nowhere to carry. It is emitted into
 * one generated `content/` module rather than scattered through the routes, so
 * an operator edits prose in one obvious place.
 */
export const StarterCopySchema = z.strictObject({
  homeEyebrow: shortText,
  homeHeadline: shortText,
  /** The phrase inside the headline that carries the emphasis treatment. */
  homeHeadlineEmphasis: shortText.optional(),
  homeLede: longText,
  homePrimaryAction: shortText,
  homeSecondaryAction: shortText,
  homeServicesHeading: shortText,
  homeProjectsHeading: shortText,
  servicesEyebrow: shortText,
  servicesLede: longText,
  serviceMoreLabel: shortText,
  questionsEyebrow: shortText,
  evidenceEyebrow: shortText,
  projectsEyebrow: shortText,
  projectsLede: longText,
  relatedRecordLabel: shortText,
  aboutEyebrow: shortText,
  aboutLede: longText,
  methodEyebrow: shortText,
  methodLede: longText,
  claimsEyebrow: shortText,
  contactEyebrow: shortText,
  contactHeading: shortText,
  checklistEyebrow: shortText,
  contactChecklist: z.array(shortText).min(1).max(6),
  channelsEyebrow: shortText,
  faqEyebrow: shortText,
  /*
   * Only rendered by a client whose profile carries a POLICIES section, so it
   * carries a default rather than forcing every brief to answer for a section
   * most clients do not have.
   */
  policiesEyebrow: shortText.default("Terms"),
  nextStepEyebrow: shortText,
  nextStepHeading: shortText,
  nextStepBody: longText,
  footerStatement: longText,
  footerEnquiries: longText,
  notFoundLabel: shortText,
  notFoundHeading: shortText,
  notFoundBody: longText,
});

export const StarterServiceNarrativeSchema = z.strictObject({
  serviceId: identifier,
  body: longText,
  questions: z.array(shortText).min(1).max(6),
  media: StarterMediaPlacementSchema,
});

export const StarterBriefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  experienceId: identifier,
  experienceVersion: semanticVersion,
  namespace,
  creative: z.strictObject({
    thesis: longText,
    perceptionTargets: z.array(shortText).min(1).max(10),
    antiTargets: z.array(shortText).min(1).max(10),
  }),
  typography: StarterTypographySchema,
  space: StarterSpaceSchema,
  colour: StarterColourSchema,
  media: StarterMediaSchema,
  composition: StarterCompositionSchema,
  motion: StarterMotionSchema,
  /**
   * Optional. A brief written before WEB-01C carries only `motion`, and every
   * such brief stays valid: `resolveInteraction` normalises the three legacy
   * values into the same resolved language this field produces, so an old
   * client regenerates unchanged.
   */
  interaction: StarterInteractionSchema.optional(),
  navigation: StarterNavigationSchema,
  copy: StarterCopySchema,
  mediaPlan: z.strictObject({
    homeHero: StarterMediaPlacementSchema,
    homeSecondary: StarterMediaPlacementSchema.optional(),
    about: StarterMediaPlacementSchema,
  }),
  serviceNarratives: z.array(StarterServiceNarrativeSchema).min(1).max(24),
  /**
   * Optional override of the ground's derived neutral scale. Present so an
   * operator can pin a considered value; absent, the generator derives one and
   * proves it clears WCAG AA against both the ground and the validated brand
   * surface before writing it.
   */
  neutralOverrides: z
    .strictObject({
      paper: hexColour.optional(),
      inkMuted: hexColour.optional(),
      inkFaint: hexColour.optional(),
      rule: hexColour.optional(),
      ruleSoft: hexColour.optional(),
    })
    .optional(),
});

export type StarterTypeFamily = z.infer<typeof StarterTypeFamilySchema>;
export type StarterTypography = z.infer<typeof StarterTypographySchema>;
export type StarterSpace = z.infer<typeof StarterSpaceSchema>;
export type StarterColour = z.infer<typeof StarterColourSchema>;
export type StarterMedia = z.infer<typeof StarterMediaSchema>;
export type StarterComposition = z.infer<typeof StarterCompositionSchema>;
export type StarterMotion = z.infer<typeof StarterMotionSchema>;
export type StarterInteraction = z.infer<typeof StarterInteractionSchema>;
export type StarterNavigation = z.infer<typeof StarterNavigationSchema>;
export type StarterMediaPlacement = z.infer<typeof StarterMediaPlacementSchema>;
export type StarterCopy = z.infer<typeof StarterCopySchema>;
export type StarterServiceNarrative = z.infer<
  typeof StarterServiceNarrativeSchema
>;
export type StarterBrief = z.infer<typeof StarterBriefSchema>;

export function validateStarterBrief(
  input: unknown,
): ValidationResult<StarterBrief> {
  const parsed = StarterBriefSchema.safeParse(input);
  return parsed.success
    ? { success: true, data: deepFreeze(parsed.data) }
    : { success: false, issues: translateZodIssues(parsed.error.issues) };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
