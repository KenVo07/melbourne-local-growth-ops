# OSS adoption and abandonment register

## Purpose, authority, and evidence date

This register is a conservative technical decision aid for the software and
service portfolio seeded by the current Technical Build Plan and GOV-01
research. It does not approve a client-specific licence position and is not
professional legal advice.

The external-source observations in this document were verified on
2026-08-03. They are a dated snapshot, not a promise that a licence, vendor
term, security posture, release practice, export path, or support arrangement
will remain unchanged. Before any package or hosted service is adopted for a
client, re-verify the exact artifact, version or commit, included components,
licence files, dependency notices, vendor terms, data-processing terms,
security material, release history, and handoff path.

The architecture decisions remain authoritative:

- [ADR-0001: one product family with independent capabilities](../decisions/ADR-0001-product-family.md)
- [ADR-0002: isolated client website deployments](../decisions/ADR-0002-isolated-client-deployments.md)
- [ADR-0003: no database or stateful infrastructure by default](../decisions/ADR-0003-no-database-by-default.md)
- [Architecture boundaries](../architecture/boundaries.md)
- [Current architecture](../architecture/current-architecture.md)

In particular, this register does not authorize a shared public multi-tenant
website runtime, shared mutable customer business-data plane, universal
workflow platform, or shared approval queue. Client systems remain
authoritative unless replacement is explicitly contracted. A handoff must run
without private MLGO repositories, registries, credentials, or accounts.

## Status semantics

| Status | Meaning |
| --- | --- |
| **Approved** | The current Technical Build Plan accepts the stated narrow library use. It is not evidence that a package is already installed, and exact-version adoption still requires the package-specific checks below. |
| **Approved Pattern** | The architecture permits this optional implementation pattern when a purchased feature requires it. It does not approve a provider, account model, package, or shared service. |
| **Candidate/Gated** | The item remains in the seeded evaluation portfolio. It is not approved for production or a client proposal until every stated gate and required human approval is complete. |
| **Learn From** | The item may inform internal design research, but the current Technical Build Plan does not adopt its runtime. |
| **Deferred** | The item is not adopted by the current Technical Build Plan because there is no validated present requirement. Reconsideration requires new evidence and approval. |
| **Rejected** | The stated architecture or adoption mode conflicts with an accepted repository decision. The rejection is scoped to that mode, not an unrelated global ban. |

## Package-specific adoption and review record

An Approved or Approved Pattern entry is authority only for the adoption mode
written in that entry. Before first production use, and again when trigger
evidence changes, record a package-specific decision with:

1. selected package, artifact, version or commit, and integrity source;
2. every applicable licence and third-party notice, including component or
   directory boundaries and the obligations included in the delivered artifact;
3. exact self-hosted or hosted mode, account owner, data location, subprocessors,
   current terms, DPA needs, credentials, and client obligations;
4. exposed execution paths, untrusted inputs, known advisories, exploitability,
   compensating controls, recovery objectives, and support expectations;
5. isolated client resources, system of record, export test, excluded data or
   configuration, egress cost, handoff owner, and credential rotation steps;
6. upgrade test evidence, operating burden, migration class, trigger evidence,
   review date, reviewer, and decision.

Permissive licences still carry conditions such as preserving copyright and
licence notices; Apache-2.0 may also require modified-file and NOTICE handling.
Copyleft licences can impose source and distribution duties. A network or HTTP
boundary describes deployment topology only and is not a legal conclusion
about licence interaction. Hosted-service rights come from current service
terms, not from the licence on a related repository. Material copyleft,
source-available, dual-licence, marketplace, or hosted-service questions require
package-specific legal review.

Review timing is risk-proportionate and event-driven. Review at proposal,
selection, upgrade, changed deployment or distribution mode,
relicensing, material vendor-term or pricing change, a relevant advisory,
loss of maintainership, broken compatibility, or a failed export/handoff test.
Security response timing must be based on actual reachability, exposure,
exploitability, compensating controls, recovery options, and client or legal
obligations. No universal elapsed-time threshold decides abandonment.

## Approved on-demand libraries

### RJSF (react-jsonschema-form / @rjsf/core)

- **Licence and exact evidence:** The repository is Apache-2.0 under its
  [LICENSE](https://github.com/rjsf-team/react-jsonschema-form/blob/main/LICENSE.md).
  The grant is subject to the licence conditions; it does not establish rights
  to unrelated services, trademarks, or future versions.
- **Commercial and managed-service posture:** Eligible for package-specific
  commercial use after the selected artifact, transitive dependencies, licence
  copy, notices, and modification records are confirmed. No hosted service is
  approved by this entry.
- **Status and adoption mode:** **Approved** only for on-demand form rendering
  from trusted, validated JSON Schema in an isolated client website.
- **Enterprise/open-core boundary:** No enterprise component is asserted.
  Re-check the selected artifact rather than inferring that every package in
  the organization shares the root licence.
- **Maintenance and security:** Published activity is observable on the
  [release page](https://github.com/rjsf-team/react-jsonschema-form/releases);
  the repository also publishes a
  [security policy and advisory surface](https://github.com/rjsf-team/react-jsonschema-form/security).
  Neither is a support commitment.
- **Isolation and handoff:** Keep schemas and rendered state inside the client
  deployment. Pin the dependency, preserve notices, and test a clean handoff
  install without private MLGO access.
- **Upgrade/support burden:** Test schema compatibility, validation behavior,
  accessibility, rendering, and bundle impact for the selected release.
- **Triggers and review point:** Review before first use and on a package,
  schema-processing, React/runtime, licence, advisory, or maintenance change
  that affects the selected client path.
- **Migration class:** A client-local form-rendering implementation with the
  same validated schema and submission contract.
- **Decision evidence:** Adopted for WEB-01B on 2026-08-16 as exact npm package
  `pagefind@1.5.2` for the stated build-time mode. The pnpm lock records the npm
  integrity and exact optional platform binaries; the selected package and
  binaries are MIT-licensed. Local frozen install, notice generation, licence
  check, dependency audit, isolated custom-record indexing, disabled-output
  cleanup, browser search and standalone rebuild evidence passed. Re-run these
  gates on any version, licence, platform-binary or API change.

### Uppy (@uppy/core)

- **Licence and exact evidence:** The root
  [LICENSE](https://github.com/transloadit/uppy/blob/main/LICENSE) is MIT and
  requires preservation of its copyright and permission notice.
- **Commercial and managed-service posture:** Eligible for package-specific
  browser-library use subject to the exact package/dependency audit. The
  licence does not approve any companion hosted service.
- **Status and adoption mode:** **Approved** only for on-demand client-side
  file selection and upload UI connected to a separately approved,
  client-isolated upload destination.
- **Enterprise/open-core boundary:** This entry covers the selected open-source
  browser packages only; hosted processing and server companions are separate
  adoption decisions.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/transloadit/uppy/releases) and
  [security material](https://github.com/transloadit/uppy/security) for the
  selected artifact. Public activity does not imply contracted support.
- **Isolation and handoff:** Use client-scoped credentials or signed operations
  appropriate to the approved storage design; never expose privileged storage
  credentials in the browser. Include lockfile and notices in handoff.
- **Upgrade/support burden:** Validate file size/type controls, server-side
  validation, failure recovery, accessibility, and each selected plugin.
- **Triggers and review point:** Review when upload scope, plugins, destination,
  credential model, licence, advisories, browser support, or release health
  changes.
- **Migration class:** Native browser upload controls or another client-local
  uploader selected through a new package review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Approved for the stated mode; package-specific adopter, version, and date are
  pending.

### Pagefind

- **Licence and exact evidence:** The current repository
  [LICENSE](https://github.com/Pagefind/pagefind/blob/main/LICENSE) is MIT and
  requires retention of its copyright and permission notice.
- **Commercial and managed-service posture:** Eligible for package-specific
  commercial inclusion as a build tool subject to artifact and dependency
  review. No related hosted product is approved.
- **Status and adoption mode:** **Approved** for on-demand build-time indexing
  of public content and static client-side search in one isolated client site.
- **Enterprise/open-core boundary:** No enterprise component is asserted for
  the selected repository artifact.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/Pagefind/pagefind/releases) and
  [security material](https://github.com/Pagefind/pagefind/security) when
  selecting or upgrading the artifact.
- **Isolation and handoff:** Generate a separate index per client and exclude
  secrets, drafts, personal data, and private routes. Transfer generated assets,
  source configuration, lockfile, and notices.
- **Upgrade/support burden:** Test indexing completeness, search quality,
  accessibility, browser assets, and build/runtime compatibility.
- **Triggers and review point:** Review on licence or maintainer change,
  relevant parser/index advisory, incompatible build output, unacceptable
  client payload, or failure of the handoff build.
- **Migration class:** Another static search implementation or a client-local
  search implementation selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Approved for the stated mode; package-specific adopter, version, and date are
  pending.

### Babel parser (@babel/parser)

- **Licence and exact evidence:** `@babel/parser@8.0.4` declares MIT, as do its
  three transitive packages `@babel/types@8.0.4`,
  `@babel/helper-string-parser@8.0.0` and
  `@babel/helper-validator-identifier@8.0.4`. MIT requires retention of the
  copyright and permission notice. Verified against the installed pnpm graph on
  2026-08-17; `pnpm governance:licenses` re-checks the declared inventory.
- **Why it was selected:** the WEB-01B v2 trusted-source policy scanner needs a
  syntax-only TypeScript and TSX AST at generation time. The repository pins
  `typescript@7.0.2`, the native port, whose public JavaScript surface exposes
  **no standalone parser** — its `.` export is `lib/version.cjs`, and AST access
  requires spawning the TypeScript server and loading a configured Project
  through the explicitly `unstable/*` namespace. Founding a security control on
  an API with no compatibility guarantee was rejected. Pinning a second
  TypeScript major alongside 7 was also rejected as an invitation to typecheck
  against the wrong compiler.
- **Commercial and managed-service posture:** Build-time only. No hosted
  product or service relationship.
- **Status and adoption mode:** **Approved** as an exact-version build-time
  devDependency of `apps/managed-web`, used solely by
  `src/generation/client-experience-source-policy.ts` to parse authored client
  experience source for inspection. It must never be added to a generated client
  artifact's dependency graph, never appear in shipped client runtime code, and
  never be used to transform or emit code — parse only.
- **Enterprise/open-core boundary:** None. Single MIT package.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/babel/babel/releases) and
  [security policy](https://github.com/babel/babel/security) when upgrading.
  The scanner passes `errorRecovery: false`, so a file the parser cannot fully
  understand is refused rather than partially analysed.
- **Isolation and handoff:** The package is a Factory build tool. Handoff
  artifacts must not depend on it; an integration test asserts its absence from
  generated artifact dependency graphs and lockfiles.
- **Upgrade/support burden:** On upgrade, re-run the full source-policy
  red-team suite. AST node-shape changes across Babel majors are the expected
  breakage mode, and the suite is the regression gate.
- **Triggers and review point:** Review on licence change, a parser advisory,
  an AST shape change that weakens a policy rule, or if TypeScript later exposes
  a stable standalone parser — at which point migrating back to the vendor
  toolchain should be reconsidered.
- **Migration class:** Any syntax-only TS/TSX parser with an equivalent public
  AST, or a future stable TypeScript parser API, selected through a new review.
- **Decision evidence:** Adopted for WEB-01B v2 on 2026-08-17 by the
  implementation agent under founder direction, after the TypeScript 7 parser
  gap was demonstrated. Recorded here before first use.

### CookieConsent (vanilla-cookieconsent)

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/orestbida/cookieconsent/blob/master/LICENSE) is
  MIT and requires retention of its notice.
- **Commercial and managed-service posture:** Eligible for package-specific
  browser-library use. The licence and library do not establish compliance with
  GDPR, CCPA, the Australian Privacy Act, or any client-specific obligation.
- **Status and adoption mode:** **Approved** only as an on-demand consent UI and
  script-control implementation where the client's assessed requirements call
  for it.
- **Enterprise/open-core boundary:** No hosted compliance service or enterprise
  assurance is approved by this entry.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/orestbida/cookieconsent/releases) and
  [security material](https://github.com/orestbida/cookieconsent/security).
  Privacy and legal configuration remains a separate client review.
- **Isolation and handoff:** Keep configuration in the client deployment,
  document all controlled scripts and storage, and transfer source, lockfile,
  notices, and consent configuration.
- **Upgrade/support burden:** Re-test accessibility, default behavior,
  withdrawal/change flows, script blocking, analytics integration, and the
  client-approved privacy copy.
- **Triggers and review point:** Review on legal/configuration change, new
  tracking technology, library licence or security change, inaccessible UI, or
  failure to enforce the approved script behavior.
- **Migration class:** A client-local consent-control implementation selected
  after renewed privacy and technical review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Approved for the stated mode; package-specific adopter, version, and date are
  pending.

## Approved optional infrastructure patterns

### Isolated managed PostgreSQL / Supabase

- **Licence and exact evidence:** The Supabase monorepo carries an
  [Apache-2.0 LICENSE](https://github.com/supabase/supabase/blob/master/LICENSE).
  Supabase Cloud is governed separately by the current
  [Terms](https://supabase.com/terms); the repository licence does not grant
  cloud-service rights.
- **Commercial and managed-service posture:** **Approved Pattern**, not a
  provider approval. Use only when purchased state, authentication, or storage
  requires it and human approval is recorded under ADR-0003. Prefer a
  client-owned organization/account from inception; do not assume account
  transfer.
- **Adoption mode and open-core/hosted boundary:** One isolated client project
  or database. Self-hosted components and the managed platform are separate
  modes with separate obligations and operating burdens.
- **Maintenance and security:** Supabase publishes
  [release evidence](https://github.com/supabase/supabase/releases),
  [security material](https://supabase.com/security), and guidance on
  [database security and RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
  RLS is required where the selected exposure and authorization model calls for
  it, not as an unsupported universal rule for every table.
- **Isolation and handoff:** Never use a shared cross-client data plane. The
  official [backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
  supports database export, while the
  [clone documentation](https://supabase.com/docs/guides/platform/clone-project)
  identifies managed elements that need separate reconfiguration, including
  storage objects, functions, settings, keys, and some realtime configuration.
  Database portability is therefore not complete service portability.
- **Upgrade/support burden:** Own schema migrations, authorization tests,
  backups, restore drills, service limits, region, egress, extensions, keys,
  and every non-database export step.
- **Triggers and review point:** Review before each client activation and on
  terms, DPA, pricing, region, component licence, security, export, restore,
  service-limit, or account-ownership change.
- **Migration class:** Another isolated managed PostgreSQL provider or an
  isolated self-hosted PostgreSQL deployment, with separate migration plans for
  non-database services.
- **Decision evidence:** Current Technical Build Plan plus ADR-0003:
  Approved Pattern only; provider, package, owner, version, and date are
  pending per client.

### Client-isolated S3-compatible object storage

- **Licence and exact evidence:** S3 compatibility is an API compatibility
  pattern, illustrated by the official
  [S3 API reference](https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html);
  it is not an open-standard licence and does not confer provider rights.
- **Commercial and managed-service posture:** **Approved Pattern** only when a
  purchased file workflow requires object storage. Provider terms, billing,
  account ownership, credentials, regions, subprocessors, DPA, and service
  limits require a provider/package-specific review.
- **Adoption mode and enterprise/hosted boundary:** A dedicated client bucket
  or equivalent isolation boundary. API compatibility does not make provider
  control planes, identity models, extensions, or service behavior portable.
- **Maintenance and security:** Apply provider-specific controls; the S3
  reference provider publishes
  [security best practices](https://docs.aws.amazon.com/AmazonS3/latest/userguide/security-best-practices.html).
  Public access, encryption, signed access, retention, and logging decisions
  depend on the actual data and threat model.
- **Isolation and handoff:** Record the client-owned destination, least-
  privilege credentials, object inventory, metadata, versions, lifecycle
  rules, export tooling, integrity verification, egress cost, and credential
  rotation. Do not claim account transfer.
- **Upgrade/support burden:** Provider availability, SDK/API behavior, access
  policy, lifecycle rules, backup/versioning, observability, and cost remain
  operational responsibilities.
- **Triggers and review point:** Review on provider-term, price, region,
  credential, compatibility, security, export, data-classification, or client
  ownership change.
- **Migration class:** Another client-isolated object store with a tested
  object, metadata, policy, and credential migration.
- **Decision evidence:** Current Technical Build Plan plus ADR-0003:
  Approved Pattern only; provider and package-specific decision are pending.

### Graphile Worker

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/graphile/worker/blob/main/LICENSE.md) is MIT and
  requires retention of the licence notice.
- **Commercial and managed-service posture:** Eligible only as a
  package-specific self-hosted component. The licence does not approve paid
  presets, support, or any hosted service.
- **Status and adoption mode:** **Approved Pattern** for client-isolated,
  PostgreSQL-backed jobs only when a purchased workflow needs durable retries,
  schedules, or reconciliation and an isolated client database is already
  justified.
- **Enterprise/open-core boundary:** Review the exact packages and exclude any
  separately licensed commercial component unless separately approved.
- **Maintenance and security:** The repository's
  [release page](https://github.com/graphile/worker/releases) contained no
  GitHub releases when verified; inspect current tags/changelog, repository
  activity, selected package publication, and
  [security material](https://github.com/graphile/worker/security) at adoption.
- **Isolation and handoff:** Use only the client's database and worker runtime;
  bound job payloads and logs, keep secrets out of payloads, and transfer task
  code, migrations, operating configuration, and recovery procedures.
- **Upgrade/support burden:** Operate workers, concurrency, retries, dead jobs,
  schema migrations, database capacity, observability, and safe shutdown.
- **Triggers and review point:** Review on job-criticality, database/runtime,
  licence, package publication, maintenance, advisory, reliability, or handoff
  change.
- **Migration class:** Another independently deployed scheduler or job runner
  selected for the same client boundary.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence plus
  ADR-0003: Approved Pattern; exact package decision is pending.

### Hosted Trigger.dev

- **Licence and exact evidence:** Repository code is under its
  [Apache-2.0 LICENSE](https://github.com/triggerdotdev/trigger.dev/blob/main/LICENSE).
  The hosted service is governed by the current
  [Terms](https://trigger.dev/legal/), not by that repository licence.
- **Commercial and managed-service posture:** **Approved Pattern** only when a
  contracted durable workflow justifies hosted infrastructure and current
  economics, client obligations, terms, and data handling are approved.
- **Adoption mode and enterprise/hosted boundary:** Hosted and self-hosted modes
  are distinct decisions. Hosted terms address service access, customer data,
  service changes, termination, and liability; they require package-specific
  review alongside the [DPA](https://trigger.dev/legal/dpa) and
  [security page](https://trigger.dev/security).
- **Maintenance and security:** Inspect repository
  [releases](https://github.com/triggerdotdev/trigger.dev/releases), hosted
  status/security evidence, dependency advisories, and the selected workflow's
  data exposure. Do not infer a support level beyond the current signed terms.
- **Isolation and handoff:** Use a client-owned account where feasible and
  client-specific project, keys, environments, and logs. The current Terms say
  the customer may not assign or transfer the agreement or its rights or
  obligations without Trigger.dev's prior written consent. Source export does
  not transfer the hosted account, run history, configuration, or contractual
  position. Record and test each export/rebuild step.
- **Upgrade/support burden:** Own SDK upgrades, workflow compatibility,
  idempotency, cost controls, failure recovery, data minimization, and an exit
  path. Hosted operations do not remove application support work.
- **Triggers and review point:** Review before contract binding and on terms,
  DPA/subprocessor, price, limits, account ownership, security, outage,
  export/rebuild, SDK, or self-host boundary change.
- **Migration class:** A separately deployed scheduler/job runner or another
  hosted workflow service selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Approved Pattern only; the hosted vendor package and client terms remain
  pending.

## Candidate engines with adoption gates

### Payload CMS

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/payloadcms/payload/blob/main/LICENSE.md) is MIT
  and requires retention of its notice.
- **Commercial and managed-service posture:** Licence eligibility does not
  approve a production package, hosting service, database, authentication
  model, plugins, or support arrangement.
- **Status and adoption mode:** **Candidate/Gated** for an isolated,
  client-contracted CMS only. Gates: explicit CMS scope and human approval;
  exact-version compatibility and performance tests; isolated state/auth
  design; security review; and a tested handoff.
- **Enterprise/open-core boundary:** Audit the selected core packages, plugins,
  adapters, and any cloud or paid offering separately.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/payloadcms/payload/releases) and
  [security policy](https://github.com/payloadcms/payload/blob/main/SECURITY.md).
- **Isolation and handoff:** One client application and data boundary. Export
  source, schema, content, media, users where contracted, configuration, keys,
  adapters, notices, and restore steps; verify them against the selected
  database and storage modes.
- **Upgrade/support burden:** CMS schema, admin/auth, database, media, plugin,
  framework, migration, backup, and editor support.
- **Triggers and review point:** Review before proposal and on licence,
  framework/database, plugin, advisory, export, release-health, or operating-
  cost change.
- **Migration class:** Static content files or another client-isolated CMS
  selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future package decision owner and date are pending.

### Chatwoot

- **Licence and exact evidence:** The root
  [LICENSE](https://github.com/chatwoot/chatwoot/blob/develop/LICENSE) applies
  MIT to content outside stated exceptions and directs content under
  enterprise/ to a separate
  [enterprise licence](https://github.com/chatwoot/chatwoot/blob/develop/enterprise/LICENSE).
- **Commercial and managed-service posture:** Any candidate package must map
  every included directory and dependency to its licence. Root MIT-covered code
  does not grant rights to enterprise/ or to a hosted Chatwoot service.
- **Status and adoption mode:** **Candidate/Gated** for a dedicated,
  client-contracted messaging system. Enterprise code is excluded unless
  separately approved under applicable commercial terms.
- **Enterprise/open-core boundary:** The repository itself documents the
  boundary; build and deployment evidence must prove which side is included.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/chatwoot/chatwoot/releases) and
  [security policy](https://github.com/chatwoot/chatwoot/blob/develop/SECURITY.md).
- **Isolation and handoff:** Require a dedicated client instance and data
  boundary unless another explicitly approved isolation design exists. Verify
  actual export/restore coverage for conversations, attachments, integrations,
  identities, settings, credentials, and enterprise entitlements; do not assume
  account transfer.
- **Upgrade/support burden:** Application, database, cache/queue, storage,
  messaging channels, integrations, backups, migrations, and security updates.
- **Triggers and review point:** Review before proposal and on licence-directory,
  enterprise-term, dependency, advisory, channel API, export, maintenance, or
  operating-cost change.
- **Migration class:** A client-authoritative messaging connector or another
  isolated messaging service selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future package decision owner and date are pending.

### Cal.com / Cal.diy

- **Licence and exact evidence:** The public Cal.diy repository currently has
  an [MIT LICENSE](https://github.com/calcom/cal.diy/blob/main/LICENSE).
  Cal.com's official
  [licensing-transition article](https://cal.com/blog/cal-diy-open-source-to-closed-source)
  says the production Cal.com codebase moved private and describes Cal.diy as
  a separate community version with commercial/enterprise features removed.
- **Commercial and managed-service posture:** The current
  [Cal.diy README](https://github.com/calcom/cal.diy) warns that Cal.diy is
  intended for personal, non-production use and directs commercial and
  enterprise-ready scheduling use to Cal.com. The MIT text does not resolve
  that operational warning or approve Cal.com's hosted/on-prem terms.
- **Status and adoption mode:** **Candidate/Gated**, but not eligible for a
  commercial production proposal while that upstream warning remains
  unresolved. A future decision must separately evaluate the exact Cal.diy
  artifact and the commercial Cal.com offering.
- **Enterprise/open-core boundary:** Do not combine historical public code,
  current Cal.diy, private Cal.com code, or commercial features into one licence
  conclusion. Exact artifact provenance is mandatory.
- **Maintenance and security:** Inspect Cal.diy
  [releases](https://github.com/calcom/cal.diy/releases), repository warning,
  and [security material](https://github.com/calcom/cal.diy/security); activity
  does not override the production-use warning.
- **Isolation and handoff:** If the gate is ever cleared, require a dedicated
  client application/data boundary and verify export of bookings, users,
  integrations, settings, credentials, and operational history. Do not infer
  hosted account transfer.
- **Upgrade/support burden:** Scheduling integrations, calendar credentials,
  database, email, jobs, auth, availability logic, migrations, and incident
  response make this a high-burden engine.
- **Triggers and review point:** Review on warning, licence, repository/product
  boundary, commercial terms, maintainership, advisory, integration, export,
  or handoff change.
- **Migration class:** A client-authoritative booking connector or another
  isolated scheduling engine selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated with the current production-use gate unresolved; future
  decision owner and date are pending.

### Easy!Appointments

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/alextselegidis/easyappointments/blob/master/LICENSE)
  is GPL-3.0.
- **Commercial and managed-service posture:** Commercial use is not treated as
  an unqualified right. Exact distribution, modification, source, notice, and
  managed-service facts require package-specific legal review.
- **Status and adoption mode:** **Candidate/Gated** only as a separately
  deployed, client-isolated booking application after contracted scope,
  infrastructure approval, security review, and legal review.
- **Enterprise/open-core boundary:** No enterprise component is asserted; all
  included code and dependencies still require exact mapping.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/alextselegidis/easyappointments/releases) and
  [security material](https://github.com/alextselegidis/easyappointments/security).
- **Isolation and handoff:** A separate application boundary may support MLGO
  isolation and portability, but no conclusion is made that HTTP communication
  changes GPL obligations. Verify source delivery, notices, database export,
  attachments, configuration, integrations, credentials, and restore.
- **Upgrade/support burden:** PHP application/runtime, database, mail,
  integrations, backups, upgrades, and security patching.
- **Triggers and review point:** Review before proposal and on licence,
  distribution/deployment, legal, runtime, advisory, maintainership, export, or
  client-system-of-record change.
- **Migration class:** A client-authoritative booking connector or another
  isolated scheduling engine selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future package decision owner and date are pending.

### TastyIgniter

- **Licence and exact evidence:** TastyIgniter publishes the core software under
  MIT on its official [software licence page](https://tastyigniter.com/license).
  Marketplace items are governed separately by the
  [marketplace licence](https://tastyigniter.com/licenses/marketplace), related
  terms, and item/vendor terms.
- **Commercial and managed-service posture:** Core eligibility does not approve
  marketplace items. The official marketplace material and
  [licensing FAQ](https://tastyigniter.com/licenses/faq) contain materially
  different transfer wording; do not claim marketplace licence or account
  transfer. Resolve the selected item's rights and handoff position with the
  vendor, in writing where necessary, before adoption.
- **Status and adoption mode:** **Candidate/Gated** for an isolated,
  restaurant-contracted ordering/management application. Core-only scope,
  seller/ecommerce approval, stateful infrastructure, and every selected
  marketplace item must pass separate gates.
- **Enterprise/open-core boundary:** MIT core and marketplace extensions/themes
  are separate licensing surfaces.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/tastyigniter/TastyIgniter/releases) and
  [security policy](https://github.com/tastyigniter/TastyIgniter/security).
- **Isolation and handoff:** Verify core source, database/content export,
  media, orders, customer data, configuration, credentials, extension source,
  update access, and every marketplace entitlement. No account-transfer
  assumption is permitted.
- **Upgrade/support burden:** Restaurant operations, database, payments and
  seller boundaries, extensions, framework/runtime, backups, upgrades, and
  security.
- **Triggers and review point:** Review on core licence, marketplace or item
  terms, transfer wording, pricing, seller scope, advisory, extension
  compatibility, export, or maintenance change.
- **Migration class:** An external commerce authority or another isolated
  restaurant engine selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future package decision owner and date are pending.

### Umami

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/umami-software/umami/blob/master/LICENSE) is MIT
  and requires retention of its notice.
- **Commercial and managed-service posture:** Licence eligibility covers the
  selected repository artifact only; hosted service terms and third-party
  integrations are separate.
- **Status and adoption mode:** **Candidate/Gated** for an isolated,
  client-contracted self-hosted analytics instance where the current
  client-owned analytics default is unsuitable.
- **Enterprise/open-core boundary:** Audit self-hosted code, plugins, and any
  hosted offering separately.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/umami-software/umami/releases) and
  [security material](https://github.com/umami-software/umami/security).
- **Isolation and handoff:** Use a dedicated client instance/data boundary.
  Verify event/database export, identity/access configuration, scripts,
  consent implications, credentials, source, notices, and restore procedures.
- **Upgrade/support burden:** Analytics privacy, database growth, retention,
  backups, migrations, runtime, dashboards, and tracker compatibility.
- **Triggers and review point:** Review on analytics/privacy requirements,
  licence, advisory, database/runtime, tracker behavior, export, release health,
  or operating cost.
- **Migration class:** The current client-owned analytics default or another
  client-owned analytics system selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future package decision owner and date are pending.

### Meilisearch

- **Licence and exact evidence:** The root
  [LICENSE](https://github.com/meilisearch/meilisearch/blob/main/LICENSE)
  states that some parts are BUSL-1.1 under
  [LICENSE-EE](https://github.com/meilisearch/meilisearch/blob/main/LICENSE-EE)
  and other parts are MIT under
  [LICENSE-MIT](https://github.com/meilisearch/meilisearch/blob/main/LICENSE-MIT).
- **Commercial and managed-service posture:** Never classify the whole project
  as MIT. Before adoption, map the exact version, binary, source paths, build
  features, dependencies, and deployment mode to the applicable licence and
  obtain legal review for the BUSL/source-available boundary.
- **Status and adoption mode:** **Candidate/Gated** only for an isolated
  client search service when static Pagefind cannot satisfy a contracted
  requirement and the exact licensed artifact is approved.
- **Enterprise/open-core boundary:** BUSL-licensed and MIT-licensed components
  must remain explicitly identified; no enterprise feature is approved by
  inference.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/meilisearch/meilisearch/releases) and
  [security material](https://github.com/meilisearch/meilisearch/security).
- **Isolation and handoff:** Use a dedicated process/index and client-scoped
  keys. Verify source/binary rights, index source-of-truth, dump/export,
  settings, synonyms, credentials, operational configuration, and rebuild.
- **Upgrade/support burden:** Persistent runtime, indexing/reconciliation,
  memory/capacity, backups, key management, versioned dumps, and upgrades.
- **Triggers and review point:** Review on component mapping, licence/change
  date, feature use, artifact packaging, advisory, dump compatibility,
  maintenance, resource cost, or handoff change.
- **Migration class:** Pagefind where requirements permit or another isolated
  search engine selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future artifact-specific decision owner and date are pending.

### Medusa

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/medusajs/medusa/blob/develop/LICENSE) is MIT and
  requires retention of its notice.
- **Commercial and managed-service posture:** Licence eligibility does not
  approve a seller/ecommerce expansion, hosted cloud, plugins, payment
  providers, or a production architecture.
- **Status and adoption mode:** **Candidate/Gated** only for a separately
  approved client ecommerce scope, isolated stateful backend, explicit external
  payment boundary, security design, and tested handoff.
- **Enterprise/open-core boundary:** Audit core packages, plugins, integrations,
  and any managed offering separately.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/medusajs/medusa/releases) and
  [security material](https://github.com/medusajs/medusa/security).
- **Isolation and handoff:** One client application/data boundary. Verify export
  of catalog, customers, orders, inventory, integrations, files, configuration,
  credentials, source, notices, and restore/reconciliation behavior.
- **Upgrade/support burden:** Ecommerce system-of-record rules, state,
  payments, webhooks, jobs, inventory/order reconciliation, backups,
  migrations, tax/shipping integrations, and security.
- **Triggers and review point:** Review on seller scope, licence, plugin or
  payment terms, advisory, breaking release, data model, export, reconciliation,
  maintenance, or operating cost.
- **Migration class:** An external commerce authority or another isolated
  ecommerce engine selected through a new review.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Candidate/Gated; future package decision owner and date are pending.

## Learn-from evidence

### Appsmith

- **Licence and exact evidence:** The official
  [Apache-2.0 LICENSE](https://github.com/appsmithorg/appsmith/blob/release/LICENSE)
  applies to the repository artifact, subject to its conditions.
- **Commercial/open-core posture:** No deployment, managed-service right, or
  enterprise feature is approved. Exact edition and hosted terms would require
  a new review.
- **Status and adoption mode:** **Learn From** for internal-tool UI and
  integration patterns. The current Technical Build Plan does not adopt an
  Appsmith runtime because it calls for focused internal tooling and no
  universal workflow/approval platform.
- **Maintenance and security:** Upstream
  [releases](https://github.com/appsmithorg/appsmith/releases) and
  [security material](https://github.com/appsmithorg/appsmith/security) remain
  dated research inputs, not an operational support commitment.
- **Isolation, export, and handoff:** No client runtime or data is authorized.
  If reconsidered, account/data export, plugins, credentials, editions,
  isolation, and handoff require fresh evidence.
- **Upgrade/support burden:** A self-hosted low-code platform adds application,
  data, authentication, integration, upgrade, and security operations.
- **Triggers and review point:** Revisit only for a validated internal-tool
  requirement and after architecture, licence/edition, security, export, and
  cost review.
- **Migration class:** Focused internal components or scripts within the
  approved architecture.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Learn From; no package-specific adoption decision exists.

### Temporal

- **Licence and exact evidence:** The server repository
  [LICENSE](https://github.com/temporalio/temporal/blob/main/LICENSE) is MIT and
  requires retention of its notice.
- **Commercial/open-core posture:** The repository licence does not approve a
  hosted service, support plan, SDK set, or deployment architecture.
- **Status and adoption mode:** **Learn From** for durable-execution concepts.
  The current Technical Build Plan does not adopt a Temporal runtime or
  universal workflow platform for website delivery.
- **Maintenance and security:** Upstream
  [releases](https://github.com/temporalio/temporal/releases) and
  [security material](https://github.com/temporalio/temporal/security) are
  research evidence only.
- **Isolation, export, and handoff:** No client runtime or shared service is
  authorized. Any reconsideration must define isolated ownership, persistence,
  workers, histories, namespaces, credentials, export/replay, and handoff.
- **Upgrade/support burden:** Server cluster, persistence, workers, SDK
  compatibility, observability, backups, upgrades, and incident response.
- **Triggers and review point:** Revisit only if a contracted workflow cannot
  be met by an approved lighter pattern and a new architecture decision
  authorizes the burden.
- **Migration class:** An approved client-isolated scheduler/job pattern.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Learn From; no package-specific adoption decision exists.

## Deferred portfolio

### Activepieces

- **Licence and exact evidence:** The root
  [LICENSE](https://github.com/activepieces/activepieces/blob/main/LICENSE)
  covers the MIT Community Edition, while
  [packages/ee/LICENSE](https://github.com/activepieces/activepieces/blob/main/packages/ee/LICENSE)
  sets a separate commercial boundary for enterprise code.
- **Commercial/open-core posture:** Root/community rights do not extend to
  enterprise code or hosted services. Exact packages and directories require
  mapping before any future use.
- **Status and adoption mode:** **Deferred**. The current Technical Build Plan
  does not adopt a general workflow automation engine without validated,
  contracted demand.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/activepieces/activepieces/releases) and
  [security material](https://github.com/activepieces/activepieces/security) if
  reconsidered.
- **Isolation, export, and handoff:** No shared approval queue or client runtime
  is authorized. Future evaluation must prove client isolation and export of
  flows, connections, secrets, run history, data, edition entitlements, and
  operating configuration.
- **Upgrade/support burden:** Application, state, queues/workers, secrets,
  connectors, auth, upgrades, backups, and security operations.
- **Triggers and review point:** Revisit only on contracted workflow evidence;
  then review licence directories, enterprise/hosted terms, security, export,
  isolation, maintenance, and cost.
- **Migration class:** Direct client-system connectors or an approved isolated
  job pattern.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Deferred; no package-specific adoption decision exists.

### Dittofeed

- **Licence and exact evidence:** The repository
  [LICENSE](https://github.com/dittofeed/dittofeed/blob/main/LICENSE) is MIT and
  requires retention of its notice.
- **Commercial/open-core posture:** The repository licence does not approve a
  hosted service, integrations, communication-provider terms, or a client
  marketing system.
- **Status and adoption mode:** **Deferred**. The current Technical Build Plan
  does not speculatively deploy a customer-engagement engine before a validated
  managed-service workflow and contract exist.
- **Maintenance and security:** Inspect upstream
  [releases](https://github.com/dittofeed/dittofeed/releases) and
  [security material](https://github.com/dittofeed/dittofeed/security) if
  reconsidered.
- **Isolation, export, and handoff:** No client or shared runtime is authorized.
  A future review must cover profiles/events, audiences, templates, message
  history, integrations, consent/suppression state, credentials, export,
  isolation, and system-of-record rules.
- **Upgrade/support burden:** Stateful engagement data, jobs, messaging
  integrations, consent, deliverability, backups, migrations, and security.
- **Triggers and review point:** Revisit only on validated demand; then review
  licence, communication terms, privacy, security, export, isolation,
  maintenance, and cost.
- **Migration class:** Client-authoritative engagement tooling or direct
  capability-specific connectors.
- **Decision evidence:** Current Technical Build Plan/GOV-01 evidence:
  Deferred; no package-specific adoption decision exists.

## Rejected architecture

### Shared Supabase approval queue

- **Licence and commercial posture:** The Supabase evidence in the approved
  isolated pattern above does not make this architecture acceptable. Licence
  eligibility and cloud terms cannot override repository architecture.
- **Status and adoption mode:** **Rejected** specifically as a central,
  agency-managed, cross-client approval queue or mutable customer business-data
  plane.
- **Reason and evidence:** It conflicts with ADR-0001 capability independence,
  ADR-0002 client deployment isolation, the prohibition on a shared public
  multi-tenant runtime, and the current plan's manual-first managed services.
- **Enterprise/open-core, maintenance, and security:** These facts cannot cure
  the boundary violation and therefore do not promote the proposal.
- **Isolation, export, and handoff:** A shared queue would couple client data,
  credentials, failure, cancellation, and handoff boundaries. It is not an
  approved system of record.
- **Upgrade/support burden:** Central tenancy, authorization, approvals,
  auditing, reconciliation, retention, and incident response are outside the
  approved architecture.
- **Triggers and review point:** Reconsideration requires explicit human
  approval to change the binding architecture; ordinary package review is
  insufficient.
- **Migration class:** Direct integration with the client's authoritative
  system, manual-first capability workflow, or isolated client state when a
  purchased feature justifies it.
- **Decision evidence:** Current Technical Build Plan and accepted ADRs:
  Rejected for the stated shared-queue mode. This is not a global Supabase ban;
  the isolated optional pattern remains available under its gates.

## Seeded portfolio and current status

| Seeded candidate or pattern | Current status | Exact disposition |
| --- | --- | --- |
| RJSF (@rjsf/core) | Approved | On-demand trusted-schema form rendering in one client site |
| Uppy (@uppy/core) | Approved | On-demand browser upload UI to separately approved client storage |
| Pagefind | Approved | Build-time public-content index and static client search |
| CookieConsent | Approved | Consent UI/script control only; no compliance conclusion |
| Isolated managed PostgreSQL / Supabase | Approved Pattern | Optional client-isolated state/auth/storage when contracted and approved |
| Client-isolated S3-compatible storage | Approved Pattern | Optional provider-specific object storage when contracted and approved |
| Graphile Worker | Approved Pattern | Optional client-isolated PostgreSQL-backed jobs |
| Hosted Trigger.dev | Approved Pattern | Optional separately reviewed hosted durable workflows |
| Payload CMS | Candidate/Gated | Isolated contracted CMS evaluation |
| Chatwoot | Candidate/Gated | Isolated messaging evaluation; enterprise directory excluded |
| Cal.com / Cal.diy | Candidate/Gated | Production proposal blocked while Cal.diy warning is unresolved |
| Easy!Appointments | Candidate/Gated | Isolated booking engine with GPL/legal gate |
| TastyIgniter | Candidate/Gated | Isolated restaurant engine; core and marketplace reviewed separately |
| Umami | Candidate/Gated | Isolated self-hosted analytics evaluation |
| Meilisearch | Candidate/Gated | Exact artifact/component licence mapping required |
| Medusa | Candidate/Gated | Separately approved isolated ecommerce scope only |
| Appsmith | Learn From | Internal-tool research; runtime not adopted |
| Temporal | Learn From | Durable-execution research; runtime not adopted |
| Activepieces | Deferred | No speculative workflow platform |
| Dittofeed | Deferred | No speculative engagement platform |
| Shared Supabase approval queue | Rejected | Cross-client shared mutable queue violates isolation |
