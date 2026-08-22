# The promotion ladder

How a mechanic earns its way toward the Platform, and why nothing skips a rung.

```
CLIENT_LOCAL  →  CATALOGUED_PATTERN  →  REPEATED_DELIVERY_PATTERN  →  PLATFORM_CAPABILITY
```

| Rung | What it means | What it takes to leave |
|---|---|---|
| `CLIENT_LOCAL` | Authored for one client, in their `experience/` tree | Someone writes a catalogue entry: purpose, contract, accessibility, reduced-motion behaviour |
| `CATALOGUED_PATTERN` | Documented so the next delivery can find and copy it | A **second** client needs it, and the second implementation is compared to the first |
| `REPEATED_DELIVERY_PATTERN` | Two or more clients have it; the differences are known | The shape stopped changing across those clients, and the difference between them is configuration rather than rewriting |
| `PLATFORM_CAPABILITY` | Core code, one implementation, every client | — |

## The rule that matters

**Being impressive once is not evidence.** Being needed twice is the beginning of
evidence. Being needed twice *without changing shape* is the evidence.

Stone & Line makes the case for itself: the Reel was the most successful mechanic
in the delivery, and the closure pass changed it twice — pointer capture, then
resting composition. Had it been promoted at the end of the production pass, the
Platform would now own a primitive with a known interaction defect, under a
client who had already shipped.

## Copying is allowed, and is cheaper than it looks

A catalogued pattern is copied into client #2's tree, not imported. That produces
duplication, which is the correct trade at this stage:

- the second copy is where you find out what was client-specific in the first;
- diverging is free, whereas diverging from a Core primitive means either a
  configuration flag or a fork;
- promotion after two copies is an informed refactor, not a guess.

The cost of premature promotion is not the code. It is that the third client's
requirement arrives as a flag on a shared component, then a fourth, and the
component becomes a configuration surface nobody can reason about — the landfill
this ladder exists to prevent.

## What the catalogue is not

Not a component library, not a runtime, and not a visual page builder. It is a
reference: what a mechanic is for, when not to use it, what data it needs, what
it owes accessibility and reduced motion, and where an implementation can be read.

See the [pattern catalogue](pattern-catalogue.md).
