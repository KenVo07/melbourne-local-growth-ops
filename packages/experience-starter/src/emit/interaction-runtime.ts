import type { ResolvedDesign } from "../decisions.js";

/**
 * Emits the client's own interaction helpers.
 *
 * Everything here is written into the client's source tree as ordinary React,
 * with the resolved durations and curves inlined as editable constants. Nothing
 * imports the Factory, nothing imports a motion library, and each helper is
 * emitted only when the client's language selected the capability it serves.
 *
 * The shared cost budget across all three helpers:
 *   - no dependency and no animation-frame loop;
 *   - no scroll listener;
 *   - no React state written per frame;
 *   - every observer, listener and animation cancelled on unmount;
 *   - nothing hidden before hydration, so a reader without JavaScript sees a
 *     complete page and every helper degrades to native browser behaviour.
 */

/** One shared reduced-motion query, imported by whichever helpers are emitted. */
export function emitMotionPreference(): string {
  return `/**
 * Whether this reader has asked for reduced motion.
 *
 * Read at the moment of the interaction rather than held in state, so a reader
 * who changes the preference mid-session gets the new behaviour on their next
 * interaction without this file subscribing to anything.
 */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
`;
}

/**
 * Progressive disclosure.
 *
 * Native `<details>` is the semantic and the no-JavaScript behaviour; this adds
 * the movement it cannot do itself. The height has to be measured and animated
 * imperatively because no cross-browser CSS interpolates to an intrinsic
 * height — `interpolate-size`/`calc-size()` are still Chromium-only and not
 * Baseline — so this uses the Web Animations API, which is, and confines it to
 * one property on one element.
 *
 * What makes the movement read as *making space* rather than as a box resizing:
 * the element animates its own height, so everything below it is moved by
 * ordinary layout, in step, for the whole duration.
 */
export function emitDisclosure(design: ResolvedDesign): string {
  const { ns, interaction } = design;
  return `"use client";

import {
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { prefersReducedMotion } from "./motion";

/*
 * This client's tempo, resolved from its brief. Ordinary constants in ordinary
 * client source: edit them and the site's disclosure character changes.
 */
const OPEN_MS = ${interaction.duration.state};
const CLOSE_MS = ${Math.round(interaction.duration.state * 0.85)};
const OPEN_EASE = "${interaction.easing.enter}";
const CLOSE_EASE = "${interaction.easing.exit}";

/**
 * A question, or any secondary detail, that expands in place.
 *
 * Without JavaScript this is exactly a \`<details>\`: it opens, it closes, and
 * every answer is in the page for a reader and for a crawler. With JavaScript
 * the open and close are animated, and rapid toggling is safe because each new
 * gesture cancels the animation in flight and re-measures from wherever the
 * element actually is.
 */
export function Detail({
  id,
  summary,
  children,
  defaultOpen = false,
}: {
  readonly id?: string | undefined;
  readonly summary: ReactNode;
  readonly children: ReactNode;
  readonly defaultOpen?: boolean | undefined;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const animationRef = useRef<Animation | null>(null);

  /*
   * A link to #some-question opens that question. Without this the browser
   * scrolls to a closed control and the reader is left looking at the thing
   * they asked to read, closed.
   */
  useEffect(() => {
    if (id === undefined) return;
    const details = detailsRef.current;
    if (details === null) return;

    const openForHash = () => {
      if (window.location.hash !== "#" + id || details.open) return;
      animationRef.current?.cancel();
      animationRef.current = null;
      details.open = true;
      details.dataset.disclosure = "open";
    };

    openForHash();
    window.addEventListener("hashchange", openForHash);
    return () => window.removeEventListener("hashchange", openForHash);
  }, [id]);

  useEffect(
    () => () => {
      animationRef.current?.cancel();
      animationRef.current = null;
    },
    [],
  );

  const settle = (details: HTMLDetailsElement, open: boolean) => {
    /*
     * Order matters. The animation was given \`fill: "both"\` so it holds the
     * final height instead of snapping back for a frame before this runs — but
     * a filling animation keeps forcing that height forever, which would clip
     * the panel the next time the content reflowed (a resize, a font swap, an
     * image arriving late). So the real height is restored first and the
     * animation is cancelled second, both before the browser paints again.
     */
    details.open = open;
    details.style.removeProperty("height");
    details.style.removeProperty("overflow");
    animationRef.current?.cancel();
    animationRef.current = null;
    details.dataset.disclosure = open ? "open" : "closed";
  };

  const toggle = (event: ReactMouseEvent<HTMLElement>) => {
    const details = detailsRef.current;
    if (details === null) return;

    // The browser would toggle \`open\` itself and skip straight to the end state.
    event.preventDefault();

    const running = animationRef.current;
    const closing = details.dataset.disclosure === "closing";
    const shouldOpen = closing || !details.open;

    running?.cancel();
    animationRef.current = null;

    if (prefersReducedMotion()) {
      settle(details, shouldOpen);
      return;
    }

    /*
     * Measured after the cancel, so an interrupted toggle starts from the height
     * the panel is actually at rather than from where it was going.
     */
    const startHeight = details.getBoundingClientRect().height;

    // The closed height has to be measured, not assumed: the summary's own box
    // is not the element's box once padding and a border are involved.
    details.open = false;
    const closedHeight = details.getBoundingClientRect().height;
    details.open = true;
    const openHeight = details.scrollHeight;

    const endHeight = shouldOpen ? openHeight : closedHeight;
    if (Math.abs(endHeight - startHeight) < 1) {
      settle(details, shouldOpen);
      return;
    }

    details.style.overflow = "clip";
    details.style.height = startHeight + "px";
    details.dataset.disclosure = shouldOpen ? "opening" : "closing";

    const animation = details.animate(
      [{ height: startHeight + "px" }, { height: endHeight + "px" }],
      {
        duration: shouldOpen ? OPEN_MS : CLOSE_MS,
        easing: shouldOpen ? OPEN_EASE : CLOSE_EASE,
        fill: "both",
      },
    );
    animationRef.current = animation;

    animation.finished
      .then(() => {
        // A newer gesture already owns the element; leave it alone.
        if (animationRef.current !== animation) return;
        settle(details, shouldOpen);
      })
      .catch(() => {
        /* Cancelled by a newer toggle or by unmount. Expected. */
      });
  };

  return (
    <details
      className="${ns}-detail"
      data-disclosure={defaultOpen ? "open" : "closed"}
      {...(id === undefined ? {} : { id })}
      open={defaultOpen}
      ref={detailsRef}
    >
      <summary className="${ns}-detail-summary" onClick={toggle}>
        <span className="${ns}-detail-title">{summary}</span>
        <span aria-hidden="true" className="${ns}-detail-mark">
          +
        </span>
      </summary>
      <div className="${ns}-detail-body">{children}</div>
    </details>
  );
}
`;
}

/**
 * The media explorer.
 *
 * Native `<dialog>.showModal()` does the hard parts correctly and for free:
 * the top layer, Escape, making the rest of the page inert, and returning focus
 * on close. Writing a focus trap here would be re-implementing all of that
 * worse, so this owns only what is genuinely the client's: which photograph is
 * showing, how a reader moves through the sequence, and what it looks like.
 *
 * Every photograph stays composed on the page. The overlay is a closer look at
 * something already visible, never the only way to see it.
 */
export function emitMediaViewer(design: ResolvedDesign): string {
  const { ns, interaction } = design;
  return `"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

import { prefersReducedMotion } from "./motion";

export interface ViewerItem {
  readonly id: string;
  /** The photograph at the size the overlay shows it. */
  readonly full: ReactNode;
  /** Provenance travels with the image; it is not page decoration. */
  readonly caption: string;
}

interface ViewerApi {
  readonly open: (index: number) => void;
  readonly register: (index: number, element: HTMLButtonElement | null) => void;
  readonly openLabel: string;
  readonly captions: readonly string[];
}

const ViewerContext = createContext<ViewerApi | null>(null);

/*
 * Moving between photographs, resolved from this client's brief. Ordinary
 * constants in ordinary client source, on the same tempo and the same curve as
 * every other state change on the site — a viewer that moved on its own timing
 * would read as a component borrowed from somewhere else.
 *
 * The step is deliberately shorter than the overlay's own entrance: opening is
 * an arrival and deserves the full duration, whereas stepping is a continuation
 * and should not make a reader wait to see where they now are.
 */
const STEP_MS = ${Math.round(interaction.duration.overlay * 0.7)};
const STEP_EASE = "${interaction.easing.enter}";
const STEP_TRAVEL = "${interaction.travel.overlay}";

/**
 * Presents a project's photographs as one sequence, each openable at a larger
 * size.
 *
 * The photographs stay exactly where the composition put them — this wraps the
 * route rather than collecting them into a grid, so Explore can mark one in
 * place wherever it sits. The route itself stays a server component; only the
 * triggers and the overlay are client code.
 *
 * Native dialog.showModal() does the hard parts correctly and for free: the
 * top layer, Escape, and making the rest of the page inert. Writing a focus trap
 * here would be re-implementing all of that worse.
 */
export function MediaExplorer({
  items,
  label,
  openLabel,
  children,
}: {
  readonly items: readonly ViewerItem[];
  readonly label: string;
  readonly openLabel: string;
  readonly children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const figureRef = useRef<HTMLElement | null>(null);
  const stepAnimation = useRef<Animation | null>(null);
  /* Which way the reader last moved, so the next photograph enters from the
     side they came from. Reset after use, so opening the overlay does not
     animate: the dialog's own entrance is already carrying that moment. */
  const direction = useRef(0);
  const triggers = useRef(new Map<number, HTMLButtonElement>());
  const previousRef = useRef<HTMLButtonElement | null>(null);
  const nextRef = useRef<HTMLButtonElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const [active, setActive] = useState(0);

  /*
   * Moving between photographs.
   *
   * The content is swapped immediately and the *new* photograph is animated in
   * — never the old one out. A reader who holds an arrow key gets every press
   * honoured at once rather than queued behind a departure, and there is no
   * moment where the overlay shows neither photograph.
   *
   * Same discipline as the disclosure: the Web Animations API on two properties
   * of one element, cancelled by the next gesture and on unmount. No frame loop,
   * no state written per frame, no remounted image — the <figure> keeps its
   * children, so stepping never re-requests a photograph the browser has.
   */
  useEffect(() => {
    const figure = figureRef.current;
    const from = direction.current;
    direction.current = 0;
    if (figure === null || from === 0 || prefersReducedMotion()) return;

    stepAnimation.current?.cancel();
    const animation = figure.animate(
      [
        {
          opacity: 0,
          transform: "translateX(" + (from > 0 ? "" : "-") + STEP_TRAVEL + ")",
        },
        { opacity: 1, transform: "none" },
      ],
      { duration: STEP_MS, easing: STEP_EASE },
    );
    stepAnimation.current = animation;
    animation.finished
      .then(() => {
        if (stepAnimation.current === animation) stepAnimation.current = null;
      })
      .catch(() => {
        /* Cancelled by a newer step or by unmount. Expected. */
      });
    return () => animation.cancel();
  }, [active]);

  /*
   * Reaching either end of the sequence disables the control that got you
   * there, and a disabled button cannot keep focus — the browser drops it to
   * the document, and the reader's next Arrow press goes nowhere. Whenever a
   * step leaves focus outside the overlay it is handed to the control that
   * still has somewhere to go, so stepping by keyboard and by pointer both stay
   * continuous to the last photograph.
   */
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null || !dialog.open) return;
    if (dialog.contains(document.activeElement)) return;
    const rescue =
      previousRef.current !== null && !previousRef.current.disabled
        ? previousRef.current
        : nextRef.current;
    (rescue ?? closeRef.current)?.focus();
  }, [active]);

  const register = useCallback(
    (index: number, element: HTMLButtonElement | null) => {
      if (element === null) triggers.current.delete(index);
      else triggers.current.set(index, element);
    },
    [],
  );

  const open = useCallback((index: number) => {
    setActive(index);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  }, []);

  const captions = useMemo(() => items.map((item) => item.caption), [items]);

  const api = useMemo<ViewerApi>(
    () => ({ open, register, openLabel, captions }),
    [open, register, openLabel, captions],
  );

  const current = items[active];

  /*
   * Focus returns to the photograph the reader is now looking at, which is not
   * always the one they opened. Landing back on the first thumbnail after
   * stepping to the third photograph loses a keyboard reader's place.
   *
   * This is bound to the dialog's own \`close\` event rather than to the Close
   * button, because Escape closes a modal dialog without going anywhere near
   * that button. Handling it there would have returned a reader who opened the
   * first photograph, stepped to the third and pressed Escape back to the first
   * thumbnail — the native behaviour, which restores focus to whatever had it
   * when showModal() was called. One handler, both exits, same answer.
   */
  const onClose = () => {
    stepAnimation.current?.cancel();
    stepAnimation.current = null;
    direction.current = 0;
    triggers.current.get(active)?.focus();
  };

  const step = (delta: number) => {
    setActive((index) => {
      const next = Math.min(items.length - 1, Math.max(0, index + delta));
      if (next !== index) direction.current = delta;
      return next;
    });
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      step(-1);
    }
  };

  return (
    <ViewerContext.Provider value={api}>
      {children}
      {items.length === 0 || current === undefined ? null : (
        <dialog
          aria-label={label}
          className="${ns}-viewer"
          onClose={onClose}
          onKeyDown={onKeyDown}
          ref={dialogRef}
        >
          <div className="${ns}-viewer-frame">
            <figure className="${ns}-viewer-figure" ref={figureRef}>
              {current.full}
              <figcaption className="${ns}-viewer-caption">
                {current.caption}
              </figcaption>
            </figure>
            <div className="${ns}-viewer-bar">
              <p className="${ns}-viewer-count">
                {active + 1} / {items.length}
              </p>
              <div className="${ns}-viewer-controls">
                <button
                  className="${ns}-viewer-button"
                  disabled={active === 0}
                  onClick={() => step(-1)}
                  ref={previousRef}
                  type="button"
                >
                  Previous
                </button>
                <button
                  className="${ns}-viewer-button"
                  disabled={active === items.length - 1}
                  onClick={() => step(1)}
                  ref={nextRef}
                  type="button"
                >
                  Next
                </button>
                <button
                  autoFocus
                  className="${ns}-viewer-button"
                  onClick={() => dialogRef.current?.close()}
                  ref={closeRef}
                  type="button"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </dialog>
      )}
    </ViewerContext.Provider>
  );
}

/**
 * Marks one photograph, in place, as the way into the sequence at its position.
 *
 * Outside an explorer it renders its child untouched, so a composition that
 * places a photograph the client's language did not make explorable still
 * renders exactly as composed.
 */
export function Explore({
  index,
  children,
}: {
  readonly index: number;
  readonly children: ReactNode;
}) {
  const viewer = useContext(ViewerContext);
  if (viewer === null) return <>{children}</>;
  return (
    <button
      aria-label={viewer.openLabel + ": " + (viewer.captions[index] ?? "")}
      className="${ns}-explore"
      onClick={() => viewer.open(index)}
      ref={(element) => viewer.register(index, element)}
      type="button"
    >
      {children}
    </button>
  );
}
`;
}

/**
 * Entrance.
 *
 * Replaces A3's one-observer-per-element helper with a single observer shared
 * by every revealable element on the page, created on first use and disconnected
 * the moment nothing is waiting. A page with thirty revealable elements holds
 * one observer, not thirty.
 *
 * The un-revealed state is still deliberately *visible* until this hydrates and
 * claims it, so a reader without JavaScript, or one who arrives mid-hydration,
 * sees the finished page rather than an empty one.
 */
export function emitReveal(): string {
  return `"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { prefersReducedMotion } from "./motion";

const pending = new Map<Element, () => void>();
let observer: IntersectionObserver | null = null;

function release(element: Element) {
  pending.delete(element);
  observer?.unobserve(element);
  if (pending.size > 0) return;
  observer?.disconnect();
  observer = null;
}

function sharedObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === "undefined") return null;
  if (observer !== null) return observer;
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        pending.get(entry.target)?.();
        release(entry.target);
      }
    },
    { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
  );
  return observer;
}

/** Marks its child visible once, the first time it enters the viewport. */
export function Reveal({
  children,
  className,
  as,
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
  readonly as?: "media" | undefined;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const settle = () => {
      element.dataset.reveal = "visible";
    };

    /*
     * Three ways to be already finished: the reader asked for reduced motion,
     * the element is on screen at hydration, or the browser has no observer.
     * None of them ever puts the element into the pending state, so nothing can
     * be seen to flicker and nothing can be left hidden.
     */
    if (
      prefersReducedMotion() ||
      element.getBoundingClientRect().top < window.innerHeight
    ) {
      settle();
      return;
    }

    const current = sharedObserver();
    if (current === null) {
      settle();
      return;
    }

    element.dataset.reveal = "pending";
    pending.set(element, settle);
    current.observe(element);
    return () => release(element);
  }, []);

  return (
    <div className={className} data-reveal-as={as} ref={ref}>
      {children}
    </div>
  );
}
`;
}

/**
 * Closing continuity for the collapsed navigation.
 *
 * The menu is a native `<details>` the Platform renders — the Platform owns
 * disclosure and truthful-state mechanics, and this does not take that back.
 * What it adds is the movement CSS cannot do: no cross-browser rule can
 * interpolate a `<details>` to or from its intrinsic height today, so the open
 * was a keyframe and the close was nothing. A menu that arrives and then
 * vanishes reads as a dropped frame rather than as restraint.
 *
 * The enhancement attaches to the client's *own* class names, the ones the
 * Shell passed to the primitive, and does nothing at all if it cannot find
 * them. So: no Platform change, no forked primitive, no second navigation in
 * the accessibility tree, and a reader without JavaScript keeps exactly the
 * native open and close they had before.
 */
export function emitMenu(design: ResolvedDesign): string {
  const { ns, interaction } = design;
  return `"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { prefersReducedMotion } from "./motion";

const OPEN_MS = ${interaction.duration.state};
const CLOSE_MS = ${Math.round(interaction.duration.state * 0.85)};
const OPEN_EASE = "${interaction.easing.enter}";
const CLOSE_EASE = "${interaction.easing.exit}";

/**
 * Gives the collapsed navigation a close that moves, matching its open.
 *
 * The *panel* is what is animated, not the \`<details>\`. This composition sets
 * the panel \`position: absolute\` so it can hang below the header without
 * pushing the page down, which means the element's own box never changes size
 * when it opens — animating it would be animating nothing. The panel is what
 * appears and disappears, so the panel is what has to move.
 *
 * The \`<details>\` is held open for the whole of the closing animation and only
 * closed at the end, because a closed one stops rendering its panel and there
 * would be nothing left to animate.
 *
 * \`display: contents\` on the wrapper because it is a place to hold a ref and
 * nothing else: the header's layout has to reach the navigation exactly as it
 * did before this element existed.
 */
export function Menu({ children }: { readonly children: ReactNode }) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const animationRef = useRef<Animation | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    const details = host.querySelector<HTMLDetailsElement>(".${ns}-menu");
    const summary = details?.querySelector<HTMLElement>(".${ns}-menu-toggle");
    /*
     * The primitive is free to change its markup; this is an enhancement, not a
     * contract. If the shape is not what this expects, the native behaviour is
     * already correct and this simply does not run.
     */
    if (
      details === null ||
      details === undefined ||
      summary === null ||
      summary === undefined
    ) {
      return;
    }

    const panelOf = () =>
      details.querySelector<HTMLElement>(".${ns}-menu-panel");

    const settle = (open: boolean) => {
      const panel = panelOf();
      if (panel !== null) {
        panel.style.removeProperty("height");
        panel.style.removeProperty("overflow");
      }
      details.open = open;
      animationRef.current?.cancel();
      animationRef.current = null;
      details.dataset.menu = open ? "open" : "closed";
    };

    const toggle = (event: MouseEvent) => {
      event.preventDefault();

      const running = animationRef.current;
      const closing = details.dataset.menu === "closing";
      const shouldOpen = closing || !details.open;

      /*
       * Where the panel is *right now*, captured before the cancel: cancelling
       * a filling animation returns the element to its CSS height, so measuring
       * afterwards would read where the movement was going rather than where a
       * reader can see it. An interrupted toggle has to start from what is on
       * the screen.
       */
      const wasOpen = details.open;
      const inFlight = panelOf()?.getBoundingClientRect().height ?? 0;
      running?.cancel();
      animationRef.current = null;

      if (prefersReducedMotion()) {
        settle(shouldOpen);
        return;
      }

      // The panel only exists while the element is open, and the closing
      // animation needs it, so it is opened first in both directions.
      details.open = true;
      const panel = panelOf();
      if (panel === null) {
        settle(shouldOpen);
        return;
      }

      /*
       * A panel that was closed has no height on the screen, whatever it
       * measures the instant it is rendered. Opening from its own full height
       * would be a movement of nothing.
       */
      const startHeight = wasOpen ? inFlight : 0;
      const openHeight = panel.scrollHeight;
      const endHeight = shouldOpen ? openHeight : 0;
      if (Math.abs(endHeight - startHeight) < 1) {
        settle(shouldOpen);
        return;
      }

      panel.style.overflow = "clip";
      panel.style.height = startHeight + "px";
      details.dataset.menu = shouldOpen ? "opening" : "closing";

      const animation = panel.animate(
        [{ height: startHeight + "px" }, { height: endHeight + "px" }],
        {
          duration: shouldOpen ? OPEN_MS : CLOSE_MS,
          easing: shouldOpen ? OPEN_EASE : CLOSE_EASE,
          fill: "both",
        },
      );
      animationRef.current = animation;
      animation.finished
        .then(() => {
          if (animationRef.current !== animation) return;
          settle(shouldOpen);
        })
        .catch(() => {
          /* Cancelled by a newer toggle or by unmount. Expected. */
        });
    };

    summary.addEventListener("click", toggle);
    return () => {
      summary.removeEventListener("click", toggle);
      animationRef.current?.cancel();
      animationRef.current = null;
      const panel = panelOf();
      if (panel !== null) {
        panel.style.removeProperty("height");
        panel.style.removeProperty("overflow");
      }
    };
  }, []);

  return (
    <div ref={hostRef} style={{ display: "contents" }}>
      {children}
    </div>
  );
}
`;
}
