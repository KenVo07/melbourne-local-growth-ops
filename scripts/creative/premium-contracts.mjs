/**
 * The premium bridge's contract primitives: its refusal vocabulary, its
 * canonicalisation rules, and the runtime validators for the four records the
 * three commands publish.
 *
 * This is the bottom layer. `source-binding-core.mjs` and `atomic-output.mjs`
 * import from it; it imports from neither, so the dependency graph stays a
 * line rather than a cycle.
 *
 * There is exactly one runtime validator per record. JSON Schemas exist in the
 * architecture package as reference and test fixtures, and deliberately do not
 * ship here: a schema plus a validator is two implementations of one contract,
 * and the second one to be edited is the one that becomes wrong.
 *
 * Nothing in this file reads the filesystem, spawns a process, or touches the
 * network. Every check is a pure function of a value the caller already holds.
 */
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { posix } from "node:path";

/**
 * Every refusal the bridge can produce, with the meaning an operator reads.
 *
 * A closed vocabulary rather than free-text messages, because the negative
 * tests assert on the code and the operator documentation is generated from
 * this table. `refuse()` rejects a code that is not here, so a new failure mode
 * cannot be introduced without also being named.
 */
export const REFUSALS = Object.freeze({
  /* --- input and output shape ------------------------------------------ */
  ARGUMENTS_INVALID: "A required command argument is missing or malformed.",
  INPUT_NOT_FOUND: "The named client input, artifact or workspace does not exist.",
  OUTPUT_NOT_EMPTY: "The output directory already holds files. Outputs are never overwritten.",
  PATH_INVALID: "A path is not a portable POSIX-relative path.",
  PATH_ESCAPE: "A path escapes the root it is declared relative to.",
  UNSUPPORTED_FILE: "A symlink, hardlink, device or socket was found where a regular file is required.",
  ATOMIC_PUBLICATION_REQUIRED: "Publication could not complete atomically; the output was not created.",

  /* --- the Factory's own validators, reported through this vocabulary ---- */
  DEFINITION_INVALID: "client-website.json is not a definition the Factory accepts.",
  MANIFEST_INVALID: "experience/manifest.json is not a manifest site-core accepts.",
  SOURCE_POLICY_REFUSED: "The client experience source policy refused this source.",
  SNAPSHOT_GENERATION_FAILED: "The Factory could not generate a public snapshot from this definition.",

  /* --- source identity -------------------------------------------------- */
  ARTIFACT_KIND: "The artifact is not a MANAGED_WEBSITE_SOURCE descriptor.",
  AUTHORED_SOURCE_REQUIRED: "The artifact carries no authored client experience. Premium delivery needs schemaVersion 2 source.",
  ARTIFACT_INTEGRITY_FAILED: "The artifact's own handoff verifier refused it.",
  ARTIFACT_MISMATCH: "The workspace was prepared from a different artifact.",
  IDENTITY_MISMATCH: "Client, configuration, deployment or experience identity differs between the inputs.",
  STALE_SOURCE: "The live experience source differs from the assembled artifact.",
  WORKSPACE_STALE: "The live experience source no longer matches the prepared workspace baseline.",
  BUSINESS_TRUTH_STALE: "client-website.json changed after preparation.",
  GENERATED_SNAPSHOT_STALE: "The generated public snapshot no longer matches the artifact.",
  SOURCE_ENTRY_INVALID: "A source inventory entry is missing a required field or carries the wrong type.",
  SOURCE_DUPLICATE: "A source path appears twice in one inventory.",
  SOURCE_EMPTY: "A source inventory is empty.",
  HASH_INVALID: "A value declared as SHA-256 is not 64 lowercase hexadecimal characters.",

  /* --- workspace and launch integrity ----------------------------------- */
  WORKSPACE_TAMPERED: "An immutable workspace file changed after publication.",
  LAUNCH_TAMPERED: "An immutable launch-pack file changed after publication.",
  CONTRACT_INVALID: "A generated manifest does not satisfy its contract.",
  PORTABILITY_VIOLATION: "A portable manifest carries an absolute path, drive letter, home directory or temporary directory.",

  /* --- human authority --------------------------------------------------- */
  DELIVERY_INCOMPLETE:
    "The creative delivery does not pass creative:validate, so there is no approved direction to launch.",
  HUMAN_GATE_REQUIRED: "A gate is missing, unsigned, or signed by a non-human identity.",
  GATE_FAILED: "The Creative Gate decision is FAIL. A failed direction does not go to production.",
  NAMED_FIXES_MISSING: "A PASS_WITH_NAMED_FIXES gate names fixes the handoff does not carry.",

  /* --- production intent -------------------------------------------------- */
  PRODUCTION_DELTA_INCOMPLETE: "A Production delta row is missing a disposition, scope, intent, why or production home.",
  HANDOFF_WHY_MISSING: "A Production delta row states what changes but not why.",
  PRODUCTION_HOME_FORBIDDEN: "A Production delta row sends work somewhere other than P1_REUSE or this client's experience/ tree.",
  TRANSLATION_DELTA_MISSING: "The post-implementation Translation delta is unfilled.",

  /* --- creative evidence ---------------------------------------------------- */
  MOBILE_EVIDENCE_MISSING: "Mobile composition evidence is absent at a required width.",
  REDUCED_MOTION_MISSING: "No designed reduced-motion state was recorded.",
  MEDIA_CLAIM_UNSUPPORTED: "An asset substantiates a client fact its provenance class cannot carry.",
  BASELINE_UNBOUND: "Baseline captures are not bound to this artifact and source set.",

  /* --- provider boundary ----------------------------------------------------- */
  FOREIGN_DESIGN_SYSTEM: "The provider context inherits a design system that is not this client's.",
  VENDOR_EVIDENCE_UNBOUND: "Provider evidence is not bound to this workspace, artifact, source set and slice.",
  DATA_HANDLING_UNAPPROVED: "No named human approved what may leave the local boundary.",
  UPLOAD_SECRET_OR_PRIVATE_DATA: "The upload inventory names a credential, secret or internal-only file.",
  CROSS_CLIENT_LEAKAGE: "Material belonging to another client reached the workspace or the upload inventory.",

  /* --- repository and candidate scope ------------------------------------------ */
  WORKTREE_DIRTY: "The repository worktree is not clean, so the launch baseline is not reproducible.",
  CANDIDATE_REVISION_INVALID: "The candidate revision is missing, unknown, or does not descend from the launch baseline.",
  UNEXPECTED_CHANGE_SCOPE: "The candidate changed files outside the launch allowlist.",
  PRODUCTION_SCOPE_ESCAPE: "The candidate changed P1 Factory, Core, root or another client's source.",
  BUSINESS_TRUTH_DRIFT: "The candidate changed client-website.json without a new preparation.",
  DEPENDENCY_DRIFT: "The candidate changed dependency or runtime posture without approval.",
  OBJECTIVE_VALIDATION_FAILED: "One or more required objective checks failed.",
});

/** The four viewport widths every route must be evidenced at. */
export const REQUIRED_VIEWPORT_WIDTHS = Object.freeze([1440, 834, 390, 320]);

/** Creative environment routing. See docs/creative/premium-workflow.md. */
export const DESIGN_MODES = Object.freeze(["A", "B", "C"]);
export const DESIGN_MODE_SELECTORS = Object.freeze(["A", "B", "C", "AUTO"]);

/** What a file in a provider upload inventory is permitted to be. */
export const UPLOAD_CLASSIFICATIONS = Object.freeze([
  "CLIENT_SOURCE",
  "PUBLIC_CONTEXT",
  "APPROVED_MEDIA",
  "P1_EVIDENCE",
  "INSTRUCTIONS",
]);

/** Design-system inheritance states a human may attest to before an upload. */
export const DESIGN_SYSTEM_ATTESTATIONS = Object.freeze([
  "NONE",
  "CLIENT_SCOPED",
  "FOREIGN_OR_UNKNOWN_BLOCKED",
]);

export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * A refusal, not an exception. Every failure the three commands report to an
 * operator is one of these, carrying the code the negative tests assert on and
 * the detail that says which file or field was wrong.
 */
export class PremiumRefusal extends Error {
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "PremiumRefusal";
    this.code = code;
    this.detail = Object.freeze({ ...detail });
  }
}

export function refuse(code, message, detail = {}) {
  if (!Object.hasOwn(REFUSALS, code)) {
    throw new TypeError(
      `"${code}" is not a declared refusal. Add it to REFUSALS with the sentence an operator should read.`,
    );
  }
  return new PremiumRefusal(code, message, detail);
}

/** Codepoint order, matching the Factory's own `compareText`. */
export function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Recursively key-sorted JSON with no platform-specific whitespace.
 *
 * Identity hashes are taken over this rather than over a file's bytes wherever
 * the value is a structure rather than a delivered file, so re-serialising a
 * manifest with different key order cannot mint a different identity.
 */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareText)
        .map((key) => [key, sortValue(value[key])]),
    );
  }
  return value;
}

/** SHA-256 of a string (UTF-8) or a byte buffer, lowercase hex. */
export function sha256(value) {
  return createHash("sha256")
    .update(typeof value === "string" ? Buffer.from(value, "utf8") : value)
    .digest("hex");
}

export function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function isPortableRelativePath(path) {
  if (typeof path !== "string" || path === "") return false;
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    return false;
  }
  const normalized = posix.normalize(path);
  return (
    normalized === path && normalized !== ".." && !normalized.startsWith("../")
  );
}

/**
 * Portable means: POSIX separators, relative, already normalised, and no parent
 * traversal. A Windows drive prefix, a backslash, a leading slash or a `..`
 * segment is refused rather than repaired, because repairing one silently
 * changes which file a manifest points at.
 */
export function assertPortableRelativePath(path, field = "path") {
  if (typeof path !== "string" || path === "") {
    throw refuse("PATH_INVALID", `${field} must be a non-empty string.`, {
      field,
      path,
    });
  }
  if (path.includes("\\") || path.startsWith("/") || /^[A-Za-z]:/.test(path)) {
    throw refuse("PATH_INVALID", `${field} is not a portable relative path: ${path}`, {
      field,
      path,
    });
  }
  const normalized = posix.normalize(path);
  if (normalized !== path) {
    throw refuse(
      "PATH_INVALID",
      `${field} is not normalised: ${path} (write ${normalized}).`,
      { field, path, normalized },
    );
  }
  if (normalized === ".." || normalized.startsWith("../")) {
    throw refuse("PATH_ESCAPE", `${field} escapes its root: ${path}`, {
      field,
      path,
    });
  }
  return path;
}

/* Markers that mean a manifest recorded this machine rather than a location.
 * `homedir()`/`tmpdir()` are included so the check still fires on a host whose
 * home is not under /home or /Users. */
const MACHINE_PATH_MARKERS = Object.freeze([
  "/home/",
  "/Users/",
  "/root/",
  "/var/folders/",
  "/private/var/",
  `${homedir()}/`,
  `${tmpdir()}/`,
]);

const PATH_LIKE_KEY = /(^|[a-z])path$|^paths$|^root$|(^|[a-z])file$|^files$/i;

/**
 * Refuses a manifest that leaks the machine it was produced on.
 *
 * Two rules, because one is not enough. Every value under a path-shaped key
 * must be a portable relative path, which catches the ordinary case. Every
 * string anywhere in the record is additionally checked for a home, temporary
 * or drive-rooted prefix, which catches a machine path smuggled through a
 * prose field. Route values such as `/services` match neither.
 */
export function assertPortableManifest(value, problems = [], trail = "$") {
  const report = (message) => problems.push(`${trail} ${message}`);

  if (typeof value === "string") {
    for (const marker of MACHINE_PATH_MARKERS) {
      if (value.includes(marker)) {
        report(`carries a machine-specific path (${marker}).`);
        return problems;
      }
    }
    if (/^[A-Za-z]:[\\/]/.test(value)) report("carries a drive-letter path.");
    if (value.includes("\\\\")) report("carries a UNC path.");
    return problems;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertPortableManifest(entry, problems, `${trail}[${index}]`),
    );
    return problems;
  }
  if (value === null || typeof value !== "object") return problems;

  for (const [key, child] of Object.entries(value)) {
    const childTrail = `${trail}.${key}`;
    if (PATH_LIKE_KEY.test(key) && typeof child === "string") {
      if (!isPortableRelativePath(child)) {
        problems.push(`${childTrail} is not a portable relative path: ${child}`);
        continue;
      }
    }
    assertPortableManifest(child, problems, childTrail);
  }
  return problems;
}

/* -------------------------------------------------------------------------
 * Record validators.
 *
 * Each returns a list of human-readable problems rather than throwing, so a
 * caller can report every fault in one pass instead of the operator fixing one
 * field per run. `assertContract` turns the list into the single refusal the
 * commands raise.
 * ---------------------------------------------------------------------- */

export function assertContract(kind, record) {
  const problems = validateRecord(kind, record);
  if (problems.length > 0) {
    throw refuse("CONTRACT_INVALID", `${kind} is invalid:\n  ${problems.join("\n  ")}`, {
      kind,
      problems,
    });
  }
  return record;
}

const VALIDATORS = new Map();

export function validateRecord(kind, record) {
  const validator = VALIDATORS.get(kind);
  if (validator === undefined) {
    throw new TypeError(`No premium contract validator for "${kind}".`);
  }
  return validator(record);
}

function checker(record, problems) {
  const value = (path) =>
    path
      .split(".")
      .reduce(
        (current, key) =>
          current === null || current === undefined ? undefined : current[key],
        record,
      );
  return {
    value,
    constant(path, expected) {
      if (value(path) !== expected) {
        problems.push(`${path} must be ${JSON.stringify(expected)}.`);
      }
    },
    text(path) {
      const found = value(path);
      if (typeof found !== "string" || found.trim() === "") {
        problems.push(`${path} must be a non-empty string.`);
      }
    },
    hash(path) {
      if (!isSha256(value(path))) {
        problems.push(`${path} must be a lowercase 64-character SHA-256.`);
      }
    },
    integer(path, minimum = 0) {
      const found = value(path);
      if (!Number.isSafeInteger(found) || found < minimum) {
        problems.push(`${path} must be an integer >= ${minimum}.`);
      }
    },
    oneOf(path, values) {
      if (!values.includes(value(path))) {
        problems.push(`${path} must be one of ${values.join(", ")}.`);
      }
    },
    boolean(path) {
      if (typeof value(path) !== "boolean") {
        problems.push(`${path} must be a boolean.`);
      }
    },
    list(path, minimum = 1) {
      const found = value(path);
      if (!Array.isArray(found) || found.length < minimum) {
        problems.push(`${path} must be an array of at least ${minimum} item(s).`);
        return [];
      }
      return found;
    },
  };
}

/** Shared shape for `{ path, sha256, size }` inventories. */
function checkInventory(entries, problems, label) {
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    const at = `${label}[${index}]`;
    if (entry === null || typeof entry !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (!isPortableRelativePath(entry.path)) {
      problems.push(`${at}.path is not a portable relative path: ${entry.path}`);
    } else if (seen.has(entry.path)) {
      problems.push(`${at}.path is listed twice: ${entry.path}`);
    } else {
      seen.add(entry.path);
    }
    if (!isSha256(entry.sha256)) problems.push(`${at}.sha256 is not a SHA-256.`);
    if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
      problems.push(`${at}.size must be a non-negative integer.`);
    }
  }
}

/** The nine WEB-01D artifacts a prepared workspace hands to a human. */
export const REQUIRED_DELIVERY_ARTIFACTS = Object.freeze([
  "creative-intent.md",
  "territory-1.md",
  "territory-2.md",
  "territory-3.md",
  "signature-slice.md",
  "creative-gate.md",
  "production-handoff.md",
  "media-plan.md",
  "promotion-ledger.md",
]);

VALIDATORS.set("premium-workspace", (record) => {
  const problems = [];
  if (record === null || typeof record !== "object") {
    return ["premium-workspace.json must be an object."];
  }
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "PREMIUM_CREATIVE_WORKSPACE");
  check.hash("workspaceId");
  check.constant("createdBy.command", "creative:prepare");
  check.text("createdBy.orchestratorSourceRevision");

  check.text("client.clientId");
  check.text("client.configurationId");
  check.integer("client.configurationVersion", 1);
  check.text("client.deploymentId");
  check.text("client.experienceId");
  check.text("client.experienceVersion");

  check.hash("sourceBinding.artifactId");
  check.text("sourceBinding.factoryRevision");
  check.hash("sourceBinding.artifactDescriptorSha256");
  check.hash("sourceBinding.definitionSha256");
  check.hash("sourceBinding.generatedSnapshotSha256");
  check.hash("sourceBinding.sourceSetId");
  check.constant("sourceBinding.experienceRoot", "source/experience");
  check.text("sourceBinding.entrypoint");
  check.text("sourceBinding.designDnaPath");
  check.oneOf("sourceBinding.runtime.clientJavaScript", [
    "NONE",
    "ROUTE_SCOPED",
    "COMPONENT_SCOPED",
  ]);
  check.oneOf("sourceBinding.runtime.motion", ["NONE", "NATIVE", "CLIENT_LIBRARY"]);
  check.constant("sourceBinding.runtime.reducedMotion", "REQUIRED");
  check.list("sourceBinding.publicDependencies", 0);
  checkSourceEntries(check.list("sourceBinding.files"), problems, "sourceBinding.files");

  for (const key of [
    "creativeContextJson",
    "creativeContextMarkdown",
    "capabilityEnvelopeJson",
    "capabilityEnvelopeMarkdown",
    "platformContractMarkdown",
  ]) {
    const found = check.value(`context.${key}`);
    if (!isPortableRelativePath(found)) {
      problems.push(`context.${key} must be a portable relative path.`);
    }
  }

  check.constant("delivery.root", "delivery");
  const artifacts = check.list("delivery.requiredArtifacts", 9);
  for (const required of REQUIRED_DELIVERY_ARTIFACTS) {
    if (!artifacts.includes(required)) {
      problems.push(`delivery.requiredArtifacts omits ${required}.`);
    }
  }
  if (artifacts.includes("final-creative-gate.md")) {
    problems.push(
      "delivery.requiredArtifacts includes final-creative-gate.md. The ship gate is emitted after objective verification, never scaffolded with the creative artifacts.",
    );
  }

  check.oneOf("designMode.recommended", DESIGN_MODES);
  check.text("designMode.rationale");
  check.boolean("designMode.providerPreflightRequired");

  check.oneOf("evidence.status", ["BOUND", "MISSING", "UNBOUND_REFUSED"]);
  check.constant("provider.uploadPerformed", false);

  check.list("integrity.allowlist");
  checkInventory(check.list("integrity.files"), problems, "integrity.files");
  assertPortableManifest(record, problems);
  return problems;
});

/** A source inventory is an integrity inventory plus the policy's own bits. */
function checkSourceEntries(entries, problems, label) {
  checkInventory(entries, problems, label);
  for (const [index, entry] of entries.entries()) {
    if (entry === null || typeof entry !== "object") continue;
    const at = `${label}[${index}]`;
    if (!["SOURCE", "STYLE", "DATA", "MANIFEST"].includes(entry.kind)) {
      problems.push(`${at}.kind must be SOURCE, STYLE, DATA or MANIFEST.`);
    }
    if (typeof entry.clientRuntime !== "boolean") {
      problems.push(`${at}.clientRuntime must be a boolean.`);
    }
  }
}

VALIDATORS.set("production-launch", (record) => {
  const problems = [];
  if (record === null || typeof record !== "object") {
    return ["production-launch.json must be an object."];
  }
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "PREMIUM_PRODUCTION_LAUNCH");
  check.hash("launchId");
  check.hash("workspaceId");
  check.hash("sourceBinding.artifactId");
  check.hash("sourceBinding.sourceSetId");
  check.hash("sourceBinding.definitionSha256");
  check.hash("sourceBinding.generatedSnapshotSha256");
  check.text("repositoryBaseline.branch");
  check.text("repositoryBaseline.sourceRevision");
  check.constant("repositoryBaseline.worktreeClean", true);
  const revision = check.value("repositoryBaseline.sourceRevision");
  if (typeof revision === "string" && revision.length < 7) {
    problems.push("repositoryBaseline.sourceRevision must be at least 7 characters.");
  }

  check.text("client.clientId");
  const inputRoot = check.value("productionTarget.experienceRoot");
  if (typeof inputRoot !== "string" || !inputRoot.endsWith("experience")) {
    problems.push(
      "productionTarget.experienceRoot must name the same client's experience tree.",
    );
  }
  check.text("productionTarget.inputLabel");

  const handoffPath = check.value("handoff.path");
  if (!isPortableRelativePath(handoffPath)) {
    problems.push("handoff.path must be a portable relative path.");
  }
  check.hash("handoff.sha256");
  check.oneOf("handoff.sliceGateDecision", ["PASS", "PASS_WITH_NAMED_FIXES"]);
  check.text("handoff.selectedTerritory");
  check.text("handoff.gateDecidedBy");

  check.list("allowedChanges");
  check.list("prohibitedChanges");
  check.list("requiredValidation");
  check.list("stopConditions");
  check.list("approvedDependencyChanges", 0);
  check.list("integrity.allowlist");
  checkInventory(check.list("integrity.files"), problems, "integrity.files");
  assertPortableManifest(record, problems);
  return problems;
});

VALIDATORS.set("baseline-evidence", (record) => {
  const problems = [];
  if (record === null || typeof record !== "object") {
    return ["baseline evidence must be an object."];
  }
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "P1_BASELINE_EVIDENCE");
  check.hash("artifactId");
  check.hash("sourceSetId");
  check.text("capturedAt");
  const captures = check.list("captures");
  for (const [index, capture] of captures.entries()) {
    const at = `captures[${index}]`;
    if (capture === null || typeof capture !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (!isPortableRelativePath(capture.path)) {
      problems.push(`${at}.path must be a portable relative path.`);
    }
    if (!isSha256(capture.sha256)) problems.push(`${at}.sha256 is not a SHA-256.`);
    if (typeof capture.route !== "string" || capture.route === "") {
      problems.push(`${at}.route must name the route captured.`);
    }
    if (typeof capture.state !== "string" || capture.state === "") {
      problems.push(`${at}.state must name the state captured.`);
    }
    if (!REQUIRED_VIEWPORT_WIDTHS.includes(capture.viewportWidth)) {
      problems.push(
        `${at}.viewportWidth must be one of ${REQUIRED_VIEWPORT_WIDTHS.join(", ")}.`,
      );
    }
    if (!["FULL", "REDUCED"].includes(capture.motion)) {
      problems.push(`${at}.motion must be FULL or REDUCED.`);
    }
  }
  assertPortableManifest(record, problems);
  return problems;
});

VALIDATORS.set("provider-upload-inventory", (record) => {
  const problems = [];
  if (record === null || typeof record !== "object") {
    return ["provider upload inventory must be an object."];
  }
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "CREATIVE_PROVIDER_UPLOAD_INVENTORY");
  check.hash("workspaceId");
  check.oneOf("designMode", DESIGN_MODES);
  check.constant("uploadPerformed", false);
  const files = check.list("files");
  for (const [index, file] of files.entries()) {
    const at = `files[${index}]`;
    if (file === null || typeof file !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (!isPortableRelativePath(file.path)) {
      problems.push(`${at}.path must be a portable workspace-relative path.`);
    }
    if (!isSha256(file.sha256)) problems.push(`${at}.sha256 is not a SHA-256.`);
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      problems.push(`${at}.size must be a non-negative integer.`);
    }
    if (!UPLOAD_CLASSIFICATIONS.includes(file.classification)) {
      problems.push(
        `${at}.classification must be one of ${UPLOAD_CLASSIFICATIONS.join(", ")}.`,
      );
    }
  }
  assertPortableManifest(record, problems);
  return problems;
});

/**
 * The human-completed record that precedes any upload, and the same record
 * `creative:launch --vendor-evidence` reads back.
 *
 * `provider` is a free-text label rather than an enum. Pinning it to a vendor
 * would put a provider-specific required field in the core contract, which is
 * the lock-in the architecture refuses; CLAUDE_DESIGN is one legal value.
 */
VALIDATORS.set("provider-evidence", (record) => {
  const problems = [];
  if (record === null || typeof record !== "object") {
    return ["provider evidence manifest must be an object."];
  }
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "CREATIVE_PROVIDER_EVIDENCE");
  check.text("provider");
  check.text("projectLabel");
  check.oneOf("designMode", DESIGN_MODES);

  check.hash("binding.workspaceId");
  check.hash("binding.artifactId");
  check.hash("binding.sourceSetId");
  check.text("binding.slice");
  check.text("binding.gate");

  check.oneOf("designSystemAttestation.status", DESIGN_SYSTEM_ATTESTATIONS);
  check.text("designSystemAttestation.attestedBy");
  check.text("designSystemAttestation.attestedOn");
  if (check.value("designSystemAttestation.status") === "CLIENT_SCOPED") {
    check.text("designSystemAttestation.designSystemId");
    check.text("designSystemAttestation.brandScope");
  }

  check.text("dataHandlingApproval.approvedBy");
  check.text("dataHandlingApproval.approvedOn");
  check.constant("dataHandlingApproval.retentionUnderstood", true);

  const items = check.list("items", 0);
  for (const [index, item] of items.entries()) {
    const at = `items[${index}]`;
    if (item === null || typeof item !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (typeof item.label !== "string" || item.label.trim() === "") {
      problems.push(`${at}.label must name the export, URL or project.`);
    }
    if (typeof item.purpose !== "string" || item.purpose.trim() === "") {
      problems.push(`${at}.purpose must state what this evidence is for.`);
    }
    if (!["CODE", "VISUAL", "MOTION", "COMMENTARY"].includes(item.content)) {
      problems.push(`${at}.content must be CODE, VISUAL, MOTION or COMMENTARY.`);
    }
    if (item.sha256 !== undefined && !isSha256(item.sha256)) {
      problems.push(`${at}.sha256 is present but is not a SHA-256.`);
    }
    if (item.carriesNoNewBusinessFact !== true) {
      problems.push(
        `${at}.carriesNoNewBusinessFact must be true. Provider output cannot introduce a claim the client definition does not carry.`,
      );
    }
  }
  assertPortableManifest(record, problems);
  return problems;
});

VALIDATORS.set("objective-validation-report", (record) => {
  const problems = [];
  if (record === null || typeof record !== "object") {
    return ["objective-validation-report.json must be an object."];
  }
  const check = checker(record, problems);
  check.constant("schemaVersion", 1);
  check.constant("kind", "PREMIUM_OBJECTIVE_VALIDATION");
  check.hash("reportId");
  check.hash("launchId");
  check.hash("workspaceId");
  check.text("candidateRevision");
  check.oneOf("result", ["PASS", "FAIL"]);
  check.constant("humanCreativeDecision", "REQUIRED_SEPARATELY");

  check.hash("identities.oldArtifactId");
  check.hash("identities.oldSourceSetId");
  check.hash("identities.definitionSha256");

  const checks = check.list("checks");
  const seen = new Set();
  let failed = 0;
  for (const [index, entry] of checks.entries()) {
    const at = `checks[${index}]`;
    if (entry === null || typeof entry !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (typeof entry.id !== "string" || entry.id === "") {
      problems.push(`${at}.id must be a stable check identifier.`);
    } else if (seen.has(entry.id)) {
      problems.push(`${at}.id is reported twice: ${entry.id}`);
    } else {
      seen.add(entry.id);
    }
    if (!["PASS", "FAIL", "NOT_APPLICABLE"].includes(entry.status)) {
      problems.push(`${at}.status must be PASS, FAIL or NOT_APPLICABLE.`);
    }
    if (entry.status === "FAIL") failed += 1;
    if (typeof entry.proof !== "string" || entry.proof.trim() === "") {
      problems.push(`${at}.proof must say what was observed.`);
    }
  }
  if (failed > 0 && check.value("result") !== "FAIL") {
    problems.push(
      `result is ${String(check.value("result"))} with ${failed} failing check(s). A report with any FAIL is FAIL.`,
    );
  }

  const evidence = check.list("evidence", 0);
  for (const [index, item] of evidence.entries()) {
    const at = `evidence[${index}]`;
    if (item === null || typeof item !== "object") {
      problems.push(`${at} must be an object.`);
      continue;
    }
    if (!isPortableRelativePath(item.path)) {
      problems.push(`${at}.path must be a portable relative path.`);
    }
    if (!isSha256(item.sha256)) problems.push(`${at}.sha256 is not a SHA-256.`);
    if (typeof item.kind !== "string" || item.kind === "") {
      problems.push(`${at}.kind must classify the evidence.`);
    }
  }

  /* A machine may report what it measured. It may not report a verdict on the
   * work, and there is no field here in which one could be recorded. */
  for (const forbidden of ["score", "quality", "beauty", "rating", "grade"]) {
    if (Object.hasOwn(record, forbidden)) {
      problems.push(
        `"${forbidden}" is not a field of an objective report. Automation records evidence; a named human decides.`,
      );
    }
  }
  assertPortableManifest(record, problems);
  return problems;
});

/** Kinds this module can validate, for tests and documentation. */
export const CONTRACT_KINDS = Object.freeze([...VALIDATORS.keys()].sort(compareText));
