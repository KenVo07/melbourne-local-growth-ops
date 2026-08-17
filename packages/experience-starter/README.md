# P1 Experience Starter

Private Factory machinery that emits a **concrete, client-local Client Experience
source tree** from a client build package and a creative brief.

```
Client Build Package  ──┐
                        ├──►  experience/  ──►  pnpm assemble:client  ──►  standalone client website
Starter Brief         ──┘
```

It writes the same fixed `experience/` shape a hand-authored Client Experience
uses, at the same source boundary, consumed by the same unchanged artifact
assembler.

## The one rule

**After generation the client site has no relationship with this package.**

Nothing emitted imports it. This package is not in the artifact's runtime file
list, not in its vendored packages, and not a dependency of `apps/managed-web`.
A generated client can be exported, installed, built, edited, substantially
rewritten and handed off with the Factory absent — the same as a hand-authored
one. `tests/integration/site-core/experience-starter-artifact.test.ts` asserts
all of that, and also that what the starter emits passes the Platform's own
client-experience source policy unmodified.

This is a **source-generation accelerator, not a shared runtime template.**

## Usage

```
pnpm --filter @melbourne-local-growth-ops/experience-starter generate:starter \
  --input  <build-package-directory> \
  --brief  <starter-brief.json>
```

`--input` is the directory that already holds `client-website.json` and
`public/`. Output goes to `<input>/experience`, which must not already exist —
the generator will not write over source somebody may have edited.

Then assemble as normal:

```
pnpm --filter @melbourne-local-growth-ops/managed-web assemble:client -- \
  --input <build-package-directory> --output <empty-directory> --factory-revision <sha>
```

## The brief

`src/brief.ts` is the contract. It is deliberately **not** a layout tree, a
component registry or an executable configuration — no `{"type": "split",
"children": […]}`, no visual-builder schema, no arbitrary component trees. It
records design *decisions*:

| group | examples |
|---|---|
| `typography` | display and text family character, weight, tracking, leading, modular ratio, measure, emphasis treatment, label case |
| `space` | unit, shell width, density, gutter, viewport inset |
| `colour` | ground, neutral-scale contrast |
| `media` | scale, caption placement, corner radius |
| `composition` | one named grammar per page kind |
| `motion` | `NONE` / `MICRO` / `ENTRANCE` |
| `copy`, `mediaPlan`, `serviceNarratives` | client content the validated definition has nowhere to carry |

Everything numeric is continuous, so variation is a design space rather than a
short list of themes. There is no customer-facing "Theme 1 / Theme 2".

## Composition grammars

Each page kind picks **one** of two coherent compositions, and only that one is
emitted — no dead source, no dead CSS, no runtime branch:

| page kind | grammars |
|---|---|
| home | `SPLIT_STATEMENT` · `IMAGE_LED` |
| services index | `ALTERNATING_ROWS` · `STAGGERED_COLUMNS` |
| service detail | `READING_COLUMN_RAIL` · `MEDIA_INTERRUPT` |
| projects index | `EDITORIAL_RECORDS` · `STAGGERED_INDEX` |
| project detail | `DOCUMENT` · `STAGGERED_BEATS` |
| about | `PROSE_PORTRAIT` · `METHOD_LED` |
| contact | `PANEL_SPLIT` · `STACKED_DIRECT` |

Adding a grammar means writing real source for it. The starter refuses to invent
a layout for a page kind nobody has designed: an unknown `experienceRouteId`
fails generation with a message saying so.

## What it refuses

Generation fails, loudly and before writing anything, on:

- a brief that places media the client definition does not declare;
- a brief that narrates a service the profile does not declare;
- a service detail route left without narrative or a photograph;
- a ground the configured brand surface cannot share a legible neutral scale
  with (a dark ground needs light ink; a light surface needs dark ink);
- a page kind the starter has no composition for;
- a legacy (schemaVersion 1) definition.

## What it proves rather than assumes

The neutral scale is **derived and then verified**: every derived ink is darkened
until it clears WCAG AA against *both* the ground and the validated brand
surface, and the achieved ratios are reported by the CLI. Gate A2 lost a QA cycle
to muted ink failing AA at caption sizes; that arithmetic is no longer something
a person has to remember.

Display sizes are bounded per role. A modular ratio compounds, and a ratio chosen
for a confident hierarchy will otherwise produce a headline the composition
cannot hold.
