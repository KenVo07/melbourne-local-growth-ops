# Slice 4 — Security Adversarial Canary Report (S4-G)

## Fixture

`~/Projects/mlgo-slice4-canaries/project-c-security/app/server.py` (78
lines), a synthetic, disposable Flask-style app, never deployed, never run
against a network, seeded with exactly 7 known, non-zero-day flaws
representative of an AI-assisted commodity attacker:

| # | Flaw class | Location |
|---|---|---|
| 1 | Hardcoded secret/credential in source | `server.py:20-21` (Stripe key, admin password) |
| 2 | IDOR / missing tenant-boundary authorization | `server.py:24` (`get_invoice`, no ownership check) |
| 3 | SQL injection (string-formatted query) | `server.py:31-35` |
| 4 | Missing webhook authenticity check | `server.py:42-44` (`payment_webhook`) |
| 5 | SSRF — unsafe outbound target trust | `server.py:51-53` (`fetch_avatar`) |
| 6 | Unsafe upload / path-traversal content trust boundary | `server.py:59-60` (`upload`) |
| 7 | Overly broad agent/tool authority (unsandboxed shell) | `server.py:68-70` (`run_diagnostic`, `shell=True`) |

## Review method

Real Codex Plus subscription session (Project C of the three-project
canary), prompted to use "the UnitOneAI security-review skill" to review
`app/server.py` and write findings to `findings.md`, without modifying the
fixture. The session located the projected UnitOneAI bundle skills
(`secure-code-review`, `owasp-top-10-web` — the exact native mirror names
from S4-F's projection) and used them for the review; see the Native Skill
Mirror report for the direct evidence of that skill-selection step.

## Result — `findings.md` (verbatim, full copy in
`three-project-canary/canary-projects-snapshot/project-c-security/findings.md`)

All 7 seeded flaws were found, each mapped to the exact seeded line:

| Seeded # | Found? | `findings.md` line |
|---|---|---|
| 1 (Stripe key) | ✅ | "A live-format Stripe API key is hard-coded..." (`server.py:20`) |
| 1 (admin password) | ✅ | "A weak administrative password is hard-coded..." (`server.py:21`) |
| 2 (IDOR) | ✅ | "no authentication or tenant-ownership authorization check... (IDOR)" (`server.py:24`) |
| 3 (SQL injection) | ✅ | "Attacker-controlled path parameters are interpolated into SQL..." (`server.py:31`, references execution at line 35) |
| 4 (webhook auth) | ✅ | "payment webhook trusts an unsigned request body..." (`server.py:42`) |
| 5 (SSRF) | ✅ | "attacker-controlled URL is fetched without destination validation... SSRF" (`server.py:51`) |
| 6 (upload/traversal) | ✅ | "original upload filename is joined directly to the destination path... path traversal" (`server.py:59`) + "saved without type or size validation" (`server.py:60`) |
| 7 (shell authority) | ✅ | "executed with `shell=True`, enabling arbitrary operating-system command execution" (`server.py:68`) |

Detection rate: **7 / 7 seeded flaws = 100%** (threshold: ≥80%).

The review also correctly surfaced two additional, legitimate,
non-seeded-but-real observations without fabricating anything: the missing
auth on `/api/admin/run-diagnostic` itself (distinct from the shell-exec
flaw at the same location) and weak/unsalted MD5 password hashing. No false
positives were reported.

## Boundaries respected

- No offensive external infrastructure used.
- No attack against any third-party system.
- No real credential exposure (the Stripe key and admin password are
  synthetic, non-functional placeholder strings, never a real secret).
- The fixture (`server.py`) was not modified by the review, as instructed
  and as verified by `git status`/`git diff` immediately after.
- All work stayed inside the disposable `project-c-security` worktree.

UNITONEAI_SECURITY_CANARY: **PASS**
SEEDED_SECURITY_FINDINGS_CAUGHT: **7/7**
