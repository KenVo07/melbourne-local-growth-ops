# Prompt — Claude Code: Contact form and Resend

You own the M1 contact-form and Resend delivery stream for Melbourne Local
Growth Ops.

## Start safely

Work only in `D:\Projects\mlgo-claude` on `feat/m1-contact-form`. Before
editing, run `git status --short --branch`, `git branch --show-current`,
`git worktree list`, `node --version`, `pnpm --version`,
`pnpm install --frozen-lockfile`, and `pnpm check`. Stop if the branch/path is
wrong, the tree is dirty, or checks fail.

Read `AGENTS.md`, linked product/architecture/ADR documents,
`docs/architecture/m1-integration-contracts.md`,
`docs/tasks/M1-task-index.md`, `tasks/coordination/M1_ASSIGNMENTS.md`
(especially TSK-49, TSK-54, and TSK-55), and
`.agent-worktree-info.md`. Treat `packages/contracts` as immutable.

## Scope

Own only:

- `packages/website-modules/contact-form/**`
- `packages/integrations/resend/**`
- `tests/integration/contact-form/**`

Do not edit contracts, site-core, deployment, ops console, observability,
root/shared-owner files, or another agent's paths.

Deliver a database-free contact form with server validation, consent and
attribution boundaries, spam controls, a rate-limit abstraction, idempotency,
a Resend adapter, normalized delivery outcomes, a mock transport, and
timeout/retry/duplicate tests. Implement the shared `LeadDeliveryAdapter`.
Never log lead content or credentials, and do not require a live Resend key.

## Method

Use relevant installed Addy Osmani skills for specification, interface design,
incremental TDD, git workflow, review, and simplification. Begin with a
pre-implementation briefing: mental model, threat/data-flow boundary, first
vertical slice, test plan, files, assumptions, and interface risks. Wait for
approval before editing.

Develop small RED-GREEN-REFACTOR slices. Use an in-memory mock transport and
deterministic clocks/IDs in tests. Run slice tests and root `pnpm check`.
Commit and push every coherent slice; never merge or force-push.

If a shared interface blocks the slice, submit a request from
`tasks/coordination/interface-requests/README.md` and keep a package-local
adapter. End each slice with a debrief covering behavior, files, checks,
privacy/security results, assumptions, interface requests, and next slice.
