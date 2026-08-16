# Premium Website Platform & Experience Standard

Status: WEB-01B v2 candidate standard

This document is the implementation contract for a Professional Website built on
the Proportion website platform. It converts the canonical WEB-01B product
direction into bounded rules that an implementation agent and an independent
reviewer can apply consistently.

The platform ceiling is gated separately by
[Premium Website Reference-Class Capability Standard](reference-class-capability-standard.md).
This document defines the invariant floor every client site must clear; that
document defines the creative ceiling the platform must be able to reach. Both
must pass.

## 0. What v1 got wrong

The first WEB-01B candidate treated a finite `WebsiteExperience` enum set, an
exact section permutation and one shared page shell as if they were the complete
creative architecture. That produces safe configurable variation inside one
presentation system. It does not produce blank composition, and it failed founder
craft acceptance.

The correction is not more enums, a JSON layout tree, executable strings in
configuration, a universal page builder or a per-client Core fork. It is an
explicit trusted authored Client Experience Layer sitting above a reusable
Kernel and a validated client semantic model. See
[ADR-0006](../decisions/ADR-0006-client-experience-layer.md).

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
- App Router mechanics, static route generation, route resolution and
  not-found behavior;
- module and connector resolution;
- asset manifest and provenance;
- shared rendering mechanics, forms, analytics, metadata and structured data;
- navigation, link and focus mechanics;
- accessibility, responsive primitives, reduced-motion handling and failure
  fallbacks;
- performance instrumentation and motion lifecycle conventions;
- deterministic generation, source-policy inspection, testing and handoff
  compatibility.

The Kernel must not impose one visible aesthetic across clients. It does not own
the client's route set, page-level narrative, visual shell, typography, palette,
motion choreography or every Signature, and it ships no global animation library.

### Profile Packs

A Profile Pack owns domain semantics and first-time task knowledge. Contractor,
Restaurant and Retailer profiles define required content types, truthful states,
common task paths, safe defaults and semantic validation.

A Profile Pack does not own the client's route graph, a permanent font family,
color palette, hero layout, card language, section rhythm, image treatment or
signature behavior. Legacy profile styling may remain as a compatibility
fallback, but new client identity must not be encoded by forking a profile or
repository.

### Client Page Graph

The validated client Page Graph owns the actual information architecture:

- page IDs and stable kebab-case paths;
- page kind;
- route metadata inputs;
- the content reference each page resolves;
- the `experienceRouteId` selecting the authored composition;
- anchors, parent and related relationships;
- Search inclusion;
- primary, utility and footer navigation labels and destinations;
- the primary action target.

Navigation labels and destinations are explicit data, independent from page and
section headings. Destinations may be a route or a route plus anchor. Deriving
navigation from headings is prohibited.

Single-page delivery remains valid when content depth justifies it, but it is an
output option, not a platform constraint. The Page Graph is bounded structured
data. It is not a layout tree and carries no markup, classes or styles.

### Projects and Case Studies

Projects are first-class structured proof, not a homepage gallery section. A
Project owns a stable ID and slug, title and summary, truth mode with required
disclosure, service relationships, optional location, client-owned hero and
gallery media references, facts, ordered narrative blocks and related Project
IDs. Project detail pages resolve a Project by stable ID from the validated
collection; resolution by display title or array position is prohibited.

Service detail routes likewise resolve exact stable service IDs. Editing a
display title must never change route identity.

### Composition and Interaction Primitives

Primitives supply reliable mechanics, not predesigned pages. The initial public
surface is deliberately small:

- `PlatformLink` — Next Link behavior, route and route+anchor targets,
  focus/prefetch/current-page semantics;
- `PlatformImage` — validated client media, alt/decorative semantics, responsive
  focal points, caller-supplied `sizes` and priority, no arbitrary remote URL;
- `PlatformRegion` — safe validated module/form rendering with no raw connector
  credentials exposed.

Further primitives are promoted only when a second concrete consumer proves that
generalisation reduces work without imposing a visual recipe.

Legacy composition primitives — bounded hero layout, content width, section
rhythm, surface treatment, media framing, action treatment and section order —
remain available to the `schemaVersion: 1` adapter. A legacy section order
override must be an exact permutation of validated profile section IDs. It may
reorder emphasis; it may not silently hide required semantic content.

### Client Experience Layer

The visible client experience is trusted authored React/TypeScript/CSS source
under the fixed `experience/` root, with a fixed `manifest.json` and `index.tsx`
entrypoint. It owns route composition, client-local Signatures, motion
choreography and responsive art direction.

It is trusted authored source, not untrusted data, and is governed accordingly:

- inspected before copy or build for symlinks and path escape;
- limited to React, the single `@proportion/client-experience` public alias,
  relative files inside its own root, and exact declared dependencies approved by
  repository governance;
- denied Node built-ins, `process.env`, server actions, API routes, eval,
  `require`, `new Function`, nonliteral dynamic imports, direct network I/O,
  persistent browser storage, cookies and raw markup injection;
- denied direct `next/link` and `next/image` imports that would bypass route and
  media validation;
- typechecked, built and tested;
- accessibility and performance reviewed;
- hashed and inventoried into the artifact descriptor;
- shipped inside the standalone artifact with no private Factory dependency.

Client configuration remains validated non-executable data and may reference this
package only through the fixed manifest path. It may never carry HTML, CSS,
JavaScript, class names, selectors, module specifiers or filesystem paths.

### Design DNA

Design DNA is a concise creative grammar and provenance artifact recording
thesis, perception and anti-targets, and principles for typography, colour,
composition, imagery, interaction, motion, reduced motion, responsive behavior
and Signature intent.

Design DNA **governs** the authored experience. It is not the complete frontend
and not an exhaustive renderer configuration. It must not encode JSX, CSS, class
names, selectors, breakpoints, timelines or a layout tree; the authored source is
the implementation. It must be versioned, validated, serializable, deterministic
and portable.

The v1 finite `WebsiteExperience` enum model remains valid as the legacy preset
and provenance path for `schemaVersion: 1` definitions. It is explicitly not the
premium ceiling.

### Signature Layer

A Signature is a bounded client-specific component that creates a memorable
identity or interaction not supplied by ordinary primitives.

A **client-local** Signature living in the client's own `experience/` source is
the default and legal path. It requires no shared Core registry change and no
Core schema modification. Shared registry entries such as `ServiceAreaProof`
remain valid examples, not the only legal route to memorable work.

Every Signature must:

- have a stable ID declared by the authored experience or shared registry;
- render on the server by default;
- isolate any client-side behavior to its own lazy island;
- honor reduced motion and provide a non-motion equivalent that preserves
  comprehension;
- avoid global listeners, perpetual animation loops and shared bundle tax;
- clean up on unmount and route change;
- preserve semantic tasks when it fails or is removed;
- remain portable in a client-owned handoff.

Client-specific code is promoted into the Kernel only after repeated evidence,
not because it might be reusable.

### Motion

The Kernel owns reduced-motion utilities, lifecycle and cleanup conventions,
performance measurement and opt-in client-island seams. It contains no mandatory
animation package and installs no global scroll manager or smooth-scroll
behavior.

Client experience source owns choreography. Simple interactions should use native
CSS or WAAPI. A motion library may be adopted only when a concrete Signature need
justifies it, at an exact version with governance approval, declared in the
experience manifest and scoped to that experience. Static, no-motion and legacy
artifacts must contain none of its runtime, chunk, request or dependency cost.

Experimental Next `viewTransition` and React Canary `<ViewTransition>` must not
be milestone acceptance foundations.

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
  compressed. Mobile may substitute composition, crop, interaction and motion,
  provided the customer outcome is preserved.
- Passing a 320px overflow check is a floor, not evidence of art direction.
  Mobile quality is judged against desktop quality, not against "does not break".
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
- An experience that does not declare a motion dependency ships none of its
  runtime, chunk or request cost. Legacy and static artifacts never pay it.
- Search disabled means no Pagefind markup, browser imports, network requests or
  generated index output.
- Scroll, navigation and signature behavior do not install unbounded global
  listeners or recurring main-thread work.
- Production-build evidence, constrained CPU/network evidence and real-device
  observation are required. Local development smoothness is not acceptance.

### SEO and portability

- Canonical metadata, Open Graph data and profile-specific JSON-LD continue to
  derive from the validated client snapshot.
- Every route has a unique title, description and canonical URL derived from the
  validated Page Graph. Unknown routes return an intentional 404.
- Structured data makes no unverified review, rating, licence, certification or
  result claim.
- Search indexes only public, validated content and excludes secrets, private
  routes, draft content and action URLs.
- New source files, build scripts, generated public assets, dependencies and
  notices are accounted for in the client artifact/handoff path.
- Generated client source is client-specific and editable, and cannot depend on
  private Factory repositories, package registries, credentials or unrelated
  client data.

## 4. Foundation Search

Foundation Search uses Pagefind only when an explicit configuration resolves to
enabled.

Modes:

- `OFF`: no index and no browser assets;
- `AUTO`: deterministic content-complexity rule decides whether an index is
  warranted;
- `ON`: build an index from the validated public snapshot.

Legacy definitions default to `OFF`.

The index is one isolated client index generated at build time and contains only
rendered public content. Legacy one-page records link to stable section anchors.
Page Graph records link to real route or route+anchor URLs, and Project results
land directly on the Project route. When search is enabled, the UI must be
keyboard operable, labelled, dismissible where modal, and usable without
replacing normal navigation.

Search does not repair weak information architecture. Every core first-time task
must complete with Search OFF.

## 5. Reference-class flagship proof

The platform ceiling is proved by one substantial fictional Contractor site, not
by a demo page. Its minimum route set is Home, Services index, Projects index, at
least three Project detail routes, About/trust, Contact and an intentional 404. A
service detail route is included wherever stable service IDs exist.

The proof must demonstrate route depth with substantial Project stories, a
coherent distinctive art direction, materially different route compositions, a
meaningful Signature interaction, a deliberate motion language, responsive and
mobile art direction, conversion clarity, production smoothness and
accessibility, and original expression.

The following are not accepted as proof:

- a repeated `large heading + rectangular cards` rhythm;
- generic reveal spam;
- a cinematic first viewport with no identity, offer or action;
- an anchor-only giant homepage presented as multi-page;
- desktop polish with mobile collapse;
- technically green but visually generic output.

Build the proof through the Creative Proof Loop, not all at once. Complete the
Creative Contract, produce one territory, build a production Signature Slice with
real navigation, hero, substantial Project proof and conversion block on desktop
and mobile with actual imagery and motion, then run the Creative Gate. A material
FAIL means revising or discarding the direction before scaling. Freeze the Design
DNA and Motion Brief only after a PASS, then scale the remaining routes.

## 5a. Same-profile variation proof

WEB-01B must include at least two Contractor renderings that reuse:

- the same Kernel;
- the same semantic profile object and page graph semantics;
- the same module/connector contracts;
- the same asset and truthfulness rules;
- the same accessibility and performance floor.

They must differ materially through authored composition and art direction, not
through a fourth profile, cloned repository, forked Core or hidden semantic
sections.

Material difference requires more than color or radius changes. At minimum it
changes hero/composition structure plus two of typography, rhythm, surface
language, media treatment or section emphasis. The second variation need not
match the flagship's polish, but it must not read as a fourth template. Both
variants must pass the same technical and first-time-task acceptance.

## 6. Required evidence

### Static/source-verifiable

- strict versioned schemas and unknown-field rejection;
- explicit `schemaVersion` 1/2 discrimination, with partial or unknown versions
  failing closed rather than downgrading silently;
- legacy fallback and exact-permutation section validation;
- page graph reference, cycle, duplicate and page-kind/content validation;
- project ID/slug, disclosure, relationship and media validation;
- stable service IDs, with title or slug matching rejected;
- no arbitrary CSS/HTML/script fields;
- authored source policy rejects path escape, symlinks, private workspace
  imports, Node built-ins, environment access, server primitives, dynamic code
  execution, network I/O, persistent browser state, raw markup injection and
  undeclared or unapproved dependencies;
- sanitized route props contain no secret reference IDs, runtime secret
  bindings, recipient addresses, raw connectors or entitlement state;
- conditional search records contain no private/action URL data;
- source/handoff manifests include new files, source hashes, route inventory and
  exact dependencies.

### Locally executable

- repository build, tests and typecheck;
- integration and snapshot serialization tests;
- every Page Graph route builds statically and an unknown route 404s;
- route metadata, canonical URL and structured-data checks;
- Pagefind on/off build-output checks;
- no-motion versus motion bundle comparison;
- production Playwright scenarios for all three profiles, the multi-route proof
  and the same-profile variation;
- keyboard/touch/reflow, failure states and constrained-runtime checks;
- generated client artifact verification, including a clean install, typecheck,
  test, build and handoff verification outside the workspace.

### Browser/device/human

- mobile and desktop visual quality;
- animation feel and runtime jank;
- founder creative sign-off on the exact deployed candidate;
- one fresh independent craft and customer-task review;
- first-time task completion by an unfamiliar participant;
- physical lower or mid-range mobile device review;
- independent craft/architecture review for generic-template smell, truthful
  proof, responsive degradation and misleading success states.

A generated file, green unit test or localhost screenshot is not evidence that
these latter gates have passed. Automated or model review may supplement these
gates; it cannot replace them.

### Gate arithmetic

There is no numeric average and no compensating score. A mandatory material
failure blocks the milestone:

- beautiful desktop with weak mobile is FAIL;
- impressive motion with a sticky or janky production runtime is FAIL;
- green CI with obvious template smell is FAIL;
- a spectacular home page with poor Projects information architecture is FAIL;
- fabricated proof presented as real is FAIL;
- missing human or device evidence is BLOCKED, not PASS.

AI-generated, stock and concept media must be clearly classified and must never
be presented as real client work, team, premises, results or certifications.

## 7. Scope boundaries

WEB-01B does not:

- build the WEB-01E real-client compiler, onboarding workflow, discovery,
  evidence verification, creative approval process or delivered Creative Proof
  Loop. WEB-01B runs the loop once, internally, to prove the platform ceiling
  with fictional content; WEB-01E owns it as a client-delivery process;
- complete WEB-01D security/handoff productionization;
- create a multi-tenant public runtime;
- create a generic design DSL, page builder, plugin SDK, theme marketplace or
  universal motion framework;
- accept executable HTML, CSS, JavaScript or module paths through configuration;
- fork Core or a Profile Pack per client;
- add a global animation library or runtime;
- adopt experimental React or Next View Transitions as a milestone foundation;
- add advanced discovery, ecommerce or account features;
- replace client systems of record;
- rewrite stable modules merely to make the architecture look newer.

WEB-01B adds the smallest proven seams needed for a trusted authored client
experience, bounded multi-page route graphs, first-class Projects, opt-in motion,
same-profile design variation and conditional Foundation Search while preserving
accepted WEB-01 and
WEB-01A behavior.
