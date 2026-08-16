# Current architecture

## Architecture summary

One private, configuration-driven Website Factory produces one isolated website
deployment per client. Managed sites run in separate agency-operated Vercel
projects. Handoff sites are transferred as self-contained client-specific source
and deployments in client-owned accounts.

There is no shared public multi-tenant website runtime.

## Initial stack

- Next.js, React, and TypeScript
- Shared component library and design tokens
- Vercel Pro, initially one project per client
- GitHub for the private factory and client-specific handoff repositories
- Client-owned Google Analytics 4 properties
- Resend for transactional lead notifications
- Vercel logs and structured application logging
- Optional Sentry where managed monitoring scope justifies it
- Vercel environment variables for runtime secrets

Vendors are initial choices, not permanent domain boundaries. Hosting, email,
analytics, storage, and monitoring must remain replaceable behind explicit
interfaces.

## Current component seams

| Area | Responsibility |
|---|---|
| `apps/managed-web` | Isolated managed-site runtime, renderer, canonical client input, and portable source-artifact assembly |
| `apps/ops-console` | Internal client/configuration surface; not a required public-site runtime |
| `packages/site-core` | Validated semantic profiles, bounded website experience, conditional search resolution, registries, and composition |
| `packages/templates` | Contractor, restaurant, and retailer semantic compositions |
| `packages/website-modules` | Transferable website modules including the contact form |
| `packages/integrations` | External-system contracts and the Resend adapter |
| `packages/contracts` | Versioned schemas, events, entitlements, delivery profiles, and validation |
| `packages/asset-pipeline` | Client-scoped public asset validation and manifests |
| `packages/deployment` | Deployment and handoff contracts |
| `packages/observability` | Bounded operational event contracts |

## Target architecture — WEB-01B v2 (in progress, not yet as-built)

> **Status.** Everything from here to the end of "Client source artifacts" is the
> approved *target* architecture for WEB-01B v2. It is being implemented on
> `feature/web-01b-premium-experience` and is **not** current as-built behavior.
>
> As built today: `apps/managed-web` renders exactly one root route through
> `ManagedWebsiteShell`; the generator accepts only `schemaVersion: 1`; there is
> no authored client experience runtime, source-policy scanner, Page Graph
> routing or Platform component surface; Foundation Search projects only legacy
> profile-section records at `/#section` anchors; and artifacts copy only the
> finite renderer/search source. Those legacy behaviors are described below as
> the `schemaVersion: 1` adapter and remain current. Every v2 addition described
> alongside them is pending.
>
> Remove this banner only when the described behavior is implemented, tested and
> merged. Track progress in `WEB01B_V2_IMPLEMENTATION_STATE.md`.

### Client website layers

A client website is produced from five explicit layers. See
[ADR-0006](../decisions/ADR-0006-client-experience-layer.md).

1. **Platform Kernel** — reusable invisible quality: App Router mechanics and
   static route generation, route resolution and not-found behavior, semantic
   document infrastructure, navigation/link/focus mechanics, metadata, canonical
   URL and structured-data machinery, asset/font handling, forms and modules,
   analytics, performance instrumentation, reduced-motion foundations,
   generation, isolation, deployment and handoff. The Kernel does not own the
   client's route set, page narrative, visual shell, motion choreography or
   every Signature.
2. **Client Semantic Model + Page Graph** — validated client data: Profile
   Semantics, the route graph (page IDs, paths, kinds, metadata inputs, content
   references, anchors, relationships, navigation labels and destinations), the
   Project/Case Study collection and client-owned media references.
3. **Composition and Interaction Primitives** — a small, design-neutral
   vocabulary: `PlatformLink`, `PlatformImage` and `PlatformRegion`. Primitives
   provide mechanics, not predesigned pages.
4. **Client Experience Layer** — trusted authored React/TypeScript/CSS under the
   fixed `experience/` source root, implementing route composition, client-local
   Signatures, motion choreography and responsive art direction.
5. **Standalone Client Website** — one isolated portable artifact.

### Definition versioning and rendering modes

Client definitions carry an explicit top-level `schemaVersion`.

- `schemaVersion: 1` is the legacy one-page definition. It composes one validated
  semantic Profile Pack with one optional, finite `WebsiteExperience` and renders
  through the shared `ManagedWebsiteShell`. Experience owns visible Design DNA
  such as hero structure, section permutation, typography, palette, surface/media
  treatment and bounded interaction style; it cannot inject arbitrary HTML, CSS,
  classes or scripts. Omitted experience remains on the profile-specific legacy
  fallback. One server-rendered Signature slot consumes validated public profile
  content and adds no shared browser runtime. This path is a supported adapter,
  not the premium ceiling.
- `schemaVersion: 2` selects the authored model and requires a validated Page
  Graph, Project collection and a reference to the trusted authored Client
  Experience manifest. Routes render through the authored registry. A partial or
  malformed v2 definition fails; it never silently falls back to the legacy
  shell. An unknown `schemaVersion` fails closed.

Both paths share the Kernel, modules, forms, assets, metadata helpers, Search
machinery and artifact pipeline. They are not two applications.

### Trusted authored client source

Client configuration remains validated non-executable data. Real client source is
accepted only under the fixed `experience/` root with a fixed
`experience/manifest.json` and `experience/index.tsx` entrypoint. Before any copy
or build it is inspected for symlinks and path escape, restricted to a fixed
import allowlist, and screened against a fixed deny-list of execution, server,
network, persistence and markup-injection primitives. Inspected files are hashed
and inventoried into the artifact descriptor.

The authoritative import allowlist and deny-list is the "Client Experience Layer"
section of
[Premium Website Platform & Experience Standard](../product/premium-website-experience-standard.md).
That document is the single source of truth; do not restate a shorter list here,
because a partial copy under-specifies the sandbox.

Declared dependencies must be exact versions already approved in
[the OSS adoption register](../governance/oss-adoption-register.md). An
experience may not introduce a package that has no register entry.

Client route code receives only a sanitized public projection of the validated
snapshot. Secret reference IDs, runtime secret bindings, recipient addresses, raw
connectors and entitlement/commercial state are excluded.

Client-local Signatures live in the client's own source and require no shared
Core registry change. Design DNA is a concise creative grammar and provenance
artifact, not the complete frontend.

### Motion posture

The Kernel ships no animation library. Reduced-motion handling, lifecycle
cleanup conventions and performance instrumentation are shared; choreography is
authored per client. Simple interactions use CSS/WAAPI. A motion library may be
adopted at an exact governance-approved version and scoped to the authored
experience that declares it. Legacy, static and no-motion artifacts carry none of
its runtime, chunk or dependency cost.

### Foundation Search

Foundation Search resolves independently as `OFF | AUTO | ON`, with omitted
legacy configuration defaulting to OFF. Enabled legacy builds project validated
public profile sections into one client-local Pagefind custom-record index at
section anchors. Enabled v2 builds project validated Page Graph pages, services
and Projects into records whose URLs are real routes or route+anchor targets.
Disabled builds delete stale `public/pagefind` output before Next builds and
render no search markup or browser import. Search does not replace normal
navigation or become necessary for a first-time task, and does not repair weak
information architecture.

### Client source artifacts

Client source artifacts serialize the resolved experience, page graph, projects
and search state, copy the finite renderer/search/routing source, copy the
inspected authored client experience source, pin exact public dependencies
declared by the experience manifest and generate a standalone lockfile. The
sanctioned `@proportion/client-experience` alias is mapped through portable
TypeScript `paths` so authored source bytes and hashes are preserved rather than
rewritten. Descriptors record the Factory revision, page graph and project
identities, experience ID/version, per-file source hashes, the exact public
dependency set and the generated route inventory. Enabled artifacts inventory
their client-local Pagefind output; disabled artifacts reject stale output. Clean
artifact verification runs outside the private workspace boundary and must not
require private Factory repositories, registries or credentials.

## Default infrastructure posture

A standard brochure, lead-generation, booking-link, or external-system website
must work without:

- A database
- Authentication
- Object storage
- Background jobs

Add Supabase or equivalent persistence only for purchased features requiring
state. Add authentication only for purchased login or dashboard features. Add
object storage only for required file workflows. Add a job system only for
retries, schedules, or reconciliation that cannot be handled safely otherwise.

Optional infrastructure remains isolated to the client deployment and its data
boundary.

## Configuration and versions

Each website deployment has one trusted client configuration and separate
runtime secrets. Record, at minimum:

- Application, template, package, configuration, and deployment versions
- Domain and infrastructure ownership
- Enabled capabilities and modules
- Last successful deployment
- Handoff status and transferred operational responsibility

Commercial terms may be linked through stable identifiers but are not runtime
configuration. See [Architecture boundaries](boundaries.md).

## Integration posture

Use the least invasive reliable method:

1. Deep link
2. Official embed or widget
3. Vendor SDK
4. OAuth or official API
5. Webhook plus API synchronization
6. Scheduled import/export
7. Permitted, economical, human-supervised browser assistance
8. Separately priced replacement-system decision

Client booking, CRM, POS, calendar, accounting, and commerce systems remain
authoritative unless explicitly contracted otherwise.

## Sources

- [Canonical technical plan](https://app.notion.com/p/3a88d3550dc381fbaaf4e70ba4abebd0)
- [TSK-44 — initial stack](https://app.notion.com/p/3a88d3550dc381efb3cfd94bc12cf2ac)
- [TSK-47 — integration decision tree](https://app.notion.com/p/3a88d3550dc3816ab46ec4441be26ecb)
- [M1 success criteria](https://app.notion.com/p/3a88d3550dc381839283d043270dada6)
