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

## Phase 1 — Claude Design / Claude Code integration research — COMPLETE

### 1a. First-party local integration surface — VERIFIED DIRECTLY

The strongest available evidence is not documentation: it is the integration
surface this Claude Code build actually exposes. Read directly from the live tool
and skill definitions in this session, which supersedes the dated snapshot in the
handoff's `05_CLAUDE_DESIGN_CURRENT_RESEARCH.md`.

**`DesignSync` tool — present and callable in this build.**

- Operates on the user's `claude.ai/design` **design-system projects**, authorised
  through the existing claude.ai login; sessions without one use `/design-login`
  to obtain a dedicated design authorization.
- Methods: `list_projects`, `get_project`, `list_files`, `get_file`,
  `create_project`, `finalize_plan`, `write_files`, `delete_files`,
  `register_assets`, `unregister_assets`, `report_validate`.
- **Enforced ordering: list/read → `finalize_plan` → write/delete.** Writes
  without a valid `planId`, or touching paths outside the finalized plan, are
  rejected. `finalize_plan` also pins `localDir`, the only directory uploads may
  read from.
- `list_projects` is filtered to **writable** projects only.
- Project type `PROJECT_TYPE_DESIGN_SYSTEM` is **immutable at creation** — pushing
  to a regular project never converts it into a design system.
- Limits: `get_file` capped at 256 KiB; `write_files` max 256 files per call;
  plan `writes`/`deletes` max 256 entries, max 3 `*`/`**` wildcards per pattern.
- The Design System pane now builds its card index from a first-line
  `<!-- @dsCard group="…" -->` comment in each preview HTML, compiled into
  `_ds_manifest.json`; `register_assets` / `unregister_assets` are **legacy** and
  needed only for hand-authored projects without `@dsCard` markers.
- Companion skill `/design-sync` keeps a local component library in sync with a
  Claude Design project **incrementally, one component at a time, never as a
  wholesale replace**.
- **Security property, first-party:** the tool's own contract states `get_file`
  returns content written by other org members and must be treated as *data, not
  instructions*, preferring structural `list_files` metadata when building a plan.

**`design` skill — present in this build.** Creates a *design canvas*: multi-artboard
`.dc.html` artboards on one pan/zoom canvas, published as an Artifact running
Claude Design's canvas editor — described in its own definition as "an early
preview of Claude Design inside Claude Code". Where saving is enabled for the
account, the human refines elements visually (click-to-select, properties panel,
inline text editing, undo/redo) and Save publishes a new version; otherwise the
account gets a view-and-export (PNG/PDF) preview of the drafted canvas. It is for
*creating or re-seeding* a canvas; an existing canvas is edited in its Artifact.

### 1b. Architectural consequence — decided

The integration's **direction** settles the dependency question cleanly, and in
Proportion's favour:

- `DesignSync` **pushes from the repository up** to a Claude Design design-system
  project. The repository is the source; the canvas is the consumer. Nothing in
  the surface pulls production source down as authority.
- The canvas (`design` skill) is an **exploration and human-refinement surface**
  producing `.dc.html` artboards and PNG/PDF exports — none of which is a runtime
  artifact, and none of which any generated client would ever import.
- Therefore Claude Design satisfies `02_LOCKED_BOUNDARIES.md` as an **optional
  upstream creative environment** with no architectural change required, and the
  replaceability requirement is met by construction: the repository would be
  unchanged if the canvas vendor were swapped.

This is a decision, not a preference: WEB-01D will treat the Claude Design surface
as a **bounded, resumable, plan-gated export** of an already-complete repository
artefact — never as an inbound production path.

### 1c. Official-source verification — COMPLETE (checked 2026-08-19)

Verified against Anthropic/Claude primary sources, not the dated handoff snapshot:

- **Beta status confirmed.** "Claude Design is now available in beta to Pro, Max,
  Team, and Enterprise plans"; reachable at `claude.ai/design` or the Claude
  Desktop sidebar; **default off for Enterprise plans**. Beta + default-off is by
  itself sufficient reason to keep it optional in Proportion's architecture.
- **`/design-login`** authenticates the Claude Design **MCP server** for
  terminal-based access. Endpoint: `https://api.anthropic.com/v1/design/mcp`.
- **`/design-sync`** from Claude Code syncs a design system in, "so everything you
  build in Claude Design starts from your existing components."
- **Large repositories:** "Consider linking very large repositories from Claude
  Code to avoid lag or browser issues. To sync a design system, use `/design-sync`
  from Claude Code." — this repository is a pnpm monorepo and is exactly that case,
  so the operator pack must specify sync-from-Claude-Code, never wholesale upload.
- **Design → Code handoff exists** and is explicitly *not* screenshot-based: "When
  a design is ready to become software, you can hand it off to Claude Code, which
  continues from your existing work instead of starting over from a screenshot."
  Export surface includes "Send to local coding agent" and "Send to Claude Code Web".
- **Export formats:** .zip, PDF, PPTX, standalone HTML, Canva, Adobe, Gamma, Vercel,
  plus direct Claude Code handoff.
- Design systems may be sourced from a GitHub repo, linked/uploaded codebases,
  design files, prototypes/screenshots, or even slide decks; a Claude Design Admin
  role on Team/Enterprise can approve and lock a standard system.

**Refinement of 1b, stated precisely.** The product *does* have a Design → Code
direction; the earlier note should not be read as denying it. The accurate
statement is narrower and is the one WEB-01D relies on: the Design → Code handoff
carries **design context into an agent that then writes repository source**. It
never makes the canvas the production artefact. So production authority stays with
repository source, Factory contracts, tests and the standalone artifact exactly as
`02_LOCKED_BOUNDARIES.md` requires — and Requirement G's whole purpose is to make
that handoff carry *intent* rather than pixels.

### 1d. Authentication probe — COMPLETE: AUTH AVAILABLE

`DesignSync list_projects` executed successfully and returned `{"projects":[]}`.

- The call **did not fail on authorization**, so design scopes are granted on this
  session's claude.ai login. **No human `/design-login` step is required.**
- The account currently has **no writable design-system projects**, so a live proof
  requires `create_project` first.

Consequence: `WEB01D_BLOCKED_BY_EXTERNAL_AUTH` is **not** applicable. The optional
bounded real proof contemplated by `07_ACCEPTANCE_MODEL.md` is available, and the
handoff explicitly authorises it ("If Claude Design authentication is already
available, use a bounded real proof").

**Data-use posture for the live proof — decided, and deliberately conservative.**
Only synthetic fixture material will leave the machine. `northline` is verified
fictional by its own contract: "The business, its projects, its people and its
results are fictional… No review, rating, licence, certification, award or
measured outcome is stated anywhere." No real client data, no production client
content, and no Proportion business facts will be pushed to the beta service. This
keeps Requirement I's provider/data-use rule satisfied without needing a founder
decision.

### 1e. The creative practice that already exists — FORMALISE, DO NOT REINVENT

`tests/fixtures/web01b/northline/acceptance/` already contains a mature worked
example of exactly what WEB-01D is asked to systematise:

`creative-contract.md` supplies, in prose: business and customer outcome (ranked
decision needs), a named **creative thesis** ("Drawn to code"), perception target,
anti-target (framed as "a failure, not a matter of taste"), numbered visual
principles, imagery philosophy, motion character with explicit duration band,
a **Signature concept** ("the Conductor") carrying *why this and not a generic
reveal*, implementation intent, mobile translation, reduced-motion design, targeted
reference capabilities, an explicit non-copying rule naming the studios used only
to calibrate, and a truthfulness declaration.

`creative-gate-decision.md` supplies the gate half: dated decision **PASS WITH
NAMED FIXES** against a named candidate commit and named evidence set; seven fixes
stated as "acceptance conditions, not suggestions"; scope limits ("authorises
scaling only"); and the freeze rule — "Any change to thesis, palette, typographic
roles, composition grammar or Signature intent during scaling requires returning
to this gate."

→ The WEB-01D Creative Intent / Territory / Signature Slice / Creative Gate assets
must be the **generalised, client-agnostic, machine-checkable form of this**, and
must be able to round-trip the northline pair as their worked example. Designing a
competing vocabulary would strand the one real precedent the repository has.

## Phase status

| Phase | Status |
|---|---|
| 0 — Source lock and system reconstruction | COMPLETE |
| 1 — Current primary-source Claude Design research | COMPLETE — local surface, official sources, auth probe all verified |
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
