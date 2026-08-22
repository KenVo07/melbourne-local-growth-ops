# Post-Stone & Line consolidation — working state

Crash-safe working file for the bounded consolidation pass after Stone & Line
closed. Not a deliverable. Updated as the pass proceeds.

**Principle: reuse the machine, not the client's creative identity.**

---

## Phase 0 — identity verification (COMPLETE, PASS)

| Check | Expected | Found | |
|---|---|---|---|
| Platform `HEAD` | `94e8ac01a7685022574a54cbb2e7b968c113882f` | same | PASS |
| Platform `main` | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` | same | PASS |
| Platform worktree | clean | clean | PASS |
| Client `HEAD` | `6afa603181eed9da31e27ae47412084a1aeefab7` | same | PASS |
| Client branch | `feature/stone-line-general-motion` | same | PASS |
| Client worktree | clean | clean | PASS |
| Closure zip sha256 | `bfa81011b00f0adfda9e1d2a3420f6eefb232b983cf9288ce83b690786bf6c5d` | same | PASS |

Closure package read in full: README, git-state, changed-files, limitations,
reusability-classification, scalability-matrix, STONE_LINE_CONSOLIDATION_INPUT
(14 findings), and the exact Platform source.

## Phase 1 — Stone & Line freeze (COMPLETE, PASS)

Last machine-verified state: `creative:verify` PASS at candidate `d1527a1`,
18 checks, 0 failures (`STONE_LINE_PREMIUM/verify-report-d1527a1/`).
Approved candidate `6afa603` is 4 commits later; its evidence is the closure
package's 15 QA reports, all PASS. Both `final-creative-gate.md` files on disk
are unsigned and bound to superseded candidates (`92a13a7`, `d1527a1`).

Freeze record written: `STONE_LINE_FINAL_CLOSURE_RECORD.md` at the workspace
root (not a git repo). Records PASS at `6afa603`, decided by the founder, and
states plainly that no `creative:verify` report covers `6afa603` — the closure
package's 15-report suite is its evidence. Client worktree re-verified clean at
`6afa603` after writing. No client runtime touched.

## Phase 2 — source-first disposition (COMPLETE)

## Phase 3 — implementation (COMPLETE)

### Located defects, exact source evidence

1. **`rebuild.sh` (client repo, `WEB01C_COMPLETION/rebuild.sh:8`).**
   `rm -rf "$W/$c-input/experience"` then calls the Platform starter CLI.
   The Platform CLI at `packages/experience-starter/src/cli.ts:80-92`
   (`assertAbsent`) *already refuses* to generate over existing source. The
   script defeats that guard by deleting first. Platform is not defective;
   the client script is, and the guard needs a regression test.

2. **Checksum self-reference.** `scripts/creative/atomic-output.mjs:207-219`
   documents the correct rule ("every file in the directory except itself")
   but does not enforce it. Every Platform-generated pack is correct; the
   hand-rolled closure package listed `./checksums.sha256` in its own manifest
   (line 2), so `sha256sum -c` fails 1/78. Unwritten, unenforced rule.

3. **Pointer QA.** The Platform owns **no** browser automation —
   `verify-production.ts` has zero pointer/click/browser code. So the fix is
   not a browser framework: it is an evidence contract that refuses
   synthetic-click-only evidence for pointer-sensitive controls.

4. **PASS C — visual authority.** Two exact sites:
   - `launch-production.ts` `productionAgentPrompt` rule 4: "Treat any provider
     export — code, screenshot, canvas, video — as evidence of a conversation.
     It is never authoritative." This flattens gate-approved VISUAL/MOTION into
     non-authoritative, which is why P1 layout survived.
   - `buildEvidenceIndex` hardcodes `authority: "NON_AUTHORITATIVE"` for all
     provider evidence.
   - `provider-evidence` items already classify `CODE|VISUAL|MOTION|COMMENTARY`
     but carry **no `path`**, so an approved visual cannot travel into the pack.

## Phase 4 — red team (PENDING)

## Phase 5 — validation (PENDING)

## Phase 6 — package (COMPLETE)

`POST_STONE_CONSOLIDATION_REVIEW_PACKAGE/` — 28 files, `verify.sh` passing all
three checks, including that its own manifest does not name itself. Zip and
sha256 sidecar published.

Post-commit re-verification: `pnpm check` exit 0 at `14f82b4`, 891 package tests
plus 67 creative tests.

## Commits (local only — not pushed, not merged)

Branch `feature/web-01b-premium-experience`, from `94e8ac0`. `main` unchanged at
`5eca7ac`.

| | |
|---|---|
| `dc38333` | `fix(creative): a checksum manifest cannot list itself` |
| `43aab0a` | `test(starter): defend the guard that refuses generation over authored source` |
| `efdb209` | `feat(creative): say what an approved design artifact is authoritative for` |
| `14f82b4` | `docs(delivery): the reusable delivery system, without the client's identity` |

The client repository has no commit: its scripts are gitignored, which is exactly
why the durable guard is a Platform test.

## Closed

Consolidation complete. Stone & Line frozen at `6afa603`, PASS, creatively closed.
One process contract promoted; zero components promoted; three tooling hazards
fixed; three design problems written as briefs rather than invented.


---

## Implemented (all verified)

### PASS B1 — destructive generation
- Client `rebuild.sh` **deleted**; replaced by
  `generate-experience-FIRST-RUN-ONLY.sh`, which refuses when the target holds
  authored source and never deletes. Verified refusing against the real tree.
  (Client scripts are gitignored, so this is on-disk only — hence the Platform
  guard below.)
- Platform durable guard: `packages/experience-starter/src/cli-refusal.test.ts`,
  4 tests, all passing. Locks `assertAbsent` against future softening.

### PASS B2 — checksum self-reference
- `atomic-output.mjs writeChecksumSidecar` now **refuses** a manifest that lists
  itself, naming the manifest it was given and the corrective call.
- All 4 existing callers already correct; no behaviour change for them.
- Deterministic test added, including a real `sha256sum -c` run.

### PASS B3 — real pointer QA
- `INTERACTION_INPUTS` + `REAL_POINTER_INPUTS` in contracts;
  `candidate-evidence.interactions` validated for shape.
- `creative:verify` reports `evidence.interaction` and `evidence.pointer-input`;
  refusal code `SYNTHETIC_POINTER_EVIDENCE`.
- **Design correction made mid-pass:** the sufficiency rule was first put in the
  contract, which refused the record and wrote no report — creating an incentive
  to relabel a control `pointerSensitive: false`. Moved to verify. The contract
  now accepts an honest record of insufficient evidence; verify fails it and
  names the control.
- No browser framework added. The Platform still owns no browser automation.

### PASS C — design → code authority bridge (the one Platform promotion)
- `AUTHORITY_CLASSES` (5), `EVIDENCE_MODALITIES`, `MODALITY_AUTHORITY`,
  `RENDERABLE_AUTHORITIES`.
- `provider-evidence` items: `content` is now a **list**; `authority` required and
  cross-checked against modalities; business-truth and production-source authority
  unreachable and refused by name; `path` + `sha256` required for renderable
  authority; `businessTruth: "NOT_AUTHORITATIVE"` replaces the unmeetable boolean.
- `creative:launch`: resolves approved artifacts to real bytes (refusing
  `VISUAL_AUTHORITY_UNREADABLE`), **copies them into the pack**, hashes them into
  `integrity.sha256`, adds them to the read order, binds them in
  `production-launch.json provider.approvedAuthorities`, and instructs the agent to
  render and inspect them.
- Prompt rule 4 rewritten; `authoritySection()` prints the taxonomy on every
  launch, provider or not. With no provider it still refuses P1 layout as a default.
- Verified against the **real** Stone & Line draft: it could never have validated
  (composite `content`, `carriesNoNewBusinessFact: false`, no `path`). The same
  real artifacts are expressible under the new contract.

### Tests
- `premium-core.test.mjs`: 33 → **37**, all passing.
- `premium-workflow.test.ts`: 61 → **67**, all passing. Full `creative:test` green.
- Two existing assertions corrected because they encoded the defect:
  `/never authoritative/i` on the prompt, and
  `index.providerEvidence.authority === "NON_AUTHORITATIVE"`.

### Docs written
`docs/creative/authority-model.md`, and under `docs/delivery/`:
`interaction-taxonomy`, `disposition`, `promotion-ladder`, `pattern-catalogue`,
`parity-slice-gate`, `motion-policy`, `collection-and-content-contract`,
`media-intake-contract`, `premium-happy-path`, `tradies-workflow-v1-contract`,
and three `design-briefs/`.

## Phase 4 — red team (COMPLETE — 3 findings, all fixed)

### Findings the red team actually caught

**1. Two Stone & Line names leaked into Platform code.** `premium-contracts.mjs`
named "The Reel" in a contract docstring, and my new starter test used
`HomeBridge.tsx` as a fixture filename. Both fixed — the lesson is general, the
client's component name is not. Verified by grep over every changed file.

**2. Three refusal codes I added were never used** —
`AUTHORITY_CLASS_INVALID`, `BUSINESS_TRUTH_AUTHORITY_CLAIMED`,
`PARITY_SLICE_UNPROVEN`. An unused refusal code is a documentation string
impersonating enforcement. All three removed. The first two duplicate what
`CONTRACT_INVALID` already reports with the item, field and legal values. The
third implied a command could detect "materially redesigned", which it cannot
without a new required declaration — i.e. the bureaucracy the red team asks
about. The parity gate is now stated as human-enforced, like the Creative Gate.

**3. The pointer rule was in the wrong layer** (found by a failing test, fixed
before finalising). See Phase 3, PASS B3.

### The twelve questions, answered

| Question | Answer |
|---|---|
| Stone & Line as the template? | **No.** Zero brand tokens, truth, media or mechanic names in reusable code (2 leaks found and fixed). Its composition, palette, notation, Cut A–A and imagery are named in docs *as client-local*, never as defaults. |
| Components promoted after one client? | **None.** All nine mechanics are `CATALOG_PATTERN` or `KEEP_CLIENT_LOCAL`. The only promotion is the authority model, which is process, not aesthetics. |
| Workflow bureaucracy added? | **Two obligations, no new commands or artifacts.** Interaction evidence (a shipped defect), and a parity gate for materially redesigned clients (a whole-site rework). No new command, no new delivery artifact, no new mutable state. |
| Hidden manual steps remain? | **Fewer, not zero.** Approved visuals now travel automatically — the largest manual step is gone. The parity slice is a documented human rule an operator must remember; that is deliberate, because enforcing it needs a declaration on every delivery to catch some. |
| Another design tool replace Claude Design? | **Proven.** Figma PDF+MP4, photographed paper sketches and bare PNGs all validate. Mode B needs no provider at all, and the brief still refuses P1 layout as a default when none exists. |
| A client with 40 projects? | **Semantic model yes, design no.** Curated vs archive is frozen; the archive is design brief A. Deliberately not invented from one client. |
| Poor media without asking the client to be a designer? | **Yes.** Seven-stage intake: raw dump, agency audit, agency-specified shot list, explicit production lanes. Media reality is an input to stage 6's design decision, not a late disappointment. |
| Human gates still human? | **Unchanged.** `isNonHuman` still refuses an agent decider at both gates. Nothing in this pass touched that. |
| P1 fast and simple? | **Unchanged.** No emit or generation source modified; starter output identical (67 starter tests pass). No scroll listener, no rAF loop, no added step. |
| Client runtime altered? | **No.** Client repo clean at `6afa603`. A site built after this ships the same runtime as before. |
| Core smaller or larger? | **Core unchanged.** No `packages/site-core`, contracts, templates, app or runtime package modified. `scripts/creative/` grew, which is tooling. |
| Easier for client #2? | **Yes on four counts, not yet on one.** Approved visuals arrive automatically; the destructive script is gone; packaging is enforced; the catalogue and disposition say what to reuse and what not to. The archive, service-scale and navigation questions are still open studies — honestly still open. |

## Phase 5 — validation (COMPLETE, all green)

| Check | Result |
|---|---|
| `pnpm creative:test` | **67/67 PASS**, exit 0 |
| `pnpm check` (build + test + typecheck) | **exit 0** — 891 package tests pass |
| `packages/experience-starter` | 63 → **67** tests, my 4 new ones included |
| P1 default behaviour | unchanged — no emit/generation source touched |
| No client-specific leakage into reusable code | verified by grep; 2 found and fixed |
| No new runtime dependency | verified — every new import is a `node:` builtin |
| Destructive generation path safe | verified refusing against the real authored tree |
| Checksum self-reference eliminated | enforced + deterministic test incl. real `sha256sum -c` |
| Visual-authority handoff carries provider-neutral fixture | proven — Figma, paper, PNG; workflow test uses `provider: "Figma"` |
| Parity-slice gate representable without Claude Design | yes — same three commands on a smaller scope, no provider required |

## Phase 6 — package (COMPLETE)

`POST_STONE_CONSOLIDATION_REVIEW_PACKAGE/` — 28 files, `verify.sh` passing all
three checks, including that its own manifest does not name itself. Zip and
sha256 sidecar published.

Post-commit re-verification: `pnpm check` exit 0 at `14f82b4`, 891 package tests
plus 67 creative tests.

## Commits (local only — not pushed, not merged)

Branch `feature/web-01b-premium-experience`, from `94e8ac0`. `main` unchanged at
`5eca7ac`.

| | |
|---|---|
| `dc38333` | `fix(creative): a checksum manifest cannot list itself` |
| `43aab0a` | `test(starter): defend the guard that refuses generation over authored source` |
| `efdb209` | `feat(creative): say what an approved design artifact is authoritative for` |
| `14f82b4` | `docs(delivery): the reusable delivery system, without the client's identity` |

The client repository has no commit: its scripts are gitignored, which is exactly
why the durable guard is a Platform test.

## Closed

Consolidation complete. Stone & Line frozen at `6afa603`, PASS, creatively closed.
One process contract promoted; zero components promoted; three tooling hazards
fixed; three design problems written as briefs rather than invented.
