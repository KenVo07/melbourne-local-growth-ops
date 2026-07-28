# TSK-45 implementation plan

## Outcome

Deliver a versioned, strict TypeScript and Zod contract package for the
Melbourne Local Growth Ops product family. The package models independently
sellable capabilities and isolated website deployments without introducing a
shared public runtime or database.

## Toolchain and scope

- Pin Node.js 24.18.0 LTS and pnpm 11.9.0.
- Publish `@melbourne-local-growth-ops/contracts` as compiled ESM with
  TypeScript declarations.
- Bootstrap only the workspace files required to build and test this package.
- Leave applications, the complete monorepo, CI, and deployment tooling to
  TSK-49.

## Contract model

- Keep commercial and operational records separate from public deployment
  configuration.
- Use strict, schema-versioned objects and closed discriminated unions.
- Model representative website modules: `LEAD_FORM`, `BOOKING_CTA`, and
  `ANALYTICS`.
- Model representative connectors: `EMAIL_DELIVERY`, `BOOKING_LINK`, and
  `GOOGLE_ANALYTICS_4`.
- Keep Google Presence and Reputation configuration envelopes minimal.
- Resolve optional infrastructure from both enabled modules and connectors.
  Configured infrastructure must equal the resolved dependency set.

## Delivery and handoff

- An absent handoff record means handoff has not been initiated.
- `PLANNED` and `IN_PROGRESS` retain `MANAGED_ISOLATED` delivery and agency
  operational ownership.
- `COMPLETED` requires `CLIENT_HANDOFF`, client operational ownership, and no
  private agency repository, credential, or secret dependency.

## Validation API

- Return only package-level `ValidationIssue` objects with a closed code union,
  a readonly `(string | number)[]` path, and a descriptive message.
- Translate Zod issues at the package boundary; do not expose Zod internals or
  rejected input values.
- Provide structural website validation and aggregate bundle validation for
  cross-record rules.

## Delivery sequence

1. Lock this plan, the task checklist, and the tracked TSK-45 specification.
2. Add the minimal workspace and package build.
3. Implement schemas and validation in RED-GREEN-REFACTOR slices.
4. Verify tests, type checking, build output, ESM import, frozen install, and
   dependency signatures.
5. Review the public API and remove unnecessary complexity.

## Domain-rules qualification

`packages/contracts/src/DOMAIN_RULES.md` remains unchanged and untracked. It is
not a build or test input. Approved rules are repeated in the tracked TSK-45
specification. The following statements are not adopted as written:

- Minimum-term and declining-buyout rules are unapproved commercial
  assumptions.
- Database, authentication, storage, and queues are infrastructure
  dependencies, not independently sold product capabilities.
- Client-owned handoff infrastructure applies only after handoff is completed,
  not during planning or transfer.
