import type { ResolvedDesign } from "../decisions.js";
import type { InteractionPlan } from "../interaction-decisions.js";
import {
  disclosureStyles,
  interactionReducedMotion,
  interactionVariables,
  overlayStyles,
} from "./interaction-styles.js";

/**
 * Emits the client's own stylesheet.
 *
 * Everything here is written **into the client's source tree**. There is no
 * shared runtime stylesheet, no import from the Factory and no cascade the
 * client cannot see: an operator opens one file and edits real CSS.
 *
 * The layout discipline is the part worth reading. A2's compositions were
 * technically aligned but not optically settled — headings, supporting copy and
 * actions each found their own left edge, section labels floated free of the
 * headings they introduced, and short headings stranded tall empty columns. Three
 * mechanisms fix that here and are used by every grammar:
 *
 *   `--edge`          one inline inset shared by the shell and every full-bleed
 *                     section, so content edges line up down the whole page.
 *   `--label-offset`  the exact height a label + its gap occupies, applied as
 *                     top padding to the column *beside* a labelled heading, so
 *                     the two columns share a first baseline instead of being
 *                     merely top-aligned.
 *   `--measure` /     separate line-length caps for prose and for display type,
 *   `--measure-display` so a heading wraps on a considered word rather than at
 *                     the width of whatever column it landed in.
 */
export function emitStylesheet(
  design: ResolvedDesign,
  plan: InteractionPlan,
): string {
  const sections = [
    header(design),
    root(design, plan),
    reset(design),
    primitives(design),
    actions(design),
    plates(design),
    chrome(design),
    footer(design),
    pageHead(design),
    homeGrammar(design),
    servicesGrammar(design),
    serviceDetailGrammar(design),
    projectsGrammar(design),
    projectDetailGrammar(design),
    aboutGrammar(design),
    contactGrammar(design),
    notFound(design),
    platformModules(design),
    plan.animates ? motion(design, plan) : "",
    plan.usesDisclosure ? disclosureStyles(design) : "",
    plan.usesMediaExplorer ? overlayStyles(design) : "",
    responsive(design),
    reducedMotion(design, plan),
  ];
  return `${sections.filter((section) => section.trim().length > 0).join("\n").trimEnd()}\n`;
}

function header(design: ResolvedDesign): string {
  const { brief } = design;
  return `/*
 * ${titleCase(brief.experienceId)} — client-owned stylesheet.
 *
 * Generated as a starting point by the Proportion P1 Experience Starter and then
 * owned outright by this client. Nothing in the built website reads from the
 * generator; this file is ordinary CSS and is meant to be edited.
 *
 * Grammar: ${brief.creative.perceptionTargets.join(", ")}.
 * Deliberately not: ${brief.creative.antiTargets.join(", ")}.
 *
 * Brand colour is not written here. The Shell binds --accent, --accent-contrast,
 * --surface and --ink from the client's validated profile.brand, so the
 * configured palette is the one that renders. The neutral ground below is a
 * design decision the brand contract does not carry; each derived neutral was
 * proved to clear WCAG AA against both the ground and the configured surface
 * before it was written.
 */
`;
}

function root(design: ResolvedDesign, plan: InteractionPlan): string {
  const { ns, type, space, colour, media } = design;
  return `
.${ns} {
  /* Fallbacks only — the Shell overrides all four from validated client data. */
  --accent: ${colour.inkMuted};
  --accent-contrast: ${colour.paper};
  --surface: ${colour.ruleSoft};
  --ink: ${design.brief.colour.ground === "DEEP_INK" ? colour.paper : "#111"};

  --paper: ${colour.paper};
  --ink-muted: ${colour.inkMuted};
  --ink-faint: ${colour.inkFaint};
  --rule: ${colour.rule};
  --rule-soft: ${colour.ruleSoft};

  --unit: ${space.unit};
  --shell: ${space.shell};
  /* One inline inset. Every shell and every full-bleed section uses it, which is
     what makes the left edge of the page a single line rather than four. */
  --edge: calc(var(--unit) * ${space.inset});
  --gutter: calc(var(--unit) * ${space.gutter});

  --measure: ${type.measure};
  /* Display type wraps on a measure of its own; without this a two-word heading
     runs the full width of a 78rem shell and stops reading as a heading. */
  --measure-display: 20ch;

  --stack-tight: calc(var(--unit) * ${space.stack.tight});
  --stack: calc(var(--unit) * ${space.stack.normal});
  --stack-loose: calc(var(--unit) * ${space.stack.loose});
  --section: calc(var(--unit) * ${space.section.wide});

  /* The exact vertical space a label plus its gap occupies. Applied as top
     padding to the column beside a labelled heading so the two share a first
     baseline. */
  --label-offset: calc(${type.label.size} * 1.4 + var(--stack-tight));

  --display: ${type.displayStack};
  --text: ${type.textStack};

  --media-radius: ${media.radius};
${plan.animates ? interactionVariables(design) : ""}

  background: var(--paper);
  color: var(--ink);
  font-family: var(--text);
  font-size: ${type.body};
  line-height: ${type.bodyLeading};
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
`;
}

function reset(design: ResolvedDesign): string {
  const { ns, type } = design;
  return `
/* Neutralise the Platform's global element defaults inside the authored surface. */
.${ns} h1,
.${ns} h2,
.${ns} h3,
.${ns} h4 {
  font-family: var(--display);
  font-weight: ${type.displayWeight};
  font-size: inherit;
  line-height: ${type.displayLeading};
  letter-spacing: ${type.displayTracking};
  margin: 0;
  max-width: none;
  text-wrap: balance;
}

.${ns} p {
  margin: 0;
  text-wrap: pretty;
}

.${ns} ul,
.${ns} ol,
.${ns} dl {
  margin: 0;
  padding: 0;
  list-style: none;
}

.${ns} dd {
  margin: 0;
}

.${ns} a {
  color: inherit;
  text-decoration: none;
}

.${ns} :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
  border-radius: 2px;
}

.${ns} main:focus {
  outline: none;
}
`;
}

function primitives(design: ResolvedDesign): string {
  const { ns, type } = design;
  return `
/* ----------------------------------------------------------- primitives */

.${ns}-shell {
  width: min(100% - (var(--edge) * 2), var(--shell));
  margin-inline: auto;
}

/* Full-bleed, but its *contents* still respect the one shared content edge. */
.${ns}-bleed {
  padding-inline: var(--edge);
}

.${ns}-label {
  font-family: var(--text);
  font-size: ${type.label.size};
  font-weight: ${type.label.weight};
  letter-spacing: ${type.label.tracking};
  text-transform: ${type.label.transform};
  line-height: 1.4;
  color: var(--ink-muted);
  font-variant-numeric: tabular-nums;
  margin: 0;
}

/*
 * These five carry a descendant selector on purpose. The Platform's globals set
 * a bare \`h1 { font-size: clamp(2.75rem, 10vw, 6.75rem) }\`, and the element
 * reset above has to outrank it — which means the reset (0,1,1) would in turn
 * outrank a single class (0,1,0) and every heading on the site would render at
 * body size. Scoping these to \`.${ns} .${ns}-*\` (0,2,0) puts the type scale
 * back on top of both.
 */
/*
 * These carry the whole display treatment, not only a size, because they are
 * applied to <p>, <dt> and <span> as well as to headings — and on those the
 * h1..h4 reset above never runs. A section title set on a paragraph was
 * inheriting the 1.62 body leading and reading as loose, unset type.
 */
.${ns} .${ns}-display,
.${ns} .${ns}-page-title,
.${ns} .${ns}-section-title,
.${ns} .${ns}-item-title,
.${ns} .${ns}-record-title,
.${ns} .${ns}-row-title,
.${ns} .${ns}-step-title,
.${ns} .${ns}-proof-value,
.${ns} .${ns}-footer-statement,
.${ns} .${ns}-facts dd,
.${ns} .${ns}-faq dt {
  font-family: var(--display);
  font-weight: ${type.displayWeight};
  line-height: ${type.displayLeading};
  letter-spacing: ${type.displayTracking};
  text-wrap: balance;
  color: var(--ink);
}

.${ns} .${ns}-display {
  font-size: ${type.hero};
  max-width: var(--measure-display);
}

.${ns} .${ns}-page-title {
  font-size: ${type.pageTitle};
  max-width: var(--measure-display);
}

.${ns} .${ns}-section-title {
  font-size: ${type.sectionTitle};
  max-width: var(--measure-display);
}

.${ns} .${ns}-item-title {
  font-size: ${type.itemTitle};
}

/*
 * A compact two- or three-part row: an index, a title, and one piece of
 * metadata. Used wherever a list has to stay scannable rather than become a
 * card. It collapses to two lines on a phone rather than crushing the title.
 */
.${ns}-row-compact {
  display: grid;
  grid-template-columns: calc(var(--unit) * 5) minmax(0, 1fr) auto;
  column-gap: var(--stack);
  row-gap: var(--stack-tight);
  align-items: baseline;
  padding-block: calc(var(--unit) * 4);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-row-compact[data-columns="two"] {
  grid-template-columns: minmax(0, 1fr) auto;
}

.${ns}-lede {
  font-size: ${type.lede};
  line-height: ${Math.max(1.3, Number(type.bodyLeading) - 0.05).toFixed(2)};
  color: var(--ink-muted);
  max-width: var(--measure);
}

.${ns}-prose {
  display: grid;
  gap: var(--stack);
  max-width: var(--measure);
  color: var(--ink-muted);
}

.${ns}-prose strong {
  color: var(--ink);
  font-weight: 600;
}

/* Supporting metadata: same family as body, but never mistakable for it. */
.${ns}-meta {
  font-size: ${type.small};
  line-height: 1.45;
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.${ns}-rule {
  border: 0;
  border-top: 1px solid var(--rule);
  margin: 0;
}
${emphasisRule(design)}`;
}

function emphasisRule(design: ResolvedDesign): string {
  const { ns, type } = design;
  switch (type.emphasis) {
    case "ITALIC":
      return `
.${ns}-emphasis {
  font-style: italic;
}
`;
    case "WEIGHT":
      return `
.${ns}-emphasis {
  font-style: normal;
  font-weight: ${Math.min(900, type.displayWeight + 300)};
}
`;
    case "ACCENT":
      return `
.${ns}-emphasis {
  font-style: normal;
  color: var(--accent);
}
`;
    default:
      return `
.${ns}-emphasis {
  font-style: normal;
}
`;
  }
}

function actions(design: ResolvedDesign): string {
  const { ns, type } = design;
  return `
/* --------------------------------------------------------------- actions */

.${ns}-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--stack);
}

.${ns}-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 48px;
  padding-inline: calc(var(--unit) * 3.5);
  background: var(--accent);
  color: var(--accent-contrast);
  font-family: var(--text);
  font-size: ${type.small};
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: ${type.label.transform};
  border-radius: var(--media-radius);
  transition: background var(--motion-duration) var(--motion-ease);
}

.${ns}-action:hover {
  background: color-mix(in srgb, var(--accent) 84%, var(--ink));
}

.${ns}-action-quiet {
  background: transparent;
  color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--rule);
}

.${ns}-action-quiet:hover {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--ink);
}

/* A text link that reads as the next step rather than as a button. */
.${ns}-onward {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--unit) * 1.25);
  min-height: 44px;
  font-size: ${type.body};
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  transition: border-color var(--motion-duration) var(--motion-ease);
}

.${ns}-onward::after {
  content: "\\2192";
  transition: transform var(--motion-duration) var(--motion-ease);
}

.${ns}-onward:hover {
  border-bottom-color: var(--ink);
}

.${ns}-onward:hover::after {
  transform: translateX(0.25em);
}
`;
}

function plates(design: ResolvedDesign): string {
  const { ns, media, type } = design;
  const caption =
    media.caption === "MARGIN"
      ? `
.${ns}-plate figcaption {
  margin-top: calc(var(--unit) * 1.5);
  padding-left: calc(var(--unit) * 2);
  border-left: 1px solid var(--rule);
  font-size: ${type.small};
  line-height: 1.4;
  color: var(--ink-faint);
  max-width: var(--measure);
}
`
      : `
.${ns}-plate figcaption {
  margin-top: calc(var(--unit) * 1.5);
  font-size: ${type.small};
  line-height: 1.4;
  color: var(--ink-faint);
  max-width: var(--measure);
}
`;
  return `
/* ---------------------------------------------------------------- plates */

/*
 * The Platform guarantees an image never overflows its box and resolves the
 * focal point per viewport. Framing is ours: the ratio, the corner and the
 * provenance line.
 */
.${ns}-plate {
  margin: 0;
  display: block;
}

.${ns}-plate img {
  display: block;
  width: 100%;
  height: auto;
  border-radius: var(--media-radius);
  background: var(--surface);
}

.${ns}-plate[data-ratio="wide"] img {
  aspect-ratio: ${media.ratios.wide};
}

.${ns}-plate[data-ratio="tall"] img {
  aspect-ratio: ${media.ratios.tall};
}

.${ns}-plate[data-ratio="square"] img {
  aspect-ratio: ${media.ratios.square};
}

.${ns}-plate[data-ratio="panorama"] img {
  aspect-ratio: ${media.ratios.panorama};
}

.${ns}-plate[data-ratio="natural"] img {
  aspect-ratio: auto;
}
${caption}`;
}

function chrome(design: ResolvedDesign): string {
  const { ns, type, brief } = design;
  return `
/* ---------------------------------------------------------------- chrome */

.${ns}-skip {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 10;
  padding: calc(var(--unit) * 2) calc(var(--unit) * 3);
  background: var(--ink);
  color: var(--paper);
  font-size: ${type.small};
}

.${ns}-skip:focus-visible {
  left: var(--edge);
  top: var(--edge);
}

.${ns}-header {
  position: relative;
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
}

.${ns}-header-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: calc(var(--unit) * 3);
  min-height: calc(var(--unit) * 14);
}

.${ns}-wordmark {
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${Math.min(900, brief.typography.displayWeight + 100)};
  letter-spacing: ${brief.navigation.wordmark === "UPPER" ? "0.14em" : "-0.01em"};
  text-transform: ${brief.navigation.wordmark === "UPPER" ? "uppercase" : "none"};
  line-height: 1;
  color: var(--ink);
}

.${ns}-nav ul {
  display: flex;
  align-items: center;
  gap: calc(var(--unit) * 5);
}

.${ns}-nav a {
  display: inline-flex;
  align-items: center;
  min-height: 44px;
  font-size: ${type.small};
  letter-spacing: 0.02em;
  color: var(--ink-muted);
  border-bottom: 1px solid transparent;
  transition: color var(--motion-duration) var(--motion-ease),
    border-color var(--motion-duration) var(--motion-ease);
}

.${ns}-nav a:hover,
.${ns}-nav a[data-current="true"] {
  color: var(--ink);
  border-bottom-color: var(--accent);
}

.${ns}-header-actions {
  display: flex;
  align-items: center;
  gap: calc(var(--unit) * 3);
}

/*
 * platform.Disclosure renders the navigation twice and keeps exactly one of the
 * two live. The Platform hides the compact instance by default; these two rules
 * are where this client decides the swap happens.
 */
.${ns}-menu {
  display: none;
}

.${ns}-menu-toggle {
  display: inline-flex;
  align-items: center;
  gap: calc(var(--unit) * 1.5);
  min-height: 48px;
  padding-inline: calc(var(--unit) * 2);
  margin-right: calc(var(--unit) * -2);
  font-family: var(--text);
  font-size: ${type.small};
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  list-style: none;
}

.${ns}-menu-toggle::-webkit-details-marker {
  display: none;
}

.${ns}-menu-panel {
  position: absolute;
  left: 0;
  right: 0;
  top: 100%;
  z-index: 9;
  background: var(--paper);
  border-bottom: 1px solid var(--rule);
  padding-block: calc(var(--unit) * 2) calc(var(--unit) * 5);
}

.${ns}-menu-panel .${ns}-nav ul {
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  width: min(100% - (var(--edge) * 2), var(--shell));
  margin-inline: auto;
}

.${ns}-menu-panel .${ns}-nav a {
  display: block;
  padding-block: calc(var(--unit) * 2.5);
  font-size: ${type.lede};
  color: var(--ink);
  border-bottom: 1px solid var(--rule-soft);
}
`;
}

function footer(design: ResolvedDesign): string {
  const { ns, type } = design;
  return `
/* ---------------------------------------------------------------- footer */

.${ns}-footer {
  margin-top: var(--section);
  border-top: 1px solid var(--rule);
  padding-block: calc(var(--unit) * 9) calc(var(--unit) * 5);
}

.${ns}-footer-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.9fr) minmax(0, 1fr) minmax(0, 1.15fr);
  gap: var(--gutter);
  align-items: start;
}

.${ns}-footer-statement {
  font-size: ${type.itemTitle};
  max-width: 30ch;
}

.${ns}-footer h2 {
  font-family: var(--text);
  font-size: ${type.label.size};
  font-weight: ${type.label.weight};
  letter-spacing: ${type.label.tracking};
  text-transform: ${type.label.transform};
  color: var(--ink-muted);
  margin-bottom: var(--stack-tight);
}

.${ns}-footer nav li + li {
  margin-top: calc(var(--unit) * 1.25);
}

.${ns}-footer nav a {
  font-size: ${type.small};
  color: var(--ink-muted);
  border-bottom: 1px solid transparent;
  transition: color var(--motion-duration) var(--motion-ease);
}

.${ns}-footer nav a:hover {
  color: var(--ink);
  border-bottom-color: var(--rule);
}

.${ns}-colophon {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: calc(var(--unit) * 2);
  margin-top: calc(var(--unit) * 9);
  padding-top: calc(var(--unit) * 3);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-colophon p {
  font-size: ${type.small};
  color: var(--ink-faint);
  max-width: var(--measure);
}
`;
}

function pageHead(design: ResolvedDesign): string {
  const { ns } = design;
  return `
/* ------------------------------------------------------------- page head */

/*
 * The standard opening. Two columns, and the supporting column is pushed down
 * by exactly one label height so its first line sits on the heading's first
 * baseline rather than floating above it.
 */
.${ns}-head {
  display: grid;
  grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: calc(var(--unit) * ${design.space.section.mid}) var(--stack-loose);
}

.${ns}-head-main > * + * {
  margin-top: var(--stack-tight);
}

.${ns}-head-aside {
  padding-top: var(--label-offset);
}

.${ns}-head-aside > * + * {
  margin-top: var(--stack);
}

/* Keeps a short section heading beside a long list instead of stranding a tall
   empty column next to it. */
.${ns}-sticky {
  position: sticky;
  top: calc(var(--unit) * 6);
  align-self: start;
}
`;
}

function homeGrammar(design: ResolvedDesign): string {
  const { ns, type, media, brief } = design;
  const shared = `
/* ------------------------------------------------------------------ home */

/* The service register: an ordered index, not a card grid. */
.${ns}-register {
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}

.${ns}-register-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.15fr);
  gap: var(--gutter);
  align-items: start;
  margin-bottom: var(--stack-loose);
}

.${ns}-register-head .${ns}-lede {
  padding-top: var(--label-offset);
}

.${ns}-row {
  display: grid;
  grid-template-columns: calc(var(--unit) * 5) minmax(0, 1fr) minmax(0, 1.5fr);
  column-gap: var(--stack-loose);
  row-gap: var(--stack-tight);
  align-items: baseline;
  padding-block: calc(var(--unit) * 5);
  border-top: 1px solid var(--rule-soft);
  transition: background var(--motion-duration) var(--motion-ease);
}

.${ns}-row:hover {
  background: color-mix(in srgb, var(--surface) 45%, transparent);
}

.${ns}-row-index {
  font-size: ${type.small};
  font-variant-numeric: tabular-nums;
  color: var(--ink-faint);
  letter-spacing: ${type.label.tracking};
}

.${ns}-row-title {
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  line-height: ${design.type.displayLeading};
  color: var(--ink);
}

.${ns}-row-text {
  font-size: ${type.body};
  line-height: 1.55;
  color: var(--ink-muted);
  max-width: var(--measure);
}

/* Project preview: a short list that closes the home page on the work. */
.${ns}-preview {
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
  gap: var(--gutter);
  align-items: start;
}

/* Travels with the list rather than sitting at the top of a tall void. */
.${ns}-preview > div:first-child {
  position: sticky;
  top: calc(var(--unit) * 6);
}

.${ns}-preview-aside {
  padding-top: var(--label-offset);
}
`;

  if (brief.composition.home === "IMAGE_LED") {
    return `${shared}
/* Home opening — image-led. The photograph carries the first screen and the
   proposition is set beneath it on an offset column, so the identity, the offer
   and both next steps are the first things read after the image. */
.${ns}-cover {
  padding-top: calc(var(--unit) * 4);
}

.${ns}-cover-media .${ns}-plate img {
  aspect-ratio: ${media.ratios.panorama};
  /*
   * Capped so the label and the first line of the proposition are above the
   * fold. An image-led opening should introduce the argument, not replace it.
   */
  max-height: min(70vh, 34rem);
  object-fit: cover;
  border-radius: var(--media-radius);
}

.${ns}-cover-copy {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--stack-loose) var(--section);
}

.${ns}-cover-copy .${ns}-display {
  margin-top: var(--stack-tight);
}

.${ns}-cover-aside {
  padding-top: var(--label-offset);
  display: grid;
  gap: var(--stack);
}

/* A compact band of structured facts, set against the ground rather than in
   boxes, so the page has one dense moment between two open ones. */
.${ns}-proof {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gutter);
  padding-block: calc(var(--unit) * 6);
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
}

.${ns}-proof > div > p + p {
  margin-top: var(--stack-tight);
}

.${ns}-proof-value {
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  color: var(--ink);
}
`;
  }

  return `${shared}
/* Home opening — split statement. The photograph sits beside the proposition
   rather than above it, so nothing that matters is pushed below a media hero. */
.${ns}-hero {
  display: grid;
  grid-template-columns: minmax(0, ${(1 - media.splitWeight).toFixed(2)}fr) minmax(0, ${media.splitWeight.toFixed(2)}fr);
  gap: var(--gutter);
  align-items: center;
  padding-block: var(--section);
}

.${ns}-hero-copy > * + * {
  margin-top: var(--stack);
}

.${ns}-hero-copy .${ns}-display {
  margin-top: var(--stack-tight);
}

.${ns}-hero-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--stack);
  margin-top: var(--stack-loose);
}

/* A full-bleed band, used once, where the photography earns the width. */
.${ns}-band {
  padding-block: 0 var(--section);
}

.${ns}-band .${ns}-plate img {
  aspect-ratio: ${media.ratios.panorama};
}
`;
}

function servicesGrammar(design: ResolvedDesign): string {
  const { ns, type, media, brief } = design;
  if (brief.composition.servicesIndex === "STAGGERED_COLUMNS") {
    return `
/* -------------------------------------------------------------- services */

/* Services as a staggered register: media above the title, columns offset in
   depth so three entries read as a composition rather than three equal cards. */
.${ns}-service-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--gutter);
  align-items: start;
  padding-bottom: var(--section);
}

.${ns}-service-card:nth-child(2) {
  margin-top: calc(var(--unit) * 10);
}

.${ns}-service-card:nth-child(3) {
  margin-top: calc(var(--unit) * 20);
}

.${ns}-service-card > * + * {
  margin-top: var(--stack);
}

/* The provenance line sits between the photograph and the label; without this
   the two small texts read as one run. */
.${ns}-service-card > .${ns}-plate + * {
  margin-top: var(--stack-loose);
}

.${ns}-service-card .${ns}-plate img {
  aspect-ratio: ${media.ratios.tall};
}

.${ns}-service-card .${ns}-item-title {
  margin-top: var(--stack-tight);
}

.${ns}-service-text {
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
}
`;
  }
  return `
/* -------------------------------------------------------------- services */

/* Alternating full-measure entries. The plate side flips each row so the page
   has a rhythm rather than three identical blocks. */
.${ns}-service-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, ${(media.splitWeight * 2).toFixed(2)}fr);
  gap: var(--gutter);
  align-items: center;
  padding-block: var(--section);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-service-row[data-flip="true"] .${ns}-service-media {
  order: -1;
}

.${ns}-service-row > div > * + * {
  margin-top: var(--stack);
}

.${ns}-service-row .${ns}-item-title {
  margin-top: var(--stack-tight);
}

.${ns}-service-text {
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: var(--measure);
}
`;
}

function serviceDetailGrammar(design: ResolvedDesign): string {
  const { ns, type, media, brief } = design;
  const shared = `
.${ns}-questions li {
  padding-block: calc(var(--unit) * 2.5);
  border-top: 1px solid var(--rule-soft);
  font-size: ${type.body};
  line-height: 1.5;
  color: var(--ink-muted);
}

.${ns}-questions li:first-child {
  border-top: 0;
  padding-top: 0;
}

.${ns}-callout {
  padding: calc(var(--unit) * 4);
  background: var(--surface);
  border-radius: var(--media-radius);
  display: grid;
  gap: var(--stack);
}

.${ns}-callout p {
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink);
  max-width: var(--measure);
}
`;
  if (brief.composition.serviceDetail === "MEDIA_INTERRUPT") {
    return `
/* --------------------------------------------------------- service detail */

/* A full-width photograph interrupts the argument once, then the practical
   detail resumes on a reading measure beside the questions. */
.${ns}-interrupt {
  padding-bottom: var(--section);
}

.${ns}-interrupt .${ns}-plate img {
  aspect-ratio: ${media.ratios.panorama};
}

.${ns}-detail-split {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: start;
  padding-bottom: var(--section);
  border-top: 1px solid var(--rule);
  padding-top: var(--stack-loose);
}

.${ns}-detail-split > div > * + * {
  margin-top: var(--stack);
}

.${ns}-detail-aside {
  display: grid;
  gap: var(--stack-loose);
}
${shared}`;
  }
  return `
/* --------------------------------------------------------- service detail */

/* An argument column with the customer's own questions on a rail beside it. */
.${ns}-detail {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: start;
  padding-bottom: var(--section);
}

.${ns}-detail-main > * + * {
  margin-top: var(--stack-loose);
}

.${ns}-detail-main .${ns}-plate img {
  aspect-ratio: ${media.ratios.wide};
}

.${ns}-detail-aside {
  position: sticky;
  top: calc(var(--unit) * 6);
  display: grid;
  gap: var(--stack-loose);
}
${shared}`;
}

function projectsGrammar(design: ResolvedDesign): string {
  const { ns, type, media, brief } = design;
  if (brief.composition.projectsIndex === "STAGGERED_INDEX") {
    return `
/* -------------------------------------------------------------- projects */

/* Numbered entries at two depths. The wide entry gives the record its scale;
   the offset one keeps the page from becoming a column of equal blocks. */
.${ns}-index-list {
  padding-bottom: var(--section);
  display: grid;
  gap: var(--section);
}

.${ns}-index-entry {
  display: grid;
  gap: var(--stack-loose);
}

.${ns}-index-entry[data-width="offset"] {
  width: min(100%, 72%);
}

.${ns}-index-entry[data-width="offset"][data-align="end"] {
  justify-self: end;
}

.${ns}-index-entry-meta {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: var(--gutter);
  align-items: baseline;
}

.${ns}-index-entry .${ns}-plate img {
  aspect-ratio: ${media.ratios.wide};
  transition: opacity var(--motion-duration) var(--motion-ease);
}

.${ns}-index-entry a:hover .${ns}-plate img {
  opacity: 0.88;
}

.${ns} .${ns}-record-title {
  font-family: var(--display);
  font-size: ${type.sectionTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  line-height: ${design.type.displayLeading};
  max-width: var(--measure-display);
  color: var(--ink);
}

.${ns}-record-summary {
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: var(--measure);
}
`;
  }
  return `
/* -------------------------------------------------------------- projects */

/* Wide editorial records, meta beside the plate, alternating side. */
.${ns}-record {
  display: grid;
  grid-template-columns: minmax(0, ${(media.splitWeight * 2).toFixed(2)}fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: center;
  padding-block: var(--section);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-record[data-flip="true"] .${ns}-record-media {
  order: 1;
}

.${ns}-record-meta > * + * {
  margin-top: var(--stack-tight);
}

.${ns}-record .${ns}-plate img {
  aspect-ratio: ${media.ratios.wide};
  transition: opacity var(--motion-duration) var(--motion-ease);
}

.${ns}-record:hover .${ns}-plate img {
  opacity: 0.88;
}

.${ns} .${ns}-record-title {
  font-family: var(--display);
  font-size: ${type.sectionTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  line-height: ${design.type.displayLeading};
  max-width: var(--measure-display);
  color: var(--ink);
}

.${ns}-record-summary {
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: var(--measure);
}
`;
}

function projectDetailGrammar(design: ResolvedDesign): string {
  const { ns, type, media, brief } = design;
  const shared = `
.${ns}-disclosure {
  padding: calc(var(--unit) * 2.5) calc(var(--unit) * 3);
  border-left: 2px solid var(--accent);
  background: color-mix(in srgb, var(--surface) 60%, transparent);
  font-size: ${type.body};
  line-height: 1.55;
  color: var(--ink);
  max-width: var(--measure);
}

.${ns}-facts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
  gap: 0;
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  margin-block: var(--section);
}

.${ns}-facts > div {
  padding: calc(var(--unit) * 4) calc(var(--unit) * 3) calc(var(--unit) * 4) 0;
  border-right: 1px solid var(--rule-soft);
}

.${ns}-facts > div:last-child {
  border-right: 0;
}

.${ns}-facts dt {
  font-size: ${type.label.size};
  font-weight: ${type.label.weight};
  letter-spacing: ${type.label.tracking};
  text-transform: ${type.label.transform};
  color: var(--ink-faint);
}

.${ns}-facts dd {
  margin-top: var(--stack-tight);
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  color: var(--ink);
}

.${ns}-onward-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
  gap: var(--gutter);
  padding-block: var(--stack-loose);
  border-top: 1px solid var(--rule);
}

.${ns}-onward-grid a {
  display: block;
  padding-block: calc(var(--unit) * 2);
}
`;
  if (brief.composition.projectDetail === "STAGGERED_BEATS") {
    return `
/* --------------------------------------------------------- project detail */

/* The story told in beats. Text and photograph alternate sides and the media
   breaks wider than the reading column, so the page moves rather than scrolls. */
.${ns}-beat {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--section);
  border-top: 1px solid var(--rule-soft);
}

/* A tall photograph beside three lines of copy strands the copy at the top of a
   long column. Centring the pair is the difference between a composition and
   two things that happen to be adjacent. */
.${ns}-beat[data-media="true"] {
  align-items: center;
}

/*
 * A beat with no photograph is not a beat with an empty column. It recomposes
 * into heading-and-argument across the full measure, which also gives the page a
 * denser moment between two open ones.
 */
.${ns}-beat[data-media="false"] {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.7fr);
  align-items: start;
}

.${ns}-beat-aside {
  padding-top: var(--label-offset);
}

.${ns}-beat[data-flip="true"] .${ns}-beat-media {
  order: -1;
}

.${ns}-beat-copy > * + * {
  margin-top: var(--stack);
}

.${ns}-beat-index {
  font-size: ${type.label.size};
  font-weight: ${type.label.weight};
  letter-spacing: ${type.label.tracking};
  text-transform: ${type.label.transform};
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.${ns}-beat-body {
  font-size: ${type.body};
  line-height: 1.65;
  color: var(--ink-muted);
  max-width: var(--measure);
}

.${ns}-beat-media .${ns}-plate + .${ns}-plate {
  margin-top: var(--stack);
}

.${ns}-hero-record .${ns}-plate img {
  aspect-ratio: ${media.ratios.panorama};
}
${shared}`;
  }
  return `
/* --------------------------------------------------------- project detail */

/* The record as a document: hero, disclosure, facts band, then the story beats
   with their photographs placed inside the narrative, not gathered in a gallery. */
.${ns}-beat {
  display: grid;
  grid-template-columns: calc(var(--unit) * 14) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: calc(var(--unit) * 8);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-beat-copy > * + * {
  margin-top: var(--stack);
}

.${ns}-beat-index {
  font-size: ${type.label.size};
  font-weight: ${type.label.weight};
  letter-spacing: ${type.label.tracking};
  text-transform: ${type.label.transform};
  color: var(--ink-faint);
  font-variant-numeric: tabular-nums;
}

.${ns}-beat-body {
  font-size: ${type.body};
  line-height: 1.65;
  color: var(--ink-muted);
  max-width: var(--measure);
}

.${ns}-beat-media {
  margin-top: var(--stack-loose);
}

.${ns}-beat-media .${ns}-plate + .${ns}-plate {
  margin-top: var(--stack);
}

.${ns}-hero-record .${ns}-plate img {
  aspect-ratio: ${media.ratios.panorama};
}
${shared}`;
}

function aboutGrammar(design: ResolvedDesign): string {
  const { ns, type, media, brief } = design;
  const steps = `
.${ns}-steps {
  counter-reset: step;
  display: grid;
  gap: 0;
}

.${ns}-steps li {
  counter-increment: step;
  display: grid;
  grid-template-columns: calc(var(--unit) * 9) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: baseline;
  padding-block: calc(var(--unit) * 5);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-steps li::before {
  content: counter(step, decimal-leading-zero);
  font-size: ${type.small};
  font-variant-numeric: tabular-nums;
  letter-spacing: ${type.label.tracking};
  color: var(--accent);
}

.${ns}-step-title {
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  color: var(--ink);
}

.${ns}-step-body {
  margin-top: var(--stack-tight);
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: var(--measure);
}

.${ns}-claims li {
  padding-block: calc(var(--unit) * 2.5);
  border-top: 1px solid var(--rule-soft);
  font-size: ${type.body};
  line-height: 1.55;
  color: var(--ink-muted);
}

.${ns}-claims li:first-child {
  border-top: 0;
  padding-top: 0;
}
`;
  if (brief.composition.about === "METHOD_LED") {
    return `
/* ----------------------------------------------------------------- about */

/* Opens on the method rather than on the story: how the work is run is the
   thing a homeowner is actually deciding about. */
.${ns}-method {
  padding-bottom: var(--section);
}

.${ns}-method-head {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
  gap: var(--gutter);
  align-items: start;
  margin-bottom: var(--stack-loose);
}

.${ns}-method-head > div:last-child {
  padding-top: var(--label-offset);
}

.${ns}-about-story {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, ${(media.splitWeight * 1.9).toFixed(2)}fr);
  gap: var(--gutter);
  /* A tall portrait beside four paragraphs; centred, the pair is a composition. */
  align-items: center;
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}

.${ns}-about-story .${ns}-plate img {
  aspect-ratio: ${media.ratios.tall};
}

.${ns}-claims-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}
${steps}`;
  }
  return `
/* ----------------------------------------------------------------- about */

.${ns}-about-story {
  display: grid;
  grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: center;
  padding-bottom: var(--section);
}

.${ns}-about-story .${ns}-plate img {
  aspect-ratio: ${media.ratios.tall};
}

.${ns}-method {
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}

.${ns}-method-head {
  margin-bottom: var(--stack-loose);
}

.${ns}-claims-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.6fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}
${steps}`;
}

function contactGrammar(design: ResolvedDesign): string {
  const { ns, type, brief } = design;
  const shared = `
.${ns}-checklist li {
  padding-block: calc(var(--unit) * 2);
  border-top: 1px solid var(--rule-soft);
  font-size: ${type.body};
  line-height: 1.5;
  color: var(--ink-muted);
}

.${ns}-checklist li:first-child {
  border-top: 0;
  padding-top: 0;
}

.${ns}-notice {
  padding: calc(var(--unit) * 3);
  border: 1px solid var(--rule);
  border-radius: var(--media-radius);
}

.${ns}-notice [data-platform-action-label] {
  font-family: var(--text);
  font-size: ${type.small};
  font-weight: 600;
  color: var(--ink);
  margin-bottom: calc(var(--unit) * 0.75);
}

.${ns}-notice [data-platform-action-message] {
  font-size: ${type.body};
  line-height: 1.5;
  color: var(--ink-muted);
}

.${ns}-faq {
  display: grid;
  gap: 0;
}

.${ns}-faq > div {
  padding-block: calc(var(--unit) * 3.5);
  border-top: 1px solid var(--rule-soft);
}

.${ns}-faq dt {
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  color: var(--ink);
  max-width: var(--measure-display);
}

.${ns}-faq dd {
  margin-top: var(--stack-tight);
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: var(--measure);
}
`;
  if (brief.composition.contact === "STACKED_DIRECT") {
    return `
/* --------------------------------------------------------------- contact */

/* Direct channels first, stated as fact across the full measure, then the form
   on a reading column. Nothing implies someone is waiting to answer. */
.${ns}-channels {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
  gap: var(--gutter);
  padding-block: var(--stack-loose) var(--section);
  border-top: 1px solid var(--rule);
}

.${ns}-contact-form {
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--gutter);
  align-items: start;
}

.${ns}-contact-form > div:first-child {
  display: grid;
  gap: var(--stack);
}

.${ns}-faq-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.7fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}
${shared}`;
  }
  return `
/* --------------------------------------------------------------- contact */

.${ns}-contact {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr);
  gap: var(--gutter);
  align-items: start;
  padding-bottom: var(--section);
}

.${ns}-contact > div:first-child {
  display: grid;
  gap: var(--stack-loose);
}

.${ns}-panel {
  padding: calc(var(--unit) * 5);
  background: var(--surface);
  border-radius: var(--media-radius);
}

.${ns}-faq-band {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.7fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--section);
  border-top: 1px solid var(--rule);
}
${shared}`;
}

function notFound(design: ResolvedDesign): string {
  const { ns } = design;
  return `
/* ------------------------------------------------------------- not found */

.${ns}-missing {
  display: grid;
  grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
  gap: var(--gutter);
  align-items: start;
  padding-block: var(--section);
}

.${ns}-missing > div:first-child > * + * {
  margin-top: var(--stack);
}

.${ns}-missing nav {
  padding-top: var(--label-offset);
  display: grid;
  gap: var(--stack-tight);
  justify-items: start;
}
`;
}

function platformModules(design: ResolvedDesign): string {
  const { ns, type } = design;
  return `
/* ------------------------------------- Platform module presentation */

/*
 * The contact module is Kernel-rendered. Its markup is not ours, but its
 * appearance on this page is, so the client's type and colour are applied to
 * what the Platform emits.
 */
.${ns} .lead-form-heading h1,
.${ns} .lead-form-heading h2,
.${ns} .lead-form-heading h3 {
  font-family: var(--display);
  font-size: ${type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  color: var(--ink);
  margin-bottom: var(--stack-tight);
}

.${ns} .lead-form-heading p {
  font-size: ${type.body};
  line-height: 1.6;
  color: var(--ink-muted);
  max-width: var(--measure);
}

.${ns} .site-eyebrow {
  display: block;
  font-size: ${type.label.size};
  font-weight: ${type.label.weight};
  letter-spacing: ${type.label.tracking};
  text-transform: ${type.label.transform};
  color: var(--ink-muted);
  margin-bottom: var(--stack-tight);
}

.${ns} .lead-form {
  display: grid;
  gap: calc(var(--unit) * 2.5);
  margin-top: var(--stack);
}

.${ns} .lead-form label {
  display: block;
  font-size: ${type.small};
  font-weight: 600;
  color: var(--ink);
  margin-bottom: calc(var(--unit) * 1);
}

.${ns} .lead-form input,
.${ns} .lead-form textarea {
  width: 100%;
  padding: calc(var(--unit) * 2);
  font-family: var(--text);
  font-size: ${type.body};
  color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: var(--media-radius);
}

.${ns} .lead-form input:focus-visible,
.${ns} .lead-form textarea:focus-visible {
  border-color: var(--accent);
}

.${ns} .lead-form button {
  justify-self: start;
  min-height: 48px;
  padding-inline: calc(var(--unit) * 4);
  background: var(--accent);
  color: var(--accent-contrast);
  font-family: var(--text);
  font-size: ${type.small};
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: ${type.label.transform};
  border: 0;
  border-radius: var(--media-radius);
  cursor: pointer;
  transition: background var(--motion-duration) var(--motion-ease);
}

.${ns} .lead-form button:hover {
  background: color-mix(in srgb, var(--accent) 84%, var(--ink));
}

.${ns} .lead-form-status,
.${ns} .lead-form-field-error {
  font-size: ${type.small};
  color: var(--ink);
}
`;
}

function motion(design: ResolvedDesign, plan: InteractionPlan): string {
  const { ns } = design;
  const header = `
/* ---------------------------------------------------------------- motion */
`;

  /*
   * Feedback on something that navigates. A reader uses this to tell what is
   * clickable, so it is the first expressive feedback a site buys and the last
   * it gives up. Bought at ESSENTIAL and above.
   */
  const navigationFeedback = plan.feedback("NAVIGATION")
    ? `
.${ns} a:hover .${ns}-item-title,
.${ns} a:hover .${ns}-record-title {
  color: var(--accent);
  transition: color var(--motion-duration) var(--motion-ease);
}

.${ns}-menu[open] .${ns}-menu-panel {
  animation: ${ns}-menu-in calc(var(--motion-duration) * 1.4) var(--motion-ease);
}

${
  plan.usesMenuMotion
    ? `/*
 * While the helper animates the menu closed the element is still \`[open]\` —
 * it has to be, or there would be no height to animate — so without this the
 * panel would play its entrance again on the way out. Only a client that
 * received the helper receives the rule: nobody else can set the attribute.
 */
.${ns}-menu[data-menu="closing"] .${ns}-menu-panel {
  animation: none;
}

`
    : ""
}@keyframes ${ns}-menu-in {
  from {
    opacity: 0;
    transform: translateY(calc(var(--motion-hover-travel) * -2));
  }
}
`
    : "";

  /*
   * Feedback on a surface that is not itself a destination. Pure character: a
   * site is complete without it, which is precisely why it is the part a client
   * whose language is ESSENTIAL does not receive.
   */
  const surfaceFeedback = plan.feedback("SURFACE")
    ? `
.${ns}-plate img {
  transition: opacity var(--motion-duration) var(--motion-ease),
    transform calc(var(--motion-duration) * 2) var(--motion-ease);
}
`
    : "";

  if (!plan.usesReveal) {
    return `${header}${navigationFeedback}${surfaceFeedback}`;
  }

  /*
   * Restrained entrance. An element declares itself revealable; the Reveal
   * helper marks it visible once, on first intersection, then disconnects.
   * There is no scroll listener, no animation frame loop and no React state per
   * frame.
   *
   * The un-revealed state is deliberately *visible* until the helper hydrates
   * and claims it. A reader with JavaScript disabled, or one who arrives before
   * hydration, sees the finished page rather than a blank one.
   *
   * Two grammars, not one, and not a library of them. Prose is set in place by
   * the reader's eye travelling down the page, so it lifts the short distance
   * it would have travelled and settles. A photograph is already where it
   * belongs — sliding it says the layout is still deciding — so it resolves
   * where it stands, on the same duration and the same curve. Same Motion
   * Language, two readings of it, chosen by what the element *is*.
   */
  const media = plan.reveals("MEDIA")
    ? `
[data-reveal="pending"][data-reveal-as="media"] {
  transform: scale(calc(1 - var(--motion-overlay-scale)));
}
`
    : "";

  return `${header}${navigationFeedback}${surfaceFeedback}
[data-reveal="pending"] {
  opacity: var(--motion-reveal-floor);
  transform: translateY(var(--motion-travel));
}
${media}
[data-reveal] {
  transition: opacity var(--motion-reveal) var(--motion-ease),
    transform var(--motion-reveal) var(--motion-ease);
}

[data-reveal="visible"] {
  opacity: 1;
  transform: none;
}
`;
}

function responsive(design: ResolvedDesign): string {
  const { ns, media, space, breakpoints, brief } = design;
  const singleColumn = [
    `.${ns}-head`,
    `.${ns}-register-head`,
    `.${ns}-preview`,
    `.${ns}-missing`,
    `.${ns}-claims-band`,
    `.${ns}-faq-band`,
    `.${ns}-about-story`,
    `.${ns}-method-head`,
    brief.composition.home === "IMAGE_LED" ? `.${ns}-cover-copy` : `.${ns}-hero`,
    brief.composition.servicesIndex === "STAGGERED_COLUMNS"
      ? `.${ns}-service-grid`
      : `.${ns}-service-row`,
    brief.composition.serviceDetail === "MEDIA_INTERRUPT"
      ? `.${ns}-detail-split`
      : `.${ns}-detail`,
    brief.composition.projectsIndex === "STAGGERED_INDEX"
      ? `.${ns}-index-entry-meta`
      : `.${ns}-record`,
    `.${ns}-beat`,
    brief.composition.contact === "STACKED_DIRECT"
      ? `.${ns}-contact-form`
      : `.${ns}-contact`,
  ];
  return `
/* ------------------------------------------------------------ responsive */

/*
 * Mobile is recomposed, not stacked. Where a column order would put the
 * photograph before the offer, the order is reversed; where a wide crop would
 * lose its subject, the frame changes shape; where a heading measure was set for
 * a column, it is released.
 */

@media (max-width: ${breakpoints.wide}) {
${singleColumn.map((selector) => `  ${selector},`).join("\n").replace(/,$/, " {")}
    grid-template-columns: minmax(0, 1fr);
    gap: var(--stack-loose);
  }

  .${ns}-head-aside,
  .${ns}-preview-aside,
  .${ns}-missing nav,
  .${ns}-method-head > div:last-child {
    padding-top: 0;
  }

  .${ns}-detail-aside,
  .${ns}-preview > div:first-child,
  .${ns}-sticky {
    position: static;
  }

  .${ns}-register-head .${ns}-lede {
    padding-top: 0;
  }

  .${ns}-service-row[data-flip="true"] .${ns}-service-media,
  .${ns}-record[data-flip="true"] .${ns}-record-media,
  .${ns}-beat[data-flip="true"] .${ns}-beat-media {
    order: 0;
  }

  .${ns}-service-card:nth-child(2),
  .${ns}-service-card:nth-child(3) {
    margin-top: 0;
  }

  .${ns}-index-entry[data-width="offset"] {
    width: 100%;
  }

  .${ns}-proof {
    grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr));
    row-gap: var(--stack-loose);
  }

  .${ns}-footer-grid {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .${ns}-footer-statement {
    grid-column: 1 / -1;
  }

  .${ns} {
    --section: calc(var(--unit) * ${space.section.mid});
    --measure-display: 24ch;
  }
}

@media (max-width: ${breakpoints.mid}) {
  .${ns} {
    --section: calc(var(--unit) * ${space.section.narrow});
    --measure-display: none;
    --gutter: calc(var(--unit) * ${Math.max(3, Math.round(Number(space.gutter) * 0.6))});
  }

  /* Navigation collapses into the disclosure. platform.Disclosure keeps exactly
     one instance in the accessibility tree; these two rules choose which. */
  .${ns}-nav-static {
    display: none;
  }

  .${ns}-menu {
    display: block;
  }

  .${ns}-row,
  .${ns}-row-compact {
    grid-template-columns: calc(var(--unit) * 5) minmax(0, 1fr);
    row-gap: var(--stack-tight);
    padding-block: calc(var(--unit) * 4);
  }

  .${ns}-row-compact[data-columns="two"] {
    grid-template-columns: minmax(0, 1fr);
  }

  /* The metadata drops under the title rather than fighting it for width. */
  .${ns}-row-text,
  .${ns}-row-compact > :nth-child(3) {
    grid-column: 2;
  }

  .${ns}-row-compact[data-columns="two"] > :nth-child(2) {
    grid-column: 1;
  }

  .${ns}-beat[data-media="false"] {
    grid-template-columns: minmax(0, 1fr);
  }

  .${ns}-beat-aside {
    padding-top: 0;
  }

  .${ns}-beat {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--stack);
  }

  .${ns}-facts {
    grid-template-columns: minmax(0, 1fr);
  }

  .${ns}-facts > div {
    border-right: 0;
    border-bottom: 1px solid var(--rule-soft);
    padding-right: 0;
  }

  .${ns}-facts > div:last-child {
    border-bottom: 0;
  }

  .${ns}-footer-grid {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--stack-loose);
  }

  /* A wide crop loses its subject on a phone; every plate takes a taller frame. */
  .${ns}-plate[data-ratio="panorama"] img,
  .${ns}-band .${ns}-plate img,
  .${ns}-cover-media .${ns}-plate img,
  .${ns}-interrupt .${ns}-plate img,
  .${ns}-hero-record .${ns}-plate img {
    aspect-ratio: ${media.mobileRatios.panorama};
  }

  .${ns}-plate[data-ratio="wide"] img,
  .${ns}-record .${ns}-plate img,
  .${ns}-index-entry .${ns}-plate img,
  .${ns}-detail-main .${ns}-plate img {
    aspect-ratio: ${media.mobileRatios.wide};
  }

  .${ns}-panel,
  .${ns}-callout {
    padding: calc(var(--unit) * 3);
  }
}

@media (max-width: ${breakpoints.narrow}) {
  /*
   * At 320px the wordmark, menu, search and the primary action cannot share one
   * row. The header wraps to two rather than dropping the action: losing the
   * only always-visible conversion path to save 40px is the wrong trade.
   */
  .${ns} {
    --edge: calc(var(--unit) * 3);
  }

  .${ns}-header-inner {
    flex-wrap: wrap;
    gap: calc(var(--unit) * 1);
    padding-block: calc(var(--unit) * 1.5);
  }

  .${ns}-header-actions {
    width: 100%;
    justify-content: space-between;
  }

  .${ns}-action {
    padding-inline: calc(var(--unit) * 2.5);
  }

  .${ns}-steps li,
  .${ns}-row,
  .${ns}-row-compact {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--stack-tight);
  }

  .${ns}-row-text,
  .${ns}-row-compact > * {
    grid-column: 1;
  }
}
`;
}

function reducedMotion(
  design: ResolvedDesign,
  plan: InteractionPlan,
): string {
  const { ns, interaction } = design;
  /*
   * A site that animates nothing needs no reduction of it. Emitting the block
   * anyway would put a media query full of overrides for transitions this
   * artifact does not contain into every still client's stylesheet.
   */
  if (!plan.animates) return "";
  const revealReset = interaction.reveals
      ? `
  /*
   * An entrance has no reduced-motion equivalent worth keeping: the honest
   * expression of "this arrives as you reach it" is simply that it is already
   * there. The helper settles every element immediately in this mode, so this
   * only guarantees the outcome. A brief-fade brief still fades its *state*
   * changes, which are the ones carrying meaning.
   */
  [data-reveal],
  [data-reveal="pending"] {
    opacity: 1;
    transform: none;
    transition: none;
  }
`
      : "";
  return `
/* -------------------------------------------------------- reduced motion */

/*
 * Reduced motion is a different expression of state, not the absence of one.
 * Travel goes to zero everywhere and every channel collapses to the one
 * duration this client's brief asked for — instant, or a brief fade that still
 * acknowledges the change. Nothing here hides content, and every open, closed,
 * selected and submitted state stays exactly as legible as it was.
 */
@media (prefers-reduced-motion: reduce) {
  .${ns} {
    /* Every duration and every distance in this file, in one place. */
    --motion-duration: ${interaction.reduced.duration}ms;
    --motion-state: ${interaction.reduced.duration}ms;
    --motion-overlay: ${interaction.reduced.duration}ms;
    --motion-reveal: ${interaction.reduced.duration}ms;
    --motion-travel: ${interaction.reduced.travel};
    --motion-hover-travel: ${interaction.reduced.travel};
    --motion-overlay-travel: ${interaction.reduced.travel};
    --motion-overlay-scale: 0;
    --motion-reveal-floor: 1;
  }

  .${ns}-menu[open] .${ns}-menu-panel${plan.usesMenuMotion ? `,
  .${ns}-menu[data-menu] .${ns}-menu-panel` : ""} {
    animation: none;
  }

  .${ns}-onward:hover::after {
    transform: none;
  }
${revealReset}${interactionReducedMotion(design, plan)}}
`;
}

function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
