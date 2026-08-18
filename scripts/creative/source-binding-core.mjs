/**
 * Binds a client's *current* authored source to the P1 artifact that was
 * assembled from it.
 *
 * The whole premium bridge rests on one question: is the source a creative
 * environment is looking at, and the source a production agent is about to
 * change, the same source the Factory actually shipped? Everything else —
 * workspaces, launch packs, reports — is bookkeeping around the answer.
 *
 * This module is the pure half of that answer: given a descriptor and a current
 * inspection, it says match or does not match, and names the files. It reads no
 * filesystem and runs no validator. `source-binding.ts` is the impure half that
 * obtains both sides by running the Factory's own parsers, generator, source
 * policy and handoff verifier, so this file never has to trust JSON a caller
 * handed it.
 *
 * Refusal over repair, throughout. Nothing here regenerates, patches or brings
 * forward a stale input; a mismatch is reported and the operator assembles a
 * new artifact. That is the anti-stale guarantee, and softening it anywhere
 * would let a design session or a production agent work against source that no
 * longer exists.
 */
import {
  canonicalJson,
  compareText,
  isSha256,
  refuse,
  sha256,
} from "./premium-contracts.mjs";

const SOURCE_KINDS = new Set(["SOURCE", "STYLE", "DATA", "MANIFEST"]);

/**
 * Canonicalises a source inventory: exactly the five fields the Factory's
 * descriptor records, sorted by path in codepoint order, with duplicates
 * refused.
 *
 * Sorting and field selection happen here rather than at the call site because
 * `sourceSetId` is a hash of the result. A caller that passed the same files in
 * a different order, or carried one extra field, would otherwise mint a
 * different identity for identical source — which is exactly how a stale-source
 * check gets bypassed by accident.
 */
export function normalizeSourceEntries(entries, label = "source") {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw refuse("SOURCE_EMPTY", `${label} must contain at least one file.`, {
      label,
    });
  }
  const seen = new Set();
  const normalized = entries.map((entry, index) => {
    const at = `${label}[${index}]`;
    if (entry === null || typeof entry !== "object") {
      throw refuse("SOURCE_ENTRY_INVALID", `${at} must be an object.`, { at });
    }
    const path = assertSourcePath(entry.path, at);
    if (seen.has(path)) {
      throw refuse("SOURCE_DUPLICATE", `${at} repeats the path ${path}.`, {
        at,
        path,
      });
    }
    seen.add(path);
    if (!isSha256(entry.sha256)) {
      throw refuse("HASH_INVALID", `${at} (${path}) has no valid SHA-256.`, {
        at,
        path,
        sha256: entry.sha256,
      });
    }
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      throw refuse("SOURCE_ENTRY_INVALID", `${at} (${path}) has an invalid size.`, {
        at,
        path,
        size: entry.size,
      });
    }
    if (!SOURCE_KINDS.has(entry.kind)) {
      throw refuse(
        "SOURCE_ENTRY_INVALID",
        `${at} (${path}) has kind "${String(entry.kind)}"; the source policy emits SOURCE, STYLE, DATA or MANIFEST.`,
        { at, path, kind: entry.kind },
      );
    }
    if (typeof entry.clientRuntime !== "boolean") {
      throw refuse(
        "SOURCE_ENTRY_INVALID",
        `${at} (${path}) does not declare clientRuntime as a boolean.`,
        { at, path },
      );
    }
    return Object.freeze({
      path,
      sha256: entry.sha256,
      size: entry.size,
      kind: entry.kind,
      clientRuntime: entry.clientRuntime,
    });
  });
  return Object.freeze(
    normalized.sort((left, right) => compareText(left.path, right.path)),
  );
}

/**
 * Source paths are relative to the fixed `experience/` root and nothing else.
 *
 * The Factory's source policy already refuses symlinks and path escape on disk.
 * This refuses the same shapes in a *manifest*, which is the form they take
 * once a path has left the filesystem and is being carried between machines.
 */
function assertSourcePath(path, at) {
  if (typeof path !== "string" || path === "") {
    throw refuse("PATH_INVALID", `${at} has no path.`, { at });
  }
  if (path.includes("\\")) {
    throw refuse("PATH_INVALID", `${at} uses backslashes: ${path}`, { at, path });
  }
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw refuse("PATH_INVALID", `${at} is absolute: ${path}`, { at, path });
  }
  const segments = path.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw refuse("PATH_ESCAPE", `${at} escapes the experience root: ${path}`, {
      at,
      path,
    });
  }
  return path;
}

/**
 * The identity of a set of source files.
 *
 * Derived from the canonical inventory rather than from a directory listing, so
 * two machines that check out the same commit compute the same value, and a
 * file added, removed, resized or edited changes it.
 */
export function sourceSetId(entries, label = "source") {
  return sha256(canonicalJson(normalizeSourceEntries(entries, label)));
}

/**
 * Names the difference between two source inventories rather than reporting a
 * boolean, because "the source is stale" is not an actionable message and
 * "experience/routes/HomeRoute.tsx changed" is.
 */
export function compareSourceSets(expectedEntries, actualEntries) {
  const expected = new Map(
    normalizeSourceEntries(expectedEntries, "expected source").map((entry) => [
      entry.path,
      entry,
    ]),
  );
  const actual = new Map(
    normalizeSourceEntries(actualEntries, "current source").map((entry) => [
      entry.path,
      entry,
    ]),
  );
  const missing = [];
  const changed = [];
  const unexpected = [];
  for (const [path, entry] of expected) {
    const candidate = actual.get(path);
    if (candidate === undefined) missing.push(path);
    else if (canonicalJson(entry) !== canonicalJson(candidate)) changed.push(path);
  }
  for (const path of actual.keys()) {
    if (!expected.has(path)) unexpected.push(path);
  }
  return Object.freeze({
    equal: missing.length === 0 && changed.length === 0 && unexpected.length === 0,
    missing: Object.freeze(missing.sort(compareText)),
    changed: Object.freeze(changed.sort(compareText)),
    unexpected: Object.freeze(unexpected.sort(compareText)),
  });
}

/** Reads as a sentence in a refusal message. */
export function describeSourceDifference(comparison) {
  const parts = [];
  if (comparison.missing.length > 0) {
    parts.push(`missing from the live input: ${comparison.missing.join(", ")}`);
  }
  if (comparison.changed.length > 0) {
    parts.push(`changed since assembly: ${comparison.changed.join(", ")}`);
  }
  if (comparison.unexpected.length > 0) {
    parts.push(`present but not in the artifact: ${comparison.unexpected.join(", ")}`);
  }
  return parts.join("; ");
}

/**
 * The identity fields that must agree between an artifact descriptor and the
 * live client input before either is usable for premium work.
 *
 * Deployment and configuration version are included deliberately. Two artifacts
 * of the same client at different configuration versions describe different
 * sites, and pairing one with the other's input is the quiet version of the
 * foreign-client attack.
 */
const IDENTITY_FIELDS = Object.freeze([
  ["clientId", (artifact) => artifact.clientId],
  ["configurationId", (artifact) => artifact.configuration?.configurationId],
  ["configurationVersion", (artifact) => artifact.configuration?.configurationVersion],
  ["deploymentId", (artifact) => artifact.configuration?.deploymentId],
  ["experienceId", (artifact) => artifact.clientExperience?.experienceId],
  ["experienceVersion", (artifact) => artifact.clientExperience?.experienceVersion],
  ["entrypoint", (artifact) => artifact.clientExperience?.entrypoint],
  ["designDnaPath", (artifact) => artifact.clientExperience?.designDnaPath],
]);

/**
 * Proves that an artifact descriptor, the live client input and (optionally) a
 * prepared workspace all describe one production substrate.
 *
 * `current` is the result of running the Factory's own validators over the live
 * input; this function compares, it does not inspect. `expectedWorkspace`, when
 * supplied, adds the launch-time checks: same artifact, same source set, same
 * business truth, same generated snapshot.
 */
export function assertExactSourceBinding({ artifact, current, expectedWorkspace }) {
  if (artifact === null || typeof artifact !== "object") {
    throw refuse("ARTIFACT_KIND", "The artifact descriptor is not an object.");
  }
  if (artifact.kind !== "MANAGED_WEBSITE_SOURCE") {
    throw refuse(
      "ARTIFACT_KIND",
      `Expected a MANAGED_WEBSITE_SOURCE descriptor; found "${String(artifact.kind)}".`,
      { kind: artifact.kind },
    );
  }
  if (artifact.clientExperience === undefined) {
    throw refuse(
      "AUTHORED_SOURCE_REQUIRED",
      "This artifact carries no authored client experience. Premium delivery modifies authored source, so it requires a schemaVersion 2 client.",
      { artifactId: artifact.artifactId },
    );
  }

  for (const [field, read] of IDENTITY_FIELDS) {
    const expected = read(artifact);
    const actual = current[field];
    if (expected !== actual) {
      throw refuse(
        "IDENTITY_MISMATCH",
        `${field} differs: the artifact says ${JSON.stringify(expected)}, the live client input says ${JSON.stringify(actual)}.`,
        { field, expected, actual },
      );
    }
  }

  const declared = normalizeDependencies(artifact.clientExperience.publicDependencies);
  const live = normalizeDependencies(current.publicDependencies);
  if (canonicalJson(declared) !== canonicalJson(live)) {
    throw refuse(
      "DEPENDENCY_DRIFT",
      "The experience manifest declares different public dependencies from the artifact.",
      { artifact: declared, current: live },
    );
  }

  const runtime = artifact.clientExperience.runtime ?? {};
  for (const key of ["clientJavaScript", "motion", "reducedMotion"]) {
    if (runtime[key] !== current.runtime?.[key]) {
      throw refuse(
        "IDENTITY_MISMATCH",
        `runtime.${key} differs: the artifact says ${JSON.stringify(runtime[key])}, the live manifest says ${JSON.stringify(current.runtime?.[key])}.`,
        { field: `runtime.${key}` },
      );
    }
  }

  const comparison = compareSourceSets(
    artifact.clientExperience.source,
    current.source,
  );
  if (!comparison.equal) {
    throw refuse(
      "STALE_SOURCE",
      `The live experience source differs from artifact ${artifact.artifactId}: ${describeSourceDifference(comparison)}. Assemble a new artifact from the current input; the bridge does not bring a stale one forward.`,
      comparison,
    );
  }

  const currentSourceSetId = sourceSetId(current.source, "current source");

  if (expectedWorkspace !== undefined) {
    if (expectedWorkspace.artifactId !== artifact.artifactId) {
      throw refuse(
        "ARTIFACT_MISMATCH",
        `This workspace was prepared from artifact ${expectedWorkspace.artifactId}, not ${artifact.artifactId}.`,
        { expected: expectedWorkspace.artifactId, actual: artifact.artifactId },
      );
    }
    if (expectedWorkspace.definitionSha256 !== current.definitionSha256) {
      throw refuse(
        "BUSINESS_TRUTH_STALE",
        "client-website.json changed after this workspace was prepared. Business truth is authoritative, so prepare again rather than launching against a definition the creative work never saw.",
        {
          expected: expectedWorkspace.definitionSha256,
          actual: current.definitionSha256,
        },
      );
    }
    if (expectedWorkspace.generatedSnapshotSha256 !== current.generatedSnapshotSha256) {
      throw refuse(
        "GENERATED_SNAPSHOT_STALE",
        "The generated public snapshot no longer matches the one this workspace was prepared from.",
        {
          expected: expectedWorkspace.generatedSnapshotSha256,
          actual: current.generatedSnapshotSha256,
        },
      );
    }
    if (expectedWorkspace.sourceSetId !== currentSourceSetId) {
      throw refuse(
        "WORKSPACE_STALE",
        "The live experience source no longer matches this workspace's baseline.",
        {
          expected: expectedWorkspace.sourceSetId,
          actual: currentSourceSetId,
        },
      );
    }
  }

  return Object.freeze({
    artifactId: artifact.artifactId,
    clientId: artifact.clientId,
    factoryRevision: artifact.factoryRevision,
    sourceSetId: currentSourceSetId,
    files: normalizeSourceEntries(current.source, "current source"),
  });
}

function normalizeDependencies(dependencies) {
  if (dependencies === undefined || dependencies === null) return [];
  if (!Array.isArray(dependencies)) {
    throw refuse(
      "DEPENDENCY_DRIFT",
      "Public dependencies must be an array of { name, version }.",
    );
  }
  return dependencies
    .map((dependency) => ({
      name: String(dependency?.name ?? ""),
      version: String(dependency?.version ?? ""),
    }))
    .sort((left, right) => compareText(left.name, right.name));
}

/**
 * A deterministic identity for a prepared workspace.
 *
 * Deliberately carries no timestamp: preparing the same input and artifact into
 * a second directory must produce the same workspace identity, or the operator
 * cannot tell an honest re-run from a different substrate.
 */
export function deriveWorkspaceId(binding) {
  return sha256(
    canonicalJson({
      kind: "PREMIUM_CREATIVE_WORKSPACE",
      artifactId: binding.artifactId,
      sourceSetId: binding.sourceSetId,
      definitionSha256: binding.definitionSha256,
      generatedSnapshotSha256: binding.generatedSnapshotSha256,
      orchestratorSourceRevision: binding.orchestratorSourceRevision,
    }),
  );
}

export function deriveLaunchId(binding) {
  return sha256(
    canonicalJson({
      kind: "PREMIUM_PRODUCTION_LAUNCH",
      workspaceId: binding.workspaceId,
      sourceSetId: binding.sourceSetId,
      handoffSha256: binding.handoffSha256,
      gateSha256: binding.gateSha256,
      baselineRevision: binding.baselineRevision,
    }),
  );
}

export function deriveReportId(binding) {
  return sha256(
    canonicalJson({
      kind: "PREMIUM_OBJECTIVE_VALIDATION",
      launchId: binding.launchId,
      candidateRevision: binding.candidateRevision,
      newArtifactId: binding.newArtifactId,
      newSourceSetId: binding.newSourceSetId,
      checks: binding.checks,
    }),
  );
}

/**
 * Baseline captures are usable evidence only when they name the same artifact
 * and the same source set they were taken from.
 *
 * An unbound capture is not deleted — it may still be worth looking at — but it
 * cannot support a gate, because a screenshot of a previous build is exactly
 * the artefact that makes a reviewer believe a change happened that did not.
 */
export function bindBaselineEvidence(manifest, binding) {
  if (manifest.artifactId !== binding.artifactId) {
    return Object.freeze({
      status: "UNBOUND_REFUSED",
      reason: `The captures name artifact ${manifest.artifactId}; this workspace is built from ${binding.artifactId}.`,
    });
  }
  if (manifest.sourceSetId !== binding.sourceSetId) {
    return Object.freeze({
      status: "UNBOUND_REFUSED",
      reason: `The captures name source set ${manifest.sourceSetId}; this workspace's source set is ${binding.sourceSetId}.`,
    });
  }
  return Object.freeze({ status: "BOUND", reason: "" });
}

/**
 * Which of the four required widths, and which motion posture, a bound capture
 * set actually covers. Reported rather than judged: `creative:prepare` records
 * the coverage, and the human gate decides whether it is enough to review.
 */
export function baselineCoverage(captures) {
  const widths = new Set();
  const motions = new Set();
  for (const capture of captures) {
    widths.add(capture.viewportWidth);
    motions.add(capture.motion);
  }
  return Object.freeze({
    widths: Object.freeze([...widths].sort((left, right) => right - left)),
    reducedMotion: motions.has("REDUCED"),
  });
}
