import type { ResolvedDesign } from "../decisions.js";
import type { InteractionPlan } from "../interaction-decisions.js";

/**
 * The interaction substrate: the CSS that gives progressive disclosure and the
 * media overlay their movement.
 *
 * Only the blocks a client actually selected are emitted. A site that folds
 * nothing away and opens no media receives none of this, so the capability
 * costs nothing to exist.
 *
 * Everything reads from the custom properties `root()` declares, which the
 * reduced-motion block at the end of the stylesheet collapses in one place —
 * the same discipline the A3 floor already used, extended to the channels a
 * richer interaction language needs.
 */

/** The custom properties the interaction language resolves to. */
export function interactionVariables(design: ResolvedDesign): string {
  const { interaction } = design;
  return `
  /* Motion & Interaction Language, resolved from this client's brief. */
  --motion-duration: ${interaction.duration.micro}ms;
  --motion-state: ${interaction.duration.state}ms;
  --motion-overlay: ${interaction.duration.overlay}ms;
  --motion-reveal: ${interaction.duration.reveal}ms;
  --motion-ease: ${interaction.easing.enter};
  --motion-exit-ease: ${interaction.easing.exit};
  --motion-state-ease: ${interaction.easing.state};
  --motion-travel: ${interaction.travel.reveal};
  --motion-hover-travel: ${interaction.travel.hover};
  --motion-overlay-travel: ${interaction.travel.overlay};
  --motion-overlay-scale: ${interaction.travel.scale};
  --motion-reveal-floor: ${interaction.revealFloor};`;
}

/**
 * Progressive disclosure.
 *
 * The height animation itself is run by the client-local helper, because no
 * cross-browser CSS can interpolate to an intrinsic height today —
 * `interpolate-size`/`calc-size()` remain Chromium-only and are not Baseline.
 * What CSS owns here is everything else: the control's affordance, the marker,
 * the state the helper writes, and the fact that a closing panel clips rather
 * than spilling.
 */
export function disclosureStyles(design: ResolvedDesign): string {
  const { ns } = design;
  return `
/* ----------------------------------------------------- progressive detail */

/*
 * A question is a control. It reads as one before it is hovered, because an
 * affordance a reader has to discover is not an affordance.
 */
.${ns}-detail {
  border-top: 1px solid var(--rule-soft);
}

.${ns}-detail-summary {
  align-items: baseline;
  color: var(--ink);
  cursor: pointer;
  display: flex;
  gap: var(--stack-tight);
  justify-content: space-between;
  list-style: none;
  padding-block: calc(var(--unit) * 3.5);
  transition: color var(--motion-duration) var(--motion-ease);
}

/* Both spellings: WebKit still uses the pseudo-element. */
.${ns}-detail-summary::-webkit-details-marker {
  display: none;
}

.${ns}-detail-summary::marker {
  content: "";
}

.${ns}-detail-summary:hover {
  color: var(--accent);
}

.${ns}-detail-summary:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0.25rem;
}

/*
 * The folded question is typeset exactly as the static one: the same display
 * face, weight, tracking and measure. Folding is a change of interaction, not
 * an excuse for a different design.
 */
.${ns}-detail-title {
  color: var(--ink);
  font-family: var(--display);
  font-size: ${design.type.itemTitle};
  font-weight: ${design.type.displayWeight};
  letter-spacing: ${design.type.displayTracking};
  line-height: 1.25;
  max-width: var(--measure-display);
}

/*
 * The mark rotates rather than swapping glyph, so the control's state is
 * carried by one continuous movement a reader can follow.
 */
.${ns}-detail-mark {
  flex: none;
  line-height: 1;
  transform-origin: 50% 50%;
  transition: transform var(--motion-state) var(--motion-state-ease);
}

.${ns}-detail[open] .${ns}-detail-mark {
  transform: rotate(45deg);
}

/*
 * The body arrives on its own schedule alongside the height, so the panel reads
 * as making space and then filling it rather than as a block of text
 * stretching. Opening and closing use their own curves.
 *
 * The entrance is an animation on the opening state rather than a transition
 * out of the closed one, and that is a correctness requirement rather than a
 * preference: \`data-disclosure\` is only ever set to "opening" by the helper, so
 * giving the *closed* state an opacity would leave a reader without JavaScript
 * opening a native <details> onto invisible text. Here, no helper means no
 * animation and the body is simply visible, which is the behaviour that has to
 * survive.
 */
.${ns}-detail-body {
  color: var(--ink-muted);
  line-height: 1.6;
  max-width: var(--measure);
  padding-bottom: calc(var(--unit) * 3);
  transition: opacity var(--motion-state) var(--motion-exit-ease);
}

/*
 * While the helper animates the height, the panel must clip: the content is
 * already at its final layout and would otherwise overflow the shrinking box.
 * Closed and settled-open states clip nothing, so a focus ring on something
 * inside the panel is never cut off.
 */
.${ns}-detail[data-disclosure="opening"],
.${ns}-detail[data-disclosure="closing"] {
  overflow: clip;
}

.${ns}-detail[data-disclosure="opening"] .${ns}-detail-body,
.${ns}-detail[data-disclosure="open"] .${ns}-detail-body {
  opacity: 1;
  transition: opacity var(--motion-state) var(--motion-ease);
}

/*
 * Held at nothing for the first third, so the space is visibly made before
 * anything moves into it. The whole thing is over inside the state duration
 * this client's tempo already resolved; it is one property on one element and
 * it is meant to be noticed only in its absence.
 */
.${ns}-detail[data-disclosure="opening"] .${ns}-detail-body {
  animation: ${ns}-detail-body-in var(--motion-state) var(--motion-ease);
}

@keyframes ${ns}-detail-body-in {
  0%,
  32% {
    opacity: 0;
  }
}

.${ns}-detail[data-disclosure="closing"] .${ns}-detail-body {
  opacity: 0;
}
`;
}

/**
 * The media overlay.
 *
 * Open and close are both animated natively, which needs `allow-discrete` on
 * `display`/`overlay` plus a `@starting-style` entry state — without those a
 * dialog can only be animated open, and closing snaps. Closing is what usually
 * gets left behind, and a close that snaps undoes the sense that the overlay
 * came from somewhere.
 */
export function overlayStyles(design: ResolvedDesign): string {
  const { ns } = design;
  return `
/* ------------------------------------------------------- media exploration */

.${ns}-explore {
  background: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: block;
  font: inherit;
  padding: 0;
  text-align: inherit;
  width: 100%;
}

.${ns}-explore:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0.35rem;
}

/*
 * A photograph that can be opened says so on hover *and* on focus. Hover alone
 * would make the affordance invisible to a keyboard.
 */
.${ns}-explore .${ns}-plate img {
  transition:
    opacity var(--motion-duration) var(--motion-ease),
    transform var(--motion-state) var(--motion-ease);
}

.${ns}-explore:hover .${ns}-plate img,
.${ns}-explore:focus-visible .${ns}-plate img {
  transform: scale(calc(1 + var(--motion-overlay-scale)));
}

.${ns}-viewer {
  background: var(--paper);
  border: 0;
  color: var(--ink);
  max-height: 92dvh;
  max-width: min(72rem, 92vw);
  padding: 0;
  width: 100%;
}

.${ns}-viewer {
  opacity: 0;
  transform: translateY(var(--motion-overlay-travel))
    scale(calc(1 - var(--motion-overlay-scale)));
  transition:
    opacity var(--motion-overlay) var(--motion-exit-ease),
    transform var(--motion-overlay) var(--motion-exit-ease),
    display var(--motion-overlay) allow-discrete,
    overlay var(--motion-overlay) allow-discrete;
}

/*
 * Entering uses the enter curve, leaving the exit curve. The dialog keeps its
 * transition while closed as well, because that is the one that runs on the way
 * out: allow-discrete on display and overlay is what lets a dialog animate
 * closed at all rather than vanishing.
 */
.${ns}-viewer[open] {
  opacity: 1;
  transform: none;
  transition:
    opacity var(--motion-overlay) var(--motion-ease),
    transform var(--motion-overlay) var(--motion-ease),
    display var(--motion-overlay) allow-discrete,
    overlay var(--motion-overlay) allow-discrete;
}

@starting-style {
  .${ns}-viewer[open] {
    opacity: 0;
    transform: translateY(var(--motion-overlay-travel))
      scale(calc(1 - var(--motion-overlay-scale)));
  }
}

/*
 * The backdrop stays translucent rather than opaque: the overlay is a closer
 * look at something on the page, and losing the page entirely costs the reader
 * the context they opened it from.
 */
.${ns}-viewer::backdrop {
  background: rgb(0 0 0 / 62%);
  opacity: 0;
  transition:
    opacity var(--motion-overlay) var(--motion-exit-ease),
    display var(--motion-overlay) allow-discrete,
    overlay var(--motion-overlay) allow-discrete;
}

.${ns}-viewer[open]::backdrop {
  opacity: 1;
}

@starting-style {
  .${ns}-viewer[open]::backdrop {
    opacity: 0;
  }
}

.${ns}-viewer-frame {
  display: grid;
  gap: var(--stack-tight);
  padding: calc(var(--unit) * 3);
}

.${ns}-viewer-figure {
  margin: 0;
  min-height: 0;
}

.${ns}-viewer-figure img {
  display: block;
  max-height: 68dvh;
  object-fit: contain;
  width: 100%;
}

.${ns}-viewer-caption {
  color: var(--ink-muted);
  font-size: ${design.type.small};
  margin-top: var(--stack-tight);
}

.${ns}-viewer-bar {
  align-items: center;
  display: flex;
  gap: var(--stack-tight);
  justify-content: space-between;
}

.${ns}-viewer-count {
  color: var(--ink-faint);
  font-size: ${design.type.small};
  font-variant-numeric: tabular-nums;
  letter-spacing: ${design.type.label.tracking};
}

.${ns}-viewer-controls {
  display: flex;
  gap: var(--stack-tight);
}

.${ns}-viewer-button {
  background: none;
  border: 1px solid var(--rule);
  color: inherit;
  cursor: pointer;
  font: inherit;
  padding: calc(var(--unit) * 0.75) calc(var(--unit) * 2);
  transition:
    background var(--motion-duration) var(--motion-ease),
    border-color var(--motion-duration) var(--motion-ease),
    color var(--motion-duration) var(--motion-ease);
}

.${ns}-viewer-button:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
}

.${ns}-viewer-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 0.25rem;
}

/*
 * A control at the end of the sequence is disabled rather than removed, so the
 * bar does not reflow as a reader steps through and the sequence's shape stays
 * legible.
 */
.${ns}-viewer-button:disabled {
  color: var(--ink-faint);
  cursor: default;
}
`;
}

/** Reduced-motion overrides for whatever this client selected. */
export function interactionReducedMotion(
  design: ResolvedDesign,
  plan: InteractionPlan,
): string {
  const { ns, interaction } = design;
  const blocks: string[] = [];

  if (plan.usesDisclosure) {
    /*
     * The mark still turns and the panel still fades if the client asked for a
     * fade, because the *state* has to remain legible — reduced motion removes
     * travel and duration, not meaning. The helper settles the height
     * immediately, so nothing here has to fight it.
     */
    blocks.push(`
  .${ns}-detail-mark {
    transition-duration: var(--motion-duration);
  }

  /*
   * The body's entrance is expression rather than state — the panel being open
   * is already said by the height and by the mark — so reduction removes it
   * outright instead of compressing it into a flicker.
   */
  .${ns}-detail[data-disclosure="opening"] .${ns}-detail-body {
    animation: none;
  }
`);
  }

  if (plan.usesMediaExplorer) {
    blocks.push(`
  .${ns}-viewer,
  .${ns}-viewer[open] {
    transform: none;
  }

  @starting-style {
    .${ns}-viewer[open] {
      transform: none;
      opacity: ${interaction.reduced.fade ? "0" : "1"};
    }
  }

  .${ns}-explore:hover .${ns}-plate img,
  .${ns}-explore:focus-visible .${ns}-plate img {
    transform: none;
  }
`);
  }

  return blocks.join("");
}
