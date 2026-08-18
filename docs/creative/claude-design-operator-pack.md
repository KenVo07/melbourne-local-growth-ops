# Claude Design operator pack

Exact prompts for running a creative exploration in Claude Design, for an
operator who does not write source code.

- Verified against Anthropic primary sources and this Claude Code build on **2026-08-19**.
- Claude Design is in **beta** (Pro/Max/Team/Enterprise; default **off** for Enterprise).
- Nothing here is a production dependency. See §0.

## 0. Read this before using any prompt below

**The canvas is not the website.** Production authority is repository source,
Factory contracts, tests and the standalone artifact. A prototype may do things
production cannot; that is fine and expected, and it is exactly what the
`prototype_fakes` field in the Signature Slice and Production Handoff exists to
capture.

**The prompts are in two layers on purpose.** Everything in §2–§8 marked
*Intent* is tool-independent — it is what you would ask any capable designer or
design tool. Everything marked *Claude Design* is the thin vendor-specific
wrapper. If Proportion moves to a different environment, the *Intent* halves
survive unchanged and only the wrappers are rewritten. That is what keeps this
optional rather than load-bearing.

**Three rules apply to every prompt, and are repeated inside them deliberately.**

1. *Business truth over plausibility.* Everything the exploration knows about the
   client is in `CREATIVE_CONTEXT.md`. Anything not in it is a missing input to
   request, never a detail to invent.
2. *Qualities, not layouts.* References contribute rhythm, spatial idea,
   typographic behaviour, motion quality, media treatment, navigation behaviour or
   interaction principle. Never a page structure or a visual identity.
3. *Claims need evidence.* Nothing may assert or illustrate completed work, team,
   premises, results or certifications unless real client evidence exists and is
   classified `REAL_CLIENT_EVIDENCE`.

## 1. Environment and design-system sync

### One-time setup

If the terminal session has never authenticated, run `/design-login` once. It
authenticates the Claude Design MCP server (`https://api.anthropic.com/v1/design/mcp`).
This is a human step and cannot be automated.

> **Check whether you need it at all.** Ask Claude Code to list your design-system
> projects. If it answers without an authorization error, scopes are already
> granted and `/design-login` is unnecessary.

### Syncing the design system

**Sync from Claude Code. Do not upload this repository.** Anthropic's own guidance
is to link large repositories from Claude Code "to avoid lag or browser issues",
and this is a pnpm monorepo with three apps and nine packages.

```
/design-sync
```

Sync **the Platform's primitives and the client's own experience**, not the whole
tree. What is worth having on the canvas:

- the client-local `experience/` source for the client being explored;
- `experience/design-dna.json` — the frozen creative contract, if one exists;
- the Platform primitives a route may use: `Link`, `Image`, `Region`, `Action`,
  `Search`, `Disclosure`, `Main`, `SkipLink`.

What is **not** worth syncing, and should be excluded: the generation pipeline,
contracts package, tests, and any other client's experience. A canvas holding
another client's art direction is how one delivery's aesthetic leaks into the next.

### Prompt — orient the design session

> I am exploring a new creative direction for an existing website that already has
> a validated content model and route set. I am attaching `CREATIVE_CONTEXT.md`,
> which was generated from the client's validated definition — every fact in it is
> real and nothing in it is invented.
>
> Before proposing anything, read it and tell me back:
> 1. the route set this direction has to cover, by page kind;
> 2. what content actually exists, and what a strong direction would be missing;
> 3. what this client is **not** allowed to claim;
> 4. which techniques the capability envelope permits, and the one constraint that
>    most limits ambitious work here.
>
> Do not propose visual directions yet. If anything you would need is absent from
> the context, list it as a missing input rather than assuming it.

## 2. Territory exploration

*Intent.* Produce three materially different creative directions, each a coherent
argument about this business, not three palettes.

### Prompt — generate three territories

> Using only the attached `CREATIVE_CONTEXT.md`, propose **three materially
> different creative territories** for this website.
>
> Material difference means a different *thesis* — a different idea about what
> the site is doing and how a visitor should experience it. Three variations on
> one layout with different type and colour is **one** territory, not three, and I
> will reject it as such.
>
> For each territory give me:
> - a name and a one-sentence thesis;
> - why this thesis belongs to *this* business, tied to something specific in the
>   context — not to its industry in general;
> - typographic character and what it is doing for the argument;
> - spatial and composition logic;
> - media and art-direction logic, given the media that actually exists;
> - movement and interaction character, described as temperament rather than
>   timings;
> - one proposed Signature idea, and why *this* rather than a generic reveal;
> - how the idea recomposes on mobile — recomposes, not stacks;
> - how the primary conversion survives the art direction;
> - what it inherits unchanged from the existing platform and what it deliberately
>   rewrites;
> - the feasibility or performance risk you would worry about.
>
> Then, in one paragraph per pair, say why each territory is materially different
> from the other two.
>
> Constraints: no claim this client cannot evidence. No reference page structure
> or visual identity copied from any studio or brand. Do not invent business facts.

### Prompt — force divergence when they converge

Use this when the three come back too similar, which is the usual first result.

> These three share too much. Specifically they share [name what: the same
> hero-then-grid rhythm / the same centred symmetry / the same reveal-on-scroll
> behaviour].
>
> Keep territory [N], which is the strongest because [reason]. Replace the other
> two with directions that disagree with it structurally — not decoratively. One
> of them should be the direction a thoughtful designer would argue *against*
> territory [N], and it should be genuinely defensible rather than a straw man.
>
> If a genuinely different third direction would be wrong for this business, say
> so and tell me why, rather than inventing a weak one to fill the slot.

## 3. Territory critique

*Intent.* Attack the directions before falling in love with one.

### Prompt — critique before selection

> Critique all three territories as a sceptical design director who has seen a lot
> of competent, forgettable websites. For each one, answer plainly:
>
> - Where does it read as "AI website" or generic premium minimalism?
> - Where is the layout safe, symmetric or repetitive across sections?
> - Is the visual concept actually connected to the business truth, or is it
>   decoration that would suit any client in this trade?
> - Does the motion have narrative purpose, or is it arrival decoration?
> - Which parts would collapse into a plain stack on mobile?
> - Where does it depend on media this client does not have?
> - What in it resembles a specific existing website closely enough to be a
>   copying risk?
> - What would be genuinely hard to maintain?
>
> Rank them for *this business's commercial job*, not for visual impressiveness,
> and say what would have to change for your lowest-ranked one to win.

## 4. Signature Slice

*Intent.* Prove one direction on the four moments that decide a website, before
anyone builds the rest.

### Prompt — build the slice

> Build a **Signature Slice** of territory [name] as an interactive prototype.
>
> The slice must include all four of these and nothing else:
> 1. navigation;
> 2. the opening / hero;
> 3. one substantial proof or content sequence — a real project or service
>    record, with its actual story blocks, not a placeholder card grid;
> 4. the conversion block.
>
> Use the real content from `CREATIVE_CONTEXT.md`. Real headings, real service
> names, real project narrative. If you need a piece of copy that does not exist,
> mark it clearly as `[MISSING INPUT: …]` rather than writing plausible filler.
>
> Build it at desktop **and** mobile. Real motion and real interaction, not static
> mockups of them.
>
> Constraints that decide whether this can ship:
> - Every technique must be one the capability envelope marks PERMITTED. The
>   envelope is attached. In particular **nothing may fetch at runtime** — no
>   `fetch`, no `new Image()`, no web workers, no remote fonts, no CSS `url()`
>   pointing at a raster file. Shaders and geometry must be inline or authored.
> - Reduced motion must be a designed state, not a disabled one: the same document
>   at rest, with meaning and structure intact.
> - Keyboard operation and focus visibility must survive the art direction.
>
> When you are done, list separately: every place the prototype fakes,
> approximates or hardcodes something that production would have to do properly.

### Prompt — hold the line on the proof sequence

> The proof sequence is the part that has to feel substantial, and right now it
> reads as [cards / a list / a gallery].
>
> Rebuild just that sequence so the composition is doing the storytelling — the
> reader should understand the shape of the work by scanning it. Use the actual
> story blocks and facts from the context. Different beats may compose
> differently where the content justifies it; identical repeated blocks are the
> failure mode here.

## 5. Responsive and mobile refinement

*Intent.* Mobile should be the same idea recomposed, not the desktop idea stacked.

### Prompt

> Review the slice at 390px and 320px width.
>
> For each part, tell me whether the mobile version is *the same idea recomposed*
> or *the desktop idea stacked vertically*. Be honest — stacking is the default
> outcome and it is what makes a strong desktop direction feel generic on a phone.
>
> Then rework anything that merely stacks, so the creative thesis is still legible
> small. If the Signature cannot work on mobile in its desktop form, design its
> mobile counterpart deliberately — a different expression of the same idea — and
> tell me what you changed and why.
>
> Check specifically: no horizontal overflow; tap targets usable; the conversion
> still reachable without a long scroll; type still on a comfortable measure; any
> art-directed crop still meaningful at a narrow aspect.

## 6. Motion and interaction refinement

*Intent.* Motion earns its place by explaining something.

### Prompt

> Review every moving thing in the slice and answer, for each: **what does this
> movement tell the reader?**
>
> Delete anything whose honest answer is "it makes it feel premium". Motion that
> decorates arrival is the most common way a considered site starts to feel
> generic.
>
> Then tune what survives so it reads as one temperament rather than a collection
> of effects — consistent pace, consistent attack, consistent willingness to
> travel. Nothing should overshoot on exit. Everything should be interruptible.
>
> Finally, show me the reduced-motion state as a designed composition. It should
> look intentional at rest — not like the site failed to load.

## 7. Production handoff

*Intent.* Hand over intent and constraint, so the build reconstructs the idea
rather than tracing a picture.

### Prompt — assemble the handoff

> We are taking this slice into production in a code repository. The production
> agent will **not** see this canvas, and must not treat any screenshot as the
> specification.
>
> Write me a production handoff covering exactly these, in prose a build agent can
> act on:
>
> - the creative intent and the anti-targets it must not drift into;
> - the Signature thesis — what it *means*, so it can be rebuilt rather than
>   traced;
> - behaviour and movement intent, as relationships and character;
> - responsive intent — how the idea recomposes, not a breakpoint table;
> - which media is used, and what each asset is and is not allowed to
>   substantiate;
> - the production constraints this build must respect;
> - which existing platform capabilities must be reused rather than rebuilt;
> - what is expected to be genuinely bespoke client-local work;
> - performance, accessibility and reduced-motion expectations;
> - **everything the prototype fakes, approximates or hardcodes**;
> - what evidence must exist before this is called done.
>
> Be specific about the Signature. "A scroll-linked reveal" is not enough; say what
> is connected to what, in what order, and what the reader should understand from it.

### Claude Design → Claude Code

Use **Send to local coding agent** (or *Send to Claude Code Web*). Anthropic's
guidance is that the receiving agent "continues from your existing work instead of
starting over from a screenshot" — the handoff document above is what makes that
true in practice rather than in principle.

Then, in the repository, follow
[the production translation runbook](production-translation-runbook.md).

## 8. Fresh-eyes red team

*Intent.* One reviewer who has not been living inside the direction.

Run this in a **new session with no exploration history**, attaching only the
built slice and `CREATIVE_CONTEXT.md`. A session that helped make the work cannot
give fresh eyes on it.

### Prompt

> You have not seen this project before. Review this website slice as a sceptical
> design director. Do not be encouraging; I need the problems.
>
> Look specifically for:
> - "AI website" smell and generic premium minimalism;
> - safe symmetric layouts and repetitive section grammar;
> - the same motion preset reused everywhere;
> - a visual concept disconnected from what the business actually does;
> - poor optical alignment and inconsistent typographic rhythm;
> - the desktop idea collapsing on mobile;
> - interaction without purpose, and excessive motion;
> - weak media, or media doing work it cannot substantiate;
> - anything whose DNA is visibly copied from a known reference;
> - accessibility or performance debt hidden behind spectacle.
>
> Then answer one question directly: **if you saw this website with no context,
> would you believe a real design studio made it deliberately for this business —
> or would you assume it came from a template or a generator?** Say why.

## 9. What the operator does next

The canvas has produced a direction. The repository produces the website.

1. Fill the creative artifacts (`pnpm creative:new <client> <dir>` scaffolds them).
2. Run `pnpm creative:validate <dir>` until it passes.
3. Take the Signature Slice to the founder for the [Creative Gate](creative-gate.md).
   **An agent cannot pass this gate, and the validator refuses one that tries.**
4. On a pass, follow the [production translation runbook](production-translation-runbook.md).
