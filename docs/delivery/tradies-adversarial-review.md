# Adversarial review — Tradies Profile V1

**Codex integration status.** The official Codex Claude Code plugin is **not
installed** in this environment (no `~/.claude/plugins`). A `codex` binary and an
authenticated `~/.codex/auth.json` are present, but invoking it directly is a
different act from the integration the milestone conditioned on: it would send
this repository's source to an external service, which nobody asked for. So this
is a fresh internal adversarial pass, run against the built result rather than
against the intent, and its findings were fixed before the package was cut.

The review question: *challenge whether Tradies Profile V1 is actually ready for
the first paid client — Stone & Line overfitting, hidden manual steps,
high-cardinality failures, media and intake gaps, truth duplication, premature
Core promotion, accessibility or runtime regressions, and places where the
operator still has to remember undocumented workflow.*

---

## Findings, and what happened to each

Eight, the last of which only a browser could have found.

### 1. The home page rendered everything — **fixed**

At forty services and a hundred jobs the home route printed all of them. Nothing
had told it not to; the composition was written when three was the interesting
number.

A home page is an argument, not an index. Six services and four jobs now, the
agency's `featured` selection first and position only as a fallback. Found by
building the stress fixture, not by reading the code.

### 2. Two page caps contradicted each other — **fixed**

`WebsiteProjectCollectionSchema` allows 250 records. The v2 cross-validator
requires every published project to have exactly one detail page.
`WebsitePageGraphSchema` capped pages at 128. The real project ceiling was
therefore about 120, and the failure surfaced as `pages: too big` at assembly —
a message no reader of the project contract could have predicted.

Raised to 256, with the arithmetic written into the schema. `compose` now also
reports the page count as it approaches the ceiling, so the ceiling is visible
before it is hit. This was a **pre-existing** latent defect that only a
high-cardinality build could surface.

### 3. Activating "show all" took the reader's focus — **fixed**

The archive's reveal control was hidden by CSS the moment it was checked, which
drops focus to the top of the document. The control now stays and its label
changes to "Show fewer", which also changes its accessible name. Never hide a
focused element.

### 4. The archive filter shipped inside a raw `<form>` — **fixed**

Caught by the Platform's own client experience source policy
(`UNSAFE_MARKUP_FORBIDDEN`) at the first assembly of the second-context client.
Nothing was being submitted; the form was decorative grouping. Replaced with
`fieldset` and `legend`, which is what a screen reader needed anyway.

The generated tree is now inspected by that policy in
`scripts/tradies/tradies-workflow.test.ts`, so it cannot regress silently.

### 5. Copying the client's photographs was still a manual step — **fixed**

`tradie compose --media <dir>` copies every approved file to the path the
definition already names. It checks all of them before copying any, so a missing
file is a refusal that leaves nothing half-written. Copying by filename is
exactly the operation that puts the wrong photograph beside a named job.

### 6. Two suburb names collided with the first premium client's fixtures — **fixed**

Not brand, copy or geometry, but close enough to invite the question. Renamed.

### 7. The scaffold handed the operator errors for questions they had no answer to — **fixed**

The blank workspace emitted optional fields as empty strings, which then failed
validation as "must be a non-empty string when present". An empty optional string
is not "no value", it is a malformed value. Optional fields are now omitted and
the README names them. Found by the clean-room simulation.

### 8. Filtering pulled route payloads nobody asked for — **fixed**

Found by driving the built site in a real browser. The filter runs no
JavaScript, but the framework prefetches a route payload for every link that
enters the viewport, and changing a facet re-lays the list out — so one facet
change pulled **twenty payloads for five routes**, and narrowing then restoring
pulled thirty-two.

Measured against a control: plain scrolling of the same archive caused eight.
So the filter was genuinely more expensive than reading, which is the opposite
of the point.

Archive rows now pass `prefetch={false}` — a field the Platform's link contract
already carried, so no Core change was needed. The curated records above the
archive keep prefetching, because a handful of featured jobs are likely
destinations and a hundred archive rows are not. Re-measured: four prefetches
where scrolling causes seven.

The documentation had claimed "no request is made when a facet changes". That
was wrong as written, and is corrected.

---

## Challenges that did not produce a finding

### Stone & Line overfitting

Grepped every reusable file for the first premium client's names, truth,
suburbs, mechanics and geometry. What remains is three references in
`scripts/creative/` that predate this milestone and describe *process lessons*
("the distinction Stone & Line lost"), which is the correct way to carry a lesson.

Nothing in the Tradies profile, the delivery tooling or the generated source
carries that client's composition, palette, notation or imagery. The archive is
rows; the service page is panels; the navigation is a native disclosure. None of
those is that client's grammar.

### Premature Core promotion

**No component was promoted.** What entered the Platform is:

- schema fields, all optional;
- one pure decision module with no markup (`collection-scale.ts`);
- one page-graph helper that reads an existing relation (`childPages`);
- generator changes that emit **client-local source**.

The promotion ladder governs mechanics that would become every client's default.
A generated archive lives in the client's own tree and can be deleted by editing
their source. `collection-scale.ts` is a threshold table, and the alternative to
one shared table was three emitters each inventing a number privately.

### Truth duplication

The starter brief can still carry `serviceNarratives` alongside a definition's
`narrative`. The generator prefers the definition, so the two cannot disagree on
the page — but the brief remains a place where a second copy could be typed.

Judged acceptable and left: the brief entry exists for editorial the definition
has nowhere to hold, removing it would take capability away from clients whose
definitions carry no narrative, and the precedence rule is written into the
emitted source where an operator reading the route will see it.

`copy.homeEyebrow` restates `display.businessName`. It is copy, and an operator
editing it is doing the intended thing.

### Runtime and dependency growth

Zero dependency changes across the milestone (`git diff aeedbb5..HEAD --
'**/package.json'` is empty). Every import added under `scripts/tradies/` is a
`node:` builtin or a relative workspace path. The delivery contracts live in
`scripts/` rather than `packages/contracts` **because that package's `dist` is
vendored wholesale into every client artifact** — a module added there would ship
to every website whether or not anything imported it.

### Accessibility

- Filter controls are real radios with real labels and a visually-hidden
  `<legend>`; the input is never `display: none`, so it stays focusable, and
  `:focus-visible + label` gives it a visible ring.
- Filtered-out rows are `display: none`, which correctly removes them from the
  accessibility tree as well as the page.
- The navigation is a native `<details>` — expanded state exposed, Enter and
  Space, no hover, nothing animated, and the trigger is not the destination.
- Every link is a real `<a href>` a crawler can follow.

The one thing a script would buy — announcing a changed result count — is
declared rather than hidden, and the counts are in the labels instead.

### Hidden manual steps that remain

Three, all named in the first-client document rather than discovered:

1. Writing the eight editorial copy fields. A generated headline is a claim
   nobody made.
2. Auditing each asset. That is a judgement, and it is the judgement the whole
   contract exists to record.
3. Adopting a licensed typeface, if the client has one.

Everything else — hashes, manifests, page graphs, route ids, asset copying,
definition validation, the truth ledger — is done by a command.
