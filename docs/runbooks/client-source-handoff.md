# Client source handoff

Use this runbook to transfer one delivered website into a client-owned source
repository without granting access to the private Website Factory.

## Preconditions

- The client configuration validates through the contracts package root.
- The deployment manifest records an observed successful build for that exact
  client, deployment, configuration version, and domain set.
- Source, generated site files, client assets, tests, and package metadata have
  already been selected for this client.
- Reusable runtime code needed by the site has been transformed into portable
  source or vendored under the delivered repository.
- Every module and connector is marked `TRANSFERABLE` or `CLIENT_OWNED`.
- The export timestamp is supplied explicitly by the approved caller.

## Plan and review

1. Build `ClientHandoffExportInput` with an exact `artifactAllowlist`. Never
   enumerate the monorepo and pass the result through as an export.
2. List every allowed public package and its pinned lockfile resolution.
3. Document required environment variable names, purpose, requirement status,
   and client ownership. Do not provide values.
4. List identifiers belonging to other clients so the isolation scan can fail
   if any appear.
5. Declare optional persistent resources only when a purchased feature actually
   configures them.
6. Run `planClientHandoffCommand`. Review file count, manifest digest, client and
   deployment identity, and the three passed scan results.

## Materialize and verify

1. Choose a new empty directory owned by the client delivery workflow.
2. Run `exportClientRepositoryCommand`. It must not overwrite existing files.
3. Run `verifyClientRepositoryCommand` before committing or adding any file.
   The command:
   - verifies the transferred bytes and SHA-256 manifest digest;
   - copies the repository into a fresh temporary directory;
   - runs `pnpm install --frozen-lockfile --ignore-scripts`;
   - runs typecheck, production build, delivered tests, and
     `pnpm verify:handoff`;
   - forwards only operating-system path/runtime variables, not ambient
     credential-bearing environment variables.
4. Create the repository in the client's source-control account and commit the
   verified files without build output, caches, or local environment files.
5. Repeat `pnpm verify:handoff` after transfer. Any integrity mismatch requires
   a new approved export, not an edited manifest or digest.

## Ownership checklist

- Source repository, hosting project, domains/DNS account, and analytics
  property are client-owned.
- Contact-form provider sending identity, recipients, and account access are
  client-owned or explicitly transferred.
- Required environment values are entered directly into the client hosting
  account by an authorized owner.
- No private registry, workspace link, local filesystem dependency, private Git
  dependency, agency credential, unrelated client identifier, factory source,
  cache, or build output exists.
- The client has the generated README, checklist, manifest, digest, and recovery
  runbooks.

## Failure handling

Do not partially repair a failed export in place. Preserve the normalized issue
codes, correct the portable input artifact at its owning boundary, and create a
fresh export into another empty directory. Never paste a credential or raw
provider response into an issue, log, manifest, or support message.
