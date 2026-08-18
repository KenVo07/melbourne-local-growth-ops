/**
 * Signature Capability Envelope probe.
 *
 * What a client-local Signature may actually do is decided by
 * `apps/managed-web/src/generation/client-experience-source-policy.ts`, which is
 * a fail-closed build-time inspector. Reading that file is not proof: the
 * refusals interact (an identifier banned in *any* reference position behaves
 * differently from a banned JSX tag), and the file changes.
 *
 * So this probe does not describe the envelope. It measures it. Each candidate
 * below is a minimal client experience exercising exactly one technique, run
 * through the real `inspectClientExperienceSource`. The result is a capability
 * matrix a Signature Slice can be validated against, so a prototype cannot
 * promise a technique production would refuse.
 *
 * Re-run this whenever the source policy changes:
 *   pnpm creative:envelope
 */
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  inspectClientExperienceSource,
  ClientExperienceSourcePolicyError,
} from "../../apps/managed-web/src/generation/client-experience-source-policy";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

type Expectation = "PERMITTED" | "REFUSED";

interface Candidate {
  /** Stable id a Signature Slice declares in its front-matter `techniques`. */
  readonly id: string;
  readonly summary: string;
  /** What a creative operator would call this. */
  readonly creativeUse: string;
  readonly expected: Expectation;
  /** Extra files beyond the baseline experience. */
  readonly files: Readonly<Record<string, string>>;
  readonly dependencies?: readonly { name: string; version: string }[];
  readonly approvedDependencies?: readonly string[];
  /**
   * Optional. When set, the refusal must arrive by this exact code. A candidate
   * can otherwise be "refused" for an incidental reason -- malformed source, a
   * missing file -- and look like proof of a rule it never reached.
   */
  readonly expectedCode?: string;
}

const baselineManifest = {
  schemaVersion: 1 as const,
  kind: "AUTHORED_CLIENT_EXPERIENCE" as const,
  experienceId: "envelope-probe",
  experienceVersion: "1.0.0",
  entrypoint: "index.tsx" as const,
  designDnaPath: "design-dna.json" as const,
  routeIds: ["home"],
  signatureIds: [] as string[],
  publicDependencies: [] as { name: string; version: string }[],
  runtime: {
    clientJavaScript: "COMPONENT_SCOPED" as const,
    motion: "NATIVE" as const,
    reducedMotion: "REQUIRED" as const,
  },
};

/** The smallest experience the policy accepts, used as every candidate's base. */
const baselineFiles: Readonly<Record<string, string>> = {
  "manifest.json": JSON.stringify(baselineManifest, null, 2),
  "design-dna.json": JSON.stringify({ schemaVersion: 1 }, null, 2),
  "index.tsx": [
    `import { defineClientExperience } from "@proportion/client-experience";`,
    `import { HomeRoute } from "./routes/home";`,
    ``,
    `export default defineClientExperience({`,
    `  schemaVersion: 1,`,
    `  experienceId: "envelope-probe",`,
    `  experienceVersion: "1.0.0",`,
    `  routes: { home: HomeRoute },`,
    `});`,
    ``,
  ].join("\n"),
  "routes/home.tsx": [
    `import type { ClientExperienceRouteProps } from "@proportion/client-experience";`,
    ``,
    `export function HomeRoute({ platform }: ClientExperienceRouteProps) {`,
    `  const { Main } = platform;`,
    `  return <Main><h1>Probe</h1></Main>;`,
    `}`,
    ``,
  ].join("\n"),
};

/**
 * A signature module wrapper, so each candidate is shaped like real work.
 *
 * `body` accepts an array because most candidates are multi-line; joining here
 * rather than at each call site removes a real footgun. An earlier version took
 * only a string, and a candidate that passed an array was comma-joined into
 * malformed source -- so the probe reported SOURCE_PARSE_ERROR and appeared to
 * confirm a refusal it had never actually tested.
 */
function signature(body: string | readonly string[], imports = ""): string {
  const lines = Array.isArray(body) ? body.join("\n") : (body as string);
  return [
    `import type { ClientExperienceSignatureProps } from "@proportion/client-experience";`,
    imports,
    ``,
    `export function ProbeSignature({ platform }: ClientExperienceSignatureProps) {`,
    lines,
    `}`,
    ``,
  ].join("\n");
}

const candidates: readonly Candidate[] = [
  // ---------------------------------------------------------------- motion
  {
    id: "css-transition-keyframes",
    summary: "CSS transitions and @keyframes in a client-local stylesheet",
    creativeUse: "State change, hover character, entrance choreography",
    expected: "PERMITTED",
    files: {
      "styles/signature.css": [
        `.sig { transition: transform 480ms cubic-bezier(0.2, 0, 0, 1); }`,
        `@keyframes sig-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; } }`,
        `.sig--enter { animation: sig-rise 640ms both; }`,
      ].join("\n"),
    },
  },
  {
    id: "css-scroll-driven-animation",
    summary: "Native CSS scroll-driven animation (animation-timeline / scroll())",
    creativeUse: "Scroll-linked drawing, progress spines, parallax without JS",
    expected: "PERMITTED",
    files: {
      "styles/scroll.css": [
        `@supports (animation-timeline: scroll()) {`,
        `  .conductor { animation: draw linear both; animation-timeline: scroll(root block); }`,
        `}`,
        `@keyframes draw { to { stroke-dashoffset: 0; } }`,
      ].join("\n"),
    },
  },
  {
    id: "waapi-element-animate",
    summary: "Web Animations API via element.animate()",
    creativeUse: "Interruptible, sequenced motion driven by real state",
    expected: "PERMITTED",
    files: {
      "signatures/waapi.tsx": signature(
        [
          `  const ref = useRef<HTMLDivElement>(null);`,
          `  useEffect(() => {`,
          `    const animation = ref.current?.animate(`,
          `      [{ opacity: 0 }, { opacity: 1 }],`,
          `      { duration: 600, easing: "cubic-bezier(0.2,0,0,1)", fill: "both" },`,
          `    );`,
          `    return () => animation?.cancel();`,
          `  }, []);`,
          `  return <div ref={ref} />;`,
        ].join("\n"),
        `import { useEffect, useRef } from "react";`,
      ),
    },
  },
  {
    id: "request-animation-frame",
    summary: "requestAnimationFrame loop",
    creativeUse: "Continuous custom motion, physics, cursor-following behaviour",
    expected: "PERMITTED",
    files: {
      "signatures/raf.tsx": signature(
        [
          `  useEffect(() => {`,
          `    let frame = 0;`,
          `    const tick = () => { frame = requestAnimationFrame(tick); };`,
          `    frame = requestAnimationFrame(tick);`,
          `    return () => cancelAnimationFrame(frame);`,
          `  }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "intersection-observer",
    summary: "IntersectionObserver",
    creativeUse: "Entrance reveals, stepwise scroll narrative, lazy behaviour",
    expected: "PERMITTED",
    files: {
      "signatures/io.tsx": signature(
        [
          `  useEffect(() => {`,
          `    const observer = new IntersectionObserver(() => {});`,
          `    return () => observer.disconnect();`,
          `  }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "resize-observer",
    summary: "ResizeObserver",
    creativeUse: "Composition that responds to its own measured box",
    expected: "PERMITTED",
    files: {
      "signatures/ro.tsx": signature(
        [
          `  useEffect(() => {`,
          `    const observer = new ResizeObserver(() => {});`,
          `    return () => observer.disconnect();`,
          `  }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "match-media-reduced-motion",
    summary: "matchMedia for prefers-reduced-motion",
    creativeUse: "Designed reduced-motion state, required by every Signature",
    expected: "PERMITTED",
    files: {
      "signatures/rm.tsx": signature(
        [
          `  const reduced = typeof window === "undefined"`,
          `    ? false`,
          `    : window.matchMedia("(prefers-reduced-motion: reduce)").matches;`,
          `  return <div data-reduced={reduced} />;`,
        ].join("\n"),
      ),
    },
  },
  {
    id: "view-transitions",
    summary: "document.startViewTransition()",
    creativeUse: "Route and state continuity",
    expected: "PERMITTED",
    files: {
      "signatures/vt.tsx": signature(
        [
          `  const go = () => {`,
          `    const runner = document as Document & {`,
          `      startViewTransition?: (callback: () => void) => void;`,
          `    };`,
          `    runner.startViewTransition?.(() => {});`,
          `  };`,
          `  return <button type="button" onClick={go} />;`,
        ].join("\n"),
      ),
    },
  },
  // ---------------------------------------------------------------- surfaces
  {
    id: "canvas-2d",
    summary: "<canvas> with a 2D context",
    creativeUse: "Generative ornament, drawn diagrams, particle fields",
    expected: "PERMITTED",
    files: {
      "signatures/canvas.tsx": signature(
        [
          `  const ref = useRef<HTMLCanvasElement>(null);`,
          `  useEffect(() => {`,
          `    const context = ref.current?.getContext("2d");`,
          `    context?.beginPath();`,
          `  }, []);`,
          `  return <canvas ref={ref} />;`,
        ].join("\n"),
        `import { useEffect, useRef } from "react";`,
      ),
    },
  },
  {
    id: "webgl-inline-shaders",
    summary: "WebGL context with shader sources as inline string literals",
    creativeUse: "Shader-driven media treatment, 3D, displacement",
    expected: "PERMITTED",
    files: {
      "signatures/webgl.tsx": signature(
        [
          `  const ref = useRef<HTMLCanvasElement>(null);`,
          `  useEffect(() => {`,
          `    const gl = ref.current?.getContext("webgl2");`,
          `    const shader = gl?.createShader(gl.VERTEX_SHADER);`,
          `    if (gl && shader) gl.shaderSource(shader, VERTEX_SOURCE);`,
          `  }, []);`,
          `  return <canvas ref={ref} />;`,
        ].join("\n"),
        [
          `import { useEffect, useRef } from "react";`,
          ``,
          "const VERTEX_SOURCE = `#version 300 es",
          `in vec2 position;`,
          `void main() { gl_Position = vec4(position, 0.0, 1.0); }`,
          "`;",
        ].join("\n"),
      ),
    },
  },
  {
    id: "inline-svg-geometry",
    summary: "Inline SVG geometry authored in JSX",
    creativeUse: "Drawn line work, stroke-dash narrative, masks",
    expected: "PERMITTED",
    files: {
      "signatures/svg.tsx": signature(
        [
          `  return (`,
          `    <svg viewBox="0 0 100 400" aria-hidden="true">`,
          `      <path d="M50 0 V400" pathLength={1} strokeDasharray={1} />`,
          `    </svg>`,
          `  );`,
        ].join("\n"),
      ),
    },
  },
  {
    id: "video-element-local-source",
    summary: "<video> element with a client-owned relative source path",
    creativeUse: "Motion media, ambient background footage",
    expected: "PERMITTED",
    files: {
      "signatures/video.tsx": signature(
        [
          `  return <video src="/assets/media/loop.mp4" muted playsInline />;`,
        ].join("\n"),
      ),
    },
  },
  {
    id: "css-local-font-face",
    summary: "@font-face referencing a self-hosted /fonts/ file",
    creativeUse: "Licensed typography without a third-party request",
    expected: "PERMITTED",
    files: {
      "styles/type.css": [
        `@font-face { font-family: "ClientFace"; src: url(/fonts/client-face.woff2) format("woff2"); }`,
      ].join("\n"),
    },
  },
  {
    id: "css-inline-svg-data-uri",
    summary:
      "Inline SVG data URI as a CSS mask, with every quote percent-encoded",
    creativeUse: "Ornament, texture, masked reveals — no third-party request",
    expected: "PERMITTED",
    files: {
      "styles/mask.css": [
        `.plate { mask-image: url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%3E%3C/svg%3E"); }`,
      ].join("\n"),
    },
  },
  {
    /*
     * The same asset written the way a designer or a prototype would paste it,
     * with literal quotes inside the data URI. `allowedCssResource` excludes
     * `"`, `'` and `)` from the permitted tail, so this fails closed even though
     * the equivalent percent-encoded form above is accepted. Probed separately
     * because the difference is invisible in a browser and is exactly the kind
     * of detail a prototype hands to production unnoticed.
     */
    id: "css-svg-data-uri-literal-quotes",
    summary: "Inline SVG data URI containing literal quote characters",
    creativeUse: "Pasting an SVG mask straight out of a design tool",
    expected: "REFUSED",
    files: {
      "styles/mask-raw.css": [
        `.plate { mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E"); }`,
      ].join("\n"),
    },
  },
  {
    id: "scoped-approved-dependency",
    summary: "A scoped npm dependency declared in the manifest and governance-approved",
    creativeUse: "A library that materially improves one client's Signature",
    expected: "PERMITTED",
    files: {
      "signatures/dep.tsx": signature(
        [`  return <div />;`],
        `import { clamp } from "scoped-motion-helper";`,
      ),
    },
    dependencies: [{ name: "scoped-motion-helper", version: "1.2.3" }],
    approvedDependencies: ["scoped-motion-helper"],
  },
  // ---------------------------------------------------------------- refusals
  {
    id: "undeclared-dependency",
    summary: "An npm dependency that governance has not approved",
    creativeUse: "Reaching for a library mid-build",
    expected: "REFUSED",
    files: {
      "signatures/undeclared.tsx": signature(
        [`  return <div />;`],
        `import gsap from "gsap";`,
      ),
    },
  },
  {
    id: "fetch-runtime-data",
    summary: "fetch() at runtime",
    creativeUse: "Loading shader files, model geometry, JSON, live data",
    expected: "REFUSED",
    files: {
      "signatures/fetch.tsx": signature(
        [
          `  useEffect(() => { void fetch("/data/scene.json"); }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "image-constructor-texture",
    summary: "new Image() to preload a texture or bitmap",
    creativeUse: "Loading imagery into canvas or WebGL",
    expected: "REFUSED",
    files: {
      "signatures/texture.tsx": signature(
        [
          `  useEffect(() => { const bitmap = new Image(); bitmap.src = "/assets/t.png"; }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "web-worker",
    summary: "new Worker() for off-main-thread work",
    creativeUse: "Heavy generative or physics computation",
    expected: "REFUSED",
    files: {
      "signatures/worker.tsx": signature(
        [
          `  useEffect(() => { const worker = new Worker("/w.js"); worker.terminate(); }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "local-storage-persistence",
    summary: "localStorage / sessionStorage",
    creativeUse: "Remembering a visitor's state between visits",
    expected: "REFUSED",
    files: {
      "signatures/store.tsx": signature(
        [
          `  useEffect(() => { localStorage.setItem("seen", "1"); }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "audio-constructor",
    summary: "new Audio() playback",
    creativeUse: "Sound design on interaction",
    expected: "REFUSED",
    files: {
      "signatures/audio.tsx": signature(
        [
          `  useEffect(() => { const track = new Audio("/a.mp3"); void track; }, []);`,
          `  return null;`,
        ].join("\n"),
        `import { useEffect } from "react";`,
      ),
    },
  },
  {
    id: "raw-anchor-tag",
    summary: "A raw <a> element",
    creativeUse: "Any bespoke link treatment",
    expected: "REFUSED",
    files: {
      "signatures/anchor.tsx": signature([`  return <a href="/contact">Contact</a>;`]),
    },
  },
  {
    id: "raw-img-tag",
    summary: "A raw <img> element",
    creativeUse: "Any bespoke image treatment",
    expected: "REFUSED",
    files: {
      "signatures/img.tsx": signature([`  return <img src="/assets/hero.png" alt="" />;`]),
    },
  },
  {
    id: "iframe-embed",
    summary: "<iframe> embed",
    creativeUse: "Third-party map, video or tool embed",
    expected: "REFUSED",
    files: {
      "signatures/frame.tsx": signature([`  return <iframe src="/embed" title="embed" />;`]),
    },
  },
  {
    id: "dangerously-set-inner-html",
    summary: "dangerouslySetInnerHTML",
    creativeUse: "Injecting authored markup or SVG strings",
    expected: "REFUSED",
    files: {
      "signatures/html.tsx": signature([
        `  return <div dangerouslySetInnerHTML={{ __html: "<b>x</b>" }} />;`,
      ]),
    },
  },
  {
    id: "css-remote-webfont",
    summary: "@font-face pointing at a third-party font CDN",
    creativeUse: "Using a hosted webfont service",
    expected: "REFUSED",
    files: {
      "styles/remote.css": [
        `@font-face { font-family: "Remote"; src: url(https://fonts.example.com/f.woff2); }`,
      ].join("\n"),
    },
  },
  {
    id: "css-raster-background",
    summary: "CSS background-image referencing a local raster file",
    creativeUse: "Photographic backgrounds set from the stylesheet",
    expected: "REFUSED",
    files: {
      "styles/bg.css": [`.hero { background-image: url(/assets/hero.png); }`].join("\n"),
    },
  },
  {
    id: "css-import",
    summary: "CSS @import",
    creativeUse: "Splitting stylesheets",
    expected: "REFUSED",
    files: {
      "styles/imported.css": `@import "./other.css";`,
    },
  },
  {
    id: "next-framework-import",
    summary: "Importing next/image or next/link",
    creativeUse: "Reaching for framework primitives directly",
    expected: "REFUSED",
    files: {
      "signatures/next.tsx": signature(
        [`  return <div />;`],
        `import NextImage from "next/image";`,
      ),
    },
  },
  {
    id: "javascript-url",
    summary: "A javascript: URL",
    creativeUse: "n/a — probed because it must stay refused",
    expected: "REFUSED",
    files: {
      "signatures/jsurl.tsx": signature([
        `  return <button type="button" formAction="javascript:void(0)" />;`,
      ]),
    },
  },
  {
    id: "dynamic-code-execution",
    summary: "eval / new Function()",
    creativeUse: "n/a — probed because it must stay refused",
    expected: "REFUSED",
    files: {
      "signatures/eval.tsx": signature([
        `  const make = Function("return 1");`,
        `  return <div>{String(make)}</div>;`,
      ]),
    },
    expectedCode: "EXECUTION_PRIMITIVE_FORBIDDEN",
  },
];

interface ProbeResult {
  readonly id: string;
  readonly summary: string;
  readonly creativeUse: string;
  readonly expected: Expectation;
  readonly observed: Expectation;
  readonly errorCode: string | null;
  readonly message: string | null;
  readonly agrees: boolean;
}

async function probe(candidate: Candidate): Promise<ProbeResult> {
  const workspace = await mkdtemp(join(tmpdir(), "creative-envelope-"));
  try {
    const manifest = {
      ...baselineManifest,
      publicDependencies: [...(candidate.dependencies ?? [])],
    };
    const files: Record<string, string> = {
      ...baselineFiles,
      "manifest.json": JSON.stringify(manifest, null, 2),
      ...candidate.files,
    };
    for (const [relativePath, contents] of Object.entries(files)) {
      const absolute = join(workspace, "experience", relativePath);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, contents, "utf8");
    }

    try {
      await inspectClientExperienceSource({
        inputDirectory: workspace,
        manifest,
        approvedPublicDependencies: candidate.approvedDependencies ?? [],
      });
      return {
        id: candidate.id,
        summary: candidate.summary,
        creativeUse: candidate.creativeUse,
        expected: candidate.expected,
        observed: "PERMITTED",
        errorCode: null,
        message: null,
        agrees: candidate.expected === "PERMITTED",
      };
    } catch (error) {
      const policyError =
        error instanceof ClientExperienceSourcePolicyError ? error : undefined;
      if (policyError === undefined) throw error;
      return {
        id: candidate.id,
        summary: candidate.summary,
        creativeUse: candidate.creativeUse,
        expected: candidate.expected,
        observed: "REFUSED",
        errorCode: policyError.code,
        message: policyError.message,
        agrees:
          candidate.expected === "REFUSED" &&
          (candidate.expectedCode === undefined ||
            candidate.expectedCode === policyError.code),
      };
    }
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

const results: ProbeResult[] = [];
for (const candidate of candidates) results.push(await probe(candidate));

const disagreements = results.filter(({ agrees }) => !agrees);
const permitted = results.filter(({ observed }) => observed === "PERMITTED");
const refused = results.filter(({ observed }) => observed === "REFUSED");

const envelope = {
  schemaVersion: 1,
  generatedBy: "scripts/creative/envelope-probe.ts",
  policySource:
    "apps/managed-web/src/generation/client-experience-source-policy.ts",
  candidateCount: results.length,
  permittedCount: permitted.length,
  refusedCount: refused.length,
  /** Non-zero means the recorded expectation no longer matches the live policy. */
  disagreementCount: disagreements.length,
  techniques: results.map(
    ({ id, summary, creativeUse, observed, errorCode }) => ({
      id,
      summary,
      creativeUse,
      status: observed,
      errorCode,
    }),
  ),
};

const outputPath = resolve(
  repositoryRoot,
  "docs/creative/signature-capability-envelope.json",
);
await writeFile(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, "utf8");

/*
 * The Markdown is generated from the same run as the JSON so the document a
 * human reads and the matrix the validator enforces cannot disagree. Do not
 * hand-edit it; change a candidate and re-run.
 */
function table(rows: readonly ProbeResult[], withCode: boolean): string {
  const header = withCode
    ? "| Technique | What it buys creatively | Refusal |\n|---|---|---|"
    : "| Technique | What it buys creatively |\n|---|---|";
  const body = rows
    .map(({ id, summary, creativeUse, errorCode }) =>
      withCode
        ? `| **${id}** — ${summary} | ${creativeUse} | \`${errorCode}\` |`
        : `| **${id}** — ${summary} | ${creativeUse} |`,
    )
    .join("\n");
  return `${header}\n${body}`;
}

const markdown = `# Signature Capability Envelope

**Generated — do not edit by hand.** Produced by \`scripts/creative/envelope-probe.ts\`
(\`pnpm creative:envelope\`) by running each technique through the real
\`${envelope.policySource}\`.

What a client-local Signature may do is decided by that policy at build time, and
it fails closed. This envelope is the measured answer, not a description of it, so
a Signature Slice cannot promise a technique production would refuse. A Slice
declares its techniques in front-matter and \`pnpm creative:validate\` checks them
against the table below.

${envelope.candidateCount} techniques probed: **${envelope.permittedCount} permitted**, **${envelope.refusedCount} refused**.

## Permitted

These are available to a client-local Signature today, with no Core change and no
global runtime cost to clients that do not use them.

${table(permitted, false)}

## Refused

These are refused by the source policy. A prototype may rely on any of them; a
production Signature may not. Where a refusal blocks a creative idea, the answer
is a different technique or a Platform primitive — never weakening the policy.

${table(refused, true)}

## What this means for ambitious Signature work

Canvas, WebGL and video are open, which is most of what a cinematic or spatial
direction needs. The binding constraint is not the drawing surface — it is that
**a Signature cannot fetch anything at runtime**. \`fetch\`, \`new Image()\`,
\`new Audio()\` and \`Worker\` are all refused, and CSS may not reference a raster
file. So shaders must be inline strings, geometry must be authored in source,
textures must be drawn rather than loaded, and all validated client imagery must
arrive through the Platform \`Image\` primitive.

That is a real ceiling on one class of idea, and it should be known before a
territory is chosen rather than discovered during production translation.

The other constraint worth stating: an inline SVG data URI in CSS is permitted
only with **every quote percent-encoded**, because the permitted tail excludes
\`"\`, \`'\` and \`)\`. The two forms look identical in a browser, which is exactly
why the difference is probed rather than remembered.
`;

await writeFile(
  resolve(repositoryRoot, "docs/creative/signature-capability-envelope.md"),
  markdown,
  "utf8",
);

for (const result of results) {
  const mark = result.agrees ? "ok  " : "DIFF";
  const detail = result.errorCode === null ? "" : ` (${result.errorCode})`;
  process.stdout.write(
    `${mark} ${result.observed.padEnd(9)} ${result.id}${detail}\n`,
  );
}
process.stdout.write(
  `\n${permitted.length} permitted, ${refused.length} refused, ${disagreements.length} disagreeing with the recorded expectation.\n`,
);
process.stdout.write(`envelope written to ${outputPath}\n`);

if (disagreements.length > 0) {
  process.stdout.write(
    `\nThe live source policy no longer matches what this probe expected.\nUpdate the candidate expectations and docs/creative/signature-capability-envelope.md,\nthen re-run. Do not weaken the policy to make the probe pass.\n`,
  );
  process.exitCode = 1;
}
