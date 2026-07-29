# Vercel domain setup runbook

Use this runbook after reviewing a deterministic deployment plan and before
declaring a managed isolated website ready.

## Ownership boundary

The deployment lifecycle may attach a configured hostname to the client's
isolated Vercel project and inspect Vercel's verification status. It does not
create, update, or delete records at an external DNS provider.

The client remains the domain owner. DNS changes require a separately approved
operator action in the authoritative client-controlled DNS system.

## Procedure

1. Generate the Vercel plan and confirm:
   - the `projectIdentity` belongs to the intended client/deployment;
   - the derived project is isolated from every other client;
   - the hostname list matches the approved runtime configuration;
   - `externalDnsMutation` is `false`.
2. Apply the lifecycle. A missing Vercel project is created; an existing
   matching project is reused.
3. The lifecycle inspects each project domain before attaching it. An existing
   matching domain is reused.
4. If the result is `DOMAIN_PENDING_VERIFICATION`, inspect the domain state and
   obtain the required DNS instructions through an approved operator process.
   Do not copy raw provider response bodies into tickets or logs.
5. Have the authorized domain owner make the required change at the external
   DNS provider.
6. Run inspection again. Continue only when every configured domain is
   `ATTACHED`.
7. Preserve the successful `DeploymentManifest` and provider observation in the
   calling operational system. Never replace observed identifiers or timestamps
   with placeholders.

## Fail-closed outcomes

- `DOMAIN_CONFLICT`: stop. The hostname is associated with another Vercel
  project. Verify ownership and project identity; do not detach it
  automatically.
- `DOMAIN_PENDING_VERIFICATION`: no manifest is produced. Complete the separate
  domain-owner process, then retry/inspect.
- `MALFORMED_PROVIDER_RESPONSE`: stop and investigate transport/API
  compatibility. Do not infer success from a partial response.
- Provider rejection or target mismatch: stop and verify the approved intent.

## Verification evidence

Record only normalized result codes, client/deployment identity, Vercel project
and deployment identifiers, hostname/status, and the manifest. Do not record
HTTP headers, raw response bodies, environment values, or credentials.
