"use client";

import { useEffect, useRef, useState } from "react";

import "../styles/conductor.css";

export interface ConductorProps {
  /** One node per story beat, plus the outcome and the conversion panel. */
  readonly nodeCount: number;
}

/**
 * The Conductor — Harbour Electrical & Air's Signature interaction.
 *
 * A brass line is drawn down the project document, connecting the hero to each
 * story beat and finally into the conversion panel. It tells the reader where
 * they are in the story and that the story is finite.
 *
 * Three deliberate implementation choices:
 *
 * 1. Where the browser supports native scroll-driven animation, the line is
 *    drawn by CSS alone against the scroll timeline. No JavaScript runs per
 *    frame and no animation library is involved.
 * 2. Where it does not, a single IntersectionObserver advances progress in
 *    discrete steps. Observers are passive and are disconnected on unmount, so
 *    nothing survives a route change.
 * 3. Under reduced motion the component does no work at all: CSS draws the line
 *    complete and lights every node, and this effect exits immediately.
 */
export function Conductor({ nodeCount }: ConductorProps) {
  const [progress, setProgress] = useState<number | undefined>(undefined);
  const reference = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const supportsScrollTimeline =
      typeof CSS !== "undefined" &&
      CSS.supports("animation-timeline: view()");

    // Nothing to do: CSS already draws the final state in both of these cases.
    if (reduced.matches || supportsScrollTimeline) return;

    const beats = document.querySelectorAll<HTMLElement>("[data-beat-index]");
    if (beats.length === 0) return;

    let reached = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const index = Number(
            entry.target.getAttribute("data-beat-index") ?? "0",
          );
          if (index + 1 > reached) {
            reached = index + 1;
            entry.target.setAttribute("data-reached", "true");
            setProgress(Math.min(1, reached / nodeCount));
          }
        }
      },
      { rootMargin: "0px 0px -45% 0px", threshold: 0.01 },
    );

    for (const beat of beats) observer.observe(beat);
    return () => observer.disconnect();
  }, [nodeCount]);

  // A single vertical run with a short jog at each node, so the line reads as
  // installed conductor rather than as a progress bar.
  const height = 1000;
  const step = height / (nodeCount + 1);
  const points: string[] = ["M 24 0"];
  for (let index = 1; index <= nodeCount; index += 1) {
    const y = step * index;
    const jog = index % 2 === 0 ? 40 : 8;
    points.push(`L 24 ${y - 26}`, `L ${jog} ${y}`, `L 24 ${y + 26}`);
  }
  points.push(`L 24 ${height}`);
  const path = points.join(" ");

  return (
    <div
      className="hea-conductor-track"
      {...(progress === undefined
        ? {}
        : {
            "data-conductor-progress": "",
            style: { "--conductor-progress": progress } as React.CSSProperties,
          })}
    >
      <svg
        aria-hidden="true"
        className="hea-conductor-svg"
        focusable="false"
        preserveAspectRatio="none"
        ref={reference}
        viewBox={`0 0 48 ${height}`}
      >
        <path className="hea-conductor-rail" d={path} />
        <path
          className="hea-conductor-live"
          d={path}
          style={{ "--conductor-length": 2400 } as React.CSSProperties}
        />
        {Array.from({ length: nodeCount }, (_, index) => {
          const y = step * (index + 1);
          const jog = (index + 1) % 2 === 0 ? 40 : 8;
          const lit =
            progress !== undefined && progress >= (index + 1) / nodeCount;
          return (
            <circle
              className="hea-conductor-node"
              cx={jog}
              cy={y}
              data-reached={lit ? "true" : "false"}
              key={index}
              r={6}
            />
          );
        })}
      </svg>
    </div>
  );
}
