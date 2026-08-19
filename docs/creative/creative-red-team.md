# Creative red team

A fresh-eyes review protocol for finding the ways a competent website is
forgettable.

## How to run it

**In a session with no history of making the work.** A reviewer who helped build
the direction cannot give fresh eyes on it, and an agent that wrote the slice will
defend it. Open a new session, attach only the built artefact and
`CREATIVE_CONTEXT.md`, and ask for problems rather than an assessment.

Run it twice: once on the Signature Slice before the Creative Gate, and once
after every route exists. The second pass catches what the first cannot — repeated
grammar, drift between routes, and the flattening that happens when the remaining
pages are built for speed.

## What to look for

### Genericness
- **"AI website" smell** — the composite look of work assembled from what usually
  appears rather than decided for this business.
- **Generic premium minimalism** — lots of space, thin type, muted palette,
  nothing specific. Reads as expensive and says nothing.
- **Safe symmetric layouts** — everything centred, everything balanced, no tension.
- **Repetitive section grammar** — heading, then cards; heading, then cards. The
  single strongest signal of a template.

### Motion
- **One preset everywhere** — the same fade-up on every section, which converts a
  considered site into a generated one.
- **Motion without purpose** — if the honest answer to "what does this movement
  tell the reader" is "it feels premium", it should not exist.
- **Excessive motion** — competing movements, or movement that outlasts patience.
- **A reduced-motion state that looks broken** rather than designed.

### Connection to the business
- **Concept disconnected from truth** — would this direction suit any competitor
  equally well? Then it is decoration.
- **Conversion buried** by art direction.
- **Claims the client cannot evidence**, asserted or merely implied by imagery.

### Craft
- **Poor optical alignment** — mathematically aligned, visually wrong.
- **Inconsistent typographic rhythm** across routes.
- **Weak media** — or strong media cropped so it loses its meaning.
- **Dead space** that is accidental rather than dimensioned.

### Mobile
- **The desktop idea stacked** rather than recomposed. This is the default outcome
  and the most common quiet failure.
- Crops that stop meaning anything at a narrow aspect.
- A Signature that silently disappears rather than having a designed small form.

### Inherited aesthetic from outside this client
- **A design system that is not this client's.** A creative environment that
  already holds a design system will apply it, and the result will look
  intentional. Ask whose brand the type scale, spacing and colour actually
  belong to. If the honest answer is "the provider's" or "unknown", that is a
  finding, and `creative:launch` refuses it as `FOREIGN_DESIGN_SYSTEM`.
- **Another client's source, media or examples** reaching the working context.
  This is rarely deliberate: it happens because a previous delivery's files were
  nearby. A premium workspace carries one client's material and nothing else, and
  the delivery's artifacts must all name the same client.
- **A provider export treated as authority.** An export is evidence of a
  conversation. Code pasted from one carries its shortcuts, its runtime
  assumptions and sometimes its network calls, none of which were reviewed by
  anybody. Ask what the export *meant*, then build that.

### Provenance and debt
- **Copied reference DNA** — a layout, identity or choreography traceable to a
  known site.
- **Accessibility or performance debt hidden by spectacle** — the impressive thing
  is the thing that breaks keyboard operation or the loading budget.
- **Runtime smuggled in through an export** — a remote font, a remote stylesheet,
  a fetch, storage, or an embed. The source policy refuses these, but the red team
  should catch the intent before the policy catches the code, because by then the
  direction has already been approved.

## The two questions that decide it

Ask these directly and require a plain answer.

> **If you saw this website with no context, would you believe a real design studio
> made it deliberately for this business — or would you assume a template or a
> generator produced it?**

> **What is this site's single strongest idea, and would a visitor notice it?**

A direction that cannot produce a confident answer to the second question does not
have a thesis yet. It has a style.

## The standing question about this system

Because the same pack, prompts and worked examples are reused across deliveries,
they exert a gravity no validator can measure. So every red team asks:

> **Has this delivery inherited grammar, vocabulary or mechanics from a previous
> Proportion delivery because they were nearby rather than because they were right
> for this client?**

If the answer is yes, that is a finding, not a saving.

## Recording the outcome

Red team findings are not advisory. Material findings become named fixes in the
[Creative Gate](creative-gate.md), which makes them acceptance conditions.
