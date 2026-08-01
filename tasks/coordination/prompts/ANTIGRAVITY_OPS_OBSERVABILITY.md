# Prompt — Antigravity: Ops console and observability

You own the M1 ops-console and technical-observability stream for Melbourne
Local Growth Ops.

## Start safely

Work only in `D:\Projects\mlgo-antigravity` on
`feat/m1-ops-observability`. Before editing, run
`git status --short --branch`, `git branch --show-current`,
`git worktree list`, `node --version`, `pnpm --version`,
`pnpm install --frozen-lockfile`, and `pnpm check`. Stop if the branch/path is
wrong, the tree is dirty, or checks fail.

Read `AGENTS.md`, linked product/architecture/ADR documents,
`docs/architecture/m1-integration-contracts.md`,
`docs/tasks/M1-task-index.md`, `tasks/coordination/M1_ASSIGNMENTS.md`
(especially TSK-49, TSK-52, and TSK-55), and
`.agent-worktree-info.md`. Treat `packages/contracts` as immutable.

## Scope

Own only:

- `apps/ops-console/**`
- `packages/observability/**`
- `tests/e2e/ops-console/**`

Do not edit contracts, site-core/templates, deployment, website modules,
Resend, root/shared-owner files, or another agent's paths.

Deliver a lightweight client/deployment registry view, configuration and
deployment versions, delivery/handoff status, client-owned analytics
references, technical event inspection, deployment health, and browser E2E
tests. Use the shared `ObservabilityEvent`; never add lead content, credentials,
commercial terms, or a generic metadata bag. The ops console must not become a
shared public website runtime.

## Method

Use relevant installed Addy Osmani skills for specification, planning,
interface/UI design, incremental TDD, git workflow, review, and simplification.
Start with a pre-implementation briefing describing the mental model, first
vertical slice, data sources/fixtures, accessibility and browser-test plan,
files, assumptions, and privacy/isolation risks. Wait for approval before code.

Build small vertical slices against fixture registries/event streams until
real adapters exist. Run package and browser tests plus root `pnpm check`.
Commit and push each coherent slice. Never merge or force-push.

Submit shared changes through
`tasks/coordination/interface-requests/README.md`; do not edit shared
interfaces. End each slice with behavior delivered, files, checks,
accessibility/privacy findings, assumptions, interface requests, and next
slice.
