# Full-Package Definition of Done

## Purpose and Authority

This document defines a reusable, tiered Definition of Done framework for components, modules, workflows, and packages within Melbourne Local Growth Ops. It establishes acceptance gates scaled to actual infrastructure dependencies, state boundaries, and financial risk.

Apply this framework when:
- Completing a new website module, managed-service workflow, or connector
- Accepting a feature branch or vertical slice for integration
- Planning handoff artifacts or operational readiness reviews
- Assessing whether a component meets production deployment standards

This document supplements task-specific acceptance criteria. Task specifications remain authoritative for feature scope and requirements. When a task's acceptance criteria conflict with this Definition of Done, escalate for human resolution rather than silently choosing one.

Authoritative sources:
- [Technical Build Plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- Repository ADRs in `docs/decisions/`
- Architecture documents in `docs/architecture/`
- Task specifications in `docs/tasks/`

## Tier Classification

Classify each package by its highest applicable risk, state, or transaction dimension. Universal gates always apply; the assigned highest tier applies; lower-tier gates apply only when their underlying conditions remain applicable. Component-level evidence inside a higher-tier package may remain at a lower tier where appropriate.

### Tier A: Stateless Website Components

**Indicators:**
- No database, authentication, object storage, or background jobs (if any of these are required, reclassify to Tier B)
- Read-only integration with external systems via deep links, embeds, or official APIs
- Stateless form submission with immediate delivery
- Client-owned analytics and monitoring
- Static content rendering and portable asset delivery

**Examples:** Brochure sites, lead forms with Resend delivery, booking CTAs linking to client systems, Google Analytics integration, external-system embeds

### Tier B: Stateful Business Systems and Workflows

**Indicators:**
- Justified persistent application state requiring a database
- User authentication or session management
- File upload/download workflows requiring object storage
- Background jobs for retries, schedules, or reconciliation
- Workflow state management (intake, approval, escalation, deliverables)
- Replacement or augmentation of client system-of-record functionality

**Examples:** CRM-replacement modules, managed Google Presence workflow state, review-drafting workflow with package-local review and approval state, booking systems maintaining reservation state

### Tier C: Transactional and Financial Packages

**Indicators:**
- Payment processing, authorization, capture, or settlement
- Refund, dispute, or chargeback handling
- Financial reconciliation procedures
- Transactional correctness requirements (ACID or compensating transactions)
- Applicable transactional or financial legal/regulatory duties and contractual assurance requirements assessed from authoritative contract terms and jurisdictional law

Other applicable legal/regulatory duties (e.g., nonfinancial privacy obligations) require their relevant conditional gates or risk escalation but do not automatically classify a package as Tier C.

**Examples:** Payment gateway integration, custom checkout flow, refund-processing module, invoicing system with payment reconciliation

## Universal Gates (All Tiers)

These gates apply to all packages regardless of tier classification. Every omitted or substituted gate requires written, evidence-linked rationale.

### Product and Requirements

- [ ] **Requirement traceability**: Links to upstream Product, Project, Feature, Milestone, or Task specifications
- [ ] **Acceptance criteria mapping**: Task-specific acceptance criteria satisfied with evidence
- [ ] **Feature completeness**: Core functionality implemented per specification; known limitations documented
- [ ] **Contract family alignment**: Package correctly implements website module, managed-service workflow, or connector contract
- [ ] **Dependency-licence inventory**: Evidence-linked inventory of all runtime and build-time dependencies with licence information; separate open-source register/process governs licence review and approval

### User-Facing Product and UI Quality

Apply where the package has user-facing UI or customer-visible behavior:

- [ ] **Professional content and presentation**: Content is clear, correctly spelled, and appropriate for the target customer (contractors, restaurants, retailers)
- [ ] **Responsive behavior**: UI adapts to mobile, tablet, and desktop viewports
- [ ] **Accessibility**: Semantic HTML, keyboard navigation, ARIA labels, color contrast; proportionate automated checks and manual validation evidence; named conformance level applies only when linked to authoritative task, contract, or legal source; unresolved applicability escalated
- [ ] **Conversion and contact journey**: Lead/booking/contact paths tested end-to-end; success and error states confirmed
- [ ] **Trust signals**: Business identity, contact information, privacy/consent handling visible and correct
- [ ] **Failure and fallback states**: Network errors, invalid input, unavailable integrations display helpful messages; no silent failures
- [ ] **Design-sandwich evidence**: Visual design decisions documented per Technical Build Plan design-sandwich pattern where applicable

Non-UI packages (internal libraries, deployment tooling, observability adapters) may mark these N/A with rationale.

### Code Quality

- [ ] **Builds pass**: `pnpm build` succeeds with no errors
- [ ] **Type checking passes**: `pnpm typecheck` succeeds with no errors
- [ ] **Tests exist and pass**: `pnpm test` succeeds; tests cover core functionality and critical edge cases (no arbitrary coverage percentage required)
- [ ] **Configuration validates**: Client configuration passes contracts package validation with no errors

### Authority and Isolation

- [ ] **Single-client deployment boundary**: Code operates within one client's deployment scope; no cross-client data access
- [ ] **Configuration isolation**: Uses only the deployment's own validated configuration; tests prevent accidental cross-client imports
- [ ] **Capability independence preserved**: Activation or cancellation of this package does not implicitly enable, disable, or couple another capability's lifecycle
- [ ] **System-of-record authority respected**: If interacting with client booking, CRM, POS, accounting, or commerce systems, the client system remains authoritative unless replacement is explicitly contracted; reconciliation design documented if competing state exists

### Export and Handoff Portability

- [ ] **Module/connector transferability markers**: Website modules and connectors marked `TRANSFERABLE` or `CLIENT_OWNED` per contract schema
- [ ] **No cross-client data in artifacts**: Handoff artifacts contain only this client's data; isolation tests pass
- [ ] **Handoff documentation**: If `CLIENT_HANDOFF` delivery profile applies, handoff runbook, ownership checklist, and environment variable documentation exist

### Support Economics

Document proportionate support expectations:

- [ ] **Setup effort estimate**: Initial deployment and configuration time
- [ ] **Third-party and usage costs**: Vendor fees, API costs, infrastructure spend per client
- [ ] **Expected support time**: Routine updates, incident response, feature requests
- [ ] **Incident ownership**: Responsible team or role for operational issues
- [ ] **Included-support boundary**: What is covered under standard service vs. separately priced
- [ ] **Minimum recurring margin**: Revenue minus direct costs yields sustainable margin
- [ ] **Maximum per-client operational burden**: Time/cost per client does not exceed economic model
- [ ] **No unfunded 24/7 or SLA promises**: Support hours and response expectations match what is actually contracted and funded

Detailed reusable costing templates may be referenced from future operational-readiness governance (when available) rather than duplicated here.

## Tier A Gates: Stateless Website Components

Apply these gates when the package has no database, authentication, object storage, or background jobs.

### Security and Data Handling

- [ ] **Server-side form validation**: All user inputs validated on the server; client-side validation is enhancement only
- [ ] **Rate limiting and spam controls**: Form submissions or API calls protected by rate limits, CAPTCHA, or equivalent
- [ ] **No sensitive data in logs or URLs**: Form content, credentials, PII excluded from technical logs, analytics, and URLs
- [ ] **Client-owned analytics**: Analytics use client-owned Google Analytics 4 property; attribution excludes form payloads
- [ ] **Consent and attribution handling**: Privacy consent collected where required; lead attribution tracked safely
- [ ] **Safe external integration**: Deep links, embeds, or API calls use least-invasive reliable method per integration decision tree; no personal master passwords requested

### Operations and Observability

- [ ] **Structured technical logging**: Logs include safe client/deployment attribution, correlation IDs, categories, timestamps; use `ObservabilityEvent` contract
- [ ] **Safe failure handling**: Provider failures, network errors, invalid configuration result in logged errors and user-facing fallback messages; no silent data loss
- [ ] **Rollback documentation**: Vercel deployment rollback procedure documented and tested per `docs/runbooks/vercel-deployment-rollback.md`
- [ ] **Deployment manifest**: `DeploymentManifest` records client/configuration identity, versions, delivery mode, domains, build provenance

### Infrastructure Confirmation

- [ ] **No infrastructure dependencies**: Explicitly confirm this Tier A package requires no database, authentication, object storage, or background jobs. A package requiring any of these must be reclassified to Tier B and cannot remain Tier A regardless of rationale or justification.

## Tier B Additions: Stateful Business Systems and Workflows

Apply these additional gates when the package introduces justified persistent state, authentication, or workflow boundaries. Universal gates remain applicable.

### Security and Data Handling

- [ ] **Authentication boundary**: User authentication mechanism documented; session management secure
- [ ] **Authorization model**: Access control rules defined; users/roles cannot access unauthorized data
- [ ] **Data ownership documentation**: Client data ownership, retention, and deletion policies documented
- [ ] **Reconciliation design**: If maintaining business state that competes with a client system-of-record, reconciliation procedure documented and tested

### State Management

- [ ] **Idempotency**: State-mutating operations are idempotent or safe to retry
- [ ] **Concurrency handling**: Concurrent updates to shared state handled safely (optimistic locking, transactions, or conflict resolution)
- [ ] **State transition validation**: State machines validated; invalid transitions rejected
- [ ] **Background job reliability**: Jobs handle retries and transient failures appropriately; dead-letter handling proportionate to failure impact and recovery requirements

### Business and Workflow (Conditional)

Apply when the package implements a managed-service workflow:

- [ ] **Intake mechanism**: Workflow requests captured with required context
- [ ] **Evidence collection**: Work performed is documented with appropriate evidence
- [ ] **Approval process**: Where required, approvals obtained before committing changes
- [ ] **Escalation paths**: High-risk or ambiguous cases escalate to appropriate owner
- [ ] **Deliverables and reporting**: Outputs delivered to client; reporting supports accountability
- [ ] **Retention policy**: Workflow state and evidence retained per requirements
- [ ] **Manual fallback**: Workflow can degrade to manual operation if automation unavailable

Workflow orchestration is package-local. Do not introduce shared approval queues, universal workflow runtimes, or shared mutable customer data planes without explicit architecture approval.

### Operations and Observability

- [ ] **Backup and restore runbook**: If persistent state exists, backup procedure documented per `docs/runbooks/optional-data-backup-restore.md`; restore tested
- [ ] **Data migration plan**: Schema changes and data migrations tested and documented
- [ ] **State monitoring**: State operations (writes, jobs, auth attempts) monitored; alerting configured for operational issues
- [ ] **Client-specific infrastructure isolation**: Database, auth, storage, jobs isolated to the client deployment; no shared multi-tenant data plane

## Tier C Additions: Transactional and Financial Packages

Apply these additional gates when the package processes payments, handles refunds/disputes, or requires financial reconciliation. Universal gates and applicable Tier B state/reconciliation gates remain in effect; Tier A's no-infrastructure confirmation does not apply.

### Transactional Correctness

- [ ] **Transaction boundaries**: Financial operations grouped into atomic transactions or compensating transaction sequences
- [ ] **ACID properties or compensating transactions**: Database transactions provide atomicity, consistency, isolation, durability; or compensating actions designed for distributed scenarios
- [ ] **Financial reconciliation procedure**: Periodic reconciliation between internal records and payment provider settlement data documented and tested
- [ ] **Audit trail**: All financial state transitions logged with timestamps, amounts, actors, correlation IDs; log retention and tamper-evidence appropriate to risk

### Financial Operations

- [ ] **Payment provider failure modes**: Authorization, capture, settlement, and timeout failures handled gracefully; no duplicate charges or lost payments
- [ ] **Refund and dispute handling**: Refund requests processed correctly; dispute/chargeback procedures documented with required evidence collection
- [ ] **Settlement verification**: Payment provider settlement reports reconciled against internal transaction records
- [ ] **Concurrency and replay safety**: Duplicate payment attempts detected and rejected; replay scenarios tested

### Operational Acceptance

- [ ] **Outage recovery procedure**: Financial system outage recovery documented and tested; data consistency verified after recovery
- [ ] **RPO/RTO explicitly derived**: Recovery point objective and recovery time objective derived from contracted SLA or business impact assessment; not invented arbitrarily
- [ ] **Incident response plan**: Financial incident escalation path, stakeholder communication, and remediation steps documented

### Regulatory and Legal Compliance

- [ ] **Applicable legal and regulatory duties**: Duties derived from authoritative jurisdictional law assessed; written assessment documented; evidence collected for each duty that applies
- [ ] **Contractual assurance and vendor obligations**: Obligations derived from authoritative contract terms and payment provider requirements assessed; written assessment documented; evidence collected for each obligation that applies
- [ ] **Unresolved interpretation escalated**: Legal or regulatory questions escalated to qualified counsel rather than guessed

Do not invent regulatory obligations or declare them N/A without evidence. Do not claim compliance without controls and evidence.

## Delivery Profile Distinctions

All tiers require portability and exit-readiness evidence, but the depth differs by delivery profile. Each package has exactly one delivery profile. MANAGED_ISOLATED and CLIENT_HANDOFF are mutually exclusive; complete only the subsection matching the package's current delivery profile.

### Profile-Independent Portability and Exit Gates

- [ ] **Hosted-vendor exit**: For each hosting, email, analytics, storage, monitoring, or workflow vendor: portable configuration and data format confirmed; transfer, migration, or recreation path designed; exit cost and support consequences assessed; credential and account ownership documented; operational responsibility documented; explicit interface or connector boundary documented
- [ ] **No private factory dependencies in handoff artifacts**: Final handoff artifacts contain no private repository, registry, workspace link, credential, account, or agency-only runtime dependency; for managed packages, evidence that export pipeline transforms or vendors required reusable runtime source into portable artifact without publishing the private factory or transferring agency ownership of reusable background IP

### MANAGED_ISOLATED

- [ ] **Client-specific deployment**: Package operates in an isolated agency-managed Vercel project for this client only
- [ ] **Agency operational ownership**: Agency retains operational responsibility; client does not operate infrastructure
- [ ] **Version and rollback**: Deployment versions recorded in `DeploymentManifest`; rollback procedure documented
- [ ] **Monitoring and support**: Agency monitors and responds to incidents per contracted support terms
- [ ] **Exit-readiness**: Source and data export mechanisms designed and documented even if handoff not yet initiated

### CLIENT_HANDOFF

- [ ] **Source repository transfer**: Client-specific source repository created in client-owned GitHub/GitLab account per `docs/runbooks/client-source-handoff.md`
- [ ] **Infrastructure ownership transfer**: Hosting (Vercel), domain/DNS, analytics (GA4), email (Resend or equivalent) accounts transferred to client ownership via provider-supported ownership transfer OR migrated/recreated in client-owned accounts; transfer mechanism documented
- [ ] **Environment configuration**: Required environment variables documented with purpose, requirement status, and client ownership; no agency credentials remain
- [ ] **Transferable dependencies confirmed**: All dependencies are public npm packages; no private registries, workspace links, or agency-specific tooling
- [ ] **Handoff verification**: `pnpm verify:handoff` passes in isolated environment without agency credentials
- [ ] **Recovery runbooks transferred**: Client receives handoff checklist, deployment manifest, SHA-256 digest, and recovery procedures per `docs/runbooks/client-recovery-and-transfer.md`
- [ ] **Agency background IP separated**: Reusable factory IP remains private; only client-specific source and configuration transferred
- [ ] **Client operational ownership**: Client owns and operates infrastructure; agency support is optional paid service post-handoff

Do not falsely claim CLIENT_HANDOFF without actual completed source, account, and operational ownership transfer.

## Rationale and Evidence Requirements

### Mandatory Rationale for Omissions and Substitutions

Every gate marked N/A or substituted with an alternative approach requires:

1. **Written justification**: Specific architectural or feature-based reason why the gate does not apply or why an alternative is sufficient
2. **Risk assessment**: Potential consequences of the omission or substitution
3. **Evidence link**: Reference to ADR, task specification, architectural document, or approved deviation

Example acceptable rationale:
> **Gate: Backup and restore runbook** — N/A for this Tier A package. Rationale: Package uses no database, authentication, object storage, or background jobs per ADR-0003. All data flows through stateless form submission to client-owned systems. No persistent state exists to back up. Risk: If delivery fails transiently, form resubmission required; no agency-side data loss risk given stateless design.

Example unacceptable rationale:
> Backup not needed because it's a simple site.

### Evidence Linking

Link evidence rather than duplicating content:

- **Tests**: `packages/website-modules/contact-form/src/contact-form.test.ts`
- **Runbooks**: `docs/runbooks/vercel-deployment-rollback.md`
- **ADRs**: `docs/decisions/ADR-0003-no-database-by-default.md`
- **Configuration validation**: `packages/contracts/src/validation.ts`
- **Deployment manifests**: `packages/deployment/src/index.ts` (DeploymentManifest definition)
- **Task specifications**: `docs/tasks/M1-task-index.md` (e.g., TSK-54 section) or Notion URL

Do not restate complete Product, Project, Feature, Milestone, or Task descriptions inline.

## Classification and Acceptance Record Template

Use this template to document classification, gate completion, and acceptance for each package.

```markdown
# Definition of Done: [Package Name]

## Package Identity

- **Package name**: `@melbourne-local-growth-ops/[name]`
- **Contract family**: [Website Module | Managed-Service Workflow | Connector]
- **Delivery profile**: [MANAGED_ISOLATED | CLIENT_HANDOFF] — exactly one delivery profile subsection must be completed
- **Notion task**: [Task ID and URL]
- **Repository task spec**: `docs/tasks/[task-file].md`

## Tier Classification

**Assigned tier**: [Tier A | Tier B | Tier C]

**Rationale**:
[Justify tier assignment based on infrastructure dependencies, state boundaries, and financial risk. Reference specific indicators from tier classification section.]

**Infrastructure dependencies**:
- [ ] Database: [Yes/No — if Yes, justify per purchased feature]
- [ ] Authentication: [Yes/No — if Yes, justify per purchased feature]
- [ ] Object storage: [Yes/No — if Yes, justify per purchased feature]
- [ ] Background jobs: [Yes/No — if Yes, justify per purchased feature]

## Universal Gates

### Product and Requirements
- [ ] Requirement traceability — [Evidence link]
- [ ] Acceptance criteria mapping — [Evidence link]
- [ ] Feature completeness — [Evidence link or known limitations]
- [ ] Contract family alignment — [Evidence link]
- [ ] Dependency-licence inventory — [Evidence link]

### User-Facing Product and UI Quality
- [ ] Professional content and presentation — [Evidence link or N/A with rationale]
- [ ] Responsive behavior — [Evidence link or N/A with rationale]
- [ ] Accessibility — [Evidence link or N/A with rationale]
- [ ] Conversion and contact journey — [Evidence link or N/A with rationale]
- [ ] Trust signals — [Evidence link or N/A with rationale]
- [ ] Failure and fallback states — [Evidence link or N/A with rationale]
- [ ] Design-sandwich evidence — [Evidence link or N/A with rationale]

### Code Quality
- [ ] Builds pass — `pnpm build` [date/commit]
- [ ] Type checking passes — `pnpm typecheck` [date/commit]
- [ ] Tests exist and pass — `pnpm test` [date/commit] — [test file references]
- [ ] Configuration validates — [Evidence link]

### Authority and Isolation
- [ ] Single-client deployment boundary — [Evidence link]
- [ ] Configuration isolation — [Evidence link]
- [ ] Capability independence preserved — [Evidence link]
- [ ] System-of-record authority respected — [Evidence link or N/A with rationale]

### Export and Handoff Portability

- [ ] **Hosted-vendor exit**: [Evidence: portable configuration/data format, transfer/migration/recreation path, exit cost/support consequences, credential/account ownership, operational responsibility, explicit interface or connector boundary per Profile-Independent Portability and Exit Gates section]
- [ ] **Final handoff artifact portability**: [Evidence: no private repository, registry, workspace link, credential, account, or agency-only runtime dependency; for managed packages, export pipeline transforms or vendors required reusable runtime source into portable artifact without publishing the private factory or transferring agency ownership of reusable background IP per Profile-Independent Portability and Exit Gates section]
- [ ] **Module/connector transferability markers**: [Evidence link]
- [ ] **No cross-client data in artifacts**: [Evidence: isolation tests]

**MANAGED_ISOLATED:**
- [ ] **Client-specific deployment**: [Evidence: isolated agency-managed Vercel project for this client only]
- [ ] **Agency operational ownership**: [Evidence: agency retains operational responsibility; client does not operate infrastructure]
- [ ] **Version and rollback**: [Evidence: deployment versions recorded in DeploymentManifest; rollback procedure documented]
- [ ] **Monitoring and support**: [Evidence: agency monitors and responds to incidents per contracted support terms]
- [ ] **Exit-readiness**: [Evidence: source and data export design documented]

**CLIENT_HANDOFF:**
- [ ] **Source repository transfer**: [Evidence: client-owned repository per docs/runbooks/client-source-handoff.md]
- [ ] **Infrastructure ownership transfer**: [Evidence: hosting, domain/DNS, analytics, email accounts transferred to client ownership or migrated/recreated in client-owned accounts]
- [ ] **Environment configuration**: [Evidence: environment variables documented; no agency credentials remain]
- [ ] **Transferable dependencies**: [Evidence: all dependencies are public npm packages; no private registries, workspace links, or agency-specific tooling]
- [ ] **Handoff verification**: [Evidence: pnpm verify:handoff passes in isolated environment]
- [ ] **Recovery runbooks transferred**: [Evidence: client receives handoff checklist, deployment manifest, SHA-256 digest, recovery procedures]
- [ ] **Agency background IP separated**: [Evidence: reusable factory IP remains private; only client-specific source and configuration transferred]
- [ ] **Client operational ownership**: [Evidence: client owns and operates infrastructure; agency support is optional paid service]

### Support Economics
- [ ] Setup effort estimate — [Time/cost estimate or link]
- [ ] Third-party and usage costs — [Cost breakdown or link]
- [ ] Expected support time — [Time estimate or link]
- [ ] Incident ownership — [Team/role]
- [ ] Included-support boundary — [Description or link]
- [ ] Minimum recurring margin — [Economic validation or link]
- [ ] Maximum per-client operational burden — [Threshold confirmation]
- [ ] No unfunded 24/7 or SLA promises — [Confirmation]

## Tier-Specific Gates

[Include applicable tier sections cumulatively: Universal gates always apply. Tier A packages include Tier A gates. Tier B packages include applicable Tier B gates. Tier C packages include applicable Tier B state/reconciliation gates and Tier C gates; Tier A's no-infrastructure confirmation does not apply. Follow same checklist-with-evidence format as universal gates.]

## Omitted and Substituted Gates

[For each N/A or substituted gate, provide:]

**Gate**: [Gate name]
**Status**: [N/A | Substituted]
**Rationale**: [Specific reason]
**Risk assessment**: [Consequences]
**Evidence**: [Link to ADR, task spec, or architectural decision]

## Acceptance

**Reviewed by**: [Name/role]
**Review date**: [Date]
**Approval status**: [Approved | Approved with conditions | Rejected]
**Conditions or follow-up**: [Any required follow-up work]

```

## Relationship to Other Governance

This Definition of Done is the first governance document (GOV-01 / TSK-125). It will be complemented by:

- Future testing strategy governance (separate task, not TSK-02)
- Future security baseline governance (separate task, not TSK-03)
- Future operational readiness governance (separate task, not TSK-04)

When those documents exist, this Definition of Done will reference them for detailed costing templates, security controls, and operational procedures rather than duplicating their content.

## Version

- **Document version**: 1.0
- **Effective date**: 2026-08-03
- **Applies to**: All post-M1 package development and later work
- **M1 baseline**: M1 is accepted baseline evidence and is not being reopened or rebuilt
- **Supersedes**: None (initial version)
