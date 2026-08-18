# Factory Final Stabilization — report

| | |
|---|---|
| Starting SHA | `e82bc74e25ade25d74a5292b41bdba5bced30bf3` |
| Final code SHA | `96e5c0a` — the last commit that changes product code |
| Final branch tip | the commit carrying this document, one commit later |
| Branch | `feature/web-01b-premium-experience` |
| `main` | `5eca7ac44809c566e105fcabc82e873ac2ff99a6` — unchanged, untouched |

Branch, HEAD, clean worktree and `main` were verified against the handoff before
anything was read or changed. Nothing was pushed, reset, rebased or merged; PR
#14, Notion and every production deployment were left exactly as they were.

## Local commits

```
69badb6  docs: record the stabilization pass and how WebKit was made to run
21e2354  docs: WebKit answers the same way the other two engines do
26f1e70  fix(profile): stop requiring a contractor to hold proof it may not have
96e5c0a  fix(policy): say which name was refused, not which content
<tip>   docs: close the stabilization pass with its report   ← this document
```

Nothing was pushed. The working tree is clean.

---

## Job A — WebKit production validation

### Environment: RESOLVED, without root and without mutating anything

The blocker was real and reproduced exactly. `sudo -n` is unavailable on this
machine, so `sudo npx playwright install-deps` could not run. It was not needed.

`libavif.so.16` is the *only* library the host is missing. Playwright ships
`libjxl` and `libbacktrace` itself in `minibrowser-*/sys/lib`; it does not ship
libavif, which is why its own message named exactly that package.

`apt-get download` works unprivileged, so `libavif16` and its two transitive
libraries (`libgav1-1`, `libyuv0`) were fetched and unpacked into the session
scratchpad. `LD_LIBRARY_PATH` alone is not enough — `minibrowser-wpe/MiniBrowser`
is a shell wrapper that *overwrites* it — so the three libraries are preloaded by
absolute path with `LD_PRELOAD`, which survives the exec.

- nothing installed system-wide
- nothing written into `~/.cache/ms-playwright`
- no application dependency, lockfile or browser binary touched or committed

The recipe is recorded in `FACTORY_FINAL_STABILIZATION_STATE.md`. It lives in the
scratchpad and does not survive a reboot; re-deriving it takes about a minute.

### Results: WebKit 26.5, 66/66

The archived interaction harness was restored from `8170d22` and run unchanged
against the same two servers the other engines used. All three engines were run
in this session, on the artifacts the founder review was frozen against.

| | Chromium | Firefox | WebKit |
|---|---|---|---|
| interaction evidence | 66/66 | 66/66 | **66/66** |
| axe, 13 states, WCAG 2.1 AA | 0 violations | 0 | **0** |
| responsive 1440/834/390/320 | no overflow | none | **none** |

Covered: disclosure open, close, rapid retoggle, the second semantic disclosure
context (POLICIES), media viewer open, next, previous, explicit Close focus
return, Escape focus return, responsive navigation open and close, normal
entrance, all three reduced-motion variants, and keyboard interaction.

**No WebKit-specific defect exists.** Not one check answered differently from
Chromium or Firefox, including the ones that measure movement frame by frame.
Nothing was changed for Job A.

---

## Job B — truthful empty evidence

### Audit result: **DEFECT_CONFIRMED**

Verified against current source, not against the prior report.

`contractorRequiredSections` in `packages/site-core/src/profile-content.ts`
demanded a GALLERY **and** a TESTIMONIALS section, and both section schemas carry
`items: .min(1)`. Every Contractor was affected — legacy v1 and authored v2
alike, because v2 requires validated profile content so service routes can bind
to stable IDs. A business that had not photographed a finished job, or whose
customers would not be quoted, could not validate without writing something into
both.

It already had. The flagship generated client's own testimonial reads:

> "Stone & Line has no customers, so there is no feedback to publish. This slot
> exists only because the profile schema requires it."
> — attributed to *"Not a customer — placeholder required by the profile schema"*

And the Factory never showed it. Cross-referencing the client's profile sections
against every `PROFILE_SECTIONS` page reference, `gallery` and `testimonials` are
referenced by **no page on any route**. The requirement extracted a fabricated
placeholder and shipped it in the payload without ever rendering it.

### The change

Both types removed from the required list — six lines of data and the reasoning
around them. Deliberately nothing else:

- `gallerySectionSchema` and `testimonialSectionSchema` — unchanged
- the renderers, the runtime types, the search projector — unchanged
- `.min(1)` inside a declared section — unchanged, because absence is honest and
  a heading over nothing is not

That is the capability/cardinality line the brief asked for: the Profile still
*supports* both kinds of evidence, and a client is no longer *made* to hold them.
What remains required is what the business is — its trade, its terms, how it
works, how to reach it.

### Proof it is a truth fix and not a behaviour change

Regenerating STONE & LINE with both fabricated sections deleted:

| | frozen candidate | zero-evidence |
|---|---|---|
| generated source hash | `cf1eb4e40c980c97…` | `cf1eb4e40c980c97…` |
| generated LOC | 4,398 | 4,398 |
| artifact `src/` differences | — | one file, the data payload |

Inside that one file the only difference is the two removed sections; every
remaining section is byte-identical. The placeholder was pure schema tax.

- standalone `verify:handoff`: **PASS**, 143 files
- standalone `pnpm build`: **PASS**, 14 routes
- browser validation, Chromium + Firefox + WebKit: **207/207**

The browser pass proves the negatives the rule demands: no orphaned evidence
language anywhere in the rendered text, every in-page link resolves to a node
that exists, no empty `<section>` container, no horizontal overflow at
1440/834/390/320, **zero console errors**, and axe clean on four representative
states.

### Regression coverage added

Sixteen tests, all of which fail without the fix (verified by reverting it — 8 of
the 11 integration tests failed):

- `packages/site-core/src/profile-content.test.ts` — a contractor with no
  testimonials; with no gallery; with neither, while SERVICES is still demanded;
  a declared evidence section with zero items is still refused; a contractor that
  does hold both is unchanged.
- `tests/integration/site-core/truthful-evidence.test.tsx` (new) — the same
  cases end to end on both rendering paths: no empty heading or container, no
  anchor or navigation target for absent evidence, nothing indexed for it,
  no proof claimed in structured data, and a client that supplied both generating
  exactly as before.

The fixtures mutate real client definitions rather than special-casing one; the
placeholder-language guard is a regex over rendered text, not a string match on
the current fixture.

### Recorded, deliberately not actioned

`restaurantRequiredSections` still requires GALLERY. Same class of demand, but
RESTAURANT was outside this pass's brief and a hospitality profile may have a
different answer about whether imagery is materially required for the page to
generate credibly. Flagged for the founder rather than changed here.

---

## Job C — source-policy error message

**ACTIONED.** Reproduced from current source before anything was touched. Two
files produced the identical message:

```ts
const process = sections.find((s) => s.type === "PROCESS");  // naming collision
const key = process.env.SECRET;                              // environment read
```

> `Client experience source "routes/Home.tsx" cannot reference process. Consume`
> `validated public inputs and Platform primitives instead.`

The first author *was* consuming a validated public input. The sentence sent them
to look at their content, when the fix was to rename a variable.

The refusal itself is unchanged and correct — a shadowing local binding cannot be
told from the global without resolving scope, and fail-closed is right. The
message now names the global, gives line and column, and for the few forbidden
names that are also ordinary website vocabulary states that the section is
authorable and only the identifier is not.

**No name was added to or removed from any forbidden set. No source-policy
behaviour changed and nothing was weakened.** Two tests pin it.

---

## Legacy / backward compatibility

Regenerating the A3 legacy brief on this HEAD:

| | frozen baseline | this HEAD |
|---|---|---|
| generated source hash | `5963f8dd110e06db…` | `5963f8dd110e06db…` |
| generated LOC | 3,376 | 3,376 |
| `diff -rq` across assembled artifact `src/` | — | **zero differences** |

A legacy brief regenerates the site that was approved, byte for byte. Every
existing client definition that validated before still validates: the schema
change only widens what is accepted.

---

## Files changed

```
packages/site-core/src/profile-content.ts
packages/site-core/src/profile-content.test.ts
packages/templates/src/profiles/contractor/contractor-profile.ts
tests/integration/site-core/truthful-evidence.test.tsx            (new)
apps/managed-web/src/generation/client-experience-source-policy.ts
tests/integration/site-core/client-experience-source-policy.test.ts
FACTORY_FINAL_STABILIZATION_STATE.md                              (new)
FACTORY_FINAL_STABILIZATION_REPORT.md                             (new)
```

No dependency, lockfile, browser binary or system package was added or committed.

## Final validation

| | |
|---|---|
| workspace typecheck | **clean**, 12 packages |
| workspace tests | **887 passed**, 0 failed |
| Experience Starter tests | 63 passed |
| generation / artifact assembly tests | inside the 345 managed-web tests |
| source-policy tests | 61 passed |
| WEB-01B production e2e acceptance | 43 passed, 5 skipped (deliberate project scoping) |
| artifact standalone verify | PASS, 143 files |
| artifact standalone build | PASS, 14 routes |
| Chromium targeted WEB-01C smoke | 66/66 |
| Firefox targeted WEB-01C smoke | 66/66 |
| WebKit targeted WEB-01C smoke | 66/66 |
| axe, representative interaction states | 0 violations, all three engines |
| changed generated fixture, 3 engines | 207/207, 0 console errors, 0 overflow |

Raw evidence: `../FACTORY_FINAL_STABILIZATION_EVIDENCE/`.

## Remaining P1 Factory defects

**None found.** Job A found no defect in any engine. Jobs B and C each found one
and both are fixed with regression coverage. One observation is recorded for
future consideration (RESTAURANT still requires GALLERY); it is not a defect in
the Contractor truth model this pass was asked to close.

## Scope

No feature expansion occurred. No new interaction capability, motion grammar,
Tabs, route transition, scroll storytelling, Design DNA dimension, Profile
aesthetic logic, page-builder abstraction, media AI integration, Claude Design
integration or production provider was introduced. No Proportion website and no
client showcase was built. WEB-01D was not started.

`main`, `origin`, PR #14, Notion and every production deployment are untouched.

---

## Outcome

**`FACTORY_FINAL_STABILIZATION_GREEN`**

WebKit was the one engine the completion pass could not run. It now runs, on this
machine, without root, and it agrees with the other two on all sixty-six
measurements. No product defect remains unproven on any engine.
