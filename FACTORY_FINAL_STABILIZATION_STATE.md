# Factory Final Stabilization — state

Starting SHA: `e82bc74e25ade25d74a5292b41bdba5bced30bf3`
Branch: `feature/web-01b-premium-experience`
main: `5eca7ac44809c566e105fcabc82e873ac2ff99a6` (unchanged, untouched)

## Phase 0 — source lock

Branch, HEAD, clean worktree and main all verified against the handoff before
anything was read or changed.

## Job A — WebKit environment

**Resolved without root.** The blocker was real and reproduced exactly:
`libavif.so.16` is the one shared library Playwright's WebKit bundle expects
from the host. Playwright ships `libjxl` and `libbacktrace` itself in
`minibrowser-*/sys/lib`; it does not ship libavif.

`sudo -n` is unavailable on this machine (password required), so
`sudo npx playwright install-deps` could not run. It was not needed:
`apt-get download` works unprivileged. `libavif16` and its two transitive
libraries (`libgav1-1`, `libyuv0`) were fetched and unpacked into the session
scratchpad.

`LD_LIBRARY_PATH` alone does not work: `minibrowser-wpe/MiniBrowser` is a shell
wrapper that *overwrites* it. `LD_PRELOAD` survives the exec, so the three
libraries are preloaded by absolute path instead.

- nothing installed system-wide
- nothing written into `~/.cache/ms-playwright`
- no application dependency changed
- no binary committed

Verified: `webkit.launch()` → **WebKit 26.5**, page rendered.

### A2 — WebKit targeted coverage

The frozen candidate's artifacts were already built at `4545ecf`; the only
commits since changed `.gitignore` and deleted the harness, so no product code
differs and no rebuild was needed. The archived harness was restored from
`8170d22` into the scratchpad and run unchanged against the same two servers
(3060 STONE & LINE, 3061 second-disclosure-context) the other two engines used.

**WebKit 26.5: 66/66 passed.** Identical to Chromium and Firefox, check for
check. Covered: disclosure open, close, rapid retoggle, the second semantic
disclosure context, media viewer open, next, previous, explicit Close focus
return, Escape focus return, responsive navigation open and close, normal
entrance, all three reduced-motion variants, keyboard interaction, 13 axe states
(WCAG 2.1 AA, 0 violations) and 16 responsive overflow checks at 1440/834/390/320.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| interaction evidence | 66/66 | 66/66 | **66/66** |
| axe (13 states) | 0 | 0 | **0** |
| responsive overflow | none | none | **none** |

**No WebKit-specific defect exists.** Nothing was changed for Job A.

Evidence: `../WEB01C_COMPLETION/evidence-webkit/`.

## Job B — truthful empty evidence

**DEFECT_CONFIRMED**, and it had already produced the outcome the rule forbids.

### What the current source showed

`contractorRequiredSections` in `packages/site-core/src/profile-content.ts`
demanded a GALLERY *and* a TESTIMONIALS section, and both section schemas carry
`items: .min(1)`. Every Contractor — legacy v1 and authored v2 alike, since v2
requires validated profile content for its service routes — therefore had to
supply at least one photograph of finished work and at least one customer quote
before it could validate.

The flagship generated client did what the schema made it do. STONE & LINE's own
testimonial reads:

> "Stone & Line has no customers, so there is no feedback to publish. This slot
> exists only because the profile schema requires it."
> — *"Not a customer — placeholder required by the profile schema"*

Worse, the Factory never showed it. Comparing the client's profile sections
against every `PROFILE_SECTIONS` page reference: `gallery` and `testimonials`
are referenced by **no page on any route**. The requirement extracted a fabricated
placeholder and then shipped it in the payload without ever rendering it.

### The fix

Both types were removed from the required list. Nothing else changed:
`gallerySectionSchema`, `testimonialSectionSchema`, the renderers, the runtime
types and the search projector are untouched — capability availability is not
evidence cardinality. `.min(1)` inside a declared section stays, because absence
is honest and a heading over nothing is not.

### Proof it is a truth fix and not a behaviour change

Regenerating STONE & LINE with both fabricated sections deleted:

| | frozen candidate | zero-evidence |
|---|---|---|
| generated source hash | `cf1eb4e40c980c97…` | `cf1eb4e40c980c97…` |
| generated LOC | 4,398 | 4,398 |
| artifact `src/` diff | — | one file: the data payload |

The only difference in the entire artifact is `managed-website.json`, and within
it the only difference is the two removed sections — every remaining section is
byte-identical. The placeholder was pure schema tax.

Standalone: `verify:handoff` PASS (143 files), `pnpm build` PASS, 14 routes.
Browser: **207/207** across Chromium, Firefox and WebKit — no orphaned evidence
language, every in-page link resolves, no empty section container, no horizontal
overflow at 1440/834/390/320, zero console errors, axe clean on four states.

### Legacy fidelity

Regenerating the A3 legacy brief on this HEAD: source hash
`5963f8dd110e06db…`, 3,376 LOC — identical to the frozen baseline — and
`diff -rq` across the whole assembled artifact `src/` tree reports **zero
differences**.

### Recorded, deliberately not actioned

`restaurantRequiredSections` still requires GALLERY. That is the same class of
demand, but RESTAURANT was outside this pass's brief and a hospitality profile
may have a materially different answer about whether imagery is required for the
page to generate credibly. Recorded for the founder rather than changed here.

## Job C — source-policy diagnostics

**ACTIONED.** Reproduced before touching anything. Two files produced the
identical message:

```
const process = sections.find((s) => s.type === "PROCESS");   // naming collision
const key = process.env.SECRET;                               // environment read
```

> Client experience source "routes/Home.tsx" cannot reference process.
> Consume validated public inputs and Platform primitives instead.

The first author *was* consuming a validated public input, and the sentence sent
them to look at their content. The refusal is correct and unchanged — a
shadowing local binding cannot be told from the global without resolving scope,
and fail-closed is right. The message now names the global, gives line and
column, and for forbidden names that are also ordinary website vocabulary says
the section is authorable and only the identifier is not. No name was added to
or removed from any forbidden set.

## Current phase

Final validation and report.

## Findings

- **Job A: NO_DEFECT.** Environment resolved without root; WebKit green, 66/66.
- **Job B: DEFECT_CONFIRMED and fixed.** Contractor evidence cardinality.
- **Job C: ACTIONED.** Diagnostic text and coverage only.

## Changed files

- `packages/site-core/src/profile-content.ts`
- `packages/site-core/src/profile-content.test.ts`
- `packages/templates/src/profiles/contractor/contractor-profile.ts`
- `tests/integration/site-core/truthful-evidence.test.tsx` (new)
- `apps/managed-web/src/generation/client-experience-source-policy.ts`
- `tests/integration/site-core/client-experience-source-policy.test.ts`
- `FACTORY_FINAL_STABILIZATION_STATE.md`, `FACTORY_FINAL_STABILIZATION_REPORT.md`

No application dependency, lockfile, browser binary or system package was
committed.

## Evidence

`../FACTORY_FINAL_STABILIZATION_EVIDENCE/` — raw JSON and run logs for all three
engines, the truth-model three-engine validation, both generation reports, the
standalone build, and the workspace test and typecheck logs.

## Final validation

Workspace typecheck clean (12 packages). Workspace tests 887 passed. WEB-01B
production e2e acceptance 43 passed, 5 skipped by their own project scoping.
Standalone artifact verify and build PASS. Chromium, Firefox and WebKit targeted
WEB-01C smoke 66/66 each; changed generated fixture 207/207 on all three.

## Remaining work

None in scope. One observation recorded for the founder: RESTAURANT still
requires GALLERY.

## Resume instruction

Re-derive the WebKit runtime with the recipe above; it lives in the scratchpad
and does not survive a machine reboot. Nothing else is outstanding — re-running
`pnpm typecheck && pnpm test` from the repository root reproduces the final
state.
