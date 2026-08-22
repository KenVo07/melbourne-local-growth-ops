# The parity-slice gate

**For a materially redesigned premium client, do not production-implement every
route before proving that Design → Production translation works.**

## Why this is a rule and not advice

Stone & Line implemented its full route set from an approved direction, and the
result preserved too much of the P1 layout. The cost was not the translation
mistake — those are ordinary — it was that the mistake was discovered *after*
every route had been built on top of it, so recovery meant a parity recovery pass
across the whole site rather than a correction on one page.

The translation risk is highest on the first route and near zero by the fifth. So
pay it once, on purpose, on a slice small enough to throw away.

## The shape

```
approved direction
   → representative parity slice
       → real rendered side-by-side evidence
           → HUMAN PARITY GATE
               → scale the remaining route grammar
```

## What the slice covers

Four things, because they are the four that fail differently:

| Slice member | What it proves |
|---|---|
| **Home** | The opening composition — the highest-risk translation in any premium delivery |
| **One service detail** | A decision page: does the grammar survive contact with real prose? |
| **One project / case-study detail** | A record page: media, notation, and the detail-route grammar |
| **Mobile**, at 390 | Recomposition, not stacking. A layout that only stacks is a failure of the idea, not of the breakpoint |

One of each, not all of each. The point is to prove the *grammar* translates; the
remaining routes are then the same grammar applied to more content.

## Evidence the slice owes

Real rendered captures of the built slice beside the approved direction, at the
required widths, in full and reduced motion. **Rendered, not described.** The
failure mode this closes is a translation approved from prose about the design
rather than from the design.

## Who decides what

| Automation verifies | A human decides |
|---|---|
| Identity — this slice was built from this approved direction, against this source | Whether the composition is right |
| Evidence completeness — the four members, the required widths, reduced motion | Whether the type, colour and rhythm are right |
| Source boundary — the slice changed only this client's experience tree | Whether it is *good* |
| Objective constraints — contrast, overflow, console, accessibility, no dependency drift | Whether to scale it to the remaining routes |

**Automation does not score beauty.** There is no field in the objective report in
which a quality verdict could be recorded, and the contract refuses one if a future
edit tries to add it. That is deliberate and load-bearing: a machine that scores
taste becomes the thing people argue with instead of the design.

## Tooling, and what it deliberately reuses

The parity slice needs no new command. It is `creative:launch` with a slice-scoped
handoff, then `creative:verify` on the slice candidate, then the human gate — the
same three-step bridge, run once on a small scope before being run on the full one.

The gate itself is an ordinary named-human gate: the same rule that an agent cannot
sign its own work, for the same reason.

**There is deliberately no refusal code for a missing parity slice.** A command
cannot know whether a client is "materially redesigned" — that is a judgement — and
inventing a declaration for it would add a required field to every delivery to
enforce a rule that applies to some. So this gate is enforced the way the Creative
Gate is: a named human runs it, and the launch that follows carries their signed
decision. The tooling's contribution is that the slice launch and the full launch
are the same three commands, so running it costs nothing new.

## When the gate does not apply

- **P1 deliveries.** There is no redesign to translate.
- **A client whose direction is a refinement of what is already built** — the
  translation risk is what triggers the gate, not the tier.
- **A single-route change.** The slice would be the whole job.
