# ADR-0006: Trusted client experience source over configuration-as-code

- Status: Proposed for WEB-01B v2
- Decision owner: Proportion Systems product/technical authority
- Scope: Premium Website Platform client-visible composition

## Context

The WEB-01B v1 candidate proved strict `WebsiteExperience` configuration,
portable artifacts, conditional Foundation Search and technical acceptance. The
Alder & Current showcase also proved that finite visual enums plus one shared
shell are not a sufficient creative ceiling for the premium product strategy.

The platform must avoid two opposite failures:

1. untrusted JSON that injects arbitrary HTML, CSS or JavaScript; and
2. a closed template/configuration system that makes every client inherit the
   same visual and information architecture.

The canonical product model is **blank composition, proven platform**. High code
reuse is intended to remove repeated production burden, not repeated personality.

## Decision

Introduce an explicit **Client Experience Layer** containing trusted, authored
TypeScript/React/CSS source compiled into one client-specific website.

The layer:

- lives under the fixed client input directory `experience/`;
- has one strict versioned `manifest.json` and fixed `index.tsx` entrypoint;
- implements route composition and optional client-local Signatures;
- consumes only a narrow public Platform experience API;
- may use exact, approved public dependencies declared in its manifest;
- is inspected for path/import policy, typechecked, tested and built;
- is copied into the standalone client artifact with hashes and provenance;
- cannot access secrets, private workspace packages or agency-only runtime data;
- does not fork or modify Platform Kernel source.

Client configuration remains data. It cannot carry executable HTML/CSS/JS
strings or arbitrary import/class names.

Design DNA remains a creative contract and machine-readable provenance input. It
must not attempt to encode every possible layout or animation as enums.

## Route ownership

The Platform Kernel owns routing mechanics, static generation, navigation
behavior, metadata/schema infrastructure, not-found behavior and transition
integration points.

The validated Client Page Graph owns the actual route set, page relationships,
navigation labels and destinations.

The Client Experience Layer owns the composition of each route.

## Signature ownership

Client-local Signature components begin in `experience/`. They are not required
to enter a global Signature registry. Promotion into shared Platform code occurs
only after repeated evidence shows that generalisation reduces total delivery or
support effort without lowering accessibility, performance or creative freedom.

## Consequences

### Positive

- client experiences can reach bespoke-agency craft without a Core fork;
- safety remains reviewable because code is trusted source, not config injection;
- P1 can remain mostly server-rendered while P2/P3 opt into richer interactions;
- standalone handoff includes the actual client experience source;
- Platform primitives may compound by evidence rather than speculation.

### Cost

- the client artifact may contain unique source and dependencies;
- source-policy, dependency-governance and artifact-copy boundaries must be
  implemented and tested;
- creative quality still requires human/AI judgement and a Creative Proof Loop;
- the platform no longer promises that client delivery is configuration-only.

## Rejected alternatives

- Add many more Design DNA enums: still creates a finite ceiling and a hidden
  page-builder DSL.
- Permit raw HTML/CSS/JS in JSON: unsafe, difficult to review and incompatible
  with a clean source/handoff boundary.
- Fork the repository per client: breaks compounding maintenance and provenance.
- Build a generic plugin SDK now: no second concrete consumer and disproportionate
  abstraction cost.
- Force all bespoke components into Core: creates component landfill and shared
  runtime/support burden.
