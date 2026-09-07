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

1. **`client-website.json` is the only composed website authority.** Its factual
   claims still require client/public evidence. A separate `pitch-architecture.json`
   may provide explicitly proposed structure for a private nonproduction pitch,
   but it never becomes `VERIFIED_CLIENT_FACT` and cannot authorize Production.
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

> **V1 is done.** Every decision below is answered, implemented and rendered
> against a second client context. The answers live in
> [tradies-profile-v1.md](tradies-profile-v1.md) and
> [tradies-delivery-runbook.md](tradies-delivery-runbook.md); this table is kept
> as the record of what was open and where each one landed.

## What V1 must decide, in order

These are open by design, and each is cheap to build and expensive to decide —
which is why they are decisions rather than code.

| # | Decision | Answer |
|---|---|---|
| 1 | The archive threshold, and whether it is client or Platform | 12 / 25, **Platform**, stated once in `collection-scale.ts` |
| 2 | Categories: declared vocabulary or derived | **Derived** from `serviceIds`, `locationLabel`, `completedYear`. No vocabulary |
| 3 | Filtered view: URL or client state | **Client state.** Every record ships in the HTML, so the problem is attention, not bytes |
| 4 | Do services group, and is a group a page | **They group. A group is not a page** |
| 5 | Minimum truth for a service to deserve a detail route | **Two decision answers**, evidence counting as one. Advisory |
| 6 | Second nav level: page graph or client experience | **Page graph**, through the existing `parentPageId`. No new schema |
| 7 | Mega-nav behaviour under keyboard, touch and reduced motion | **A disclosure, not a menu.** Native `<details>`; no hover; two controls on touch; nothing animates |
| 8 | Media intake implementation | **Schema and CLI, no uploader and no storage product.** `scripts/tradies/` |
| 9 | Who or what chooses a focal point | **A person, at audit**, recorded per asset. Refused if absent |
| 10 | Reverse shared-element continuity at Platform level | **Still deferred** — no client has needed it twice |
| 11 | Authored surface's element reset at zero specificity | **Still open.** No new client stylesheet has been hand-authored yet; the generated one has no such collision |
| 12 | "Notation on media" as a declared property | **Still deferred** — one client, one instance |

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
