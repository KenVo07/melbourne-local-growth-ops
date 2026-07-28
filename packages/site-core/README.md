# `@melbourne-local-growth-ops/site-core`

`site-core` validates one client website configuration, resolves an exact
template version, and produces a framework-neutral `WebsiteComposition`. It
does not render React, choose deployment infrastructure, or maintain shared
client state.

## Public composition APIs

### `composeWebsite(input, template)`

This is the low-level seam for callers that already hold a `WebsiteTemplate`.
It:

1. delegates unknown input to the TSK-45 website configuration validator;
2. returns the shared `ValidationResult` unchanged when validation fails;
3. calls `template.compose` only with `ValidatedWebsiteConfiguration`;
4. verifies that composition template ID and version match the template.

Exceptions thrown by `template.compose` propagate unchanged. A provenance
mismatch throws `WebsiteTemplatePipelineError` with code
`TEMPLATE_PROVENANCE_MISMATCH`.

### `createWebsiteTemplateRegistry(templates)`

Creates an immutable `WebsiteTemplateRegistry`. Registrations are ordered
deterministically by template ID and then version, independent of input order.
Template IDs and versions are opaque, case-sensitive strings.

Resolution always requires an exact `WebsiteTemplateReference`:

```ts
const reference = {
  templateId: "contractor",
  templateVersion: "2.0.0",
} as const;
```

There is deliberately no implicit latest-version or semantic-version fallback.
Callers must record and request the intended version explicitly.

### `composeWebsiteFromRegistry(input, reference, registry)`

Resolves the exact reference and then delegates to `composeWebsite`, preserving
the existing validation and provenance boundary:

```ts
import {
  composeWebsiteFromRegistry,
  createWebsiteTemplateRegistry,
} from "@melbourne-local-growth-ops/site-core";

const registry = createWebsiteTemplateRegistry([
  contractorTemplateV1,
  contractorTemplateV2,
]);

const result = composeWebsiteFromRegistry(
  unknownClientConfiguration,
  {
    templateId: "contractor",
    templateVersion: "2.0.0",
  },
  registry,
);
```

Template resolution happens before configuration validation. Resolution and
registration failures throw `WebsiteTemplatePipelineError`; configuration
failures return `ValidationResult`.

## Pipeline errors

| Code | Meaning |
| --- | --- |
| `DUPLICATE_TEMPLATE_REGISTRATION` | The same exact ID/version pair was registered more than once. |
| `UNKNOWN_TEMPLATE` | No template exists for the requested case-sensitive ID. |
| `UNSUPPORTED_TEMPLATE_VERSION` | The ID exists, but the requested exact version does not. |
| `TEMPLATE_PROVENANCE_MISMATCH` | The composition reported an ID or version different from its template. |

`UNSUPPORTED_TEMPLATE_VERSION` includes the deterministically ordered
`availableVersions`. Errors never fall back to another template or version.

## Isolation and concurrency

The registry is read-only after construction and contains template definitions,
not client configuration. Each composition receives only the validated
configuration supplied for that call, so a registry can be reused concurrently
without becoming a shared public website runtime. Template implementations must
also remain stateless and must not retain client configuration between calls.
