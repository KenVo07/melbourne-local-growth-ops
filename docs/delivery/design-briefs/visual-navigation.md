# Design brief C — visual and mega navigation

For the Tradies workflow's targeted design phase. **A brief, not a design.**

## Problem

The proven header carries four primary links and one action. That is correct for a
business with four sections and stops being correct at the first client with nested
sections or a service group structure. There is no second navigation level and no
design for one.

Premium navigation may also want to *show* rather than list — a service or project
preview inside the navigation itself. That is a real premium affordance and also the
most common place for a premium site to become slow, inaccessible, or unusable on a
phone.

## Semantic inputs available

- The page graph: routes and their relationships.
- Services, possibly grouped (see [brief B](large-service-architecture.md)).
- Projects, possibly featured.
- Per-item media, where the media contract says it may be published.
- The collapsed navigation is rendered today by a Platform disclosure primitive, so a
  second level is a change to that primitive's contract.

## Scalability ranges to design against

| Range | Expected shape |
|---|---|
| 3–5 primary links | Flat header — proven |
| 6–8 primary links | Flat header near its limit |
| Nested sections | Second level required |
| Nested + visual previews | Mega navigation |

## Questions the design study must answer

1. **Does a second level belong to the page graph or to the client experience?** A
   nav item that owns children is a page-graph shape. A panel a client authors is
   client experience. These have different maintenance and different failure modes,
   and the answer determines who can change the navigation later.
2. **Do the collapsed and expanded navigations stay one authored source rendered
   twice?** They must, or they will drift — but proving that at two levels with media
   is harder than at one level with text.
3. **What does a mega menu do under reduced motion?** Answer this before drawing one.
   A panel that only makes sense while animating is not designed yet.
4. **What does it do on a keyboard?** Specifically: is it a menu, a disclosure, or a
   set of disclosures? These have different ARIA contracts and different
   expectations, and choosing by appearance rather than by behaviour is how
   inaccessible navigation gets built.
5. **What is the media cost?** A navigation carrying twelve preview images has a
   loading strategy or it has a performance defect. Is that media loaded eagerly,
   lazily, or on intent?
6. **What is the touch behaviour?** There is no hover. A tap on a parent either
   navigates or expands, and it cannot silently do both.

## Accessibility requirements

Non-negotiable, and worth stating before any visual work because they constrain it:

- Every destination reachable by keyboard, in a predictable order.
- Focus visible at every stop, including inside a panel over imagery.
- The trigger's expanded state programmatically exposed.
- Escape closes; focus returns to the trigger.
- A pointer leaving a panel must not close it faster than a person can cross it.
- No destination available *only* on hover.
- Every link is a real link a crawler can follow.

## Mobile requirements

At 390 a mega menu is a full-height panel or a set of disclosures, not a scaled-down
desktop panel. Body scroll is locked while it is open and restored exactly on close.
Reaching a third-level destination must not require more than two deliberate taps.

## Content and truth constraints

Navigation shows what exists. No promotional slots with no content behind them, no
"featured" item chosen because a slot needed filling, and no preview image for an
item whose media contract does not permit publication.

## Explicitly out of scope for the study

Search-in-navigation, and any personalisation or recently-viewed behaviour. Both
imply state this architecture does not have.
