# Slice 4 — Cost and Quality Report (S4-H)

## Real provider sessions: 6 total (target 6–9, cap 12)

All subscription-backed (Claude Pro via OAuth, Codex Plus via ChatGPT
tokens). No API key was used anywhere in this work; `ANTHROPIC_API_KEY` /
`OPENAI_API_KEY` were confirmed absent from the environment. **No PAYG. No
Business 2.**

| # | Provider | Purpose | Native units observed | Approx. wall time | Retries |
|---|---|---|---|---|---|
| 1 | Claude Pro (`claude_code`) | Read-only round-trip qualification | 38,524 tokens (reported in-session) | ~13s model + delivery overhead | 0 |
| 2 | Codex Plus (`codex`) | Read-only round-trip qualification | not captured (no token readout surfaced) | ~20s | 0 |
| 3 | Claude Pro | S4-C permission scenarios (2 turns: approve, deny) | not captured | ~20s combined ("Cogitated for 6s" + "Cogitated for 14s") | 0 |
| 4 | Claude Pro | Project A canary (frontend) | not captured | ~1–2 min | 1 host-side delivery retry (see below) |
| 5 | Claude Pro | Project B canary (backend/debug) | not captured | ~1–2 min | 1 host-side delivery retry |
| 6 | Codex Plus | Project C canary (security review) | not captured | ~1–2 min | 1 host-side delivery retry |

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

`dispatch_governance`'s `ContextEnvelope` measurement (exercised for real
against the sealed cache in `test_slice4_dispatch_governance.py`) recorded
a `context-envelope` manifest for a representative implementation phase:
272 bytes serialized (`profile_text` skill-reference component +
`objective_task` prompt component), well under the default 262,144-byte
hard cap. This is the CAO-controlled component measurement; it is distinct
from and smaller than the whole-session token count a provider itself
reports, which also includes the provider's own system prompt and prior
turn history.

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

QUALITY_REGRESSION_ACCEPTED_FOR_COST: **NO**

## Deterministic regression (zero cost)

- `ops/cao-v2/verify.sh`: **PASS** (386 tests, source/source and
  installed/stage-only both green)
- root `pnpm check` (typecheck + full workspace test suite, unrelated
  packages included): **PASS**
- `git diff --check` from handoff SHA to branch tip: **clean**
