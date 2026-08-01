# Architecture Request: Frontend Framework for M1 Apps

**Date:** 2026-07-28
**Requesting Stream:** Antigravity (M1 Ops Console & Observability)

## Context
The `apps/ops-console` needs to be scaffolded as a web application. Currently, there is no frontend framework defined or installed in the M1 foundation for apps. We want to ensure alignment across the repository, especially with `apps/managed-web`.

## Proposal
We request approval to adopt **Next.js + TypeScript** as the standard frontend framework for both:
- `apps/managed-web`
- `apps/ops-console`

## Rationale
- Next.js aligns with the typical product architecture for React applications.
- Standardizing on one framework prevents introducing Vite or a second UI toolchain into the monorepo.
- Ensures consistency across `apps/*` and allows sharing React UI patterns if needed in the future.

## Impact
- Root package/workspaces will need Next.js dependencies.
- `apps/ops-console` will be scaffolded as a Next.js app.
- `apps/managed-web` (Codex A) will also adopt Next.js.

## Requested Actions
- Please approve this direction.
- Merge the framework foundation changes into `integration/m1` so that feature agents can safely scaffold their apps.

## Approval
**Status:** Approved
**Date:** 2026-07-28
**Integration Owner:** M1 Coordinator
**Notes:** Approved Next.js + TypeScript as the shared frontend framework.
