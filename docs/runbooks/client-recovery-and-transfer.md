# Client recovery and ownership transfer

This runbook separates source recovery, application rollback, provider-account
transfer, domain transfer, analytics transfer, contact-form replacement, and
optional-data restore. None of these operations authorizes another one.

## Source loss

1. Retrieve the client-owned repository or the last transferred archive.
2. Run `pnpm verify:handoff` and compare the manifest digest with the recorded
   handoff digest.
3. If verification fails, recover another known copy. Do not regenerate hashes
   around untrusted files.
4. On a clean machine, use Node.js 24.18.0 and pnpm 11.9.0, install with the
   frozen lockfile and ignored dependency scripts, then run typecheck, tests,
   and production build.
5. Re-enter documented environment values directly from their owning client
   provider. Values are never recoverable from the handoff manifest.

## Deployment rollback

1. Select a previously observed valid deployment for the same client project,
   application identity, and domain set.
2. Use the deployment lifecycle rollback boundary and validate the resulting
   observed provider state.
3. Inspect domain attachment and application health after rollback.
4. Do not change external DNS as part of application rollback.

## Hosting-provider account transfer

1. Inventory the client project, last known valid deployments, environment
   variable names, domains attached at the host, build settings, and team roles.
2. Invite and verify the client's administrative owner.
3. Move or recreate the isolated project only through the hosting provider's
   approved transfer process.
4. Re-enter values from the client-owned providers and validate a deployment.
5. Remove agency access only after the client confirms control and recovery.

This runbook performs no provider transfer. A human owner must authorize and
execute provider-account changes.

## Domain transfer

1. Confirm the registrant, registrar account, renewal contact, DNS provider, and
   nameservers with the client.
2. Treat hosting-domain attachment and DNS mutation as separate changes.
3. Transfer registrar/DNS ownership through the provider's authorized process,
   preserving existing records until the target account is verified.
4. Confirm renewal, DNS resolution, TLS, canonical redirects, and client access.

No toolkit command changes DNS or initiates a domain transfer.

## Analytics transfer

1. Identify the client analytics property and current administrators.
2. Add and verify the client's administrative owner.
3. Confirm the delivered repository references only the client property.
4. Remove agency access after the client verifies reporting and administration.

## Contact-form provider replacement

1. Create or transfer a client-owned provider account and sending identity.
2. Verify approved recipients, sender domain, rate limits, and abuse controls.
3. Replace only the portable connector boundary in the client repository.
4. Document any new environment variable names without values.
5. Run clean install, typecheck, tests, production build, and end-to-end form
   acceptance in the client environment.
6. Retire old provider credentials only after the replacement is observed.

## Recovery completion

Recovery is complete only when the transferred source verifies, the production
build succeeds cleanly, the hosting deployment is observed valid, domains
resolve as intended, analytics administration belongs to the client, the
contact path is accepted, and every required optional-data restore has passed
its declared verification procedure.
