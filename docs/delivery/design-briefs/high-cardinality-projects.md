# Design brief A — high-cardinality project archive

For the Tradies workflow's targeted design phase. **A brief, not a design.** Do not
implement a layout from this document; answer its questions in a design study
first.

## Problem

The proven collection instruments — a horizontal reel and a staggered index — are
correct at 1, 3, 5, 8 and 12 records and are not a design for 60. At that count the
index becomes a very long page and the reel becomes a very long run. Neither
degrades into something wrong; they degrade into something *tedious*, which is
harder to notice in review and worse for a visitor with a specific job in mind.

A visitor to a 60-project site is not browsing. They are asking "have these people
done my job, near me?" — which the curated composition does not answer at all.

## Semantic inputs available

- Project records: title, slug, story blocks, media, `locationLabel`.
- `serviceIds` — a **real** relation, already read backwards by service routes to
  list their own evidence. One hop from filtering.
- Featured or not, if the definition gains the concept.
- No declared taxonomy exists today. Whether one should is question 2 below.

## Scalability ranges to design against

| Range | Expected shape |
|---|---|
| 1–3 | Must not look broken or empty. The hardest case to get right and the easiest to forget |
| 4–12 | Curated storytelling — proven |
| 13–25 | The transition zone. Where the composition should change rather than lengthen |
| 26–60 | Archive with retrieval |
| 60–100+ | Archive with retrieval and performance strategy |

## Questions the design study must answer

1. **Where is the threshold** at which composition changes rather than lengthens,
   and is that threshold a client decision or a Platform one?
2. **Are categories a new declared vocabulary, or derived** from `serviceIds` and
   `locationLabel`? Deriving avoids asking clients to invent a taxonomy; declaring
   allows one that matches how they actually sell.
3. **Is a filtered view a URL or client state?** A URL is crawlable, linkable and a
   page-graph entry — which makes it a routing change, not a component change. This
   is the question with the largest architectural consequence.
4. **Does the record set stay one route or gain pages?** Also a page-graph change.
5. **What does an empty filter result say** on a site that refuses to invent
   content? A "no results" state is content, and it must not imply the business
   lacks capability it has.
6. **Does curated storytelling survive alongside the archive**, and if so is the
   curated set authored, derived from `featured`, or the most recent N?
7. **What is the retrieval mechanic** — pagination, load-more, virtualisation — and
   what does each cost in crawlability and in reading position on return?

## Accessibility requirements

Filter controls are real form controls with real labels. Result count changes are
announced. Focus position on filter change and on load-more is defined, not
incidental — appending records must not move the reader or lose their place.
Keyboard traversal of a 60-record set must not require 60 stops to pass it.

## Mobile requirements

Retrieval must work at 390 without a horizontal instrument. A filter interface at
390 is a panel or a sheet, not a sidebar. Recomposition, not stacking.

## Content and truth constraints

No invented categories, no invented counts, and no "similar projects" relation the
definition does not carry. If a project has one photograph, the archive cell must
work with one photograph.

## Explicitly out of scope for the study

Search. It is a different problem with a different failure mode, and a filtered
archive should be proven before a query interface is considered.
