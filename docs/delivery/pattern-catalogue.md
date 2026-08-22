# Pattern catalogue

Mechanics proven once, recorded so the next delivery can copy them deliberately
instead of rediscovering them. **Reference, not runtime.** Nothing here is
imported; entries are read and copied into a client's own `experience/` tree.

Every entry states what it is for, when not to use it, what data it needs, what
it owes accessibility and reduced motion, and where a working implementation can
be read. `Evidence` is the number of clients that have shipped it — the number
that governs [promotion](promotion-ladder.md).

Implementation reference paths are in the Stone & Line client repository at
`stone-line-input/experience/`, commit `6afa603`.

---

## Scroll reader

**Tier** `SITE_GLOBAL` · **Evidence** 1 · **Reference** `components/scroll.ts` (103 lines)

One passive `scroll` listener and one `resize` listener for the whole site,
coalesced into at most one `requestAnimationFrame` per frame in which something
moved. Nothing runs while the page is still.

**Use when** two or more interactions on a route respond to scroll position.
**Do not use when** one element needs one effect that CSS can express — a
scroll-driven animation or `position: sticky` costs nothing and this costs a
listener. **Do not use in P1 at all:** P1's interaction runtime deliberately has
no scroll listener and no rAF loop, and that budget is a feature.

**Data** none. It publishes numbers, never pixels.

**The contract each subscriber keeps:** read layout in the tick, write custom
properties in the tick, never read layout after writing. Layout is read once per
frame for the whole site, and every write afterwards is a custom-property
assignment. Breaking this puts the site back on the layout-thrash path.

**Accessibility** nothing of its own; it moves no focus and changes no semantics.
**Reduced motion** `watchMotion()` reports the preference now and on every change,
so an enhancement attaches and detaches rather than sampling once at mount and
being wrong for the rest of the session.

**Why it is not promoted:** it is the strongest candidate in the set and there is
nowhere to put it. Promoting it means creating a premium runtime tier on one
client's evidence. Promote when client #2 needs it, and take `gate()` (below) with
it.

---

## Scrubbed-state polarity gate

**Tier** `SITE_GLOBAL` rule · **Evidence** 1 · **Reference** `components/HomeBridge.tsx` (`--pg`)

**The rule, which generalises even though the code is client-specific: a
scroll-scrubbed position is a state, and every reachable state carries the full
contrast contract.**

A transition between a dark-ground composition and a light-ground one cannot be a
cross-fade. Type and ground pass through each other and the midpoint contrast is
arithmetic — measured at 1.15:1 in a delivery that had already passed a contrast
audit, because the audit sampled endpoints and one midpoint.

**The mechanism:** a gate that is only ever 0 or 1, never between; a backing field
the copy carries with it; every property that decides legibility changing on the
same frame; hysteresis so a reader parked at the threshold does not flicker.

**Use when** any scrubbed transition crosses a polarity boundary.
**Do not use when** the transition stays on one ground — a plain ramp is correct
and cheaper.

**How to prove it:** sweep, do not sample. 35 positions per viewport, measuring
the worst pixel actually behind each string rather than the declared background.
700 samples closed this defect; 3 samples missed it.

---

## Collection scroller (Reel)

**Tier** `ROUTE_FAMILY` · **Evidence** 1 · **Reference** `components/Reel.tsx` (425 lines)

Horizontal collection run combining CSS scroll snap with pointer drag, step
buttons, keyboard focus following and ARIA live position announcements. Proven at
1, 3, 5, 8 and 12 records.

**Use when** a collection is browsed laterally and the count is small enough that
a reader can hold the set in mind — roughly up to 12.
**Do not use when** the count reaches the archive range. A reel at 60 records is a
very long run, not a design; see the [projects brief](design-briefs/high-cardinality-projects.md).

**Data** the records, and **the count**, declared in markup as a custom property.

**The count is not optional, and this is the general lesson.** A component cannot
count its own children in CSS. A fixed plate width is correct for a run that
overflows and wrong for a set that nearly fits: three plates overran a 1440
measure by a fifth of a plate, and a fifth of a plate at the edge reads as a
mistake rather than as a scroller. Resolve the width against the declared count.

**Accessibility** every plate is a real link, reachable by keyboard and openable
with Enter, with the scroll position announced politely.
**Reduced motion** snap and step behaviour remain; smooth scrolling does not.

### The pointer-capture rule, which cost a shipped defect

**Take pointer capture only after the pointer has travelled past the slop
threshold — 8px — never on `pointerdown`.**

While an element holds pointer capture, the click a press produces is dispatched
at the capturing element. A card that captures on `pointerdown` can be dragged,
tabbed to and opened with Enter, and **cannot be clicked**. Refuse native drag for
the whole press, and swallow the click only after real travel.

It shipped because the harness activated plates with `element.click()`, which
dispatches an event directly and never exercises hit-testing or capture. That
substitution is now refused by the evidence contract — see
[`INTERACTION_INPUTS`](../creative/authority-model.md#interaction-evidence).

---

## Selection stage (Lens)

**Tier** `ROUTE_FAMILY` · **Evidence** 1 · **Reference** `components/Lens.tsx` (141 lines)

A semantic radio group where selecting a row changes a persistent background
stage, driven by pure CSS `:has(> input:checked)`. No JavaScript, no layout shift.
Proven at 1, 3, 5 and 8 items.

**Use when** a small set of items each have one representative image and the
reader benefits from comparing them in place.
**Do not use when** the list stops fitting one stage — past roughly 8 items the
instrument itself is wrong, not just its size.

**Data** one image per item, and every item's description present in the document
regardless of selection.

**Accessibility** a real radio group; every description stays in the document tree
rather than being swapped in, so nothing depends on the visual selection.
**Reduced motion** the stage change is a cross-fade at most, and none is fine.

**The property worth copying:** the whole mechanic is a stylesheet. Zero client
JavaScript, and it degrades to a legible list of labelled items with no CSS at all.

---

## Shared-element morph

**Tier** `ROUTE_FAMILY` · **Evidence** 1 · **Reference** `components/Morph.tsx` (264 lines)

On a card link click, reads the card's bounding rect and runs a WAAPI geometry
transition into the destination hero.

**Use when** a collection item leads to a detail route whose hero is visibly the
same object.
**Do not use when** the destination hero is not the same object — a morph between
unrelated images is a distraction, not continuity.

**Data** a stable identity shared by the card and the destination hero.

**Known limitation, structural rather than unfinished: it does not run in
reverse.** Forward navigation has a click to hang a measurement on. Going back is
a history restoration with no interaction and no element to measure at the moment
the reader leaves. The honest fix is the framework's own view-transition support,
which is a one-line Platform configuration change, not a client one — the
alternative is hand-driving the router, which is a navigation framework however
small it is written.

**Accessibility** it is a real link; the transition is decoration over a
navigation that works without it.
**Reduced motion** degrades to ordinary navigation.

---

## Spatial morph bridge (HomeBridge)

**Tier** `CREATIVE_PATTERN` · **Evidence** 1 · **Reference** `components/HomeBridge.tsx` (384 lines)

A scrubbed transition where a hero composition recomposes into the following
section — media, headline, eyebrow, lede, action and notation all moving together
rather than one element animating over a static page.

**Use when** the client's opening genuinely has two states worth connecting, and
there is photography strong enough to hold a full-bleed hero.
**Do not use when** it would be the site's only idea, or when the media cannot
carry it. This is the clearest example of a `CREATIVE_PATTERN`: reusable in
principle, wrong as a default.

**Data** two composed states and the copy for each.

**Requires** the polarity gate above if the two states differ in ground polarity.
This is not optional — it is where the 1.15:1 contrast defect came from.

**Accessibility** every string in both states is real text in the document.
**Reduced motion** the two states must both be reachable without the scrub; the
reduced state is a designed state, not a disabled one.

---

## Cardinality proof method

**Tier** QA method · **Evidence** 1 · **Reference** client `qa/cardinality.mjs`

**Generate synthetic records into a scratch directory from a read of the real
definition, name every invented record `QA fixture`, and never write to the
client's own truth.** Prove the collection at 1, 3, 5, 8 and 12.

The method is what transfers, not the script. The Platform owns no browser
automation and adopting one is out of scope; what matters is that cardinality is
proved by generating counts rather than by reasoning about them, and that the
fixtures cannot contaminate real client truth.

**Why 1 matters most:** a collection mechanic that looks right at 5 and absurd at
1 is the common failure, and client #2 may have one project.

---

## Notation on media — open question, not yet a pattern

**Reference** client `qa/inset-audit.mjs`

Type set *inside* a photograph — a plate's title, a band's provenance, a
comparison's endpoint labels — is measured from the photograph, not from the
page's content line. An inset audit that does not know this reports dozens of
false positives; one that exempts too much hides real defects.

**Unresolved, and a design decision rather than a harness setting:** whether
"notation on media" should be a declared property the Platform knows, and what the
inset contract for a full-bleed photograph's own label actually is. Three values
are in use in one client: 24px on a band note, 32px on a tile, and the page line
on a caption.

Decide this before the next premium client authors media notation, or it will make
a fourth choice.
