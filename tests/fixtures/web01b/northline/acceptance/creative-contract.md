# Creative Contract — Harbour Electrical & Air

Status: **proposed for founder Creative Gate**. Not approved. No route beyond the
Signature Slice may be built against this contract until the gate passes.

## Business and customer outcome

A homeowner or builder in inner Melbourne planning electrical work on a home they
care about. They arrive mid-consideration, usually with a specific job in mind
and at least one other quote. They need, in this order:

1. to believe this business does careful work on houses like theirs;
2. to see that the work has been done before, in detail, not in a slogan;
3. to understand what engaging looks like and what it will cost them in effort;
4. to start a conversation without a form that feels like a sales funnel.

The site's job is to convert consideration into an enquiry that arrives already
qualified. It is a sales instrument, not a brochure.

## Creative thesis

**Drawn to code.**

Electrical work is invisible once it is finished. What a good electrician
actually sells is precision you will never see. So the site presents the work the
way the trade documents itself — as measured technical drawing. Plate-like
panels, a fine ruled grid, orthographic illustration, real dimensions and
annotations. The craft is legible because the drawing is legible.

This is a deliberate answer to a real constraint. This business has no
photography, and inventing photography would be dishonest. Rather than
apologising for that with stock imagery, the direction makes original technical
illustration the point. A drawn site executed with conviction reads as more
considered than a photographic site executed with someone else's photographs.

## Perception target

- precise;
- documented;
- unhurried;
- expensive in the way a good instrument is expensive;
- literate about buildings, not just about wiring;
- approachable enough to phone.

## Anti-target

Anything here appearing in the built result is a failure, not a matter of taste:

- lightning bolts, sparks, neon, electric blue;
- "24/7 EMERGENCY" urgency styling;
- generic trade template: hero photo, three icon cards, testimonial carousel;
- SaaS product-marketing grammar — soft shadows, rounded cards, gradient blobs;
- luxury minimalism that hides the phone number and the price of engaging;
- motion that decorates rather than explains;
- the v1 failure mode: `large heading → rectangular cards → large heading →
  rectangular cards`.

## Visual principles

1. **The grid is visible and it means something.** A fine ruled baseline grid,
   like a drawing sheet. Content aligns to it deliberately. Rules are hairline
   and structural, never decorative borders.
2. **Two type roles, doing real work.** A tight condensed face for structural
   labels, numerals and dimensions; a plain grotesque for reading. Numerals are
   tabular and treated as data, because in this trade they are. No third-party
   webfont: the direction uses the system stack, which also keeps the site fast
   and adds no dependency.
3. **Panels, not cards.** Content sits on plates with square corners, hairline
   rules and generous internal margin. No shadow, no radius, no float.
4. **Ink, paper, brass.** Deep ink for structure, warm paper for ground, one
   brass accent reserved for the conductor line and the primary action. Contrast
   meets WCAG AA everywhere; the accent is never the only carrier of meaning.
5. **Whitespace is measured, not empty.** Every gap is a multiple of the grid.
   The v1 showcase failed on accidental dead zones; here space is dimensioned.
6. **Route grammars differ.** Home is a wide plate with an asymmetric title
   block. Projects index is an indexed schedule, closer to a drawing register
   than a gallery. A project detail is a vertical document with the conductor
   running through it. About is prose on a narrow measure. Contact is a single
   decisive panel.

## Imagery philosophy

- Every image is original orthographic or isometric technical illustration,
  generated procedurally, in one consistent stroke weight and palette.
- Imagery carries narrative: a project's plate drawing shows *that* project's
  work, and story beats reference details of it.
- No photography. No stock. No AI photorealism. No depiction of any person.
- Every asset carries provenance, and every project is labelled DEMONSTRATION.

## Motion character

Motion explains sequence and nothing else. It is slow, linear-ish and mechanical
— an instrument moving, not a UI bouncing. Nothing overshoots, nothing bounces,
nothing loops. Durations sit between 240ms and 900ms. Everything is interruptible
and everything settles.

## Signature concept — the Conductor

One continuous brass conductor line is drawn down a Project detail page,
physically connecting the hero plate to each story beat to the outcome and
finally into the conversion panel. As the reader advances, the line draws ahead
of them and each junction node it reaches comes up. It is the page's spine: it
shows the reader where they are in the story and that the story is finite.

Why this and not a generic reveal: it is specific to this trade — a conductor
connecting junctions is literally what the business installs — and it does
narrative work rather than decorating arrival. It is one interaction, present on
one route type, tied to the content that most needs to feel substantial.

**Implementation intent:** SVG stroke geometry driven by scroll progress, using
native CSS scroll-driven animation where the browser supports it and an
IntersectionObserver step fallback where it does not. No animation library. On
mobile the conductor becomes a left-margin spine and node activation is stepwise
rather than continuous, because continuous scroll-linked drawing on a small
screen reads as jitter rather than precision.

**Reduced motion:** the conductor is drawn complete and static, and all nodes are
lit. Nothing about the story's structure or legibility depends on the animation
having run. This is not a degraded state; it is the same document at rest.

## Reference capabilities targeted

From `04_REFERENCE_CAPABILITY_MATRIX.md`, not as visual templates to copy:

- ART-01 clear creative thesis; ART-02 no template smell; ART-03 route-specific
  composition; ART-05 deliberate density.
- MOT-01 coherent motion character; MOT-02 meaningful Signature; MOT-03 scroll
  narrative rather than reveal spam; MOT-06 designed reduced-motion.
- PRJ-02 narrative blocks; PRJ-03 curated media sequence; PRJ-05 conversion
  continuity.
- RSP-01 mobile recomposes rather than stacks; RSP-03 art-directed crops.

## Non-copying rule

Marvell/Humaan, Kadean/Atomicdust and Telha Clarke are used to calibrate the
professional division only. No branding, asset, copy, layout, colour or
choreography is taken from any of them. The technical-drawing direction is
derived from this trade's own documentation conventions, which are not any
studio's protected expression.

## Truthfulness

The business, its projects, its people and its results are fictional. Every
project renders a DEMONSTRATION disclosure. No review, rating, licence,
certification, award or measured outcome is stated anywhere, because none has
been verified. Real-client evidence is WEB-01E's responsibility, not this
milestone's.
