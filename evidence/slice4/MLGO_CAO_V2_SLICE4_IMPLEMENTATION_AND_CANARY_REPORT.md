# MLGO CAO v2 Slice 4 — Implementation and Canary Report

Branch: `integration/cao-v2-slice4-20260810-local-1`
Base: `origin/main@d6f90ef9babdc7ba641499bec2c02509e623a2b5`
Date: 2026-08-10

## Mission recap

Wire the already-built Slice 2/3/3.5 mechanisms (ContextEnvelope, atomic
budget reservation/settlement, canonical SkillContract compilation, the
ApprovalBroker/PermissionAdapter authority model) into the actual dispatch
path, resolve the controller boot-autostart authority gap structurally, and
prove all of it empirically on the real host with real subscription-backed
provider sessions — bounded, disposable, and reversible.

## What was actually broken going in

Direct inspection of `ops/cao-v2/lib/mlgo_cao_v2/dispatch.py` at the handoff
SHA showed:

- `submit_phase()` had only a per-run `shadow: bool` flag. `controller.py`
  calls it with `shadow=False` unconditionally for review dispatch. There was
  no *global* posture concept independent of a run's own mode — a
  systemd-autostarted controller had no structural gate stopping it from
  dispatching for real the moment any run happened to be enforced.
- `dispatch.py` imported none of `context_envelope`, `budgets`,
  `approval_broker`, `permission_adapter`, or `skill_recipes`. A repo-wide
  grep confirmed no non-test module referenced them. They were fully built
  and unit-tested in isolation, and completely unreachable from the real
  send path.
- `skill_population.py` could only *verify* the native `~/.agents/skills`
  mirror against the sealed cache, never write to it. The Matt Pocock,
  UI/UX Pro Max, and UnitOneAI bundles were confirmed absent from the real
  mirror on this host; only Addy Osmani's bundle happened to already be
  present.

## What was built

### 1. `canary_scope.py` — the structural boot-autostart fix

A provider-neutral, time-bounded, self-expiring authority scope. Process
liveness (systemd starting the controller) grants zero dispatch authority.
Real provider dispatch requires an explicit `canary-open --run-ids ...
--ttl-seconds ...` naming the exact run_id. Wired as the single choke point
inside `dispatch.submit_phase`: any caller requesting real dispatch
(including the controller's hardcoded `shadow=False`) is downgraded to a
safe observe-only outcome unless an active scope authorizes that run_id.
Expiry is evaluated on every read, so a stale/forgotten scope can never
grant authority. `canary-open` / `canary-close` / `canary-status` CLI
commands added.

Live-host proof (not just unit tests) in `evidence/restart-recovery/`: with
`mlgo-cao-v2-controller.service` actually `active`, an arbitrary unscoped
run_id was confirmed `is_authorized() == False` while the explicitly-scoped
drill run remained `True` — process liveness observably grants no authority.

### 2. `skill_population.project_native_mirror` — the missing write path

The one authorized Slice 4 write path from the sealed cache into
`~/.agents/skills`: atomic, idempotent (already-equivalent files are
skipped), with a rollback record snapshotting every file it overwrites
before writing. Ran for real against the host's operator-populated sealed
cache: Matt Pocock, UI/UX Pro Max, and UnitOneAI bundles (16 files,
previously entirely absent) are now byte-equivalent to the sealed cache;
Addy's already-correct files were left untouched (idempotent no-op).
`skill-cache-project-mirror` CLI command added.

### 3. `dispatch_governance.py` — the real dispatch-path seam

`govern_before_send()` runs immediately before a real provider send:

1. compiles the minimal canonical `SkillContract` from the sealed cache
   (recipe selected from `phase_kind`/objective; real digest-bound skills,
   not synthetic fixtures);
2. measures the complete request as a `ContextEnvelope` and asserts it is
   within the hard cap before anything is sent;
3. atomically evaluates-and-reserves budget (one `provider_sessions` unit,
   scope=run, cap sourced from
   `orchestration.max_real_provider_sessions_per_run`);
4. gets a real `ApprovalBroker` decision for the dispatch itself
   (`WRITE_IN_OWNED_SCOPE`, delegated to the phase's own
   `ownership.allowed_paths` digest; `READ_IN_SCOPE` for non-write phases,
   auto-approved by policy).

A `GovernanceBlocked` refusal (budget exhausted, approval not granted,
request over cap) means no provider call is attempted. Wired into
`dispatch.run_job` at the real send boundary: `settle_after_send` on
`RESULT_WRITTEN`; release/hold/settle on the existing
`pre_provider_failure` / `model_observed` / `START_RECONCILIATION_REQUIRED`
classification in the failure path, so budget certainty tracks the same
NOT_SENT / ambiguous / consumed distinction the completion-capture code
already draws.

## Real-host stabilization performed along the way

Three bounded, in-scope fixes were needed to get from "code compiles" to
"a real provider call actually completes", all committed on this branch or
applied as legitimate host configuration (never touching production/client
systems, secrets, or credentials):

1. **Stale installed runtime.** The installed `~/.local/lib/mlgo-cao-v2`
   library was still Slice 3.5's build. Re-ran `ops/cao-v2/install.sh
   --stage-only --apply` (additive, preserves all running services/profiles)
   to install this branch's code as the actual runtime the controller and
   `mlgo-v2-dispatch` invoke.
2. **A pre-existing ad-hoc read-only canary script** (not tracked source —
   found in `~/Downloads`) injected a synthetic `supervisor_profiles` entry
   that `load_policy()`'s unconditional `validate_policy_projection()` check
   now correctly rejects (drift from the canonical registry projection).
   Fixed the script to select an existing, correctly-registered supervisor
   profile instead of injecting one — a script bug, not a product defect.
3. **`herdr` session backend not attached.** The `mlgo-cao` herdr session the
   legacy CAO server depends on was `stopped`. Attached it
   (`herdr session attach mlgo-cao`), a routine host operational step, not a
   code change.
4. **`skipDangerousModePermissionPrompt: true`** was set in the
   `claude_subscription` lane's Claude Code settings. Per the operator's
   explicit instruction that child canary sessions must not bypass
   permissions (this is itself part of S4-C acceptance), set it to `false`.

None of these consumed a real provider session before they were fixed —
each failure surfaced before any session was created.

## Real provider sessions (full detail in `provider-qualification/`,
`permission-scenarios/`, `three-project-canary/`)

6 real subscription-backed sessions were used (target 6–9, cap 12; see
`MLGO_CAO_V2_SLICE4_COST_QUALITY_REPORT.md` for the full accounting):

1. Claude Pro subscription, read-only round-trip qualification — real model
   response, exact structured `MLGO_RESULT_PACKET` returned, 38524 tokens.
2. Codex Plus subscription, read-only round-trip qualification — exact
   nonce ACK returned.
3. Claude Pro, direct herdr control (no `cao-server`, no bypass flag) —
   S4-C permission scenarios: one-shot approved write inside owned scope;
   denied cross-project write.
4. Claude Pro — Project A (frontend, UIUX-flavoured task).
5. Claude Pro — Project B (backend/debug task).
6. Codex Plus — Project C (UnitOneAI-informed security review of the
   seeded fixture).

Two provider execution paths (`claude_code`, `codex`) both qualified,
both subscription-backed (OAuth / ChatGPT tokens, no API keys — no PAYG, no
Business 2 exposure anywhere in this work).

## Final verdict

See `MLGO_CAO_V2_SLICE4_FINAL_HANDOFF.md` for the complete verdict block.
