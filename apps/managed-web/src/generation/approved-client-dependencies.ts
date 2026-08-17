import type { ApprovedClientExperienceDependency } from "./client-experience-dependencies";

/**
 * Public packages an authored client experience may ship, at exact versions.
 *
 * This is the repository's governance decision expressed as code. A manifest
 * may declare a dependency, but it only reaches a generated artifact when the
 * same name and the same exact version appear here. Adding an entry is a
 * governance act: record it in `docs/governance/oss-adoption-register.md` first,
 * with licence evidence, isolation obligations and an upgrade gate, then add it
 * here.
 *
 * The list is deliberately empty. No authored experience has yet demonstrated a
 * concrete need that native CSS and the Web Animations API cannot meet, and the
 * platform must not acquire a motion dependency speculatively — a site that does
 * not use one must pay none of its cost.
 */
export const approvedClientExperienceDependencies: readonly ApprovedClientExperienceDependency[] =
  Object.freeze([]);
