# The authority model

What each input to a premium delivery is authoritative *for*, and why conflating
them cost a redesign.

## The defect this exists to prevent

Stone & Line's first premium implementation preserved too much of its P1 layout,
and the reason was not laziness. It was written into the brief.

At the Creative Gate, approved design visuals were authoritative — a named human
looked at a composition and said yes. At production launch, the same visuals were
described to the implementing agent like this:

> Treat any provider export — code, screenshot, canvas, video — as evidence of a
> conversation. It is never authoritative.

That sentence is correct about prototype code and wrong about the approved
composition, and it did not distinguish them. The evidence index recorded a single
`authority: "NON_AUTHORITATIVE"` for the whole export. The launch pack carried no
copy of the artifact, and the read order did not mention it. An agent following
those instructions correctly built the words and kept the old layout.

Worse, and found by inspecting the record an operator actually wrote: the contract
**could not express an approved visual at all**. Items carried a single `content`
value from `CODE | VISUAL | MOTION | COMMENTARY`, so a real canvas carrying three
modalities was written as `"VISUAL_MOTION_COMMENTARY"` — not a legal value. Items
also required `carriesNoNewBusinessFact: true`, which an honest operator sets false
for any canvas showing draft copy. And there was no `path`, so nothing could
travel. That record could never have validated. The approved visuals were
structurally unable to reach production.

## The five classes

Tool-neutral by construction. A Figma export, a PNG set, a video, a design-tool
canvas and a hand-drawn scan all classify the same way, and nothing in the
contract names a vendor.

| Class | What holds it | Never |
|---|---|---|
| `BUSINESS_TRUTH_AUTHORITY` | `client-website.json` | Any export, ever. A canvas showing draft copy is not a source of facts. |
| `VISUAL_AUTHORITY` | An approved artifact carrying `VISUAL` | Prototype code. Relabelling code does not promote it. |
| `MOTION_AUTHORITY` | An approved artifact carrying `MOTION` | A still image. |
| `PRODUCTION_SOURCE_AUTHORITY` | The client's live `experience/` tree | A workspace baseline, which is read-only. |
| `NON_AUTHORITATIVE_PROTOTYPE_CODE` | Any prototype implementation | — |

Enforced in `scripts/creative/premium-contracts.mjs`:

- `content` is a **list** of modalities, so one artifact can carry several;
- `authority` is required, and cross-checked against the modalities present —
  `CODE` can claim nothing;
- `BUSINESS_TRUTH_AUTHORITY` and `PRODUCTION_SOURCE_AUTHORITY` are **unreachable**
  from a provider item and refused by name;
- `businessTruth: "NOT_AUTHORITATIVE"` is required on every item. This replaces
  the unmeetable boolean: it does not ask whether the artifact *displays* a fact,
  it states that production does not take facts from it, whatever is drawn on it;
- `path` and `sha256` are **required** when an item claims visual or motion
  authority, because an authority the agent cannot open is not an authority.

## What launch now does with it

1. **Resolves** each approved artifact to real bytes, refusing
   `VISUAL_AUTHORITY_UNREADABLE` if the file is missing or its digest differs from
   the recorded one.
2. **Copies** it into the pack at `inputs/approved-visual/`, so a fresh agent — or
   a reviewer six months later — can open it without the operator's machine.
3. **Hashes** it into `integrity.sha256` with everything else.
4. **Lists** it in the read order, positioned with the gate that approved it and
   ahead of the mechanism.
5. **Binds** it in `production-launch.json` under
   `provider.approvedAuthorities`, by pack path and digest: the proof of which
   approved bytes production received.
6. **Instructs** the agent to render and inspect it, and to record in the
   Translation delta what it observed and how the result matches.

The brief now says: prototype code is evidence of a conversation; an approved
visual is the specification for how the site looks and moves. Where an approved
visual and the existing P1 composition disagree, the approved visual wins on
composition. `client-website.json` still wins on every fact. An irreconcilable
conflict is a stop condition.

## Claude Design is not required

Nothing above mentions a provider except as a free-text label. Mode B — the exact
source baseline plus public context — works with **no provider at all**, and in
that case the brief still states that an unchanged P1 composition is a translation
failure rather than a conservative choice. That sentence is the part that carries
the lesson when no visual exists.

A future design tool fits this contract by producing files with digests and an
operator classifying them. That is the whole integration surface.

## Interaction evidence

The same principle applied to QA: evidence is only evidence of what its method
could actually observe.

A pointer-sensitive control — one that captures the pointer, drags, swipes, hovers
or scrubs — **cannot** be evidenced by `element.click()`. A synthetic click
dispatches an event directly and never exercises hit-testing or pointer capture,
so it cannot show the control is reachable by a pointer. A collection plate that
held capture from `pointerdown` was unclickable and shipped through a full evidence
pass for exactly this reason.

`INTERACTION_INPUTS`: `REAL_POINTER`, `REAL_KEYBOARD`, `REAL_TOUCH`,
`SYNTHETIC_CLICK`. A synthetic click remains legitimate evidence for a control
with no pointer behaviour. The contract refuses the combination
`pointerSensitive: true` with `SYNTHETIC_CLICK`, naming the control — because the
operator's next action is to re-drive that control, not to go looking for a
framework.

`creative:verify` reports `evidence.interaction` and `evidence.pointer-input`.
Absent interaction evidence is a reported FAIL rather than a refusal: the delivery
is inside its boundary and a reviewer needs to see which control is unproven.

**This deliberately does not add a browser-testing framework.** The Platform owns
no browser automation and this pass did not give it one. The requirement is on the
evidence a delivery submits, which is where it belongs.
