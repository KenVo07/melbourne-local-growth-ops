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
  const { ns } = design;
  return `"use client";

import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";

export interface ViewerItem {
  readonly id: string;
  /** The photograph as it is composed on the page. */
  readonly figure: ReactNode;
  /** The same photograph, at the size the overlay shows it. */
  readonly full: ReactNode;
  /** Provenance travels with the image; it is not page decoration. */
  readonly caption: string;
}

/**
 * Presents a sequence of photographs, each openable at a larger size.
 *
 * The controls are visible buttons rather than a swipe gesture, so a touch
 * reader and a keyboard reader use the same affordance; Arrow keys work as well
 * once the overlay is open. The position indicator is what makes it a sequence
 * rather than a stack — a reader can tell where they are and how much is left.
 */
export function MediaViewer({
  items,
  label,
  openLabel,
}: {
  readonly items: readonly ViewerItem[];
  readonly label: string;
  readonly openLabel: string;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggers = useRef(new Map<string, HTMLButtonElement>());
  const [active, setActive] = useState(0);

  if (items.length === 0) return null;

  const current = items[active] ?? items[0];
  if (current === undefined) return null;

  const open = (index: number) => {
    setActive(index);
    const dialog = dialogRef.current;
    if (dialog !== null && !dialog.open) dialog.showModal();
  };

  /*
   * Focus goes back to the photograph the reader is now looking at, which is
   * not always the one they opened. Landing back on the third thumbnail after
   * stepping to the third photograph is the only version that does not lose a
   * keyboard reader's place.
   */
  const close = () => {
    dialogRef.current?.close();
    const target = items[active];
    if (target !== undefined) triggers.current.get(target.id)?.focus();
  };

  const step = (delta: number) => {
    setActive((index) => Math.min(items.length - 1, Math.max(0, index + delta)));
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
    <>
      {items.map((item, index) => (
        <button
          aria-label={openLabel + ": " + item.caption}
          className="${ns}-explore"
          key={item.id}
          onClick={() => open(index)}
          ref={(element) => {
            if (element === null) triggers.current.delete(item.id);
            else triggers.current.set(item.id, element);
          }}
          type="button"
        >
          {item.figure}
        </button>
      ))}
      <dialog
        aria-label={label}
        className="${ns}-viewer"
        onKeyDown={onKeyDown}
        ref={dialogRef}
      >
        <div className="${ns}-viewer-frame">
          <figure className="${ns}-viewer-figure">
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
                type="button"
              >
                Previous
              </button>
              <button
                className="${ns}-viewer-button"
                disabled={active === items.length - 1}
                onClick={() => step(1)}
                type="button"
              >
                Next
              </button>
              <button
                autoFocus
                className="${ns}-viewer-button"
                onClick={close}
                type="button"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      </dialog>
    </>
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
}: {
  readonly children: ReactNode;
  readonly className?: string | undefined;
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
    <div className={className} ref={ref}>
      {children}
    </div>
  );
}
`;
}
