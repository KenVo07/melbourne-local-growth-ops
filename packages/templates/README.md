# `@melbourne-local-growth-ops/templates`

Framework-neutral website compositions for the private Website Factory.
Templates consume only `ValidatedWebsiteConfiguration` and return
`WebsiteComposition`; they do not import React, Next.js, deployment tooling, or
client secrets.

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
