# Managed website runtime

This application renders one validated client website per build. It never
selects a tenant from a hostname, request header, database, or Ops Console
lookup.

## Client generation boundary

The private factory accepts an input directory containing:

```text
client-website.json
public/assets/**
```

`client-website.json` contains the existing website runtime configuration,
exact template/module versions, and portable asset references. Generation:

1. validates the configuration through site-core and the contracts package;
2. validates and manifests local assets through the asset-pipeline package;
3. resolves the exact contractor template and module contracts;
4. writes one canonical client snapshot;
5. assembles a standalone, public-dependency-only client source repository;
6. verifies frozen install, typecheck, tests, and production build in a
   temporary directory.

Run the complete assembly and verification boundary with pinned Node 24.18.0
and pnpm 11.9.0:

```powershell
pnpm assemble:client -- `
  --input D:\path\to\client-input `
  --output D:\path\to\empty-artifact-directory `
  --factory-revision <git-revision>
```

The output contains:

```text
client-artifact.json
source/
```

`source/` is the client-owned repository input. Build output is temporary and
is never added to the artifact.

## Codex B handoff compatibility

The integrated deployment package exposes these package-root APIs:

```ts
import {
  createClientHandoffExport,
  writeClientHandoffDirectory,
  verifyClientHandoffDirectory,
  type ClientHandoffExportInput,
} from "@melbourne-local-growth-ops/deployment";
```

`client-artifact.json` records the exact source inventory and the fields needed
to construct `ClientHandoffExportInput`: artifact paths/categories/provenance,
module and connector portability selections, public dependencies, client-owned
environment-variable declarations, and the empty optional-data declaration.
After a successful observed deployment, Codex B supplies that
`DeploymentManifest` and the explicit source file contents. Its API generates
the authoritative `handoff-manifest.json`, digest, checklist, documentation,
and verifier.

The emitted source contains no workspace, local-file, Git, private-registry, or
private Website Factory dependency.

## Contact form

The `LEAD_FORM` renderer sends JSON to `POST /api/contact`. The route resolves
only the generated site's configured module and calls package-root
`ContactFormService`, `ResendLeadDeliveryAdapter`, and Resend transport APIs.
It does not duplicate validation, spam, rate-limit, idempotency, message
mapping, or delivery behavior.

Resend secrets use generated client-owned environment bindings such as
`MLGO_RESEND_API_KEY_01`. Secret values never enter source, HTML, responses,
analytics, or logs.

## Analytics

GA4 loads only for a validated `GOOGLE_ANALYTICS_4` connector marked
`CLIENT`/`CLIENT_OWNED`. Omitting the `ANALYTICS` module disables scripts and
makes event calls no-ops.

The runtime emits:

- `page_view`, with query and fragment removed from page location;
- `booking_cta_clicked`;
- `generate_lead`, only after confirmed delivery.

No form value, address, submission identifier, or connector detail is included
in analytics.

## Verification

```powershell
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
```
