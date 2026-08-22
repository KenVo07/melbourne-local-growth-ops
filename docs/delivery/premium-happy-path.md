# The premium happy path

The intended steady-state flow, and what the operator is not responsible for.

Stone & Line reached a good result through an R&D journey: a dozen review packages,
a parity recovery pass, manual archaeology to find and render approved design
artifacts, and hand-managed hashes, rebind files, screenshot manifests and
deployment plumbing. **That journey is the thing this consolidation exists to
delete.** Client #2 should not repeat any of it.

## The flow

```
CLIENT INPUT READY
   → Factory P1
      → premium preparation
         → creative exploration
            → HUMAN DIRECTION GATE            ← human
               → parity slice
                  → HUMAN PARITY GATE         ← human
                     → production scale
                        → objective verify
                           → Preview
                              → HUMAN SHIP GATE   ← human
```

P3 adds one gate, where a bespoke instrument is being authored:

```
                     → Signature / Motion Ceiling gate   ← human
```

Three human gates on P1/P2, four on P3. Everything else is checks and packaging.

## What each step is

| Step | What happens | Who |
|---|---|---|
| Client input ready | Business read, media intake, audit, shot gaps closed, creative configuration decided | Operator + agency |
| Factory P1 | Generate and assemble. Fast, simple, unchanged by this consolidation | Automation |
| Premium preparation | `creative:prepare` — a source-bound workspace | Automation |
| Creative exploration | Territories, a signature slice, red team. Any tool, or none | Human + any tool |
| **Human direction gate** | A named human picks a direction and signs | **Human** |
| Parity slice | Home, one service detail, one project detail, mobile — built | Agent |
| **Human parity gate** | Rendered side-by-side. Does the translation hold? | **Human** |
| Production scale | The remaining route grammar | Agent |
| Objective verify | `creative:verify` — identity, boundary, evidence, constraints | Automation |
| Preview | Deploy to a preview target | Automation |
| **Human ship gate** | Signed against the objective report and the reviewed evidence | **Human** |

## What the founder must never manage by hand

Every item on this list was hand-managed at least once during Stone & Line, and
every one belongs to automation or to the agent executing a step:

- source hashes, artifact ids, source-set ids;
- rebind files and workspace/launch identity plumbing;
- screenshot manifests and evidence directory layout;
- checksum manifests for review packages;
- Vercel deployment plumbing, project ids, protection settings;
- browser evidence directories and harness wiring;
- finding, downloading and rendering approved design artifacts.

That last one is the one this pass fixed structurally: approved visual artifacts now
travel inside the launch pack, hashed and listed in the read order, and the agent is
instructed to render and inspect them. See the
[authority model](../creative/authority-model.md).

## What stays human, permanently

**Direction. Parity. Ship.** And on P3, the motion ceiling.

These are not process overhead to be optimised away. Every one of them is a taste
judgement, and the system is built so that a machine cannot make one: the objective
report has no field for a verdict, and the contract refuses one if a future edit
tries to add it. An agent cannot sign its own work at either end.

## What this consolidation deliberately did not add

No new command. No new subsystem, dashboard, database or workflow engine. No new
mutable state file. The three-command bridge — `prepare`, `launch`, `verify` — is
unchanged in shape; what changed is what it carries across the boundary and what it
refuses.

The parity slice is not a fourth command. It is the same three commands run once on
a small scope before being run on the full one.
