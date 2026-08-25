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
| **Delivering a Tradie client** | [tradies-delivery-runbook.md](tradies-delivery-runbook.md) |
| **Asking what a Tradies site can say** | [tradies-profile-v1.md](tradies-profile-v1.md) |
| Running a premium delivery | [premium-happy-path.md](premium-happy-path.md) |
| Reading what the V1 workflow inherited | [tradies-workflow-v1-contract.md](tradies-workflow-v1-contract.md) |
| Deciding where a mechanic belongs | [interaction-taxonomy.md](interaction-taxonomy.md) |
| Deciding whether to promote something | [promotion-ladder.md](promotion-ladder.md) |
| Looking for a proven mechanic to copy | [pattern-catalogue.md](pattern-catalogue.md) |
| Redesigning a client materially | [parity-slice-gate.md](parity-slice-gate.md) |
| Deciding how much a tier should move | [motion-policy.md](motion-policy.md) |
| Designing projects or services at scale | [collection-and-content-contract.md](collection-and-content-contract.md) |
| Onboarding a client's media | [media-intake-contract.md](media-intake-contract.md) |
| Checking what was and was not promoted | [disposition.md](disposition.md) |
| Understanding design → code authority | [../creative/authority-model.md](../creative/authority-model.md) |

## The three design studies — closed

The post-Stone consolidation deliberately left three problems unsolved rather than
invent a layout from one client's evidence. Tradies Profile V1 answered all three,
and each brief now carries its resolution at the top:

- [A — high-cardinality project archive](design-briefs/high-cardinality-projects.md) — **resolved**
- [B — high-cardinality service architecture](design-briefs/large-service-architecture.md) — **resolved**
- [C — visual and mega navigation](design-briefs/visual-navigation.md) — **resolved**

Every one turned out to be an *architectural* question rather than an aesthetic
one — where the second level lives, whether a filter is a URL, whether a group is
a page — and each answer is implemented, rendered and tested against a second
client context. See [tradies-profile-v1.md](tradies-profile-v1.md).

What is still deliberately not invented is the **visual** refinement: the panel's
composition and the archive cell's typography. That belongs to a real client's
creative direction, where it will have that client's material to work with.
Inventing it now from a synthetic fixture is how a Factory acquires a default
nobody chose.

## What is runtime, and what is not

Nothing in this directory is runtime. It is process, contracts and reference. The
only Platform code this consolidation added is in
`scripts/creative/` — the authority model, the packaging rule and the pointer
evidence contract — plus one regression test in `packages/experience-starter/`.

A website built after this consolidation ships exactly the same runtime as one built
before it.
