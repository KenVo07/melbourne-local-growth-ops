# ADR-0003: No database or stateful infrastructure by default

- Status: Accepted
- Decision date: 27 July 2026

## Context

Most initial brochure, lead-generation, booking-link, and external-system
websites do not need a database. Adding persistence, authentication, storage, or
jobs to every deployment would increase cost, security obligations, handoff
complexity, and operational burden without delivering purchased value.

## Decision

A standard website must operate without:

- A database
- Authentication
- Object storage
- Background jobs

Introduce infrastructure only when a purchased feature requires it:

- Supabase Postgres or equivalent for persistent application state
- Supabase Auth or equivalent for purchased login/dashboard features
- Supabase Storage or another object store for required file workflows
- A job system for required retries, schedules, or reconciliation

Optional infrastructure must remain isolated to the client deployment and must
be included in ownership and handoff records.

## Consequences

- Configuration schemas must validate a standard site with no database.
- Lead delivery should use the client’s system of record where possible.
- Minimal delivery evidence may be retained only when the purchased workflow
  requires it.
- Adding stateful infrastructure requires explicit feature and human approval.
- The absence of default infrastructure must not weaken validation, spam
  protection, rate limiting, idempotency, logging, or failure handling.

## Sources

- [Product current decision](https://app.notion.com/p/3a88d3550dc3810d9619c23fe8784140)
- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [M1 success criteria](https://app.notion.com/p/3a88d3550dc381839283d043270dada6)
- [TSK-44](https://app.notion.com/p/3a88d3550dc381efb3cfd94bc12cf2ac)
