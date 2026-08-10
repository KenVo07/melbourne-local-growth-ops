# MLGO CAO v2 — Pre-Slice-4 Capability Integration Lock

Status: LOCKED
Date: 2026-08-09

## Sequence

1. Slice 1 — provider-neutral execution kernel — CLOSED
2. Slice 2 — continuity + episodic authority + hybrid Tech Lead — CLOSED
3. Slice 3 — events + artifacts + economics + budgets + validation — CURRENT GATE
4. Slice 3.5 — canonical skills + autonomous approval layer — LOCKED NEXT CAPABILITY INTEGRATION
5. Slice 4 — empirical acceptance, crash/recovery/rollback/multi-project/reliability/economics
6. Web Reasoning Bridge — only after Slice 4 acceptance

Do not skip Slice 3.5 and do not move it after Slice 4 or Web Bridge.

## Canonical skill architecture

CAO does not become a general-purpose skill marketplace.

Supported engineering knowledge stack:
- Internal CAO protocols
  - cao-supervisor-protocols
  - cao-agent-routing
  - cao-worker-protocols
- Addy Osmani engineering skills
- Matt Pocock engineering skills
- UI/UX Pro Max skill library
- one dedicated Security Pack selected and pinned during Slice 3.5

The Security Pack is intentionally focused. Addy's security guidance remains baseline; the dedicated pack adds stronger threat-model/security-review boundaries where needed.

## Skill integration model

"Hard-coded" means:
- canonical approved bundles;
- pinned revisions/versions;
- verified content digests;
- deterministic role/task recipes;
- deterministic minimal skill selection before model dispatch;
- recorded selected skill IDs, versions/digests and selection reasons;
- no runtime discovery of arbitrary skills;
- no worker-driven installation or MCP configuration for canonical skills.

It does not mean scattering vendor-specific skill names throughout controller logic.

External skills may complement CAO protocols but may never override authority, scope, Command idempotency, worktree/file ownership, validation, budget, recovery or operator-only controls.

## Approval architecture

Canonical skill loading must be pre-authorized deterministic infrastructure. If a canonical skill with a valid pinned digest triggers an interactive user prompt, treat it as a bug.

Build a deterministic CAO Approval Broker in Slice 3.5.

Approval classes:
1. AUTO_APPROVE
   - canonical skill load
   - repo/file reads and search
   - approved tests/lint/typecheck/build
   - Git read operations
   - writes inside explicitly owned worktree/file scope
   - other explicitly delegated deterministic operations

2. AUTO_DENY
   - unapproved external skill/plugin installation
   - arbitrary capability expansion
   - forbidden operations
   - invalid/mismatched skill version or digest
   - cross-project/cross-security-domain access

3. TECH_LEAD / SUPERVISOR ESCALATION
   - semantic uncertainty
   - shared-file ownership conflict
   - scope/delegation exception
   - architecture/risk exception

4. OPERATOR_ONLY
   - production activation/deployment where policy requires
   - credentials/secrets authority changes
   - destructive broad host operations
   - force push/broad rollback
   - PAYG/frontier spending beyond authorization
   - enabling new production authority/enforcement

Do not implement blanket auto-approve.
Do not rely on UI/session "Approve and remember" state as authoritative permission state.

## Approval state semantics

CAO must distinguish:
- RUNNING
- WAITING_FOR_APPROVAL
- APPROVED_BY_POLICY
- APPROVED_BY_DELEGATION
- DENIED_BY_POLICY
- ESCALATED_FOR_AUTHORITY

A worker waiting on an approval prompt must never be reported as healthy RUNNING.
Correctness-bearing approval decisions must be durable and replayable after restart.

## Slice 4 additions

Slice 4 must validate the final pre-Web substrate including Slice 3.5.

### Multi-project concurrency
Run at least three concurrent isolated projects/runs and prove:
- zero cross-project state contamination
- zero ArtifactRef/security-domain leakage
- zero decision/authority leakage
- zero wrong ConversationHandle/checkpoint resume
- zero wrong budget settlement
- zero wrong repo/worktree mutation
- one project's failure/recovery does not corrupt or strand the others

### Approval/skill soak
Use many disposable worker sessions, target 100 where practical.

Expected:
- unexpected interactive approval stalls: 0
- canonical skill authorization failures: 0
- unauthorized operations silently approved: 0
- cross-project approval leakage: 0
- invalid skill digest/version accepted: 0

Inject approvals deliberately:
- safe -> deterministic approve
- forbidden -> deterministic deny
- semantic -> Tech Lead/Supervisor
- operator-only -> operator gate

### Reproducibility
Record and verify skill bundle versions/digests per run.
Restart/new session must reconstruct the same authorized skill contract without UI "remember" state.

## Web Reasoning Bridge dependency

The Web Reasoning Bridge starts only after Slice 4 validates this complete substrate.

The Bridge remains provider-neutral at the core:
- ReasoningAuthority
- ReasoningTool
- ExecutionAgent
- WebReasoningTransport/adapter

Skill selection and approval policy remain below the provider/web adapter layer.
