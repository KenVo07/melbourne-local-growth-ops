# M1 parallel-development foundation plan

## Outcome

Create the smallest shared M1 foundation that lets four feature branches work
independently from `integration/m1`. Preserve the M0 contracts and architecture,
lock only the interfaces needed at integration seams, and do not implement the
four feature streams.

## Baseline and scope

- Base all M1 branches on `origin/main@21e4ebf`.
- Preserve `m0-complete` and never rewrite `main`.
- Keep Node.js 24.18.0 and pnpm 11.9.0 pins.
- Extend the workspace only with meaningful interface packages.
- Add a pull-request quality gate without selecting a new linter.
- Leave all feature implementation to TSK-50 through TSK-56.

## Shared interface slice

- `packages/site-core`: the validated configuration alias, template contract,
  and module definition boundary.
- `packages/deployment`: the deployment manifest exchanged with deployment and
  handoff tooling.
- `packages/integrations`: the provider-neutral lead-delivery adapter.
- `packages/observability`: a technical-only event envelope with no form body.
- Do not create empty app, template, module, or script packages. Feature owners
  create those paths with their first vertical slice.

## Coordination model

- Foundation changes flow through `feat/m1-foundation` into `integration/m1`.
- Four feature branches start from the pushed integration commit.
- Shared interface changes require a written interface request and integration
  owner approval.
- Feature agents commit and push vertical slices but do not merge.

## Verification

- Run frozen install, build, tests, type checking, and diff checks.
- Review package boundaries and prohibit deep imports into `contracts`.
- Check for committed `.env` files and likely credentials.
- Confirm the foundation contains no deployment, form, rendering, or console
  feature implementation.
- Bootstrap and verify all four worktrees after integration is pushed.
