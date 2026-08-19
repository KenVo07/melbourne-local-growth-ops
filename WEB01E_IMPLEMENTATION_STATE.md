# WEB-01E implementation state

The premium creative orchestrator (`creative:prepare` → `creative:launch` →
`creative:verify`) built as a thin bridge over the existing WEB-01D creative
layer and the P1 Factory. This file is crash-recovery bookkeeping: it records
what is proven, what is in flight, and the exact next action, so the work is
resumable from Git alone.

## Source lock

| Fact | Value |
|---|---|
| Branch | `feature/web-01b-premium-experience` |
| Starting SHA (WEB-01E base) | `3024fe4d9a296a50d760250347b3600ea75e960c` |
| Recovered HEAD | `53c61a156f90b41e0dbd8632180e336a1061cf1f` |
| `main` (unchanged) | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` |
| Worktree at recovery | Dirty — 2 modified files, valid in-flight Phase 4 work (below) |
| `SOURCE_CONTRADICTIONS.md` | Absent. The live source did not contradict the locked package. |

Recovery context: the first implementation run was interrupted when the session
allowance was exhausted. No state file had been written yet, so this state was
reconstructed from the four local commits, the working diff, the implementation
matrix and the current source.

## Local WEB-01E commits

| SHA | Subject | Files | Lines |
|---|---|---|---|
| `fb4f63d` | refactor(creative): make the context and scaffold builders importable | 2 | +75 / −40 |
| `9d9b70d` | feat(creative): add the premium bridge's identity, contract and atomicity core | 5 | +2534 / −1 |
| `36f8958` | feat(creative): add creative:prepare, the source-bound premium workspace | 8 | +2478 / −6 |
| `53c61a1` | feat(creative): bind the production handoff to source and add the ship gate | 6 | +597 / −25 |

## Phase state

| Phase | State | Evidence |
|---|---|---|
| 0 source-lock / contradiction check | DONE | Branch, HEAD, main verified; no `SOURCE_CONTRADICTIONS.md` was needed. |
| 1 expose WEB-01D helpers | DONE | `fb4f63d` exports `buildContext`/`packageCreativeContext` and `emitCreativeArtifacts`, CLI side effects guarded. Root alias `creative:prepare` added; `creative:launch` and `creative:verify` aliases still outstanding (Phase 5/6 land them with their commands). |
| 2 identity, contracts, atomicity | DONE | `source-binding-core.mjs`, `atomic-output.mjs`, `premium-contracts.mjs`, `source-binding.ts`, `premium-core.test.mjs` (37 passing). |
| 3 `creative:prepare` | DONE | `prepare-premium.ts`, `premium-cli.ts`, `premium-workflow.test.ts` (18 passing, incl. stale/foreign/tamper/secret/baseline/no-overwrite/no-network). |
| 4 handoff and provider preflight | DONE | `artifact-model.mjs` production-handoff extension + `final-creative-gate` kind, both templates, `validate-core.mjs` rules, `self-test.mjs` fail-capable cases. The recovered working diff completed it by attaching refusal codes to the shared validator. |
| 5 `creative:launch` | DONE | `launch-production.ts` + `creative:launch` alias. 23 new workflow tests: success, portability, fresh-agent prompt, stale source, tampered baseline, dirty worktree, failed/agent gate, missing named fix, missing WHY, forbidden home, reduced motion, source mismatch, foreign client, missing translation-delta heading, media claim, non-empty output, provider binding/attestation/approval, no network. |
| 6 `creative:verify` | DONE | `verify-production.ts` + `creative:verify` alias + the `candidate-evidence` contract. 20 new tests: controlled delta PASS, no-verdict report, blank ship gate, missing mobile/reduced-motion/absent evidence, failing runtime, unfilled and rewritten handoff, P1 escape, business-truth drift, dependency drift, unrelated/unknown revision, tampered launch, workspace mismatch, standing-gate pass/fail, output integrity, non-empty output. |
| 7 docs / operator polish | NOT STARTED | `docs/creative/premium-workflow.md` absent although `prepare-premium.ts` and `premium-contracts.mjs` already cite it. Operator pack, red team, translation runbook, evidence protocol, delivery system and README all still at their WEB-01D revisions. |
| 8 adversarial + clean-room proof | NOT STARTED | No review package directory, ZIP or checksum sidecar exists. |

## Recovered working diff (preserved, not discarded)

`scripts/creative/artifact-model.mjs` and `scripts/creative/validate-core.mjs`
carried uncommitted work at recovery: a `sectionCodes` table on the
production-handoff definition, and an optional third `code` argument threaded
through `validateArtifacts`'s `fail()`. This is the seam `creative:launch` needs
so it can refuse with an exact code from the premium vocabulary without keeping
a second copy of the handoff rules. It was valid, coherent, tested work; it was
completed and committed rather than reset.

## Proof state

Re-run at recovery and green (Node 24.18.0 via nvm), with the working diff applied:

- `pnpm creative:test` — 99 passing (38 core + 61 workflow), 0 failing.
- `pnpm creative:validate:self-test` — PASS.
- `git diff --exit-code -- pnpm-lock.yaml` — unchanged.

Not yet run in this run: `pnpm check`, managed-web e2e, ordinary client
assembly, the launch/verify negative matrix (their commands do not exist yet),
and the clean-room package proof.

Artifacts generated so far: none outside the repository. No workspace, launch
pack, objective report or review package has been produced.

## Non-actions held throughout

No push, no merge, no change to `main`, no PR #14 mutation, no Notion update, no
provider network call, no live Claude Design session, no Stone & Line production
implementation, no real Proportion creative work, no dependency or lockfile
change.

## P1 observation recorded during Phase 6

The P1 assembly is **not byte-reproducible**. Two assemblies of identical client
source at the same Factory revision produce different artifact ids, because the
generated Pagefind index carries run-varying filenames and content
(`source/public/pagefind/*.pf_filter`, `*.pf_meta`, `pagefind-entry.json`),
which flows into the artifact's file inventory and therefore into `artifactId`.

This is pre-existing P1 behaviour, not something WEB-01E introduced, and P1 was
not modified. It is recorded because it is the reason `creative:verify` binds
candidate evidence to **source set plus candidate revision** rather than to
`artifactId`: an artifact-id binding would fail honest evidence and train an
operator to recapture until it passed, which is precisely how a real
"captures of a previous build" failure would stop being noticed.

`creative:prepare` and `creative:launch` are unaffected — both compare a *given*
artifact against live source and never re-assemble.

## First incomplete acceptance requirement

> "Final review package is validated, zipped, clean-extracted, revalidated and
> hashed." — plus the documentation rows.

Every acceptance row for prepare, launch and verify has an implementation and a
passing negative fixture.

## Next action

Phase 7: `docs/creative/premium-workflow.md`, plus the README, delivery-system,
operator-pack, translation-runbook, evidence-protocol and red-team updates.
Then Phase 8: full suites, clean-room proof and the review package.
