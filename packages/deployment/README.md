# Deployment package

`@melbourne-local-growth-ops/deployment` owns the package-level boundary between
validated deployment intent and observed deployment state. It does not perform
DNS changes, read credentials, or include a live Vercel client.

## State model

1. `createDeploymentIntent` produces a deterministic, provider-unverified plan
   from validated website runtime configuration, a validated operational
   deployment record, and caller-provided requested provenance.
2. `executeDeployment` sends a secret-free provider request through a
   `DeploymentProvider`.
3. The executor validates the provider response at runtime. Provider failures,
   thrown errors, and malformed responses fail closed with normalized errors.
4. A `DeploymentManifest` is created only after a valid successful provider
   observation. Its build provenance is observed state, not a requested
   placeholder.

`projectIdentity` is deterministic for the client/deployment pair. It is an
internal isolation key, not proof that a project name is globally available at
Vercel or another provider.

## Provider boundary

Adapters implement `DeploymentProvider` and receive a
`DeploymentProviderRequest` containing client/configuration identity, domains,
requested provenance, attempt number, and an idempotency key. Requests contain
no credential or secret values.

Successful results must include:

- the adapter's provider name;
- the unchanged project identity and idempotency key;
- provider project, deployment, preview, and build identifiers;
- the requested source revision;
- an observed ISO timestamp.

The executor rejects HTTP preview URLs, URLs with embedded credentials, blank
identifiers, mismatched identity/provenance, invalid timestamps, unknown error
codes, and incomplete response shapes. Unknown response fields are not copied
into logs or manifests.

## Retry and idempotency

The default retry bound is three attempts; callers may select one through five.
Only `RATE_LIMITED`, `TIMEOUT`, and `UNAVAILABLE` are retryable.
`REJECTED`, `IDEMPOTENCY_CONFLICT`, and malformed responses stop immediately.

The idempotency key is deterministic across execution-relevant intent state,
including client/project identity, configuration and delivery state, domains,
infrastructure ownership, handoff state, and requested provenance. Provider
adapters must preserve its semantics. An adapter may encode or hash the key to
meet provider length requirements, but must detect conflicting reuse.

## Logging and secrets

`DeploymentLogger` receives a closed event union containing attempt numbers,
normalized error codes, project identity, and adapter name. Provider error
messages, thrown exceptions, provider-returned identifiers, configuration
content, environment values, and credentials are never logged by this package.
Logger failures are isolated so they cannot turn a completed provider action
into a duplicate retry.

## Deterministic fake Vercel adapter

`DeterministicFakeVercelAdapter` is an in-memory test adapter. The caller
provides the observed timestamp, and all fake identifiers are derived
deterministically from request identity. It supports bounded failure injection,
idempotent repeated/concurrent execution, and conflict detection. It performs
no network, filesystem, DNS, Vercel API, or credential access.

## Verification

From the repository root with the pinned Node.js and pnpm versions:

```powershell
pnpm --filter @melbourne-local-growth-ops/deployment test
pnpm --filter @melbourne-local-growth-ops/deployment typecheck
pnpm --filter @melbourne-local-growth-ops/deployment build
pnpm check
```

No live deployment or domain mutation is part of these commands.
