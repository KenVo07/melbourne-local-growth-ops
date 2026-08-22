# Reuse disposition, after one premium client

Every materially reusable candidate Stone & Line produced, with the disposition
this consolidation gives it and the evidence behind it.

The bar: **promotion requires evidence that the shape has stopped moving.**
"It has generic props" is a description of an interface, not evidence of
reusability. Three of the four collection mechanics were changed by the closure
pass itself, which is an argument for waiting.

| Disposition | Meaning |
|---|---|
| `PROMOTE_NOW` | Into the Platform this pass. Proven general, stable, and it has a home. |
| `EXTRACT_LOW_LEVEL_ONLY` | The primitive underneath is general; the component is not. |
| `CATALOG_PATTERN` | Reference entry so client #2 copies deliberately. No runtime. |
| `KEEP_CLIENT_LOCAL` | Belongs to this client permanently. |
| `DEFER_PENDING_SECOND_CLIENT` | Right idea, one data point, no home yet. |
| `REMOVE_OR_REPAIR` | A defect or hazard, fixed here. |

---

## The matrix

| Candidate | Source | Tier | Disposition | Evidence |
|---|---|---|---|---|
| Smart Header | `SmartHeader.tsx`, 141 lines | `SITE_GLOBAL` | `CATALOG_PATTERN` | Clean, verified in 3 engines, zero client knowledge. But P1 has no header of this kind and no scroll listener at all, so promoting it means inventing a premium runtime tier on one client's evidence. |
| Scroll reader | `scroll.ts`, 103 lines | `SITE_GLOBAL` | `EXTRACT_LOW_LEVEL_ONLY`, deferred | The strongest candidate in the set: 6 subscribers, zero client identity, and its shape already survived a forced rewrite when CSS scroll timelines failed in 2 of 3 engines. **But** `interaction-runtime.ts` documents that P1 deliberately has *no* scroll listener and *no* rAF loop as a cost budget. There is no home for this that is not a new tier. Catalogued with its exact contract; promote when client #2 needs it. |
| Reel | `Reel.tsx`, 425 lines | `ROUTE_FAMILY` | `CATALOG_PATTERN` | Proven at 1/3/5/8/12 and knows nothing about projects. **Changed twice in the closure pass** — pointer capture and resting count. A shape that moved twice last week is not a Core primitive. |
| Lens | `Lens.tsx`, 141 lines | `ROUTE_FAMILY` | `CATALOG_PATTERN` | Clean, pure CSS `:has()`, proven 1/3/5/8. Untouched by the closure pass, so the most stable of the three. Still one client, and it stops being the right instrument past ~8 items (see the [services brief](design-briefs/large-service-architecture.md)). |
| Morph | `Morph.tsx`, 264 lines | `ROUTE_FAMILY` | `CATALOG_PATTERN` | Works forward, and **does not work backward** — a stated structural limitation, not a bug. Promoting a one-directional continuity primitive would ship that asymmetry to every client. |
| HomeBridge | `HomeBridge.tsx`, 384 lines | `CREATIVE_PATTERN` | `CATALOG_PATTERN` | This is the clearest `CREATIVE_PATTERN` in the set: a real technique, reusable in principle, and not something every site should have. |
| Living Cut | `LivingCut.tsx` + `Pieces.tsx` | `OPTIONAL_SIGNATURE` | `KEEP_CLIENT_LOCAL` | A structural reveal of garden construction strata. Meaningless without that material. |
| Hawthorn Cut A–A | `SectionSequence.tsx`, `SectionCut.tsx` | `OPTIONAL_SIGNATURE` | `KEEP_CLIENT_LOCAL` | Driven by one project's real architectural drawings. Was deliberately not multiplied to the other two projects *by its own author*, which is the correct instinct. |
| Pointer-drag helper | inside `Reel.tsx` | `ROUTE_FAMILY` | `CATALOG_PATTERN` + rule | The capture-past-slop rule is genuinely general and its absence caused a shipped defect. Captured as a **pattern with a stated rule** and as an evidence contract (below), rather than as a helper nobody has needed twice. |
| Scrubbed-state gate / polarity | `HomeBridge.tsx` `--pg` | `SITE_GLOBAL` rule | `CATALOG_PATTERN` + rule | The finding generalises even though the code does not: *a scroll-scrubbed position is a state, and every reachable state carries the full contrast contract.* Recorded as a rule with its measurement method. |
| Contrast sweep harness | client `qa/sweep-contrast.mjs` | QA | `DEFER_PENDING_SECOND_CLIENT` | It found a real defect 700 samples deep. But it is a Playwright script against one stylesheet's selectors, and the Platform owns no browser automation. Promoting it means adopting a browser-testing surface — explicitly out of scope. |
| Cardinality harness | client `qa/cardinality.mjs` | QA | `DEFER_PENDING_SECOND_CLIENT` | Same reasoning. Its *method* — generate synthetic records named `QA fixture` into a scratch directory, never touching real truth — is recorded as the rule to reuse. |
| Inset audit | client `qa/inset-audit.mjs` | QA | `CATALOG_PATTERN` + open question | Valuable, and it exposed an unresolved contract: notation drawn *on* a photograph is measured from the photograph, not the page, and three different inset values are in use. That is a design decision, not a harness setting. Recorded as an open question. |
| Media provenance | `ratioFor()`, `PROVENANCE` constant | Contract | `CATALOG_PATTERN` → [media intake](media-intake-contract.md) | `ratioFor()` reading real asset dimensions already generalises. The single `PROVENANCE` constant applied to all 14 photographs is only correct because they share one provenance — which is the contract gap the media intake pass now names. |
| Element reset vs measured classes | client `site.css` | Platform CSS | `DEFER_PENDING_SECOND_CLIENT` | Third occurrence of the same collision. The root fix — `:where()` or `@layer` — re-measures a 6,900 line stylesheet. Recorded with the specificity arithmetic so the next stylesheet is written correctly from the start. |
| `rebuild.sh` | client script | Tooling | `REMOVE_OR_REPAIR` — **done** | Deleted authored source behind a name that implied safety. Destroyed an uncommitted parity slice once. Replaced; Platform guard now has a regression test. |
| Checksum self-reference | packaging convention | Tooling | `REMOVE_OR_REPAIR` — **done** | Documented rule, never enforced. Now enforced in the one function every package goes through. |
| Synthetic-click QA | evidence method | QA contract | `REMOVE_OR_REPAIR` — **done** | Now a contract: a pointer-sensitive control cannot be evidenced by `element.click()`. |
| Design → code authority | launch pack | Process | `PROMOTE_NOW` — **done** | The one thing promoted into the Platform this pass, because it is process rather than aesthetics and its defect was structural. |

## What was promoted into the Platform, and why only this

One thing: **the authority model**. It qualifies where the components do not,
because it is not a component. It fixes a structural defect — the contract could
not express an approved visual, so approved visuals could not reach production —
and its correctness does not depend on how many clients have used it. A second
client would not teach us anything new about whether `client-website.json` is the
only business-truth authority.

Everything visual stayed out. After one client, the honest position is that we
know these mechanics work *for Stone & Line*, and three of them were still moving
last week.
