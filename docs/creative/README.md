# The Creative Delivery System

Reusable process, contracts, tooling and evidence for taking a delivery from the
P1 Factory's professional floor to a client-specific, reference-class,
art-directed website.

**This is not a runtime.** Nothing here is a workspace package, nothing is
importable from client source, and a website built with this system ships exactly
the same runtime as one built without it.

## Start here

| If you are… | Read |
|---|---|
| Understanding what this is and why it is shaped this way | [creative-delivery-system.md](creative-delivery-system.md) |
| Running a creative exploration | [claude-design-operator-pack.md](claude-design-operator-pack.md) |
| Building an approved direction in the repository | [production-translation-runbook.md](production-translation-runbook.md) |
| Reviewing a direction as the founder | [creative-gate.md](creative-gate.md) |
| Working out what imagery a delivery may use | [media-art-direction.md](media-art-direction.md) |
| Finding out what is wrong with a direction | [creative-red-team.md](creative-red-team.md) |
| Deciding what a Signature can technically do | [signature-capability-envelope.md](signature-capability-envelope.md) |
| Using references without absorbing them | [reference-analysis.md](reference-analysis.md) |
| Working out what evidence to capture | [evidence-protocol.md](evidence-protocol.md) |

## The workflow

```
  package the client        →  pnpm creative:package <client> <dir>
  scaffold the artifacts    →  pnpm creative:new <client-id> <dir>
  explore three territories →  operator pack §2–3
  build the Signature Slice →  operator pack §4–6
  red team, fresh eyes      →  creative-red-team.md
  validate                  →  pnpm creative:validate <dir>
  founder Creative Gate     →  creative-gate.md          ← human, always
  hand off to production    →  operator pack §7
  build                     →  production-translation-runbook.md
  record promotion          →  promotion-ledger.md
```

## Commands

| Command | Does |
|---|---|
| `pnpm creative:package <client> <dir>` | Turns a P1 client definition into creative-exploration context. Extracts only; invents nothing. |
| `pnpm creative:new <client-id> <dir>` | Scaffolds the seven artifacts, generated from the model that validates them. |
| `pnpm creative:validate <dir>` | Checks presence, traceability, provenance and consistency. Never taste. |
| `pnpm creative:validate:self-test` | Proves the validator's own rules still fire. |
| `pnpm creative:envelope` | Re-measures what a Signature may do against the live source policy. |
| `pnpm creative:templates` | Regenerates `docs/creative/templates/`. |

## The artifacts

| Artifact | Carries |
|---|---|
| Creative Intent | Business and customer truth, desired perception, anti-targets, references. |
| Creative Territory ×3 | Three materially different theses, each naming where its design values live. |
| Signature Slice | The prototyped proof: navigation, opening, proof sequence, conversion. |
| Creative Gate | The founder's recorded decision, named fixes, freeze rule. |
| Production Handoff | Intent and constraint for the build agent — never pixels. |
| Media Plan | Every asset, its provenance class, and what it may substantiate. |
| Promotion Ledger | Every bespoke mechanic and where it lives. Client-local by default. |

Each is one Markdown file with YAML front-matter. Front-matter carries what a
machine can honestly check; prose carries the creative content.

## Three things this system will not do

1. **Judge taste.** No validator here claims to. The Creative Gate is human and
   an agent that signs one is refused.
2. **Make a vendor load-bearing.** Claude Design is a current preferred
   environment, in beta, and replaceable without changing any artifact,
   validator, contract or line of client source.
3. **Promote anything into Core.** Only repeated evidence across two or more
   deliveries does that, and the validator enforces the count.

## Worked example

`tests/fixtures/web01b/northline/acceptance/` holds the practice this system
generalises — a creative contract and a gate decision written before the system
existed. Read them as an example of the standard, not as a starting point to edit;
copying a previous delivery's grammar is a red team finding, not a saving.
