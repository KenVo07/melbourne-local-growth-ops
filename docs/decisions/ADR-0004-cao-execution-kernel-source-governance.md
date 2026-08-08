# ADR-0004: CAO execution-kernel source governance

- Status: Accepted
- Decision date: 8 August 2026

## Context

CAO v2 requires one tracked canonical source boundary for its internal agency
execution tooling. Installed files under `$HOME/.local/...` are runtime
projections/build outputs and must not become a competing source of truth.

## Decision

- Track CAO v2 as internal agency execution tooling under `ops/cao-v2/`.
- Keep canonical runtime source, provider/profile registry, schemas, generators,
  and source/build provenance under that tracked subtree.
- Treat installed `$HOME/.local/...` files as projections/build outputs, not as
  source of truth.
- Keep client handoff and client-runtime architecture unchanged.
- Do not create a shared public multi-tenant website runtime.
- Keep `packages/contracts` unchanged and authoritative for its existing scope.
- Keep live CAO installation and activation behind a separate controlled gate.

## Consequences

This decision records the approved source-governance boundary only. It does not
change product architecture, client deployment/handoff semantics, or authorize
live runtime activation.
