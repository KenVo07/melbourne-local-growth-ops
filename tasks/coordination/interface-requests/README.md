# Shared interface change requests

Feature agents do not directly edit shared interfaces. Copy the template below
to `REQ-<short-name>.md`, complete every field, and commit it on the requesting
feature branch. The integration owner records the approval decision.

```markdown
# Interface request: <short title>

- Requester: <agent and branch>
- Affected interface: <package and exported symbol>
- Current limitation: <concrete blocked behavior>
- Proposed minimal change: <smallest compatible shape>
- Affected agents: <streams that consume the interface>
- Compatibility impact: <none, additive, or breaking with explanation>
- Test impact: <tests to add or update>
- Approval status: PENDING

## Evidence

<failing test, type error, or vertical-slice example>

## Alternatives considered

<how an adapter, mock, or package-local type was evaluated>
```

Approval status is one of `PENDING`, `APPROVED`, or `REJECTED`. Only the
foundation/integration owner may mark it approved and change the shared
contract. A request is not approval.
