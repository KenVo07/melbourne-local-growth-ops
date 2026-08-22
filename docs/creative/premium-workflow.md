# The premium workflow

Three commands that bind a creative delivery to the exact source production will
modify, so the thing a human approves and the thing an agent builds are provably
the same site.

Nothing here is a new subsystem. `creative:prepare`, `creative:launch` and
`creative:verify` are a thin bridge between the P1 Factory and the creative
delivery system that already exists: the same nine artifacts, the same
validator, the same gate, the same source policy. What they add is *identity* —
every step naming the exact bytes it was performed against.

There is no database, no service, no dashboard, no workflow engine and no
mutable stage file. Status is whatever the artifacts say; the commands publish
immutable outputs and refuse rather than repair.

## The journey

```
  pnpm creative:prepare   →  a source-bound workspace
  explore, prototype, decide                            ← human, and any tool
  pnpm creative:validate <workspace>/delivery
  record a named-human Creative Gate                    ← human, always
  pnpm creative:launch    →  a frozen launch pack
  a production agent implements in the live experience/ tree
  pnpm creative:verify    →  an objective report + a blank ship gate
  sign the ship gate                                    ← human, always
```

For a **materially redesigned** client, run that sequence once on a representative
parity slice — home, one service detail, one project detail, mobile — and gate it
before scaling to the remaining routes. Not a fourth command: the same three, on a
smaller scope, so a translation mistake costs one page instead of a site. See the
[parity-slice gate](../delivery/parity-slice-gate.md).

Two of those eight steps are human decisions, and no command can make either.
The other six are checks and packaging.

## 1. `creative:prepare`

```sh
pnpm creative:prepare \
  --input     <client-build-package> \
  --artifact  <assembled-artifact-root> \
  --output    <empty-directory> \
  [--baseline-manifest <baseline-evidence.json>] \
  [--design-mode A|B|C|AUTO]
```

It asks one question and then packages the answer: are this client input, this
assembled P1 artifact and this generated snapshot the same production substrate?
If they are, it publishes a workspace a human and a replaceable creative
environment can work from without receiving the repository.

| In the workspace | What it is |
|---|---|
| `source/` | The exact current experience source, read-only. A baseline to read and diff, never a second site to edit. |
| `context/` | A public projection of the client's own validated definition, from `creative:package`'s own builders. |
| `delivery/` | The nine WEB-01D artifacts, empty, for a human to fill. The only editable tree. |
| `media/` | The client's approved assets, provenance `UNCLASSIFIED_UNTIL_MEDIA_PLAN`. |
| `provider/` | What may leave the local boundary, and the preflight a human completes before any of it does. |
| `premium-workspace.json` | Identity: artifact, source set, definition and snapshot hashes. |

The command performs **no network activity of any kind**. It does not log in to,
upload to, sync with or invoke any provider. Uploading stays a human action,
taken against a manifest this command generates.

The generated public snapshot is hashed into the manifest but deliberately not
copied: it carries connector `secretReferenceId` values and lead-form
`recipientAddresses`, and a workspace is the thing an operator hands to a
creative environment.

## 2. The human work in the middle

Explore three materially different territories, prototype one Signature Slice,
red-team it, then record a Creative Gate. This is the part of the delivery the
tooling exists to serve, and it is unchanged by the bridge — see the
[operator pack](claude-design-operator-pack.md), the
[red team](creative-red-team.md) and the [Creative Gate](creative-gate.md).

Run `pnpm creative:validate <workspace>/delivery` before the gate. `creative:launch`
runs the same rules and refuses on the same problems, so a delivery that passes
validation is a delivery that will launch.

### Design modes

A creative environment is a tool, not an authority. `--design-mode` records
which one is in use so `creative:launch` can require the right evidence:

| Mode | What it means | What launch requires |
|---|---|---|
| **A** | Work done inside a design system that belongs to this client. | Provider evidence attesting `CLIENT_SCOPED`. Absence is a refusal: an unattested design system is an unknown one. |
| **B** | The exact source baseline plus public context is the bridge. | Nothing. Mode B works with no provider at all. |
| **C** | A bounded canvas or prototype proving one technique. | Nothing beyond the ordinary gate. A bounded canvas is not the complete exploration. |

`AUTO` cannot reach Mode A. A provider organisation happening to publish an
inherited design system is exactly the thing that must not be read as agreement.

## 3. `creative:launch`

```sh
pnpm creative:launch \
  --workspace <prepared-workspace> \
  --input     <same client input> \
  --artifact  <same assembled artifact> \
  --output    <empty-directory> \
  [--vendor-evidence <provider-evidence.json>]
```

This is the boundary. Everything before it is reversible — a workspace can be
deleted, a territory abandoned, an export thrown away. Everything after it
modifies the client's live `experience/` tree.

So the command re-checks rather than trusts:

- every immutable workspace file still hashes to what its manifest recorded;
- the artifact's own handoff verifier passes again;
- the live source, the artifact and the frozen baseline are still one substrate;
- the delivery still passes `creative:validate`;
- the gate is a named human's `PASS` or `PASS_WITH_NAMED_FIXES`;
- every named fix reached the handoff;
- the handoff records this workspace's artifact and source set;
- provider evidence, if any, is bound to this workspace and approved by a named
  human;
- the repository holding the client input has a **clean worktree**.

That last one matters more than it looks. The baseline is recorded from the
repository that *contains the production target*, because that is the repository
`creative:verify` diffs. Uncommitted work at launch time is indistinguishable,
later, from work the production agent did.

The pack it publishes is frozen, hashed and read-only:

```
<launch>/
  README.md
  PRODUCTION_AGENT_PROMPT.md     the brief; hand this to the agent
  production-launch.json         identities, target, boundary, integrity
  integrity.sha256               sha256sum -c proves the pack is intact
  inputs/                        the delivery, byte-for-byte as it was gated
  inputs/approved-visual/        approved visual and motion artifacts, when supplied
  evidence-index.json            evidence that exists, evidence production owes
```

### Approved visual and motion authority

When provider evidence declares an item with `VISUAL_AUTHORITY` or
`MOTION_AUTHORITY`, the launch **carries the artifact itself** — copied into
`inputs/approved-visual/`, hashed into `integrity.sha256`, listed in the agent's
read order beside the gate that approved it, and bound in `production-launch.json`
under `provider.approvedAuthorities` by pack path and digest.

An item claiming that authority must name a real file whose digest matches, or the
launch refuses `VISUAL_AUTHORITY_UNREADABLE`. An approved visual the agent cannot
open is not an authority, and describing one in a manifest is what allowed a
redesign to be approved and then not built.

The brief distinguishes prototype code from approved composition. Read the
[authority model](authority-model.md) before writing provider evidence.

It records a location, never the machine it was produced on: an absolute path in
a launch manifest is refused by the contract rather than trimmed.

## 4. Production

A fresh agent reads `PRODUCTION_AGENT_PROMPT.md` and implements the approved
delta in the same client's live `experience/` tree. There is no second website:
the workspace `source/` is a read-only baseline, and the launch pack carries no
editable production source.

The boundary the prompt states, and `creative:verify` enforces:

| May change | May not change |
|---|---|
| `<input>/experience/**` | P1 Factory packages and the managed-web runtime |
| Client-local colocated tests | Root dependency, lockfile, tooling or CI configuration |
| The handoff's `## Translation delta` | Any other client's input, source or media |
| A promotion-ledger row, client-local | `client-website.json` — business truth is an input, never an output |
| | Routes, connectors, recipients, secrets, entitlements, deployment configuration |
| | Shared or global design system resources |
| | Provider runtime, SDK or embed code |
| | New remote fonts, remote CSS, network requests, storage, eval, server code |
| | Promotion into Core |

See the [production translation runbook](production-translation-runbook.md) for
how to build the intent rather than trace the picture, and for the stop
conditions. A stopped run records the exact contradiction and the smallest next
decision; it does not invent a workaround that weakens the boundary.

## 5. `creative:verify`

```sh
pnpm creative:verify \
  --launch    <launch-pack> \
  --workspace <same workspace> \
  --input     <same client input> \
  --candidate <revision> \
  --output    <empty-directory> \
  [--evidence <candidate-evidence.json>]
```

Two kinds of failure, and the difference is deliberate.

**Refused, with no output written** — the candidate is outside the boundary and
there is nothing yet for a human to review:

`LAUNCH_TAMPERED`, `CANDIDATE_REVISION_INVALID`, `WORKTREE_DIRTY`,
`BUSINESS_TRUTH_DRIFT`, `DEPENDENCY_DRIFT`, `PRODUCTION_SCOPE_ESCAPE`,
`UNEXPECTED_CHANGE_SCOPE`, `ARTIFACT_MISMATCH`.

**Reported as `result: FAIL`, with a full report and a non-zero exit** — the
candidate is inside the boundary but an objective check failed. That is a
reviewable outcome, and hiding it behind a refusal would throw away the evidence
that says why: a failing standing gate, missing viewport coverage, no designed
reduced-motion state, an unfilled Translation delta, a handoff rewritten during
implementation, a failing accessibility or runtime observation.

What it publishes:

```
<report>/
  OBJECTIVE_VALIDATION_REPORT.md      the readable report
  objective-validation-report.json    the same content, machine-readable
  final-creative-gate.md              blank, writable, for a named human
  evidence/                           captures, copied and hash-verified
  logs/                               every standing gate this run executed
  integrity.sha256
```

The report records what was measured. It has no field for a verdict on the work,
and the contract refuses one if a future edit tries to add it. `humanCreativeDecision`
is permanently `REQUIRED_SEPARATELY`.

### Evidence

Absent evidence is a **failure**, not an assumption. A reviewer looking at a
report with no mobile captures must see a failing check, not a silent gap that
reads as approval.

Coverage is measured against the routes the experience manifest declares, not
against the routes someone happened to capture — four widths on one route and
nothing else is the exact gap the check exists to find. See the
[evidence protocol](evidence-protocol.md) for what to capture and how it binds.

### Interaction evidence

A pointer-sensitive control — one that captures the pointer, drags, swipes, hovers
or scrubs — must be evidenced through a **real pointer sequence**. A synthetic
`element.click()` dispatches an event directly and never exercises hit-testing or
pointer capture, so it cannot show the control is reachable by a pointer; a
collection plate that held capture from `pointerdown` was unclickable and shipped
through a full evidence pass for exactly that reason.

`creative:verify` reports `evidence.interaction` and `evidence.pointer-input`. An
honest record of insufficient evidence is well-formed and fails the report, naming
the control — the failure is visible rather than refused, because the delivery is
inside its boundary and a reviewer needs to see which control is unproven.

This adds no browser-testing framework. The requirement is on the evidence a
delivery submits.

## 6. The ship gate

`creative:verify` emits `final-creative-gate.md` blank, with only the fields a
machine can know filled in: the client, the candidate revision, and the SHA-256
of the exact report the decision is made against. It is the one writable file in
the output.

`decision` and `decided_by` stay empty, and `creative:validate` refuses a
non-human decider on it — the same rule, for the same reason, as the Creative
Gate. An agent cannot pass its own work at either end.

## The refusal vocabulary

Every failure these commands report is a named code from a closed list in
`scripts/creative/premium-contracts.mjs`. A new failure mode cannot be
introduced without also being named, which is why the negative tests can assert
on codes and this document can list them.

Read a refusal as an instruction: it names the file, the field and the next
action, because the intended operator is a Digital Experience specialist who
does not write source.

## What these commands will not do

1. **Upload anything.** No provider is logged into, uploaded to, synced with or
   invoked. `provider/upload-inventory.json` describes what *may* leave; a human
   decides whether it does.
2. **Start an agent.** `creative:launch` publishes a brief. Handing it over is a
   human act.
3. **Overwrite an output.** Reusing an output directory is how one run's evidence
   quietly becomes another run's, so it is refused. Every publication is atomic:
   built in a sibling temporary directory and renamed into place, or not created
   at all.
4. **Modify production source.** `creative:verify` reads. It never edits source
   or evidence to make a check pass.
5. **Judge the work.** Twice over, structurally: the gate at each end is a named
   human's, and the report has no field for a verdict.
