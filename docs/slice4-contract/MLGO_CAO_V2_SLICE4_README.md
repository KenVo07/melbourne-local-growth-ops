# MLGO CAO v2 — Slice 4 Execution Kit

This is one end-to-end Slice 4 job, not a chain of user-mediated mini-phases.

Start from current `origin/main`.
At handoff it is:
`d6f90ef9babdc7ba641499bec2c02509e623a2b5`

Primary prompt:
`MLGO_CAO_V2_SLICE4_LOCAL_AGENT_PROMPT.txt`

The local agent owns bounded repair/retry loops and should not return to the operator for routine
implementation defects.

The agent returns only when:
- empirical acceptance is complete and a draft PR/evidence package exists; or
- a material operator-only blocker is encountered; or
- three material stabilization cycles have been exhausted.

Real provider use is capped at 12 sessions and must use already-authorized subscription-backed routes.
The historical ~100-session soak is local/zero-provider-call only.

Slice 4 is the final pre-Web-Bridge empirical gate.
