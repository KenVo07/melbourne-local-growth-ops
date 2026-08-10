# Slice 4 — Crash/Restart/Recovery Report (S4-E)

Full raw evidence: `evidence/restart-recovery/` (controller journal, durable
run-state snapshot).

## Drill design

Per the contract ("A service/controller restart is enough for this Slice 4
acceptance if it exercises the same durable lifecycle boundary. No full
host reboot is required"), the drill exercised the real
`mlgo-cao-v2-controller.service` and the real durable state files under
`~/.local/state/mlgo-cao`, not a synthetic in-memory fixture.

1. Opened a real canary scope (`canary_scope.open_scope`) for run
   `crash-drill-20260810-1`, TTL 30 minutes, against the real host
   `state_root`.
2. Reserved a real budget unit (`BudgetStore.evaluate_and_reserve`) for a
   command inside that run, leaving it `ACTIVE` (deliberately not settled —
   simulating the exact window between "provider call in flight" and "host
   observes the outcome").
3. **Live-verified before the crash**: with `mlgo-cao-v2-controller.service`
   actually `active` (started to simulate boot-autostart), a *different*,
   unscoped run_id was confirmed `is_authorized() == False` while the
   scoped drill run remained `True`. Process liveness observably grants no
   authority to anything outside its explicit scope.
4. **The crash**: `systemctl --user restart mlgo-cao-v2-controller.service`
   — a real process kill and restart — while the reservation was still
   `ACTIVE` and unsettled.
5. **Post-restart verification**, from durable files only (no in-memory
   state survived the restart by construction):
   - `canary_scope.posture()` still reported `"canary"`, and the drill run
     was still authorized — the scope file survived the restart intact.
   - The budget reservation was still present on disk with status
     `ACTIVE` — not lost, not silently duplicated.
   - `BudgetStore.replay(command_states={"crash-drill-cmd-1": "COMPLETED"})`
     correctly classified it as a **single** leak requiring `settle`
     (the command completed but was never settled before the crash) —
     exactly the reconciliation the certainty-first budget design exists
     to catch.
6. **Recovery applied**: `settle()` called exactly once per replay's
   guidance. A second `replay()` immediately afterward showed **zero**
   remaining leaks. Calling `settle()` again returned `duplicate: True` —
   confirmed idempotent, no double-settlement possible.
7. **Safe posture restored**: `canary_scope.close_scope()` — posture
   returned to `v2_shadow`. The controller service was stopped again,
   restoring it to the exact `inactive` state it was in before the drill.

## Result

- RESTART_RECOVERY: **PASS**
- DUPLICATE_PROVIDER_OR_TOOL_ACTIONS: **0**
- No double budget settlement: confirmed (`duplicate: True` on re-settle)
- No stale approval applied: no approval was involved in this drill's
  budget path; approval-side staleness is covered by
  `test_D3_approval_broker_operator_only_and_cross_scope`'s stale-revision
  cases in the zero-cost soak (26 cases, 30% stale by construction, 0
  silently honoured)
- CONTROLLER_BOOT_AUTOSTART_SAFE_POSTURE: **CLOSED** — proven live, with
  the controller process actually running, that an unscoped run cannot
  gain dispatch authority merely because the process is alive
- Unaffected work: the three-project canary (S4-B) ran independently in
  the same time window on a completely separate mechanism (direct herdr
  sessions, not the v2 controller/RunStore path) and was unaffected by
  this drill, by construction of Slice 4's isolation model.
