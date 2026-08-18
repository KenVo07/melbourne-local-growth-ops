# WEB-01C Completion Pass — state

Starting candidate: `4e2d379a70218f9868ea9a0cd237f0eeb3a8bb40`
Branch: `feature/web-01b-premium-experience` (main unchanged at `5eca7ac4`)

## Phase 0 — source lock

Verified branch, HEAD, clean worktree and main against the handoff. All twelve
findings were checked against source before any code changed.

**Drift:** `WEB01C_FOUNDER_REVIEW_PACKAGE.zip` and
`WEB01C_OPUS5_HIGH_IMPLEMENTATION_HANDOFF/working/FINAL_REPORT.md` are not
present anywhere under `/home/khoa/Projects`. Only the A3 baseline evidence
survives. The source lock itself is intact — the twelve candidate commits are
all present — so findings were verified against source rather than cross-checked
against the prior report.

## Phase 1–3 — interaction language, semantic opportunities, second context

One change, because findings 1, 2, 3, 9 and 10 shared a single root: the plan
reasoned in named instances and the two density floats were never read by any
emitter.

### What the source actually showed

- `InteractionPlan` carried `contactFaq` and `projectMedia` as named slots.
- `ResolvedInteraction.density` was **read by no emitter at all**. The only
  consumers of `interactionDensity`/`revealDensity` were `enabled` and
  `reveals`, both booleans. `0.01`, `0.15`, `0.50` and `0.99` were four spellings
  of `true`.
- `Arrive` sites were hard-coded, six of them, which is exactly why the reviewer
  measured six wrappers at both 0.50 and 0.15.
- `interactionVariables()` was emitted unconditionally into `root()`, so
  disclosure and overlay transitions ran even when `enabled === false`, while
  the manifest reported `motion: "NONE"`.
- `.detail-body` declared a transition but no closed/opening opacity, so its
  default was `1`: opening was pure height, and only *closing* faded.

### What replaced it

`semantic-opportunities.ts` reads the semantic model and answers one question
per opportunity — what shape is this, and how does a reader use it — without
knowing what an accordion is. `interaction-decisions.ts` then decides over those
opportunities.

Disclosure turns on an **access pattern**, not a section name:

| Access | Meaning | Folds |
|---|---|---|
| `LOOKUP` | reader wants the one item that applies to them | yes, if long and substantial enough |
| `SEQUENCE` | ordered, read through, order carries meaning | never |
| `BROWSE` | compared side by side | never |

FAQ and POLICIES are LOOKUP. PROCESS is SEQUENCE. SERVICES is BROWSE. Three
structurally identical runs — titled items carrying prose — and the generator
folds two and refuses the third, which is the proof it reasons about reading
rather than about type names.

The authorable language dropped both floats for choices that select real subsets:

- `entrance: NONE | KEY_MOMENTS | EVERY_SECTION` — compositions declare reveal
  opportunities with a role (`ARGUMENT`, `SUPPORTING`, `MEDIA`); each value takes
  a different subset. Measured on one fixture: 0 / 2 / 5 wrappers.
- `pointerFeedback: NONE | ESSENTIAL | GENEROUS` — selects `NAVIGATION` and
  `SURFACE` feedback. Focus rings are emitted identically at all three values.

The manifest now reads `plan.animates`, so a client that selects no entrance and
no pointer feedback but whose content folds still reports `motion: "NATIVE"`. A
genuinely still client emits no motion variables and no reduced-motion block.

### Second semantic disclosure context

POLICIES, rendered on the contact route beside the questions. A contractor's
warranty, deposit, cancellation and insurance terms are read exactly the way
questions are — a customer arrives holding the one that applies to them. It is
carried on a controlled fixture rather than added to STONE & LINE, whose content
was not changed.

Tests: 58 in the starter (was 51), 864 across the workspace (was 857).
Typecheck clean.

## Phase 4–6 — expression, focus lifecycle, closing continuity

### Finding 5 — the body entrance now exists

`.detail-body` declared `transition: opacity` and no closed or opening opacity,
so its computed value was `1` in every state but `closing`. Opening was pure
height and clipping; the only real fade was on the way out. The comment claiming
the body "fades on its own schedule alongside the height" described the close.

It is now an animation on the `opening` state, held at zero for the first third
so the space is visibly made before anything moves into it. It is deliberately
*not* a transition out of a closed-state opacity: `data-disclosure` is only ever
written by the helper, so giving the closed state an opacity would leave a reader
without JavaScript opening a native `<details>` onto invisible text. Removed
entirely under reduced motion — the open state is already carried by the height
and the mark.

### Finding 6 — photographs now move between each other

`step()` was `setActive` and nothing else. It now swaps the content immediately
and animates the *new* photograph in from the side the reader came from, using
the Web Animations API on one element — the same mechanism the disclosure
already uses. Swapping first matters: a reader holding an arrow key gets every
press honoured at once rather than queued behind a departure, and there is no
frame where the overlay shows neither photograph. The `<figure>` is not keyed on
the active index, so stepping never remounts the image.

Duration is 0.7x the overlay duration: opening is an arrival and earns the full
time, stepping is a continuation and should not make a reader wait to see where
they are.

### Finding 8 — Escape and Close now answer the same way

Focus return was on the Close button's `onClick`. Escape closes a modal dialog
without touching that button, so the native behaviour took over and returned
focus to whatever had it when `showModal()` ran — the trigger the reader opened,
not the one they ended on. Open the first photograph, step to the third, press
Escape, and focus landed on the first thumbnail.

Both exits now go through the dialog's own `close` event. The Close button asks
the dialog to close and does nothing else.

### Finding 7 — the menu closes as it opened

Verified asymmetric at source: `.menu[open] .menu-panel` carried an entrance
keyframe and there was no close expression at all, because no cross-browser CSS
interpolates a `<details>` to or from its intrinsic height.

Implemented as a client-local `Menu` helper that enhances the client's **own**
class names — the ones the Shell passed to `platform.Disclosure`. No Platform
change, no forked primitive, no second navigation in the accessibility tree, and
it gives up silently if the markup is not what it expects, leaving the native
open and close intact.

Bought by the same appetite that buys the *open*, so every authorable value is
symmetric: `pointerFeedback: NONE` snaps both ways, `ESSENTIAL` and `GENEROUS`
move both ways. The accidental middle is no longer reachable.

**Pinned to structured briefs only.** A legacy `motion: MICRO`/`ENTRANCE` brief
must regenerate the A3 site that was approved, and a new client chunk it never
shipped is exactly the drift that pin exists to prevent.

Tests: 62 in the starter, 868 across the workspace. Typecheck clean. The
generated source passes the Platform source policy unmodified, first pass, no
exemption.

## Phase 8 — browser evidence, and two defects it found

The evidence suite drives the built standalone artifacts and asserts on observed
behaviour — a height that changed between two frames, a focused element after a
key press — rather than on the source that produced it. It found two things the
unit tests could not.

**The menu enhancement was a no-op.** It animated the `<details>`, but this
composition sets the panel `position: absolute` so it can hang below the header
without pushing the page down — the element's own box never changes size when it
opens. The panel is what appears and disappears, so the panel is what is
animated now, with the `<details>` held open for the whole close and only closed
at the end. Opening also had to start from zero explicitly: a panel that was
closed has no height on the screen whatever it measures the instant it renders,
and opening it from its own full height is a movement of nothing.

**The reveal floor could land between absent and legible.** With `travel: 0.45`
the old formula gave a pending opacity of `0.045`. axe correctly called that a
contrast failure on twelve nodes: text rendered, in the accessibility tree, and
impossible to read. The A3 baseline had passed only because `travel: 0.5`
happened to resolve to exactly zero. The floor is now snapped to nothing below
legibility — a pending element is either not presented yet or present and
readable, and the band between them is not a state anybody could be shown.

### Results

| | Chromium | Firefox |
|---|---|---|
| interaction evidence | 65/65 | 65/65 |
| axe (13 states, WCAG 2.1 AA) | 0 violations | 0 violations |
| responsive 1440/834/390/320 | no overflow | no overflow |

WebKit could not run: it needs `libavif16`, a root-level system package.
Recorded as a limitation rather than expanding scope.

### Cost

Same-commit A3 baseline: 201,326 B gzip client JS, 14 chunks.
WEB-01C completion: 204,833 B gzip client JS, 14 chunks.
**Delta: +3,507 B = +3.42 KiB gzip** for progressive disclosure in two semantic
contexts, a media explorer that steps between photographs, a menu that closes as
it opened, and a two-grammar entrance.

Zero new dependencies (`next`, `react`, `react-dom`, `resend`, `zod` — identical
to baseline). Zero `requestAnimationFrame`, zero scroll or resize listeners,
zero timers, zero storage. One shared `IntersectionObserver` that disconnects
when its last element settles; one `window` listener, scoped to a disclosure
carrying an id and removed on unmount.

**The A3 baseline artifact ID is byte-identical to the one produced before this
pass** — `0f980095b09ef119ce5ed42e42a7e6dfd99632c9937c55efc2daa00bb3c6ca69`. A
legacy brief regenerates the site that was approved.
