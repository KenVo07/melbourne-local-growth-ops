# The Creative Delivery System

How Proportion takes a delivery from the P1 Factory's professional floor to a
client-specific, reference-class, strongly art-directed website — repeatably,
without turning the Platform into a template engine.

- Status: Proposed for WEB-01D founder review
- Implements: the "Creative Proof Loop" named as an outstanding cost in
  [ADR-0006](../decisions/ADR-0006-client-experience-layer.md)
- Governs: P2/P3 creative delivery. It does **not** govern P1 Factory output.

## 1. What this system is, and what it refuses to be

The P1 Factory is a professional floor: a validated Page Graph, a generated or
authored client-local Experience, proven responsive/motion/accessibility
mechanics, and a standalone artifact. It is deliberately not a creative ceiling.

This system is the **process, contracts, tooling and evidence** that sit above
that floor. It is not a renderer, not a component library, not a theme registry,
and not a runtime. Nothing in it is imported by a client website. A delivery that
uses this system end-to-end ships exactly the same runtime as one that does not.

That is the load-bearing property, and it is structural rather than a promise:
every asset here is either a Markdown document under `docs/creative/` or a Node
script under `scripts/creative/`. Neither is a workspace package, so neither is
resolvable from client source, and neither can appear in an artifact's dependency
graph. There is no code path by which this system reaches a browser.

## 2. The one design constraint that shaped everything else

**The Factory already carries a creative decision spine, and this system must
feed it rather than restate it.**

`packages/experience-starter/src/brief.ts` already encodes the client's creative
grammar as design *decisions*: `creative.thesis`, `creative.perceptionTargets`,
`creative.antiTargets`, continuous typography/space/colour/media values, one
composition grammar per page kind, and a complete Motion & Interaction Language
(`tempo`, `attack`, `travel`, `overshoot`, `pointerFeedback`, `entrance`,
`disclosure`, `mediaExploration`, `reducedMotion`).

`packages/site-core/src/client-experience-manifest.ts` already carries
`signatureIds`, exact-pinned `publicDependencies`, and a
`runtime.motion: NONE | NATIVE | CLIENT_LIBRARY` declaration that is cross-checked
against those dependencies.

An earlier draft of this system defined its own typography/motion/composition
fields on the Territory artifact. That draft was rejected in red team (R2 below).
Restating those values would have produced two sources of truth for the same
decision, and the schema would have had to grow every time the brief grew.

The rule that replaced it:

> **A creative artifact states intent, rationale and constraint in prose. Where a
> decision has a machine home in the Factory, the artifact names that home and
> the value lives there — never in both.**

So a Territory says *why* the type is condensed and tabular and what that does for
the client's argument. The actual `displayTracking: -0.02` lives in the brief. The
validator checks the link exists, not the number.

## 3. The artifact chain

Seven authored artifacts. Six of them are the templates the WEB-01D handoff
package already specified; exactly one is new (Production Handoff, Requirement G).
Adding no others is a deliberate anti-bloat decision.

```
  REFERENCE ANALYSIS ──┐
  (a section of Intent)│
                       ▼
  CREATIVE INTENT ───► CREATIVE TERRITORY × 3 ───► SIGNATURE SLICE ───► CREATIVE GATE
   business truth       materially different        one selected         human decision
   perception target    thesis + rationale          nav/hero/proof/       PASS / PASS WITH
   anti-targets         P1 inherit vs rewrite       conversion            NAMED FIXES / FAIL
        │                                                │                      │
        │                                                ▼                      ▼
        │                                         MEDIA PLAN            PRODUCTION HANDOFF
        │                                      provenance-classed        intent, not pixels
        │                                                                       │
        └───────────────── traceability is checked in both directions ──────────┘
                                                                                ▼
                                                                       PROMOTION LEDGER
                                                                   client-local by default
```

Each artifact is **one Markdown file with a YAML front-matter block**. The
front-matter carries only what a machine can honestly check — identity, links,
declared techniques, provenance classes, decisions, dates. The prose carries the
creative content. This split is the whole reason the system can be validated
without anyone pretending taste is machine-checkable.

It also keeps the system operable by a trained Digital Experience/Conversion
specialist who does not write source: every artifact is a document, and the only
command they run is `pnpm creative:validate`.

## 4. Where creative ambition meets production reality

The failure mode this system exists to prevent is a prototype that promises what
production cannot ship — the thing that turns an approved direction into a
renegotiation three weeks later.

`apps/managed-web/src/generation/client-experience-source-policy.ts` decides, at
build time and fail-closed, what client-local source may do. It is therefore the
real boundary of what any Signature can be. Requirement H's menu of techniques
(CSS, native APIs, WAAPI, Canvas/WebGL/shaders, video, 3D, scoped libraries)
intersects that policy non-trivially: some of it is permitted, some is refused
outright, and reading the file is not proof.

So the system does not assert the envelope. It **probes** it:
`scripts/creative/envelope-probe.ts` runs candidate techniques through the real
`inspectClientExperienceSource` and emits a machine-readable capability matrix.
A Signature Slice declares its techniques in front-matter; the validator refuses
a slice that declares a technique the probe proved refused.

When the policy changes, the probe is re-run and the envelope updates itself. The
creative system stays honest about production without anyone maintaining a second
description of the rules.

## 5. Claude Design's place

Claude Design is the current preferred creative exploration environment. It is
**optional, upstream, and replaceable**, and nothing about that is aspirational —
it falls out of how the integration actually works.

Verified 2026-08-19 from Anthropic primary sources and this Claude Code build:
Claude Design is in **beta** (Pro/Max/Team/Enterprise, default off for
Enterprise); `/design-login` authenticates an MCP endpoint at
`https://api.anthropic.com/v1/design/mcp`; `/design-sync` syncs a design system in
from Claude Code, which the documentation specifically recommends for large
repositories rather than wholesale upload; and a finished design hands off to
Claude Code so it "continues from your existing work instead of starting over from
a screenshot."

The architectural consequences:

1. **The repository is upstream of the canvas, not downstream of it.** `DesignSync`
   pushes a bundle built from repository source into a design-system project behind
   a `finalize_plan` boundary that pins the exact paths and the local directory.
   Production source is never pulled down as authority.
2. **The Design → Code handoff carries context into an agent that writes repository
   source.** The canvas is never the production artefact. This is exactly why the
   Production Handoff artifact exists: to make that handoff carry *intent and
   constraint*, so the receiving agent does not degrade into copying a picture.
3. **Beta and default-off for Enterprise** is sufficient reason on its own to keep
   the dependency optional.

Swapping Claude Design for another environment changes which prompts an operator
pastes. It changes no artifact, no validator, no contract and no line of client
source. That is the replaceability test, and the system passes it by construction.

## 6. Repository location, and why

| Asset | Location | Why |
|---|---|---|
| Process, contracts, operator pack, runbooks, templates | `docs/creative/` | `docs/` is the established home for architecture, governance and reusable templates (`docs/governance/templates/` is the direct precedent). |
| Validators, envelope probe, context packager | `scripts/creative/` | `scripts/<area>/*.mjs` with colocated `*.test.mjs` is the established home for executable workspace tooling that is not a runtime package — `scripts/governance`, `scripts/deployment`, `scripts/handoff`. |
| Operator entry points | root `package.json` `creative:*` scripts | Mirrors the existing `governance:*` entries, including a `--self-test` flag, following `governance:audit:self-test`. |

**No new package was created.** `04_REUSABLE_SYSTEM_REQUIREMENTS.md` forbids
creating one merely to store prose, and creating one for the validators would be
worse than unnecessary: a workspace package is resolvable from client source and
would need build/typecheck wiring, which is precisely the runtime-leak risk this
system must not introduce. Scripts are unreachable from an artifact by
construction.

## 7. Adversarial red team, and what it changed

The architecture above is the revised one. This section records what the first
draft got wrong, because the failure modes recur and the reasoning is the reusable
part.

### R1 — Vendor lock-in through the back door
**Attack.** The system claims Claude Design is optional, but the operator pack is
the only route from Intent to a reviewed prototype. If the prompts assume Claude
Design's canvas, export formats and handoff button, the system is Claude-shaped
whatever the prose says.
**Verdict: real.** The first draft's Production Handoff had a required
`claude_design_project_id` field.
**Revision.** The handoff declares `prototype.tool` as free text with
`prototype.artifacts` as paths/URLs. The validator requires *a* prototype
provenance, never a specific vendor's. The operator pack is split: a
tool-independent **intent section** (what to explore and why, the anti-targets,
the non-copying rule) and a thin **tool-specific section** (the exact Claude
Design prompts). Replacing the vendor replaces only the second half.

### R2 — Schema bloat and a second source of truth
**Attack.** Territory needed typography, spacing, motion and composition fields to
be useful. But the Factory's `StarterBrief` already has all of them, so every
delivery would maintain two descriptions that drift, and the Territory schema
would chase the brief forever. This is the "Figma-in-JSON" prohibition arriving by
increments.
**Verdict: real, and the most dangerous finding.**
**Revision.** Section 2's rule. Territory front-matter carries no design values at
all — only identity, the thesis name, and `starter_brief` / `bespoke` linkage. All
craft lives in prose and in the brief. The system got smaller and more honest.

### R3 — Runtime leakage into P1
**Attack.** Anything that becomes importable eventually gets imported. A
`packages/creative-*` would end up in a client's dependency graph the first time
someone wanted a shared helper.
**Verdict: real as a trajectory.**
**Revision.** Docs and scripts only; no package; no build output. Asserted by test
rather than by intent: `scripts/creative/creative-commands.test.mjs` checks that
nothing under `docs/creative/` or `scripts/creative/` is referenced by any
workspace `package.json` or any client artifact file list.

### R4 — Duplication with Design DNA and the Motion Brief
**Attack.** `design-dna.json` is already described by ADR-0006 as "a creative
contract and machine-readable provenance input". A Creative Intent document
overlaps it.
**Verdict: partly real.** They overlap in subject, not in role.
**Revision.** Stated explicitly: Design DNA is the *frozen, machine-readable
outcome* that production and provenance consume. Creative Intent is the *upstream
human argument* that produces it and that survives it — anti-targets and business
truth have no home in `design-dna.json` and are exactly what a later reviewer
needs. The Gate freezes the DNA; the Intent explains why it is what it is.

### R5 — Non-developer operator usability
**Attack.** A system validated by a Node script is a system a Digital
Experience/Conversion specialist cannot run, so it will be run by an engineer or
not at all.
**Verdict: real.**
**Revision.** Artifacts are Markdown with front-matter, authorable in any editor.
One command, `pnpm creative:validate <directory>`. Failures name the artifact, the
missing field, and the sentence to write — not a JSON pointer. A `--self-test`
flag proves the validator itself works without a delivery in hand.

### R6 — Handoff ambiguity and prototype-to-production drift
**Attack.** "Preserve design intent" is unfalsifiable. Two agents will read the
same handoff and build different sites, and nobody will be able to say which one
was wrong.
**Verdict: real.**
**Revision.** Three required, falsifiable fields. `prototype_fakes` — what the
prototype approximates that production must not inherit — is required and must be
non-empty, because a prototype that fakes nothing is a prototype nobody checked.
`techniques` is cross-checked against the probed capability envelope. And after
production, `translation_delta` records what actually changed, which is what makes
the next delivery's estimate honest.

### R7 — The Gate can be self-passed
**Attack.** An agent that writes the Signature Slice and then fills in the Gate
has graded its own work, and the founder's creative authority is decorative.
**Verdict: real, and it is the one failure the acceptance model calls out by
name.**
**Revision.** The Gate artifact requires a `decided_by` that is a named human and
a `candidate_commit`; the validator refuses a Gate whose `decided_by` is absent or
is an agent identity, and refuses a `PASS` carrying no reviewed evidence set. The
system can prove a Gate *happened*. It never claims to have passed one.

### R8 — Media truth laundering
**Attack.** Generated imagery drifts into substantiating real claims — a rendered
"team" photo beside a certification, an AI-extended site photograph presented as
evidence of completed work.
**Verdict: real, and the highest-consequence failure in the system.**
**Revision.** Every asset carries one of the five provenance classes, and the
validator enforces the asymmetry that matters: an asset substantiating work, team,
premises, results or certifications must be `REAL_CLIENT_EVIDENCE`. Anything else
in that position fails. `AI_GENERATED_CREATIVE` may carry atmosphere; it may never
carry proof.

### R9 — Promotion pressure from impressive work
**Attack.** A Signature that looks extraordinary generates pressure to promote it
into Core, which is how component landfill starts.
**Verdict: real; ADR-0006 already anticipated it.**
**Revision.** The Promotion Ledger defaults every mechanic to
`CLIENT_LOCAL_SIGNATURE` and requires *two or more* named client deliveries plus a
stated invariant substrate before `FACTORY_CANDIDATE` is even permitted as a
value. The validator enforces the count. Being impressive is not an input.

### R10 — The system becomes the aesthetic
**Attack.** A reusable creative pack quietly propagates one house style, and every
Proportion client starts looking like northline. This is the "creative resource
pack that copies one client's aesthetic" prohibition.
**Verdict: real, and it survives partially.**
**Mitigation.** No artifact carries a default aesthetic value; templates ship with
empty fields rather than examples-in-place; northline is referenced only as a
*worked example in a separate file*, never as a starting point to edit. The red
team protocol asks directly whether a delivery has inherited a previous delivery's
grammar.
**Residual risk, accepted and recorded.** Prompts and examples exert gravity that
no validator can measure. This is a human review responsibility, and it is listed
as a standing question in the Creative Red Team protocol rather than pretended
away.

## 8. What this system does not do

- It does not judge taste, and no validator in it claims to.
- It does not make an unreviewed direction shippable.
- It does not authorise any change to P1 Factory source or output.
- It does not make Claude Design, or any vendor, a production dependency.
- It does not promote anything into Core. Only repeated evidence does that.
