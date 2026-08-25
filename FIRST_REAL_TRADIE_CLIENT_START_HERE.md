# A Tradie said yes. Start here.

Everything you need after a contractor signs, in the order you need it. You
should not have to read anything else to deliver the first one.

**Working directory** is the Platform repository:
`~/Projects/web01b-implementation/proportion-web-platform`.
**Before any command in this document**, activate the toolchain — the repository
needs Node 24.18.0 and the machine default is not it:

```bash
cd ~/Projects/web01b-implementation/proportion-web-platform
nvm use          # reads .nvmrc → 24.18.0
```

Throughout, `$WS` is the client's delivery workspace. Keep it **outside** the
Platform repository, one directory per client:

```bash
export WS=~/Projects/web01b-implementation/CLIENTS/northgate-roofing
```

---

## 0. Try it once on a fake client first

Ten minutes, and you will never again wonder what a command prints.

```bash
export WS=/tmp/demo-tradie
pnpm tradie demo    --into $WS        # a fictional roofing business, 10 services, 34 jobs
pnpm tradie check   --workspace $WS
pnpm tradie shotlist --workspace $WS
pnpm tradie compose --workspace $WS
```

Then delete it. Nothing you do to it touches a real client.

---

## 1. The same day they say yes

### Send them one message

> Great — here's what I need from you, and here's what I don't.
>
> **What I need:**
> 1. Answers to some questions about your business — what you do, where you work,
>    what a job actually involves. No marketing writing. Just facts.
> 2. **Every photo and video you have.** Do not sort them, do not pick the good
>    ones, do not worry about quality. Phone photos are fine. Half-finished jobs
>    are fine. Send the lot.
> 3. Your logo files if you have them, and anything printed — flyers, vehicle
>    signage, quotes.
>
> **What I don't need from you:** which photos are best, what colours the site
> should be, how the pages should be laid out, or any copy. That's my job. Once
> I've seen everything, I'll tell you what's missing and propose a direction for
> you to approve.

That message is the product. Everything below exists to make it true.

### Open the workspace

```bash
pnpm tradie start --client northgate-roofing --into $WS --name "Northgate Roofing & Metal"
```

Five JSON files and a README that says who answers each one. Fill
`sale-handoff.json` **now**, while the sales conversation is fresh — especially
`commitments`. That field is required and usually empty, and an empty list is a
positive statement that nothing extra was promised. Every delivery that goes
wrong on scope goes wrong in that field.

---

## 2. Before you ask the client for anything: read the business

Fill `business-read.json` yourself, from public sources. This is the step that
lets you ask better questions and stops you asking for things you can see.

Look at: their current site, their Google Business profile and reviews, their
social accounts, two or three competitors ranking in the same suburbs.

Two rules the file enforces:

- **Every observation names a source and a date.** The Factory never looks
  anything up at build time; what you observed and when is a recorded fact.
- **An observation is either `VERIFIED_PUBLIC_FACT` or `INFERRED_OPPORTUNITY`,
  never a client fact.** "Their site doesn't mention metalwork" is the first.
  "Metalwork is the position worth taking" is the second, and it can inform the
  creative direction but can never be printed as a fact.

Then record `brandReality` (do they already have an identity worth keeping?) and
`trustStrategy` (do they win on credentials, on the work, on relationships, or
on scale?). Both feed the creative recommendation.

---

## 3. Client intake

Send them `client-intake.json`'s questions in whatever form suits them — a call
you transcribe is usually fastest. Fill the file yourself from their answers.

Per service, you want:

- what it covers;
- **what it does not cover** — this is the one everybody skips and the one that
  saves both of you a wasted site visit;
- what kinds of job it suits;
- when someone should call;
- what the customer has to provide;
- the stages of the job;
- anything they will actually publish about price, and on what terms;
- the questions this service really gets asked.

Empty is a legitimate answer for any of them. A service page shows what there is.

**Credentials need care.** Each one records `evidence: SIGHTED | STATED` and an
`approvedWording` string. If you have seen the certificate, `SIGHTED`. If they
told you, `STATED` — and the site publishes only the wording they approved. A
licence number printed from a field you typed is a claim *you* made.

Group services if the business genuinely groups them. Nine peers presented flat
is a structure problem no layout fixes. Do not invent groups where there are
none.

---

## 4. Media: they send, you judge

They send everything. You fill `media-inventory.json`, one entry per asset:

| Field | What it is |
|---|---|
| `subject` | What it is *of* — completed work, before state, team, vehicle, premises, detail, signage, logo |
| `audit` | What it is *worth*: `PROOF_GRADE` (substantiates a specific claim), `SALES_GRADE` (good enough to sell with), `RECOVERY_GRADE` (usable after work), `REFERENCE_ONLY` (tells you something; never published) |
| `provenance` | Where it *came from* |
| `lane` | How it was produced |
| `substantiates` | What claim it is allowed to stand behind, and for a job claim, which job |
| `focalPoint` | What matters in the frame, `{x, y}` in 0–1. You decide this; nothing guesses it later |
| `alt` | What a published photograph shows. Required once approved |
| `approvedForPublication` + `approvedBy` | Your name. Not "agent", not a tool |

**Grade and provenance are separate on purpose.** A blurry real photo of a
finished roof can be the most valuable image on the site. A beautiful generated
one is worth nothing as proof and is actively harmful beside a claim — a reader
who suspects one photograph stops believing the whole page.

The contract refuses anything that crosses the line:

- generated media standing behind a named job;
- a materially recomposed image claiming a specific job (it may carry atmosphere);
- an enhanced asset that does not name the real asset it came from;
- `REFERENCE_ONLY` material approved for publication;
- a non-human approver.

### Choosing the production lane

| If | Lane |
|---|---|
| The photo is fine as shot | `SUPPLIED` |
| It needs crop, exposure, colour or a distraction removed — the subject stays real | `AI_ENHANCED`, naming the source asset |
| It needs the frame materially rebuilt | `AI_RECOMPOSED` — and it can no longer claim the job |
| Nothing usable exists and the shot matters | `COMMISSIONED`, or ask the client to take it |
| You want atmosphere or a texture, not evidence | `AI_GENERATED_SUPPORTING` |

None is superior. Most Tradie deliveries are mostly `SUPPLIED` plus a handful of
`AI_ENHANCED`, with `COMMISSIONED` reserved for a hero the site depends on.

---

## 5. Tell them exactly what is missing

```bash
pnpm tradie shotlist --workspace $WS
```

Writes `$WS/shot-list.md`: a list of specific frames, each with a subject, a
framing, a count, and **what claim it would substantiate**. Derived from the site
you are actually building — pages that have nothing behind them, jobs with no
evidence, services nothing shows.

Send it as jobs, not as feedback. Never send "better photos of your work".

They can shoot the list themselves, you can commission it, or you can drop the
records that cannot be supported. All three are fine, and `compose` will tell you
which projects it could not publish.

---

## 6. Propose the creative direction

```bash
pnpm tradie recommend --workspace $WS
```

Writes `creative-configuration.json` as a **draft**, with its reasoning printed.
It reads the business read, the intake and the media audit, and proposes palette,
typography, density, image treatment, motion appetite and proof emphasis.

The important one is `imageTreatment`, and it comes from **media reality**: fewer
than five strong approved assets gives `RESTRAINED`, twelve or more gives
`DOMINANT`. A site whose best material needs work must not be given a grammar
that depends on a photograph carrying a full-bleed composition. That is a
decision made here, not a disappointment discovered at production.

Edit the draft. Set `derivedBy` to your name. Then take it to the client and get
approval of **representation and direction** — how the business is presented, not
where things sit on a page. Set `clientApproval.approved`, `approvedBy` and
`approvedOn`.

The file cannot record any other kind of approval: `scope` is a constant.

### Choosing the tier

- **P1** — the business needs to be findable, credible and contactable, and its
  material is ordinary. Most trade businesses. P1 is a complete commercial
  product, not a stripped one.
- **P2** — the business has a real differentiator its current presence hides, and
  enough material to carry it. Adds creative exploration, a parity slice and two
  more human gates.
- **P3** — the site is part of the offer. Motion may become narrative; the real
  difference is the review and testing budget.

---

## 7. Inputs ready

```bash
pnpm tradie check --workspace $WS
```

Read-only, safe at any time, and the command to run whenever you are not sure
what to do next. Every gap it reports carries **who has to close it**.

`INPUTS READY` means the Factory has what it needs. Only six things block:

no sale handoff · no client intake · no media dump · no creative configuration ·
no approved media · reference-only material approved for publication.

Everything else — an unstated boundary, an unsighted credential, no work
examples — is reported and makes the site weaker rather than impossible.

---

## 8. Build P1

```bash
pnpm tradie compose --workspace $WS --media ~/Downloads/kellow-photos
```

`--media` is the directory the client's files actually live in. Every approved
asset is checked before anything is copied, so a missing file is a refusal
rather than a half-filled package. Leave the flag off and you copy them yourself.

Writes `$WS/build/client-website.json` (validated by the Factory's own
contracts), `$WS/truth-ledger.json` (where every published fact came from), and
`$WS/starter-brief.json` — with every design decision already filled in from the
approved creative configuration, and eight copy fields marked `TODO —`.

Read the warnings. A project with no publishable asset that may carry a job claim
is **not published**, and it says so by name.

Then:

1. **Answer the eight TODO fields.** They are the headline, the lede, the two
   section ledes, the closing line, the footer statement, the 404 body, and the
   provenance caption. `p1` refuses a brief that still carries one, because a
   placeholder that can reach production is worse than a blank.
2. If you did not pass `--media`, copy the approved files into
   `$WS/build/public/` at the paths `media-inventory.json` gave them.

```bash
pnpm tradie p1 --workspace $WS
```

Generates `$WS/build/experience/` — ordinary client-owned source with no runtime
relationship to the Factory. Edit it freely from here.

### Assemble and look at it

```bash
pnpm --filter @melbourne-local-growth-ops/managed-web assemble:client -- \
  --input $WS/build --output $WS/artifact --factory-revision "$(git rev-parse HEAD)"

cd $WS/artifact/source && pnpm install && pnpm build && pnpm start
```

Assembly runs the source policy, typecheck and a build. If it refuses, it names
the file and the rule.

---

## 9. If they bought P2 or P3

P1 is the baseline the premium path starts from. The three commands are
unchanged; `pnpm creative:<command> --help` prints exact flags.

```
creative:prepare   → a source-bound workspace with the delivery artifacts to fill
   ↓  creative exploration — any tool, or none. Claude Design is never required.
HUMAN DIRECTION GATE      ← a named person signs
   ↓  parity slice: home, one service detail, one project detail, mobile at 390
HUMAN PARITY GATE         ← rendered side by side. Does the translation hold?
   ↓  production scale — the remaining route grammar
creative:verify    → the objective report
   ↓  preview deployment
HUMAN SHIP GATE           ← signed against the report and the reviewed evidence
```

**Run the parity slice before building every route.** Stone & Line implemented
its full route set from an approved direction and preserved too much of the P1
layout; the cost was not the mistake but that every route was already built on
top of it. Pay the translation risk once, on a slice small enough to throw away.

Approved design artifacts travel inside the launch pack automatically — hashed,
listed in the read order, and the agent is instructed to render them. You do not
hunt for them.

---

## 10. Review, revise, ship

The client reviews **facts and representation**. You decide composition, type,
colour, rhythm, which photographs and how.

| Kind of change | What happens |
|---|---|
| **Factual correction** — wrong suburb, service they do not offer, wrong number | Always fixed, never counts against a revision round. Correct the intake, re-run `compose` |
| **Scoped revision** — reorder services, a different photograph from the approved set, tighter copy | Inside the agreed rounds |
| **New scope** — a page nobody sold, a service added later, a second location | Priced. Same path: intake → media → compose |
| **Creative disagreement** — "I don't like the look of it" | Your judgement, not a queue item. The direction was approved at a named gate by a named person |

Then: preview → client sees it → ship gate → production deployment → domain →
contact-form credentials → handoff. The runbooks under `docs/runbooks/` cover
each, and none of it is new infrastructure.

**The domain stays theirs.** `sale-handoff.domain.controlledBy` records who holds
it, and you should read that field before promising a launch date.

---

## 11. Afterwards

The delivery workspace is the durable record, not the built site. A change six
months later runs the same path: correct the intake, `tradie compose`,
regenerate or hand-edit, assemble, preview, ship.

If their service count crosses seven, the navigation grows its second level on
the next build. If their job count crosses twelve, the archive appears. Nobody
has to decide to add either.

---

## What must never happen

- Asking the client which photographs are good, what colours they want, or how
  the pages should be organised.
- Printing a licence, an insurance figure or a price in wording the client did
  not approve.
- Publishing a generated or materially recomposed image beside a claim about a
  specific job.
- Answering a decision question the client did not answer. A shorter page is the
  correct output; "not stated" is not.
- Signing your own work at a human gate, or letting a tool sign it.

## Where to read more

| | |
|---|---|
| What a Tradies site can say, and why | `docs/delivery/tradies-profile-v1.md` |
| The delivery path in full | `docs/delivery/tradies-delivery-runbook.md` |
| The premium half | `docs/delivery/premium-happy-path.md` |
| Why the media rules exist | `docs/delivery/media-intake-contract.md` |
| What may be reused from Stone & Line | `docs/delivery/pattern-catalogue.md`, `disposition.md` |
