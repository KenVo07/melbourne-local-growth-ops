# M1 parallel-development foundation checklist

## Baseline

- [x] Verify clean `main`, `origin/main`, and `m0-complete`.
- [x] Run the M0 frozen install and full check.
- [x] Read the authoritative M1 milestone, build plan, and TSK-49–56.

## Foundation

- [x] Add minimal shared interface packages and tests.
- [x] Add CI quality gates.
- [x] Add architecture, assignment, integration, and interface-request docs.
- [x] Add four self-contained agent prompts.

## Integration

- [x] Verify, review, simplify, commit, and push `feat/m1-foundation`.
- [x] Merge foundation with `--no-ff` into `integration/m1`.
- [x] Re-run all checks and push `integration/m1`.

## Worktrees

- [x] Create the four feature branches/worktrees without overwriting paths.
- [x] Install and check every worktree.
- [x] Add local-only `.agent-worktree-info.md` files.
- [x] Return the primary repository to `main` and report exact next steps.
