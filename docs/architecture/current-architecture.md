# Current architecture

## Architecture summary

One private, configuration-driven Website Factory produces one isolated website
deployment per client. Managed sites run in separate agency-operated Vercel
projects. Handoff sites are transferred as self-contained client-specific source
and deployments in client-owned accounts.

There is no shared public multi-tenant website runtime.

## Initial stack

- Next.js, React, and TypeScript
- Shared component library and design tokens
- Vercel Pro, initially one project per client
- GitHub for the private factory and client-specific handoff repositories
- Client-owned Google Analytics 4 properties
- Resend for transactional lead notifications
- Vercel logs and structured application logging
- Optional Sentry where managed monitoring scope justifies it
- Vercel environment variables for runtime secrets

Vendors are initial choices, not permanent domain boundaries. Hosting, email,
analytics, storage, and monitoring must remain replaceable behind explicit
interfaces.

## Intended components

| Area | Responsibility |
|---|---|
| `apps/site-template` | Website runtime used to produce isolated client sites |
| `apps/ops-console` | Later internal registry; not a required public-site runtime |
| `tooling/deployment-generator` | Generates or updates client-specific repositories and projects |
| `packages/site-core` | Rendering, page composition, and shared website behavior |
| `packages/ui` | Shared components and design tokens |
| `packages/templates` | Contractor, restaurant, and later approved compositions |
| `packages/website-modules` | Quote, lead, booking, menu, catalog, gallery, and analytics modules |
| `packages/integrations` | CRM, booking, POS, email, calendar, commerce, and Google adapters |
| `packages/contracts` | Versioned schemas, events, entitlements, delivery profiles, and validation |
| `packages/security` | Security helpers, access checks, audit support, and redaction |

These paths describe the intended M1 structure. The current repository has not
yet been bootstrapped into this monorepo.

## Default infrastructure posture

A standard brochure, lead-generation, booking-link, or external-system website
must work without:

- A database
- Authentication
- Object storage
- Background jobs

Add Supabase or equivalent persistence only for purchased features requiring
state. Add authentication only for purchased login or dashboard features. Add
object storage only for required file workflows. Add a job system only for
retries, schedules, or reconciliation that cannot be handled safely otherwise.

Optional infrastructure remains isolated to the client deployment and its data
boundary.

## Configuration and versions

Each website deployment has one trusted client configuration and separate
runtime secrets. Record, at minimum:

- Application, template, package, configuration, and deployment versions
- Domain and infrastructure ownership
- Enabled capabilities and modules
- Last successful deployment
- Handoff status and transferred operational responsibility

Commercial terms may be linked through stable identifiers but are not runtime
configuration. See [Architecture boundaries](boundaries.md).

## Integration posture

Use the least invasive reliable method:

1. Deep link
2. Official embed or widget
3. Vendor SDK
4. OAuth or official API
5. Webhook plus API synchronization
6. Scheduled import/export
7. Permitted, economical, human-supervised browser assistance
8. Separately priced replacement-system decision

Client booking, CRM, POS, calendar, accounting, and commerce systems remain
authoritative unless explicitly contracted otherwise.

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-44 — initial stack](https://app.notion.com/p/3a88d3550dc381efb3cfd94bc12cf2ac)
- [TSK-47 — integration decision tree](https://app.notion.com/p/3a88d3550dc3816ab46ec4441be26ecb)
- [M1 success criteria](https://app.notion.com/p/3a88d3550dc381839283d043270dada6)
