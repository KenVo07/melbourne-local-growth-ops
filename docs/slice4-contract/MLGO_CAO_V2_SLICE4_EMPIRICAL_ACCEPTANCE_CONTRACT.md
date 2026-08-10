# MLGO CAO v2 — Slice 4 Empirical Acceptance Contract

Date: 2026-08-10
Canonical base:
`main@d6f90ef9babdc7ba641499bec2c02509e623a2b5`

## Mission

Prove the CAO v2 stack works as an autonomous, restart-safe, cost-bounded multi-project execution
system on the real host, with real provider sessions where safe.

Slice 4 is not another large synthetic-test slice.

The priority order is:

1. correctness and isolation;
2. real autonomous behavior;
3. recoverability;
4. security;
5. cost/usage;
6. speed.

## What must become real in Slice 4

The following previously-built components must be exercised in the actual dispatch path for
disposable canary work, not only unit-tested in isolation:

- Slice 2 ContextEnvelope;
- Slice 3 atomic budget reservation/settlement;
- Slice 3.5 SkillContract / canonical skill selection;
- Slice 3.5 ApprovalBroker;
- Slice 3.5 PermissionAdapter;
- durable Event / checkpoint / authority state;
- project/run/worktree/security-domain isolation.

This does NOT authorize production enforcement.

## Canary-only authorization

The operator authorizes a bounded real-host canary for Slice 4 under these limits:

- disposable projects/worktrees only;
- no production deployment;
- no writes to client/customer production systems;
- no secrets export;
- no credential mutation;
- no force push;
- no destructive host cleanup;
- no Business 2;
- no PAYG fallback;
- use subscription-backed / already-authorized provider routes only;
- at most 12 real provider sessions unless a lower provider quota requires fewer;
- no paid external service signup;
- no Web Reasoning Bridge.

If completing the canary would require PAYG, a new paid account, a new credential, or a materially
different authority model, stop and escalate.

## Controller boot/autostart resolution

Do not preserve the old false invariant "enabled yet forever inactive".

The desired final model is:

- process/service liveness is NOT authority;
- the controller may auto-start after login/boot;
- in `v2_shadow` it may reconcile/observe only;
- it must not provider-dispatch, mutate production worktrees, apply approvals, consume real provider
  budget, or gain production authority merely because systemd started it;
- real canary dispatch is allowed only under an explicit disposable canary scope;
- after the canary, return to safe shadow posture automatically.

Close:
`CONTROLLER_BOOT_AUTOSTART_SAFE_POSTURE`
by proving boot/start behavior is safe because authority is policy-scoped, not because the process is
manually kept dead.

Prefer this over a fragile "stop it after every reboot" workaround.

## Native skill mirror

The sealed canonical cache remains authoritative.

Slice 4 may project only the already-approved exact locked Addy/Matt/UIUX/UnitOneAI skill bytes into
the native `~/.agents/skills` mirror.

This projection is explicitly authorized for the canary.

Rules:
- source must be the sealed cache, not fresh semantic selection;
- exact digest equivalence required;
- no new skill source/version;
- atomic/idempotent;
- rollback evidence;
- no external setup scripts/MCP installers;
- mirror drift fails closed.

## Security Pack

Canonical:
`UnitOneAI/SecuritySkills@70bc259bb01abb3015ad2ad859ad5253cbf0bcab`

Mukul is deferred and MUST NOT be added in Slice 4 unless a separate operator decision is made.

## Stabilization policy

The local implementation agent owns routine repair loops.

If a canary exposes a bounded implementation defect in the accepted Slice 1–4 architecture, the
agent may:
- diagnose;
- fix on the same Slice 4 branch;
- rerun affected deterministic checks;
- re-stage the canary;
- rerun the failed empirical scenario.

Do not stop to ask the operator for each ordinary bug.

Stop only for:
- material architecture change;
- new external dependency/vendor;
- new credentials/secrets authority;
- PAYG/new paid spend;
- production activation/deployment;
- destructive host action;
- cross-project/security-domain authority exception;
- inability to reconcile an operation whose application state is unknown.

Maximum bounded stabilization loops before mandatory stop: 3 material code-fix cycles.

## End state

Slice 4 PASS means:

- three concurrent isolated projects ran on the real host;
- at least two real provider execution paths were qualified where available;
- no unexpected human approval was required for policy-approved safe operations;
- forbidden/operator-only operations were not silently approved;
- WAITING_FOR_APPROVAL was truthful where a provider/native permission actually blocked;
- restart/recovery did not duplicate or cross-contaminate work;
- canonical skills were actually available through the native execution path;
- budget/context/approval/skill contracts were recorded around real dispatch;
- quality stayed acceptable under bounded cost;
- safe shadow posture was restored after canary;
- Web Bridge remains unstarted.
