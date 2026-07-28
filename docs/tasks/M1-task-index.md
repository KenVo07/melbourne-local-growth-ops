# M1 authoritative task index

This is a repository-facing summary of the authoritative Notion M1 milestone,
Technical Build Plan, and TSK-49 through TSK-56 read during foundation setup.
It preserves their acceptance intent so worktrees do not need to scan Notion.
If this summary conflicts with the named Notion record, stop and request human
resolution; do not silently change M0 architecture.

## M1 milestone

The private reusable core must generate and deploy isolated client websites in
managed and handoff modes. Configuration, domains, portable assets, lead forms,
client-owned analytics, technical logging, versions, rollback, and handoff must
be tested. Standard websites require no database.

## Tasks

### TSK-49 — Website Factory monorepo and CI quality gates

The private repository contains site/template composition, shared UI,
templates, modules, integrations, contracts, and deployment tooling. Pull
requests pass the selected lint gate, type checking, unit/integration tests,
and production build. No linter was selected in M0; foundation does not invent
one, and a later explicit tool decision must close that part of the gate.

### TSK-50 — Isolated deployment generator and domain setup

A valid configuration produces a separate Vercel project and preview.
Custom-domain ownership, environment configuration, failure handling, and
rollback are documented. Invalid configuration or provider failure stops
safely.

### TSK-51 — Configuration isolation and deployment boundary

Each deployment receives only its own configuration, analytics reference, and
runtime resources. Tests prevent cross-client imports. Optional database
infrastructure is client-specific and absent by default.

### TSK-52 — Lightweight client configuration/deployment registry

An operator can create a client record, select template/modules, edit validated
configuration, record ownership and versions, preview, and trigger deployment
without editing shared components. The registry is operational tooling, not a
shared public website runtime.

### TSK-53 — Portable asset pipeline

Assets live in the repository/deployment by default, are validated and
optimized, and remain included in handoff. External storage is optional only
when a purchased feature requires it.

### TSK-54 — Portable lead form and notification delivery

The form performs server-side validation, spam/rate controls, consent and
attribution handling, deduplication/idempotency, and Resend or webhook delivery.
Logs contain no sensitive form content. Standard delivery needs no database.

### TSK-55 — Analytics, monitoring, and deployment audit

Analytics uses client-owned GA4. Attribution excludes form content. Technical
logs and optional Sentry provide safe client/deployment attribution, and
configuration/application/deployment versions are recorded.

### TSK-56 — Rollback, source handoff, and optional restore runbook

Rollback and client source handoff are documented and tested. A handed-off site
does not depend on the private factory. Optional restore procedures exist only
where optional data infrastructure was purchased and used; ownership boundaries
are explicit.
