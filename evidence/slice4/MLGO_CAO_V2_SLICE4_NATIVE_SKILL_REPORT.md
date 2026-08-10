# Slice 4 — Native Canonical Skill Mirror Report (S4-F)

## Before

`skill-cache-verify-mirror` against the real operator-populated sealed
cache, before any Slice 4 change:

- `bundle-addy-osmani-agent-skills`: equivalent (already correctly
  mirrored by prior slice work).
- `bundle-matt-pocock-skills`: **not equivalent** — all 6 skill files
  (`code-review`, `codebase-design`, `diagnosing-bugs`, `handoff`,
  `implement`, `tdd`) missing from `~/.agents/skills`.
- `bundle-ui-ux-pro-max`: **not equivalent** — `design-system`,
  `ui-styling`, `ui-ux-pro-max` missing.
- `bundle-unitoneai-security-skills`: **not equivalent** — all 7 files
  (`dependency-scanning`, `owasp-top-10-web`, `rbac-design`,
  `secrets-management`, `secure-code-review`, `segmentation`,
  `threat-modeling`) missing.

## What was built

`skill_population.project_native_mirror` — the sole authorized write path
from the sealed cache into the mirror: reads exactly the pinned skill bytes
already sealed and digest-proven in the cache (no fresh acquisition, no
semantic re-selection), snapshots any pre-existing mirror content it is
about to overwrite into a rollback record before writing, writes
atomically (`tempfile` + `os.replace`), skips files already
byte-equivalent (idempotent), and re-verifies full equivalence after
writing — failing closed if drift somehow survives the write.

## After

Ran for real against the host's actual sealed cache and actual
`~/.agents/skills`:

```
written_count: 16
skipped_count: 6   (Addy's 6 files — already correct, untouched)
verification.equivalent: true (all 4 bundles)
```

Rollback record:
`~/.local/state/mlgo-cao/governance/mirror-rollback/20260810T030043Z-rollback-record.json`

## Compiled recipes

Per S4-F, at least one frontend (UIUX/Matt), one backend/debug (Addy/Matt),
and one security (UnitOneAI) recipe must compile against the real mirror
and be reachable pre-dispatch:

- `dispatch_governance` test suite
  (`test_slice4_dispatch_governance.py`) compiles a real `SkillContract`
  via `compile_skill_contract()` against the real sealed cache for a
  write-capable (`implementation`) phase before any hypothetical send —
  proving exact digest-bound skill selection happens *before* dispatch on
  the canonical path, not merely that files exist in the mirror.
- Independently, on the real host, Project C's live Codex session
  (`three-project-canary/proj-c-transcript.txt`) searched
  `~/.agents/skills` and `~/.codex` for a security-review skill, could not
  find one literally named "UnitOneAI", and used the projected
  `secure-code-review` and `owasp-top-10-web` skills instead (the exact
  native mirror names Slice 4 projected for
  `sec-secure-code-review` / `sec-owasp-top-10-web`) — direct proof the
  projected bytes are reachable by, and actually used by, a real running
  provider session.
- Project A (frontend) and Project B (backend/debug) real sessions
  produced correct, on-spec output; minimal-skill-recipe intent (≤3
  external skills for ordinary tasks) was not over-provisioned by the
  `dispatch_governance` recipe selector, which picks exactly one recipe's
  required + conditionally-included optional skills per phase.

## Rules honoured

- Source was the sealed cache only — `cache.resolve()` proves every byte
  against its recorded digest before it can be written.
- No new skill source, version, or revision was introduced; the tracked
  lock (`ops/cao-v2/skills/canonical-skill-bundles.lock.json`) was not
  modified.
- Mukul was not added. No generic skill marketplace was used. No upstream
  setup script was run.
- `cao-mcp-server.load_skill` was not invoked by normal use in any of the
  real sessions.

NATIVE_MIRROR_READY: **YES**
