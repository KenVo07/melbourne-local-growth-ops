# WEB-01B v2 — durable implementation state

> Continuation file for the WEB-01B v2 Premium Website Platform implementation.
> A fresh agent session must be able to resume from this file plus Git history
> plus the handoff package. Keep it current; do not create a second handoff file.

Last updated: 2026-08-17 (Phases 0-2 complete; Phase 3 starting)

## Workspace paths

| Thing | Path |
|---|---|
| Workspace root | `/home/khoa/Projects/web01b-implementation` |
| Repository | `/home/khoa/Projects/web01b-implementation/proportion-web-platform` |
| Handoff package | `/home/khoa/Projects/web01b-implementation/inputs/WEB01B_V2_PRO_REASONING_OUTPUT` |
| Scratch/logs | `/tmp/claude-1000/-home-khoa-Projects-web01b-implementation/a9b49ed7-d95e-4ff8-b7f8-a55313855b44/scratchpad` |

**Toolchain:** the repo pins Node `24.18.0` / pnpm `11.9.0` (`package.json` engines,
`.nvmrc`, CI). The login shell defaults to Node v22. Every command must be run with:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
```

## Source state

| Field | Value |
|---|---|
| Branch | `feature/web-01b-premium-experience` |
| HEAD at session start | `99df6c2450d940f922ee34600c44098511510b73` (v1 candidate) |
| HEAD now | `265fb15` — see Git section |
| v1 safety ref | local branch `archive/web01b-v1-99df6c2` → `99df6c2…` (created, not pushed) |
| `origin/main` | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` |
| Draft PR | #14 (untouched) |
| Drift vs source lock | **none** — HEAD, origin/main, branch all match `01_SOURCE_LOCK.md` exactly |
| Worktree | clean except this state file |

## Execution state

Runbook: `17_IMPLEMENTATION_RUNBOOK.md` (authoritative phase order).

| Phase | Status |
|---|---|
| 0 — source/safety preflight + baseline | **COMPLETE** |
| 1 — freeze architecture in repo docs | **COMPLETE** (commit `482e9bb`; independent review findings all resolved) |
| 2 — pure site-core v2 contracts | **COMPLETE** (commit `265fb15`) |
| 3 — carry v2 data through generation | **IN PROGRESS** |
| 4 — trusted source-policy scanner | not started |
| 5 — public runtime contract + registry | not started |
| 6 — static multi-route App Router | not started |
| 7 — Projects + client-owned media | not started |
| 8 — standalone artifact generation | not started |
| 9 — multi-route Foundation Search | not started |
| 10 — optional motion substrate | not started |
| 11 — production Signature Slice + Creative Gate | not started |
| 12 — full proof, artifacts, deploy, acceptance | not started |

### Phase 2 subtask ledger — DONE

- [x] 2.1 copy GREEN site-core candidates
- [x] 2.2 reconcile the duplicated section-text projection into one exported
      `sectionSearchText` in `foundation-search.ts`
- [x] 2.3 patch 0008 — additive stable `serviceId`, duplicate-ID validation,
      `serviceItemById` / `stableServiceIds`, `validateServicePageCoverage`
- [x] 2.4 export every new contract from `packages/site-core/src/index.ts`
- [x] 2.5 contracts build, site-core test/typecheck/build, full `pnpm check`
- [x] 2.6 adversarial coverage sweep (see Validation)
- [x] 2.7 commit `265fb15`

### Phase 3 subtask ledger — CURRENT

Goal: carry validated v2 data through definition → composition → snapshot →
provenance while keeping the legacy adapter byte-compatible.

- [ ] **CURRENT** 3.1 read `managed-composition.ts`, `generation/types.ts`,
      `generation/generate-client-website.ts` and their tests before editing
- [ ] 3.2 additive definition inputs: `schemaVersion: 1 | 2`, `pageGraph`,
      `projects`, `clientExperience` (raw fixed reference only). Validate the raw
      reference with `client-experience-reference.ts`; the CLI/assembler loads the
      real manifest from `<input>/experience/manifest.json` and passes it in as
      `clientExperienceManifest`. Never pass a path string into the pure validator.
- [ ] 3.3 deterministic validation order: runtime config → profile → v1
      experience → page graph → projects → manifest → cross-reference → search →
      assets/modules/templates
- [ ] 3.4 compatibility: v1+no v2 fields = legacy; v1+any v2 field = fail;
      v2 complete = authored; v2 partial = fail; unknown version = fail;
      malformed v2 must never fall back; v1 snapshot stays semantically unchanged
- [ ] 3.5 snapshot/provenance: page graph, projects, media, manifest identity,
      `renderingMode: LEGACY_SHELL | AUTHORED_CLIENT_EXPERIENCE`, route-aware
      search records, source hashes after assembly
- [ ] 3.6 gate: site-core + managed-web test/typecheck, then commit

## Implementation decisions applied

1. **Five-layer architecture** (Kernel / Semantic Model + Page Graph /
   Primitives / trusted authored Client Experience / Standalone artifact).
   Design DNA governs the authored experience; it is not the whole frontend.
2. **Security split preserved verbatim:** untrusted configured data is validated
   non-executable data and may reference authored source *only* through the fixed
   literal path `experience/manifest.json`; trusted authored source is legal only
   under the fixed `experience/` root subject to inspection, dependency
   governance, hashing and no private-Factory dependency at handoff.
3. **`schemaVersion` 1/2 discriminator.** v1 = legacy one-page adapter; v2
   requires pageGraph + projects + resolved manifest together. Partial v2 fails;
   unknown version fails closed; no silent downgrade.
4. **Stable service IDs are additive and optional** (patch 0008). Legacy
   Contractor profiles without `serviceId` still validate and render the one-page
   shell. v2 `SERVICE_DETAIL` pages require an exact ID. Title/slug matching is
   not implemented anywhere — deliberately.

### Adaptations relative to the reasoning package

| # | Change | Reason |
|---|---|---|
| A1 | `validateWebsiteV2Model` gained a required `profile` input for v2 | Patch 0008 requires SERVICE_DETAIL→serviceId cross-validation, which needs validated profile content. The prebuilt candidate had no service coverage check at all. |
| A2 | `WebsiteServiceItemSchema` introduced; SERVICES uses it instead of the shared `titledItemSchema` | Patch 0008 §"Smallest compatible change" item 3: the ID must apply to SERVICES only, not every titled list (PROCESS/EVENTS/COLLECTIONS keep `titledItemSchema`). |

### Defects found in prebuilt candidates

| Defect | Status |
|---|---|
| `page-graph.ts` `navigationHref()` returned a bare `#anchor` for home-page anchor targets. Navigation renders on every route, so it would resolve against the current page. | **FIXED** — now `/#anchor`; test updated to assert the corrected behavior |
| `page-graph.ts` lost discriminated-union narrowing inside the navigation anchor closure (TS2339). | **FIXED** — target extracted to a local before the closure |
| `page-graph.test.ts` referenced an undefined `graphFixture()`. | **FIXED** — uses `validGraph()` |
| `page-graph-search.ts` duplicated the profile-section text projection from `foundation-search.ts`. | **FIXED** — one exported `sectionSearchText`, consumed by both paths |
| `page-graph-search.ts` projected the bare `serviceId` string as SERVICE page content. | **FIXED** — resolves the service title/description via `serviceItemById` |
| `website-v2-model.ts` had no service-page cross-validation at all. | **FIXED** — `validateServicePageCoverage` (adaptation A1) |
| `route-metadata-model.ts` emits `https://host` with no trailing slash for the root canonical URL. | **OPEN** — reconcile against `structured-data.ts` in Phase 6 |

### Independent doc review (Phase 1) — all findings resolved

| Finding | Resolution |
|---|---|
| BLOCKER: `current-architecture.md` described unbuilt v2 runtime in present tense, and its own title makes it an as-built document | Reverted the component-seams table to as-built wording and put every v2 section under an explicit "Target architecture — in progress, not yet as-built" banner listing exactly what is true today. **Remove that banner in Phase 12 once the runtime ships.** |
| MAJOR: the authored-source deny-list differed between two docs (`new Function` and cookies were missing from one) | `current-architecture.md` now points at the standard as the single source of truth instead of restating a shorter list |
| MAJOR: "governance-approved" dependencies were never linked to the real register | Both `boundaries.md` and `current-architecture.md` now link `docs/governance/oss-adoption-register.md`. **A register entry must be seeded before any motion library is adopted in Phase 10.** |
| MINOR: Creative Contract / Gate / Proof Loop / Signature Slice / Motion Brief were load-bearing but undefined | Added glossary entries for all five |
| MINOR: `experienceRouteId` could read as a config-selected module specifier | `boundaries.md` now states explicitly that it is a bounded ID resolved only against the trusted manifest's own registered route set |

## Files

### Committed in `482e9bb` (Phase 1 docs)

```
A docs/decisions/ADR-0006-client-experience-layer.md      (verbatim GREEN copy)
A docs/product/reference-class-capability-standard.md     (verbatim GREEN copy)
M docs/architecture/boundaries.md
M docs/architecture/current-architecture.md
M docs/glossary.md
M docs/product/premium-website-experience-standard.md
```

### Committed in `265fb15` (Phase 2 contracts)

```
A packages/site-core/src/page-graph.ts                  + .test.ts
A packages/site-core/src/media-reference.ts             + .test.ts
A packages/site-core/src/project-content.ts             + .test.ts
A packages/site-core/src/client-experience-reference.ts + .test.ts
A packages/site-core/src/client-experience-manifest.ts  + .test.ts
A packages/site-core/src/client-design-dna.ts           + .test.ts
A packages/site-core/src/website-v2-model.ts            + .test.ts
A packages/site-core/src/route-metadata-model.ts        + .test.ts
A packages/site-core/src/page-graph-search.ts           + .test.ts
M packages/site-core/src/index.ts            (v2 exports)
M packages/site-core/src/profile-content.ts  (patch 0008 + helpers)
M packages/site-core/src/foundation-search.ts (export sectionSearchText)
```

### Expected to be edited next (Phase 3)

```
packages/site-core/src/managed-composition.ts        + .test.ts
apps/managed-web/src/generation/types.ts
apps/managed-web/src/generation/generate-client-website.ts
tests/integration/site-core/*.ts
```

### Prebuilt files NOT yet integrated

```
prebuilt/apps/managed-web/src/client-experience/*                            -> Phase 5
prebuilt/apps/managed-web/src/routing/*                                      -> Phase 5/6
prebuilt/apps/managed-web/src/generation/client-experience-source-policy.*   -> Phase 4
prebuilt/apps/managed-web/src/generation/client-experience-dependencies.*    -> Phase 8
prebuilt/apps/managed-web/src/generation/client-route-inventory.*            -> Phase 8
fixtures/reference-contractor/**   -> Phase 10/11 (route/data scaffold only;
                                      its placeholder JSX is NOT the design)
```

## Validation

### Phase 0 baseline — all green at `99df6c2` (2026-08-17T01:17–01:20 +10:00)

| Command | Result |
|---|---|
| `pnpm run governance:secrets` | exit 0 — 314 files scanned |
| `pnpm install --frozen-lockfile` | exit 0 |
| `pnpm run governance:audit:self-test` | exit 0 |
| `pnpm run governance:audit` | exit 0 — PASS with 3 explicit deferrals |
| `pnpm run governance:licenses` | exit 0 |
| `pnpm check` (build+test+typecheck) | exit 0 — **547 unit tests** across 9 packages |
| `pnpm --filter …/managed-web test:e2e` | exit 0 — **43 Playwright tests passed** (40.1s) |

Baseline unit-test counts: asset-pipeline 18, contracts 14, site-core 55,
deployment 73, integrations/resend 87, templates 34, ops-console 8,
website-modules/contact-form 95, managed-web 163.

Pinned versions observed: Next 16.2.12, React 19.2.8, TypeScript 7.0.2,
Zod 4.4.3, pagefind 1.5.2, @types/node 26.1.1.

**Audit deferral risk (record, do not silently ignore):** the three deferred
advisories — `GHSA-f88m-g3jw-g9cj` (sharp) and `GHSA-6g55-p6wh-862q` /
`GHSA-r28c-9q8g-f849` (postcss) — are deferred *through 2026-08-17*, which is
today. They pass now and will begin failing `governance:audit` immediately
after. Re-check before the final candidate gate and treat expiry as a real
blocker requiring an operator decision, not a rubber stamp.

### Phase 1 gate — PASS

- `governance:secrets` PASS; `git diff --check` clean; all relative doc links
  verified to resolve on disk.
- Independent adversarial doc review completed; every finding resolved (table above).

### Phase 2 gate — PASS (2026-08-17T01:36 +10:00)

| Command | Result |
|---|---|
| `pnpm --filter …/contracts build` | pass |
| `pnpm --filter …/site-core typecheck` | pass |
| `pnpm --filter …/site-core build` | pass |
| `pnpm --filter …/site-core test` | pass — **115** tests (baseline 55) |
| `pnpm check` (whole workspace) | pass — **607** tests (baseline 547) |
| `governance:secrets` | PASS — 333 files |

Runbook §2.6 adversarial coverage, all present and passing: duplicate page IDs;
duplicate paths; invalid path grammar; reserved `/api` namespace; missing home
page reference; home not at root; root page not kind HOME; parent cycles;
missing navigation page and anchor targets; duplicate navigation IDs across
groups; page-kind/content mismatch; duplicate project IDs and slugs; duplicate
story block IDs; missing/self/duplicate related projects; missing demonstration
disclosure; verified-vs-demonstration contradiction; missing informative alt;
decorative media carrying alt or caption; focal points outside 0–1; duplicate
manifest route IDs, signature IDs and dependency names; non-exact dependency
versions; client-JS/motion contradiction; legacy profile without service IDs;
duplicate service IDs; service page with an undeclared ID; no title-matching
fallback; route identity stable across a title edit; two pages competing for one
service ID; a service with no detail page; search-excluded pages omitted.

### Still required

Phases 3–12. No runtime, routing, artifact, search, motion or creative work has
been validated yet.

## Git

### Commits created so far

| SHA | Contents |
|---|---|
| `482e9bb` | `docs(web01b): lock client experience and reference-class architecture` — ADR-0006, Reference-Class standard, reconciled boundaries/current-architecture/standard/glossary |
| `265fb15` | `feat(site-core): add page graph project media and experience contracts` — nine new contract modules + tests, v2 exports, patch 0008 service IDs, two prebuilt-defect fixes |

Uncommitted right now: `WEB01B_V2_IMPLEMENTATION_STATE.md` only.

Remaining planned commit sequence (from `10_PR14_MIGRATION_STRATEGY.md`):

1. `docs(web01b): lock client experience and reference-class architecture`
2. `feat(site-core): add page graph project media and experience contracts`
3. `feat(generation): govern authored client experience source`
4. `feat(managed-web): add safe authored client experience runtime`
5. `feat(managed-web): render validated client page graphs`
6. `feat(web01b): add first-class project stories and client media`
7. `feat(handoff): export portable authored multi-route client sites`
8. `feat(search): index validated multi-route client content`
9. `feat(web01b): build reference contractor signature proof`

## Publication boundary — NOT authorized

Do **not**: modify or merge `main`; push any branch; update Draft PR #14; open
another PR; update Notion; promote a Vercel deployment to production; delete the
`archive/web01b-v1-99df6c2` safety ref. Local commits on
`feature/web-01b-premium-experience` are authorized.

## Continuation — exact next action

**Phase 3.1.** Read these before editing anything:

```
packages/site-core/src/managed-composition.ts        (composeManagedWebsite)
packages/site-core/src/managed-composition.test.ts
apps/managed-web/src/generation/types.ts             (ClientWebsiteDefinitionInput, ClientWebsiteSnapshot)
apps/managed-web/src/generation/generate-client-website.ts  (parseDefinitionInput hard-codes schemaVersion 1)
apps/managed-web/src/generation/cli.ts               (reads <input>/client-website.json)
tests/integration/site-core/foundation-search-snapshot.test.ts
tests/integration/site-core/client-artifact-assembly.test.ts
```

Then implement Phase 3.2–3.6 per the ledger above, following
`patches/0002-definition-snapshot-integration.md` and
`patches/0006-legacy-compatibility.md` as recipes (AMBER — validate against live
source, do not apply blindly).

Recommended commands:

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /home/khoa/Projects/web01b-implementation/proportion-web-platform
pnpm --filter @melbourne-local-growth-ops/site-core test
pnpm --filter @melbourne-local-growth-ops/site-core typecheck
pnpm --filter @melbourne-local-growth-ops/managed-web test
pnpm --filter @melbourne-local-growth-ops/managed-web typecheck
```

Full `pnpm check` takes ~55s and `test:e2e` ~85s; use them at phase boundaries,
not after every edit.

## Deferred obligations — do not lose these

1. **Remove the "not yet as-built" banner** in `docs/architecture/current-architecture.md`
   once the v2 runtime actually ships (Phase 12), and restore the v2 wording in the
   component-seams table at the same time.
2. **Seed an OSS adoption register entry** in `docs/governance/oss-adoption-register.md`
   before adopting any motion library (Phase 10).
3. **Re-check the three deferred advisories** — they expire 2026-08-17 (today).
4. **Reconcile the root canonical URL** form between `route-metadata-model.ts` and
   `structured-data.ts` (Phase 6).
5. **Fill `15_ACCEPTANCE_MATRIX.md`** for the exact final candidate (Phase 12).
