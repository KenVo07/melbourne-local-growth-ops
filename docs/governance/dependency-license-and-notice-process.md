# Dependency, licence, secret, and notice process

## Purpose and scope

This is the implementation baseline for the current private repository. It
applies to dependency changes, CI, internal package builds, client release
artifacts, and handoff artifacts. It is a technical control, not professional
legal advice or a client-specific licence conclusion.

The repository is private and the root package is `UNLICENSED`. `LICENSE.md`
grants no first-party rights. A restricted package configuration, private
repository access, client contract, and third-party licence are different
things; publishing or handing off first-party source still requires the
applicable written rights and ownership terms.

## Automated baseline

Use Node.js 24.18.0 and pnpm 11.9.0 from the repository pins.

| Control | Local command | Enforced behavior |
| --- | --- | --- |
| Frozen dependency graph | `pnpm install --frozen-lockfile` | Fails when manifests and `pnpm-lock.yaml` disagree. The workspace build-script allowlist remains authoritative. |
| Vulnerability threshold | `pnpm governance:audit` | Runs native `pnpm audit --audit-level high --json`. Any undeferred high or critical advisory, malformed response, registry failure, changed path/version, or expired deferral fails. |
| Threshold policy test | `pnpm governance:audit:self-test` | Demonstrates that moderate findings remain below the blocking threshold, unknown high findings block, exact deferrals pass only before review, and expiry blocks. |
| Repository secret snapshot | `pnpm governance:secrets` | Scans tracked and unignored working-tree files, rejects secret-bearing filenames and high-confidence private-key/provider-token formats, and reports only paths and rule names. |
| Licence inventory | `pnpm governance:notices` | Regenerates `NOTICE.md` from `pnpm licenses list --json`. New licence labels require explicit review before the generator accepts them. |
| Notice drift | `pnpm governance:licenses` | Fails if installed package names, versions, or declared licence labels differ from `NOTICE.md`. |

CI runs on pushes to `main` and the still-supported `integration/m1` branch and
on pull requests targeting either branch. Workflow permissions are read-only
(`contents: read`), existing actions are pinned to immutable commits, and the
governance checks run before the normal workspace gate. Dependabot opens bounded
weekly pnpm and GitHub Actions update pull requests against `main`; it does not
merge them.

## Current vulnerability disposition

Evidence date: 2026-08-03. Native audit reports one moderate and three high
advisories, all under the production Next.js dependency paths for the root,
`apps/managed-web`, and `apps/ops-console`.

| Advisory | Severity and path | Disposition |
| --- | --- | --- |
| `GHSA-qx2v-qp2m-jg93` | Moderate, `next > postcss@8.4.31` | Below the CI blocking threshold, but tracked with the PostCSS remediation. |
| `GHSA-6g55-p6wh-862q` | High, `next > postcss@8.4.31` | Explicitly deferred through 2026-08-17. |
| `GHSA-r28c-9q8g-f849` | High, `next > postcss@8.4.31` | Explicitly deferred through 2026-08-17. |
| `GHSA-f88m-g3jw-g9cj` | High, optional `next > sharp@0.34.5` | Explicitly deferred through 2026-08-17. |

These findings are not classified as harmless. PostCSS processes repository CSS
during the Next.js build, and the high advisories concern attacker-controlled
source-map references. Next 16.2.12 pins PostCSS 8.4.31 exactly; its current
release is also the latest release. pnpm 11.9.0 only supports dependency
overrides in the workspace settings file, which is outside this task's approved
paths. Forcing the transitive package in the lockfile is not permitted.

Sharp is reachable through the active `next/image` path. Next 16.2.12 declares
`sharp` as `^0.34.5`, while the patched line begins at 0.35.0. A forced 0.x
minor upgrade crosses Next's declared compatibility range and is not accepted
without upstream compatibility evidence and a successful image-path test.

The audit script accepts only the exact advisory IDs, modules, versions, and
three recorded Next.js paths above. New findings, path drift, version drift, or
the end of 2026-08-17 fail CI. Before that date, re-check Next releases and
advisories, adopt the smallest upstream-compatible patched release, regenerate
the lockfile with pnpm, inspect the lockfile diff, and run the complete gate.
If no safe upstream release exists, a new dated deferral requires security-owner
and business-owner approval with updated reachability evidence.

## Dependency adoption and update procedure

Before adding or changing a package:

1. Confirm the requirement cannot be met by the platform, current stack, or a
   smaller existing dependency. Avoid speculative infrastructure and preserve
   the accepted architecture and isolated client boundary.
2. Check the OSS adoption register. Candidate, gated, deferred, rejected,
   source-available, copyleft, hosted, or marketplace items need every recorded
   gate and human approval before adoption.
3. Record the exact package/version, source repository and registry provenance,
   maintenance state, release history, security policy, known advisories,
   install scripts, direct and transitive graph, runtime/build reachability,
   declared licence, included licence/notice files, and exit/handoff path.
4. Use pnpm to change manifests and regenerate the lockfile. Never hand-edit the
   lockfile and never use forced audit remediation. Review package changelogs
   and the complete manifest/lockfile diff.
5. Run the frozen install, audit, secret, notice, build, test, and typecheck
   gates. Regenerate `NOTICE.md`, then review the dependency and licence change
   rather than accepting generated output blindly.

Weekly Dependabot pull requests are triage inputs, not approvals. Keep upgrades
focused, read upstream release and migration notes, and let repository tests and
the release/handoff review decide whether the update is acceptable.

## Licence and notice boundary

`NOTICE.md` is a deterministic inventory of package-declared licence labels for
the installed Linux CI graph. A known label means only that inventory drift has
been acknowledged; it does not approve compatibility, distribution, hosted use,
or client terms. The generated inventory does not collect full licence text,
copyright lines, upstream NOTICE files, modification records, source offers, or
platform-specific optional packages.

For every package release, deployment artifact, or client handoff:

1. Build the exact target artifact from a clean frozen install on the target
   platform and regenerate the production dependency inventory.
2. Inspect the contents of each shipped package, including vendored assets,
   generated code, binaries, fonts, images, and optional native components.
3. Copy every required third-party licence, copyright notice, attribution,
   upstream NOTICE file, modification notice, and source/source-offer material
   into the delivered artifact in a durable, discoverable location.
4. Pay particular attention to Apache-2.0 NOTICE/modification requirements,
   LGPL components such as the current sharp/libvips binary path, MPL files,
   Creative Commons data, copyleft/source-available boundaries, and separately
   governed hosted or marketplace components. Escalate material uncertainty for
   package-specific legal review.
5. Record the artifact identifier, dependency/lockfile version, target platform,
   copied notice files, reviewer, review date, client owner, and tested rebuild,
   export, replacement, and handoff steps.

Client-specific generated sites can have a different graph from the private
factory. Their notice bundle must describe what that client artifact actually
contains and must not depend on private repository access.

## Secret-control scope and deferred repository settings

The local scanner covers the current tracked and unignored repository snapshot.
It deliberately does not print matched values, follow symlinks, read sensitive
filename types, scan Git history, detect every vendor format, or replace secret
rotation. It fails on symlinks because following one could escape the repository
boundary. If a real secret is found or was ever pushed, revoke and rotate it
before removing it from files or history.

Repository administrators should separately enable and verify GitHub secret
scanning and push protection, Dependabot alerts, required CI status checks,
pull-request review, and force-push protection on `main`. Those first-party
repository settings are intentionally not claimed by this file-based change:
they require repository-admin authority and external-state verification. A
one-time full-history scan is also deferred to that authorized setup so history
is covered without embedding another third-party scanner in this minimal CI.

## Review triggers

Repeat the relevant review on a dependency or action update, new licence label,
licence or maintainer change, advisory, install-script change, changed build or
distribution mode, new platform, new client artifact, failed notice check,
failed export/handoff test, or before an explicit deferral expires. CI success
does not replace those event-driven reviews.
