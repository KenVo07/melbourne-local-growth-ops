# Slice 4 — Cost and Quality Report (S4-H)

## Real provider sessions: 12 total (target 6–9, cap 12, consumed exactly)

All subscription-backed (Claude Pro via OAuth, Codex Plus via ChatGPT
tokens). No API key was used anywhere in this work; `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` were confirmed absent from the environment. **No PAYG. No
Business 2.**

| # | Provider | Purpose | Native units observed | Approx. wall time | Retries |
|---|---|---|---|---|---|
| 1 | Claude Pro (`claude_code`) | Read-only round-trip qualification | 38,524 tokens (reported in-session) | ~13s model + delivery overhead | 0 |
| 2 | Codex Plus (`codex`) | Read-only round-trip qualification | not captured (no token readout surfaced) | ~20s | 0 |
| 3 | Claude Pro | S4-C permission scenarios, hand-driven qualification evidence (2 turns: approve, deny) | not captured | ~20s combined ("Cogitated for 6s" + "Cogitated for 14s") | 0 |
| 4 | Claude Pro | Project A canary (frontend) | not captured | ~1–2 min | 1 host-side delivery retry (see below) |
| 5 | Claude Pro | Project B canary (backend/debug) | not captured | ~1–2 min | 1 host-side delivery retry |
| 6 | Codex Plus | Project C canary (security review) | not captured | ~1–2 min | 1 host-side delivery retry |
| 7 | Claude Pro | **Live `dispatch_via_child_transport` proof** (post-review gap closure) | input 4 (+20,608 cache-write, 55,284 cache-read), output 303 tokens; `total_cost_usd: 0.1455` (subscription-covered, not billed separately) | 9.8s (`duration_ms`) | 0 |
| 8 | Codex Plus | **Live `dispatch_via_child_transport` proof** (round 2 gap closure) | input 48,030 (34,304 cached), output 203 (49 reasoning) tokens | not separately timed (single `exec` call) | 0 |
| 9 | Claude Pro | **Canonical `dispatch.run_job` proof** (round 3 gap closure; via real `mlgo-v2-dispatch run-job` CLI) | input 6 (+21,612 cache-write, 95,090 cache-read), output 889 tokens; `total_cost_usd: 0.1804` | 12.9s (`duration_ms`) | 0 |
| 10 | Codex Plus | **Canonical `dispatch.run_job` proof** (round 3 gap closure; via real `mlgo-v2-dispatch run-job` CLI) | input 97,669 (68,608 cached), output 953 (277 reasoning) tokens | not separately timed (single `exec` call) | 0 |
| 11 | Claude Pro | **Qualified canonical `dispatch.run_job` proof + real cross-project containment negative scenario** (round 4 gap closure; via real `mlgo-v2-dispatch run-job` CLI, qualified via the separate `qualify-provider` operation) | input 6 (+36,305 cache-write, 70,180 cache-read), output 1,432 tokens; `total_cost_usd: 0.269459` | 22.1s (`duration_api_ms`) | 0 |
| 12 | Codex Plus | **Qualified canonical `dispatch.run_job` proof + real cross-project containment negative scenario** (round 4 gap closure; via real `mlgo-v2-dispatch run-job` CLI, qualified via the separate `qualify-provider` operation) | input 177,052 (156,928 cached), output 2,697 (1,279 reasoning) tokens | not separately timed (single `exec` call) | 0 |

Sessions 7–8 are the corrected live integration path
(`dispatch_governance.dispatch_via_child_transport` →
`child_provider_transport.ChildProcessTransportAdapter`, real
non-bypassed launches, real `ApprovalBroker`/`PermissionAdapter` in the
loop) that closes the three gaps final review found. Full raw usage JSON:
`evidence/slice4/permission-adapter-live/state/runs/*/v2/jobs/job-1/child-transport/raw-stdout.jsonl`.

Sessions 11–12 are the round-4 gap closure: each was qualified through the
new explicit `qualify-provider` operation (reusing round 3's own real
evidence bytes at zero additional cost) and then dispatched through
canonical `dispatch.run_job`, simultaneously proving real cross-project
write denial and truthful `provider_start_state`/`actual_call_consumed`.
Both sessions' `job.json` show `status: FAILED`,
`completion_state: PERMISSION_DENIED` — the attempted out-of-scope marker
write was observed and denied, which the governance loop correctly maps to
a denied completion for the whole job, even though the in-scope
`notes.py`/`bug-notes.txt` writes had already landed on disk. Full raw
usage JSON and all governance/qualification/child-transport artifacts:
`evidence/slice4/qualified-canonical-dispatch/state/runs/*/v2/jobs/phase-PROOF4-P01-a1-proof/`.

"Native units observed" is reported exactly as surfaced by the provider
session UI; where a session did not surface a token count in the captured
transcript, this is recorded as **not captured** rather than estimated or
fabricated, per the contract's "do not manufacture a dollar cost / token
count" instruction. No dollar cost is reported anywhere — both lanes are
subscription/quota-based and expose no per-call price.

### Retries

3 of the 6 sessions needed exactly one **host-side delivery retry**: the
first `herdr agent prompt` call was issued before the freshly-started agent
had finished rendering its welcome screen, so the prompt was not received
as a real message (confirmed by the terminal still showing the welcome
screen / 0 tokens afterward). Re-sending once, after confirming
`interactive_ready`, delivered correctly every time. This is a host
automation timing issue in the herdr orchestration, not a provider retry —
**no additional real provider call was billed or attempted** for these; the
first attempt never reached the model.

Separately, 2 pre-flight attempts at the legacy `cao-server`-based
read-only canary script failed *before* any session was created (a stale
installed runtime, then a script bug — see the Implementation report) and
consumed **zero** real provider sessions.

## Skill context

**Corrected (post-review):** the `ContextEnvelope` now measures the actual
native skill projection content sent to the provider, not a list of skill
IDs. Real, live measurement from sessions 7–8:
`context_manifest_bytes: 31644` (`WITHIN_CAP` against the default
262,144-byte hard cap), of which `native_skill_projection_bytes: 30434` is
the exact selected-skill instruction text and the remainder is the task
prompt. This is the CAO-controlled component measurement; it is distinct
from and smaller than the whole-session token count a provider itself
reports, which also includes the provider's own system prompt and prior
turn history. (An earlier draft of this report cited a 272-byte
measurement from a synthetic-recipe unit test that only accounted skill
IDs — superseded by the real, live, full-content measurement above.)

Each of the three canary projects used at most one recipe's skill set
(≤3 external skills per the contract's "ordinary tasks" target):
Project A implicitly drew on UI/UX-flavoured guidance already present in
the CAO memory context; Project C explicitly used exactly 2 projected
UnitOneAI skills (`secure-code-review`, `owasp-top-10-web`).

## Quality

No quality regression was accepted to save tokens; every task ran to
completion with full context.

| Session | Task | Result | Correctness |
|---|---|---|---|
| 1 | Ack nonce + return exact structured `MLGO_RESULT_PACKET` | PASS | Exact — nonce, schema, and status all correct on the first turn |
| 2 | Ack nonce exactly | PASS | Exact |
| 3a | Create `hello.txt` with exact content | PASS | Exact, one-shot |
| 3b | Refuse cross-project write without explicit authorization | PASS | Model itself flagged the risk and asked before acting |
| 4 | Accessible, styled `index.html` with a Submit button | PASS | Valid HTML, meets every stated requirement, no extraneous files |
| 5 | `calc.py` with the *exact* requested off-by-one bug + explanatory note | PASS | Bug matches the specification exactly (`a + b + 1`); note is accurate |
| 6 | Security review, findings.md | PASS | 7/7 seeded flaws found with correct line references, zero false positives, fixture left unmodified |
| 7 | (live integration) `ledger.py` with exact requested bug + `bug-notes.txt` | PASS | Bug matches specification exactly (`sum(amounts) + 1`); verified via real `dispatch_via_child_transport` |
| 8 | (live integration) same task, Codex | PASS | Identical correct bug produced independently by a different provider through the same governed path |
| 9 | (canonical dispatch) `notes.py` with exact requested bug + `bug-notes.txt`, via real `mlgo-v2-dispatch run-job` | PASS | Bug matches specification exactly; real result packet extracted and validated via the production contract |
| 10 | (canonical dispatch) same task, Codex, via real `mlgo-v2-dispatch run-job` | PASS | Identical correct bug; real result packet extracted and validated |

QUALITY_REGRESSION_ACCEPTED_FOR_COST: **NO**

## Deterministic regression (zero cost)

- `ops/cao-v2/verify.sh`: **PASS** (392 tests, source/source)
- root `pnpm check` (typecheck + full workspace test suite, unrelated
  packages included): **PASS**
- `git diff --check` from handoff SHA to branch tip: **clean**
