# Capability model

## Core concepts

| Concept | Meaning |
|---|---|
| Product family | Melbourne Local Growth Ops as the single commercial and product umbrella |
| Capability | An independently activatable, deliverable, billable, pausable, and cancellable service |
| Package | A commercial combination of capabilities; never a runtime dependency graph |
| Entitlement | The commercial authorization for a client to receive a capability or feature |
| Delivery profile | Who operates and owns the website source and infrastructure |
| Runtime configuration | Non-secret values required by one deployed site to render and integrate |
| Commercial contract state | Pricing, term, billing, renewal, cancellation, and buyout information |

## Capabilities

### Website & Lead Systems

Owns website rendering, client and site configuration, domains, forms, leads,
analytics, deployment, website modules, and website-facing adapters for client
systems. It is the primary software build.

### Google Presence Operations

Owns Google Business Profile audit, access, proposed changes, approvals,
reporting, and recommendations. It may operate manually and must not be modelled
as a website plugin.

### Reputation Operations

Owns review intake, classification, risk escalation, drafting, approval,
published-reply records, and complaint insights. It may operate manually and
must not be modelled as a website plugin.

## Independence rules

- A client can exist without a website.
- Purchasing or cancelling one capability cannot activate or disable another.
- A package name cannot be used as a runtime feature flag.
- Website launch cannot require Reputation or Google Presence automation.
- Shared approved business information does not merge capability permissions,
  delivery, data ownership, or cancellation.
- Capability-specific data belongs to its capability boundary.
- Cross-capability behavior requires an explicit contract, not an implicit import
  or database dependency.

## Entitlements and configuration

An entitlement answers, “What has the client purchased?” Runtime configuration
answers, “How does this deployment operate?” They may reference the same stable
client and capability identifiers, but neither is a substitute for the other.

Runtime code may consume a deployment-safe projection derived from approved
entitlements. It must not calculate pricing, renew contracts, decide buyouts, or
become the source of truth for commercial state.

## Contract families

The product uses three contract families rather than one universal plugin model:

1. **Website module contracts** define configuration, UI, handlers,
   dependencies, analytics, fallbacks, tests, setup, support, and portability.
2. **Managed-service workflow contracts** define intake, access, evidence,
   approvals, escalation, deliverables, reporting, retention, and manual fallback.
3. **Connector contracts** define authentication, capabilities, normalized
   operations, health, reconciliation, disconnection, audit data, and portability.

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-46 — contract families](https://app.notion.com/p/3a88d3550dc381a29005e79670fde26f)
- [TSK-88 — capability and delivery model](https://app.notion.com/p/3aa8d3550dc381139645e4a62ca0aa84)
