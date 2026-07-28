# Commercial delivery model

## Delivery profiles

### Managed-isolated

The agency operates a client-specific site and Vercel project under
agency-managed infrastructure. “Managed” describes operational responsibility;
it does not mean a shared public application or shared client runtime.

### Client handoff

The client receives a self-contained client-specific source repository and
deployment in client-owned accounts. The handoff records account ownership,
transferred operational responsibility, versions, domains, secrets to recreate,
support boundaries, and rollback expectations.

### Client-owned maintenance

After handoff, the client owns the repository and infrastructure. The agency may
be retained for updates or support, but the site must continue to operate without
that relationship.

“Managed shared” is not a supported technical delivery mode. Earlier Notion
language describing a shared application is superseded by the isolated
deployment decision.

## Ownership

| Asset or responsibility | Normal owner |
|---|---|
| Domain and DNS authority | Client |
| Business content and approved assets | Client |
| Client-specific delivery repository and operational control after handoff | Client |
| Analytics property and business data | Client |
| Leads and customer data | Client |
| Google Business Profile and connected accounts | Client |
| Private Website Factory | Agency |
| Reusable templates, components, and modules | Agency |
| Reusable connectors and internal tooling | Agency |
| Deployment automation and general contract designs | Agency |

Receiving and controlling a repository does not transfer copyright in reusable
background IP embedded under the delivery agreement. An explicit IP assignment
may change this allocation, but it requires human and commercial approval.

## Commercial state boundary

Pricing, fees, minimum terms, renewals, cancellation, early-ownership terms, and
buyout calculations are commercial contract state. They do not belong in public
website runtime configuration.

The upstream Product page currently mentions a minimum managed term and a
declining early-ownership buyout as assumptions. Those mechanisms are not locked
architecture decisions and must not be implemented without explicit approval.

## Handoff standard

A handoff is incomplete if the delivered site depends on:

- A private agency repository or package registry
- Agency-only credentials or personal accounts
- Undocumented environment variables
- An agency-controlled runtime required for public-site operation
- Untransferred third-party accounts needed for purchased features

The agency can retain its reusable factory while delivering a portable,
client-specific artifact containing everything needed to build, deploy, and
operate that client site.

## Sources

- [Product decision and ownership rationale](https://app.notion.com/p/3a88d3550dc3810d9619c23fe8784140)
- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-43 — isolated delivery and background IP](https://app.notion.com/p/3a88d3550dc3815eaa5efe22b2c23dca)
- [TSK-88 — delivery profiles](https://app.notion.com/p/3aa8d3550dc381139645e4a62ca0aa84)
