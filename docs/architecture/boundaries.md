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
- A strict, versioned Website Experience selected from finite Design DNA and
  Signature options (legacy one-page preset path)
- A strict, versioned client Page Graph describing routes, page kinds,
  relationships, navigation labels and destinations
- A strict, versioned Project/Case Study collection and client-owned media
  references
- A strict, versioned reference to the trusted authored Client Experience
  manifest at the fixed path `experience/manifest.json`
- Explicit `OFF | AUTO | ON` Foundation Search configuration and its bounded
  public-page or public-section scope

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

## Website experience and search boundary

- Semantic Profile Packs own truthful business/profile content and first-time
  task meaning. They do not own the client's route set or the final route
  renderer. Visible identity must not be smuggled into profile content.
- Route *mechanics* — static generation, path resolution, not-found behavior,
  link/focus semantics, metadata and structured-data machinery — are Platform
  Kernel property. The validated client Page Graph owns the actual *route graph*:
  which pages exist, their paths, kinds, relationships, navigation labels and
  navigation destinations.
- Navigation labels and destinations are explicit validated data. They are not
  derived from page or section headings.
- Single-page delivery remains fully supported through the legacy adapter. It is
  an output option, not a platform constraint. A multi-page route graph is
  equally first-class.
- Projects/Case Studies are first-class structured proof with stable IDs, slugs,
  truth classification, narrative blocks, facts, media and relationships. They
  are not a homepage gallery section.
- Section order may permute only the exact validated semantic section set. It
  cannot omit, duplicate or invent task content. This rule governs the legacy
  one-page adapter.

### Untrusted configured data

Client configuration is validated non-executable data. It must never carry
arbitrary HTML, CSS or JavaScript source, class names, selectors, module
specifiers, filesystem paths or remote code locations. Configuration may
reference the trusted source package only through the single fixed manifest
path.

`experienceRouteId` is not an exception to that rule. It is a bounded lowercase
identifier, never a path or module specifier. It is resolved only against the
route set the trusted manifest itself registers, and validation fails when the
page graph and the manifest do not cover exactly the same route IDs. Configured
data therefore selects among code the authored package already declares; it can
never name new code.

### Trusted authored client source

Real React/TypeScript/CSS source for one client is legitimate input, but only
under the fixed `experience/` source boundary. Before it may be built or copied
it must be inspected for path escapes and symlinks, restricted to sanctioned
imports and exact governance-approved dependencies, denied server/private/secret
access, typechecked, built, tested, accessibility- and performance-reviewed,
hashed and inventoried. It ships inside the standalone client artifact and must
not depend on private Factory packages at handoff. This boundary is not relaxed
for convenience.

The authoritative import allowlist and deny-list lives in the "Client Experience
Layer" section of
[Premium Website Platform & Experience Standard](../product/premium-website-experience-standard.md).
Every declared dependency must be an exact version with an approved entry in
[the OSS adoption register](../governance/oss-adoption-register.md).

### Signatures and Design DNA

- A Signature is a bounded client-specific component that creates a memorable
  identity or interaction. A **client-local** Signature living in the client's
  own `experience/` source is legal and requires no shared Core registry change.
  Promotion into shared Platform code happens only on repeated evidence.
- Design DNA governs the authored experience as a concise creative grammar and
  provenance artifact. It is not the complete frontend, not an exhaustive
  renderer configuration and not a layout DSL. The authored source is the
  implementation.
- Neither mechanism may become a generic plugin SDK, a page builder, a global
  provider or a prerequisite for baseline tasks.

### Motion

The Kernel owns reduced-motion handling, lifecycle/cleanup conventions,
performance instrumentation and opt-in client-island seams. It ships no
mandatory animation package. Sophisticated motion is opt-in and scoped to the
authored client experience that declares it. Legacy, static and no-motion sites
must pay no motion runtime, chunk or dependency cost.

### Foundation Search

- Foundation Search indexes only already-validated public records for one client
  deployment. Connector secrets, action URLs, drafts, private routes and
  cross-client content remain outside the index.
- v2 records target real route or route+anchor URLs from the validated Page
  Graph. Legacy one-page definitions keep section-anchor records.
- Search OFF is the legacy default and must produce no Pagefind output, markup,
  browser import or request. Search ON remains an optional navigation aid and
  must never repair weak information architecture.

## Reference-class capability boundary

The platform ceiling is gated by
[Premium Website Reference-Class Capability Standard](../product/reference-class-capability-standard.md).
Passing automated tests does not establish premium acceptance. A material human
craft failure — template smell, weak mobile art direction, janky production
motion, shallow Projects architecture or fabricated proof — blocks PASS and
cannot be averaged away by green CI.

WEB-01B proves the platform ceiling with fictional, clearly classified proof
content. Real-client discovery, content sourcing, evidence verification,
creative approval workflow and the delivered Creative Proof Loop remain WEB-01E
responsibilities and are not implemented here.

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
The portable managed-site source contains only the transformed runtime and
vendored public contracts needed to rebuild that client. Compatibility evidence
for this source artifact does not itself complete WEB-01D security and
responsibility transfer.

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
- The trusted authored client source boundary, its import allowlist, or its
  dependency governance rules

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-43 — product and deployment boundary](https://app.notion.com/p/3a88d3550dc3815eaa5efe22b2c23dca)
- [TSK-46 — contract-family boundary](https://app.notion.com/p/3a88d3550dc381a29005e79670fde26f)
- [TSK-47 — integration boundary](https://app.notion.com/p/3a88d3550dc3816ab46ec4441be26ecb)
- [TSK-48 — seller boundary](https://app.notion.com/p/3a88d3550dc3815cb22af78710ed663d)
