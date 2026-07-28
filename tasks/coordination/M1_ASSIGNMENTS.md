# M1 parallel assignments

## Shared baseline

- Base branch: `origin/integration/m1`
- Verification: `pnpm install --frozen-lockfile && pnpm check`
- Shared contract: `docs/architecture/m1-integration-contracts.md`
- Feature agents commit and push small vertical slices. They do not merge.
- Root workspace files, root TypeScript settings, `AGENTS.md`,
  `packages/contracts/**`, shared architecture docs, this assignment file, and
  the final integrated `pnpm-lock.yaml` are owned by the
  foundation/integration owner.
- A feature agent may commit `pnpm-lock.yaml` when its owned package adds a
  dependency. The integration owner resolves or regenerates it without
  removing dependencies from other branches.
- Required commit style: focused conventional commits with tests in the same
  slice. No force-push, history rewrite, direct `main` commit, or direct merge.

## Codex A — Website Factory core

- Branch: `feat/m1-site-core`
- Worktree: `D:\Projects\mlgo-codex-a`
- Prompt: `tasks/coordination/prompts/CODEX_A_SITE_CORE.md`
- Owned paths:
  - `apps/managed-web/**`
  - `packages/site-core/**`
  - `packages/templates/**`
  - `packages/asset-pipeline/**`
  - `tests/integration/site-core/**`
- Forbidden paths:
  - `packages/contracts/**`
  - `packages/deployment/**`
  - `packages/website-modules/contact-form/**`
  - `packages/integrations/resend/**`
  - `apps/ops-console/**`
  - `packages/observability/**`
  - all shared-owner files listed above
- Tasks: configuration loader, template and module registries,
  rendering/composition core, managed-web shell, portable asset path, and
  configuration-isolation tests.
- Acceptance:
  - only validated TSK-45 configuration reaches composition;
  - template/module registration is deterministic and versioned;
  - two client fixtures cannot import or expose each other's configuration;
  - the standard asset path is portable and needs no object storage;
  - managed-web builds without a shared public runtime or database.
- Slice verification: root `pnpm check` plus
  `pnpm --filter @melbourne-local-growth-ops/site-core test` and
  `pnpm --filter @melbourne-local-growth-ops/managed-web build` when present.

## Codex B — Deployment and client handoff

- Branch: `feat/m1-deployment-handoff`
- Worktree: `D:\Projects\mlgo-codex-b`
- Prompt: `tasks/coordination/prompts/CODEX_B_DEPLOYMENT_HANDOFF.md`
- Owned paths:
  - `packages/deployment/**`
  - `scripts/deployment/**`
  - `scripts/handoff/**`
  - `docs/runbooks/**`
  - `tests/integration/deployment/**`
- Forbidden paths:
  - `packages/contracts/**`
  - `packages/site-core/**`
  - `packages/templates/**`
  - `packages/website-modules/**`
  - `apps/ops-console/**`
  - all shared-owner files listed above
- Tasks: isolated deployment generation, deployment manifest,
  Vercel-oriented boundary, domain setup documentation, source handoff export,
  portability checks, rollback runbook, and optional-data restore boundary.
- Acceptance:
  - a valid fixture produces isolated deployment intent with provenance;
  - domain and environment failures stop safely;
  - export verification rejects private agency dependencies and credentials;
  - rollback and optional restore steps are explicit and testable;
  - standard deployments require no database or optional restore.
- Slice verification: root `pnpm check` plus deployment integration and
  portability commands added by the slice.

## Claude Code — Contact form and Resend

- Branch: `feat/m1-contact-form`
- Worktree: `D:\Projects\mlgo-claude`
- Prompt: `tasks/coordination/prompts/CLAUDE_CONTACT_FORM.md`
- Owned paths:
  - `packages/website-modules/contact-form/**`
  - `packages/integrations/resend/**`
  - `tests/integration/contact-form/**`
- Forbidden paths:
  - `packages/contracts/**`
  - `packages/site-core/**`
  - `packages/deployment/**`
  - `apps/ops-console/**`
  - `packages/observability/**`
  - all shared-owner files listed above
- Tasks: database-free contact form, server validation, spam controls,
  rate-limit abstraction, idempotency, Resend adapter, normalized delivery
  outcomes, mock transport, and timeout/retry/duplicate tests.
- Acceptance:
  - invalid and spam submissions never reach the provider;
  - standard delivery is stateless and database-free;
  - duplicate submissions are safely classified by idempotency behavior;
  - timeouts and provider failures use the shared retry classification;
  - logs/tests never expose lead content or credentials.
- Slice verification: root `pnpm check` plus contact-form integration tests
  using the mock transport; no live Resend credential is required.

## Antigravity — Ops console and observability

- Branch: `feat/m1-ops-observability`
- Worktree: `D:\Projects\mlgo-antigravity`
- Prompt: `tasks/coordination/prompts/ANTIGRAVITY_OPS_OBSERVABILITY.md`
- Owned paths:
  - `apps/ops-console/**`
  - `packages/observability/**`
  - `tests/e2e/ops-console/**`
- Forbidden paths:
  - `packages/contracts/**`
  - `packages/site-core/**`
  - `packages/templates/**`
  - `packages/deployment/**`
  - `packages/website-modules/**`
  - `packages/integrations/resend/**`
  - all shared-owner files listed above
- Tasks: lightweight client/deployment registry, configuration/deployment
  version display, delivery/handoff status, client-owned analytics references,
  technical event inspection, deployment health, and browser E2E tests.
- Acceptance:
  - the console displays versions/status without becoming a site runtime;
  - records stay client-scoped and use only technical events;
  - no lead payload, credential, or commercial pricing appears in events;
  - analytics references remain client-owned;
  - browser tests cover health and isolation with fixture data.
- Slice verification: root `pnpm check` plus the package's browser E2E command.

## Interface requests and debriefs

When blocked by a shared seam, create a request from
`tasks/coordination/interface-requests/README.md`; do not edit the interface.
Every completed slice must include a short debrief in its commit or PR summary:
scope delivered, tests run, known limitations, interface requests, data or
secret implications, and the next safe slice.
