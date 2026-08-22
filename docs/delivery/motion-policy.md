# Motion delivery policy

What P1, P2 and P3 mean about movement, and the two beliefs this replaces.

## The two things this policy exists to deny

**"More animation is a higher tier."** It is not. A tier is a claim about how much
*bespoke design and human review* a delivery receives, not about how many things
move. A P3 site whose motion is choreographed and a P3 site that is almost still
can both be correct; a site that moves constantly because it was expensive is
neither.

**"Zero JavaScript is a creative KPI."** It is not, and treating it as one cost a
delivery its cross-engine correctness. Stone & Line's continuity was first built
on CSS scroll timelines — elegant, zero-script, and unsupported in two of the three
engines the site is measured in. The rewrite to a small shared controller is not a
regression from an ideal; the continuity was the goal, and the timeline was one
mechanism for it.

## The tiers

### P1 — Professional

A polished **motion floor**, generated, no bespoke motion work.

- Entrances, navigation transitions, media affordances, disclosure movement.
- No scroll listener and no animation-frame loop. This is a deliberate cost budget
  in the P1 interaction runtime, not an omission.
- Every helper degrades to native browser behaviour, and a reader without
  JavaScript sees a complete page.
- **A P1 delivery must stay fast and simple.** Nothing in this consolidation adds a
  step, a file or a runtime cost to P1.

### P2 — Signature

Strong visual parity, plus **either** one meaningful client-specific signature
**or** richer route-family motion. Not both by default.

- Moderate authored motion work.
- A parity slice applies if the client is materially redesigned.
- A small client-side controller is permitted here.

### P3 — Flagship digital experience

Motion may become narrative: site-global continuity, route-family continuity, and
optionally a bespoke signature instrument.

- Higher human review and QA budget — this is the real difference between the tiers.
- Scrubbed transitions are permitted, and every one of them is a state contract
  (see the [polarity gate](pattern-catalogue.md#scrubbed-state-polarity-gate)).
- A signature is designed for this client's material or omitted.

## Client-side JavaScript: the actual rule

A small client-side controller is permitted when it materially improves quality
and remains all four of:

| | |
|---|---|
| **Performant** | One shared listener, coalesced to at most one frame's work per frame in which something moved. Nothing running at rest. |
| **Accessible** | It moves no focus unexpectedly, changes no semantics, and every string it animates is real text in the document. |
| **Progressive** | The page is complete and legible before it runs, and correct if it never runs. |
| **Reduced-motion safe** | The reduced state is a *designed* state, not a disabled one. Nothing becomes unreachable, and no information is only available through movement. |

Prefer native platform capability where it genuinely works. "Genuinely" means in
every engine the delivery is measured in — a capability that works in one engine is
a prototype, not a mechanism.

## What automation checks, and what it does not

`creative:verify` checks that the reduced-motion state was captured, that no
console error or unexpected network request appeared, that nothing overflows, and
that unrelated clients did not inherit a signature's runtime cost.

It does not check whether the motion is good. A named human decides that, at the
parity gate and again at the ship gate.
