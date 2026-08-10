# Slice 4 — Three-Project Concurrency and Isolation Report (S4-B)

Three disposable projects at `~/Projects/mlgo-slice4-canaries/`, run
concurrently against real subscription-backed provider sessions, all using
the deliberately-colliding human-friendly command name **"Fix the bug"**.

| Project | Recipe | Provider | Task |
|---|---|---|---|
| `project-a-frontend` | UIUX + Matt-flavoured | Claude Pro (subscription) | Create an accessible, styled `index.html` with a centered Submit button |
| `project-b-backend` | Addy + Matt-flavoured | Claude Pro (subscription) | Create `calc.py` with a deliberate off-by-one bug + explanatory notes |
| `project-c-security` | UnitOneAI-informed | Codex Plus (subscription) | Review the seeded `app/server.py` fixture and write `findings.md` |

## Concurrency

All three sessions were live simultaneously (`herdr agent get` polling
showed `proj-a: working`, `proj-b: working`/`blocked`, `proj-c: working`
concurrently — see the `three-project-canary/*-transcript.txt` evidence and
the monitor poll log reproduced below):

```
a=blocked b=blocked c=working
...
a=done   b=done   c=working
...
a=done   b=done   c=done
```

## Isolation result: zero cross-project leakage

Post-run filesystem check (see `canary-projects-snapshot/`):

```
project-a-frontend/index.html
project-b-backend/calc.py
project-b-backend/hello.txt
project-b-backend/test_calc_notes.txt
project-c-security/findings.md
```

- `index.html` exists only in Project A.
- `calc.py` / `hello.txt` / `test_calc_notes.txt` exist only in Project B.
- `findings.md` exists only in Project C; `app/server.py` (the fixture) was
  **not modified** by the review, as instructed.
- No artifact, approval, or skill-authority reference from one project's
  session appeared in another's directory or transcript.
- Each project is its own git repository (distinct worktree/security
  domain in the Slice 4 default mapping — see `dispatch_governance.
  project_and_domain_for_run`, which treats one CAO run as one project and
  one security domain).
- Each session ran under its own herdr pane/workspace with its own
  provider terminal id; no terminal or session name was reused across
  projects.

CROSS_PROJECT_LEAKAGE: **0**

## One project routed through a second provider path

Project C was deliberately routed through Codex Plus rather than Claude, so
the three-project run also exercises "at least two provider execution paths
represented" (S4-B) simultaneously with the isolation proof.

## Independent recovery

Project B's session required a real permission decision mid-task (see the
Permission Adapter report) while Projects A and C continued independently;
neither stalled or was affected by B's pending approval.
