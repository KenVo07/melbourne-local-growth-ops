# Tradies Workflow V1 — starting contract

What the next workflow inherits, what it must decide, and what it may not do. This
is the handoff boundary of the post-Stone consolidation: everything here is settled,
and the workflow starts from it rather than re-deciding it.

## Inherited and settled — do not redesign

| | Where |
|---|---|
| Four-level interaction taxonomy | [interaction-taxonomy.md](interaction-taxonomy.md) |
| Promotion ladder — nothing promotes on one client | [promotion-ladder.md](promotion-ladder.md) |
| Pattern catalogue — reference, copied not imported | [pattern-catalogue.md](pattern-catalogue.md) |
| Five authority classes, tool-neutral | [authority-model.md](../creative/authority-model.md) |
| Parity-slice gate for materially redesigned clients | [parity-slice-gate.md](parity-slice-gate.md) |
| P1/P2/P3 motion policy; zero-JS is not a KPI | [motion-policy.md](motion-policy.md) |
| Curated vs archive; showcase vs decision page | [collection-and-content-contract.md](collection-and-content-contract.md) |
| SERVICE_DETAIL nine-question decision contract | same |
| Seven-stage media intake; per-asset provenance | [media-intake-contract.md](media-intake-contract.md) |
| The happy path and its three human gates | [premium-happy-path.md](premium-happy-path.md) |
| Three-command bridge: prepare, launch, verify | [premium-workflow.md](../creative/premium-workflow.md) |

## Inherited constraints — the workflow must not break these

1. **`client-website.json` is the only business-truth authority.** Nothing the
   workflow produces may introduce a fact the client has not stated.
2. **P1 stays fast and simple.** No scroll listener, no rAF loop, no added step.
3. **No promotion into Core without two clients.** The catalogue is the holding area.
4. **Human gates stay human.** An agent cannot sign its own work.
5. **No machine verdict on quality.** The objective report has no field for one.
6. **Client-local signatures stay client-local.** Stone & Line's composition,
   palette, architectural notation, Cut A–A and landscape imagery are **not** Factory
   defaults and must not become the template.
7. **Outputs are never overwritten.** Publication is atomic or absent.
8. **A checksum manifest never lists itself.** Enforced.
9. **Generation never overwrites authored source.** Enforced, with a regression test.
10. **Pointer-sensitive controls need real pointer evidence.** Reported by verify.

## What V1 must decide, in order

These are open by design, and each is cheap to build and expensive to decide —
which is why they are decisions rather than code.

| # | Decision | Brief |
|---|---|---|
| 1 | The archive threshold, and whether it is client or Platform | [A](design-briefs/high-cardinality-projects.md) |
| 2 | Categories: declared vocabulary or derived from `serviceIds` + `locationLabel` | A |
| 3 | Filtered view: URL or client state — a routing decision | A |
| 4 | Do services group, and is a group a page | [B](design-briefs/large-service-architecture.md) |
| 5 | Minimum truth for a service to deserve a detail route | B |
| 6 | Second nav level: page graph or client experience | [C](design-briefs/visual-navigation.md) |
| 7 | Mega-nav behaviour under keyboard, touch and reduced motion | C |
| 8 | Media intake implementation: uploader, storage, audit surface | [media contract](media-intake-contract.md) |
| 9 | Who or what chooses a focal point | same |
| 10 | Whether reverse shared-element continuity is turned on at Platform level | [catalogue](pattern-catalogue.md#shared-element-morph) |
| 11 | Whether the authored surface's element reset moves to zero specificity | below |
| 12 | Whether "notation on media" becomes a declared property | [catalogue](pattern-catalogue.md#notation-on-media--open-question-not-yet-a-pattern) |

## Two carried-forward technical debts, with their arithmetic

**The element reset outranks measured classes.** `.sl ul, .sl ol, .sl dl { padding: 0 }`
is specificity (0,1,1); a measured layout primitive at one class is (0,1,0). So any
list-shaped element asking for the page inset loses silently and prints against the
viewport edge. This occurred **three times** in one client. Each was fixed by
restating the primitive at two classes. The root fix is `:where()` or
`@layer reset, primitives`, which re-measures a 6,900-line stylesheet — too large for
a closure pass, and cheap if the next stylesheet is written that way from the start.
**Write client #2's reset at zero specificity.**

**Reverse shared-element navigation.** Forward continuity has a click to measure
against; backward is a history restoration with no interaction target. The honest fix
is the framework's own view-transition support, which lives in a config the Platform
assembler writes on every build — a one-line Platform change, not a client one.

## First delivery boundary for V1

The first Tradies client is the **second** premium client. That makes it the
promotion evidence for everything in the catalogue. So:

- copy catalogue patterns into the client tree; do not import them;
- record what differed from Stone & Line's implementation of the same pattern;
- at the end, that comparison is what justifies promotion — or refutes it.

Nothing in the catalogue graduates on this client's word alone either. It graduates
because two implementations agree on the shape.
