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
