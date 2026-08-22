# Premium delivery — consolidated process

What the Stone & Line premium case study taught, converted into a reusable
delivery system. Written so client #2 does not repeat client #1's archaeology.

**The principle: reuse the machine, not the client's creative identity.**
Stone & Line's composition, palette, architectural notation, Cut A–A and landscape
photography are that client's. None of them is a Factory default, and nothing here
turns them into one.

```
business-specific inputs  →  reusable delivery process  →  bespoke client experience
```

## Start here

| If you are… | Read |
|---|---|
| Running a premium delivery | [premium-happy-path.md](premium-happy-path.md) |
| Starting the next client's workflow | [tradies-workflow-v1-contract.md](tradies-workflow-v1-contract.md) |
| Deciding where a mechanic belongs | [interaction-taxonomy.md](interaction-taxonomy.md) |
| Deciding whether to promote something | [promotion-ladder.md](promotion-ladder.md) |
| Looking for a proven mechanic to copy | [pattern-catalogue.md](pattern-catalogue.md) |
| Redesigning a client materially | [parity-slice-gate.md](parity-slice-gate.md) |
| Deciding how much a tier should move | [motion-policy.md](motion-policy.md) |
| Designing projects or services at scale | [collection-and-content-contract.md](collection-and-content-contract.md) |
| Onboarding a client's media | [media-intake-contract.md](media-intake-contract.md) |
| Checking what was and was not promoted | [disposition.md](disposition.md) |
| Understanding design → code authority | [../creative/authority-model.md](../creative/authority-model.md) |

## Open design studies

Three problems this consolidation deliberately did **not** solve, each with a brief
stating the problem, inputs, scalability ranges, accessibility and mobile
requirements, truth constraints, and the questions a design study must answer:

- [A — high-cardinality project archive](design-briefs/high-cardinality-projects.md)
- [B — high-cardinality service architecture](design-briefs/large-service-architecture.md)
- [C — visual and mega navigation](design-briefs/visual-navigation.md)

No layouts were invented for these. Inventing one from a single client's evidence is
how a Factory acquires a default nobody chose.

## What is runtime, and what is not

Nothing in this directory is runtime. It is process, contracts and reference. The
only Platform code this consolidation added is in
`scripts/creative/` — the authority model, the packaging rule and the pointer
evidence contract — plus one regression test in `packages/experience-starter/`.

A website built after this consolidation ships exactly the same runtime as one built
before it.
