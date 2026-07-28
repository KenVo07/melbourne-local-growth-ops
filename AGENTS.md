# Melbourne Local Growth Ops

This repository implements a website-led local growth product family with three
independently sellable capabilities: Website & Lead Systems, Google Presence
Operations, and Reputation Operations. Website & Lead Systems is the current
engineering focus.

## Read first

1. [Product overview](docs/product/overview.md)
2. [Capability model](docs/product/capability-model.md)
3. [Architecture boundaries](docs/architecture/boundaries.md)
4. [Current architecture](docs/architecture/current-architecture.md)
5. The active task specification under `docs/tasks/`

The canonical repository decisions are the accepted ADRs in `docs/decisions/`.
The Notion technical plan remains the upstream product source; repository docs
are the implementation-facing interpretation. If they differ, stop and request
human resolution rather than silently choosing one.

## Current commands

Use Node.js 24.18.0 and pnpm 11.9.0 as pinned in the repository.

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

Useful read-only checks:

```powershell
rg --files
rg -n "managed shared|shared public|multi-tenant" AGENTS.md docs packages
rg -n "TODO|TBD|assumption|open question" AGENTS.md docs
```

## Non-negotiable boundaries

- Use one private reusable Website Factory and one isolated deployment per client.
- Do not create a shared public multi-tenant website runtime.
- Keep capability activation, delivery, billing, and cancellation independent.
- Keep runtime configuration separate from commercial contract state.
- Do not add a database, authentication, object storage, or background jobs by default.
- Keep client systems authoritative unless replacement is explicitly contracted.
- A handed-off site must run without private agency repositories, credentials, or accounts.
- Preserve client ownership of domains, content, analytics, and business data.
- Preserve agency ownership of reusable background IP.

## Approval gates

Get explicit human approval before changing the product family, capability
independence, delivery modes, ownership/IP rules, deployment isolation, default
infrastructure posture, system-of-record policy, seller/ecommerce boundary, or
handoff portability. Also ask before adding paid infrastructure, authentication,
payments, secret-handling mechanisms, a new source of truth, or implementation
outside the approved task.

The current task specification is
[TSK-45 contract schemas](docs/tasks/TSK-45-contract-schemas.md). It is
implemented in `packages/contracts`; consult its specification before changing
the public contract.
