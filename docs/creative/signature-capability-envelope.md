# Signature Capability Envelope

**Generated — do not edit by hand.** Produced by `scripts/creative/envelope-probe.ts`
(`pnpm creative:envelope`) by running each technique through the real
`apps/managed-web/src/generation/client-experience-source-policy.ts`.

What a client-local Signature may do is decided by that policy at build time, and
it fails closed. This envelope is the measured answer, not a description of it, so
a Signature Slice cannot promise a technique production would refuse. A Slice
declares its techniques in front-matter and `pnpm creative:validate` checks them
against the table below.

32 techniques probed: **15 permitted**, **17 refused**.

## Permitted

These are available to a client-local Signature today, with no Core change and no
global runtime cost to clients that do not use them.

| Technique | What it buys creatively |
|---|---|
| **css-transition-keyframes** — CSS transitions and @keyframes in a client-local stylesheet | State change, hover character, entrance choreography |
| **css-scroll-driven-animation** — Native CSS scroll-driven animation (animation-timeline / scroll()) | Scroll-linked drawing, progress spines, parallax without JS |
| **waapi-element-animate** — Web Animations API via element.animate() | Interruptible, sequenced motion driven by real state |
| **request-animation-frame** — requestAnimationFrame loop | Continuous custom motion, physics, cursor-following behaviour |
| **intersection-observer** — IntersectionObserver | Entrance reveals, stepwise scroll narrative, lazy behaviour |
| **resize-observer** — ResizeObserver | Composition that responds to its own measured box |
| **match-media-reduced-motion** — matchMedia for prefers-reduced-motion | Designed reduced-motion state, required by every Signature |
| **view-transitions** — document.startViewTransition() | Route and state continuity |
| **canvas-2d** — <canvas> with a 2D context | Generative ornament, drawn diagrams, particle fields |
| **webgl-inline-shaders** — WebGL context with shader sources as inline string literals | Shader-driven media treatment, 3D, displacement |
| **inline-svg-geometry** — Inline SVG geometry authored in JSX | Drawn line work, stroke-dash narrative, masks |
| **video-element-local-source** — <video> element with a client-owned relative source path | Motion media, ambient background footage |
| **css-local-font-face** — @font-face referencing a self-hosted /fonts/ file | Licensed typography without a third-party request |
| **css-inline-svg-data-uri** — Inline SVG data URI as a CSS mask, with every quote percent-encoded | Ornament, texture, masked reveals — no third-party request |
| **scoped-approved-dependency** — A scoped npm dependency declared in the manifest and governance-approved | A library that materially improves one client's Signature |

## Refused

These are refused by the source policy. A prototype may rely on any of them; a
production Signature may not. Where a refusal blocks a creative idea, the answer
is a different technique or a Platform primitive — never weakening the policy.

| Technique | What it buys creatively | Refusal |
|---|---|---|
| **css-svg-data-uri-literal-quotes** — Inline SVG data URI containing literal quote characters | Pasting an SVG mask straight out of a design tool | `CSS_RESOURCE_REFERENCE_FORBIDDEN` |
| **undeclared-dependency** — An npm dependency that governance has not approved | Reaching for a library mid-build | `IMPORT_FORBIDDEN` |
| **fetch-runtime-data** — fetch() at runtime | Loading shader files, model geometry, JSON, live data | `NETWORK_ACCESS_FORBIDDEN` |
| **image-constructor-texture** — new Image() to preload a texture or bitmap | Loading imagery into canvas or WebGL | `NETWORK_ACCESS_FORBIDDEN` |
| **web-worker** — new Worker() for off-main-thread work | Heavy generative or physics computation | `NETWORK_ACCESS_FORBIDDEN` |
| **local-storage-persistence** — localStorage / sessionStorage | Remembering a visitor's state between visits | `BROWSER_STATE_FORBIDDEN` |
| **audio-constructor** — new Audio() playback | Sound design on interaction | `NETWORK_ACCESS_FORBIDDEN` |
| **raw-anchor-tag** — A raw <a> element | Any bespoke link treatment | `UNSAFE_MARKUP_FORBIDDEN` |
| **raw-img-tag** — A raw <img> element | Any bespoke image treatment | `UNSAFE_MARKUP_FORBIDDEN` |
| **iframe-embed** — <iframe> embed | Third-party map, video or tool embed | `UNSAFE_MARKUP_FORBIDDEN` |
| **dangerously-set-inner-html** — dangerouslySetInnerHTML | Injecting authored markup or SVG strings | `UNSAFE_MARKUP_FORBIDDEN` |
| **css-remote-webfont** — @font-face pointing at a third-party font CDN | Using a hosted webfont service | `CSS_RESOURCE_REFERENCE_FORBIDDEN` |
| **css-raster-background** — CSS background-image referencing a local raster file | Photographic backgrounds set from the stylesheet | `CSS_RESOURCE_REFERENCE_FORBIDDEN` |
| **css-import** — CSS @import | Splitting stylesheets | `CSS_RESOURCE_REFERENCE_FORBIDDEN` |
| **next-framework-import** — Importing next/image or next/link | Reaching for framework primitives directly | `IMPORT_FORBIDDEN` |
| **javascript-url** — A javascript: URL | n/a — probed because it must stay refused | `UNSAFE_URL_FORBIDDEN` |
| **dynamic-code-execution** — eval / new Function() | n/a — probed because it must stay refused | `EXECUTION_PRIMITIVE_FORBIDDEN` |

## What this means for ambitious Signature work

Canvas, WebGL and video are open, which is most of what a cinematic or spatial
direction needs. The binding constraint is not the drawing surface — it is that
**a Signature cannot fetch anything at runtime**. `fetch`, `new Image()`,
`new Audio()` and `Worker` are all refused, and CSS may not reference a raster
file. So shaders must be inline strings, geometry must be authored in source,
textures must be drawn rather than loaded, and all validated client imagery must
arrive through the Platform `Image` primitive.

That is a real ceiling on one class of idea, and it should be known before a
territory is chosen rather than discovered during production translation.

The other constraint worth stating: an inline SVG data URI in CSS is permitted
only with **every quote percent-encoded**, because the permitted tail excludes
`"`, `'` and `)`. The two forms look identical in a browser, which is exactly
why the difference is probed rather than remembered.
