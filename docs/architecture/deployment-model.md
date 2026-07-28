# Deployment model

## Decision

Use one private reusable Website Factory and one isolated Vercel deployment per
client. Do not build ad hoc client forks or a shared public multi-tenant runtime.

## Delivery flow

1. Validate a versioned client configuration.
2. Select a template and enabled website modules.
3. Resolve approved connector dependencies.
4. Assemble a client-specific, reproducible source artifact.
5. Create or update the client’s repository and Vercel project.
6. Deploy a preview using only that client’s configuration and secrets.
7. Run isolation, conversion-path, domain, analytics, and failure checks.
8. Record versions and ownership before production promotion.

The implementation may reuse internal packages while generating managed sites,
but the handoff artifact must be self-contained.

## Managed-isolated deployments

- One Vercel project per client
- Agency-managed infrastructure during the service term
- Separate configuration, secrets, analytics identifiers, domain, and logs
- Failures and rollback contained to the client deployment
- Usage and support costs measurable per client

## Client-handoff deployments

Handoff transfers a client-specific repository and deployment to client-owned
accounts. The handoff package must document:

- Repository, hosting, domain, analytics, and other account ownership
- Application, template, package, configuration, and deployment versions
- Required environment variables and how the client obtains their values
- Build, test, deployment, rollback, and operational commands
- Connected providers and renewal responsibilities
- Data export, deletion, monitoring, and support boundaries

The transferred site must not require access to the private Website Factory,
private package registries, agency credentials, or personal accounts.

## Registry and control plane

A later internal registry may track clients, capabilities, projects, domains,
versions, infrastructure ownership, contract references, and handoff status.
That registry is an operational control plane. A public website must remain
deployable and operable if the registry is unavailable.

Commercial terms can be referenced in the registry, but they remain separate
from the runtime configuration deployed to a public site.

## Rollback

Every deployment should record the last known-good version. Production promotion
requires a documented path to restore the previous application and configuration
combination. DNS changes require backups and rollback notes.

## Isolation verification

Automated tests must demonstrate that one client deployment cannot load another
client’s:

- Configuration
- Secrets
- Analytics identifiers
- Domains
- Content or assets
- Optional persistent data

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [M1 success criteria](https://app.notion.com/p/3a88d3550dc381839283d043270dada6)
- [TSK-43 — isolated deployment decision](https://app.notion.com/p/3a88d3550dc3815eaa5efe22b2c23dca)
- [TSK-44 — Vercel and GitHub selection](https://app.notion.com/p/3a88d3550dc381efb3cfd94bc12cf2ac)
