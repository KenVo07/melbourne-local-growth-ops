# Tradies delivery runbook

The operating path from a closed sale to a live site, and the split of work that
keeps a tradesperson from being asked to act as their own designer.

For what a Tradies website can *say*, see
[tradies-profile-v1.md](tradies-profile-v1.md). For the premium half of the path,
see [premium-happy-path.md](premium-happy-path.md).

---

## The path

```
SOLD
 └─ sale-handoff.json          who closed it writes this, before anything else
     └─ business-read.json     the agency, from public sources, before asking the client anything
         ├─ client-intake.json the client, factual questions only
         └─ pitch-architecture.json Proportion, proposed private-pitch structure only
             └─ media-inventory.json   the client sends; the agency judges
                 ├─ tradie shotlist    what is still missing, and what each frame would prove
                 └─ tradie recommend   a creative direction proposed from what is known
                     └─ creative-configuration.json   edited, then approved as representation
                         └─ tradie compose --media <dir>
                          → client-website.json + truth-ledger.json + the files
                             └─ tradie p1    → experience source
                                 ├─ P1: assemble → preview → HUMAN SHIP GATE
                                 └─ P2/P3: creative:prepare → HUMAN DIRECTION GATE
                                            → parity slice → HUMAN PARITY GATE
                                            → production scale → creative:verify
                                            → preview → HUMAN SHIP GATE
```

`pnpm tradie check` is read-only and safe at any point. It is the command to run
when you do not know what to do next: it reports every gap with the person who
has to close it.

## Who answers what, and why the split is the product

| File | Answered by | Contains |
|---|---|---|
| `sale-handoff.json` | Whoever closed the sale | Tier, scope, included pages and capabilities, exclusions, **commitments**, deadline, domain control, approval authority |
| `business-read.json` | Proportion | Named public sources with dates, observations classified as verifiable or inferred, positioning, competitors, brand reality, trust strategy |
| `client-intake.json` | The client | Services and their boundaries, areas, story, process, credentials, past jobs, FAQs, commercial basics, contact and quote model, team |
| `pitch-architecture.json` | Proportion | Proposed private-pitch structure, an explicit `PROPORTION_CONTROLLED` `@proportion.systems` contact, visible proposal disclosure, and claim prohibitions; never credentials, completed jobs, testimonials, owner approval or Production authority |
| `media-inventory.json` | The client sends, **Proportion audits** | Every asset with subject, audit grade, provenance, production lane, real dimensions, focal point, the claim it may support, and who approved publication |
| `creative-configuration.json` | Proportion derives; the client approves normal delivery, or Proportion separately approves private-pitch direction | Perception targets, brand constraints, palette, typography, density, image treatment, motion appetite, proof emphasis, signature opportunity |

Exactly one structural authority is allowed. The normal path uses
`client-intake.json`, retains `VERIFIED_CLIENT_FACT`, and requires real client
direction approval. The private-pitch path uses `pitch-architecture.json`, records
its values as `PROPOSED_PITCH_ARCHITECTURE`, keeps `clientApproval.approved=false`,
and records a distinct agency pitch approval. A later client intake supersedes the
proposal for factual authority; Production remains fail-closed until real client
facts and approvals replace it.

### The client is never asked

- which photographs are good;
- what colours, typefaces, layout or density they want;
- what their information architecture should be;
- to write marketing copy.

They are asked factual questions about their own business, for everything they
already have, to take specifically-described photographs if they choose that
lane, to correct factual errors, and to approve how they are represented.

### `commitments` is required and often empty

An empty list is a positive statement that nothing extra was promised in the
sales conversation. It is only a statement because the field had to be filled in.
Every delivery that goes wrong on scope goes wrong here.

## Media

The seven-stage contract in [media-intake-contract.md](media-intake-contract.md)
is now executable. What follows is what the code enforces.

### The ask

> Send us everything you have. Do not curate it for design.

Completed work, work in progress, before states, team, vehicles, equipment,
premises, material detail, signage, logos, documents. Volume and honesty, not
selection.

### Audit grade and provenance are independent

They answer different questions and fail in opposite directions.

**Grade** — `PROOF_GRADE`, `SALES_GRADE`, `RECOVERY_GRADE`, `REFERENCE_ONLY` — is
what the agency thinks an asset is worth. A weak real photograph can be the most
valuable proof on the site.

**Provenance** — where it came from — governs what it is *allowed to stand
behind*. An extraordinary generated image can be worth nothing as proof, and
actively harmful beside a claim.

| Provenance | May substantiate |
|---|---|
| `CLIENT_JOB_PHOTOGRAPH` | A specific named job |
| `COMMISSIONED_PHOTOGRAPH` | A specific named job, as shot |
| `ENHANCED_CLIENT_ASSET` | Whatever its named source could — no more |
| `CLIENT_PREMISES_OR_TEAM` | The business itself |
| `RECOMPOSED_CLIENT_ASSET` | Atmosphere only |
| `GENERATED_SUPPORTING_MEDIA` | Nothing factual |
| `STOCK_OR_REFERENCE` | Nothing factual |

A generated image beside "our recent work in Sunbury" is refused by the
contract. It costs buyer trust before it costs anything legal — a reader who
suspects one photograph stops believing the rest of the page.

### The production lanes

| Lane | Produces | When |
|---|---|---|
| `SUPPLIED` | Client job / premises / team photographs | Real media used substantially as captured |
| `COMMISSIONED` | Commissioned photograph | A photographer is engaged |
| `AI_ENHANCED` | Enhanced client asset | Crop, exposure, colour, cleanup, distraction removal — the subject stays real, and the source asset must be named |
| `AI_RECOMPOSED` | Recomposed client asset | Materially recomposed. The line at which an asset stops being able to carry a job claim |
| `AI_GENERATED_SUPPORTING` | Generated supporting media | Non-representational atmosphere and design material |

Five rather than four, because correction and recomposition are exactly the two
sides of that line. Cropping and re-lighting a real courtyard leaves it that
courtyard; extending the frame and inventing the fence does not.

No lane is superior. A delivery may recommend "the existing media is enough",
"we can correct these", "these specific shots should be captured", "this client
merits a photographer", or any combination.

### Shot gaps

`pnpm tradie shotlist` derives requirements from the site being built — page
needs, proof gaps, and the chosen image treatment — never from a universal
checklist. Each requirement carries a subject, a framing, a count, and **the
claim it would substantiate**.

That last part is what makes it a list of jobs rather than feedback. "Three
landscape frames of a completed re-roof in overcast light, wide enough to show
the boundary — so the home page's opening claim has something behind it" is a
shot list. "Better photos of your work" is not.

The creative direction changes the count: `RESTRAINED` asks for one frame per
job, `DOMINANT` asks for three.

## Truth normalisation

`pnpm tradie compose` turns the five records into one validated
`client-website.json` plus `truth-ledger.json`, which classes every published
fact:

| Class | Meaning | Publishable as fact |
|---|---|---|
| `VERIFIED_CLIENT_FACT` | The client stated it; where it carries risk, we sighted it | Yes |
| `VERIFIED_PUBLIC_FACT` | Observable in a named public source on a named date | Yes |
| `CLIENT_CLAIM` | Stated, carries risk, not independently sighted | Only in wording the client approved |
| `INFERRED_OPPORTUNITY` | The agency's judgement | **Never** |
| `UNKNOWN` / `NOT_APPLICABLE` | Asked; unanswered or does not apply | — |

Credentials carry `evidence: SIGHTED | STATED` and an `approvedWording` string.
A licence number printed from an intake field is a representation the agency
made; the same number in wording the client approved is a representation the
client made. `readinessReport` raises `CREDENTIAL_UNSIGHTED` against the
**agency**, not the client.

The business read cannot produce a client fact: its observations may only be
`VERIFIED_PUBLIC_FACT` or `INFERRED_OPPORTUNITY`, and the contract refuses
anything else.

Research is a **frozen input**. The Factory performs no lookup at build time, so
what was observed and when is a recorded fact rather than whatever a search
returns on build day.

## Inputs ready

`pnpm tradie check` reports `INPUTS READY` when the Factory has what it needs.
The blocking list is deliberately short — a readiness check that blocks on
everything it would like is one an operator learns to ignore:

`SALE_HANDOFF_MISSING`, `CLIENT_INTAKE_MISSING`, `MEDIA_DUMP_MISSING`,
`CREATIVE_CONFIGURATION_MISSING`, `NO_APPROVED_MEDIA`,
`REFERENCE_ASSET_APPROVED`.

Everything else — an unstated service boundary, an unsighted credential, no work
examples, a direction asking for media the client does not have — is reported
with an owner and makes the site weaker rather than impossible.

## P1, P2, P3

Tier is a claim about how much **bespoke design and human review** a delivery
receives. It is not a claim about how many things move; see
[motion-policy.md](motion-policy.md).

| | P1 Professional | P2 Signature | P3 Flagship |
|---|---|---|---|
| Goal | A high-quality professional conversion site | A clear bespoke creative identity | Premium interactive storytelling |
| Creative exploration | One coherent direction from the configuration | Territories, red team, a signature slice | The above, plus a motion ceiling study |
| Design → code bridge | Not used | `creative:prepare` → `launch` → `verify` | Same, at greater depth |
| Parity slice | No — nothing is being translated | **Yes** if materially redesigned | Yes |
| Human gates | Ship | Direction, Parity, Ship | Direction, Parity, Motion ceiling, Ship |
| Client-specific components | Effectively none | One signature **or** richer route-family motion, not both by default | Bespoke authored signatures permitted |
| Motion | The generated floor. No scroll listener, no rAF loop | A small shared controller permitted | Motion may become narrative |
| Verification | Assemble, typecheck, build, preview | `creative:verify` on slice and on production | The same, with a larger QA budget |
| Where the time goes | Truth and media | Creative exploration and translation | Human review and testing |

**When to recommend which**

- **P1** when the business needs to be findable, credible and contactable, and
  its material is ordinary. Most trade businesses. P1 is commercially valuable on
  its own and must never be positioned as a stripped tier.
- **P2** when the business has a genuine differentiator its current presence hides
  — unusual work, an unusual standard, a specific customer it wants and is not
  getting — and enough material to carry it.
- **P3** when the site is itself part of the offer: a business selling at a price
  that requires the website to demonstrate the standard, with the material and the
  review budget to support it.

**What can be skipped.** The parity slice does not apply to P1, nor to a client
whose direction is a refinement of what is already built, nor to a single-route
change. Claude Design is never mandatory at any tier; the authority model is
provider-neutral and Mode B needs no provider at all.

## Client review and revisions

The client reviews **representation**, not pixels.

| The client decides | Proportion decides |
|---|---|
| Whether every fact is correct | Composition, type, colour, rhythm |
| Whether the business is represented correctly | Which photographs are used and how |
| Material brand concerns | Information architecture |
| Missing or wrong services and work | Interaction and motion |
| Content they will not publish | Whether the translation holds |
| Final acceptance | Whether it is good |

`creative-configuration.clientApproval.scope` is a constant —
`REPRESENTATION_AND_DIRECTION` — so there is no value the record can hold that
claims a client approved a layout.

Four kinds of change, and they are not the same commercial event:

| Kind | Example | Handling |
|---|---|---|
| **Factual correction** | A wrong suburb, a service that is not offered, a licence number | Always fixed. Correct the intake, re-run `compose`. Truth has one source. |
| **Scoped revision** | Reordering services, a different photograph from the approved set, tightening copy | Inside the agreed rounds |
| **New scope** | A page nobody sold, a service added after the site was built, a second location | Priced. Runs the same path: intake → media → compose |
| **Creative disagreement** | "I don't like the look of it" | The founder's judgement, not a queue item. The direction was approved at a named gate by a named person; reopening it is a decision, and it is made once |

A factual correction never costs the client anything and never counts against a
revision round. That rule is what makes the truth ledger worth keeping.

## Deployment, handoff, maintenance

No new infrastructure. The existing capability covers all of it:

| Step | Where |
|---|---|
| Preview deployment | `scripts/deployment/plan.mjs`, `apply.mjs` |
| Production deployment and rollback | [vercel-deployment-rollback.md](../runbooks/vercel-deployment-rollback.md) |
| Domain and DNS | [vercel-domain-setup.md](../runbooks/vercel-domain-setup.md) — the domain stays the client's; `sale-handoff.domain.controlledBy` records who holds it |
| Contact form credentials | [contact-production-gate.md](../runbooks/contact-production-gate.md) — a secret reference, never a value in the definition |
| Source handoff | [client-source-handoff.md](../runbooks/client-source-handoff.md) — the artifact is a standalone repository with its own lockfile and verifier |
| Recovery and transfer | [client-recovery-and-transfer.md](../runbooks/client-recovery-and-transfer.md) |

**Post-launch changes** run the same path they were built on: correct the
intake, `tradie compose`, regenerate or hand-edit, assemble, preview, ship. The
delivery workspace is the durable record, not the built site.

**Adding a service or a job later** is an intake edit and a re-compose. If the
service count crosses seven, the navigation gains its second level on the next
build without anybody deciding to add one; if the project count crosses twelve,
the archive appears. That is what putting the thresholds in one place bought.
