# Governance record templates

Use these records when later Feature, Milestone, or Task work defines or accepts
a package. Copy only the records triggered by the package scope, keep each
record with the package evidence, and link the completed record from the
package's acceptance mapping. Do not turn the templates into a new source of
product, commercial, or runtime truth.

## Routing

| Package question or trigger | Record to copy or link |
| --- | --- |
| Which system is authoritative for each mutable business object, and what package-local workflow state exists? | [Business-object authority and workflow-state record](business-object-authority-and-workflow-state.md) |
| Where are this client's deployment and data isolated, and what retention, backup, restore, export, and deletion duties apply? | [Client-isolation and data-lifecycle record](client-isolation-and-data-lifecycle.md) |
| How can each hosted vendor or adopted OSS dependency be exited, who owns incidents and support, are the economics acceptable, and is the selected delivery profile ready? | [Hosted-vendor exit, support-economics, and handoff-acceptance record](hosted-vendor-exit-support-and-handoff.md) |

Use the first record for every mutable business object. Use the second whenever
a package handles client configuration, credentials, provider resources, or
data, including Tier A packages whose stored-state fields are N/A. Use the
third whenever a hosted service, self-hosted/adopted OSS component, managed
operation, or client handoff is in scope.

Complete package-level gates in the
[Full-Package Definition of Done](../full-package-definition-of-done.md). Use
the status and adoption-mode semantics from the
[OSS adoption and abandonment register](../oss-adoption-register.md); these
templates do not approve a new package, service, licence position, or adoption
mode.

## Binding use rules

- Record exactly one authoritative system for each mutable business object.
  Derived, cached, and read-only copies are not co-authoritative.
- Keep package-local workflow state separate from customer business authority.
  A replacement requires explicitly sold migration, cutover, reconciliation,
  rollback, and acceptance scope.
- Keep every client deployment and data plane isolated. Do not create a shared
  mutable customer business-data plane, shared customer database, shared
  approval queue, generic workflow platform, or universal CRM, booking,
  ordering, or ledger system.
- Treat Contractor, Restaurant, and Retailer as variants without changing or
  enumerating commercial capabilities in a completed record.
- Select exactly one delivery profile per package. Managed packages require
  exit-readiness; client handoffs require completed transfer evidence.
- Store credential owner, account, reference, rotation, and transfer evidence
  only. Never store secret values in these records.
- Derive support limits and minimum-margin thresholds from authoritative
  commercial sources. Do not invent coverage, cadence, SLA, recovery, or
  margin values, and do not promise 24/7 support.
- For every N/A or substitution, record rationale, risk, and evidence. A Tier A
  package with no stored state uses a written N/A rather than adding
  infrastructure.

## Existing authority and procedures

- [Architecture boundaries](../../architecture/boundaries.md)
- [Deployment model](../../architecture/deployment-model.md)
- [Commercial delivery model](../../product/commercial-delivery-model.md)
- [Client source handoff](../../runbooks/client-source-handoff.md)
- [Client recovery and ownership transfer](../../runbooks/client-recovery-and-transfer.md)
- [Optional-data backup and restore](../../runbooks/optional-data-backup-restore.md)
