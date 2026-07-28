# TSK-45 implementation checklist

## Specification

- [x] Lock the implementation plan.
- [x] Record approved rules in the tracked TSK-45 specification.
- [x] Record qualifications to the untracked domain-rules note.

## Minimal workspace

- [x] Pin Node.js 24.18.0 and pnpm 11.9.0.
- [x] Add the minimal pnpm workspace, TypeScript, and Vitest configuration.
- [x] Add the ESM contracts package and generated lockfile.

## Contract slices

- [x] Add branded identifiers and shared strict primitives.
- [x] Add client, business, location, entitlement, and commercial references.
- [x] Add strict module, connector, infrastructure, and service unions.
- [x] Add website runtime configuration and dependency resolution.
- [x] Add deployment ownership and the handoff state machine.
- [x] Add the aggregate contract bundle and cross-record validation.
- [x] Add stable Zod-to-package validation issue translation.
- [x] Add deliberate root exports.

## Verification

- [x] Test valid standard configurations without optional infrastructure.
- [x] Test strict unions, unknown fields, and dependency-set equality.
- [x] Test handoff transitions, ownership, portability, and secret boundaries.
- [x] Test independent capabilities and minimal service envelopes.
- [x] Test stable issue translation and cross-client reference rejection.
- [x] Run tests, type checking, build, ESM smoke import, frozen install, and
      dependency-signature audit.
- [x] Confirm `DOMAIN_RULES.md` is unchanged and unused.
- [x] Complete API, security, and simplification review.
