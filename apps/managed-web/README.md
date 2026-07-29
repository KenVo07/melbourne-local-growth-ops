# Managed website

The managed website is the isolated public rendering shell produced for one
client deployment. It is not a shared public multi-tenant runtime.

## Client-definition seam

`src/site-definition.ts` contains exactly one deployment-safe
`ManagedWebsiteDefinition` and the module contract versions bundled for that
deployment. A client-specific build replaces this file; the public application
does not select a client from hostname, request headers, a database, or the ops
console.

The definition contains:

- unknown configuration validated at the site-core boundary;
- an exact template ID/version;
- an exact module version for each configured module type;
- a client-scoped local asset source rooted in this deployment's `public`
  directory;
- no secrets or commercial contract state.

## Rendering path

`src/app/page.tsx` is a synchronous Next.js Server Component. It:

1. validates and composes the single client definition;
2. resolves the exact contractor template and module contracts;
3. passes the immutable managed composition to `ManagedWebsiteShell`;
4. renders resolved local images through Next.js `Image`;
5. renders regions and modules in template order.

React and Next.js remain inside this application. `site-core` and `templates`
are framework-neutral.

## Renderer seam and fallbacks

Renderers register one exact module type/version pair. Duplicate registrations
fail with `ManagedWebsiteRenderError`.

When a concrete renderer is absent, the module contract controls behavior:

- `HIDE` renders no visible output;
- `STATIC` renders the contract fallback description;
- `ERROR` throws typed `MISSING_MODULE_RENDERER`.

The current shell includes a booking-link CTA renderer and a non-visual
analytics fallback. It deliberately does not copy or recreate the independently
owned contact-form implementation.

## Isolation and portability

- One trusted definition per build and deployment
- No database, authentication, object storage, or background jobs
- No dependency on the ops console at runtime
- No client lookup or shared client state
- Client-owned booking and analytics connectors
- Static assets and source remain inside the deployment

The current hero lives at `public/assets/hero/primary.png` and is published as
`/assets/hero/primary.png`. Next.js handles responsive local-image rendering
from validated intrinsic metadata. Remote URLs, SVG, GIF, raw image markup,
byte-level probing, and build-time transcoding are outside this capability.

## Commands

The feature branch intentionally does not update the root lockfile. After the
integration owner regenerates it from the owned package manifests:

```powershell
pnpm install --frozen-lockfile
pnpm --filter @melbourne-local-growth-ops/managed-web test
pnpm --filter @melbourne-local-growth-ops/managed-web typecheck
pnpm --filter @melbourne-local-growth-ops/managed-web build
```
