# Production translation runbook

For the local Claude Code / AWOS session that turns an approved Signature Slice
into production source.

**You are not copying a prototype. You are building the intent the prototype
argued for, inside constraints the prototype did not have to respect.**

## If you were given a launch pack

A premium delivery hands you a frozen pack from `pnpm creative:launch` rather
than a loose directory. Everything in this runbook still applies; the pack makes
three things exact that were otherwise a matter of care.

**Verify it before you read the creative detail.** The pack is hashed:

```sh
cd <launch-pack> && sha256sum -c integrity.sha256
```

If a hash does not match, stop. A launch pack edited after publication is a brief
nobody approved.

**`production-launch.json` names the target, and it is the only one.** The
`productionTarget.experienceRoot` it records is the same client's live
`experience/` tree — not a copy, not the workspace's `source/`, which is a
read-only baseline for you to read and diff against. There is no second website
in this system.

**`repositoryBaseline` names the branch and the revision you start from.** It was
recorded from a clean worktree so `creative:verify` can compute exactly what you
changed. Start there, commit coherently as you go, and hand back the candidate
revision.

`PRODUCTION_AGENT_PROMPT.md` in the pack states the same boundary in the form a
fresh agent needs. `inputs/` holds the delivery byte-for-byte as it was gated.

### The change boundary, exactly

| May change | May not change |
|---|---|
| `<input>/experience/**` — this client's authored source | P1 Factory packages and the managed-web runtime |
| Client-local tests colocated with that experience | Root dependency, lockfile, tooling or CI configuration |
| The handoff's `## Translation delta` | Any other client's input, source or media |
| A promotion-ledger row, recorded client-local | `client-website.json` — business truth is an input, never an output |
| Evidence written into the output directory `creative:verify` is given | Routes, connectors, recipient addresses, secrets, entitlements, deployment configuration |
| | Shared or global design system resources |
| | Provider runtime, SDK or embed code |
| | New remote fonts, remote CSS, network requests, storage, eval, server or API code |
| | Promotion of a client-local mechanic into Core |

No launch approves a dependency or runtime-posture change. If the direction needs
one, that is a stop condition, not a decision you make.

`creative:verify` refuses outright — no report, nothing to review — when a
candidate changes business truth, dependencies, P1, root configuration or another
client. Those are not findings to be argued; they mean the delta is not the one
that was approved.

## Stop conditions — check these first

Stop and ask a human if any of these is true. Do not proceed on assumption.

| Condition | Why it stops you |
|---|---|
| No Creative Gate artifact, or its decision is `FAIL` | An unapproved direction does not go to production. |
| The gate's `decided_by` is an agent | The gate is reserved for a named human. An agent-signed gate is void. |
| `pnpm creative:validate <delivery>` fails | The handoff is incomplete or untraceable. Fix the artifacts first. |
| The handoff declares a technique the envelope refuses | The direction is not buildable as specified. Return to the Slice, do not weaken the policy. |
| Production would need a claim the client cannot evidence | Truth failure. Return to the media plan and the founder. |
| The work requires changing Factory/Core source | Almost certainly wrong. See §7 before touching Core. |
| Real client data would go to a new external provider | Provider/privacy/data-use decision. Founder's call. |
| The live source no longer matches the launch baseline before your first edit | Someone changed the substrate under you. Re-prepare; do not build on top of it. |
| A provider export carries hidden network, storage or server behaviour | It was never reviewed by anyone. Build the intent instead, or stop. |
| Another client's design or source appears in your working context | A delivery changes one client's experience and nothing else. |
| The branch or baseline revision is not the one the launch pack names | You are building against different history than the one that will be diffed. |

A stopped run records **the exact contradiction and the smallest next decision**,
and hands it back. It does not invent a workaround that weakens the boundary. A
stop is cheap; a boundary quietly widened to fit one direction is not.

## 1. What to read, in this order

1. `CREATIVE_CONTEXT.md` — the client's real business truth, routes, content, media
   and what it may not claim.
2. `creative-intent.md` — the argument, and the **anti-targets**. Read the
   anti-targets twice; they are the most common thing a build drifts into.
3. The selected `territory-*.md` — the thesis and what it inherits versus rewrites.
4. `signature-slice.md` — what was proven, and its `prototype_fakes` list.
5. `creative-gate.md` — the decision, and any **named fixes**, which are acceptance
   conditions rather than suggestions.
6. `production-handoff.md` — the build brief.
7. `media-plan.md` — provenance, and what each asset may substantiate.
8. `signature-capability-envelope.md` — what you are allowed to build with.

## 2. What is authoritative, and what is not

| Prototype output | Authority |
|---|---|
| Creative intent, thesis, anti-targets | **Authoritative.** Build these. |
| Behaviour and movement *intent* | **Authoritative** as relationships and character. |
| Responsive *intent* | **Authoritative** as how the idea recomposes. |
| Media provenance and what may be claimed | **Authoritative and non-negotiable.** |
| Named fixes from the gate | **Authoritative acceptance conditions.** |
| Exact pixel values, spacing, timings | **Not authoritative.** Reconstruct to the repository's own scale and rhythm. |
| Prototype markup and CSS | **Not authoritative.** Almost none of it will satisfy the source policy. |
| Screenshots | **Not a specification.** If you find yourself matching a screenshot, stop and re-read the intent. |
| Anything in `prototype_fakes` | **Must not reach production.** |

## 3. What must be reimplemented rather than ported

The prototype ran in a browser with no constraints. Production source runs inside
`client-experience-source-policy.ts`, which fails closed. Expect to rewrite:

- **Every anchor and image.** Raw `<a>` and `<img>` are refused. Use the Platform
  `Link` and `Image` primitives; `Image` takes a validated media *reference*, not
  a path, and requires `sizes`.
- **Anything that loads.** `fetch`, `new Image()`, `new Audio()` and `Worker` are
  refused in any reference position. Shader sources, geometry and any generative
  input must be inline literals or authored source.
- **Remote fonts.** Refused. Self-host under `/fonts/` or use the system stack.
- **CSS raster references.** `url()` may only reach `/fonts/**` and inline
  `data:image/svg+xml`. Photographic backgrounds must render through `Image`.
- **Inline SVG data URIs.** Permitted, but every quote must be percent-encoded —
  `%27` not `'`. The two forms are identical in a browser and only one passes.
- **Any persistence.** localStorage and friends are refused.
- **Any framework import.** `next/*` is refused wholesale.

Run the envelope to confirm rather than trusting this list:

```
pnpm creative:envelope
```

## 4. What to reuse rather than rebuild

Rebuilding these bespoke is the most common way a delivery becomes unmaintainable.

- **Routing, metadata, structured data, not-found behaviour** — Kernel-owned.
- **The Page Graph** — the validated route set, relationships, navigation labels
  and destinations. Do not invent routes.
- **Platform primitives** — `Link`, `Image`, `Region`, `Action`, `Search`,
  `Disclosure`, `Main`, `SkipLink`. `Disclosure` in particular already solves the
  responsive menu that every client would otherwise hand-roll.
- **Media mechanics** — focal behaviour, responsive delivery and art-directed
  crops already exist. Use them.
- **Foundation Search** — renders nothing when the snapshot resolved it disabled,
  so an authored route may place it unconditionally.
- **The starter's resolved design decisions**, where the territory inherits rather
  than rewrites them.

## 5. What may remain client-local bespoke

Client-local is the **default**, not the exception. Signature source lives in the
client's own `experience/` tree and is declared in `manifest.json` under
`signatureIds`, with the registry enforcing exact coverage.

A scoped dependency is permitted when the concept justifies it — declare it in
`publicDependencies` with an exact version, get governance approval, and set
`runtime.motion: CLIENT_LIBRARY`. Do not add one to look sophisticated; the
manifest cross-check will also refuse `CLIENT_LIBRARY` with no declared dependency.

Nothing bespoke goes into Core during this build. See §7.

## 6. Tests, evidence and acceptance

Write tests for the client-local Signature as client-local tests. At minimum:

- the Signature renders its meaning with motion disabled;
- reduced motion produces the designed rest state, not a hidden one;
- the conversion path works at desktop and mobile widths;
- keyboard operation reaches every interactive element, with visible focus;
- no route ships a technique the envelope refuses.

Then the standing workspace gates, unchanged:

```
pnpm check                    # build + test + typecheck
pnpm --filter @melbourne-local-growth-ops/managed-web test:e2e
pnpm creative:validate <delivery-directory>
```

Capture evidence per the [evidence protocol](evidence-protocol.md): static
visuals at 1440/834/390/320, temporal recordings of the Signature, the
reduced-motion state, accessibility results per engine, and runtime/performance
figures.

## 7. Before you change Core — read this

Almost every impulse to change Factory/Core during a P2/P3 build is wrong. The
platform's rule, from ADR-0006 and the locked boundaries:

> Prefer client-local Signature implementation. Promote a new reusable Core
> capability only after repeated evidence.

Promotion requires **all** of:

1. it is not client-specific creative expression;
2. **two or more** real deliveries need it;
3. promotion lowers recurring cost without imposing a global runtime or creative tax;
4. there is a clear invariant substrate — something genuinely the same across
   those deliveries, not merely similar.

Record the mechanic in `promotion-ledger.md` as `CLIENT_LOCAL_SIGNATURE` now.
`pnpm creative:validate` refuses a `FACTORY_CANDIDATE` with fewer than two named
deliveries or no stated invariant substrate. Being impressive is not an input.

If you believe you have found a genuine **defect** in Factory source — as opposed
to a missing capability you want — that is different. Say so explicitly, show the
failing case, and fix the defect on its own merits, separately from the creative
work.

## 8. Close the loop

When production is complete, write the **`## Translation delta`** section into the
production handoff: what actually changed between the approved prototype and the
shipped implementation, and why the intent still holds.

This is the field that makes the next delivery's estimate honest. A build where
nothing changed usually means nobody checked.

Write it in the workspace's own `delivery/production-handoff.md`, and change
nothing else in that file. `creative:verify` compares every other section to the
copy the launch pack froze: a Production delta edited during implementation
records what was built rather than what was approved, and the gap between those
two is what a ship gate exists to catch.

Then hand back the candidate revision and let verification run:

```sh
pnpm creative:verify \
  --launch    <launch-pack> \
  --workspace <workspace> \
  --input     <client input> \
  --candidate <your revision> \
  --output    <new empty directory> \
  --evidence  <candidate-evidence.json>
```

It publishes an objective report and a **blank** ship gate. You do not sign that
gate, and there is no field in the report in which you could record an opinion
about the work. A named human decides, against the report and against the site
itself.
