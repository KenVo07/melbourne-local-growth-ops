/**
 * The impure half of source binding: it obtains both sides of the comparison by
 * running the Factory's own code, then hands them to `source-binding-core.mjs`.
 *
 * Nothing here reimplements a Factory rule. The definition is parsed by
 * `parseDefinitionInput`, the experience manifest by site-core's validator, the
 * authored source by `inspectClientExperienceSource` with the live approved
 * dependency list, the public snapshot by `generateClientWebsiteSnapshot`, and
 * the artifact by the verifier the artifact itself ships. A second, simpler
 * scanner written here would drift from the real one, and the first thing it
 * would drift on is a refusal it no longer makes.
 *
 * The import path follows `envelope-probe.ts`: relative into
 * `apps/managed-web/src/generation`, which resolves that app's workspace
 * dependencies without the root package acquiring any.
 */
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  approvedClientExperienceDependencies,
  ClientExperienceSourcePolicyError,
  generateClientWebsiteSnapshot,
  inspectClientExperienceSource,
  parseDefinitionInput,
  validateClientExperienceManifest,
} from "../../apps/managed-web/src/generation/index";
import type {
  ClientArtifactDescriptor,
  ClientWebsiteSnapshot,
} from "../../apps/managed-web/src/generation/types";
import type { InspectedClientExperienceSource } from "../../apps/managed-web/src/generation/client-experience-source-policy";

import {
  readJsonFile,
  resolveExistingDirectory,
  resolveExistingFile,
} from "./atomic-output.mjs";
import { canonicalJson, refuse, sha256 } from "./premium-contracts.mjs";
import { assertExactSourceBinding } from "./source-binding-core.mjs";

/** Where authored source lives inside an assembled artifact. Fixed by P1. */
const ARTIFACT_AUTHORED_ROOT = "src/client-experience/authored";
const ARTIFACT_SNAPSHOT_PATH = "src/generated/managed-website.json";
const ARTIFACT_VERIFIER_PATH = "scripts/verify-handoff.mjs";

export interface SourceFileEntry {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
  readonly kind: "SOURCE" | "STYLE" | "DATA" | "MANIFEST";
  readonly clientRuntime: boolean;
}

/**
 * Everything the Factory can currently say about one client input, with the two
 * hashes that make drift visible: the raw definition bytes and the canonical
 * generated snapshot.
 */
export interface CurrentClientInput {
  readonly inputDirectory: string;
  readonly clientId: string;
  readonly configurationId: string;
  readonly configurationVersion: number;
  readonly deploymentId: string;
  readonly experienceId: string;
  readonly experienceVersion: string;
  readonly entrypoint: string;
  readonly designDnaPath: string;
  readonly runtime: {
    readonly clientJavaScript: string;
    readonly motion: string;
    readonly reducedMotion: string;
  };
  readonly publicDependencies: readonly { readonly name: string; readonly version: string }[];
  readonly source: readonly SourceFileEntry[];
  readonly definitionSha256: string;
  readonly generatedSnapshotSha256: string;
  readonly definition: unknown;
  readonly snapshot: ClientWebsiteSnapshot;
  readonly manifest: Record<string, unknown>;
  readonly inspected: InspectedClientExperienceSource;
  readonly routeIds: readonly string[];
  readonly signatureIds: readonly string[];
}

export interface LoadedArtifact {
  readonly root: string;
  readonly sourceDirectory: string;
  readonly descriptor: ClientArtifactDescriptor;
  readonly descriptorSha256: string;
}

/**
 * Runs the Factory's validators over a live client input package.
 *
 * Order is the Factory's own: raw bytes first so drift stays visible even when
 * a change is semantically neutral, then definition, manifest, source policy,
 * and only then the snapshot. Nothing is written and nothing is repaired.
 */
export async function inspectCurrentClientInput(
  inputPath: string,
): Promise<CurrentClientInput> {
  const inputDirectory = await resolveExistingDirectory(inputPath, "client input");
  const definitionPath = await resolveExistingFile(
    join(inputDirectory, "client-website.json"),
    "client-website.json",
  );

  const definitionBytes = await readFile(definitionPath);
  const definitionSha256 = sha256(definitionBytes);

  let parsedDefinition: unknown;
  try {
    parsedDefinition = JSON.parse(definitionBytes.toString("utf8"));
  } catch (error) {
    throw refuse(
      "DEFINITION_INVALID",
      `client-website.json is not valid JSON: ${(error as Error).message}`,
      { path: definitionPath },
    );
  }

  let definition;
  try {
    definition = parseDefinitionInput(parsedDefinition);
  } catch (error) {
    throw refuse("DEFINITION_INVALID", (error as Error).message, {
      path: definitionPath,
    });
  }
  if (definition.schemaVersion !== 2) {
    throw refuse(
      "AUTHORED_SOURCE_REQUIRED",
      "Premium delivery evolves authored client source, so it requires a schemaVersion 2 client. This input is schemaVersion 1 and has no experience/ tree to modify.",
      { schemaVersion: definition.schemaVersion },
    );
  }

  const manifestPath = await resolveExistingFile(
    join(inputDirectory, "experience", "manifest.json"),
    "experience/manifest.json",
  );
  const manifestResult = validateClientExperienceManifest(
    await readJsonFile(manifestPath, "experience/manifest.json"),
  );
  if (!manifestResult.success) {
    throw refuse(
      "MANIFEST_INVALID",
      `experience/manifest.json is invalid: ${manifestResult.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
      { path: manifestPath },
    );
  }
  const manifest = manifestResult.data;

  let inspected: InspectedClientExperienceSource;
  try {
    inspected = await inspectClientExperienceSource({
      inputDirectory,
      manifest,
      approvedPublicDependencies: approvedClientExperienceDependencies.map(
        ({ name }) => name,
      ),
    });
  } catch (error) {
    if (error instanceof ClientExperienceSourcePolicyError) {
      throw refuse(
        "SOURCE_POLICY_REFUSED",
        `The client experience source policy refused ${error.path ?? "this source"} (${error.code}): ${error.message}`,
        { policyCode: error.code, path: error.path, detail: error.detail },
      );
    }
    throw error;
  }

  let snapshot: ClientWebsiteSnapshot;
  try {
    snapshot = generateClientWebsiteSnapshot(
      parsedDefinition,
      join(inputDirectory, "public"),
      { clientExperienceManifest: manifest },
    );
  } catch (error) {
    throw refuse("SNAPSHOT_GENERATION_FAILED", (error as Error).message, {
      path: definitionPath,
    });
  }

  return Object.freeze({
    inputDirectory,
    clientId: snapshot.configuration.clientId,
    configurationId: snapshot.configuration.configurationId,
    configurationVersion: snapshot.configuration.configurationVersion,
    deploymentId: snapshot.configuration.deploymentId,
    experienceId: manifest.experienceId,
    experienceVersion: manifest.experienceVersion,
    entrypoint: manifest.entrypoint,
    designDnaPath: manifest.designDnaPath,
    runtime: manifest.runtime,
    publicDependencies: manifest.publicDependencies,
    source: inspected.files,
    definitionSha256,
    generatedSnapshotSha256: sha256(canonicalJson(snapshot)),
    definition: parsedDefinition,
    snapshot,
    manifest: manifest as unknown as Record<string, unknown>,
    inspected,
    routeIds: manifest.routeIds,
    signatureIds: manifest.signatureIds ?? [],
  });
}

/** Reads an assembled artifact's descriptor and locates its source tree. */
export async function loadArtifact(artifactPath: string): Promise<LoadedArtifact> {
  const root = await resolveExistingDirectory(artifactPath, "assembled artifact");
  const descriptorPath = await resolveExistingFile(
    join(root, "client-artifact.json"),
    "client-artifact.json",
  );
  const descriptorBytes = await readFile(descriptorPath);
  const descriptor = (await readJsonFile(
    descriptorPath,
    "client-artifact.json",
  )) as ClientArtifactDescriptor;

  /* The descriptor names its own source directory. Accepting anything but the
   * documented constant would let a crafted artifact point the bridge at a path
   * outside itself. */
  if (descriptor.sourceDirectory !== "source") {
    throw refuse(
      "ARTIFACT_KIND",
      `client-artifact.json declares sourceDirectory "${String(descriptor.sourceDirectory)}"; the Factory writes "source".`,
      { sourceDirectory: descriptor.sourceDirectory },
    );
  }
  const sourceDirectory = await resolveExistingDirectory(
    join(root, "source"),
    "artifact source directory",
  );

  return Object.freeze({
    root,
    sourceDirectory,
    descriptor,
    descriptorSha256: sha256(descriptorBytes),
  });
}

export interface CommandResult {
  readonly command: string;
  readonly exitCode: number;
  readonly durationMs: number;
  readonly output: string;
}

/**
 * Runs the integrity verifier the artifact itself ships.
 *
 * Deliberately the artifact's script rather than a reimplementation here: it is
 * the same check a client is instructed to run, so a client and this bridge
 * cannot reach different conclusions about the same delivered bytes. It uses
 * only Node built-ins and touches no network.
 */
export async function runArtifactHandoffVerifier(
  artifact: LoadedArtifact,
): Promise<CommandResult> {
  const verifier = await resolveExistingFile(
    join(artifact.sourceDirectory, ARTIFACT_VERIFIER_PATH),
    `artifact ${ARTIFACT_VERIFIER_PATH}`,
  );
  const result = await runCommand(
    process.execPath,
    [verifier],
    artifact.sourceDirectory,
  );
  if (result.exitCode !== 0) {
    throw refuse(
      "ARTIFACT_INTEGRITY_FAILED",
      `The artifact's own handoff verifier refused it:\n${result.output.trim()}`,
      { artifactId: artifact.descriptor.artifactId, exitCode: result.exitCode },
    );
  }
  return result;
}

/**
 * Compares every current source byte to the copy the artifact shipped.
 *
 * The descriptor already records a hash per file, and the previous step already
 * compared those hashes to the live input. This closes the remaining gap: an
 * artifact whose descriptor is honest but whose copied bytes are not.
 */
export async function assertArtifactSourceCopyMatches(
  artifact: LoadedArtifact,
  current: CurrentClientInput,
): Promise<void> {
  const authoredRoot = join(artifact.sourceDirectory, ...ARTIFACT_AUTHORED_ROOT.split("/"));
  const mismatched: string[] = [];
  const missing: string[] = [];
  for (const entry of current.source) {
    const copied = join(authoredRoot, ...entry.path.split("/"));
    let bytes: Buffer;
    try {
      bytes = await readFile(copied);
    } catch {
      missing.push(entry.path);
      continue;
    }
    if (sha256(bytes) !== entry.sha256) mismatched.push(entry.path);
  }
  if (missing.length > 0 || mismatched.length > 0) {
    throw refuse(
      "ARTIFACT_INTEGRITY_FAILED",
      `Artifact ${artifact.descriptor.artifactId} does not carry the source its descriptor claims. ${
        missing.length > 0 ? `Missing from the artifact: ${missing.join(", ")}. ` : ""
      }${mismatched.length > 0 ? `Different bytes: ${mismatched.join(", ")}.` : ""}`,
      { missing, mismatched },
    );
  }
}

/**
 * Regenerates the public snapshot in memory and compares it to the one the
 * artifact shipped.
 *
 * Comparison is over canonical JSON rather than file bytes, so a reformatted
 * artifact is not reported as drift while a single changed value still is. The
 * artifact is never rewritten to match.
 */
export async function assertGeneratedSnapshotMatches(
  artifact: LoadedArtifact,
  current: CurrentClientInput,
): Promise<void> {
  const snapshotPath = join(
    artifact.sourceDirectory,
    ...ARTIFACT_SNAPSHOT_PATH.split("/"),
  );
  const shipped = await readJsonFile(snapshotPath, ARTIFACT_SNAPSHOT_PATH);
  const shippedCanonical = canonicalJson(shipped);
  const currentCanonical = canonicalJson(current.snapshot);
  if (shippedCanonical !== currentCanonical) {
    throw refuse(
      "GENERATED_SNAPSHOT_STALE",
      `The public snapshot generated from the current client-website.json differs from the one artifact ${artifact.descriptor.artifactId} shipped. Assemble a new artifact; the bridge does not regenerate a stale one.`,
      {
        artifactSnapshotSha256: sha256(shippedCanonical),
        currentSnapshotSha256: sha256(currentCanonical),
      },
    );
  }
}

export interface ExactBinding {
  readonly artifactId: string;
  readonly clientId: string;
  readonly factoryRevision: string;
  readonly sourceSetId: string;
  readonly files: readonly SourceFileEntry[];
  readonly definitionSha256: string;
  readonly generatedSnapshotSha256: string;
  readonly artifactDescriptorSha256: string;
  readonly verifier: CommandResult;
}

/**
 * The whole binding, in the order a failure is most useful in.
 *
 * Artifact integrity first, because a broken artifact makes every later
 * comparison meaningless. Then identity, then the source set, then the two
 * checks that only an artifact can fail: its own copied bytes and its shipped
 * snapshot.
 */
export async function bindClientToArtifact(options: {
  readonly current: CurrentClientInput;
  readonly artifact: LoadedArtifact;
  readonly expectedWorkspace?: {
    readonly artifactId: string;
    readonly sourceSetId: string;
    readonly definitionSha256: string;
    readonly generatedSnapshotSha256: string;
  };
}): Promise<ExactBinding> {
  const verifier = await runArtifactHandoffVerifier(options.artifact);
  const binding = assertExactSourceBinding({
    artifact: options.artifact.descriptor,
    current: options.current,
    expectedWorkspace: options.expectedWorkspace,
  });
  await assertArtifactSourceCopyMatches(options.artifact, options.current);
  await assertGeneratedSnapshotMatches(options.artifact, options.current);

  return Object.freeze({
    artifactId: binding.artifactId,
    clientId: binding.clientId,
    factoryRevision: binding.factoryRevision,
    sourceSetId: binding.sourceSetId,
    files: binding.files,
    definitionSha256: options.current.definitionSha256,
    generatedSnapshotSha256: options.current.generatedSnapshotSha256,
    artifactDescriptorSha256: options.artifact.descriptorSha256,
    verifier,
  });
}

/**
 * Runs a local command and records what it did.
 *
 * Every command the bridge runs is recorded this way — argv, exit status,
 * duration and combined output — so a report can say what was executed rather
 * than asserting that a check happened.
 */
export async function runCommand(
  file: string,
  argv: readonly string[],
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(file, [...argv], {
      cwd,
      env: environment,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", rejectPromise);
    child.on("close", (code) => {
      resolvePromise(
        Object.freeze({
          command: [file, ...argv].join(" "),
          exitCode: code ?? -1,
          durationMs: Date.now() - started,
          output,
        }),
      );
    });
  });
}

/** Repository root, derived from this file rather than from the cwd. */
export const repositoryRoot = resolve(import.meta.dirname, "../..");
