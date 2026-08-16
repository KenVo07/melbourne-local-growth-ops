# Premium Website Platform & Experience Standard

Status: WEB-01B candidate standard

This document is the implementation contract for a Professional Website built on
the Proportion website platform. It converts the canonical WEB-01B product
direction into bounded rules that an implementation agent and an independent
reviewer can apply consistently.

## 1. Product promise

A Professional Website is not a reskinned generic template. It is a client-
specific composition built on one proven technical kernel. Price or delivery
complexity may reduce scope and creative depth, but never lowers the baseline
for truthfulness, responsive behavior, accessibility, performance, security,
SEO, forms, navigation, or handoff compatibility.

The quality hierarchy is mandatory:

1. stable;
2. responsive;
3. smooth;
4. spectacular.

No later layer may compensate for a failure in an earlier layer.

## 2. Ownership model

### Platform Kernel

The Kernel owns invisible, reusable quality:

- validated configuration and profile content;
- isolated client runtime and deployment boundary;
- module and connector resolution;
- asset manifest and provenance;
- shared rendering, forms, analytics, metadata and structured data;
- accessibility, responsive behavior, reduced-motion handling and failure
  fallbacks;
- deterministic generation, testing and handoff compatibility.

The Kernel must not impose one visible aesthetic across clients.

### Profile Packs

A Profile Pack owns domain semantics and first-time task knowledge. Contractor,
Restaurant and Retailer profiles define required content types, truthful states,
common task paths, safe defaults and semantic validation.

A Profile Pack does not own a permanent font family, color palette, hero layout,
card language, section rhythm, image treatment or signature behavior. Legacy
profile styling may remain as a compatibility fallback, but new client identity
must not be encoded by forking a profile or repository.

### Composition Primitives

Composition primitives are bounded structural choices such as hero layout,
content width, section rhythm, surface treatment, media framing, action treatment
and section order. They may materially change visible composition while
preserving semantic sections and platform behavior.

A section order override must be an exact permutation of validated profile
section IDs. It may reorder emphasis; it may not silently hide required semantic
content.

### Design DNA

Design DNA is the minimum client-specific visual contract. It may express:

- an accessible palette;
- bounded display/body typography families and scale;
- bounded hero, navigation, width, rhythm and surface choices;
- bounded media framing and fit;
- bounded action treatment and motion posture.

Design DNA is configuration, not arbitrary CSS. It must be versioned, validated,
serializable, deterministic and portable. It must not contain free-form class
names, selectors, scripts, HTML or CSS.

### Signature Layer

A Signature Layer is a bounded client-specific component that creates a memorable
identity or interaction not supplied by ordinary primitives. A signature must:

- have a named, versioned reference and a declared placement;
- have a concrete client/variation consumer before a registry abstraction is
  introduced;
- render on the server by default;
- isolate any client-side behavior to its own lazy island;
- honor reduced motion and provide a non-motion equivalent;
- avoid global listeners, perpetual animation loops and shared bundle tax;
- preserve semantic tasks when it fails or is removed;
- remain portable in a client-owned handoff.

Client-specific code is promoted into the Kernel only after repeated evidence,
not because it might be reusable.

## 3. Invariant experience floor

Every profile and every Design DNA variation must satisfy all of the following.

### Truth and proof

- Claims, credentials, testimonials, project imagery, pricing, availability and
  service outcomes are verified or explicitly marked as illustrative/proposed.
- AI-generated or edited media never masquerades as factual proof.
- Missing systems use truthful `NOT_CONFIGURED` or equivalent bounded fallbacks.
- No paid add-on is required to repair baseline quality.

### First-time tasks

Contractor visitors can understand services and coverage, inspect credible proof,
understand the process and reach a quote/enquiry path.

Restaurant visitors can find menu details, hours, location and the available
reservation, ordering or contact path without guessing.

Retail visitors can find products/collections, suitability details, policies and
an available purchase, store or contact path without guessing.

Search may accelerate these tasks. It must never be the only way to repair weak
navigation or missing information architecture.

### Responsive and input quality

- Layout is art-directed for mobile, tablet and desktop rather than merely
  compressed.
- Content reflows without clipping, overlap, horizontal page scrolling or
  inaccessible off-screen controls at 320 CSS pixels and above.
- Keyboard, pointer and touch paths expose equivalent functionality.
- Focus order, visible focus, labels, status announcements and target sizes remain
  usable under long, missing and awkward content.
- Image `sizes`, priority and framing reflect actual rendered layout.

### Accessibility

- Semantic landmarks and headings remain coherent after composition changes.
- Text and interactive contrast meet WCAG AA for the configured palette.
- Motion is optional, interruptible where relevant and disabled/reduced under
  `prefers-reduced-motion`.
- Meaning does not depend on animation, hover alone, color alone or pointer
  precision.
- Forms preserve accessible validation, first-error focus, safe failure messages
  and non-PII analytics behavior.

### Performance and smoothness

- Explicit Design DNA adds no client JavaScript by itself.
- A server-rendered signature adds no client JavaScript unless its behavior
  genuinely requires it.
- Search disabled means no Pagefind markup, browser imports, network requests or
  generated index output.
- Scroll, navigation and signature behavior do not install unbounded global
  listeners or recurring main-thread work.
- Production-build evidence, constrained CPU/network evidence and real-device
  observation are required. Local development smoothness is not acceptance.

### SEO and portability

- Canonical metadata, Open Graph data and profile-specific JSON-LD continue to
  derive from the validated client snapshot.
- Search indexes only public, validated profile content and excludes secrets,
  private routes, draft content and action URLs.
- New source files, build scripts, generated public assets, dependencies and
  notices are accounted for in the client artifact/handoff path.

## 4. Foundation Search

Foundation Search uses Pagefind only when an explicit configuration resolves to
enabled.

Modes:

- `OFF`: no index and no browser assets;
- `AUTO`: deterministic content-complexity rule decides whether an index is
  warranted;
- `ON`: build an index from the validated public snapshot.

Legacy definitions default to `OFF`.

The index is one isolated client index generated at build time. Search records
link to stable section anchors and contain only rendered public content. When
search is enabled, the UI must be keyboard operable, labelled, dismissible where
modal, and usable without replacing normal navigation.

## 5. Same-profile variation proof

WEB-01B must include at least two Contractor renderings that reuse:

- the same Kernel;
- the same semantic profile object;
- the same module/connector contracts;
- the same asset and truthfulness rules.

They must differ materially through Design DNA/composition, not through a fourth
profile, cloned repository, bespoke page shell or hidden semantic sections.

Material difference requires more than color or radius changes. At minimum it
changes hero/composition structure plus two of typography, rhythm, surface
language, media treatment or section emphasis. Both variants must pass the same
technical and first-time-task acceptance.

## 6. Required evidence

### Static/source-verifiable

- strict versioned schemas and unknown-field rejection;
- legacy fallback and exact-permutation section validation;
- no arbitrary CSS/HTML/script fields;
- conditional search records contain no private/action URL data;
- source/handoff manifests include new files and dependencies.

### Codex-local executable

- repository build, tests and typecheck;
- integration and snapshot serialization tests;
- Pagefind on/off build-output checks;
- production Playwright scenarios for all three profiles and same-profile
  variation;
- keyboard/touch/reflow, failure states and constrained-runtime checks;
- generated client artifact verification.

### Browser/device/human

- mobile and desktop visual quality;
- animation feel and runtime jank;
- first-time task completion by an unfamiliar human where practical;
- independent craft/architecture review for generic-template smell, truthful
  proof, responsive degradation and misleading success states.

A generated file, green unit test or localhost screenshot is not evidence that
these latter gates have passed.

## 7. Scope boundaries

WEB-01B does not:

- build the WEB-01E real-client compiler, onboarding workflow or Creative Proof
  Loop;
- complete WEB-01D security/handoff productionization;
- create a multi-tenant public runtime;
- create a generic design DSL, theme marketplace or universal motion framework;
- add advanced discovery, ecommerce or account features;
- replace client systems of record;
- rewrite stable modules merely to make the architecture look newer.

WEB-01B adds the smallest proven seams needed for premium, same-profile design
variation and conditional Foundation Search while preserving accepted WEB-01 and
WEB-01A behavior.
