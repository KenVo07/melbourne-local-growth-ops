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
import { sourceSetId } from "./source-binding-core.mjs";

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
async function assembleFor(
  input: string,
  factoryRevision = "premium-workflow-test",
): Promise<string> {
  const output = join(await temporary("premium-artifact-"), "artifact");
  await assembleClientSourceArtifact({
    definition: JSON.parse(
      await readFile(join(input, "client-website.json"), "utf8"),
    ) as unknown,
    publicDirectory: join(input, "public"),
    inputDirectory: input,
    outputDirectory: output,
    factoryRevision,
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
async function repositoryWithInput(
  input: string,
  scripts?: Record<string, string>,
): Promise<{
  readonly root: string;
  readonly input: string;
  readonly revision: string;
}> {
  const root = await temporary("premium-repo-");
  const inputDirectory = join(root, "clients/harbour-electrical");
  await mkdir(dirname(inputDirectory), { recursive: true });
  await cp(input, inputDirectory, { recursive: true });
  if (scripts !== undefined) {
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "client-repository", private: true, scripts }, null, 2)}\n`,
    );
  }
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
  scripts?: Record<string, string>,
): Promise<{
  readonly repository: { root: string; input: string; revision: string };
  readonly artifact: string;
  readonly workspace: string;
  readonly manifest: Record<string, unknown>;
}> {
  const repository = await repositoryWithInput(sharedInput, scripts);
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
  assert.match(prompt, /reduced.motion/i);
  assert.match(prompt, /1440, 834, 390 and 320/);

  /*
   * Authority, stated by class rather than as one blanket sentence.
   *
   * This assertion used to be `/never authoritative/i`, which passed against a
   * prompt that told the agent to disregard approved visuals along with
   * prototype code — the sentence that cost a redesign. The distinction, not the
   * dismissal, is what has to be in the brief.
   */
  assert.match(prompt, /BUSINESS_TRUTH_AUTHORITY/);
  assert.match(prompt, /PRODUCTION_SOURCE_AUTHORITY/);
  assert.match(prompt, /NON_AUTHORITATIVE_PROTOTYPE_CODE/);
  assert.match(prompt, /Prototype code is\s+evidence of a conversation/);
  assert.match(prompt, /never pasted, never binding/i);
  /* No provider here, so the brief must still refuse P1 layout as a default. */
  assert.match(prompt, /an unchanged P1\s+composition is a translation failure/);

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
  approved: {
    /** Write a real artifact beside the manifest and claim authority over it. */
    readonly visual?: boolean;
    /** Claim authority over a file that is not there. */
    readonly missingFile?: boolean;
    /** Claim authority over a file whose bytes differ from the recorded hash. */
    readonly wrongHash?: boolean;
  } = {},
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
        content: ["MOTION", "COMMENTARY"],
        authority: "NON_AUTHORITATIVE_PROTOTYPE_CODE",
        businessTruth: "NOT_AUTHORITATIVE",
      },
    ],
    ...overrides,
  };

  const directory = await temporary("premium-vendor-");

  /* An approved visual is a real file or it is not an authority, so the fixture
   * writes real bytes and records their real digest. */
  if (approved.visual === true || approved.missingFile === true || approved.wrongHash === true) {
    const bytes = Buffer.from("<!doctype html><title>approved composition</title>\n");
    const relative = "approved-visual/visual-reset.html";
    if (approved.missingFile !== true) {
      const absolute = join(directory, ...relative.split("/"));
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, bytes);
    }
    (record.items as Record<string, unknown>[]).push({
      label: "approved visual reset",
      purpose: "the composition, palette, type and scale a named human approved",
      content: ["VISUAL", "COMMENTARY"],
      authority: "VISUAL_AUTHORITY",
      path: relative,
      sha256: approved.wrongHash === true ? "a".repeat(64) : sha256(bytes),
      businessTruth: "NOT_AUTHORITATIVE",
    });
  }

  const file = join(directory, "provider-evidence.json");
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

test("bound provider evidence travels, and prototype code carries no authority", async () => {
  const fixture = await preparedForLaunch();
  const evidence = await providerEvidence(fixture);
  const output = await outputPath("vendor-bound");
  const outcome = await launch(fixture, output, ["--vendor-evidence", evidence]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const manifest = JSON.parse(await readFile(join(output, "production-launch.json"), "utf8"));
  assert.deepEqual(validateRecord("production-launch", manifest), []);
  assert.equal(manifest.provider.evidenceSupplied, true);
  assert.equal(manifest.provider.prototypeCodeAuthority, "NON_AUTHORITATIVE");
  assert.equal(manifest.provider.path, "inputs/provider-evidence-manifest.json");
  /* No item claimed visual authority here, so nothing was carried as one. */
  assert.deepEqual(manifest.provider.approvedAuthorities, []);

  const frozen = JSON.parse(
    await readFile(join(output, "inputs/provider-evidence-manifest.json"), "utf8"),
  );
  assert.equal(frozen.binding.workspaceId, (fixture.manifest as { workspaceId: string }).workspaceId);

  const index = JSON.parse(await readFile(join(output, "evidence-index.json"), "utf8"));
  assert.equal(index.providerEvidence.supplied, true);
  assert.match(index.providerEvidence.prototypeCode, /NON_AUTHORITATIVE/);
  assert.match(index.providerEvidence.businessTruth, /NOT_AUTHORITATIVE/);
  assert.deepEqual(index.providerEvidence.approvedAuthorities, []);
  assert.deepEqual(index.requiredFromProduction.viewportWidths, [1440, 834, 390, 320]);
});

test("an approved visual travels into the pack, is named as authority, and must be rendered", async () => {
  /*
   * The largest process defect Stone & Line found, closed end to end.
   *
   * A named human approved a composition. The launch pack then told the
   * production agent that every provider export was "evidence of a conversation"
   * and "never authoritative", carried no copy of the artifact, and left it out
   * of the read order. The agent behaved correctly on the instructions it had and
   * kept most of the P1 layout.
   *
   * What this proves: the approved artifact is copied into the pack, hashed with
   * everything else, listed in the read order, recorded in the manifest as the
   * source binding for visual authority, and accompanied by an instruction to
   * open it that a reader cannot mistake for optional.
   */
  const fixture = await preparedForLaunch();
  /* Deliberately not Claude Design. The authority model is stated in modalities
   * and digests, so any tool — or none — fits the same contract; a vendor name
   * here would be the lock-in the architecture refuses. */
  const evidence = await providerEvidence(
    fixture,
    { provider: "Figma", projectLabel: "client exploration, exported frames" },
    { visual: true },
  );
  const output = await outputPath("approved-visual");
  const outcome = await launch(fixture, output, ["--vendor-evidence", evidence]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  /* It is in the pack, byte-identical to what was approved. */
  const packPath = join(output, "inputs/approved-visual/visual-reset.html");
  const carried = await readFile(packPath);
  assert.match(carried.toString(), /approved composition/);

  /* The manifest binds it: which approved bytes production received. */
  const manifest = JSON.parse(await readFile(join(output, "production-launch.json"), "utf8"));
  assert.deepEqual(validateRecord("production-launch", manifest), []);
  assert.equal(manifest.provider.approvedAuthorities.length, 1);
  const bound = manifest.provider.approvedAuthorities[0];
  assert.equal(bound.path, "inputs/approved-visual/visual-reset.html");
  assert.equal(bound.authority, "VISUAL_AUTHORITY");
  assert.equal(bound.sha256, await hashFile(packPath));

  /* It is covered by the pack's own integrity manifest. */
  const sidecar = await readFile(join(output, "integrity.sha256"), "utf8");
  assert.match(sidecar, /inputs\/approved-visual\/visual-reset\.html/);

  /* The agent is told to open it, and where it sits in the read order. */
  const prompt = await readFile(join(output, "PRODUCTION_AGENT_PROMPT.md"), "utf8");
  assert.match(prompt, /inputs\/approved-visual\/visual-reset\.html/);
  assert.match(prompt, /Render and inspect each one before you write code/);
  assert.match(prompt, /VISUAL_AUTHORITY/);
  assert.match(prompt, /BUSINESS_TRUTH_AUTHORITY/);
  /* And the old blanket dismissal is gone. */
  assert.doesNotMatch(prompt, /It is never authoritative/);
  assert.match(prompt, /Prototype code is\s+evidence of a conversation/);

  /* The evidence index classifies rather than flattening. */
  const index = JSON.parse(await readFile(join(output, "evidence-index.json"), "utf8"));
  assert.equal(index.providerEvidence.approvedAuthorities.length, 1);
  assert.match(index.providerEvidence.approvedAuthorities[0].obligation, /RENDER_AND_INSPECT/);

  /* And the pack names the tool that was used without depending on which. */
  assert.equal(manifest.provider.provider, "Figma");
  const frozen = JSON.parse(
    await readFile(join(output, "inputs/provider-evidence-manifest.json"), "utf8"),
  );
  assert.equal(frozen.provider, "Figma");
});

test("an approved visual the pack cannot open is refused rather than described", async () => {
  const fixture = await preparedForLaunch();
  const missing = await providerEvidence(fixture, {}, { missingFile: true });
  const output = await outputPath("visual-missing");
  assertRefused(
    await launch(fixture, output, ["--vendor-evidence", missing]),
    "VISUAL_AUTHORITY_UNREADABLE",
  );
  await assertAbsent(output);

  /* And one whose bytes are not the approved bytes. */
  const fixtureTwo = await preparedForLaunch();
  const wrong = await providerEvidence(fixtureTwo, {}, { wrongHash: true });
  const second = await outputPath("visual-wrong-hash");
  assertRefused(
    await launch(fixtureTwo, second, ["--vendor-evidence", wrong]),
    "VISUAL_AUTHORITY_UNREADABLE",
  );
  await assertAbsent(second);
});

test("with no approved visual the brief still refuses to treat the old layout as a default", async () => {
  /* Mode B works with no provider at all, and the agent must still be told that
   * an unchanged P1 composition is a translation failure rather than caution. */
  const fixture = await preparedForLaunch();
  const output = await outputPath("no-provider-authority");
  assert.equal((await launch(fixture, output)).exitCode, 0);

  const prompt = await readFile(join(output, "PRODUCTION_AGENT_PROMPT.md"), "utf8");
  assert.match(prompt, /No approved visual artifact was supplied/);
  assert.match(prompt, /an unchanged P1\s+composition is a translation failure/);
  assert.match(prompt, /BUSINESS_TRUTH_AUTHORITY/);
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

/* ----------------------------------------------------------------- verify */

/**
 * A production candidate: a controlled change inside the client's own
 * experience tree, the Translation delta production owes, and a commit.
 */
async function implementCandidate(
  fixture: { repository: { root: string; input: string }; workspace: string },
  options: {
    readonly alsoChange?: readonly { path: string; contents: string }[];
    readonly translationDelta?: string;
  } = {},
): Promise<string> {
  const signature = join(fixture.repository.input, "experience/styles/conductor.css");
  await writeFile(
    signature,
    `${await readFile(signature, "utf8")}\n.conductor__mark { letter-spacing: 0.02em; }\n`,
  );
  for (const change of options.alsoChange ?? []) {
    const absolute = join(fixture.repository.root, ...change.path.split("/"));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, change.contents);
  }
  if (options.translationDelta !== "") {
    await fillDelivery(fixture.workspace, {
      handoffSections: {
        "Translation delta":
          options.translationDelta ??
          "The opening reuses the existing Conductor mark rather than the prototype's redrawn one; the surveyed-ground reading survives because the mark already carries it, and rebuilding it bespoke would have duplicated a P1 primitive.",
      },
    });
  }
  const git = async (...argv: string[]) => {
    const outcome = await runGit(fixture.repository.root, argv);
    assert.equal(outcome.exitCode, 0, `git ${argv.join(" ")}: ${outcome.output}`);
    return outcome.output.trim();
  };
  await git("add", "-A");
  await git("commit", "-m", "implement the approved delta");
  return git("rev-parse", "HEAD");
}

/** Captures covering every declared route at every required width. */
async function candidateEvidence(
  fixture: { repository: { input: string } },
  candidate: string,
  artifactDirectory: string,
  overrides: {
    readonly dropWidth?: number;
    readonly dropReducedMotion?: boolean;
    readonly failRuntime?: boolean;
    readonly dropInteractions?: boolean;
    readonly syntheticPointer?: boolean;
  } = {},
): Promise<string> {
  const descriptor = JSON.parse(
    await readFile(join(artifactDirectory, "client-artifact.json"), "utf8"),
  ) as { artifactId: string; clientExperience: { source: { path: string; sha256: string }[] } };
  const manifest = JSON.parse(
    await readFile(join(fixture.repository.input, "experience/manifest.json"), "utf8"),
  ) as { routeIds: string[] };

  const directory = await temporary("premium-evidence-");
  const captures: Record<string, unknown>[] = [];
  const widths = [1440, 834, 390, 320].filter((width) => width !== overrides.dropWidth);
  for (const route of manifest.routeIds) {
    for (const width of widths) {
      for (const motion of ["FULL", "REDUCED"]) {
        if (motion === "REDUCED" && (overrides.dropReducedMotion === true || width !== 390)) {
          continue;
        }
        const path = `captures/${route}-${width}-${motion.toLowerCase()}.png`;
        const bytes = Buffer.from(`capture ${route} ${width} ${motion} ${candidate}\n`);
        const absolute = join(directory, ...path.split("/"));
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, bytes);
        captures.push({
          path,
          sha256: sha256(bytes),
          route,
          state: motion === "REDUCED" ? "opening, reduced motion" : "opening",
          viewportWidth: width,
          motion,
        });
      }
    }
  }

  const record = {
    schemaVersion: 1,
    kind: "PREMIUM_CANDIDATE_EVIDENCE",
    artifactId: descriptor.artifactId,
    sourceSetId: sourceSetId(descriptor.clientExperience.source, "candidate source"),
    candidateRevision: candidate,
    capturedAt: "2026-08-19T00:00:00Z",
    captures,
    accessibility: [
      { engine: "chromium", state: "opening", result: "PASS", proof: "no violations" },
      { engine: "webkit", state: "conversion", result: "PASS", proof: "focus visible on every control" },
    ],
    runtime: [
      { check: "console-errors", scope: "all routes", result: "PASS", proof: "no console error or unhandled rejection" },
      { check: "unexpected-network", scope: "all routes", result: "PASS", proof: "no request left the origin" },
      {
        check: "horizontal-overflow",
        scope: "320-1440",
        result: overrides.failRuntime === true ? "FAIL" : "PASS",
        proof:
          overrides.failRuntime === true
            ? "the proof sequence overflows by 18px at 320"
            : "no horizontal overflow at any required width",
      },
      { check: "client-isolation", scope: "other clients", result: "PASS", proof: "no unrelated client inherits the Signature cost" },
    ],
    /* A finished delivery has driven its own controls. The pointer-sensitive one
     * is driven by a real pointer sequence, because a synthetic click cannot
     * show that a control holding pointer capture is still reachable. */
    ...(overrides.dropInteractions === true
      ? {}
      : {
          interactions: [
            {
              control: "collection scroller plate",
              behaviour: "a click opens the record; a drag scrolls the run",
              pointerSensitive: true,
              input: overrides.syntheticPointer === true ? "SYNTHETIC_CLICK" : "REAL_POINTER",
              result: "PASS",
              proof:
                overrides.syntheticPointer === true
                  ? "element.click() opened the record"
                  : "pointer down, up at plate centre with no travel — opened the record; 40px travel scrolled instead",
            },
            {
              control: "primary navigation disclosure",
              behaviour: "opens the menu and traps focus",
              pointerSensitive: false,
              input: "REAL_KEYBOARD",
              result: "PASS",
              proof: "Enter opened it, Escape closed it, focus returned to the trigger",
            },
          ],
        }),
  };
  const file = join(directory, "candidate-evidence.json");
  await writeFile(file, `${JSON.stringify(record, null, 2)}\n`);
  return file;
}

/**
 * The artifact the candidate assembles into, for binding evidence to it.
 *
 * At the same Factory revision `creative:verify` will use, because that is what
 * an operator's own capture run does: assemble once, capture that build, then
 * verify. Evidence bound to a different Factory revision is evidence of a
 * different render, and the verifier is meant to say so.
 */
async function assembleCandidateArtifact(input: string): Promise<string> {
  const revision = await runGit(repositoryRoot, ["rev-parse", "--short", "HEAD"]);
  assert.equal(revision.exitCode, 0, revision.output);
  return assembleFor(input, revision.output.trim());
}

interface VerifyFixture {
  readonly repository: { root: string; input: string; revision: string };
  readonly artifact: string;
  readonly workspace: string;
  readonly manifest: Record<string, unknown>;
  readonly launchPack: string;
  readonly candidate: string;
}

async function launchedAndImplemented(
  options: Parameters<typeof implementCandidate>[1] = {},
  scripts?: Record<string, string>,
): Promise<VerifyFixture> {
  const fixture = await preparedForLaunch({}, undefined, scripts);
  const launchPack = await outputPath("verify-launch");
  const launched = await launch(fixture, launchPack);
  assert.equal(launched.exitCode, 0, launched.output);
  const candidate = await implementCandidate(fixture, options);
  return { ...fixture, launchPack, candidate };
}

async function verify(
  fixture: VerifyFixture,
  output: string,
  extra: readonly string[] = [],
): Promise<CommandOutcome> {
  return runPremiumCommand("verify-production.ts", [
    "--launch",
    fixture.launchPack,
    "--workspace",
    fixture.workspace,
    "--input",
    fixture.repository.input,
    "--candidate",
    fixture.candidate,
    "--output",
    output,
    ...extra,
  ]);
}

test("a controlled experience delta verifies, and the report says what it measured", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("verify");
  const outcome = await verify(fixture, output, ["--evidence", evidence]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.deepEqual(validateRecord("objective-validation-report", report), []);
  assert.equal(report.result, "PASS");
  assert.equal(report.humanCreativeDecision, "REQUIRED_SEPARATELY");
  assert.equal(report.candidateRevision, fixture.candidate);

  /* Old and new identities, both reported. */
  assert.equal(report.identities.oldArtifactId, (fixture.manifest as { sourceBinding: { artifactId: string } }).sourceBinding.artifactId);
  assert.notEqual(report.identities.newArtifactId, report.identities.oldArtifactId);
  assert.notEqual(report.identities.newSourceSetId, report.identities.oldSourceSetId);

  /* Scope: one changed file, inside the client's own experience tree. */
  assert.equal(report.diffScope.allowedRoot, "clients/harbour-electrical/experience");
  assert.deepEqual(
    report.diffScope.changed.map((entry: { path: string }) => entry.path),
    ["clients/harbour-electrical/experience/styles/conductor.css"],
  );

  const byId = new Map(report.checks.map((check: { id: string }) => [check.id, check]));
  for (const id of [
    "scope.inside-launch-allowlist",
    "truth.definition-unchanged",
    "identity.client-continuity",
    "runtime.posture-unchanged",
    "handoff.translation-delta",
    "handoff.approved-intent-unchanged",
    "evidence.viewport-coverage",
    "evidence.reduced-motion",
    "evidence.accessibility",
    "evidence.runtime",
  ]) {
    assert.equal((byId.get(id) as { status: string } | undefined)?.status, "PASS", id);
  }
  assert.equal(report.unresolvedFailures.length, 0);
  await assertNoStagingResidue(dirname(output));
});

test("the objective report has nowhere to record a verdict on the work", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("no-verdict");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 0);

  const text = await readFile(join(output, "objective-validation-report.json"), "utf8");
  const report = JSON.parse(text);
  for (const forbidden of ["score", "quality", "beauty", "rating", "grade"]) {
    assert.ok(!Object.hasOwn(report, forbidden), `the report carries a "${forbidden}" field`);
  }
  /* And the contract refuses one if a future edit adds it. */
  assert.ok(
    validateRecord("objective-validation-report", { ...report, score: 9 }).some((problem: string) =>
      problem.includes('"score" is not a field of an objective report'),
    ),
  );
});

test("the ship gate is emitted blank, writable, and unsigned", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("ship-gate");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 0);

  const gate = await readFile(join(output, "final-creative-gate.md"), "utf8");
  assert.match(gate, /^decision: # PASS \| PASS_WITH_NAMED_FIXES \| FAIL$/m);
  assert.match(gate, /^decided_by:\s*$/m);
  assert.match(gate, /^client: harbour-electrical$/m);
  assert.ok(gate.includes(fixture.candidate), "the gate names the candidate it decides on");

  const reportSha256 = await hashFile(join(output, "objective-validation-report.json"));
  assert.ok(gate.includes(reportSha256), "the gate names the exact report it is decided against");

  /* The one writable file in the output: a human has to be able to sign it. */
  assert.notEqual((await stat(join(output, "final-creative-gate.md"))).mode & 0o200, 0);
  assert.equal((await stat(join(output, "objective-validation-report.json"))).mode & 0o222, 0);
});

test("missing mobile evidence fails the report by name", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact, { dropWidth: 390 });
  const output = await outputPath("no-mobile");
  const outcome = await verify(fixture, output, ["--evidence", evidence]);
  assert.equal(outcome.exitCode, 1, outcome.output);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.equal(report.result, "FAIL");
  const check = report.checks.find((entry: { id: string }) => entry.id === "evidence.viewport-coverage");
  assert.equal(check.status, "FAIL");
  assert.equal(check.code, "MOBILE_EVIDENCE_MISSING");
});

test("a delivery never looked at with motion off fails the report", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact, {
    dropReducedMotion: true,
  });
  const output = await outputPath("no-reduced-motion");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  const check = report.checks.find((entry: { id: string }) => entry.id === "evidence.reduced-motion");
  assert.equal(check.status, "FAIL");
  assert.equal(check.code, "REDUCED_MOTION_MISSING");
});

test("absent evidence is a failure, not an assumption", async () => {
  const fixture = await launchedAndImplemented();
  const output = await outputPath("no-evidence");
  assert.equal((await verify(fixture, output)).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.equal(report.result, "FAIL");
  assert.ok(
    report.checks.some(
      (entry: { id: string; status: string }) =>
        entry.id === "evidence.supplied" && entry.status === "FAIL",
    ),
  );
});

test("a failing runtime observation is reported, not smoothed over", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact, {
    failRuntime: true,
  });
  const output = await outputPath("runtime-fail");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  const check = report.checks.find((entry: { id: string }) => entry.id === "evidence.runtime");
  assert.equal(check.status, "FAIL");
  assert.match(check.proof, /overflows by 18px at 320/);
});

test("an unfilled translation delta fails: production must say what it changed", async () => {
  const fixture = await launchedAndImplemented({ translationDelta: "" });
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("no-translation");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  const check = report.checks.find((entry: { id: string }) => entry.id === "handoff.translation-delta");
  assert.equal(check.status, "FAIL");
  assert.equal(check.code, "TRANSLATION_DELTA_MISSING");
});

test("a handoff rewritten during implementation records what was built, not what was approved", async () => {
  const fixture = await launchedAndImplemented();
  await fillDelivery(fixture.workspace, {
    handoffSections: {
      "Translation delta": "Filled after implementing.",
      "Signature thesis": "Rewritten after the fact to match what was actually built.",
    },
  });
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("handoff-drift");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  const check = report.checks.find(
    (entry: { id: string }) => entry.id === "handoff.approved-intent-unchanged",
  );
  assert.equal(check.status, "FAIL");
  assert.match(check.proof, /Signature thesis/);
});

test("a candidate that reaches into P1 is refused, not reported", async () => {
  const fixture = await launchedAndImplemented({
    alsoChange: [
      { path: "packages/site-core/src/platform/Heading.tsx", contents: "export const Heading = null;\n" },
    ],
  });
  const output = await outputPath("scope-escape");
  assertRefused(await verify(fixture, output), "PRODUCTION_SCOPE_ESCAPE");
  await assertAbsent(output);
});

test("a candidate that changes business truth is refused", async () => {
  const fixture = await preparedForLaunch();
  const launchPack = await outputPath("truth-launch");
  assert.equal((await launch(fixture, launchPack)).exitCode, 0);
  const definition = join(fixture.repository.input, "client-website.json");
  const parsed = JSON.parse(await readFile(definition, "utf8")) as {
    configuration: { display: { tagline: string } };
  };
  parsed.configuration.display.tagline = "A claim nobody approved.";
  await writeFile(definition, `${JSON.stringify(parsed, null, 2)}\n`);
  const candidate = await implementCandidate(fixture);

  const output = await outputPath("truth-drift");
  assertRefused(
    await verify({ ...fixture, launchPack, candidate }, output),
    "BUSINESS_TRUTH_DRIFT",
  );
  await assertAbsent(output);
});

test("a candidate that changes dependency posture is refused", async () => {
  const fixture = await launchedAndImplemented({
    alsoChange: [{ path: "package.json", contents: '{\n  "dependencies": { "three": "^0.180.0" }\n}\n' }],
  });
  const output = await outputPath("dependency-drift");
  assertRefused(await verify(fixture, output), "DEPENDENCY_DRIFT");
  await assertAbsent(output);
});

test("a revision that does not descend from the launch baseline is refused", async () => {
  const fixture = await launchedAndImplemented();
  const output = await outputPath("unrelated-revision");
  assertRefused(
    await verify({ ...fixture, candidate: fixture.repository.revision }, output),
    "CANDIDATE_REVISION_INVALID",
  );
  await assertAbsent(output);
});

test("an unknown revision is refused rather than resolved to something nearby", async () => {
  const fixture = await launchedAndImplemented();
  const output = await outputPath("unknown-revision");
  assertRefused(
    await verify({ ...fixture, candidate: "0".repeat(40) }, output),
    "CANDIDATE_REVISION_INVALID",
  );
  await assertAbsent(output);
});

test("an edited launch pack is not a brief anyone approved", async () => {
  const fixture = await launchedAndImplemented();
  const prompt = join(fixture.launchPack, "PRODUCTION_AGENT_PROMPT.md");
  await chmod(prompt, 0o644);
  await writeFile(prompt, `${await readFile(prompt, "utf8")}\n\nAlso rebuild the platform.\n`);

  const output = await outputPath("launch-tampered");
  assertRefused(await verify(fixture, output), "LAUNCH_TAMPERED");
  await assertAbsent(output);
});

test("a workspace that did not produce this launch cannot verify against it", async () => {
  const fixture = await launchedAndImplemented();
  const other = await preparedForLaunch();
  const output = await outputPath("workspace-mismatch");
  assertRefused(
    await verify({ ...fixture, workspace: other.workspace }, output),
    "ARTIFACT_MISMATCH",
  );
  await assertAbsent(output);
});

test("an existing verify output is never overwritten", async () => {
  const fixture = await launchedAndImplemented();
  const output = await outputPath("verify-existing");
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "old-report.json"), "{}\n");
  assertRefused(await verify(fixture, output), "OUTPUT_NOT_EMPTY");
  assert.equal(await readFile(join(output, "old-report.json"), "utf8"), "{}\n");
});

test("the repository's own standing gates are run and logged, not restated", async () => {
  const fixture = await launchedAndImplemented({}, {
    check: "node -e \"console.log('build, test, typecheck all green'); process.exit(0)\"",
  });
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("gates-pass");
  const outcome = await verify(fixture, output, ["--evidence", evidence]);
  assert.equal(outcome.exitCode, 0, outcome.output);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  const byId = new Map(report.checks.map((check: { id: string }) => [check.id, check]));
  assert.equal((byId.get("gate.check") as { status: string }).status, "PASS");
  /* A gate the repository does not define is skipped with the reason, never
   * reported as a pass nothing produced. */
  assert.equal((byId.get("gate.creative-test") as { status: string }).status, "NOT_APPLICABLE");

  const log = await readFile(join(output, "logs/gate.check.log"), "utf8");
  assert.match(log, /pnpm run check/);
  assert.match(log, /build, test, typecheck all green/);
});

test("a failing standing gate makes the whole report FAIL", async () => {
  const fixture = await launchedAndImplemented({}, {
    check: "node -e \"console.error('2 type errors in the experience'); process.exit(3)\"",
  });
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("gates-fail");
  const outcome = await verify(fixture, output, ["--evidence", evidence]);
  assert.equal(outcome.exitCode, 1, outcome.output);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.equal(report.result, "FAIL");
  const check = report.checks.find((entry: { id: string }) => entry.id === "gate.check");
  assert.equal(check.status, "FAIL");
  assert.equal(check.code, "OBJECTIVE_VALIDATION_FAILED");
  assert.match(
    await readFile(join(output, "logs/gate.check.log"), "utf8"),
    /2 type errors in the experience/,
  );
});

test("a pointer-sensitive control evidenced by a synthetic click fails the report", async () => {
  /*
   * The defect that shipped through a full evidence pass. A collection plate
   * held pointer capture from `pointerdown`, so the click a press produced was
   * dispatched at the capturing element and the plate could not be clicked at
   * all. The harness proved the plates worked with `element.click()`, which
   * never involves a pointer, capture or hit-testing.
   *
   * Reported rather than refused: the delivery is inside its boundary, and a
   * reviewer needs to see which control is unproven.
   */
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact, {
    syntheticPointer: true,
  });
  const output = await outputPath("synthetic-pointer");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.equal(report.result, "FAIL");
  const check = report.checks.find(
    (entry: { id: string }) => entry.id === "evidence.pointer-input",
  );
  assert.equal(check.status, "FAIL");
  assert.equal(check.code, "SYNTHETIC_POINTER_EVIDENCE");
  assert.match(check.proof, /collection scroller plate/);
  assert.match(check.proof, /SYNTHETIC_CLICK/);
});

test("a delivery whose controls were never driven is reported, not assumed to work", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact, {
    dropInteractions: true,
  });
  const output = await outputPath("no-interactions");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 1);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.equal(report.result, "FAIL");
  for (const id of ["evidence.interaction", "evidence.pointer-input"]) {
    const check = report.checks.find((entry: { id: string }) => entry.id === id);
    assert.equal(check.status, "FAIL", `${id} must fail when no control was driven`);
  }
});

test("real pointer evidence passes, and the report counts what was driven", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("real-pointer");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 0);

  const report = JSON.parse(
    await readFile(join(output, "objective-validation-report.json"), "utf8"),
  );
  assert.equal(report.result, "PASS");
  const pointer = report.checks.find(
    (entry: { id: string }) => entry.id === "evidence.pointer-input",
  );
  assert.equal(pointer.status, "PASS");
  assert.match(pointer.proof, /real pointer or touch/);
});

test("the verify output is inventoried and its report is immutable", async () => {
  const fixture = await launchedAndImplemented();
  const artifact = await assembleCandidateArtifact(fixture.repository.input);
  const evidence = await candidateEvidence(fixture, fixture.candidate, artifact);
  const output = await outputPath("verify-integrity");
  assert.equal((await verify(fixture, output, ["--evidence", evidence])).exitCode, 0);

  const sidecar = await readFile(join(output, "integrity.sha256"), "utf8");
  const recorded = new Map(
    sidecar
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => [line.slice(66), line.slice(0, 64)]),
  );
  const files = (await listFiles(output)).filter((path) => path !== "integrity.sha256");
  assert.deepEqual(files.sort(), [...recorded.keys()].sort());
  for (const path of files) {
    assert.equal(await hashFile(join(output, path)), recorded.get(path), path);
  }

  /* Captures travel with the report, so the decision is reviewable later. */
  assert.ok(files.some((path) => path.startsWith("evidence/captures/")));
});
