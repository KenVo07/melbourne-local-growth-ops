# TSK-45: Contract schemas

- Notion status: To Do
- Priority: High
- Milestone: M0
- Task type: Coding
- Repository status: Implemented and locally verified

## Objective

Define versioned executable contracts for client identity, independently
sellable capabilities, website delivery, and service configuration without
designing a shared-runtime tenant database.

The intended implementation location is `packages/contracts`.

## Required schema coverage

- Client identity
- Business and location data
- Independent capability activation or entitlement references
- Managed-isolated and client-handoff delivery profiles
- Infrastructure and account ownership
- Website configuration
- Domains
- Enabled website modules and dependency requirements
- External integration selections and portability
- A separate commercial contract record or reference, never embedded in public
  website runtime configuration
- Handoff status and transferred operational responsibility
- Schema and configuration version identifiers

## Toolchain and implementation boundary

- Target and pin Node.js 24.18.0 LTS.
- Pin pnpm 11.9.0. That exact version was verified as published before it was
  selected.
- Publish a compiled ESM-only TypeScript package with declarations.
- Use Zod for executable boundary validation and Vitest for automated tests.
- Bootstrap only the minimal workspace required by TSK-45. Full monorepo
  setup, applications, CI, and deployment tooling remain TSK-49.

## Required boundaries

- A client can exist without Website & Lead Systems.
- Capabilities can be activated and cancelled independently.
- Package names are not runtime dependencies.
- Every website has one delivery profile.
- A standard site validates with no database, authentication, object storage, or
  background jobs.
- Runtime configuration remains separate from commercial contract state.
- Client-specific configuration cannot resolve another client.
- Handoff configuration cannot require private agency repositories or secrets.
- Optional infrastructure is present only when enabled modules or connectors
  require it.
- Configured infrastructure equals the unique resolved dependency set: missing
  and surplus infrastructure are both invalid.

## Contract planes

### Commercial and operational

This plane contains client, business, and location identity; independent
capability entitlements; external commercial contract references; deployment
ownership; handoff state; and secret-reference metadata.

Entitlement lifecycle is descriptive. Activating, suspending, or cancelling an
entitlement does not implicitly deploy, disable, or cancel another capability.

### Public deployment

This plane contains public display data, domains, enabled website modules,
enabled connectors, configured optional infrastructure, and configuration
version identifiers. It must not contain package names, prices, contract terms,
buyout calculations, credentials, secret values, or commercial state.

## Closed website configuration types

Known module and connector configuration is represented by strict
discriminated unions rather than arbitrary JSON settings.

Representative modules:

- `LEAD_FORM`, referencing an `EMAIL_DELIVERY` connector
- `BOOKING_CTA`, referencing a `BOOKING_LINK` connector
- `ANALYTICS`, referencing a `GOOGLE_ANALYTICS_4` connector

Representative connectors:

- `EMAIL_DELIVERY`
- `BOOKING_LINK`
- `GOOGLE_ANALYTICS_4`

Unknown discriminator values and unknown object fields fail validation. Every
module and connector may declare optional dependencies from `DATABASE`,
`AUTHENTICATION`, `OBJECT_STORAGE`, and `BACKGROUND_JOBS`.

Google Presence and Reputation configurations are deliberately minimal. They
contain only identity, schema version, entitlement reference, and applicable
location references. Their future software workflows are outside this task.

## Handoff state machine

- Before initiation the handoff record is absent, delivery is
  `MANAGED_ISOLATED`, and operational ownership is `AGENCY`.
- `PLANNED` and `IN_PROGRESS` retain `MANAGED_ISOLATED` delivery and `AGENCY`
  operational ownership.
- `COMPLETED` requires `CLIENT_HANDOFF`, `CLIENT` operational ownership,
  client-owned source and hosting, and no dependency on private agency
  repositories, credentials, or secrets.
- `CLIENT_HANDOFF` without a completed handoff is invalid.
- A completed handoff that remains managed is invalid.

## Stable validation contract

Validation returns a discriminated success or failure result. Failures contain
only package-level issues:

```ts
type ValidationIssueCode =
  | "INVALID_INPUT"
  | "INVALID_TYPE"
  | "INVALID_LITERAL"
  | "INVALID_FORMAT"
  | "INVALID_LENGTH"
  | "UNKNOWN_FIELD"
  | "UNSUPPORTED_SCHEMA_VERSION"
  | "DUPLICATE_IDENTIFIER"
  | "REFERENCE_NOT_FOUND"
  | "CAPABILITY_ENTITLEMENT_MISSING"
  | "SERVICE_CAPABILITY_MISMATCH"
  | "DELIVERY_HANDOFF_MISMATCH"
  | "OWNERSHIP_MISMATCH"
  | "CONNECTOR_TYPE_MISMATCH"
  | "INFRASTRUCTURE_DEPENDENCY_MISMATCH"
  | "HANDOFF_PORTABILITY_VIOLATION"
  | "AGENCY_SECRET_DEPENDENCY";

interface ValidationIssue {
  readonly code: ValidationIssueCode;
  readonly path: readonly (string | number)[];
  readonly message: string;
}
```

Zod issues are translated into this closed contract. Zod issue objects and
rejected input values are not exposed.

## Acceptance criteria

1. Versioned TypeScript and Zod schemas cover the required contract families.
2. A valid standard website configuration passes without a database.
3. Invalid capability, delivery, ownership, module-dependency, integration, and
   handoff combinations fail with clear validation errors.
4. Automated tests cover valid and invalid combinations.
5. The contracts model isolated client deployments rather than shared-runtime
   tenant tables.

## Non-goals

- Creating a database schema or migrations
- Building authentication, an operations console, or deployment tooling
- Defining billing calculations, prices, minimum terms, or buyout formulas
- Implementing Website, Google Presence, or Reputation runtime features
- Turning packages into runtime feature flags

## Locked interpretations

- Schema version `1` is the only accepted version. Migrations and compatibility
  policy are deferred.
- Shared identity is intentionally minimal.
- Entitlements are executable association records; orchestration is deferred.
- Handoff artifact generation mechanics are not implemented here.
- TypeScript, Zod, and Vitest are approved implementation dependencies.

## Existing repository note

`packages/contracts/src/DOMAIN_RULES.md` predates this specification, is
untracked, and remains unchanged. Neither implementation nor tests depend on
it. The following approved rules are authoritative for TSK-45:

- The three capabilities can be purchased independently.
- A client can exist without a website.
- Cancelling one capability cannot disable another.
- Package names are commercial metadata, not runtime dependencies.
- A standard website works without optional infrastructure.
- Every enabled module and connector satisfies its declared dependencies.
- Runtime configuration excludes commercial state.
- The client owns its domain, content, analytics, and business data.
- The reusable factory and modules remain agency background IP.
- A completed handoff cannot depend on private agency repositories or
  credentials.

Qualifications and contradictions:

- Minimum-term and declining-buyout statements are upstream assumptions and
  are not approved schema requirements.
- Database, authentication, storage, and queues are optional infrastructure,
  not independently sold product capabilities.
- Client-owned infrastructure is required after handoff completion. Planned and
  in-progress handoffs remain managed-isolated with agency operational
  ownership.

## Sources

- [TSK-45](https://app.notion.com/p/3a88d3550dc38150875cecf02edaec73)
- [M0 success criteria](https://app.notion.com/p/3a88d3550dc38127b1b5ca89188d72e0)
- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-46 — contract families](https://app.notion.com/p/3a88d3550dc381a29005e79670fde26f)
- [TSK-88 — capability and delivery model](https://app.notion.com/p/3aa8d3550dc381139645e4a62ca0aa84)
