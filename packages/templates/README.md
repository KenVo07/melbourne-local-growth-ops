# `@melbourne-local-growth-ops/templates`

Framework-neutral website compositions for the private Website Factory.
Templates consume `ValidatedWebsiteConfiguration` plus an optional
framework-neutral asset-selection context and return `WebsiteComposition`.
They do not import React, Next.js, deployment tooling, or client secrets.

## Contractor template v1

```ts
import { contractorTemplateV1 } from
  "@melbourne-local-growth-ops/templates";
```

Stable identity:

```text
templateId: contractor
version:    1.0.0
```

The template emits two regions in fixed order:

1. `primary` — booking CTAs followed by lead forms;
2. `analytics` — non-visual analytics modules.

Module IDs are sorted within each module type. The same validated configuration
therefore produces the same placement regardless of registry insertion order,
and calls do not retain client configuration.

The template only describes placement. Concrete module rendering and server
handlers remain outside this package.

When an asset context is present, contractor v1 also selects the optional
`hero-primary` image for the `hero` slot. The template owns its usage metadata:
meaningful client-specific alternative text, responsive `sizes`, preload
priority, and optional-selection behavior. Intrinsic width, height, media type,
source path, and public path remain in the asset manifest.

If the asset is absent, the template omits the slot and otherwise produces the
same composition as an asset-free definition.
