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
