# Tradies Profile V1 — implementation state

Crash-safe working file. Not a deliverable. Updated as the milestone proceeds.

**Goal: finish ONE customer profile (Tradies/Contractors) so the founder can sell
and deliver the first real client without another architecture sprint.**

---

## Starting identity (verified from Git, not from chat history)

| Check | Expected | Found | |
|---|---|---|---|
| Platform branch | `feature/web-01b-premium-experience` | same | PASS |
| Platform `HEAD` | discover | `aeedbb5dff769dadf2a60916ca5579d821e89d61` | PASS |
| Platform `main` | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` | same | PASS |
| Worktree | clean | clean | PASS |
| Commits since `main` | — | 103 | — |
| Consolidation commits present | `dc38333`,`43aab0a`,`efdb209`,`14f82b4`,`aeedbb5` | all present | PASS |
| Node | 24.18.0 (`.nvmrc`) | 24.18.0 via nvm | PASS |
| Stone & Line client | frozen `6afa603…` | not touched this run | — |

## Phase 0 — reconstruction (COMPLETE)

Source read, not assumed. Key facts that govern every later decision:

- `packages/site-core/src/profile-content.ts` — profile semantics. CONTRACTOR
  requires SERVICES, TRUST_SIGNALS, PROCESS, FAQ, CONTACT, ACTIONS. GALLERY and
  TESTIMONIALS deliberately optional. `WebsiteServiceItemSchema` carries only
  `serviceId?`, `title`, `description`. Services `.max(100)`.
- `packages/site-core/src/project-content.ts` — projects carry `serviceIds`
  (a real relation), `locationLabel?`, `relatedProjectIds`, `story`, media.
  `.max(250)`. **No `featured`, no category, no date.**
- `packages/site-core/src/page-graph.ts` — one navigation level only
  (`primary` max 12, `utility`, `footer`, `primaryAction`). No children, no media.
- `packages/site-core/src/website-v2-model.ts` — v2 cross-validation binds
  SERVICE_DETAIL to exact `serviceId` and requires exactly one PROJECTS_INDEX.
- `packages/experience-starter/` — P1 source generation.
- `scripts/creative/` — `prepare` / `launch` / `verify` premium bridge, authority
  model, atomic output, pointer evidence.
- `apps/managed-web/src/generation/` — assemble, source policy, verify.

### The blocking defect found in Phase 0

`packages/experience-starter/src/generate.ts:308-318` refuses generation with
*"Every service with a detail route needs narrative and a photograph."*
`brief.ts` `serviceNarratives` is `.min(1).max(24)` and each entry **requires**
`body`, 1–6 `questions` and a `StarterMediaPlacement` (an `assetId` the client
definition must already declare).

Consequences for a real Tradie:
1. A client with 11 services and 8 usable photographs **cannot generate P1**.
2. Service decision truth (`body`, customer `questions`) lives in the *creative
   brief*, not in `client-website.json` — so business truth is entered twice and
   the brief, a creative artifact, becomes a truth authority. That contradicts
   the inherited constraint "client-website.json is the only business-truth
   authority".

Both are fixed in this milestone.

## Gap map

| Class | Items |
|---|---|
| `ALREADY_SOLVED` | profile/section semantics; page graph + ID-bound routes; project relations; media presentation/focal; P1 generation, assembly, handoff, deployment; premium 3-command bridge + authority model + human gates; promotion ladder, taxonomy, catalogue, motion policy, parity gate; 7-stage media intake **as a contract** |
| `NEEDS_EXTENSION` | service decision content in the *definition*; service groups; project `featured`/category/year; second navigation level; starter brief media-optional + cardinality; starter emit at 12 services / 30+ projects |
| `NEEDS_NEW_TRADIES_RULE` | collection-scale policy (curated vs archive, nav mode); delivery intake contracts (sales handoff, intake, media audit + provenance + lanes, shot gap, truth normalisation, creative configuration); small operator command surface; second-context fixture |
| `NEEDS_DESIGN_STUDY` | aesthetic refinement of mega-nav panel and archive cell |
| `DO_NOT_BUILD` | uploader/DAM, client portal, page builder, recursive taxonomy, search, CRM, Technology profile, Proportion site |

## Phase status

| Phase | State |
|---|---|
| 0 reconstruction | COMPLETE |
| A semantics (service decision, groups, projects) | COMPLETE |
| B collection scale + navigation | COMPLETE (policy); nav *schema* deferred to Phase E decision |
| C delivery intake contracts | COMPLETE |
| D starter cardinality + media reality | COMPLETE |
| E operator command surface | COMPLETE |
| F second-context fixture + generalisation proof | COMPLETE (built and rendered) |
| G docs + first-client start here | PENDING |
| H regression, clean-room, adversarial, red team | PENDING |
| I review package | PENDING |

## Phase A + B — what was implemented

`packages/site-core/src/profile-content.ts`
- `WebsiteServiceCommercialFactSchema` (label/value/qualifier)
- `WebsiteServiceDecisionSchema` — 8 lists + `nextActionId`, every one optional
- `WebsiteServiceGroupSchema` — one level, **no `parentGroupId`**, so depth is
  bounded by shape rather than by a rule
- `WebsiteServiceItemSchema` gains `narrative?`, `decision?`, `groupId?`,
  `featured` (default false)
- SERVICES section gains `groups` (default `[]`)
- New refusals: duplicate group id; service in an undeclared group; a declared
  group with no members; `nextActionId` naming an action no ACTIONS section declares
- Helpers `serviceSections`, `groupedServices`, `featuredServices`

`packages/site-core/src/project-content.ts`
- `featured` (default false) and `completedYear?` (1900–2200 int)
- Helpers `featuredProjects`, `projectsForService`

`packages/site-core/src/collection-scale.ts` (new) — the cardinality policy that
answers the three design briefs' *architectural* questions once, so the P1
emitter, a premium experience and the operator report cannot each invent a
threshold:
- `resolveProjectPresentation` — CURATED ≤12, TRANSITIONAL 13–24, ARCHIVE ≥25;
  filtering from 8; PROGRESSIVE reveal only in ARCHIVE
- `deriveProjectFacets` — **derived from `serviceIds` / `locationLabel` /
  `completedYear`; no declared category vocabulary**; a facet with <2 values is omitted
- `resolveServicePresentation` — FLAT/GROUPED + `ungroupedAtScale` above 8
- `serviceDecisionDepth` / `deservesServiceDetailRoute` — threshold 2, advisory
- `resolveNavigationPlan` — services EXPANDED at ≥7 or when grouped; projects
  EXPANDED only with ≥3 featured *and* an archive; never dumps the archive into a panel

`apps/managed-web/src/runtime-types.ts` mirror updated in lockstep
(`RuntimeServiceDecision`, `RuntimeServiceGroup`, `RuntimeServiceItem`,
project `featured`/`completedYear`); exported from `public-api.ts`.

Demo definitions patched with the two new defaults so the portable-demo
alignment test still holds. Two site-core tests updated for the widened output type.

**Tests: `packages/site-core/src/tradies-semantics.test.ts`, 36 new.
`pnpm check` exit 0 — 927 package tests.**

### Answers this locks (previously open in the briefs)

| Brief | Question | Answer |
|---|---|---|
| A2 | categories declared or derived | **Derived.** A trade business asked to invent a taxonomy invents one that duplicates its own service list and then drifts from it. |
| A6 | curated set authored, `featured`, or recent N | **Authored `featured`.** The most persuasive job is frequently not the newest. |
| B1 | do services group, is a group a page | **They group. A group is not a page** — it is a heading with a list. A group route would be a thin page whose content is its children's. |
| B5 | minimum truth for a detail route | **Two decision answers**, evidence counting as one. Advisory, never enforced. |
| C1 | second level: page graph or client experience | Deferred to Phase E with the nav schema — see below. |

## Commits this milestone

| | |
|---|---|
| `e5c75e1` | `feat(tradies): say what a service covers, and where it stops` |
| `f114aa0` | `fix(starter): a service without a photograph is still a service` |
| (pending) | delivery workflow + operator commands |

## Phase C–F — what was implemented

`scripts/tradies/` — delivery-time tooling, dependency-free, `node --test`-able.
Deliberately **not** in `packages/contracts`: that package's `dist` is vendored
wholesale into every client artifact, so a module added there ships to every
website whether or not anything imports it.

- `intake-contracts.mjs` — five records (`sale-handoff`, `business-read`,
  `client-intake`, `media-inventory`, `creative-configuration`), a closed refusal
  vocabulary, and the three cross-field media invariants:
  `PROVENANCE_CLAIM_CAPABILITY` (an asset may not substantiate a claim its
  provenance cannot carry), `LANE_PROVENANCE`, and a derived asset must name its
  real source. Non-human approvers refused at both approval points.
- `delivery-core.mjs` — `readinessReport` (gaps carry an **owner**),
  `deriveShotList` (derived from the site being built, not a universal
  checklist), `recommendCreativeConfiguration` (media reality decides image
  treatment), `composeDefinition` (→ one validated definition + a truth ledger).
- `brief-template.mjs` — derives every design decision and all navigational
  chrome from the approved creative configuration; leaves 8 genuinely editorial
  fields as `TODO —`, which `tradie p1` refuses.
- `scaffold.mjs` — the blank workspace, with a README that says who answers what.
- `cli.ts` — `pnpm tradie start|check|recommend|shotlist|compose|p1|demo`.
- `fixtures/northgate-roofing.mjs` — the second-context fixture.

Definition validation at compose time runs the Factory's own
`validateWebsiteProfileContent` + `validateWebsiteV2Model`, reached through the
documented re-export in `apps/managed-web/src/generation/index.ts`.

### Generalisation proof — executed, not asserted

Northgate Roofing & Metal: 10 services in 3 groups, 34 job records, 41 assets of
mixed grade and five provenances.

| Step | Result |
|---|---|
| all five records validate | PASS |
| `tradie check` | INPUTS READY, 1 agency gap (an unsighted credential) |
| `tradie shotlist` | 34 requirements, 39 frames, each naming what it would prove |
| `tradie compose` | 40 pages, 25 published projects, 34 assets, 46 ledger entries, 10 honest warnings |
| Factory v2 cross-validation | PASS |
| `tradie p1` | 16 files, 4,728 lines |
| `assemble:client` | PASS |
| artifact `pnpm typecheck` | PASS |
| artifact `pnpm build` | **43 static pages** |
| rendered archive | 25 rows, 11 facet controls, show-all, one `<legend>`, no client `<form>` |
| rendered services index | 3 group headings, 10 service links |
| rendered service detail | 7 decision panels, 4 answered pairs, stages, 5 evidence links |
| thin services | **5 panels, not 7** — 0 "not stated", 0 TODO |

### Defect this proof caught

The archive filter was emitted inside a raw `<form>`. The client experience
source policy refuses `<form>` (`UNSAFE_MARKUP_FORBIDDEN`) so route and markup
validation cannot be bypassed. Nothing was being submitted — the form was
decorative. Replaced with `fieldset`/`legend`, which is what a screen reader
needed anyway. **This is the value of building the second context rather than
reasoning about it.**

## Exact next action

Commit Phase A+B, then Phase C: the delivery intake contracts
(sales handoff, client intake, media audit/provenance/lanes, shot gap,
truth normalisation, creative configuration) in `packages/contracts/src/`.
