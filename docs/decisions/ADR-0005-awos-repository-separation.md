# ADR-0005: AWOS repository separation

- Status: Accepted
- Decision date: 14 August 2026

## Context

The AWOS (Agent Workflow Orchestration System / CAO v2) internal execution kernel
was initially housed in this repository alongside the website product codebase.
To maintain clean product boundaries, eliminate accidental coupling, and allow
both the orchestrator and the website product family to evolve independently, AWOS
has been extracted into its own dedicated repository.

## Decision

1. **Dedicated Repository**: AWOS source and development have moved to
   [`KenVo07/awos`](https://github.com/KenVo07/awos).
2. **Active Tree Ownership**: The active website repository (`KenVo07/melbourne-local-growth-ops`)
   no longer owns or contains AWOS kernel source, schemas, profiles, or Slice 4 artifacts.
3. **No History Rewrite**: Historical commits in this repository remain unchanged.
   No git history rewrite occurred.
4. **Historical Provenance**: Stable-0 historical commit mappings and provenance
   remain documented and tracked through the AWOS repository's
   `PROVENANCE_MIGRATION.json`.
5. **Future Development**: All future AWOS development, testing, and lifecycle
   governance occur exclusively in `KenVo07/awos`.
6. **Workload Boundary**: The website repository serves solely as an external
   workload target for AWOS execution.

## Consequences

- AWOS execution kernel paths (`ops/cao-v2/`, `evidence/slice4/`, `docs/slice4-contract/`,
  and `ADR-0004`) are removed from the active website repository tree.
- The website repository focuses exclusively on the website product family
  (Website & Lead Systems, Ops Console, and associated deployment infrastructure).
- Product CI, build, and validation workflows do not depend on local AWOS tooling or Python runtimes.
