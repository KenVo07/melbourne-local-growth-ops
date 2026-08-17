/**
 * Emits the client's baseline entrance helper.
 *
 * Emitted only when the brief asks for entrance motion, so a client that does
 * not want it ships no client JavaScript at all and the manifest says so.
 *
 * Cost budget, deliberately small:
 *   - no dependency, no library, no animation frame loop, no scroll listener;
 *   - no React state, so nothing re-renders per frame;
 *   - one IntersectionObserver per element, disconnected on unmount and
 *     unobserved on first intersection, so nothing accumulates;
 *   - anything already on screen when the effect runs is marked visible
 *     immediately and never enters the hidden state, so there is no flash;
 *   - nothing hides before hydration, so a reader without JavaScript sees the
 *     finished page rather than an empty one.
 */
export function emitReveal(): string {
  return `"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Marks its child visible once, the first time it enters the viewport.
 *
 * The element carries no reveal state until this effect runs, so the page is
 * complete without JavaScript. An element already on screen is marked visible
 * without ever being hidden; only something below the fold is put into the
 * pending state, where it cannot be seen to flicker.
 */
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

    if (typeof IntersectionObserver === "undefined") {
      settle();
      return;
    }

    const viewportHeight = window.innerHeight;
    if (element.getBoundingClientRect().top < viewportHeight) {
      settle();
      return;
    }

    element.dataset.reveal = "pending";
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          settle();
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.08 },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);

  return (
    <div className={className} ref={ref}>
      {children}
    </div>
  );
}
`;
}
