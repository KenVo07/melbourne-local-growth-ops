# Client-isolation and data-lifecycle record: [package]

Use this record to prove one client's deployment, provider resources,
credentials, and data cannot cross into another client's boundary. Tier A
packages still complete the boundary and N/A sections.

## Record identity and boundary

- Package: [package name and repository link]
- Client reference: [non-secret stable reference]
- Deployment reference: [non-secret stable reference]
- Delivery profile: [MANAGED_ISOLATED | CLIENT_HANDOFF; exactly one]
- Client data-plane boundary: [deployment/project/account/resource boundary]
- Business-authority record: [completed record link]
- Scope and infrastructure approval evidence: [link]

The boundary must not use a shared mutable customer business-data plane,
shared customer database, or shared approval/workflow platform. Optional state
exists only for a purchased and approved feature and remains client-isolated.

## Provider, project, and account ownership

| Resource or provider | Purpose | Client/deployment/data-plane boundary | Provider project or resource reference | Account owner | Data owner | Operational owner | Portability or handoff evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [resource] | [purpose] | [isolated boundary] | [reference] | [owner] | [owner] | [owner] | [link] |

## Credential and secret references

Never place a secret value, token, key, password, environment value, or raw
provider response in this record.

| Provider/resource | Account owner | Credential owner | Secret reference or environment-variable name | Authorized scope | Rotation responsibility and trigger | Transfer, recreation, or revocation evidence |
| --- | --- | --- | --- | --- | --- | --- |
| [resource] | [owner] | [owner] | [reference/name only] | [least-privilege scope] | [owner and sourced trigger] | [link] |

## Data lifecycle

Retention and recovery requirements must come from an authoritative task,
contract, business-impact assessment, provider constraint, or approved policy.
Do not invent a duration, backup cadence, RPO, RTO, or deletion deadline.

| Data or state class | Authoritative system or derived classification | Storage location and client boundary | Collection/minimization evidence | Retention source and rule | Conditional backup procedure and evidence | Conditional restore acceptance | Portable export procedure and evidence | Deletion procedure and deletion evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [class] | [authority record row or derived/read-only] | [location] | [link] | [source/rule] | [link or N/A record] | [link or N/A record] | [link] | [link] |

A source/deployment rollback and a data restore are separate operations; one
does not authorize the other.

## Tier A no-state determination

Choose one outcome and provide evidence:

- [ ] No stored application or workflow state. Database, authentication store,
  object storage, queue, and background jobs are N/A. Complete the N/A record
  below with rationale, risk, and evidence; do not add empty infrastructure.
- [ ] Stored state exists for a purchased feature. Tier A is not applicable;
  link the higher-tier classification, infrastructure approval, isolated
  resource declarations, and tested backup/restore evidence.

Tier A N/A rationale:

- Rationale: [why no stored state exists]
- Risk: [failure/recovery consequence of stateless delivery]
- Evidence: [ADR/task/test link]

## Cross-client isolation evidence

| Isolation subject | Test or inspection evidence | Expected fail-closed result | Result |
| --- | --- | --- | --- |
| Validated configuration | [link] | Another client's configuration cannot load | [result] |
| Credentials and secret references | [link] | Another client's reference or value cannot resolve | [result] |
| Analytics identifiers | [link] | Another client's property cannot load | [result] |
| Domains | [link] | Cross-project/domain conflict stops promotion | [result] |
| Content and assets | [link] | Unrelated client artifact fails the isolation scan | [result] |
| Optional persistent data, if present | [link or N/A record] | Cross-client access is denied and detected | [result] |

## N/A and substitutions

Duplicate this block for every N/A or substituted field, including backup and
restore when no persistent state exists.

- Field or gate: [name]
- Status: [N/A | Substituted]
- Rationale: [specific reason]
- Risk: [consequence]
- Evidence: [stable repository or approved source link]

## Acceptance confirmation

- [ ] Provider, project, account, data, and operational ownership are explicit.
- [ ] Credential fields contain references and evidence only, never values.
- [ ] Retention, conditional backup/restore, export, deletion, and deletion
  evidence are complete for every data/state class.
- [ ] Cross-client configuration, credentials, analytics, domain, content,
  asset, and optional-state tests pass.
- [ ] Tier A no-state items have written N/A rationale, risk, and evidence.
- Limitations and residual risks: [link or concise summary]
- Acceptance evidence and status: [link and status]

## Governing references

- [ADR-0002: isolated client deployments](../../decisions/ADR-0002-isolated-client-deployments.md)
- [ADR-0003: no stateful infrastructure by default](../../decisions/ADR-0003-no-database-by-default.md)
- [Deployment model](../../architecture/deployment-model.md)
- [Optional-data backup and restore](../../runbooks/optional-data-backup-restore.md)
- [Client recovery and ownership transfer](../../runbooks/client-recovery-and-transfer.md)
