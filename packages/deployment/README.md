# Deployment package

`@melbourne-local-growth-ops/deployment` owns the boundary from validated
deployment intent to validated observed deployment state. The package can plan,
apply, inspect, and roll back an isolated Vercel deployment. It never changes
external DNS and never reads credentials.

## Lifecycle

```text
DeploymentIntent
  -> deterministic VercelDeploymentPlan
  -> explicit apply
  -> isolated project reconciliation
  -> deployment observation
  -> domain attachment and inspection
  -> DeploymentManifest
  -> validated rollback target
```

`DeploymentIntent` contains requested provenance. A `DeploymentManifest` is
created only after Vercel reports a `READY` deployment and every configured
domain is observed as attached and verified. Its build provenance is observed
state, never a requested placeholder.

`projectIdentity` and the derived project name are deterministic for a
client/deployment pair. They isolate two clients inside this lifecycle, but do
not claim global Vercel-name uniqueness before provider reconciliation.

## Planning and applying

The production adapter uses an injected HTTP transport. Authentication is the
transport's responsibility; the adapter accepts no token and sends no
authorization header in its typed request objects.

```ts
import {
  VercelDeploymentAdapter,
  type VercelHttpTransport,
} from "@melbourne-local-growth-ops/deployment";

declare const transport: VercelHttpTransport; // supplied by the host
declare const intent: DeploymentIntent;

const lifecycle = new VercelDeploymentAdapter({
  transport,
  teamId: "team-owned-by-the-agency",
  gitSource: {
    type: "github",
    org: "agency",
    repo: "managed-web",
    ref: "main",
  },
});

const plan = lifecycle.plan(intent); // pure: no transport calls
if (plan.externalDnsMutation !== false) {
  throw new Error("Unexpected plan");
}

const applied = await lifecycle.apply(intent, { maxAttempts: 3 });
if (!applied.success) {
  // Handle only the normalized code/message. No raw provider payload escapes.
  throw new Error(applied.error.code);
}

const manifest = applied.manifest;
const observed = applied.providerObservation;
```

The plan lists intended reads and writes, including conditional project/domain
creation. Only `apply` crosses the mutation boundary. The adapter maps provider
JSON inside the adapter and validates all project, deployment, domain, and
rollback responses before returning typed state.

## Inspection and rollback

```ts
const inspection = await lifecycle.inspect(intent, observed);
if (
  inspection.success &&
  inspection.state.domains.every((domain) => domain.status === "ATTACHED")
) {
  const rollback = await lifecycle.rollback(intent, observed, {
    maxAttempts: 3,
  });
  if (!rollback.success) {
    throw new Error(rollback.error.code);
  }
}
```

A rollback target must be a previous valid `VERCEL` observation for the exact
intent identity, source revision, idempotency key, project, deployment, and
domain set. The adapter validates the target before requesting rollback and
inspects it again afterward.

See the [domain setup runbook](../../docs/runbooks/vercel-domain-setup.md) and
[rollback runbook](../../docs/runbooks/vercel-deployment-rollback.md).

## Command boundaries

The injectable boundaries in `scripts/deployment/` keep runtime wiring outside
the package:

- `plan.mjs` produces the dry-run plan and has no side effects.
- `apply.mjs` is the explicit provider-mutation boundary.
- `inspect.mjs` performs provider reads only.
- `rollback.mjs` validates and requests rollback.

Hosts inject a configured lifecycle and a writer. A thrown host/transport error
is replaced by the stable `COMMAND_FAILED` result; its original message is not
written.

## Retry, idempotency, and concurrency

Apply retries are bounded from one through five. Rate limits, timeouts, and
provider unavailability are retryable; provider rejection, conflicts, malformed
responses, and unresolved domains fail closed. A deterministic idempotency key
covers execution-relevant intent state. Successful and in-flight operations are
deduplicated so repeated/concurrent calls do not create duplicate deployments.

Rollback has the same bounded transient retry policy and deduplicates
repeated/concurrent requests for the same validated project/deployment target.

## Logging and secrets

`DeploymentLogger` and `VercelLifecycleLogger` expose closed event unions. Events
contain operation status, attempt number, normalized codes, project identity,
and domain hostname where applicable. They never contain raw HTTP bodies,
headers, repository payloads, environment values, credentials, or provider
error messages. Logger failures cannot change lifecycle behavior.

`DeterministicFakeVercelAdapter` remains available for provider-neutral tests.
It performs no network, filesystem, DNS, Vercel API, or credential access.

## Verification

From the repository root with the pinned Node.js and pnpm versions:

```powershell
pnpm --filter @melbourne-local-growth-ops/deployment test
pnpm --filter @melbourne-local-growth-ops/deployment typecheck
pnpm --filter @melbourne-local-growth-ops/deployment build
pnpm check
```

These commands use deterministic fixtures and make no live provider or DNS
request.

## Client handoff and recovery

The handoff API accepts a validated client configuration, an observed
`DeploymentManifest`, and an exact allowlist of already portable artifacts.
Callers must transform or vendor reusable runtime code before it crosses this
boundary. The toolkit never copies the Website Factory workspace or discovers
files implicitly.

```ts
import {
  createClientHandoffExport,
  verifyClientHandoffDirectory,
  writeClientHandoffDirectory,
  type ClientHandoffExportInput,
} from "@melbourne-local-growth-ops/deployment";

declare const input: ClientHandoffExportInput;

const planned = createClientHandoffExport(input); // pure and deterministic
if (!planned.success) {
  throw new Error(planned.issues[0]?.code);
}

// Explicit apply boundary: destination must be empty; files are never replaced.
const written = await writeClientHandoffDirectory(
  planned.export,
  "C:/client-owned-repository",
);
if (!written.success) {
  throw new Error(written.issues[0]?.code);
}

const transferred = await verifyClientHandoffDirectory(written.directory);
if (!transferred.success) {
  throw new Error(transferred.issues[0]?.code);
}
```

The exported repository contains the supplied source/assets/package metadata
plus a generated `README.md`, `.env.example`, `HANDOFF-CHECKLIST.md`,
`handoff-manifest.json`, its SHA-256 digest, and a self-contained integrity
verifier. The manifest records only environment variable names and purposes,
never values.

Artifacts fail closed when they contain unsafe paths, factory/internal paths,
another client identifier, credential-shaped material, private registries,
workspace/local/Git dependency references, undocumented environment variables,
or unsupported agency-managed modules/connectors. Package dependencies must be
present in the caller's explicit public-dependency allowlist.

The command boundaries in `scripts/handoff/` are:

- `plan.mjs`: pure export planning and scan summary.
- `export.mjs`: explicit write to an empty destination.
- `verify.mjs`: exact transfer verification followed by a clean-directory
  frozen install, typecheck, production build, tests, and integrity check. It
  removes ambient credential-bearing environment variables.
- `recovery.mjs`: recovery preflight only; it performs no provider, DNS, or data
  mutation.

See the [client source handoff runbook](../../docs/runbooks/client-source-handoff.md),
[recovery and ownership-transfer runbook](../../docs/runbooks/client-recovery-and-transfer.md),
and [optional-data backup/restore runbook](../../docs/runbooks/optional-data-backup-restore.md).
