# Tradies Profile V1

What a contractor website can now say, how it holds together at the size real
trade businesses actually are, and where each decision lives in the source.

This supersedes the open questions in
[tradies-workflow-v1-contract.md](tradies-workflow-v1-contract.md) and closes
design briefs [A](design-briefs/high-cardinality-projects.md),
[B](design-briefs/large-service-architecture.md) and
[C](design-briefs/visual-navigation.md).

**Scope.** Builders, electricians, plumbers, landscapers, roofers, painters,
cleaners, HVAC, carpentry, concreting, fencing, automotive and other local
service contractors whose customer genuinely arrives with a job in mind. A
business whose customer journey does not fit that shape belongs in a different
profile, not in this list. The closed list is `TRADES` in
`scripts/tradies/intake-contracts.mjs`, and it is closed because the shot-gap
derivation and the readiness report both branch on it.

---

## 1. What is required, and what is merely possible

A CONTRACTOR profile requires SERVICES, TRUST_SIGNALS, PROCESS, FAQ, CONTACT and
ACTIONS. Every one of those is something the business *is* — what it does, on
what terms, how it works, how to reach it.

GALLERY and TESTIMONIALS remain deliberately optional, and their absence is the
rule rather than an omission. Both are evidence, and a business that has not
traded yet or whose customers will not be quoted has neither. Requiring the
section never produced evidence; it produced a placeholder standing where
evidence would go, which a reader cannot tell apart from the real thing.

**Nothing added in V1 is required.** Every field below is optional, every list
defaults to empty, and an empty list renders as nothing.

| Capability | Where | Required? |
|---|---|---|
| Service decision content | `WebsiteServiceItem.decision` | No |
| Service long read | `WebsiteServiceItem.narrative` | No |
| Service groups, one level | `WebsiteServiceSection.groups` + `item.groupId` | No |
| Service prominence | `WebsiteServiceItem.featured` | Defaults false |
| Project prominence | `WebsiteProject.featured` | Defaults false |
| Completion year | `WebsiteProject.completedYear` | No |
| Second navigation level | derived from `parentPageId` | No |

## 2. SERVICE_DETAIL as a customer decision page

`WebsiteServiceDecisionSchema` in `packages/site-core/src/profile-content.ts`.

A visitor with a specific problem needs to know whether to call. Eight lists and
one action carry that, and every one of them may be empty:

| Field | The question it answers |
|---|---|
| `suitedTo` | What job types and situations is this the right answer to? |
| `covers` | What does the service actually include? |
| `excludes` | What does it **not** cover, and where does the business stop? |
| `whenToCall` | What means I should make contact now? |
| `stages` | What does the process look like? |
| `customerProvides` | What do I have to supply — information, material, access? |
| `commercial` | What is genuinely known about cost, and on what terms? |
| `questions` | What does this service actually get asked? |
| `nextActionId` | What is the appropriate next step? |

Two of the milestone's eleven questions are deliberately **not** fields:

- *What projects prove this?* is already the backward relation from
  `WebsiteProject.serviceIds`, read by `projectsForService`. A second copy of a
  relation is a second place for it to disagree.
- *Is this relevant to me?* is answered by `title`, `description` and `suitedTo`
  together. A field for it would only ever restate them.

### The honesty mechanism

An empty list renders as nothing. That is the whole of it. A service page with
truth for four questions shows four panels; the alternative — a required field
per question — produces "not stated" printed nine times, which is SEO filler
wearing a decision page's clothes.

Verified on the second-context build: the roofing fixture's rich services render
seven panels and its thinner ones render five, with zero occurrences of "not
stated".

### Known, unknown, and not applicable

The distinction is real, and it lives in the **delivery layer, not the website**.
A visitor sees the same page whether a boundary is unstated because nobody asked
or because there genuinely is none. The operator does not: `readinessReport`
raises `SERVICE_BOUNDARY_UNSTATED` with the client as its owner, and it never
blocks. Modelling it in the published schema would have added a required
declaration to every service to record something no reader can see.

`nextActionId` is cross-checked against the profile's declared ACTIONS, so a
service can never point a visitor at a contact route the business has not
configured.

## 3. Services at higher cardinality

`resolveServicePresentation` in `packages/site-core/src/collection-scale.ts`.

**Do services group? Yes. Is a group a page? No.**

A business with twelve services almost never has twelve peers. It has a few
things it is known for, each with variants underneath, and presenting that flat
is an information-architecture failure no layout repairs.

A group is a heading with a list — on the services index, and in the navigation
panel. It is **not** a route, because a group page's content is its children's
content, which means either duplicated copy on two routes or a thin page that
exists to hold links. Both are worse than the heading.

Depth is bounded by the shape of the schema rather than by a rule: there is no
`parentGroupId`, so a second level cannot be expressed. A recursive taxonomy is a
maintenance surface no trade business has needed, and every recursive taxonomy
eventually acquires a level nobody can render.

| Count | What happens |
|---|---|
| 1–8, ungrouped | Flat list. Unchanged from before V1. |
| 9+, ungrouped | Still valid — a business may genuinely have peers — but `ungroupedAtScale` is reported, because the usual cause is that nobody asked the grouping question at intake. |
| Any count, grouped | A real heading level per group, with the ungrouped remainder under "Also available". |

### When a service deserves a route

`deservesServiceDetailRoute` — **two decision answers**, counting project
evidence as one. Two rather than one because a page carrying a single answer is
a row that has been given a URL, and a reader who follows a link to find one
sentence trusts the next link less.

This is **advisory and never enforced by a validator**. The page graph is
authored, a thin service today may be rich next week, and refusing would
invalidate definitions that are already live. `composeDefinition` applies it when
it builds a page graph; a hand-authored graph is free to disagree.

## 4. Projects: curated storytelling and browsable archive

`resolveProjectPresentation`.

| Range | Mode | Archive | Filtering | Retrieval |
|---|---|---|---|---|
| 1–7 | `CURATED` | no | no | none |
| 8–12 | `CURATED` | no | yes | none |
| 13–24 | `TRANSITIONAL` | yes | yes | none |
| 25+ | `ARCHIVE` | yes | yes | progressive |

Twelve is where a composition told as a story stops reading as a story. Twenty-
five is where a reader stops browsing and starts looking for their own job.
Eight is where a filter starts paying for its control, its label, its empty state
and its focus contract — below that a filter is theatre.

In `CURATED` mode the whole set *is* the composition, so there is no archive
beneath it; an archive there would be the same records printed twice.

### The curated set is authored

`featured`, not recency and not the first N. A trade business's most persuasive
job is frequently not its newest one, and deriving prominence from recency hands
editorial control to whatever happened to finish last.

### Categories are derived, never declared

There is no category vocabulary and there will not be one. Facets come from
`serviceIds`, `locationLabel` and `completedYear` — relations the definition
already carries. A business asked to invent a taxonomy invents one that
duplicates its own service list and then drifts from it, and asking at all
contradicts the done-for-you principle: the client answers factual questions, not
information-architecture ones. `serviceIds` is also how a trade customer already
thinks — "have you done a re-roof?"

A facet with fewer than two values is omitted. A control with one option is a
label pretending to be a choice.

## 5. The archive at P1, and what it costs

Rows, not a second grid of photographs. A visitor at this point is retrieving,
not browsing, and a row carrying title, area, year and services answers the
question in one line where an image grid answers it in a scroll. A hundred
records cost a hundred lines rather than a hundred image requests.

**No JavaScript.** The filter is a radio group matched in CSS through `:has()`,
one rule per declared service. Every record's link ships in the initial HTML
whether or not it is currently shown, so a crawler sees the whole archive and no
request is made when a facet changes. The reading budget is a second CSS rule
that applies only while "all work" is selected, so a narrowed set is always shown
in full and the two mechanisms can never fight over one row.

**Is a filtered view a URL or client state?** Client state. A route per facet
would add a thin page per service to the page graph; a query string is not
statically pre-rendered in this architecture and would buy linkability at the
cost of crawlability. Since every record is present regardless, the retrieval
problem here is attention rather than bytes, and attention does not need a URL.

**The limit, stated rather than hidden.** With no script there is nothing to
announce a changed result count. Each facet label therefore carries its own
count, so a reader knows the size of a set *before* choosing it. A premium
delivery that wants live announcement is adding a script, and that is a
deliberate decision at that tier.

## 6. Navigation

`resolveNavigationPlan`, and the emitted `NavigationSection`.

**Where does the second level live? The page graph.** `parentPageId` already
exists and is already validated. Reading it backwards costs nothing and means the
menu and the site cannot disagree — no service present on the site but missing
from the menu, no menu entry pointing at a removed page. A panel authored beside
the graph is a second list of the same destinations, and the second list goes
stale.

**Is it a menu or a disclosure? A disclosure**, and native `<details>` at that.
A menu implies application semantics, arrow-key traversal and an Escape contract.
This is a control that shows and hides content. `<details>` exposes its expanded
state, opens on Enter and Space, and never opens on hover.

| Requirement | How it is met |
|---|---|
| Every destination reachable by keyboard | Real links inside a native disclosure |
| Expanded state exposed | Native `<details>` |
| Nothing hover-only | `<details>` does not respond to hover at all |
| A pointer must not lose the panel | Nothing closes on pointer-leave |
| Touch: expand or navigate, never both | Two controls — the summary expands, the first panel link goes to the section |
| Reduced motion | Nothing animates on open |
| Crawlable | Real `<a href>` throughout |
| Mobile | The same panel, inline inside the existing collapsed menu |

**Escape does not close it.** The WAI-ARIA disclosure pattern does not include
Escape, and adding it would need a script. This is a disclosure and is stated as
one. A premium delivery that builds a true menu takes on the menu contract.

### When it appears

Off by default. Expanded when a business has **seven or more services**, or **any
declared group** at any size. Below that a panel shows a reader what one click
would have shown them anyway.

### What goes in it

- **Services**: the declared groups and their services, or the featured services,
  or all of them — capped at eight, with an "All services" link always present.
- **Projects**: the records the agency selected, and **nothing when none were
  selected**. Fifty job links in a dropdown is slow, unusable on a phone, and
  answers a question the filtered archive answers properly.
- **No images.** A navigation carrying twelve previews has a loading strategy or
  a performance defect, and P1's budget does not permit one. A contextual media
  stage in the panel is a premium addition, not a P1 default.

Service groups apply only where a section's children are services, so a job is
never filed under a heading that means nothing about it.

## 7. What P1 still does not pay for

Verified by test, not assumed. A business with four services and three jobs
receives:

- no archive region and no facet markup;
- no facet or archive CSS;
- no second navigation level and no `childPages` import;
- no scroll listener and no animation-frame loop;
- no raw `<form>` anywhere — the client experience source policy refuses one, and
  the archive filter is a `fieldset` because nothing is submitted.

## 8. Where each decision lives

| Decision | File |
|---|---|
| Service decision content, groups, prominence | `packages/site-core/src/profile-content.ts` |
| Project prominence, completion year, relations | `packages/site-core/src/project-content.ts` |
| Every cardinality threshold, stated once | `packages/site-core/src/collection-scale.ts` |
| Second navigation level | `packages/site-core/src/page-graph.ts` (`childPages`) |
| What the generator does with all of it | `packages/experience-starter/src/scale.ts` |
| Portable mirror for client artifacts | `apps/managed-web/src/runtime-types.ts` |

The thresholds are in one file on purpose. Three implementations were each about
to invent their own, and the count at which a composition should change rather
than lengthen is not a detail an emitter should decide privately.
