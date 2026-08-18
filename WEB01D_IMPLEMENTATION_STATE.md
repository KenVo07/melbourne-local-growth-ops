# WEB-01D — Creative Ceiling & Signature Production System — Implementation State

Crash-safe resume record. A later session should resume from this file and the
local commits it names, not by restarting research.

Handoff package: `/home/khoa/Downloads/WEB01D_CREATIVE_CEILING_XHIGH_HANDOFF`

## Phase 0 — Source lock and reconnaissance — COMPLETE

### Source lock: VERIFIED EXACT

| Item | Expected | Observed | Result |
|---|---|---|---|
| Factory baseline HEAD | `bed25ff` | `bed25fff03b04481e7acfa8eda1502a3b0730505` | MATCH |
| Unchanged main | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` | MATCH |
| `origin/main` | same as main | `5eca7ac4...` | MATCH |
| Working tree at start | clean | clean | MATCH |
| Branch | `feature/web-01b-premium-experience` | same | MATCH |
| main..HEAD | — | 73 commits ahead, 0 behind | consistent |

### Handoff package integrity: VERIFIED

- `scripts/validate_package.py` → `PACKAGE VALIDATION: PASS`, `source_hydrated=True`, 335 files.
- `sha256sum -c checksums.sha256` → 23/23 OK, zero failures.
- Source snapshot drift check: **310 snapshot files compared byte-for-byte against
  the live repository — 0 differences, 0 missing.** The package's bounded source
  snapshot is an exact mirror of the locked tree. No unexpected source drift.

Conclusion: material work is authorised. No `WEB01D_BLOCKED_BY_*` condition from source state.

### Repository conventions established (designing against exact paths, not imagined ones)

- Workspace root name `melbourne-local-growth-ops`; pnpm workspaces over `apps/*`,
  `packages/*`, `packages/*/*`. Node 24.18.0, pnpm 11.9.0 pinned.
- Existing packages: `asset-pipeline`, `contracts`, `deployment`, `experience-starter`,
  `integrations`, `observability`, `site-core`, `templates`, `website-modules`.
- Docs convention: `docs/architecture`, `docs/decisions` (ADRs), `docs/governance`
  (+`docs/governance/templates`), `docs/product`, `docs/runbooks`, `docs/tasks`.
- Root-level `*_STATE.md` / `*_REPORT.md` milestone records are the established
  convention (`WEB01B_V2_IMPLEMENTATION_STATE.md`, `WEB01C_COMPLETION_STATE.md`,
  `FACTORY_FINAL_STABILIZATION_*`). This file follows it.
- Node scripts convention: `scripts/<area>/*.mjs` with colocated `*.test.mjs`
  (`scripts/governance`, `scripts/deployment`, `scripts/handoff`) wired to root
  `package.json` scripts. This is the precedent for WEB-01D executable validators.

### Findings that materially constrain the WEB-01D architecture

These are **exact-source findings** and they change the design. Recorded so the
next session does not re-derive them.

1. **The Factory already carries a creative decision spine.**
   `packages/experience-starter/src/brief.ts` (`StarterBrief`) already encodes
   `creative.thesis`, `creative.perceptionTargets`, `creative.antiTargets`, plus
   continuous typography/space/colour/media decisions, per-page-kind composition
   grammars, and a full `StarterInteractionSchema` Motion & Interaction Language
   (tempo, attack, travel, overshoot, pointerFeedback, entrance, disclosure,
   mediaExploration, reducedMotion).
   → **WEB-01D must not restate any of this.** Creative Intent / Territory must
   *feed* a `StarterBrief`, not duplicate or replace it. Duplicating it is the
   single largest schema-bloat risk in this milestone.

2. **Client-local Signature is already a first-class platform concept.**
   `ClientExperienceManifestSchema` already has `signatureIds`, and
   `publicDependencies` (max 16, exact pinned versions), and
   `runtime.motion: NONE | NATIVE | CLIENT_LIBRARY` with a cross-check that
   `CLIENT_LIBRARY` requires at least one declared dependency and forbids
   `clientJavaScript: NONE`. `createClientExperienceRegistry` enforces exact
   signature coverage between manifest and source.
   `ClientExperienceSignatureComponent` / `ClientExperienceSignatureProps` exist in
   `apps/managed-web/src/client-experience/contract.tsx`.
   → Requirement H's substrate **already exists**. WEB-01D supplies rules,
   validation and evidence around it — it must not build a parallel mechanism.
   (Note: `apps/managed-web/src/rendering/signatures/SignatureSlot.tsx` is the
   *managed* P1 signature slot and is a different, narrower thing — a hardcoded
   `service-area-proof`. Do not conflate the two.)

3. **The Signature capability envelope is machine-decidable, and narrower than
   Requirement H assumes.** `apps/managed-web/src/generation/client-experience-source-policy.ts`
   is a build-time fail-closed AST/CSS inspector over client-local source. Verified
   constraints:
   - allowed extensions: `.ts .tsx .css .json` only;
   - always-allowed imports: `@proportion/client-experience`, `react`,
     `react/jsx-runtime`, `react/jsx-dev-runtime`; everything else must be in the
     manifest **and** governance-approved; `next`, node builtins and
     `@melbourne-local-growth-ops/*` are refused outright;
   - forbidden JSX tags: `script style link meta base iframe object embed a img form`
     (Platform primitives `Link`/`Image`/`Action`/`Region`/`Search`/`Disclosure`/
     `Main`/`SkipLink` exist precisely to replace them);
   - forbidden in **any** reference position: `fetch WebSocket EventSource
     XMLHttpRequest Worker SharedWorker importScripts sendBeacon serviceWorker
     Image Audio`, `eval require Function execScript`, `localStorage sessionStorage
     indexedDB openDatabase caches`, `process`;
   - forbidden markup injection: `innerHTML outerHTML insertAdjacentHTML
     dangerouslySetInnerHTML createContextualFragment write writeln`;
   - CSS: no `@import`; `url()`/`image-set()`/`src()` permitted **only** for
     `/fonts/**` and inline `data:image/svg+xml` — so no CSS-referenced raster art;
   - URLs: `javascript:`, `vbscript:`, `data:text/html` refused everywhere,
     including via concatenation. Relative asset paths are fine.
   → Consequences for Requirement H, to be confirmed empirically in Phase 3 by an
   executable probe rather than by reading: **CSS, WAAPI (`element.animate`),
   `requestAnimationFrame`, `IntersectionObserver`, `matchMedia`, `<canvas>` and
   `<video>` appear permitted**; **`new Image()` texture loading, `Worker`,
   `fetch`-loaded shaders/models/JSON, web-font `url()` from a CDN, and any
   `localStorage` persistence are refused.** A "3D/WebGL Signature" is therefore
   only viable with inline shader strings and no fetched assets — a real, durable
   constraint that must reach the Claude Design operator pack and the production
   handoff, or prototypes will promise things production cannot ship.

4. **`experience-starter` states the non-negotiable it must preserve**: "After
   generation the client site has no relationship with this package", asserted by
   `tests/integration/site-core/experience-starter-artifact.test.ts`. Any WEB-01D
   asset must inherit this property — nothing WEB-01D creates may become a runtime
   dependency of a generated client.

### Existing controlled clients available for the Phase 5 proof

Fixtures at `tests/fixtures/web01b/`: `northline` (has `signatureIds: ["conductor"]`,
a full authored experience with `components/Conductor.tsx`, `styles/conductor.css`,
and `acceptance/creative-contract.md` + `acceptance/creative-gate-decision.md`),
`northline-variant`, `neutral-v2`, `contractor` (reference + field-guide).
Prior STONE & LINE A3 evidence lives outside the repo at
`/home/khoa/Projects/web01b-implementation/STONE_LINE_A3*`.
→ `northline` already carries a `creative-contract.md` / `creative-gate-decision.md`
pair. **Read both before designing the Creative Gate**, so WEB-01D formalises the
existing practice instead of inventing a competing one.

## Phase status

| Phase | Status |
|---|---|
| 0 — Source lock and system reconstruction | COMPLETE |
| 1 — Current primary-source Claude Design research | NOT STARTED |
| 2 — Architecture + red team | NOT STARTED |
| 3 — Durable contracts/templates/validators | NOT STARTED |
| 4 — Claude Design operator pack | NOT STARTED |
| 5 — Controlled proof | NOT STARTED |
| 6 — Production translation + evidence tooling | NOT STARTED |
| 7 — Proportion kickoff package | NOT STARTED |
| 8 — Independent red team | NOT STARTED |
| 9 — Final validation and packaging | NOT STARTED |

## Boundaries honoured so far

No P1 Factory source has been modified. No push, no merge, no PR #14 change, no
Notion update, no production promotion. Only this state file has been added.
