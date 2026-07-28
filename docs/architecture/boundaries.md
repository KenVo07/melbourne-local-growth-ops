# Architecture boundaries

## Product and capability boundaries

- Melbourne Local Growth Ops is one product family.
- The three capabilities have independent commercial and operational lifecycles.
- Website code must not import Reputation or Google Presence workflow logic.
- Shared business identity does not create shared runtime dependencies.
- A package name is commercial metadata, not a feature graph.

## Deployment boundary

Every public website is a client-specific deployment with its own validated
configuration, secrets, analytics identifiers, domain, and failure boundary.
Code must not resolve public website tenancy dynamically across clients.

## Runtime and commercial-state boundary

Runtime configuration may contain deployment-safe values such as:

- Client and business display identity
- Site structure and theme
- Enabled modules
- Domain and analytics identifiers
- Connector selections and non-secret settings
- Delivery-profile information required for operational behavior

Runtime configuration must not be the source of truth for:

- Prices, invoices, or payment status
- Contract dates, renewals, or cancellation
- Minimum terms or buyout calculations
- Sales packages
- Internal margin or support-cost calculations

Commercial entitlements may produce an approved runtime projection. Runtime
configuration must not mutate commercial contract state.

## System-of-record boundary

The client’s booking, CRM, POS, accounting, calendar, or commerce platform
remains authoritative unless replacement is explicitly contracted. The website
may submit intents, display confirmed outcomes, and retain minimal delivery
evidence. It must not maintain competing business state without an approved
reconciliation design.

## Contract-family boundary

- Website modules govern website UI and runtime behavior.
- Managed-service workflows govern human-operated Google and Reputation work.
- Connectors govern communication with external systems.

Do not force all three into one plugin abstraction.

## Infrastructure boundary

No database, authentication, object storage, or background jobs are required for
a standard site. Optional infrastructure must be justified by a purchased
feature, isolated to the client, portable where promised, and included in
handoff documentation.

## Ownership and portability boundary

Client-specific delivery artifacts must not contain or depend on unrelated
client data. A handed-off site cannot depend on private agency repositories,
package registries, credentials, undocumented secrets, or personal accounts.
Reusable factory IP remains private unless explicitly assigned.

## Integration and security boundary

- Prefer client-granted roles, OAuth, scoped client-owned keys, or client-owned
  service accounts.
- Never request personal master passwords.
- Never put sensitive personal information in URLs, analytics, or unsafe logs.
- Do not introduce a second source of truth without reconciliation.
- Reject or re-price integrations that violate vendor terms, lack official
  access, cannot prove ownership, or create unacceptable lifetime support or risk.

## Human approval required

Approval is required before changing:

- Product-family or capability independence
- Public-runtime isolation or delivery modes
- Client/agency ownership and background-IP rules
- Default infrastructure posture
- Commercial/runtime state separation
- A client system of record
- Seller/ecommerce scope
- Handoff portability
- Authentication, payments, tenancy, or secret-handling architecture

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-43 — product and deployment boundary](https://app.notion.com/p/3a88d3550dc3815eaa5efe22b2c23dca)
- [TSK-46 — contract-family boundary](https://app.notion.com/p/3a88d3550dc381a29005e79670fde26f)
- [TSK-47 — integration boundary](https://app.notion.com/p/3a88d3550dc3816ab46ec4441be26ecb)
- [TSK-48 — seller boundary](https://app.notion.com/p/3a88d3550dc3815cb22af78710ed663d)
