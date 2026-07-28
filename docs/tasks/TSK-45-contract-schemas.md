# TSK-45: Contract schemas

- Notion status: To Do
- Priority: High
- Milestone: M0
- Task type: Coding
- Repository status: Specification only; implementation is not approved

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
- Optional infrastructure is present only when enabled modules require it.

## Acceptance criteria

1. Versioned TypeScript and Zod schemas cover the required contract families.
2. A valid standard website configuration passes without a database.
3. Invalid capability, delivery, ownership, module-dependency, integration, and
   handoff combinations fail with clear validation errors.
4. Automated tests cover valid and invalid combinations.
5. The contracts model isolated client deployments rather than shared-runtime
   tenant tables.

## Non-goals

- Implementing TSK-45 during repository onboarding
- Creating a database schema or migrations
- Building authentication, an operations console, or deployment tooling
- Defining billing calculations, prices, minimum terms, or buyout formulas
- Implementing Website, Google Presence, or Reputation runtime features
- Turning packages into runtime feature flags

## Interpretations requiring approval

- Exact schema-version migration and compatibility policy
- Whether entitlements are stored here or referenced by stable identifier
- Which conceptual shared entities need executable M0 schemas
- Error-code and validation-result formats
- Handoff artifact generation mechanics
- Any new dependency beyond the approved TypeScript and Zod direction

## Existing repository note

`packages/contracts/src/DOMAIN_RULES.md` predates this specification and remains
unchanged. Its capability, isolation, ownership, and commercial-state separation
rules align broadly with this task. Its minimum-term and declining-buyout
statements are upstream assumptions, not approved schema requirements.

## Sources

- [TSK-45](https://app.notion.com/p/3a88d3550dc38150875cecf02edaec73)
- [M0 success criteria](https://app.notion.com/p/3a88d3550dc38127b1b5ca89188d72e0)
- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-46 — contract families](https://app.notion.com/p/3a88d3550dc381a29005e79670fde26f)
- [TSK-88 — capability and delivery model](https://app.notion.com/p/3aa8d3550dc381139645e4a62ca0aa84)
