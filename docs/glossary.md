# Glossary

## Agency

The operator of Melbourne Local Growth Ops and owner of the reusable Website
Factory and other retained background IP.

## Background IP

Reusable agency-owned templates, components, module contracts, connectors,
internal tooling, and deployment automation that are not transferred unless
explicitly assigned.

## Capability

An independently activatable, deliverable, billable, pausable, and cancellable
part of the product family: Website & Lead Systems, Google Presence Operations,
or Reputation Operations.

## Client deployment

One isolated public website runtime for one client. Prefer this term over
“tenant” because public sites do not use shared runtime tenant resolution.

## Client Experience Layer

Trusted authored React/TypeScript/CSS source for one client, living under the
fixed `experience/` root of that client's input package. It owns route
composition, client-local Signatures, motion choreography and responsive art
direction. It is inspected, dependency-governed, hashed and shipped inside the
standalone artifact. It is not untrusted configuration and not a Core fork.

## Client handoff

Transfer of client-specific source, deployment, accounts, documentation, and
operational responsibility to the client.

## Client-owned maintenance

Optional agency support after the client owns its repository and infrastructure.
The site must not depend on continuing agency access.

## Commercial contract state

Pricing, billing, term, renewal, cancellation, buyout, and other commercial
facts. It is separate from public website runtime configuration.

## Connector

An adapter for an external system. It defines authentication, supported
capabilities, normalized operations, health, reconciliation, disconnection,
audit evidence, and portability.

## Control plane

A possible future internal registry for clients, deployments, versions, domains,
ownership, and handoff. It is not a required public website runtime.

## Design DNA

A concise, validated creative grammar and provenance artifact recording a
client's thesis, perception and anti-targets, and principles for typography,
colour, composition, imagery, interaction, motion and responsive behavior. It
governs the authored experience. It is not the complete frontend and encodes no
JSX, CSS, class names, breakpoints or layout tree.

## Creative Contract

The written brief locking one client's creative direction before route work
begins: business and customer outcome, creative thesis, perception target,
explicit anti-target, visual principles, imagery philosophy, motion character,
Signature concept, the reference capabilities being targeted, and the rule that
references define capability class and are never copied as expression.

## Creative Gate

The founder's accept/reject decision on an exact deployed or local-production
candidate. It is judged on business representation, customer-task fit,
distinctiveness, visual coherence, mobile quality relative to desktop, runtime
smoothness, and whether the work sits in the same professional division as the
reference capability class. There is no numeric average: one material FAIL means
revise or discard the direction rather than proceeding. See
[Reference-Class Capability Standard](product/reference-class-capability-standard.md).

## Creative Proof Loop

The convergence sequence that prevents building a whole site before the direction
is accepted: lock a Creative Contract, produce one territory, build a Signature
Slice, run the Creative Gate, revise or discard on FAIL, freeze Design DNA and
the Motion Brief only after PASS, then scale the remaining routes and run a
fresh-eyes review. WEB-01B runs this loop once internally against fictional
content to prove the platform ceiling. WEB-01E owns it as a real client-delivery
process, including discovery, evidence verification and client approval.

## Delivery profile

The ownership and operational path for a website: managed-isolated, client
handoff, or client-owned maintenance after handoff.

## Entitlement

Commercial authorization for a client to receive a capability or feature. It
may produce a runtime-safe projection but is not runtime configuration.

## Managed-isolated

Agency-operated delivery in a client-specific project and runtime.

## Managed-service workflow

A contract for human-operated Google Presence or Reputation work, including
intake, access, evidence, approvals, escalation, deliverables, reporting,
retention, and manual fallback.

## No database by default

The rule that a standard website must work without a database, authentication,
object storage, or background jobs. Purchased features may justify isolated,
portable infrastructure.

## Package

A commercial combination of capabilities. A package is not a runtime dependency
or feature flag.

## Page Graph

The validated client-owned route model: which pages exist, their stable paths and
kinds, their metadata inputs and content references, their anchors and
relationships, and the navigation labels and destinations that reach them. It is
bounded structured data, not a layout tree. Route mechanics remain Kernel-owned.

## Platform Kernel

The reusable, invisible engineering substrate shared by every client site: route
mechanics, semantic document infrastructure, metadata and structured-data
machinery, navigation and focus mechanics, asset handling, forms and modules,
accessibility and responsive primitives, reduced-motion foundations, performance
instrumentation, generation, isolation, deployment, handoff and tests. It does
not own any client's visible composition.

## Project

A first-class structured case study with a stable ID and slug, truth
classification and required disclosure, ordered narrative blocks, facts,
client-owned media references and relationships to services and other Projects.
Projects are index/detail content, not a homepage gallery section.

## Motion Brief

The frozen record of an accepted direction's motion language: character, timing
and easing intent, which interactions carry narrative weight, the mobile
substitution strategy and the reduced-motion equivalent. Written after the
Creative Gate passes, then used to scale the remaining routes coherently.

## Product family

Melbourne Local Growth Ops as the single product umbrella for the three
capabilities.

## Runtime configuration

Versioned, deployment-safe, non-secret settings used by one client website to
render and integrate. Runtime secrets are stored separately.

## Signature

A bounded client-specific component creating a memorable identity or interaction.
A client-local Signature lives in that client's own `experience/` source and
requires no shared registry change. Shared Signatures exist only where repeated
evidence justified promotion.

## Signature Slice

One production-quality vertical slice of a candidate direction — real
navigation, hero, one substantial Project or proof section and a conversion
block, on desktop and mobile, with actual imagery, typography, Signature motion
and a reduced-motion path. It is built and judged at the Creative Gate *before*
the remaining routes are built, so a rejected direction costs one slice rather
than a whole site.

## System of record

The authoritative client-owned platform for business state, such as a CRM,
booking platform, POS, accounting, calendar, or commerce system.

## Website Factory

The private reusable source, contracts, components, templates, and tooling used
to produce client-specific websites.

## Website module

A bounded website feature with configuration, UI, optional server behavior,
dependencies, analytics, fallbacks, tests, setup, support, and portability rules.
