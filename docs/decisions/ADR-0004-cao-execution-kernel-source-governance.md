# ADR-0004: CAO execution-kernel source governance

Status: Accepted

## Decision

`ops/cao-v2/` is the canonical tracked source for the MLGO CAO v2 internal
execution kernel, including its provider/profile registry, schemas, generators,
tests, and source/build provenance logic.

Installed files under user-local runtime/configuration locations are generated,
staged, or installed projections. They are not the canonical source of truth.

CAO v2 is internal agency execution tooling. This decision does not change the
Website Factory/client deployment model, does not create a shared public
multi-tenant website runtime, and does not place CAO into client handoff
artifacts.

`packages/contracts/` is unchanged by this decision.

Live installation, activation, production enforcement, native resume,
evidence-reuse promotion, and later ChatGPT Web Bridge work remain separately
gated.
