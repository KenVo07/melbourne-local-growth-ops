# Sellability red team — Tradies Profile V1

Fifteen ways the first paid delivery could go wrong, answered against the
system as built rather than as intended. Every "yes" below was executed, not
reasoned about.

**The claim under test.** Could the founder take money from a Tradie tomorrow and
truthfully say:

> Send me your business information and whatever photos and material you already
> have. I'll tell you what else I need, propose the creative direction, build the
> site, show you a preview, and handle the production workflow.

---

## 1. They have eight bad phone photos

**Executed.** Eight portrait phone frames, seven `RECOVERY_GRADE`, one
`REFERENCE_ONLY`.

- `recommend` read the audit and proposed `RESTRAINED` imagery — the site is not
  given a grammar that needs a photograph to carry a full-bleed composition.
- `check` reported `INPUTS READY`. Nothing blocked.
- `shotlist` asked for five frames: one landscape completed-job (every supplied
  frame was portrait), two workmanship details, one before state for the featured
  job, and one frame for the service nothing showed.
- `compose` published three projects and seven assets, and named the unpublished
  one.

The site is buildable on day one and gets better as the shot list closes.

## 2. They have sixty excellent projects

**Executed at a hundred**, with forty services. `ARCHIVE` mode: featured records
keep the editorial composition, every record appears as a filterable row, and the
reading budget folds the tail. 148 static pages, built in five seconds.

The stress build is what found the page-cap contradiction — see the
[adversarial review](tradies-adversarial-review.md).

## 3. They have eleven services

**Executed at ten and at forty.** Grouped: a real heading level per group on the
index and in the navigation panel. Ungrouped past eight: still valid, and
`ungroupedAtScale` tells the operator, because the usual cause is that nobody
asked the grouping question.

## 4. They have no testimonials

Nothing happens. TESTIMONIALS has been optional since before this milestone and
`compose` never emits one. A business whose customers will not be quoted has no
empty heading where quotes would go.

## 5. They have no project descriptions

`projects[].summary` is required by the intake, and the message says what it is:
the client's own one-paragraph account. If they cannot give one, the honest
options are a one-line factual summary the operator can write truthfully from
what they *did* say — the trade, the suburb, the year — or not recording that job.

A project whose only story block would be its own summary gets exactly that, in
the client's words. Nothing is invented to fill a page.

## 6. They already have a brand system

`brandConstraints.hasExistingBrand`, `lockedColours` and `lockedTypefaces` record
it, and the palette hexes go straight into `profile.brand`, where the contract
measures their contrast.

**Named limitation.** `lockedTypefaces` is recorded but not consumed: the brief
resolves five typographic characters to system stacks, so a generated site ships
no webfont request. A client with a licensed face is a one-line edit to the
generated stylesheet, and it is a manual step. See
[deferred](#deliberately-deferred) below.

## 7. They have almost no brand

`brandReality: NONE` → the recommendation proposes a plain, high-contrast
identity built from the trade's own material, and says so in `palette.direction`.
That is the common case, not the exception.

## 8. P1 is sufficient

**Executed end to end.** A four-service, three-job plumber: `start` → fill →
`check` → `recommend` → `shotlist` → `compose` → `p1` → `assemble` → `build`.
Fifteen static pages. The service detail rendered three decision panels — the
three it had truth for — with zero occurrences of "not stated".

And the small client paid for none of the new machinery: no archive markup, no
facet CSS, no second navigation level, no `childPages` import, no scroll
listener, no animation-frame loop. Asserted by test, and verified in the built
artifact.

## 9. They bought P2

**Executed.** `creative:prepare` ran against the plumber's build package and
assembled artifact: source policy inspected 13 files, the artifact's own handoff
verifier passed, the source set matched exactly, and it published a workspace in
**design mode B** — no provider required. From there the path is unchanged:
territories, Creative Gate, `creative:launch`, parity slice, `creative:verify`.

## 10. They bought flagship

Same bridge, one more human gate, a larger review budget. Nothing in this
milestone changed the premium path, and its 67 tests pass unchanged.

**Honest scope note.** No P3 Tradie has been delivered. What is proven is that
the seam holds and the tier's obligations are written down, not that a flagship
Tradie site exists.

## 11. They reject the first creative direction

`creative-configuration.json` is edited and re-approved; `recommend` refuses to
overwrite a file somebody has already decided on, so a rejection is an edit
rather than a regeneration.

If the rejection lands after P1 is built, `tradie p1` refuses to write over
authored source and says to move it first. That refusal is deliberate — the
generated tree becomes the client's the moment anyone edits it — and it is the
same guard that has a regression test from the previous milestone.

## 12. Contact credentials are not ready

The definition carries a `secretReferenceId`, never a secret. The site builds,
assembles and previews without one; the form needs the value at deploy time, and
[contact-production-gate.md](../runbooks/contact-production-gate.md) covers it.

A phone number that is not in international format is refused at intake, and if
one is absent the site renders a stated absence rather than a link that will not
dial.

## 13. One media fact is unverified

`approvedForPublication: false` and it is not published. `compose` counts what
was received and not used. A project left with no publishable asset that may
carry a job claim is **not published**, and it says so by name — so the operator
finds out at compose rather than at review.

## 14. They add another service or project later

An intake edit and a re-compose. `compose` rewrites the generated definition and
never touches authored source.

If the service count crosses seven, the header grows its second level on the next
build. If the job count crosses twelve, the archive appears. Nobody has to decide
to add either, because the thresholds live in one file that every consumer reads.

---

## Deliberately deferred

Named, with the reason, rather than left to be discovered:

| | Why |
|---|---|
| **Licensed typefaces** | Recorded in `lockedTypefaces`, not consumed. A generated site ships no webfont request by design; adopting one is a stylesheet edit and a licence decision. |
| **A media uploader or storage product** | Out of scope by the inherited contract. The client sends files however they already do; `compose --media` copies them. |
| **Result-count announcement in the archive** | Needs a script. Each facet label carries its count instead, so the size is known before choosing. |
| **Escape-to-close on the navigation panel** | It is a disclosure, not a menu, and the disclosure pattern does not include Escape. |
| **Media inside the navigation panel** | A premium addition. P1's budget does not permit twelve preview images. |
| **Reverse shared-element continuity, notation-on-media, zero-specificity reset** | Still one client's evidence each. Unchanged from the post-Stone disposition. |
| **A P3 Tradie delivery** | The seam is proven; a flagship is not. |

## 15. It reaches production

**Executed against the deployment contracts**, with the deterministic provider
and no credential: the composed configuration passes the shared runtime
validator, a deployment intent builds from it, execution produces an observed
manifest, re-running the same intent is idempotent, delivery mode stays
`MANAGED_ISOLATED` until handoff completes, and secrets travel as references.

The artifact's own verifier — the command a client runs after taking ownership —
reports `handoff integrity PASS: 163 files`.

**Not proven:** no site was deployed to Vercel. That needs a credential and
publishes to the internet.

---

## Where the claim is weakest

Three honest places:

1. **No real client has been through this.** Everything above was executed
   against synthetic businesses. Synthetic fixtures cannot produce the thing a
   real client will: an answer nobody anticipated the shape of.
2. **The visual refinement is not designed.** The archive cell, the navigation
   panel and the decision panels are structurally correct and typographically
   ordinary. They are meant to receive a real client's creative direction, not to
   be the Tradies look.
3. **Intake takes as long as it takes.** Nothing here makes a client answer
   faster. What it does is make the questions answerable without design
   knowledge, and make the gaps visible with an owner attached.

The behaviour *is* now verified in a real browser — sixteen claims in Chromium at
1440 and 390, including hover, keyboard, reduced motion, touch depth and the
accessibility tree. That pass is a one-off script rather than a committed suite:
the Platform still owns no browser automation, and adopting one remains out of
scope. It found four defects nothing else had.
