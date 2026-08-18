# The Creative Gate

The human decision point between an explored direction and a built website.

## Why it exists and who owns it

Everything else in this system can be checked by a machine. This cannot. Whether a
direction is *good* — original, coherent, right for the business, worth building —
is founder judgement, and the acceptance model reserves it explicitly:

> The agent/model cannot self-pass subjective founder craft.

`pnpm creative:validate` enforces this structurally. A `creative-gate.md` whose
`decided_by` names an agent identity is refused. The system can prove a gate
happened; it never claims to have passed one.

## When the gate runs

**After the Signature Slice, before the rest of the site is built.**

Building the full site before the gate is the expensive failure: it turns a
creative decision into a sunk cost, and the honest answer to "should this
direction change" becomes unaffordable. The Slice exists precisely so the decision
can be made on real evidence while it is still cheap.

The full bespoke site must not be authored before the gate unless there is a
specific, recorded justification.

## What must be in front of the reviewer

A gate held on a description is not a gate. Required:

- the Signature Slice, interactive, at desktop **and** mobile;
- the reduced-motion state;
- the creative intent, including anti-targets;
- all three territories, including the two not selected, and why;
- the media plan with provenance classified;
- the fresh-eyes red team findings;
- the named candidate commit.

## The rubric

Score each dimension `PASS` / `BORDERLINE` / `FAIL`, with a note. A single `FAIL`
on business clarity, conversion, truth or accessibility feasibility should stop
the direction regardless of how strong the rest is.

| Dimension | The question |
|---|---|
| Business clarity | Is it obvious what this business does and who it is for? |
| Original creative thesis | Is there a real idea, or a competent style? |
| Visual coherence | Does it read as one authored thing across routes? |
| Typography | Is the type doing work, or decorating? |
| Composition and spatial craft | Is space dimensioned, or accidental? |
| Media direction | Is the imagery strong, and honest? |
| Interaction purpose | Does each interaction do something for the reader? |
| Motion craft | One temperament, or a collection of effects? |
| Responsive and mobile translation | Recomposed, or stacked? |
| Conversion continuity | Does the primary action survive the art direction? |
| Reduced-motion feasibility | Is the rest state designed? |
| Accessibility feasibility | Does keyboard and focus survive? |
| Performance feasibility | Can this ship inside budget? |
| AI-generic smell | Would this look generated to a stranger? |
| Template smell | Repeated section grammar? |
| Reference-copying risk | Traceable to a specific existing site? |
| Production maintainability | Can this be maintained in two years? |

## The three outcomes

**`PASS`** — build it. Rare at first review, and slightly suspicious when it
happens on a first look.

**`PASS_WITH_NAMED_FIXES`** — the direction is approved; specific things must
change. This is the normal healthy outcome. The fixes are **acceptance
conditions, not suggestions**, and each must be checkable. The validator refuses
this decision with no fixes named.

**`FAIL`** — the direction does not proceed. Say what would have to be true for a
different direction to work, so the next exploration is not a re-roll.

## The freeze rule

A pass freezes the thesis, the palette, the typographic roles, the composition
grammar and the Signature intent as the rules for scaling.

> Any change to those during scaling requires returning to this gate.

This is what stops a strong approved direction from drifting, route by route,
back into the generic thing it was approved for not being.

## What a pass does and does not authorise

A pass authorises **scaling the direction to the remaining routes**. It is not
final delivery acceptance. That still requires the complete capability gate,
production preview, responsive review, performance and runtime evidence, and
independent review.

## Recording it

Fill `creative-gate.md` — scaffolded by `pnpm creative:new`. Required front-matter:
`decision`, `decided_by` (a named human), `decided_on`, `candidate_commit`, and
`candidate` naming the Slice. Required prose: the decision in the reviewer's own
words, the named fixes, and exactly what evidence was reviewed.
