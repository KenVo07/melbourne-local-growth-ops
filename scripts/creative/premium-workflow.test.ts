/**
 * Black-box proof for the three premium commands.
 *
 * Every case here runs the real command in a child process against a real
 * synthetic client input package and a real assembled P1 artifact, and asserts
 * the exact refusal code plus the state of the filesystem afterwards. Nothing
 * is stubbed: the source policy, the generator, the assembler and the
 * artifact's own handoff verifier all run.
 *
 * The fixture client is deliberately the repository's neutral authored fixture
 * rather than a real delivery. A proof client whose grammar leaks into the
 * bridge would be the "creative pack that copies one client's aesthetic"
 * failure arriving through the test suite.
 *
 *   pnpm exec tsx --test scripts/creative/premium-workflow.test.ts
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

import { assembleClientSourceArtifact } from "../../apps/managed-web/src/generation/index";
import * as generationIndex from "../../apps/managed-web/src/generation/index";
import * as sourcePolicy from "../../apps/managed-web/src/generation/client-experience-source-policy";

import { hashFile, listFiles } from "./atomic-output.mjs";
import { canonicalJson, sha256, validateRecord } from "./premium-contracts.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureRoot = join(repositoryRoot, "tests/fixtures/web01b/northline");
const legacyDefinition = join(
  repositoryRoot,
  "tests/fixtures/web01b/contractor/reference-client-website.json",
);
const legacyPublic = join(
  repositoryRoot,
  "apps/managed-web/client/examples/contractor/public",
);
const placeholderImage = join(legacyPublic, "assets/hero/primary.png");
const tsx = join(repositoryRoot, "node_modules/.bin/tsx");

const temporaryDirectories: string[] = [];

test.after(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      /* The published baseline is read-only by design, so make it removable
       * before cleaning up. Directories stay writable, which is why this works
       * at all and why an operator can still delete a workspace. */
      for (const path of await safeListFiles(directory)) {
        await chmod(join(directory, ...path.split("/")), 0o644).catch(() => {});
      }
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

async function safeListFiles(directory: string): Promise<string[]> {
  try {
    return await listFiles(directory);
  } catch {
    return [];
  }
}

async function temporary(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

interface CommandOutcome {
  readonly exitCode: number;
  readonly output: string;
}

/** Runs one of the premium commands exactly as `package.json` does. */
async function runPremiumCommand(
  script: string,
  argv: readonly string[],
  extraNodeArguments: readonly string[] = [],
): Promise<CommandOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      tsx,
      [...extraNodeArguments, join("scripts/creative", script), ...argv],
      { cwd: repositoryRoot, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) =>
      resolvePromise({ exitCode: code ?? -1, output }),
    );
  });
}

function assertRefused(outcome: CommandOutcome, code: string): void {
  assert.equal(
    outcome.exitCode,
    1,
    `expected a refusal, got exit ${outcome.exitCode}:\n${outcome.output}`,
  );
  assert.match(
    outcome.output,
    new RegExp(`REFUSED: ${code}\\b`),
    `expected ${code}:\n${outcome.output}`,
  );
}

async function assertAbsent(path: string): Promise<void> {
  await assert.rejects(
    stat(path),
    /ENOENT/,
    `${path} should not exist after a refusal`,
  );
}

/** No `.staging-` directory may survive a refusal or a success. */
async function assertNoStagingResidue(parent: string): Promise<void> {
  const entries = await readdir(parent).catch(() => [] as string[]);
  assert.deepEqual(
    entries.filter((entry) => entry.includes(".staging-")),
    [],
    `staging residue in ${parent}`,
  );
}

/**
 * A complete client input package: definition, authored experience, and a
 * public directory carrying every declared asset.
 */
async function buildClientInput(
  options: {
    readonly mutateDefinition?: (definition: Record<string, unknown>) => Record<string, unknown>;
    readonly legacy?: boolean;
  } = {},
): Promise<string> {
  const input = join(await temporary("premium-input-"), "client");
  await mkdir(input, { recursive: true });

  if (options.legacy === true) {
    await cp(legacyDefinition, join(input, "client-website.json"));
    await cp(legacyPublic, join(input, "public"), { recursive: true });
    return input;
  }

  const definition = JSON.parse(
    await readFile(join(fixtureRoot, "client-website.json"), "utf8"),
  ) as Record<string, unknown>;
  const finalDefinition =
    options.mutateDefinition === undefined
      ? definition
      : options.mutateDefinition(structuredClone(definition));
  await writeFile(
    join(input, "client-website.json"),
    `${JSON.stringify(finalDefinition, null, 2)}\n`,
  );
  await cp(join(fixtureRoot, "experience"), join(input, "experience"), {
    recursive: true,
  });
  for (const asset of finalDefinition.assets as { sourcePath: string }[]) {
    const destination = join(input, "public", ...asset.sourcePath.split("/"));
    await mkdir(dirname(destination), { recursive: true });
    await cp(placeholderImage, destination);
  }
  return input;
}

/** Assembles the artifact the ordinary way, with no premium code involved. */
async function assembleFor(input: string): Promise<string> {
  const output = join(await temporary("premium-artifact-"), "artifact");
  await assembleClientSourceArtifact({
    definition: JSON.parse(
      await readFile(join(input, "client-website.json"), "utf8"),
    ) as unknown,
    publicDirectory: join(input, "public"),
    inputDirectory: input,
    outputDirectory: output,
    factoryRevision: "premium-workflow-test",
  });
  return output;
}

async function outputPath(name: string): Promise<string> {
  return join(await temporary(`premium-out-${name}-`), name);
}

/* One valid input and artifact, shared by the cases that only need a
 * well-formed pair. Cases that mutate build their own. */
let sharedInput: string;
let sharedArtifact: string;

test.before(async () => {
  sharedInput = await buildClientInput();
  sharedArtifact = await assembleFor(sharedInput);
});

/* ------------------------------------------------------------ the P1 seam */

test("the generation index re-exports the Factory's validators rather than copying them", () => {
  assert.equal(
    generationIndex.inspectClientExperienceSource,
    sourcePolicy.inspectClientExperienceSource,
    "the premium bridge must call the same source policy the assembler does",
  );
  assert.equal(
    generationIndex.ClientExperienceSourcePolicyError,
    sourcePolicy.ClientExperienceSourcePolicyError,
  );
  assert.equal(typeof generationIndex.validateClientExperienceManifest, "function");
  assert.ok(Array.isArray(generationIndex.approvedClientExperienceDependencies));
});

/* ---------------------------------------------------------------- prepare */

test("prepare publishes a source-bound workspace from a matching input and artifact", async () => {
  const output = await outputPath("workspace");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
  ]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const manifest = JSON.parse(
    await readFile(join(output, "premium-workspace.json"), "utf8"),
  );
  assert.deepEqual(validateRecord("premium-workspace", manifest), []);
  assert.equal(manifest.client.clientId, "harbour-electrical");
  assert.equal(manifest.sourceBinding.experienceRoot, "source/experience");
  assert.equal(manifest.designMode.recommended, "B");
  assert.equal(manifest.provider.uploadPerformed, false);
  assert.equal(manifest.evidence.status, "MISSING");

  const files = await listFiles(output);
  assert.deepEqual(
    files.filter((path) => path.startsWith("delivery/")).sort(),
    manifest.delivery.requiredArtifacts.map((name: string) => `delivery/${name}`).sort(),
    "the workspace carries exactly the nine creative artifacts",
  );
  assert.ok(!files.includes("delivery/final-creative-gate.md"));

  /* The baseline is the live source, byte for byte. */
  for (const entry of manifest.sourceBinding.files) {
    const inWorkspace = await hashFile(
      join(output, "source/experience", ...entry.path.split("/")),
    );
    const live = await hashFile(join(sharedInput, "experience", ...entry.path.split("/")));
    assert.equal(inWorkspace, entry.sha256, entry.path);
    assert.equal(live, entry.sha256, entry.path);
  }

  /* Everything outside delivery/ is immutable and recorded. */
  const immutable = files.filter(
    (path) =>
      !path.startsWith("delivery/") &&
      path !== "premium-workspace.json" &&
      path !== "integrity.sha256",
  );
  assert.deepEqual([...manifest.integrity.allowlist].sort(), immutable.sort());
  await assertNoStagingResidue(dirname(output));
});

test("prepare's upload inventory is a positive allowlist that excludes internal records", async () => {
  const output = await outputPath("upload");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
  ]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const inventory = JSON.parse(
    await readFile(join(output, "provider/upload-inventory.json"), "utf8"),
  );
  assert.deepEqual(validateRecord("provider-upload-inventory", inventory), []);
  assert.equal(inventory.uploadPerformed, false);

  const paths = new Set(inventory.files.map((file: { path: string }) => file.path));
  for (const excluded of [
    "source/client-artifact.json",
    "premium-workspace.json",
    "integrity.sha256",
    "provider/upload-inventory.json",
    "provider/provider-preflight.template.json",
  ]) {
    assert.ok(!paths.has(excluded), `${excluded} must never be uploadable`);
  }

  /* The uploadable source set is exactly the bound source set. */
  const manifest = JSON.parse(
    await readFile(join(output, "premium-workspace.json"), "utf8"),
  );
  const uploadedSource = inventory.files
    .filter((file: { classification: string }) => file.classification === "CLIENT_SOURCE")
    .map((file: { path: string }) => file.path.slice("source/experience/".length))
    .sort();
  assert.deepEqual(
    uploadedSource,
    manifest.sourceBinding.files.map((entry: { path: string }) => entry.path).sort(),
  );

  /* Every hash in the inventory describes the file it names. */
  for (const file of inventory.files) {
    assert.equal(
      await hashFile(join(output, ...file.path.split("/"))),
      file.sha256,
      file.path,
    );
  }
});

test("no connector secret reference or recipient address reaches the workspace", async () => {
  const output = await outputPath("secrets");
  await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
  ]);

  const definition = JSON.parse(
    await readFile(join(sharedInput, "client-website.json"), "utf8"),
  );
  const forbidden = new Set<string>();
  for (const connector of definition.configuration.connectors) {
    if (typeof connector.secretReferenceId === "string") {
      forbidden.add(connector.secretReferenceId);
    }
    for (const recipient of connector.recipientAddresses ?? []) forbidden.add(recipient);
  }
  assert.ok(forbidden.size > 0, "the fixture must actually carry internal data to leak");

  for (const path of await listFiles(output)) {
    if (!/\.(md|json|tsx?|css|txt)$/.test(path)) continue;
    const contents = await readFile(join(output, ...path.split("/")), "utf8");
    for (const value of forbidden) {
      assert.ok(
        !contents.includes(value),
        `${path} carries "${value}", which is internal client data`,
      );
    }
  }
});

test("prepare performs no network activity", async () => {
  /* A spy rather than an assertion about the code: every outbound primitive is
   * replaced with a throw before the command starts, so an attempt is a crash
   * rather than something a reviewer has to notice in a diff. */
  const spyDirectory = await temporary("premium-netspy-");
  const spy = join(spyDirectory, "no-network.mjs");
  await writeFile(
    spy,
    [
      'import net from "node:net";',
      'import tls from "node:tls";',
      'import dns from "node:dns";',
      'import http from "node:http";',
      'import https from "node:https";',
      "const fail = (name) => () => {",
      "  throw new Error(`NETWORK_ATTEMPTED:${name}`);",
      "};",
      'net.Socket.prototype.connect = fail("net.Socket.connect");',
      'net.connect = fail("net.connect");',
      'net.createConnection = fail("net.createConnection");',
      'tls.connect = fail("tls.connect");',
      'dns.lookup = fail("dns.lookup");',
      'dns.promises.lookup = fail("dns.promises.lookup");',
      'http.request = fail("http.request");',
      'https.request = fail("https.request");',
      "",
    ].join("\n"),
  );

  const output = await outputPath("nonetwork");
  const outcome = await runPremiumCommand(
    "prepare-premium.ts",
    ["--input", sharedInput, "--artifact", sharedArtifact, "--output", output],
    ["--import", spy],
  );
  assert.equal(outcome.exitCode, 0, outcome.output);
  assert.ok(
    !outcome.output.includes("NETWORK_ATTEMPTED"),
    `prepare attempted a network call:\n${outcome.output}`,
  );
  assert.ok(await stat(join(output, "premium-workspace.json")));
});

test("one changed byte in the live experience is refused as stale source", async () => {
  const input = await buildClientInput();
  const artifact = await assembleFor(input);
  const routePath = join(input, "experience/routes/HomeRoute.tsx");
  const original = await readFile(routePath, "utf8");
  await writeFile(routePath, `${original}\n/* one byte later */\n`);

  const output = await outputPath("stale");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    input,
    "--artifact",
    artifact,
    "--output",
    output,
  ]);
  assertRefused(outcome, "STALE_SOURCE");
  assert.match(outcome.output, /routes\/HomeRoute\.tsx/);
  assert.match(outcome.output, /Assemble a new artifact/);
  await assertAbsent(output);
  await assertNoStagingResidue(dirname(output));
});

test("an artifact belonging to another client is refused by identity", async () => {
  const other = await buildClientInput({
    mutateDefinition: (definition) => {
      const configuration = definition.configuration as Record<string, unknown>;
      configuration.clientId = "other-client";
      configuration.configurationId = "configuration-other-client";
      configuration.deploymentId = "deployment-other-client";
      configuration.entitlementId = "entitlement-other-client";
      return definition;
    },
  });
  const foreignArtifact = await assembleFor(other);

  const output = await outputPath("foreign");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    foreignArtifact,
    "--output",
    output,
  ]);
  assertRefused(outcome, "IDENTITY_MISMATCH");
  assert.match(outcome.output, /clientId differs/);
  await assertAbsent(output);
});

test("a tampered artifact is refused by its own handoff verifier", async () => {
  const artifact = await temporary("premium-tampered-");
  await cp(sharedArtifact, join(artifact, "artifact"), { recursive: true });
  const tampered = join(artifact, "artifact");
  const runtimeFile = join(tampered, "source/src/client-experience/contract.tsx");
  await writeFile(runtimeFile, `${await readFile(runtimeFile, "utf8")}\n// tampered\n`);

  const output = await outputPath("tampered");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    tampered,
    "--output",
    output,
  ]);
  assertRefused(outcome, "ARTIFACT_INTEGRITY_FAILED");
  assert.match(outcome.output, /handoff integrity FAILED|changed:/);
  await assertAbsent(output);
});

test("an artifact whose descriptor is honest but whose copied source is not is refused", async () => {
  const artifact = await temporary("premium-copy-drift-");
  await cp(sharedArtifact, join(artifact, "artifact"), { recursive: true });
  const drifted = join(artifact, "artifact");

  /* Change the authored copy *and* the handoff manifest entry for it, so the
   * artifact's own verifier still passes. Only the descriptor's source hash
   * now disagrees, which is the attack this check exists for. */
  const copiedRoute = "src/client-experience/authored/routes/HomeRoute.tsx";
  const copiedPath = join(drifted, "source", ...copiedRoute.split("/"));
  const replacement = `${await readFile(copiedPath, "utf8")}\n/* swapped after assembly */\n`;
  await writeFile(copiedPath, replacement);

  const handoffPath = join(drifted, "source/handoff-manifest.json");
  const handoff = JSON.parse(await readFile(handoffPath, "utf8"));
  const entry = handoff.files.find((file: { path: string }) => file.path === copiedRoute);
  assert.ok(entry, "the artifact must list its authored source");
  entry.sha256 = sha256(replacement);
  entry.size = Buffer.byteLength(replacement);
  await writeFile(handoffPath, `${JSON.stringify(handoff, null, 2)}\n`);
  await writeFile(
    join(drifted, "source/handoff-manifest.sha256"),
    `${sha256(await readFile(handoffPath, "utf8"))}  handoff-manifest.json\n`,
  );

  const output = await outputPath("copydrift");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    drifted,
    "--output",
    output,
  ]);
  assertRefused(outcome, "ARTIFACT_INTEGRITY_FAILED");
  assert.match(outcome.output, /Different bytes|routes\/HomeRoute\.tsx/);
  await assertAbsent(output);
});

test("a definition change that leaves the experience untouched is still refused", async () => {
  const input = await buildClientInput();
  const artifact = await assembleFor(input);

  /* Business copy only: no experience byte moves, no identity field moves, and
   * the source set is unchanged. Only the generated snapshot differs. */
  const definitionPath = join(input, "client-website.json");
  const definition = JSON.parse(await readFile(definitionPath, "utf8"));
  const section = definition.profile.sections.find(
    (candidate: { heading?: string }) => typeof candidate.heading === "string",
  );
  section.heading = `${section.heading} (revised after assembly)`;
  await writeFile(definitionPath, `${JSON.stringify(definition, null, 2)}\n`);

  const output = await outputPath("snapshotdrift");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    input,
    "--artifact",
    artifact,
    "--output",
    output,
  ]);
  assertRefused(outcome, "GENERATED_SNAPSHOT_STALE");
  await assertAbsent(output);
});

test("source the policy refuses never reaches a workspace", async () => {
  const input = await buildClientInput();
  const artifact = await assembleFor(input);
  const routePath = join(input, "experience/routes/HomeRoute.tsx");
  await writeFile(
    routePath,
    `${await readFile(routePath, "utf8")}\nexport const fetched = () => fetch("https://example.com/data.json");\n`,
  );

  const output = await outputPath("policy");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    input,
    "--artifact",
    artifact,
    "--output",
    output,
  ]);
  assertRefused(outcome, "SOURCE_POLICY_REFUSED");
  assert.match(outcome.output, /NETWORK_ACCESS_FORBIDDEN/);
  await assertAbsent(output);
});

test("a legacy client has no authored source to evolve", async () => {
  const input = await buildClientInput({ legacy: true });
  const output = await outputPath("legacy");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    input,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
  ]);
  assertRefused(outcome, "AUTHORED_SOURCE_REQUIRED");
  await assertAbsent(output);
});

test("an existing output is never overwritten", async () => {
  const output = await outputPath("occupied");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "previous-run.json"), "{}\n");

  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
  ]);
  assertRefused(outcome, "OUTPUT_NOT_EMPTY");
  assert.deepEqual(await listFiles(output), ["previous-run.json"]);
});

test("prepare refuses arguments it does not understand", async () => {
  assertRefused(
    await runPremiumCommand("prepare-premium.ts", ["--input", sharedInput]),
    "ARGUMENTS_INVALID",
  );
  assertRefused(
    await runPremiumCommand("prepare-premium.ts", [
      "--input",
      sharedInput,
      "--artifact",
      sharedArtifact,
      "--output",
      await outputPath("badmode"),
      "--design-mode",
      "Z",
    ]),
    "ARGUMENTS_INVALID",
  );
  assertRefused(
    await runPremiumCommand("prepare-premium.ts", ["--client", "harbour-electrical"]),
    "ARGUMENTS_INVALID",
  );
});

/* -------------------------------------------------------- baseline evidence */

async function writeBaselineManifest(
  directory: string,
  binding: { artifactId: string; sourceSetId: string },
  options: { readonly corruptHash?: boolean } = {},
): Promise<string> {
  await mkdir(join(directory, "baseline"), { recursive: true });
  const capturePath = join(directory, "baseline/home-1440.png");
  await cp(placeholderImage, capturePath);
  const manifest = {
    schemaVersion: 1,
    kind: "P1_BASELINE_EVIDENCE",
    artifactId: binding.artifactId,
    sourceSetId: binding.sourceSetId,
    capturedAt: "2026-08-19T00:00:00Z",
    captures: [
      {
        path: "baseline/home-1440.png",
        sha256:
          options.corruptHash === true
            ? "0".repeat(64)
            : sha256(await readFile(capturePath)),
        route: "/",
        state: "opening",
        viewportWidth: 1440,
        motion: "FULL",
      },
    ],
  };
  const manifestPath = join(directory, "baseline-evidence.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifestPath;
}

async function workspaceIdentity(): Promise<{ artifactId: string; sourceSetId: string }> {
  const output = await outputPath("identity");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
  ]);
  assert.equal(outcome.exitCode, 0, outcome.output);
  const manifest = JSON.parse(
    await readFile(join(output, "premium-workspace.json"), "utf8"),
  );
  return {
    artifactId: manifest.sourceBinding.artifactId,
    sourceSetId: manifest.sourceBinding.sourceSetId,
  };
}

test("baseline captures bound to this artifact become uploadable evidence", async () => {
  const identity = await workspaceIdentity();
  const evidenceDirectory = await temporary("premium-baseline-");
  const manifestPath = await writeBaselineManifest(evidenceDirectory, identity);

  const output = await outputPath("bound");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
    "--baseline-manifest",
    manifestPath,
  ]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const manifest = JSON.parse(
    await readFile(join(output, "premium-workspace.json"), "utf8"),
  );
  assert.equal(manifest.evidence.status, "BOUND");
  assert.deepEqual(manifest.evidence.widths, [1440]);
  assert.equal(manifest.evidence.reducedMotion, false);

  const inventory = JSON.parse(
    await readFile(join(output, "provider/upload-inventory.json"), "utf8"),
  );
  assert.ok(
    inventory.files.some(
      (file: { classification: string }) => file.classification === "P1_EVIDENCE",
    ),
  );
});

test("captures taken from another build cannot support a gate", async () => {
  const evidenceDirectory = await temporary("premium-stale-baseline-");
  const manifestPath = await writeBaselineManifest(evidenceDirectory, {
    artifactId: "a".repeat(64),
    sourceSetId: "b".repeat(64),
  });

  const output = await outputPath("unbound");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
    "--baseline-manifest",
    manifestPath,
  ]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const manifest = JSON.parse(
    await readFile(join(output, "premium-workspace.json"), "utf8"),
  );
  assert.equal(manifest.evidence.status, "UNBOUND_REFUSED");
  assert.match(manifest.evidence.reason, /artifact/);

  const files = await listFiles(output);
  assert.deepEqual(
    files.filter((path) => path.startsWith("evidence/")),
    [],
    "unusable captures are not carried into the workspace",
  );
  const inventory = JSON.parse(
    await readFile(join(output, "provider/upload-inventory.json"), "utf8"),
  );
  assert.ok(
    !inventory.files.some(
      (file: { classification: string }) => file.classification === "P1_EVIDENCE",
    ),
  );
});

test("a capture whose bytes do not match its manifest is refused outright", async () => {
  const identity = await workspaceIdentity();
  const evidenceDirectory = await temporary("premium-corrupt-baseline-");
  const manifestPath = await writeBaselineManifest(evidenceDirectory, identity, {
    corruptHash: true,
  });

  const output = await outputPath("corrupt");
  const outcome = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    sharedInput,
    "--artifact",
    sharedArtifact,
    "--output",
    output,
    "--baseline-manifest",
    manifestPath,
  ]);
  assertRefused(outcome, "BASELINE_UNBOUND");
  await assertAbsent(output);
});

test("preparing the same inputs twice produces the same identities", async () => {
  const first = await outputPath("idempotent-a");
  const second = await outputPath("idempotent-b");
  for (const output of [first, second]) {
    const outcome = await runPremiumCommand("prepare-premium.ts", [
      "--input",
      sharedInput,
      "--artifact",
      sharedArtifact,
      "--output",
      output,
    ]);
    assert.equal(outcome.exitCode, 0, outcome.output);
  }
  const read = async (output: string) =>
    JSON.parse(await readFile(join(output, "premium-workspace.json"), "utf8"));
  const left = await read(first);
  const right = await read(second);
  assert.equal(left.workspaceId, right.workspaceId);
  assert.equal(canonicalJson(left), canonicalJson(right));
});

/* ----------------------------------------------------------------- launch */

/**
 * A client input inside its own Git repository.
 *
 * `creative:launch` records the baseline of the repository that holds the
 * production target, so a launch fixture needs a real repository with a real
 * commit. Building one per test also means the dirty-worktree case can be
 * proved without touching the repository this tooling lives in.
 */
async function repositoryWithInput(input: string): Promise<{
  readonly root: string;
  readonly input: string;
  readonly revision: string;
}> {
  const root = await temporary("premium-repo-");
  const inputDirectory = join(root, "clients/harbour-electrical");
  await mkdir(dirname(inputDirectory), { recursive: true });
  await cp(input, inputDirectory, { recursive: true });
  const git = async (...argv: string[]) => {
    const outcome = await runGit(root, argv);
    assert.equal(outcome.exitCode, 0, `git ${argv.join(" ")}: ${outcome.output}`);
    return outcome.output.trim();
  };
  await git("init", "-b", "main");
  await git("config", "user.email", "fixture@example.invalid");
  await git("config", "user.name", "Fixture");
  await git("add", "-A");
  await git("commit", "-m", "client input");
  return { root, input: inputDirectory, revision: await git("rev-parse", "HEAD") };
}

async function runGit(cwd: string, argv: readonly string[]): Promise<CommandOutcome> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn("git", [...argv], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => resolvePromise({ exitCode: code ?? -1, output }));
  });
}

/* ------------------------------------------------- delivery fixture writer */

type FrontMatter = Record<string, string | string[]>;

function renderArtifact(frontMatter: FrontMatter, sections: Record<string, string>): string {
  const lines: string[] = ["---"];
  for (const [key, value] of Object.entries(frontMatter)) {
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  lines.push("---", "");
  for (const [heading, body] of Object.entries(sections)) {
    lines.push(`## ${heading}`, "", body, "");
  }
  return `${lines.join("\n")}\n`;
}

function filled(headings: readonly string[], overrides: Record<string, string> = {}) {
  const sections: Record<string, string> = {};
  for (const heading of headings) {
    sections[heading] = overrides[heading] ?? `Filled content for ${heading}.`;
  }
  return sections;
}

const DELTA_ROWS = [
  "| Disposition | Scope | Intent | Why | Production home |",
  "|---|---|---|---|---|",
  "| EVOLVE | experience/routes/HomeRoute.tsx opening | Replace the static opening with the surveyed-ground sequence | The thesis is that the ground is surveyed before it is built on, and a static opening states nothing about that | experience/routes/HomeRoute.tsx |",
  "| KEEP | experience/routes/ContactRoute.tsx | Leave the conversion path as it stands | It already carries the proof the intent depends on and changing it would cost trust for no gain | P1_REUSE |",
].join("\n");

interface DeliveryOverrides {
  readonly gate?: FrontMatter;
  readonly gateSections?: Record<string, string>;
  readonly handoff?: FrontMatter;
  readonly handoffSections?: Record<string, string>;
  readonly sliceSections?: Record<string, string>;
  readonly client?: string;
  readonly dropHandoffSection?: string;
}

/**
 * Fills a prepared workspace's nine artifacts with a delivery that passes
 * `creative:validate`, binding the handoff to that workspace's own identities.
 */
async function fillDelivery(
  workspace: string,
  overrides: DeliveryOverrides = {},
): Promise<Record<string, unknown>> {
  const manifest = JSON.parse(
    await readFile(join(workspace, "premium-workspace.json"), "utf8"),
  ) as Record<string, never>;
  const binding = manifest.sourceBinding as unknown as {
    artifactId: string;
    sourceSetId: string;
  };
  const client = overrides.client ?? "harbour-electrical";
  const delivery = join(workspace, "delivery");

  const write = async (name: string, text: string) => {
    await chmod(join(delivery, name), 0o644).catch(() => {});
    await writeFile(join(delivery, name), text);
  };

  await write(
    "creative-intent.md",
    renderArtifact(
      {
        kind: "creative-intent",
        client,
        status: "READY_FOR_TERRITORIES",
        anti_targets: ["generic trade template"],
        perception_targets: ["precise", "unhurried"],
      },
      filled([
        "Customer truth",
        "Business truth",
        "Desired perception",
        "Primary conversion",
        "Creative thesis seed",
        "Productive tension",
        "What should remain quiet",
        "What may become Signature material",
        "Anti-targets",
        "References",
      ]),
    ),
  );

  const territoryIds = ["alpha", "beta", "gamma"];
  for (const [index, id] of territoryIds.entries()) {
    await write(
      `territory-${index + 1}.md`,
      renderArtifact(
        {
          kind: "creative-territory",
          client,
          territory: id,
          thesis: `Thesis ${id}`,
          intent: "creative-intent.md",
          bespoke: "true",
          materially_different_from: territoryIds.filter((other) => other !== id),
        },
        filled([
          "Thesis",
          "Why this belongs to the client",
          "Typography",
          "Spatial and composition logic",
          "Media and art direction",
          "Movement and interaction character",
          "Signature idea",
          "P1 inheritance",
          "Intentional rewrite",
          "Mobile translation",
          "Conversion continuity",
          "Performance and accessibility risks",
          "Reference delta",
          "Why this is materially different",
        ]),
      ),
    );
  }

  await write(
    "signature-slice.md",
    renderArtifact(
      {
        kind: "signature-slice",
        client,
        selected_territory: "alpha",
        territory: "territory-1.md",
        covers: ["navigation", "opening", "proof", "conversion"],
        techniques: ["css-scroll-driven-animation"],
        prototype_fakes: ["placeholder project photography"],
      },
      filled(
        [
          "Creative thesis expressed",
          "Real content and media inputs",
          "Spatial narrative",
          "Interaction and movement sequence",
          "Desktop",
          "Mobile",
          "Reduced motion",
          "Production feasibility",
          "P1 capabilities reused",
          "Client-local Signature work",
          "Prototype shortcuts that must not reach production",
        ],
        overrides.sliceSections ?? {},
      ),
    ),
  );

  await write(
    "creative-gate.md",
    renderArtifact(
      {
        kind: "creative-gate",
        client,
        decision: "PASS_WITH_NAMED_FIXES",
        decided_by: "Khoa Vo",
        decided_on: "2026-08-19",
        candidate_commit: "abc1234",
        candidate: "signature-slice.md",
        ...(overrides.gate ?? {}),
      },
      filled(["Decision", "Named fixes", "Evidence reviewed"], {
        "Named fixes": "- Raise the 390px conversion above the fold",
        ...(overrides.gateSections ?? {}),
      }),
    ),
  );

  const handoffHeadings = [
    "Creative intent carried forward",
    "Signature thesis",
    "Production delta",
    "Behaviour and movement intent",
    "Responsive intent",
    "Media provenance",
    "Production constraints",
    "P1 capabilities to reuse",
    "Client-local bespoke work",
    "Performance, accessibility and reduced motion",
    "What the prototype fakes",
    "Acceptance evidence",
    "Translation delta",
  ].filter((heading) => heading !== overrides.dropHandoffSection);

  await write(
    "production-handoff.md",
    renderArtifact(
      {
        kind: "production-handoff",
        client,
        selected_territory: "alpha",
        prototype_tool: "local prototype",
        prototype_artifacts: ["exports/slice-desktop.png"],
        techniques: ["css-scroll-driven-animation"],
        p1_capabilities_reused: ["Platform Image focal behaviour"],
        prototype_fakes: ["placeholder project photography"],
        gate: "creative-gate.md",
        slice: "signature-slice.md",
        named_fixes: ["Raise the 390px conversion above the fold"],
        workspace_manifest: "../premium-workspace.json",
        source_artifact_id: binding.artifactId,
        source_set_id: binding.sourceSetId,
        ...(overrides.handoff ?? {}),
      },
      filled(handoffHeadings, {
        "Production delta": DELTA_ROWS,
        "Translation delta": "",
        ...(overrides.handoffSections ?? {}),
      }),
    ),
  );

  await write(
    "media-plan.md",
    renderArtifact({ kind: "media-plan", client }, {
      Assets: [
        "| Asset | Provenance class | Substantiates | Approved by |",
        "|---|---|---|---|",
        "| hero/primary.png | REAL_CLIENT_EVIDENCE | completed switchboard work | Khoa Vo |",
      ].join("\n"),
      Approval: "Approved by Khoa Vo on 2026-08-19.",
    }),
  );

  await write(
    "promotion-ledger.md",
    renderArtifact({ kind: "promotion-ledger", client }, {
      Ledger: [
        "| Mechanic | Clients observed | Invariant substrate | Current home | Decision | Reason |",
        "|---|---|---|---|---|---|",
        "| surveyed-ground opening | harbour-electrical | - | client-local | CLIENT_LOCAL_SIGNATURE | one delivery |",
      ].join("\n"),
      "Promotion rule": "Promotion needs the same mechanic, needed twice, on an invariant substrate.",
    }),
  );

  return manifest;
}

/** A prepared workspace inside a fresh repository, with a valid delivery. */
async function preparedForLaunch(
  overrides: DeliveryOverrides = {},
  designMode?: string,
): Promise<{
  readonly repository: { root: string; input: string; revision: string };
  readonly artifact: string;
  readonly workspace: string;
  readonly manifest: Record<string, unknown>;
}> {
  const repository = await repositoryWithInput(sharedInput);
  const artifact = await assembleFor(repository.input);
  const workspace = await outputPath("launch-workspace");
  const prepared = await runPremiumCommand("prepare-premium.ts", [
    "--input",
    repository.input,
    "--artifact",
    artifact,
    "--output",
    workspace,
    ...(designMode === undefined ? [] : ["--design-mode", designMode]),
  ]);
  assert.equal(prepared.exitCode, 0, prepared.output);
  const manifest = await fillDelivery(workspace, overrides);
  return { repository, artifact, workspace, manifest };
}

async function launch(
  fixture: { repository: { input: string }; artifact: string; workspace: string },
  output: string,
  extra: readonly string[] = [],
): Promise<CommandOutcome> {
  return runPremiumCommand("launch-production.ts", [
    "--workspace",
    fixture.workspace,
    "--input",
    fixture.repository.input,
    "--artifact",
    fixture.artifact,
    "--output",
    output,
    ...extra,
  ]);
}

test("launch freezes an approved delivery into a pack a fresh agent can execute", async () => {
  const fixture = await preparedForLaunch();
  const output = await outputPath("launch");
  const outcome = await launch(fixture, output);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const manifest = JSON.parse(await readFile(join(output, "production-launch.json"), "utf8"));
  assert.deepEqual(validateRecord("production-launch", manifest), []);
  assert.equal(manifest.workspaceId, (fixture.manifest as { workspaceId: string }).workspaceId);
  assert.equal(manifest.repositoryBaseline.branch, "main");
  assert.equal(manifest.repositoryBaseline.sourceRevision, fixture.repository.revision);
  assert.equal(manifest.repositoryBaseline.worktreeClean, true);
  assert.equal(manifest.handoff.sliceGateDecision, "PASS_WITH_NAMED_FIXES");
  assert.equal(manifest.handoff.gateDecidedBy, "Khoa Vo");
  assert.deepEqual(manifest.handoff.namedFixes, ["Raise the 390px conversion above the fold"]);
  assert.equal(manifest.approvedDependencyChanges.length, 0);
  assert.equal(manifest.humanCreativeDecision, "REQUIRED_SEPARATELY");

  /* The production target is the same client's live experience tree, named
   * relative to the repository that holds it. */
  assert.equal(manifest.productionTarget.experienceRoot, "clients/harbour-electrical/experience");
  assert.equal(manifest.productionTarget.inputInsideRepository, true);
  assert.equal(manifest.client.clientId, "harbour-electrical");

  /* The pack carries the delivery byte for byte. */
  for (const name of ["creative-intent.md", "production-handoff.md", "creative-gate.md"]) {
    assert.equal(
      await hashFile(join(output, "inputs", name)),
      await hashFile(join(fixture.workspace, "delivery", name)),
      name,
    );
  }

  /* Everything is inventoried and nothing is editable. */
  const files = await listFiles(output);
  assert.deepEqual(
    [...manifest.integrity.allowlist].sort(),
    files.filter((path) => path !== "production-launch.json" && path !== "integrity.sha256").sort(),
  );
  for (const path of files) {
    const mode = (await stat(join(output, path))).mode & 0o222;
    assert.equal(mode, 0, `${path} is writable; a launch pack is frozen`);
  }
  await assertNoStagingResidue(dirname(output));
});

test("the launch manifest records a location, never the machine it was built on", async () => {
  const fixture = await preparedForLaunch();
  const output = await outputPath("portable");
  const portable = await launch(fixture, output);
  assert.equal(portable.exitCode, 0, portable.output);

  const text = await readFile(join(output, "production-launch.json"), "utf8");
  for (const marker of [tmpdir(), "/home/", "/Users/", fixture.repository.root]) {
    assert.ok(!text.includes(marker), `production-launch.json leaks ${marker}`);
  }
  const manifest = JSON.parse(text);
  assert.deepEqual(validateRecord("production-launch", manifest), []);
});

test("a fresh agent's prompt answers where, what, and when to stop", async () => {
  const fixture = await preparedForLaunch();
  const output = await outputPath("prompt");
  const promptOutcome = await launch(fixture, output);
  assert.equal(promptOutcome.exitCode, 0, promptOutcome.output);

  const prompt = await readFile(join(output, "PRODUCTION_AGENT_PROMPT.md"), "utf8");
  const manifest = JSON.parse(await readFile(join(output, "production-launch.json"), "utf8"));

  /* Where. */
  assert.match(prompt, /clients\/harbour-electrical\/experience/);
  assert.ok(prompt.includes(fixture.repository.revision), "names the baseline revision");
  assert.match(prompt, /\bmain\b/);

  /* What, and on whose authority. */
  assert.match(prompt, /Raise the 390px conversion above the fold/);
  assert.match(prompt, /Khoa Vo/);
  assert.match(prompt, /never authoritative/i);
  assert.match(prompt, /reduced.motion/i);
  assert.match(prompt, /1440, 834, 390 and 320/);

  /* When to stop, and that it cannot decide. */
  for (const condition of manifest.stopConditions) {
    assert.ok(prompt.includes(condition), `prompt omits stop condition: ${condition}`);
  }
  for (const prohibition of manifest.prohibitedChanges) {
    assert.ok(prompt.includes(prohibition), `prompt omits prohibition: ${prohibition}`);
  }
  assert.match(prompt, /You do not make that decision/);
});

test("a live experience changed after preparation is refused, not launched", async () => {
  const fixture = await preparedForLaunch();
  const target = join(fixture.repository.input, "experience/routes/HomeRoute.tsx");
  await writeFile(target, `${await readFile(target, "utf8")}\n// drift\n`);
  await runGit(fixture.repository.root, ["commit", "-am", "drift"]);

  const output = await outputPath("stale-launch");
  assertRefused(await launch(fixture, output), "STALE_SOURCE");
  await assertAbsent(output);
});

test("an edited workspace baseline cannot be laundered into a launch", async () => {
  const fixture = await preparedForLaunch();
  const baseline = join(fixture.workspace, "source/experience/routes/HomeRoute.tsx");
  await chmod(baseline, 0o644);
  await writeFile(baseline, `${await readFile(baseline, "utf8")}\n/* edited */\n`);

  const output = await outputPath("tampered-workspace");
  assertRefused(await launch(fixture, output), "WORKSPACE_TAMPERED");
  await assertAbsent(output);
});

test("an uncommitted worktree has no baseline to diff a candidate against", async () => {
  const fixture = await preparedForLaunch();
  await writeFile(join(fixture.repository.root, "uncommitted.txt"), "work in progress\n");

  const output = await outputPath("dirty");
  assertRefused(await launch(fixture, output), "WORKTREE_DIRTY");
  await assertAbsent(output);
});

test("a failed gate does not reach production", async () => {
  const fixture = await preparedForLaunch({
    gate: { decision: "FAIL" },
    gateSections: { "Named fixes": "- The opening does not carry the thesis" },
  });
  const output = await outputPath("failed-gate");
  assertRefused(await launch(fixture, output), "GATE_FAILED");
  await assertAbsent(output);
});

test("an agent cannot sign the gate that authorises its own work", async () => {
  const fixture = await preparedForLaunch({ gate: { decided_by: "Claude Opus" } });
  const output = await outputPath("agent-gate");
  assertRefused(await launch(fixture, output), "HUMAN_GATE_REQUIRED");
  await assertAbsent(output);
});

test("a named fix that never reached the handoff blocks the launch", async () => {
  const fixture = await preparedForLaunch({
    gateSections: {
      "Named fixes": "- Raise the 390px conversion above the fold\n- Give the proof sequence a reduced-motion state",
    },
  });
  const output = await outputPath("named-fixes");
  assertRefused(await launch(fixture, output), "NAMED_FIXES_MISSING");
  await assertAbsent(output);
});

test("a production delta row that says what but not why is refused", async () => {
  const fixture = await preparedForLaunch({
    handoffSections: {
      "Production delta": [
        "| Disposition | Scope | Intent | Why | Production home |",
        "|---|---|---|---|---|",
        "| EVOLVE | experience/routes/HomeRoute.tsx | Rebuild the opening | match the design | experience/routes/HomeRoute.tsx |",
      ].join("\n"),
    },
  });
  const output = await outputPath("why-missing");
  assertRefused(await launch(fixture, output), "HANDOFF_WHY_MISSING");
  await assertAbsent(output);
});

test("production work cannot be sent outside this client's experience tree", async () => {
  const fixture = await preparedForLaunch({
    handoffSections: {
      "Production delta": [
        "| Disposition | Scope | Intent | Why | Production home |",
        "|---|---|---|---|---|",
        "| EVOLVE | the shared heading rhythm | Tighten the display scale across the platform | The thesis needs a tighter vertical rhythm than the current default gives it | packages/site-core/src/platform/Heading.tsx |",
      ].join("\n"),
    },
  });
  const output = await outputPath("forbidden-home");
  assertRefused(await launch(fixture, output), "PRODUCTION_HOME_FORBIDDEN");
  await assertAbsent(output);
});

test("a slice with no designed reduced-motion state is refused by name", async () => {
  const fixture = await preparedForLaunch({ sliceSections: { "Reduced motion": "<!-- -->" } });
  const output = await outputPath("reduced-motion");
  assertRefused(await launch(fixture, output), "REDUCED_MOTION_MISSING");
  await assertAbsent(output);
});

test("a handoff written against different source cannot launch this workspace", async () => {
  const fixture = await preparedForLaunch({
    handoff: { source_set_id: "c".repeat(64) },
  });
  const output = await outputPath("wrong-source-set");
  assertRefused(await launch(fixture, output), "ARTIFACT_MISMATCH");
  await assertAbsent(output);
});

test("a delivery that names another client is not this client's delivery", async () => {
  const fixture = await preparedForLaunch({ client: "northline-joinery" });
  const output = await outputPath("foreign-client");
  assertRefused(await launch(fixture, output), "CROSS_CLIENT_LEAKAGE");
  await assertAbsent(output);
});

test("production has nowhere to record the translation delta if the heading is gone", async () => {
  const fixture = await preparedForLaunch({ dropHandoffSection: "Translation delta" });
  const output = await outputPath("no-translation-delta");
  assertRefused(await launch(fixture, output), "TRANSLATION_DELTA_MISSING");
  await assertAbsent(output);
});

test("an asset cannot substantiate a claim its provenance cannot carry", async () => {
  const fixture = await preparedForLaunch();
  await writeFile(
    join(fixture.workspace, "delivery/media-plan.md"),
    renderArtifact({ kind: "media-plan", client: "harbour-electrical" }, {
      Assets: [
        "| Asset | Provenance class | Substantiates | Approved by |",
        "|---|---|---|---|",
        "| hero/primary.png | AI_GENERATED_CREATIVE | completed switchboard work | Khoa Vo |",
      ].join("\n"),
      Approval: "Approved by Khoa Vo on 2026-08-19.",
    }),
  );
  const output = await outputPath("media-claim");
  assertRefused(await launch(fixture, output), "MEDIA_CLAIM_UNSUPPORTED");
  await assertAbsent(output);
});

test("an existing launch output is never overwritten", async () => {
  const fixture = await preparedForLaunch();
  const output = await outputPath("launch-existing");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "notes.md"), "someone else's evidence\n");
  assertRefused(await launch(fixture, output), "OUTPUT_NOT_EMPTY");
  assert.equal(await readFile(join(output, "notes.md"), "utf8"), "someone else's evidence\n");
});

/* ------------------------------------------------------- provider boundary */

/**
 * A completed provider evidence manifest — the record a human fills in before
 * anything leaves the local boundary, and the same record launch reads back.
 */
async function providerEvidence(
  fixture: { workspace: string; manifest: Record<string, unknown> },
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const manifest = fixture.manifest as unknown as {
    workspaceId: string;
    sourceBinding: { artifactId: string; sourceSetId: string };
  };
  const record = {
    schemaVersion: 1,
    kind: "CREATIVE_PROVIDER_EVIDENCE",
    provider: "CLAUDE_DESIGN",
    projectLabel: "harbour-electrical signature exploration",
    designMode: "B",
    binding: {
      workspaceId: manifest.workspaceId,
      artifactId: manifest.sourceBinding.artifactId,
      sourceSetId: manifest.sourceBinding.sourceSetId,
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
        label: "opening sequence exploration",
        purpose: "shows the surveyed-ground motion the slice describes",
        content: "MOTION",
        carriesNoNewBusinessFact: true,
      },
    ],
    ...overrides,
  };
  const file = join(await temporary("premium-vendor-"), "provider-evidence.json");
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

test("bound provider evidence travels as evidence, never as authority", async () => {
  const fixture = await preparedForLaunch();
  const evidence = await providerEvidence(fixture);
  const output = await outputPath("vendor-bound");
  const outcome = await launch(fixture, output, ["--vendor-evidence", evidence]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const manifest = JSON.parse(await readFile(join(output, "production-launch.json"), "utf8"));
  assert.deepEqual(validateRecord("production-launch", manifest), []);
  assert.equal(manifest.provider.evidenceSupplied, true);
  assert.equal(manifest.provider.authority, "NON_AUTHORITATIVE");
  assert.equal(manifest.provider.path, "inputs/provider-evidence-manifest.json");

  const frozen = JSON.parse(
    await readFile(join(output, "inputs/provider-evidence-manifest.json"), "utf8"),
  );
  assert.equal(frozen.binding.workspaceId, (fixture.manifest as { workspaceId: string }).workspaceId);

  const index = JSON.parse(await readFile(join(output, "evidence-index.json"), "utf8"));
  assert.equal(index.providerEvidence.authority, "NON_AUTHORITATIVE");
  assert.deepEqual(index.requiredFromProduction.viewportWidths, [1440, 834, 390, 320]);
});

test("an export produced against a different substrate cannot support this decision", async () => {
  const fixture = await preparedForLaunch();
  const evidence = await providerEvidence(fixture, {
    binding: {
      workspaceId: "d".repeat(64),
      artifactId: "e".repeat(64),
      sourceSetId: "f".repeat(64),
      slice: "signature-slice.md",
      gate: "creative-gate.md",
    },
  });
  const output = await outputPath("vendor-unbound");
  assertRefused(
    await launch(fixture, output, ["--vendor-evidence", evidence]),
    "VENDOR_EVIDENCE_UNBOUND",
  );
  await assertAbsent(output);
});

test("an inherited design system that is not this client's does not enter production", async () => {
  const fixture = await preparedForLaunch();
  const evidence = await providerEvidence(fixture, {
    designSystemAttestation: {
      status: "FOREIGN_OR_UNKNOWN_BLOCKED",
      attestedBy: "Khoa Vo",
      attestedOn: "2026-08-19",
    },
  });
  const output = await outputPath("foreign-design-system");
  assertRefused(
    await launch(fixture, output, ["--vendor-evidence", evidence]),
    "FOREIGN_DESIGN_SYSTEM",
  );
  await assertAbsent(output);
});

test("Mode A claims a client-scoped design system and must prove one", async () => {
  const fixture = await preparedForLaunch({}, "A");
  const output = await outputPath("mode-a-unattested");
  assertRefused(await launch(fixture, output), "FOREIGN_DESIGN_SYSTEM");
  await assertAbsent(output);

  const attested = await providerEvidence(fixture, {
    designMode: "A",
    designSystemAttestation: {
      status: "CLIENT_SCOPED",
      designSystemId: "harbour-electrical-brand",
      brandScope: "harbour-electrical",
      attestedBy: "Khoa Vo",
      attestedOn: "2026-08-19",
    },
  });
  const second = await outputPath("mode-a-attested");
  const attestedOutcome = await launch(fixture, second, ["--vendor-evidence", attested]);
  assert.equal(attestedOutcome.exitCode, 0, attestedOutcome.output);
});

test("an agent cannot approve its own upload", async () => {
  const fixture = await preparedForLaunch();
  const evidence = await providerEvidence(fixture, {
    dataHandlingApproval: {
      approvedBy: "Claude Code",
      approvedOn: "2026-08-19",
      retentionUnderstood: true,
    },
  });
  const output = await outputPath("data-handling");
  assertRefused(
    await launch(fixture, output, ["--vendor-evidence", evidence]),
    "DATA_HANDLING_UNAPPROVED",
  );
  await assertAbsent(output);
});

test("launch performs no network activity", async () => {
  const fixture = await preparedForLaunch();
  const evidence = await providerEvidence(fixture);
  const output = await outputPath("launch-network");
  const spy = join(await temporary("premium-spy-"), "spy.mjs");
  await writeFile(
    spy,
    [
      "/* Fails the process the moment anything opens a socket or fetches. */",
      "import { Socket } from 'node:net';",
      "const originalConnect = Socket.prototype.connect;",
      "Socket.prototype.connect = function connect(...argv) {",
      "  process.stderr.write(`NETWORK_ATTEMPT ${JSON.stringify(argv[0])}\\n`);",
      "  process.exit(97);",
      "};",
      "globalThis.fetch = () => { process.stderr.write('NETWORK_ATTEMPT fetch\\n'); process.exit(97); };",
      "void originalConnect;",
    ].join("\n"),
  );
  const outcome = await runPremiumCommand(
    "launch-production.ts",
    [
      "--workspace",
      fixture.workspace,
      "--input",
      fixture.repository.input,
      "--artifact",
      fixture.artifact,
      "--output",
      output,
      "--vendor-evidence",
      evidence,
    ],
    ["--import", spy],
  );
  assert.equal(outcome.exitCode, 0, outcome.output);
  assert.ok(!outcome.output.includes("NETWORK_ATTEMPT"), outcome.output);
});
