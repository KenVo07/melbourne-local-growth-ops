# ADR-0002: Isolated client website deployments

- Status: Accepted
- Decision date: 27 July 2026

## Context

The product must support managed recurring delivery and credible client
ownership without allowing one client failure or configuration error to affect
others. A shared public multi-tenant runtime would introduce premature tenancy,
security, operational, and handoff complexity.

## Decision

Use one private reusable Website Factory and one isolated Vercel project per
client.

- Managed-isolated sites run in client-specific projects under agency-managed
  infrastructure.
- Client-handoff sites are transferred as self-contained client-specific source
  and deployments in client-owned accounts.
- Client-owned maintenance may follow handoff without creating a dependency on
  the agency.
- A future internal control plane may track deployments but cannot become a
  mandatory public-site runtime.

## Consequences

- Each deployment has its own trusted configuration, secrets, analytics, domain,
  and failure boundary.
- CI must test configuration and deployment isolation.
- Deployment tooling must prevent ad hoc client forks.
- Versions, ownership, rollback, and handoff state must be recorded.
- Handoff artifacts cannot depend on private agency repositories, credentials,
  package registries, or personal accounts.
- The agency can retain reusable background IP while transferring client-specific
  source.

## Superseded decision

Earlier Product and Project text described “managed shared” as a
platform-operated shared application with isolated tenant data. That technical
mode is superseded. A shared commercial service plan does not imply a shared
runtime.

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [M1 success criteria](https://app.notion.com/p/3a88d3550dc381839283d043270dada6)
- [TSK-43](https://app.notion.com/p/3a88d3550dc3815eaa5efe22b2c23dca)
- [TSK-44](https://app.notion.com/p/3a88d3550dc381efb3cfd94bc12cf2ac)
