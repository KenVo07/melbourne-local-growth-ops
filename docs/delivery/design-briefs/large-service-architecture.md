# Design brief B — high-cardinality service architecture

For the Tradies workflow's targeted design phase. **A brief, not a design.**

## Problem

Services are proven as full-bleed alternating bands, and as a selection stage
against a single visual, at 1, 3, 5 and 8. Eight bands is a long page. Twenty is not
a page.

The harder half is structural rather than visual: a business with twenty services
almost certainly does not have twenty *peer* services. It has groups — a few things
it is known for, each with variants underneath. Presenting that as a flat list of
twenty is a failure of information architecture that no layout fixes.

## Semantic inputs available

- Services: id, title, description, narrative, stages, scope, FAQ, photograph.
- The backward relation from projects via `serviceIds`, which already gives each
  service its own evidence.
- No grouping concept exists in the client definition today.

## Scalability ranges to design against

| Range | Expected shape |
|---|---|
| 1–3 | Each service can carry a full composition |
| 4–8 | Alternating bands or a selection stage — proven |
| 9–15 | Grouping probably required; flat is probably wrong |
| 16–40 | Grouping certainly required, and it is a page-graph question |

## Questions the design study must answer

1. **Do services group, and is a group a page?** A service that owns sub-services is
   a page-graph shape, not a CSS one. This is the primary question and everything
   else follows from it.
2. If groups exist, **does a group have its own route**, or is it a section of the
   index? A group with a route is a landing page that must justify itself with real
   content.
3. **Is the selection stage still the right instrument** once the list stops fitting
   one stage, or does it become a different mechanic entirely?
4. **How does a grouped service relate to project evidence** — does a group inherit
   its children's projects, and does that make a group page thin or rich?
5. **What is the minimum truth for a service to deserve a detail route?** A service
   with a title and nothing else should probably be a row on an index, not a page.
   The [decision-task contract](../collection-and-content-contract.md) states what a
   real detail route must be able to answer; this question is its threshold.
6. **Does the primary navigation need to expose the group structure?** Which links
   this to [brief C](visual-navigation.md).

## Accessibility requirements

A group is a real heading level with a real list. Nesting must be conveyed
structurally, not only visually. An expandable group is a disclosure with proper
state, and the collapsed state must not hide content from a reader who cannot
expand it — or from a search engine.

## Mobile requirements

Twenty services at 390 is a navigation problem before it is a layout problem.
Grouping must be legible without hover, and must not require the reader to hold the
structure in memory while scrolling.

## Content and truth constraints

No invented groups. No invented hierarchy where the business genuinely has peers.
No duplicated service content across a group page and its children — the same words
on two routes is a real SEO and maintenance cost, and the workflow must decide which
route owns them.

## Explicitly out of scope for the study

Pricing tables and comparison matrices. What commercial information is *known* is a
truth question the intake answers, not a layout the design invents.
