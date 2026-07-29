# Vercel deployment rollback runbook

Use rollback only to return one isolated client project to a previously observed
valid Vercel deployment.

## Preconditions

- The target is a stored successful `VERCEL` provider observation.
- Its project identity, idempotency key, source revision, and complete attached
  domain set match the current validated `DeploymentIntent`.
- The target deployment still exists and reports `READY`.
- Every configured domain is attached and verified on the same isolated
  project.
- The operator has reviewed the business impact. Rollback does not alter
  external DNS.

## Procedure

1. Run dry-run planning for identity context; planning makes no provider call.
2. Run inspection with the intended rollback target.
3. Stop if the target is missing, malformed, belongs to a different project, or
   has any domain that is not `ATTACHED`.
4. Call the explicit rollback boundary with one to five attempts. Use the
   default of three unless the incident procedure specifies otherwise.
5. The lifecycle requests Vercel rollback and then validates the target state
   again.
6. Confirm the returned project/deployment identifiers match the approved
   target and that all domains remain attached.
7. Record the normalized result and closed lifecycle events in the operational
   incident record.

## Failure handling

- `ROLLBACK_TARGET_NOT_FOUND`: stop and select another previously observed valid
  deployment. Never synthesize a target identifier.
- `ROLLBACK_DOMAIN_NOT_READY`: resolve the domain state using the domain setup
  runbook before reconsidering rollback.
- Rate limit, timeout, or unavailability: the adapter retries within the
  configured bound. If exhausted, stop and retry only through the same
  idempotent boundary.
- Provider rejection: stop and escalate with normalized technical evidence.
- Malformed response: treat rollback as unconfirmed and inspect independently;
  do not claim success.

## Security and recovery notes

Do not paste headers, raw Vercel payloads, environment output, or credentials
into the incident record. The lifecycle does not change DNS, delete deployments,
or change another client's project. If post-rollback inspection fails, preserve
the last known valid observation and escalate rather than attempting an
unvalidated compensating action.
