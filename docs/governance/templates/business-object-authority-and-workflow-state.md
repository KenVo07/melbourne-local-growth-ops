# Business-object authority and workflow-state record: [package]

Copy this record for package planning and acceptance. Keep links to authoritative
evidence; do not reproduce full Product, Project, Feature, Milestone, or Task
content here.

## Record identity

- Package: [package name and repository link]
- Contract family: [Website Module | Managed-Service Workflow | Connector]
- Package scope evidence: [repository task or approved upstream reference]
- Completed record location: [stable repository link]

## Business-object authority

Record every mutable customer business object touched by the package. Each row
must name exactly one authoritative system. A derived, cached, synchronized,
or read-only copy must be identified as such and cannot be co-authoritative.
Existing client systems remain authoritative unless replacement is explicitly
sold and accepted.

| Mutable business object | Client owner | Exactly one authoritative system | Authoritative account or resource reference | Package operation against authority | Derived, cached, or read-only copies and purpose | Reconciliation or refresh evidence | Authority decision evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [object] | [owner] | [system] | [reference, never a credential value] | [read / submit intent / update through approved interface] | [copy and classification, or None] | [evidence or N/A record] | [link] |

Confirm:

- [ ] No object has blank, multiple, or co-authoritative systems.
- [ ] The package does not become a universal CRM, booking, ordering, or ledger
  system.
- [ ] Minimal delivery evidence is distinguished from customer business state.
- [ ] Any copied state has an explicit purpose, refresh/reconciliation behavior,
  retention, export, and deletion treatment linked from the lifecycle record.

## Package-local workflow state

Workflow orchestration stays within this package and is never a duplicate
business source of truth. Do not use a shared approval queue, generic workflow
platform, or shared mutable customer data plane.

| Workflow-state item | Package-local owner and boundary | Purpose and allowed transitions | Related business object and authority row | Why this state is not business authority | Retention, export, and deletion evidence | Manual fallback or recovery evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [state item] | [package/client boundary] | [purpose and transitions] | [object/link] | [explanation] | [lifecycle record link] | [link] |

If the package holds no workflow state, complete an N/A record below; do not
add state merely to fill this section.

## Authority-replacement gate

Complete this section only when the package replaces an existing authoritative
system. A website submission, integration, workflow, cache, or read model does
not by itself constitute a replacement.

| Business object | Current authority | Proposed single replacement authority | Explicitly sold replacement scope | Migration and validation plan | Cutover criteria and authority switch | Reconciliation plan | Rollback plan | Final acceptance evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [object] | [system] | [system] | [authoritative commercial reference] | [link] | [link] | [link] | [link] | [link] |

Do not declare replacement complete while two systems can independently mutate
the same business object without a documented cutover and reconciliation
boundary.

## N/A and substitutions

Duplicate this block for every N/A or substituted field.

- Field or gate: [name]
- Status: [N/A | Substituted]
- Rationale: [specific scope or architecture reason]
- Risk: [consequence of omission or substitution]
- Evidence: [stable repository or approved source link]

## Acceptance confirmation

- [ ] Every mutable business object has exactly one authoritative system.
- [ ] Workflow ownership and business authority are separate and evidenced.
- [ ] Client systems remain authoritative, or the sold replacement gate is
  complete with migration, cutover, reconciliation, rollback, and acceptance
  evidence.
- [ ] No shared platform or cross-client mutable business-data plane is
  introduced.
- Limitations and residual risks: [link or concise summary]
- Acceptance evidence and status: [link and status]

## Governing references

- [Architecture system-of-record boundary](../../architecture/boundaries.md#system-of-record-boundary)
- [Capability model](../../product/capability-model.md)
- [Full-Package Definition of Done](../full-package-definition-of-done.md)
- [ADR-0001: independent capabilities](../../decisions/ADR-0001-product-family.md)
