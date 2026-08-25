# Collection and content contract

> **Implemented in Tradies Profile V1.** The distinctions below are now carried
> by the schema and by `collection-scale.ts`; the architecture that honours them
> is in [tradies-profile-v1.md](tradies-profile-v1.md). This document remains the
> statement of *why* the distinctions exist.

What Stone & Line proved about projects and services, frozen as requirements. This
is **not** the design of the future archive — that is a
[design brief](design-briefs/high-cardinality-projects.md). It is the set of
distinctions the next workflow must honour.

## Projects: two different jobs

| | `CURATED_STORYTELLING` | `BROWSABLE_ARCHIVE` |
|---|---|---|
| Purpose | Persuade with a few records told well | Let a visitor find a relevant record among many |
| Count | Roughly 1–12 | Roughly 15–100+ |
| Reader question | "Are these people good?" | "Have they done *my* job, near me?" |
| Failure if confused | An archive told as a story is a very long page | A story told as an archive is a grid of thumbnails nobody reads |

**A premium site with 60 projects needs both**, and they are not the same page.
Stone & Line proved the curated half at 1, 3, 5, 8 and 12. The archive half is
unproven and undesigned.

**What the Tradies workflow must explicitly solve:** high project counts; category
and filtering architecture where the count justifies it; the archive mechanic
(pagination, load-more, or virtualisation) and whether it is a URL or client state;
the relation to `serviceIds`; featured projects; and mega navigation where useful.

**Already real and reusable:** `serviceIds` on a project is a genuine relation, and
the service route already reads it backwards to list its own evidence. Filtering is
one hop from that — but a filter over three records is theatre, and nothing in the
client definition declares a taxonomy yet.

## Services: two different jobs

| | `BEAUTIFUL_SHOWCASE` | `CUSTOMER_DECISION_PAGE` |
|---|---|---|
| Purpose | Demonstrate range and quality | Let one visitor decide whether to call |
| Reader | Browsing, forming an impression | Has a specific problem, deciding |
| Failure if confused | A decision page that is only atmosphere | A showcase that reads as a specification |

A premium service detail must be both, and the showcase half is the half that gets
built by default because it is the fun half.

## The SERVICE_DETAIL decision-task contract

A real service detail must be **capable** of answering these, *when the truth to
answer them exists*:

1. Is this relevant to me?
2. What does this service cover?
3. What does it **not** cover?
4. What does the process look like?
5. When should I involve this business?
6. What will I need to provide?
7. What evidence or projects relate to it?
8. What commercial information is actually known?
9. What should I do next?

### Three rules that make this safe

**Not every field is required.** This is a semantic requirement, not a template.
Nine headed sections on a page with truth for four is worse than four.

**Never fabricate.** A question with no answer in the client definition is not
answered. Stone & Line's closure pass synthesised these answers *strictly from
existing client scope, stages, studies and FAQ*, and added no guarantee the client
had not made — that constraint is the contract, not the prose.

**Say the boundary.** Question 3 is the one most often dropped and the one that
qualifies hardest: a reader who learns what a business does *not* do either stops
wasting both parties' time or trusts the rest of the page more. The delivery that
prompted this had printed "not stated" four times instead.

### What this replaces

A service route that repeats placeholder text where truth is missing. If the truth
is missing, the *intake* is what failed — see the
[media and business intake contract](media-intake-contract.md) — and the honest
output is a shorter page plus a named gap for the operator to fill.
