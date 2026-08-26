# One-off verification scripts

Two passes that produce **evidence for a review**, not gates every delivery has
to clear. They live here rather than in a test suite on purpose: the Platform
owns no browser automation, and adopting one is out of scope by the post-Stone
[disposition](../../../docs/delivery/disposition.md). Nothing in `pnpm check`
runs them.

Both were written for Tradies Profile V1, and both found real defects that
DOM-level assertions had passed over.

## `browser-verify.mjs`

Drives a built client site in Chromium at 1440 and 390 and checks sixteen claims
about the archive, the navigation panel, reduced motion, touch depth and the
accessibility tree. Writes screenshots and a `results.json`.

```bash
node scripts/tradies/verification/browser-verify.mjs \
  <path-to-built-artifact>/source 3099 <output-directory>
```

The site must already be built (`pnpm build` inside the artifact source), because
it runs `next start` against it.

**What it found:** archive rows pulling route payloads on every facet change, a
grouped navigation panel truncated mid-group, an archive heading printing a count
that filtering made wrong, and a doubled rule in the compact menu.

## `deploy-handoff-verify.mts`

Takes a Tradies delivery workspace and runs its composed configuration through
the deployment and handoff contracts with the deterministic fake provider.
**Contacts nothing and needs no credential.**

```bash
npx tsx scripts/tradies/verification/deploy-handoff-verify.mts \
  <workspace> "$(git rev-parse HEAD)"
```

Checks that the configuration passes the shared runtime validator, that a
deployment intent builds from it, that execution is idempotent, that delivery
mode stays `MANAGED_ISOLATED` until handoff completes, and that secrets travel as
references rather than values.
