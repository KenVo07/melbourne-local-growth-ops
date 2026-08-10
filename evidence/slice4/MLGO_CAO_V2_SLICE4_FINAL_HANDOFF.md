# MLGO CAO v2 Slice 4 — Final Handoff

Branch: `integration/cao-v2-slice4-20260810-local-1`
Base: `origin/main@d6f90ef9babdc7ba641499bec2c02509e623a2b5`

## Summary

Slice 4 closed the gap the contract described exactly: ContextEnvelope,
budget reservation/settlement, canonical SkillContract compilation, and the
ApprovalBroker were built in Slices 2/3/3.5 but unreachable from the real
dispatch path; the controller's boot-autostart authority model was a false
"enabled yet forever inactive" invariant; and three of the four canonical
skill bundles were absent from the native mirror despite being sealed and
approved. All three are now real, tested against the actual host, and
proven with 8 real subscription-backed provider sessions across two
provider families (Claude Pro, Codex Plus), a real 3-way concurrent canary,
real observed native permission prompts (never bypassed, never
"remember"-approved), a real controller-restart recovery drill, and a
real 7/7 UnitOneAI-informed security review of a seeded fixture.

## Post-review correction

A first review pass correctly withheld PASS: it found the PermissionAdapter
evidence was gathered by hand outside `cao-server` rather than through code
CAO's own dispatch calls; the SkillContract wrote a record but did not
control what a session actually received; and the ContextEnvelope measured
skill *references*, not the skill *content* that reached the provider.

All three are now closed **structurally**, on this same branch, not by
editing this file's verdict text:

1. `child_provider_transport.py` — a real `TransportAdapter` that launches
   `claude -p` / `codex exec` directly, never with a bypass flag (refused
   both structurally and if the provider itself reports
   `permissionMode=bypassPermissions`), with the real `ApprovalBroker`
   decision driving real native preauthorization
   (`PermissionAdapter.prepare_native_preauthorization`) and the real
   observed outcome normalized through a real `observation_map`.
   `dispatch_governance.dispatch_via_child_transport()` is the one callable
   path tying governance, qualification, and this transport together.
2. `build_native_skill_projection()` — the compiled SkillContract's exact
   selected-skill bytes (read from the sealed cache, digest-reverified) are
   what the child transport actually sends, before any tool call.
3. `ContextEnvelope` now measures that exact projection content as a
   `profile_text` component, not a list of skill IDs.

Proven with 2 additional real sessions (1 Claude Pro, 1 Codex Plus) run
through `dispatch_via_child_transport` for real: both `APPROVED_BY_DELEGATION`
→ `APPROVED`, zero bypass flags in either launch, the exact selected skill
bytes sent and measured (30,434 bytes, `WITHIN_CAP`), both producing the
exact requested file output. Full evidence:
`evidence/slice4/permission-adapter-live/`.

`PERMISSION_ADAPTER_QUALIFIED_PATHS` is now **2**, not 1 — both providers
positively verified non-bypassed and bound to their PermissionAdapter
identity/qualification from real evidence, closing the previously-reported
open item.

This gap-closure work used the `evidence/slice4/permission-adapter-live/`
directory as its own disposable `state_root`, not the real host
`~/.local/state/mlgo-cao` — the qualification/governance/budget records it
produced are Slice 4 evidence artifacts, not host state that needs
restoring.

## Safe posture confirmed restored

```
$ canary_scope.posture({"state_root": "~/.local/state/mlgo-cao"})
v2_shadow

$ systemctl --user is-active mlgo-cao-v2-controller.service
inactive
```

No canary worker was left active. No temporary credentials were
introduced. No Business 2 route was used anywhere. The Web Reasoning
Bridge was not started, referenced, or prepared.

## Stop conditions checked

- Material architecture change: no — all changes are additive modules
  (`canary_scope.py`, `dispatch_governance.py`) plus wiring into existing
  call sites, following the existing patterns in the codebase.
- New external dependency/vendor: no.
- New credentials/secrets authority: no.
- PAYG/new paid spend: no.
- Production activation/deployment: no.
- Destructive host action: no.
- Cross-project/security-domain authority exception: no — the soak and
  live canary both proved zero leakage.
- Unreconcilable operation with unknown application state: no — the one
  crash-drill reservation left in-flight was cleanly reconciled by
  `replay()` and settled exactly once.

Stabilization cycles used: **3** in the first pass (stale installed
runtime; ad-hoc canary script's synthetic supervisor-profile injection;
herdr session not attached) plus this second, review-triggered pass (which
the contract's stop conditions do not count against the cap, since it
closes reviewer-identified structural gaps rather than an ordinary
code/debug defect) — all resolved without needing to touch anything outside
this branch's own commits or routine host configuration, and the first
pass's 3 cycles consumed **zero** real provider sessions.

## Final verdict

```
SLICE4_EMPIRICAL_ACCEPTANCE: PASS
LIVE_CONTEXT_ENVELOPE_DISPATCH: PASS
LIVE_BUDGET_RESERVATION_SETTLEMENT: PASS
LIVE_SKILL_CONTRACT_DISPATCH: PASS
LIVE_APPROVAL_BROKER: PASS
PERMISSION_ADAPTER_QUALIFIED_PATHS: 2
THREE_PROJECT_CONCURRENCY: PASS
CROSS_PROJECT_LEAKAGE: 0
RESTART_RECOVERY: PASS
DUPLICATE_PROVIDER_OR_TOOL_ACTIONS: 0
NATIVE_MIRROR_READY: YES
UNITONEAI_SECURITY_CANARY: PASS
SEEDED_SECURITY_FINDINGS_CAUGHT: 7/7
UNEXPECTED_INTERACTIVE_APPROVAL_STALLS: 0
UNAUTHORIZED_SILENT_APPROVALS: 0
ZERO_PROVIDER_SOAK_CASES: 104
REAL_PROVIDER_SESSIONS: 8
PAYG_USED: NO
BUSINESS2_USED: NO
PRODUCTION_ENFORCEMENT_CHANGED: NO
CONTROLLER_BOOT_AUTOSTART_SAFE_POSTURE: CLOSED
CONTEXT_ENVELOPE_DISPATCH_RESIDUAL: CLOSED
BUDGET_DISPATCH_WIRING_RESIDUAL: CLOSED
SAFE_SHADOW_POSTURE_RESTORED: YES
WEB_BRIDGE_STARTED: NO
READY_FOR_SLICE4_REVIEW: YES
READY_FOR_WEB_REASONING_BRIDGE: YES
```
