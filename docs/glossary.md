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

## Product family

Melbourne Local Growth Ops as the single product umbrella for the three
capabilities.

## Runtime configuration

Versioned, deployment-safe, non-secret settings used by one client website to
render and integrate. Runtime secrets are stored separately.

## System of record

The authoritative client-owned platform for business state, such as a CRM,
booking platform, POS, accounting, calendar, or commerce system.

## Website Factory

The private reusable source, contracts, components, templates, and tooling used
to produce client-specific websites.

## Website module

A bounded website feature with configuration, UI, optional server behavior,
dependencies, analytics, fallbacks, tests, setup, support, and portability rules.
