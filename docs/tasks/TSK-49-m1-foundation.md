# TSK-49 — M1 parallel-development foundation

## Status

Foundation slice for M1. This repository document is the
implementation-facing interpretation of the authoritative M1 milestone,
Technical Build Plan, and TSK-49 through TSK-56.

## Objective

Establish a minimal workspace, CI quality gate, shared integration interfaces,
branch strategy, worktree assignments, and agent prompts so four M1 streams can
develop independently. Do not implement the Website Factory, deployment
generator, contact form, or ops console in this slice.

## Baseline

- Base commit: `origin/main@21e4ebf`
- M0 marker: annotated tag `m0-complete`
- Runtime: Node.js 24.18.0
- Package manager: pnpm 11.9.0
- Existing frameworks: TypeScript and Vitest
- No linter has been selected. A lint command is deferred to an explicit
  tool decision; CI must not present another check as lint.

## Required outputs

- `integration/m1` and `feat/m1-foundation`
- four meaningful shared-interface packages
- CI running frozen install and `pnpm check`
- architecture and integration-process documentation
- path ownership and acceptance criteria for four feature branches
- four self-contained agent prompts
- four clean, verified worktrees based on the integration commit

## Interface decisions

- `ValidatedWebsiteConfiguration` is an alias of the TSK-45
  `WebsiteRuntimeConfig` and uses its validator.
- `WebsiteTemplate` returns a composition contract; no rendering framework is
  chosen here.
- `WebsiteModuleContract` describes execution, dependencies, portability,
  analytics names, and fallback behavior without implementing a registry.
- `DeploymentManifest` records identity, versions, delivery/ownership,
  domains, provenance, and handoff state without calling a provider.
- `LeadDeliveryAdapter` is provider-neutral and stateless by default.
- `ObservabilityEvent` is a closed technical envelope with no form body or
  generic metadata.

## Explicit non-goals

- no feature-complete applications or modules;
- no live Vercel, Resend, analytics, or monitoring calls;
- no database, auth, object storage, or background jobs by default;
- no alternative runtime configuration schema;
- no change to `packages/contracts`;
- no merge of `integration/m1` to `main`.

## Acceptance

1. Frozen install and `pnpm check` pass on foundation and integration branches.
2. CI pins the repository's exact Node.js and pnpm versions.
3. Package imports use deliberate package roots; no deep contracts import.
4. No secret or real `.env` file is tracked.
5. Shared ownership, interface-request, merge, lockfile, rollback, and mock
   procedures are documented.
6. Each worktree has the correct branch, a clean check, and a local-only agent
   assignment file.

## Known interpretation

The upstream Build Plan's `apps/site-template` and
`tooling/deployment-generator` concepts are represented by
`apps/managed-web` and `packages/deployment` plus `scripts/deployment`, as
directed by the current M1 setup task. This is a repository naming decision,
not a change to the isolated deployment architecture.
