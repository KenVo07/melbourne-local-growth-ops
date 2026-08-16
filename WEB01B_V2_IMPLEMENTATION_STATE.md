# WEB-01B v2 — durable implementation state

> Continuation file for the WEB-01B v2 Premium Website Platform implementation.
> A fresh agent session must be able to resume from this file plus Git history
> plus the handoff package. Keep it current; do not create a second handoff file.

Last updated: 2026-08-17 (Phases 0-5 complete; **Phase 6 IN PROGRESS, 3 tests red**)

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
| HEAD now | `dcf0695` — see Git section |
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
| 3 — carry v2 data through generation | **COMPLETE** (commit `66c0c73`) |
| 4 — trusted source-policy scanner | **COMPLETE** (`99e061a`, hardened by `dcf0695` after adversarial review) |
| 5 — public runtime contract + registry | **COMPLETE** (commit `cff8b13`) |
| 6 — static multi-route App Router | **IN PROGRESS — 3 artifact tests failing, see below** |
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

### Phase 3 subtask ledger — DONE

- [x] 3.1 read the live composition/generation source before editing
- [x] 3.2 additive definition inputs and fixed-reference-only manifest binding
- [x] 3.3 deterministic validation order (config → profile → v1 experience →
      page graph → projects → manifest → cross-reference → search → assets)
- [x] 3.4 compatibility matrix enforced at both the parse boundary and the pure
      validator
- [x] 3.5 snapshot/provenance additions incl. `renderingMode`
- [x] 3.6 gate + commit `66c0c73`

**Deferred out of Phase 3 on purpose:** route-aware Foundation Search record
projection. `resolveFoundationSearch` still emits legacy `/#sectionId` records.
A v2 definition that turns Search ON before Phase 9 will therefore produce
section-anchor URLs. Phase 9 replaces this; the reference fixture's
`foundationSearch` block already uses `schemaVersion: 2` + `includePageIds`,
which is not yet accepted by `FoundationSearchConfigSchema`.

### Phase 4 subtask ledger — DONE

- [x] 4.1 copy the AMBER scanner, then rewrite its parser layer (see A3 below)
- [x] 4.2 fixed inspection order established inside `inspectClientExperienceSource`.
      **Assembler wiring is deliberately deferred to Phase 8**, because copying
      needs the Phase 5/6 runtime to exist. Phase 4's gate — "no client source is
      copied until every policy test passes" — is satisfied: nothing copies yet.
- [x] 4.3 red-team suite, 39 cases, all passing
- [x] 4.4 gate + commit `99e061a`

### Phase 5 subtask ledger — DONE

- [x] 5.1 copy candidates; relocate every prebuilt test into
      `tests/integration/site-core/` (co-located tests never run here)
- [x] 5.2 sanitized public projection + secret-absence test on serialized props
- [x] 5.3 reconcile PlatformLink / PlatformImage / PlatformRegion, add PlatformAction
- [x] 5.4 `@proportion/client-experience` alias mapped in the app tsconfig
      (**portable artifact tsconfig still owes the same mapping — Phase 8**)
- [x] 5.5 gate + commit `cff8b13`

### Phase 6 subtask ledger — CURRENT

- [x] 6.1 `app/page.tsx` branches on `renderingMode`; legacy renders the existing
      shell unchanged
- [x] 6.2 `app/[...segments]/page.tsx` with `dynamicParams = false`,
      `generateStaticParams` (empty for legacy), `generateMetadata`, `notFound()`
- [x] 6.3 `app/not-found.tsx` with validated primary-navigation recovery and no
      path or internal detail leaked
- [x] 6.4 `buildManagedRouteMetadata` in `structured-data.ts`. Deferred
      obligation #4 is **RESOLVED**: `resolveCanonicalSiteUrl` already emits
      `https://host` with no trailing slash, matching `route-metadata-model.ts`.
- [x] extracted `rendering/render-region.tsx` so the legacy shell and the
      authored path share one module-slot implementation
- [x] `load-client-experience.ts` + `render-authored-page.tsx` + the fixed
      `client-experience/authored/` source slot (exports `undefined` for legacy)
- [x] added every new runtime file to the assembler's `runtimeFiles` list
- [ ] **BLOCKED HERE** 3 artifact tests red — see "Current failure" below
- [ ] 6.5 neutral functional fixture
- [ ] 6.6 production build + curl every route + 404

### Current failure — fix this first

```
pnpm --filter @melbourne-local-growth-ops/managed-web test
```

3 of 261 fail (258 pass). Typecheck is green. All three are artifact-assembly
isolation tests:

- `tests/integration/site-core/client-artifact-assembly.test.ts`
  - "does not place another client's configuration, analytics, assets, or
    identity in an artifact" — `expected '<gitignore + next.config text>' not to
    contain 'client-a'`
  - "maps without private imports into Codex B's public ClientHandoffExportInput"
- `tests/integration/web01/restaurant/restaurant-handoff.test.ts`
  - "maps without private imports into the public ClientHandoffExportInput contract"

Cause is almost certainly the `runtimeFiles` additions in
`apps/managed-web/src/generation/assemble-client-artifact.ts`: the newly copied
`src/client-experience/**` and `src/app/[...segments]/page.tsx` change the
artifact inventory that those tests assert over. Check whether the test walks
every artifact file and whether the bracketed `[...segments]` path breaks a glob
or path assumption in the copy/inventory code. Run just the one test with
`-t "another client"` and print the failing path.

Note the assembler copies the whole client-experience runtime into **every**
artifact, including legacy ones. That is intentional — these are server
components with no client chunk, and `authored/index.tsx` is a generic
placeholder — but confirm the no-global-tax bundle comparison in Phase 9 still
holds, and consider making the copy list mode-aware in Phase 8 if it does not.

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
| A3 | **Source-policy scanner reparented from the TypeScript compiler API to `@babel/parser@8.0.4`** (new MIT build-time devDependency of `apps/managed-web`) | The prebuilt candidate used `ts.createSourceFile` / `ts.forEachChild`. `typescript@7.0.2` is the native port and exposes **no standalone parser**: its `.` export is `lib/version.cjs`, and AST access requires spawning the TS server and loading a configured Project via the explicitly `unstable/*` namespace. Basing a security control on an API with no compatibility guarantee, or pinning a second TypeScript major, were both rejected. **Operator chose this option explicitly.** Recorded in `docs/governance/oss-adoption-register.md`; NOTICE regenerated; must never enter a client artifact graph. |
| A4 | Scanner rules hardened well beyond the candidate | Red-teaming found real gaps: `use server` only detected at module scope (missing the actual server-action shape inside a function body); only `process.env.X` member access detected (missing `process["env"]` and aliasing); `eval`/`require` only as bare identifiers (missing `globalThis.eval`, bare `Function()`); `document.cookie` only via a direct `document` identifier (missing `window.document.cookie`); no `innerHTML` detection; `next`/`server-only`/unprefixed Node built-ins only blocked implicitly by non-declaration, so an approval mistake would open them; no `javascript:` URL detection; legacy CSS `expression()` only matched as a property name. |
| A5 | Every prebuilt test lives in `tests/integration/site-core/`, not beside the source | The managed-web vitest config only includes `tests/integration/**`, and the app has no co-located tests. A co-located test would silently never run. |
| A6 | **The whole client-experience runtime types against `runtime-types.ts`, not site-core** | The artifact assembler vendors `contracts`, `integrations`, `resend` and `contact-form` but deliberately **not** site-core; `runtime-types.ts` is the existing dependency-free portable mirror that makes that possible. The prebuilt runtime typed itself against site-core, which would have forced site-core (and zod, and asset-pipeline) into every client artifact. v2 contracts are mirrored there instead, and `tests/integration/site-core/runtime-type-conformance.test.ts` fails typecheck if the mirror drifts — a guard v1 never had. |
| A7 | `PlatformImage` takes a media **reference**, not a pre-resolved media object | The prebuilt contract required the route to pre-resolve via `resolvePublicMedia`, which was not even exported on the public API, so authored source could not call it. |
| A8 | **`PlatformAction` added** as a fourth Platform primitive | Without it a Contractor site cannot render its own phone or booking CTA: the source policy refuses raw anchors and `PlatformLink` accepts only internal routes. It renders a validated external action by stable ID and preserves the truthful `NOT_CONFIGURED` state. |

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

### Committed in `66c0c73` (Phase 3 generation)

```
M packages/site-core/src/managed-composition.ts       (schemaVersion, renderingMode, authored fields, provenance)
M packages/site-core/src/managed-composition.test.ts  (+9 authored-composition cases)
M apps/managed-web/src/generation/types.ts            (v2 definition input + snapshot fields)
M apps/managed-web/src/generation/generate-client-website.ts
                                                      (schemaVersion 1|2 parse, manifest reference binding)
A tests/integration/site-core/authored-definition-snapshot.test.ts  (11 cases)
```

### Committed in `99e061a` (Phase 4 source policy)

```
A apps/managed-web/src/generation/client-experience-source-policy.ts
A tests/integration/site-core/client-experience-source-policy.test.ts  (39 cases)
M apps/managed-web/package.json          (@babel/parser 8.0.4 devDependency)
M pnpm-lock.yaml
M NOTICE.md                              (4 MIT Babel packages)
M docs/governance/oss-adoption-register.md  (Babel parser adoption entry)
```

### Committed in `cff8b13` + `dcf0695` (Phase 5 runtime)

```
A apps/managed-web/src/client-experience/contract.tsx
A apps/managed-web/src/client-experience/public-api.ts
A apps/managed-web/src/client-experience/registry.ts
A apps/managed-web/src/client-experience/public-projection.ts
A apps/managed-web/src/client-experience/platform-components.tsx
A apps/managed-web/src/client-experience/render-client-route.tsx
A apps/managed-web/src/client-experience/content-helpers.ts
A apps/managed-web/src/client-experience/resolve-media.ts
A apps/managed-web/src/routing/resolve-client-route.ts
M apps/managed-web/src/runtime-types.ts   (portable v2 mirror + asset manifest)
M apps/managed-web/tsconfig.json          (@proportion/client-experience alias)
A tests/integration/site-core/{platform-components,public-projection,registry,
  render-client-route,resolve-client-route,runtime-type-conformance,
  client-experience-secret-isolation}.test.ts(x)
M apps/managed-web/src/generation/client-experience-source-policy.ts (hardening)
M tests/integration/site-core/client-experience-source-policy.test.ts (59 cases)
```

### Expected to be edited next (Phase 6)

```
M apps/managed-web/src/app/page.tsx
A apps/managed-web/src/app/[...segments]/page.tsx
A apps/managed-web/src/app/not-found.tsx
A apps/managed-web/src/client-experience/load-client-experience.ts
M apps/managed-web/src/structured-data.ts
M apps/managed-web/src/client-website.ts   (load experience/manifest.json)
A apps/managed-web/client/experience/**    (neutral functional fixture)
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

### Phase 5 gate — PASS (2026-08-17T02:5x +10:00)

| Command | Result |
|---|---|
| `pnpm --filter …/managed-web typecheck` | pass |
| `pnpm --filter …/managed-web test` | pass — **261** tests |
| source-policy suite | pass — **59** cases |
| `governance:secrets` | PASS — 352 files |

### Adversarial source-policy review — all findings resolved in `dcf0695`

The reviewer executed real bypasses rather than reasoning about them. Closed:
package-subpath traversal out of the root; CSS ident escapes; `image-set()` /
`src()` remote references; `createElement("script")` and variable/namespaced JSX
tags; cast- and sequence-wrapped `eval`/`Function`/`fetch`;
`globalThis["process"]` and destructured global aliases; `document.write`,
`createContextualFragment`, `serviceWorker.register`, `new Image()` beacons,
string `setTimeout`; hard links; escaped `use server`; template/concatenated
URLs; `import.meta`.

Five false positives were also fixed, because an unusable policy gets relaxed
and a relaxed policy loses the rules above: content named `process`, self-hosted
`@font-face` and inline SVG masks, prose beginning "JavaScript:", CSS comments,
and decorated classes.

**Still open from that review:** nothing blocking. The reviewer noted the
scanner has no caller yet, so TOCTOU is not reachable; when Phase 8 wires it in,
the copy step must copy the inspected bytes or re-verify the hash, and re-check
`nlink`/`dev` at copy time.

### Phase 4 gate — PASS (2026-08-17T02:31 +10:00)

| Command | Result |
|---|---|
| source-policy red-team suite | pass — **39** cases |
| `pnpm --filter …/managed-web typecheck` | pass |
| `pnpm --filter …/managed-web test` | pass — **213** tests |
| `pnpm run governance:secrets` | PASS — 335 files |
| `pnpm run governance:licenses` | PASS after `governance:notices` regenerated NOTICE (4 MIT Babel packages added) |
| `pnpm run governance:audit` | PASS — no new advisories from the Babel subtree; still the same 3 deferrals |

An independent adversarial source-policy review is running against the committed
scanner. Treat its findings as required work before the final candidate.

### Phase 3 gate — PASS (2026-08-17T01:46 +10:00)

| Command | Result |
|---|---|
| `pnpm --filter …/site-core test` | pass — **124** tests |
| `pnpm --filter …/site-core build` | pass |
| `pnpm --filter …/managed-web typecheck` | pass |
| `pnpm --filter …/managed-web test` | pass — **174** tests |
| `governance:secrets` | PASS — 334 files |

Recipe 0002 required cases all covered: legacy fixture unchanged; valid authored
fixture; graph-only and manifest-only rejection; authored fields under
schemaVersion 1; route coverage mismatch; project reference mismatch; malformed
authored input does not fall back; deep freeze; deterministic snapshot for
identical input. Plus manifest-path tampering, missing manifest contents and
manifest contents without a reference.

### Still required

Phases 4–12. No source policy, runtime, routing, artifact, search, motion or
creative work has been validated yet.

## Git

### Commits created so far

| SHA | Contents |
|---|---|
| `482e9bb` | `docs(web01b): lock client experience and reference-class architecture` — ADR-0006, Reference-Class standard, reconciled boundaries/current-architecture/standard/glossary |
| `265fb15` | `feat(site-core): add page graph project media and experience contracts` — nine new contract modules + tests, v2 exports, patch 0008 service IDs, two prebuilt-defect fixes |
| `c701d11` | `docs(web01b): add durable v2 implementation state file` |
| `66c0c73` | `feat(web01b): carry page graph projects and authored experience provenance` — composition/snapshot/provenance rendering-mode dispatch and the schemaVersion 1/2 parse boundary |
| `185f584` | `docs(web01b): checkpoint implementation state after phase 3` |
| `99e061a` | `feat(generation): govern authored client experience source` — Babel-based source-policy scanner, 39-case red-team suite, `@babel/parser` devDependency + OSS register entry + NOTICE |
| `45a1c9a` | `docs(web01b): checkpoint implementation state after phase 4` |
| `cff8b13` | `feat(managed-web): add safe authored client experience runtime` — contract, registry, public projection, Platform components incl. Action, media resolution, content helpers, portable type mirror + conformance test, alias mapping, secret-isolation test |
| `dcf0695` | `fix(generation): close verified source-policy bypasses` — every adversarial-review finding plus five false positives |

Uncommitted right now: `WEB01B_V2_IMPLEMENTATION_STATE.md` only (updated after each phase).

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

1. Fix the 3 failing artifact tests described under "Current failure".
2. Then Phase 6.5: build the neutral functional v2 fixture (minimal CSS, no
   motion) and prove routing before any creative work.
3. Then Phase 6.6 evidence. Because `apps/managed-web/client/client-website.json`
   is legacy and must stay legacy (port 3010 e2e depends on it), get the curl
   evidence by **temporarily** swapping that file for the v2 fixture, building,
   curling, then reverting — do not commit the swap. `prepare-web01b.ts` requires
   a clean tracked tree, so revert before running e2e.

```bash
export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"
cd /home/khoa/Projects/web01b-implementation/proportion-web-platform
pnpm --filter @melbourne-local-growth-ops/managed-web build
pnpm --filter @melbourne-local-growth-ops/managed-web exec next start -p 3010
for p in / /services /projects /projects/project-one /about /contact; do
  curl --fail --silent --show-error "http://127.0.0.1:3010${p}" >/dev/null || echo "FAIL $p"
done
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3010/does-not-exist
```

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
