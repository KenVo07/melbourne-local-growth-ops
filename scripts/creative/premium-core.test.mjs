/**
 * Unit proof for the premium bridge's pure core.
 *
 * The three commands are thin: they run the Factory's own validators and then
 * ask this layer whether the answers agree. So this is where the identity,
 * path, canonicalisation, contract and atomicity rules are actually proved, one
 * attack at a time, with no filesystem fixture larger than a temporary
 * directory and no subprocess.
 *
 * Every case named in the architecture package's negative matrix that can be
 * decided without running a command is here. The rest are in
 * `premium-workflow.test.mjs`, which drives the commands end to end.
 *
 *   node --test scripts/creative/premium-core.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  hashFile,
  inventoryDirectory,
  listFiles,
  publishAtomically,
  resolveExistingDirectory,
  verifyInventory,
  writeChecksumSidecar,
  writeInto,
} from "./atomic-output.mjs";
import {
  assertPortableManifest,
  assertPortableRelativePath,
  canonicalJson,
  CONTRACT_KINDS,
  isPortableRelativePath,
  PremiumRefusal,
  REFUSALS,
  refuse,
  REQUIRED_DELIVERY_ARTIFACTS,
  sha256,
  validateRecord,
} from "./premium-contracts.mjs";
import {
  assertExactSourceBinding,
  baselineCoverage,
  bindBaselineEvidence,
  compareSourceSets,
  deriveLaunchId,
  deriveReportId,
  deriveWorkspaceId,
  normalizeSourceEntries,
  sourceSetId,
} from "./source-binding-core.mjs";

const temporaryDirectories = [];

test.after(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function temporary(prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

/** Asserts a call refuses with an exact code, not merely that it threw. */
function refusesWith(code, run) {
  try {
    run();
  } catch (error) {
    assert.ok(
      error instanceof PremiumRefusal,
      `expected a PremiumRefusal, got ${error?.name}: ${error?.message}`,
    );
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected a ${code} refusal, but the call returned`);
}

async function refusesWithAsync(code, run) {
  try {
    await run();
  } catch (error) {
    assert.ok(
      error instanceof PremiumRefusal,
      `expected a PremiumRefusal, got ${error?.name}: ${error?.message}`,
    );
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  assert.fail(`expected a ${code} refusal, but the call returned`);
}

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const hashC = "c".repeat(64);
const hashD = "d".repeat(64);
const hashE = "e".repeat(64);
const hashF = "f".repeat(64);

function sourceEntry(path, overrides = {}) {
  return {
    path,
    sha256: sha256(path),
    size: path.length,
    kind: path.endsWith(".css") ? "STYLE" : path.endsWith(".json") ? "DATA" : "SOURCE",
    clientRuntime: false,
    ...overrides,
  };
}

const exampleSource = [
  sourceEntry("index.tsx"),
  sourceEntry("manifest.json", { kind: "MANIFEST" }),
  sourceEntry("design-dna.json", { kind: "DATA" }),
  sourceEntry("styles/site.css"),
];

function artifactDescriptor(overrides = {}) {
  return {
    kind: "MANAGED_WEBSITE_SOURCE",
    artifactId: hashE,
    clientId: "probe-client",
    factoryRevision: "factory-rev",
    configuration: {
      configurationId: "cfg-1",
      configurationVersion: 3,
      deploymentId: "dep-1",
    },
    clientExperience: {
      experienceId: "probe-experience",
      experienceVersion: "1.0.0",
      entrypoint: "index.tsx",
      designDnaPath: "design-dna.json",
      runtime: {
        clientJavaScript: "COMPONENT_SCOPED",
        motion: "NATIVE",
        reducedMotion: "REQUIRED",
      },
      publicDependencies: [],
      source: exampleSource,
    },
    ...overrides,
  };
}

function currentInput(overrides = {}) {
  return {
    clientId: "probe-client",
    configurationId: "cfg-1",
    configurationVersion: 3,
    deploymentId: "dep-1",
    experienceId: "probe-experience",
    experienceVersion: "1.0.0",
    entrypoint: "index.tsx",
    designDnaPath: "design-dna.json",
    runtime: {
      clientJavaScript: "COMPONENT_SCOPED",
      motion: "NATIVE",
      reducedMotion: "REQUIRED",
    },
    publicDependencies: [],
    source: exampleSource,
    definitionSha256: hashA,
    generatedSnapshotSha256: hashB,
    ...overrides,
  };
}

/* ---------------------------------------------------------------- refusals */

test("every refusal code carries an operator sentence, and an undeclared one is rejected", () => {
  for (const [code, meaning] of Object.entries(REFUSALS)) {
    assert.match(code, /^[A-Z][A-Z0-9_]+$/, `${code} is not a screaming-snake code`);
    assert.ok(meaning.length > 20, `${code} has no usable meaning`);
    assert.ok(meaning.endsWith("."), `${code}'s meaning is not a sentence`);
  }
  assert.throws(() => refuse("NOT_A_REAL_CODE", "x"), /not a declared refusal/);
});

/* ------------------------------------------------------- canonical identity */

test("canonical JSON is key-order independent and array-order sensitive", () => {
  assert.equal(
    canonicalJson({ b: 1, a: { d: 2, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
  );
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  assert.equal(canonicalJson({ a: [{ z: 1, y: 2 }] }), '{"a":[{"y":2,"z":1}]}');
});

test("SHA-256 is taken over bytes, so a string and its buffer agree", () => {
  assert.equal(
    sha256("hello"),
    "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  );
  assert.equal(sha256(Buffer.from("hello", "utf8")), sha256("hello"));
});

/* ------------------------------------------------------------ portable paths */

test("portable path rules refuse every non-POSIX-relative shape", () => {
  for (const good of ["index.tsx", "routes/Home.tsx", "a/b/c/d.css"]) {
    assert.equal(assertPortableRelativePath(good), good);
    assert.ok(isPortableRelativePath(good));
  }
  refusesWith("PATH_INVALID", () => assertPortableRelativePath(""));
  refusesWith("PATH_INVALID", () => assertPortableRelativePath("/etc/passwd"));
  refusesWith("PATH_INVALID", () => assertPortableRelativePath("C:\\src\\index.tsx"));
  refusesWith("PATH_INVALID", () => assertPortableRelativePath("routes\\Home.tsx"));
  refusesWith("PATH_INVALID", () => assertPortableRelativePath("./index.tsx"));
  refusesWith("PATH_INVALID", () => assertPortableRelativePath("routes//Home.tsx"));
  refusesWith("PATH_ESCAPE", () => assertPortableRelativePath("../other-client/index.tsx"));
  refusesWith("PATH_ESCAPE", () => assertPortableRelativePath(".."));
  for (const bad of ["", "/x", "C:/x", "a\\b", "../x", "./x"]) {
    assert.equal(isPortableRelativePath(bad), false, bad);
  }
});

test("a manifest that records this machine is refused, but a route path is not", () => {
  assert.deepEqual(
    assertPortableManifest({
      path: "context/CREATIVE_CONTEXT.md",
      route: "/services/switchboard-upgrades",
      note: "reviewed at 1440 and 390",
    }),
    [],
  );
  const leaked = assertPortableManifest({
    workspace: "/home/operator/work/premium-workspace",
  });
  assert.equal(leaked.length, 1);
  assert.match(leaked[0], /machine-specific path/);
  assert.equal(
    assertPortableManifest({ path: "/absolute/context.md" }).length,
    1,
  );
  assert.equal(
    assertPortableManifest({ evidencePath: "C:\\captures\\home.png" }).length,
    1,
  );
  assert.equal(
    assertPortableManifest({ files: [{ path: "../elsewhere.md" }] }).length,
    1,
  );
});

/* ------------------------------------------------------------- source sets */

test("a source inventory is normalised to five fields, sorted, without duplicates", () => {
  const normalized = normalizeSourceEntries([
    sourceEntry("styles/site.css"),
    { ...sourceEntry("index.tsx"), extra: "ignored" },
  ]);
  assert.deepEqual(
    normalized.map(({ path }) => path),
    ["index.tsx", "styles/site.css"],
  );
  assert.deepEqual(Object.keys(normalized[0]), [
    "path",
    "sha256",
    "size",
    "kind",
    "clientRuntime",
  ]);
  refusesWith("SOURCE_EMPTY", () => normalizeSourceEntries([]));
  refusesWith("SOURCE_DUPLICATE", () =>
    normalizeSourceEntries([sourceEntry("index.tsx"), sourceEntry("index.tsx")]),
  );
  refusesWith("HASH_INVALID", () =>
    normalizeSourceEntries([sourceEntry("index.tsx", { sha256: "not-a-hash" })]),
  );
  refusesWith("HASH_INVALID", () =>
    normalizeSourceEntries([sourceEntry("index.tsx", { sha256: "A".repeat(64) })]),
  );
  refusesWith("SOURCE_ENTRY_INVALID", () =>
    normalizeSourceEntries([sourceEntry("index.tsx", { size: -1 })]),
  );
  refusesWith("SOURCE_ENTRY_INVALID", () =>
    normalizeSourceEntries([sourceEntry("index.tsx", { kind: "BINARY" })]),
  );
  refusesWith("SOURCE_ENTRY_INVALID", () =>
    normalizeSourceEntries([sourceEntry("index.tsx", { clientRuntime: "yes" })]),
  );
  refusesWith("PATH_INVALID", () =>
    normalizeSourceEntries([sourceEntry("routes\\Home.tsx")]),
  );
  refusesWith("PATH_ESCAPE", () =>
    normalizeSourceEntries([sourceEntry("../other-client/index.tsx")]),
  );
});

test("the source set identity ignores ordering and notices every recorded bit", () => {
  const forward = sourceSetId(exampleSource);
  const reversed = sourceSetId([...exampleSource].reverse());
  assert.equal(forward, reversed, "ordering must not change identity");
  assert.match(forward, /^[0-9a-f]{64}$/);

  const mutations = [
    { sha256: hashF },
    { size: 999 },
    { kind: "DATA" },
    { clientRuntime: true },
  ];
  for (const mutation of mutations) {
    const mutated = [sourceEntry("index.tsx", mutation), ...exampleSource.slice(1)];
    assert.notEqual(
      sourceSetId(mutated),
      forward,
      `changing ${Object.keys(mutation)[0]} must change the identity`,
    );
  }
  assert.notEqual(sourceSetId(exampleSource.slice(1)), forward, "a removed file must change it");
});

test("a source comparison names the files rather than reporting a boolean", () => {
  const current = [
    sourceEntry("index.tsx", { sha256: hashF }),
    ...exampleSource.slice(1),
    sourceEntry("routes/New.tsx"),
  ].filter(({ path }) => path !== "styles/site.css");

  const comparison = compareSourceSets(exampleSource, current);
  assert.equal(comparison.equal, false);
  assert.deepEqual(comparison.changed, ["index.tsx"]);
  assert.deepEqual(comparison.missing, ["styles/site.css"]);
  assert.deepEqual(comparison.unexpected, ["routes/New.tsx"]);
  assert.ok(compareSourceSets(exampleSource, [...exampleSource].reverse()).equal);
});

/* --------------------------------------------------------- source binding */

test("an exact binding returns the identity a workspace is built from", () => {
  const binding = assertExactSourceBinding({
    artifact: artifactDescriptor(),
    current: currentInput(),
  });
  assert.equal(binding.artifactId, hashE);
  assert.equal(binding.clientId, "probe-client");
  assert.equal(binding.sourceSetId, sourceSetId(exampleSource));
  assert.equal(binding.files.length, exampleSource.length);
});

test("a legacy or non-source artifact cannot carry premium work", () => {
  refusesWith("ARTIFACT_KIND", () =>
    assertExactSourceBinding({
      artifact: { ...artifactDescriptor(), kind: "SOMETHING_ELSE" },
      current: currentInput(),
    }),
  );
  const legacy = artifactDescriptor();
  delete legacy.clientExperience;
  refusesWith("AUTHORED_SOURCE_REQUIRED", () =>
    assertExactSourceBinding({ artifact: legacy, current: currentInput() }),
  );
});

test("every identity field is compared, so a foreign pairing is named exactly", () => {
  const cases = {
    clientId: "other-client",
    configurationId: "cfg-2",
    configurationVersion: 4,
    deploymentId: "dep-2",
    experienceId: "other-experience",
    experienceVersion: "2.0.0",
    entrypoint: "main.tsx",
    designDnaPath: "dna.json",
  };
  for (const [field, value] of Object.entries(cases)) {
    const error = refusesWith("IDENTITY_MISMATCH", () =>
      assertExactSourceBinding({
        artifact: artifactDescriptor(),
        current: currentInput({ [field]: value }),
      }),
    );
    assert.equal(error.detail.field, field);
  }
});

test("runtime posture and declared dependencies are part of identity", () => {
  refusesWith("IDENTITY_MISMATCH", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput({
        runtime: {
          clientJavaScript: "NONE",
          motion: "NATIVE",
          reducedMotion: "REQUIRED",
        },
      }),
    }),
  );
  refusesWith("DEPENDENCY_DRIFT", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput({
        publicDependencies: [{ name: "motion-one", version: "1.0.0" }],
      }),
    }),
  );
});

test("one changed byte in the live experience is stale source, not a delta", () => {
  const error = refusesWith("STALE_SOURCE", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput({
        source: [sourceEntry("index.tsx", { sha256: hashF }), ...exampleSource.slice(1)],
      }),
    }),
  );
  assert.deepEqual(error.detail.changed, ["index.tsx"]);
  assert.match(error.message, /Assemble a new artifact/);
});

test("launch-time checks catch a workspace that no longer describes the input", () => {
  const workspace = {
    artifactId: hashE,
    sourceSetId: sourceSetId(exampleSource),
    definitionSha256: hashA,
    generatedSnapshotSha256: hashB,
  };
  assert.ok(
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput(),
      expectedWorkspace: workspace,
    }),
  );
  refusesWith("ARTIFACT_MISMATCH", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput(),
      expectedWorkspace: { ...workspace, artifactId: hashD },
    }),
  );
  refusesWith("BUSINESS_TRUTH_STALE", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput(),
      expectedWorkspace: { ...workspace, definitionSha256: hashD },
    }),
  );
  refusesWith("GENERATED_SNAPSHOT_STALE", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput(),
      expectedWorkspace: { ...workspace, generatedSnapshotSha256: hashD },
    }),
  );
  refusesWith("WORKSPACE_STALE", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput(),
      expectedWorkspace: { ...workspace, sourceSetId: hashD },
    }),
  );
});

test("the snapshot can go stale while the experience bytes do not", () => {
  /* The generated snapshot is a function of the whole definition, not only of
   * authored source. A definition edit that leaves experience/ untouched must
   * still refuse, or a design session reads copy the site no longer carries. */
  refusesWith("GENERATED_SNAPSHOT_STALE", () =>
    assertExactSourceBinding({
      artifact: artifactDescriptor(),
      current: currentInput({ generatedSnapshotSha256: hashF }),
      expectedWorkspace: {
        artifactId: hashE,
        sourceSetId: sourceSetId(exampleSource),
        definitionSha256: hashA,
        generatedSnapshotSha256: hashB,
      },
    }),
  );
});

test("derived identities are deterministic and change with their inputs", () => {
  const workspaceInput = {
    artifactId: hashE,
    sourceSetId: hashC,
    definitionSha256: hashA,
    generatedSnapshotSha256: hashB,
    orchestratorSourceRevision: "3024fe4",
  };
  assert.equal(deriveWorkspaceId(workspaceInput), deriveWorkspaceId({ ...workspaceInput }));
  assert.notEqual(
    deriveWorkspaceId(workspaceInput),
    deriveWorkspaceId({ ...workspaceInput, sourceSetId: hashD }),
  );
  assert.match(deriveWorkspaceId(workspaceInput), /^[0-9a-f]{64}$/);

  const launchInput = {
    workspaceId: hashD,
    sourceSetId: hashC,
    handoffSha256: hashA,
    gateSha256: hashB,
    baselineRevision: "abc1234",
  };
  assert.equal(deriveLaunchId(launchInput), deriveLaunchId({ ...launchInput }));
  assert.notEqual(
    deriveLaunchId(launchInput),
    deriveLaunchId({ ...launchInput, baselineRevision: "def5678" }),
  );

  const reportInput = {
    launchId: hashF,
    candidateRevision: "abc1234",
    newArtifactId: hashE,
    newSourceSetId: hashC,
    checks: [{ id: "source-policy", status: "PASS" }],
  };
  assert.equal(deriveReportId(reportInput), deriveReportId({ ...reportInput }));
  assert.notEqual(
    deriveReportId(reportInput),
    deriveReportId({
      ...reportInput,
      checks: [{ id: "source-policy", status: "FAIL" }],
    }),
  );
});

/* --------------------------------------------------------- baseline evidence */

test("baseline captures bind to one artifact and one source set, or support nothing", () => {
  const binding = { artifactId: hashE, sourceSetId: hashC };
  assert.equal(
    bindBaselineEvidence({ artifactId: hashE, sourceSetId: hashC }, binding).status,
    "BOUND",
  );
  const wrongArtifact = bindBaselineEvidence(
    { artifactId: hashD, sourceSetId: hashC },
    binding,
  );
  assert.equal(wrongArtifact.status, "UNBOUND_REFUSED");
  assert.match(wrongArtifact.reason, /artifact/);
  const wrongSource = bindBaselineEvidence(
    { artifactId: hashE, sourceSetId: hashD },
    binding,
  );
  assert.equal(wrongSource.status, "UNBOUND_REFUSED");
  assert.match(wrongSource.reason, /source set/);
});

test("baseline coverage reports the widths captured without judging them", () => {
  const coverage = baselineCoverage([
    { viewportWidth: 1440, motion: "FULL" },
    { viewportWidth: 390, motion: "FULL" },
    { viewportWidth: 390, motion: "REDUCED" },
  ]);
  assert.deepEqual(coverage.widths, [1440, 390]);
  assert.equal(coverage.reducedMotion, true);
  assert.equal(
    baselineCoverage([{ viewportWidth: 1440, motion: "FULL" }]).reducedMotion,
    false,
  );
});

/* ----------------------------------------------------------------- contracts */

function validWorkspace(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "PREMIUM_CREATIVE_WORKSPACE",
    workspaceId: hashD,
    createdBy: { command: "creative:prepare", orchestratorSourceRevision: "3024fe4" },
    client: {
      clientId: "probe-client",
      configurationId: "cfg-1",
      configurationVersion: 3,
      deploymentId: "dep-1",
      experienceId: "probe-experience",
      experienceVersion: "1.0.0",
    },
    sourceBinding: {
      artifactId: hashE,
      factoryRevision: "factory-rev",
      artifactDescriptorSha256: hashF,
      definitionSha256: hashA,
      generatedSnapshotSha256: hashB,
      sourceSetId: hashC,
      experienceRoot: "source/experience",
      entrypoint: "index.tsx",
      designDnaPath: "design-dna.json",
      runtime: {
        clientJavaScript: "COMPONENT_SCOPED",
        motion: "NATIVE",
        reducedMotion: "REQUIRED",
      },
      publicDependencies: [],
      files: exampleSource,
    },
    context: {
      creativeContextJson: "context/creative-context.json",
      creativeContextMarkdown: "context/CREATIVE_CONTEXT.md",
      capabilityEnvelopeJson: "context/signature-capability-envelope.json",
      capabilityEnvelopeMarkdown: "context/signature-capability-envelope.md",
      platformContractMarkdown: "context/PLATFORM_CONTRACT.md",
    },
    delivery: { root: "delivery", requiredArtifacts: [...REQUIRED_DELIVERY_ARTIFACTS] },
    media: { root: "media/approved", inventory: "media/media-inventory.json", assetCount: 0 },
    designMode: {
      recommended: "B",
      rationale: "Generated client-local source with no client-scoped design system.",
      providerPreflightRequired: true,
    },
    provider: {
      uploadInventory: "provider/upload-inventory.json",
      preflightTemplate: "provider/provider-preflight.template.json",
      uploadPerformed: false,
    },
    evidence: { status: "MISSING" },
    integrity: {
      allowlist: ["context/CREATIVE_CONTEXT.md"],
      files: [{ path: "context/CREATIVE_CONTEXT.md", sha256: hashA, size: 12 }],
    },
    ...overrides,
  };
}

function validLaunch(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "PREMIUM_PRODUCTION_LAUNCH",
    launchId: hashF,
    workspaceId: hashD,
    client: { clientId: "probe-client" },
    sourceBinding: {
      artifactId: hashE,
      sourceSetId: hashC,
      definitionSha256: hashA,
      generatedSnapshotSha256: hashB,
    },
    repositoryBaseline: {
      branch: "feature/premium",
      sourceRevision: "3024fe4d9a296a50d760250347b3600ea75e960c",
      worktreeClean: true,
    },
    productionTarget: {
      inputLabel: "<client-input>",
      experienceRoot: "<client-input>/experience",
    },
    handoff: {
      path: "inputs/production-handoff.md",
      sha256: hashA,
      sliceGateDecision: "PASS",
      selectedTerritory: "territory-2",
      gateDecidedBy: "Khoa Vo",
    },
    allowedChanges: ["<client-input>/experience/**"],
    prohibitedChanges: ["packages/**"],
    approvedDependencyChanges: [],
    requiredValidation: ["pnpm check"],
    stopConditions: ["The live source no longer matches the launch baseline."],
    integrity: {
      allowlist: ["PRODUCTION_AGENT_PROMPT.md"],
      files: [{ path: "PRODUCTION_AGENT_PROMPT.md", sha256: hashB, size: 10 }],
    },
    ...overrides,
  };
}

function validReport(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: "PREMIUM_OBJECTIVE_VALIDATION",
    reportId: hashA,
    launchId: hashF,
    workspaceId: hashD,
    candidateRevision: "abc1234def",
    result: "PASS",
    identities: {
      oldArtifactId: hashE,
      oldSourceSetId: hashC,
      definitionSha256: hashA,
    },
    checks: [{ id: "source-policy", status: "PASS", proof: "logs/source-policy.log" }],
    newArtifact: { artifactId: hashB, sourceSetId: hashD, verified: true },
    evidence: [{ path: "evidence/home-1440.png", sha256: hashC, kind: "VIEWPORT" }],
    humanCreativeDecision: "REQUIRED_SEPARATELY",
    ...overrides,
  };
}

test("the three published records validate, and every kind has a validator", () => {
  assert.deepEqual(validateRecord("premium-workspace", validWorkspace()), []);
  assert.deepEqual(validateRecord("production-launch", validLaunch()), []);
  assert.deepEqual(validateRecord("objective-validation-report", validReport()), []);
  /* Named rather than counted: a new published record has to be added here
   * deliberately, and the diff says which one it is. */
  assert.deepEqual(CONTRACT_KINDS, [
    "baseline-evidence",
    "candidate-evidence",
    "objective-validation-report",
    "premium-workspace",
    "production-launch",
    "provider-evidence",
    "provider-upload-inventory",
  ]);
  assert.throws(() => validateRecord("not-a-kind", {}), /No premium contract validator/);
});

test("a workspace manifest is refused when its identity or layout is wrong", () => {
  const cases = [
    [{ workspaceId: "short" }, /workspaceId/],
    [{ kind: "SOMETHING" }, /kind/],
    [
      { sourceBinding: { ...validWorkspace().sourceBinding, experienceRoot: "src/experience" } },
      /experienceRoot/,
    ],
    [
      {
        sourceBinding: {
          ...validWorkspace().sourceBinding,
          files: [sourceEntry("index.tsx"), sourceEntry("index.tsx")],
        },
      },
      /listed twice/,
    ],
    [
      {
        sourceBinding: {
          ...validWorkspace().sourceBinding,
          runtime: { clientJavaScript: "COMPONENT_SCOPED", motion: "NATIVE", reducedMotion: "OPTIONAL" },
        },
      },
      /reducedMotion/,
    ],
    [{ designMode: { recommended: "D", rationale: "x", providerPreflightRequired: true } }, /recommended/],
    [{ provider: { uploadPerformed: true } }, /uploadPerformed/],
    [{ evidence: { status: "PROBABLY_FINE" } }, /evidence.status/],
  ];
  for (const [overrides, pattern] of cases) {
    const problems = validateRecord("premium-workspace", validWorkspace(overrides));
    assert.ok(problems.length > 0, `${JSON.stringify(overrides)} should have failed`);
    assert.ok(
      problems.some((problem) => pattern.test(problem)),
      `expected ${pattern} in ${problems.join(" | ")}`,
    );
  }
});

test("the ship gate cannot be scaffolded with the nine creative artifacts", () => {
  const problems = validateRecord(
    "premium-workspace",
    validWorkspace({
      delivery: {
        root: "delivery",
        requiredArtifacts: [...REQUIRED_DELIVERY_ARTIFACTS, "final-creative-gate.md"],
      },
    }),
  );
  assert.ok(problems.some((problem) => /final-creative-gate/.test(problem)));
});

test("a manifest carrying a local filesystem path is refused", () => {
  const problems = validateRecord(
    "production-launch",
    validLaunch({
      productionTarget: {
        inputLabel: "northline",
        experienceRoot: "/home/operator/clients/northline/experience",
      },
    }),
  );
  assert.ok(problems.some((problem) => /machine-specific path/.test(problem)), problems.join(" | "));
});

test("a launch pack cannot descend from a failed or dirty baseline", () => {
  assert.ok(
    validateRecord(
      "production-launch",
      validLaunch({ handoff: { ...validLaunch().handoff, sliceGateDecision: "FAIL" } }),
    ).some((problem) => /sliceGateDecision/.test(problem)),
  );
  assert.ok(
    validateRecord(
      "production-launch",
      validLaunch({
        repositoryBaseline: { branch: "x", sourceRevision: "abc1234", worktreeClean: false },
      }),
    ).some((problem) => /worktreeClean/.test(problem)),
  );
});

test("an objective report cannot pass while a check fails, or carry a taste score", () => {
  const failing = validateRecord(
    "objective-validation-report",
    validReport({
      checks: [{ id: "mobile-evidence", status: "FAIL", proof: "no 320 capture" }],
    }),
  );
  assert.ok(failing.some((problem) => /A report with any FAIL is FAIL/.test(problem)));

  assert.deepEqual(
    validateRecord(
      "objective-validation-report",
      validReport({
        result: "FAIL",
        checks: [{ id: "mobile-evidence", status: "FAIL", proof: "no 320 capture" }],
      }),
    ),
    [],
  );

  for (const field of ["score", "quality", "beauty", "rating", "grade"]) {
    const problems = validateRecord(
      "objective-validation-report",
      validReport({ [field]: 9 }),
    );
    assert.ok(
      problems.some((problem) => problem.includes(field)),
      `${field} should be refused`,
    );
  }
  assert.ok(
    validateRecord(
      "objective-validation-report",
      validReport({ humanCreativeDecision: "APPROVED" }),
    ).some((problem) => /humanCreativeDecision/.test(problem)),
  );
});

test("provider evidence must be bound, attested and free of new business facts", () => {
  const evidence = {
    schemaVersion: 1,
    kind: "CREATIVE_PROVIDER_EVIDENCE",
    provider: "CLAUDE_DESIGN",
    projectLabel: "probe-client premium exploration",
    designMode: "B",
    binding: {
      workspaceId: hashD,
      artifactId: hashE,
      sourceSetId: hashC,
      slice: "signature-slice.md",
      gate: "creative-gate.md",
    },
    designSystemAttestation: {
      status: "NONE",
      attestedBy: "Khoa Vo",
      attestedOn: "2026-08-19",
    },
    dataHandlingApproval: {
      approvedBy: "Khoa Vo",
      approvedOn: "2026-08-19",
      retentionUnderstood: true,
    },
    items: [
      {
        label: "territory-2 canvas export",
        purpose: "Motion reference for the opening sequence",
        content: "MOTION",
        carriesNoNewBusinessFact: true,
      },
    ],
  };
  assert.deepEqual(validateRecord("provider-evidence", evidence), []);

  const unbound = structuredClone(evidence);
  delete unbound.binding.sourceSetId;
  assert.ok(
    validateRecord("provider-evidence", unbound).some((problem) =>
      /binding.sourceSetId/.test(problem),
    ),
  );

  const unapproved = structuredClone(evidence);
  unapproved.dataHandlingApproval.retentionUnderstood = false;
  assert.ok(
    validateRecord("provider-evidence", unapproved).some((problem) =>
      /retentionUnderstood/.test(problem),
    ),
  );

  const claiming = structuredClone(evidence);
  claiming.items[0].carriesNoNewBusinessFact = false;
  assert.ok(
    validateRecord("provider-evidence", claiming).some((problem) =>
      /carriesNoNewBusinessFact/.test(problem),
    ),
  );

  const clientScoped = structuredClone(evidence);
  clientScoped.designSystemAttestation.status = "CLIENT_SCOPED";
  assert.ok(
    validateRecord("provider-evidence", clientScoped).some((problem) =>
      /brandScope|designSystemId/.test(problem),
    ),
    "a claimed design system must name its owner and brand scope",
  );
});

test("baseline evidence must name a required width and a motion posture", () => {
  const manifest = {
    schemaVersion: 1,
    kind: "P1_BASELINE_EVIDENCE",
    artifactId: hashE,
    sourceSetId: hashC,
    capturedAt: "2026-08-19T00:00:00Z",
    captures: [
      {
        path: "baseline/home-1440.png",
        sha256: hashA,
        route: "/",
        state: "opening",
        viewportWidth: 1440,
        motion: "FULL",
      },
    ],
  };
  assert.deepEqual(validateRecord("baseline-evidence", manifest), []);
  const offWidth = structuredClone(manifest);
  offWidth.captures[0].viewportWidth = 1280;
  assert.ok(
    validateRecord("baseline-evidence", offWidth).some((problem) =>
      /viewportWidth/.test(problem),
    ),
  );
});

/* --------------------------------------------------------- atomic publication */

test("a successful publication appears in one step", async () => {
  const root = await temporary("premium-atomic-");
  const target = join(root, "workspace");
  await publishAtomically(target, async (staging) => {
    await writeInto(staging, "premium-workspace.json", "{}\n");
    await writeInto(staging, "context/CREATIVE_CONTEXT.md", "# context\n");
  });
  assert.deepEqual(await listFiles(target), [
    "context/CREATIVE_CONTEXT.md",
    "premium-workspace.json",
  ]);
  assert.deepEqual(
    (await listFiles(root)).filter((path) => path.includes(".staging-")),
    [],
    "no staging directory may survive",
  );
});

test("a failure part way through leaves the requested output absent", async () => {
  const root = await temporary("premium-atomic-fail-");
  const target = join(root, "workspace");
  await assert.rejects(
    publishAtomically(target, async (staging) => {
      await writeInto(staging, "premium-workspace.json", "{}\n");
      await writeInto(staging, "context/CREATIVE_CONTEXT.md", "# half written\n");
      throw refuse("STALE_SOURCE", "simulated failure after several files were written");
    }),
    /simulated failure/,
  );
  await assert.rejects(listFiles(target), /ENOENT/);
  assert.deepEqual(await listFiles(root), [], "the temporary directory must be removed");
});

test("an existing output is never overwritten, and an empty one is accepted", async () => {
  const root = await temporary("premium-atomic-existing-");
  const occupied = join(root, "occupied");
  await mkdir(occupied, { recursive: true });
  await writeFile(join(occupied, "previous-report.json"), "{}\n");
  await refusesWithAsync("OUTPUT_NOT_EMPTY", () =>
    publishAtomically(occupied, async (staging) => {
      await writeInto(staging, "new.json", "{}\n");
    }),
  );
  assert.deepEqual(await listFiles(occupied), ["previous-report.json"]);

  const emptied = join(root, "emptied");
  await mkdir(emptied, { recursive: true });
  await publishAtomically(emptied, async (staging) => {
    await writeInto(staging, "new.json", "{}\n");
  });
  assert.deepEqual(await listFiles(emptied), ["new.json"]);

  const file = join(root, "a-file");
  await writeFile(file, "not a directory\n");
  await refusesWithAsync("OUTPUT_NOT_EMPTY", () => publishAtomically(file, async () => {}));
});

test("an inventory covers every file, and re-verifying names what moved", async () => {
  const root = await temporary("premium-inventory-");
  await writeInto(root, "premium-workspace.json", "{}\n");
  await writeInto(root, "source/experience/index.tsx", "export const x = 1;\n");
  await writeInto(root, "delivery/creative-intent.md", "# intent\n");

  const entries = await inventoryDirectory(root, ["premium-workspace.json"]);
  assert.deepEqual(entries.map(({ path }) => path), [
    "delivery/creative-intent.md",
    "source/experience/index.tsx",
  ]);
  assert.equal(
    entries[1].sha256,
    await hashFile(join(root, "source/experience/index.tsx")),
  );
  assert.ok((await verifyInventory(root, entries)).intact);

  await writeInto(root, "source/experience/index.tsx", "export const x = 2;\n");
  const afterEdit = await verifyInventory(root, entries);
  assert.equal(afterEdit.intact, false);
  assert.deepEqual(afterEdit.changed, ["source/experience/index.tsx"]);

  await rm(join(root, "delivery/creative-intent.md"));
  const afterDelete = await verifyInventory(root, entries);
  assert.deepEqual(afterDelete.missing, ["delivery/creative-intent.md"]);
});

test("the checksum sidecar is readable by sha256sum -c", async () => {
  const root = await temporary("premium-sidecar-");
  await writeInto(root, "premium-workspace.json", "{}\n");
  const entries = await inventoryDirectory(root, []);
  await writeChecksumSidecar(root, "integrity.sha256", entries);
  const sidecar = await readFile(join(root, "integrity.sha256"), "utf8");
  assert.equal(sidecar, `${sha256("{}\n")}  premium-workspace.json\n`);
});

test("a symlink anywhere in a tree is refused rather than followed", async () => {
  const root = await temporary("premium-symlink-");
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, "source"), { recursive: true });
  await writeFile(join(root, "other-client-secret.tsx"), "export const leak = 1;\n");
  await symlink(join(root, "other-client-secret.tsx"), join(workspace, "source/index.tsx"));
  await refusesWithAsync("UNSUPPORTED_FILE", () => listFiles(workspace));
  await refusesWithAsync("UNSUPPORTED_FILE", () =>
    resolveExistingDirectory(join(workspace, "source/index.tsx"), "client input"),
  );
});

test("candidate evidence must be bound, complete and honest about its results", () => {
  const capture = (overrides = {}) => ({
    path: "captures/home-390-full.png",
    sha256: "c".repeat(64),
    route: "home",
    state: "opening",
    viewportWidth: 390,
    motion: "FULL",
    ...overrides,
  });
  const valid = {
    schemaVersion: 1,
    kind: "PREMIUM_CANDIDATE_EVIDENCE",
    artifactId: "a".repeat(64),
    sourceSetId: "b".repeat(64),
    candidateRevision: "4634bfb0243923d2d92cd15d39a9b298c4017816",
    capturedAt: "2026-08-19T00:00:00Z",
    captures: [capture()],
    accessibility: [
      { engine: "chromium", state: "opening", result: "PASS", proof: "no violations" },
    ],
    runtime: [
      { check: "console-errors", scope: "all routes", result: "PASS", proof: "clean" },
    ],
  };
  assert.deepEqual(validateRecord("candidate-evidence", valid), []);

  const cases = [
    [{ captures: [capture({ viewportWidth: 1024 })] }, /viewportWidth/],
    [{ captures: [capture({ motion: "OFF" })] }, /motion/],
    [{ captures: [capture({ path: "/absolute/home.png" })] }, /portable relative path/],
    [{ captures: [capture({ route: "" })] }, /route/],
    [{ captures: [] }, /at least 1 item/],
    [
      { accessibility: [{ engine: "chromium", state: "opening", result: "MAYBE", proof: "x" }] },
      /result must be PASS or FAIL/,
    ],
    [
      { runtime: [{ check: "console-errors", scope: "all", result: "FAIL", proof: "" }] },
      /proof/,
    ],
    [{ candidateRevision: "" }, /candidateRevision/],
    [{ sourceSetId: "short" }, /sourceSetId/],
  ];
  for (const [overrides, expected] of cases) {
    const problems = validateRecord("candidate-evidence", { ...valid, ...overrides });
    assert.ok(
      problems.some((problem) => expected.test(problem)),
      `${JSON.stringify(overrides)} should have reported ${expected}; got ${problems.join(" | ") || "(nothing)"}`,
    );
  }
});
