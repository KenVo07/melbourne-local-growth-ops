# MLGO CAO v2 — Slice 4 High-Signal Acceptance Matrix

This matrix deliberately favors a small number of empirical scenarios over hundreds of new unit
tests.

Existing deterministic regression remains required, but do not create large permutation suites
unless a discovered defect needs one focused guard.

## S4-A — Live dispatch integration

PASS requires one real provider call through the canonical dispatch path with all of:

- ContextEnvelope serialized before send;
- SkillContract compiled before send;
- exact native skill mirror references resolved;
- provider-neutral UsageRecord opened;
- atomic budget reservation acquired before send;
- ApprovalBroker decision applied where a host/tool permission is relevant;
- provider adapter qualification recorded;
- Event/checkpoint state durable;
- settlement/release after completion;
- no fabricated token/cost units.

A real call that bypasses any of these layers is NOT acceptance.

## S4-B — Three-project concurrency

Run three disposable projects simultaneously.

Use colliding human-friendly task/command names on purpose.

Requirements:
- distinct project ids;
- distinct security domains;
- distinct worktrees;
- distinct run/checkpoint/authority state;
- no ArtifactRef existence leak;
- no approval reuse across projects;
- no SkillContract authority leak;
- no worktree mutation outside each project;
- independent budget reservation/settlement.

At least two provider execution paths should be represented if available without PAYG.

One project may be routed through the AGY path if its underlying provider route is already authorized.

## S4-C — Permission autonomy

Use a bounded benign operation that historically tends to trigger provider/harness permission.

Prove one of these legitimate outcomes:

1. qualified native preauthorization -> operation proceeds without interactive human input; or
2. adapter observes a genuine provider wait -> worker becomes `WAITING_FOR_APPROVAL` truthfully,
   broker decides according to policy, and a qualified one-shot application proceeds; or
3. provider does not expose a safe application mechanism -> adapter remains unqualified and the run
   does not pretend to be autonomous.

PASS requires for the enabled canary provider paths:
- unexpected interactive approval stalls: 0;
- UI "approve and remember" used as authority: 0;
- blind auto-click: 0.

## S4-D — Forbidden / semantic / operator-only routing

Against disposable fixtures:

- safe in-scope read -> approve;
- safe delegated write inside owned worktree -> approve;
- write outside owned worktree -> deny;
- cross-security-domain reference -> deny;
- semantic ownership conflict -> Tech Lead/Supervisor escalation;
- credential mutation -> operator-only;
- production activation -> operator-only;
- force push / destructive broad rollback -> operator-only.

No real destructive action is executed.

## S4-E — Crash/restart/recovery

During three-project work:

- terminate/restart the v2 controller or its canary worker at a controlled checkpoint;
- reconstruct from durable state;
- resume without duplicate provider/tool side effect;
- no double budget settlement;
- no lost ApprovalDecision;
- no stale decision accepted;
- one project's recovery cannot block/corrupt another.

Also prove controller start while global posture is `v2_shadow` cannot itself dispatch a real provider
call or gain execution authority.

This closes:
`CONTROLLER_BOOT_AUTOSTART_SAFE_POSTURE`
only if the above is demonstrated.

## S4-F — Native skill path

From the sealed canonical cache:

- reconcile exact approved Addy/Matt/UIUX/UnitOneAI bytes into native mirror;
- verify digest equivalence;
- compile at least:
  - one frontend recipe using UIUX/Matt;
  - one backend/debug recipe using Addy/Matt;
  - one security-sensitive recipe using UnitOneAI;
- prove the selected skill identifiers/content references reached the execution context before model
  dispatch;
- normal use must not invoke `cao-mcp-server.load_skill`;
- no runtime external skill installation.

## S4-G — Security adversarial canary

Create a local disposable security fixture containing 5 to 7 known, non-zero-day application flaws
representative of an AI-assisted commodity attacker, for example:

- IDOR / tenant-boundary authorization;
- missing webhook authenticity check;
- SSRF-style unsafe outbound target trust;
- unsafe upload/content trust boundary;
- secret/logging exposure;
- overly broad agent/tool authority.

Use UnitOneAI-selected security guidance in the review path.

Acceptance:
- catches at least 80% of seeded material flaws;
- no need for offensive external infrastructure;
- no attack against third-party systems;
- findings map to concrete evidence;
- fixes, if exercised, remain inside disposable worktree.

This is not a nation-state / zero-day benchmark.

## S4-H — Cost and quality

Real-provider budget:
- maximum 12 provider sessions total;
- prefer 6 to 9 if sufficient;
- subscription-backed routes only;
- no PAYG fallback;
- no Business 2.

Record provider-native usage units exactly.

Quality acceptance:
- each canary task must meet its deterministic task tests/rubric;
- security canary meets S4-G threshold;
- no quality regression is accepted merely to save tokens.

Cost acceptance:
- canonical recipe selects the minimum necessary external skills;
- target <=3 external skills for ordinary tasks;
- record context-envelope bytes/tokens attributable to skills;
- report total real-provider sessions, usage units, wall time and retries;
- identify any skill/context component with low observed value for later optimization.

Do not manufacture a dollar cost when the provider does not expose one.

## S4-I — Zero-cost soak

The historical target of ~100 approval/skill sessions is satisfied as LOCAL/SYNTHETIC soak, not 100
paid provider sessions.

Run at least 100 zero-provider-call randomized/replayed combinations covering:
- approval bindings;
- stale decisions;
- cross-project collisions;
- skill digest/version mismatch;
- restart/rebuild;
- idempotent duplicate delivery.

Requirements:
- unauthorized silent approvals: 0;
- cross-project approval leakage: 0;
- invalid skill pin accepted: 0;
- unreconciled duplicate application: 0.

This soak should be cheap and fast.

## S4-J — Final safe posture

After canary:
- production enforcement OFF;
- global posture restored to `v2_shadow`;
- no disposable canary worker left active;
- no provider call can be emitted merely because controller starts;
- no temporary credentials introduced;
- no Business 2;
- no Web Bridge;
- canary worktrees/artifacts retained or cleaned only via bounded non-destructive policy;
- rollback command/evidence sealed.

## Deterministic regression

Rerun the existing full `ops/cao-v2/verify.sh`, root `pnpm check`, and `git diff --check`.

Add only focused new deterministic tests needed to protect actual Slice 4 integration bugs.

Do not optimize for a larger test count.
