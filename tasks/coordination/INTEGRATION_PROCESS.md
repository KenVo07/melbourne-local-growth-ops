# M1 integration process

## Branch roles

- `main`: protected M0 baseline; no direct M1 commits.
- `integration/m1`: reviewed M1 slices accumulated for verification.
- `feat/m1-*`: agent-owned feature branches; agents push but do not merge.

## Merge a vertical slice

1. Confirm the feature branch is pushed, clean, and based on a known
   `integration/m1` commit.
2. Review owned-path compliance, shared-interface use, tests, and the
   post-implementation debrief.
3. On `integration/m1`, run `git pull --ff-only`.
4. Merge the reviewed feature commit with `git merge --no-ff <branch>`.
5. Run `pnpm install --frozen-lockfile`, `pnpm check`, and
   `git diff --check`.
6. Run the slice-specific integration or browser tests.
7. Push `integration/m1` only after every check passes.

Stop after a failed merge check. Fix the responsible feature branch or create a
small integration-owner repair commit with an explicit explanation; do not
hide failures by merging another slice.

## Lockfile conflicts

Never accept either `pnpm-lock.yaml` side wholesale. Resolve all package
manifests first, remove conflict markers from the lockfile, and run
`pnpm install --lockfile-only` with the pinned Node.js and pnpm versions. Review
that dependencies from every merged branch remain, then run a frozen install
and the full check. The regenerated lockfile is committed by the integration
owner.

## Updating a feature branch

The safe default for a shared feature branch is:

```sh
git fetch origin
git merge origin/integration/m1
pnpm install --frozen-lockfile
pnpm check
```

Use a merge when commits have been pushed or another actor may consume the
branch. Rebase is allowed only for private, unpushed work with the branch
owner's explicit choice. Never rebase `main` or `integration/m1`, and never
force-push.

## Admission to main

Merge `integration/m1` into `main` only after:

- all approved M1 slices and runbooks are integrated;
- package, integration, end-to-end, portability, and rollback checks pass;
- public deployments remain isolated and database-free by default;
- handoff verification proves no private agency dependency;
- CI is green on the integration head;
- documentation and security review are complete;
- the human owner explicitly approves the merge.

## Rollback

Before release, revert a problematic merge commit on `integration/m1` with
`git revert -m 1 <merge-commit>` and rerun all checks. After an M1 merge to
`main`, use a normal revert commit and the documented deployment rollback; do
not reset, rewrite history, delete tags, or force-push. Preserve failed
deployment evidence and record the affected manifest/application versions.
