# The interaction taxonomy

Four levels. The reason there are four rather than two is that the two middle
ones are the ones a Platform loses money on: a proven creative technique promoted
too early becomes a component nobody can change, and a client's authored
signature promoted at all becomes every client's default.

| Level | What belongs | Test it must pass | Where it lives |
|---|---|---|---|
| `SITE_GLOBAL` | Motion and behaviour every route wears | Would removing it change every page? | Platform capability, once proven twice |
| `ROUTE_FAMILY` | One mechanic, any number of items | Does adding an item require new geometry? Must be **no** | Platform capability or catalogued pattern |
| `CREATIVE_PATTERN` | A proven technique, deliberately reusable, not universal | Has it worked once, with evidence, and would a second client plausibly want it? | Pattern catalogue — reference, not runtime |
| `OPTIONAL_SIGNATURE` | One bespoke instrument for one client | Is there real client material behind it, and does the site work without it? | Client-local, permanently |

## The two the Factory must never merge

`CREATIVE_PATTERN` and `OPTIONAL_SIGNATURE` are both "things one client did that
looked good", and collapsing either into Core is how a Platform acquires a
component landfill.

A **creative pattern** is a technique with a general shape. A spatial morph
between a hero and a following section is a pattern: nothing about it knows what
the photograph is, and a second client could reasonably ask for it. It is
catalogued so the next delivery can find it and copy it deliberately, and it is
not in Core, because Core code has to survive every client at once.

An **optional signature** is authored for one client's material. A cross-section
cut through a garden's construction strata exists because that client had real
architectural drawings. Promoting it produces a Factory that wants to draw
cross-sections through everything, including businesses that have no sections.

The distinction is not quality. Both can be excellent. It is whether the thing
would still make sense if the client's material were different.

## What this means at delivery time

- A `SITE_GLOBAL` or `ROUTE_FAMILY` mechanic may be reached for by default.
- A `CREATIVE_PATTERN` may be reached for **by name, with a reason**, and the
  reason belongs in the creative intent.
- An `OPTIONAL_SIGNATURE` is designed for the client in front of you or not at
  all. Reusing another client's signature is the failure mode this level exists
  to name.

Promotion between levels is governed by the [promotion ladder](promotion-ladder.md).
Nothing moves because it worked once.
