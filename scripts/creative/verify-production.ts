/**
 * `pnpm creative:verify` — the third of the three premium commands.
 *
 * It answers the only questions a machine is competent to answer about a
 * finished premium implementation: is this the same client's controlled
 * Experience delta, did it stay inside the boundary the launch set, does it
 * still assemble into a valid standalone artifact, and is there enough evidence
 * for a named human to decide whether it ships.
 *
 * It does not decide whether the work is good. There is no field in the report
 * it writes in which such a decision could be recorded, and the contract
 * refuses one if a future edit tries to add it.
 *
 * Two kinds of failure, deliberately separated:
 *
 *   - A candidate that is *outside the boundary* — a tampered launch pack, a
 *     revision that does not descend from the baseline, changed business truth,
 *     a P1 or other-client edit, a dependency change — is refused. No report is
 *     written, because there is nothing here for a human to review yet.
 *
 *   - A candidate that is inside the boundary but *fails an objective check* —
 *     a failing gate, missing mobile evidence, no designed reduced-motion state
 *     — produces a report whose result is FAIL. That is a reviewable outcome,
 *     and hiding it behind a refusal would lose the evidence that says why.
 *
 * The command never modifies production source, and never edits evidence to
 * make a check pass.
 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

import { ARTIFACTS } from "./artifact-model.mjs";
import {
  hashFile,
  inventoryDirectory,
  makeReadOnly,
  publishAtomically,
  readJsonFile,
  resolveExistingDirectory,
  resolveExistingFile,
  verifyInventory,
  writeChecksumSidecar,
  writeInto,
  writeJsonInto,
} from "./atomic-output.mjs";
import {
  assertContract,
  compareText,
  refuse,
  REQUIRED_VIEWPORT_WIDTHS,
  sha256,
  validateRecord,
} from "./premium-contracts.mjs";
import { heading, runCommandMain, step, type CommandSpec } from "./premium-cli";
import { deriveReportId } from "./source-binding-core.mjs";
import {
  bindClientToArtifact,
  inspectCurrentClientInput,
  loadArtifact,
  repositoryRoot,
  runCommand,
  type CommandResult,
  type CurrentClientInput,
  type ExactBinding,
} from "./source-binding";
import {
  isUnfilled,
  loadEnvelope,
  parseFrontMatter,
  sectionBody,
  stripScaffolding,
  validateArtifacts,
} from "./validate-core.mjs";

const SPEC: CommandSpec = {
  command: "creative:verify",
  summary:
    "Verify a production candidate against its launch pack and publish the objective report a named human makes the ship decision against.",
  flags: [
    {
      name: "--launch",
      required: true,
      value: "<launch-pack>",
      description: "The pack creative:launch published. Its hashes are re-checked before anything is read.",
    },
    {
      name: "--workspace",
      required: true,
      value: "<prepared-workspace>",
      description: "The same workspace, whose handoff now carries a filled Translation delta.",
    },
    {
      name: "--input",
      required: true,
      value: "<client-build-package>",
      description: "The same client input, now carrying the implemented experience source.",
    },
    {
      name: "--candidate",
      required: true,
      value: "<revision>",
      description: "The revision production committed. Must descend from the launch baseline.",
    },
    {
      name: "--output",
      required: true,
      value: "<empty-directory>",
      description: "Where to publish the report. Must be absent or empty; never overwritten.",
    },
    {
      name: "--evidence",
      required: false,
      value: "<candidate-evidence.json>",
      description: "Captures, accessibility and runtime results. Absent evidence is a failure, not an assumption.",
    },
  ],
  notes: [
    "Records what it measured. It does not decide whether the work should ship; a named human does that against the report it writes.",
    "Never modifies production source, and never edits evidence to make a check pass.",
  ],
};

/**
 * Roots a candidate may never touch, checked before the general allowlist so
 * the refusal names the actual problem rather than "outside the allowlist".
 */
const P1_ROOTS = ["packages/", "apps/", "scripts/", "tests/", "docs/", ".github/"];
const DEPENDENCY_FILES = ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".nvmrc"];

await runCommandMain(SPEC, async (flags) => {
  heading("Re-checking the launch pack");
  const launch = await loadLaunch(flags.launch);
  step(`launch ${launch.manifest.launchId.slice(0, 12)}… intact (${launch.fileCount} frozen file(s))`);

  const workspace = await loadWorkspaceForVerify(flags.workspace, launch);
  step(`workspace ${launch.manifest.workspaceId.slice(0, 12)}… is the one this launch froze`);

  heading("Placing the candidate against the launch baseline");
  const current = await inspectCurrentClientInput(flags.input);
  const repository = await resolveCandidate(current, launch, flags.candidate);
  step(`${displayPath(repository.root)}: ${repository.baseline.slice(0, 12)}… → ${repository.candidate.slice(0, 12)}…`);
  const diff = await inspectDiffScope(repository, launch, current);
  step(`${diff.changed.length} changed file(s), all inside ${launch.manifest.productionTarget.experienceRoot}`);

  heading("Assembling the candidate the ordinary way");
  const assembly = await assembleCandidate(current);
  step(`artifact ${assembly.binding.artifactId.slice(0, 12)}… assembled and its own verifier passed`);
  step(`source set ${assembly.binding.sourceSetId.slice(0, 12)}… (was ${launch.manifest.sourceBinding.sourceSetId.slice(0, 12)}…)`);

  heading("Running the objective checks");
  const checks: CheckResult[] = [];
  const logs: LogEntry[] = [];

  checks.push(...diff.checks);
  checks.push(...identityChecks(current, launch, assembly.binding));
  checks.push(...(await handoffChecks(workspace, launch)));
  const evidence = await loadCandidateEvidence(
    flags.evidence,
    assembly.binding,
    repository,
    current.routeIds,
  );
  checks.push(...evidence.checks);
  checks.push(
    ...(await runStandingGates(
      repository.root,
      basename(repository.root),
      workspace,
      logs,
    )),
  );

  for (const check of checks) {
    step(`${check.status === "PASS" ? "PASS" : check.status === "FAIL" ? "FAIL" : "  — "}  ${check.id}`);
  }

  const failed = checks.filter((check) => check.status === "FAIL");
  const result = failed.length === 0 ? "PASS" : "FAIL";
  const reportId = deriveReportId({
    launchId: launch.manifest.launchId,
    candidateRevision: repository.candidate,
    newArtifactId: assembly.binding.artifactId,
    newSourceSetId: assembly.binding.sourceSetId,
    checks: checks.map(({ id, status }) => ({ id, status })),
  });

  heading("Publishing the objective report");
  const { target } = await publishAtomically(flags.output, async (staging) => {
    for (const log of logs) {
      await writeInto(staging, `logs/${log.id}.log`, log.text);
    }
    for (const capture of evidence.copied) {
      await writeInto(staging, `evidence/${capture.path}`, capture.bytes);
    }

    const report = buildReport({
      reportId,
      result,
      launch,
      workspace,
      repository,
      current,
      assembly,
      diff,
      evidence,
      checks,
      logs,
    });
    assertContract("objective-validation-report", report);
    const reportBytes = await writeJsonInto(staging, "objective-validation-report.json", report);
    const reportSha256 = sha256(reportBytes);

    await writeInto(
      staging,
      "OBJECTIVE_VALIDATION_REPORT.md",
      renderReport(report, reportSha256, launch),
    );
    await writeInto(
      staging,
      "final-creative-gate.md",
      await renderFinalGate({
        clientId: current.clientId,
        candidateRevision: repository.candidate,
        reportSha256,
        artifactId: assembly.binding.artifactId,
      }),
    );
    await writeInto(staging, "README.md", verifyReadme(report, reportSha256, result));

    const files = await inventoryDirectory(staging, ["integrity.sha256"]);
    await writeChecksumSidecar(staging, "integrity.sha256", files);
    const failures = await makeReadOnly(staging, ["final-creative-gate.md"]);
    if (failures.length > 0) {
      step(`read-only permissions unavailable on ${failures.length} file(s); hashes remain authoritative`);
    }
    return { report, reportSha256 };
  });

  heading(`Objective validation report published: ${target}`);
  process.stdout.write(
    [
      `  report      ${reportId}`,
      `  result      ${result}${result === "FAIL" ? ` — ${failed.length} failing check(s)` : ""}`,
      `  candidate   ${repository.candidate}`,
      `  artifact    ${assembly.binding.artifactId} (was ${launch.manifest.sourceBinding.artifactId})`,
      `  source set  ${assembly.binding.sourceSetId} (was ${launch.manifest.sourceBinding.sourceSetId})`,
      "",
      ...(result === "FAIL"
        ? [
            "Failing checks:",
            ...failed.map((check) => `  ${check.id} — ${check.proof}`),
            "",
            "Fix them in source and run this command again into a new output directory.",
            "The report is not edited to make a check pass.",
            "",
          ]
        : []),
      "This report records what was measured. It does not say whether the work should ship.",
      `A named human decides that in ${join(displayPath(target), "final-creative-gate.md")},`,
      "which is the only file here left writable, and which no agent may sign.",
      "",
    ].join("\n"),
  );
  if (result === "FAIL") process.exitCode = 1;
});

/* ------------------------------------------------------------------ checks */

interface CheckResult {
  readonly id: string;
  readonly status: "PASS" | "FAIL" | "NOT_APPLICABLE";
  readonly proof: string;
  readonly code?: string;
  readonly evidence?: readonly string[];
}

function pass(id: string, proof: string): CheckResult {
  return { id, status: "PASS", proof };
}

function fail(id: string, proof: string, code?: string): CheckResult {
  return code === undefined ? { id, status: "FAIL", proof } : { id, status: "FAIL", proof, code };
}

function skip(id: string, proof: string): CheckResult {
  return { id, status: "NOT_APPLICABLE", proof };
}

/* ------------------------------------------------------------ launch pack */

interface LaunchManifest {
  readonly launchId: string;
  readonly workspaceId: string;
  readonly sourceBinding: {
    readonly artifactId: string;
    readonly sourceSetId: string;
    readonly definitionSha256: string;
    readonly generatedSnapshotSha256: string;
  };
  readonly repositoryBaseline: { readonly branch: string; readonly sourceRevision: string };
  readonly client: Record<string, string | number>;
  readonly productionTarget: {
    readonly inputLabel: string;
    readonly experienceRoot: string;
    readonly runtime: Record<string, string>;
  };
  readonly handoff: {
    readonly path: string;
    readonly sha256: string;
    readonly sliceGateDecision: string;
    readonly selectedTerritory: string;
    readonly gateDecidedBy: string;
    readonly postProductionSections: readonly string[];
  };
  readonly integrity: {
    readonly allowlist: readonly string[];
    readonly files: readonly { path: string; sha256: string; size: number }[];
  };
}

interface LoadedLaunch {
  readonly root: string;
  readonly manifest: LaunchManifest;
  readonly fileCount: number;
}

/**
 * The launch pack, proved to be the pack that was published.
 *
 * First, because a launch pack read after it was edited is a brief nobody
 * approved. Every file in it is immutable, so unlike the workspace there is no
 * editable tree to exclude: the whole inventory is checked.
 */
async function loadLaunch(path: string): Promise<LoadedLaunch> {
  const root = await resolveExistingDirectory(path, "launch pack");
  const manifestPath = await resolveExistingFile(
    join(root, "production-launch.json"),
    "production-launch.json",
  );
  const manifest = (await readJsonFile(manifestPath, "production-launch.json")) as LaunchManifest;
  assertContract("production-launch", manifest);

  const sidecar = await readFile(join(root, "integrity.sha256"), "utf8").catch(() => "");
  const recorded = sidecar
    .split("\n")
    .find((line) => line.endsWith("  production-launch.json"))
    ?.slice(0, 64);
  if (recorded !== (await hashFile(manifestPath))) {
    throw refuse(
      "LAUNCH_TAMPERED",
      "production-launch.json does not match the hash integrity.sha256 recorded for it. Launch again rather than verifying against an edited brief.",
      { launch: root },
    );
  }
  const result = await verifyInventory(root, manifest.integrity.files);
  if (!result.intact) {
    throw refuse(
      "LAUNCH_TAMPERED",
      [
        "The launch pack no longer matches its own inventory.",
        ...result.missing.map((file) => `  missing  ${file}`),
        ...result.changed.map((file) => `  changed  ${file}`),
        "",
        "A launch pack is frozen. Run creative:launch again if the brief has to change.",
      ].join("\n"),
      { missing: result.missing, changed: result.changed },
    );
  }
  return { root, manifest, fileCount: manifest.integrity.files.length };
}

interface LoadedWorkspaceForVerify {
  readonly root: string;
  readonly delivery: string;
  readonly documents: readonly DeliveryDocument[];
}

interface DeliveryDocument {
  readonly name: string;
  readonly kind: string;
  readonly frontMatter: Record<string, unknown>;
  readonly body: string;
  readonly text: string;
}

async function loadWorkspaceForVerify(
  path: string,
  launch: LoadedLaunch,
): Promise<LoadedWorkspaceForVerify> {
  const root = await resolveExistingDirectory(path, "prepared workspace");
  const manifest = (await readJsonFile(
    join(root, "premium-workspace.json"),
    "premium-workspace.json",
  )) as { workspaceId: string };
  if (manifest.workspaceId !== launch.manifest.workspaceId) {
    throw refuse(
      "ARTIFACT_MISMATCH",
      `This workspace is ${manifest.workspaceId}; the launch pack was cut from ${launch.manifest.workspaceId}.`,
      { workspace: manifest.workspaceId, launch: launch.manifest.workspaceId },
    );
  }

  const delivery = join(root, "delivery");
  const entries = await readdir(delivery, { withFileTypes: true }).catch(() => {
    throw refuse("INPUT_NOT_FOUND", `${delivery} does not exist.`, { delivery });
  });
  const documents: DeliveryDocument[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const text = await readFile(join(delivery, entry.name), "utf8");
    const { frontMatter, body } = parseFrontMatter(text);
    if (frontMatter === null || frontMatter.kind === undefined) continue;
    if (ARTIFACTS[frontMatter.kind as string] === undefined) continue;
    documents.push({
      name: entry.name,
      kind: String(frontMatter.kind),
      frontMatter: frontMatter as Record<string, unknown>,
      body,
      text,
    });
  }
  return { root, delivery, documents };
}

/* ------------------------------------------------------------- repository */

interface CandidatePosition {
  readonly root: string;
  readonly baseline: string;
  readonly candidate: string;
  readonly branch: string;
}

/**
 * Where the candidate sits relative to the baseline the launch recorded.
 *
 * A revision that does not descend from the baseline is refused rather than
 * diffed: the diff would still produce a file list, and that list would be a
 * comparison between two unrelated states presented as a delta, which is the
 * most convincing wrong answer this command could give.
 */
async function resolveCandidate(
  current: CurrentClientInput,
  launch: LoadedLaunch,
  candidate: string,
): Promise<CandidatePosition> {
  const toplevel = await runCommand("git", ["rev-parse", "--show-toplevel"], current.inputDirectory);
  if (toplevel.exitCode !== 0 || toplevel.output.trim() === "") {
    throw refuse(
      "CANDIDATE_REVISION_INVALID",
      `${displayPath(current.inputDirectory)} is not inside a Git repository, so there is no candidate revision to verify.`,
      {},
    );
  }
  const root = toplevel.output.trim();

  const status = await runCommand("git", ["status", "--porcelain"], root);
  const dirty = status.output.split("\n").filter((line) => line.trim() !== "");
  if (dirty.length > 0) {
    throw refuse(
      "WORKTREE_DIRTY",
      [
        `The worktree at ${displayPath(root)} has ${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"}:`,
        ...dirty.slice(0, 20).map((line) => `  ${line}`),
        "",
        "Commit them into the candidate. Verification reports on a revision, and uncommitted work is not shippable evidence.",
      ].join("\n"),
      { changes: dirty.length },
    );
  }

  const resolved = await runCommand("git", ["rev-parse", "--verify", `${candidate}^{commit}`], root);
  if (resolved.exitCode !== 0) {
    throw refuse(
      "CANDIDATE_REVISION_INVALID",
      `"${candidate}" is not a commit in ${displayPath(root)}.`,
      { candidate },
    );
  }
  const revision = resolved.output.trim();
  const baseline = launch.manifest.repositoryBaseline.sourceRevision;

  const known = await runCommand("git", ["rev-parse", "--verify", `${baseline}^{commit}`], root);
  if (known.exitCode !== 0) {
    throw refuse(
      "CANDIDATE_REVISION_INVALID",
      `The launch baseline ${baseline} is not a commit in ${displayPath(root)}. This candidate was built in a different repository from the one that was launched.`,
      { baseline },
    );
  }
  const ancestor = await runCommand(
    "git",
    ["merge-base", "--is-ancestor", baseline, revision],
    root,
  );
  if (ancestor.exitCode !== 0) {
    throw refuse(
      "CANDIDATE_REVISION_INVALID",
      `${revision.slice(0, 12)}… does not descend from the launch baseline ${baseline.slice(0, 12)}…. A candidate that is not built on the baseline cannot be reported as a delta from it.`,
      { candidate: revision, baseline },
    );
  }

  const head = await runCommand("git", ["rev-parse", "HEAD"], root);
  if (head.output.trim() !== revision) {
    throw refuse(
      "CANDIDATE_REVISION_INVALID",
      `The worktree is at ${head.output.trim().slice(0, 12)}… but the candidate is ${revision.slice(0, 12)}…. Check out the candidate: this command reads the working tree, so it has to be the revision being reported on.`,
      { head: head.output.trim(), candidate: revision },
    );
  }

  const branch = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
  return { root, baseline, candidate: revision, branch: branch.output.trim() };
}

/* ------------------------------------------------------------ diff scope */

interface DiffScope {
  readonly changed: readonly { path: string; status: string }[];
  readonly checks: readonly CheckResult[];
}

/**
 * Everything the candidate changed, classified against the launch boundary.
 *
 * Order matters. Dependency and business-truth changes are named before the
 * general scope check, because "you changed pnpm-lock.yaml" and "you changed a
 * file outside the allowlist" are the same fact reported at two very different
 * levels of usefulness.
 */
async function inspectDiffScope(
  repository: CandidatePosition,
  launch: LoadedLaunch,
  current: CurrentClientInput,
): Promise<DiffScope> {
  const diff = await runCommand(
    "git",
    ["diff", "--name-status", "-M", `${repository.baseline}..${repository.candidate}`],
    repository.root,
  );
  if (diff.exitCode !== 0) {
    throw refuse(
      "CANDIDATE_REVISION_INVALID",
      `git diff failed between the baseline and the candidate: ${diff.output.trim()}`,
      {},
    );
  }
  const changed = diff.output
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => {
      const [status, ...paths] = line.split("\t");
      return { status, path: paths[paths.length - 1] };
    });

  const allowedRoot = `${launch.manifest.productionTarget.experienceRoot}/`;
  const inputRoot = `${launch.manifest.productionTarget.inputLabel}/`;

  const dependency = changed.filter((entry) =>
    DEPENDENCY_FILES.some((file) => entry.path === file || entry.path.endsWith(`/${file}`)),
  );
  if (dependency.length > 0) {
    throw refuse(
      "DEPENDENCY_DRIFT",
      `The candidate changed ${dependency.map((entry) => entry.path).join(", ")}. This launch approved no dependency or runtime change; that needs a stop and a new decision, not a commit.`,
      { files: dependency.map((entry) => entry.path) },
    );
  }

  const truth = changed.filter((entry) => entry.path === `${inputRoot}client-website.json`);
  if (truth.length > 0) {
    throw refuse(
      "BUSINESS_TRUTH_DRIFT",
      "The candidate changed client-website.json. Business truth is an input to a premium delivery, never an output of one; change it upstream and prepare again.",
      { path: truth[0].path },
    );
  }

  const escapes = changed.filter(
    (entry) =>
      !entry.path.startsWith(allowedRoot) &&
      (P1_ROOTS.some((root) => entry.path.startsWith(root)) || !entry.path.includes("/")),
  );
  if (escapes.length > 0) {
    throw refuse(
      "PRODUCTION_SCOPE_ESCAPE",
      [
        `The candidate changed ${escapes.length} file(s) in P1, Core or root configuration:`,
        ...escapes.slice(0, 20).map((entry) => `  ${entry.status}  ${entry.path}`),
        "",
        "Signature work is client-local. If a mechanic genuinely needs the platform to change, that is a stop condition and a separate decision.",
      ].join("\n"),
      { paths: escapes.map((entry) => entry.path) },
    );
  }

  const outside = changed.filter((entry) => !entry.path.startsWith(allowedRoot));
  if (outside.length > 0) {
    const foreign = outside.filter((entry) => !entry.path.startsWith(inputRoot));
    throw refuse(
      foreign.length > 0 ? "PRODUCTION_SCOPE_ESCAPE" : "UNEXPECTED_CHANGE_SCOPE",
      [
        `The candidate changed ${outside.length} file(s) outside ${allowedRoot}:`,
        ...outside.slice(0, 20).map((entry) => `  ${entry.status}  ${entry.path}`),
        "",
        foreign.length > 0
          ? "Some of them belong to another client. A delivery changes one client's experience and nothing else."
          : `Only ${allowedRoot} is in scope for this launch.`,
      ].join("\n"),
      { paths: outside.map((entry) => entry.path) },
    );
  }

  const definitionSha256 = await hashFile(join(current.inputDirectory, "client-website.json"));
  const checks: CheckResult[] = [
    changed.length === 0
      ? fail(
          "scope.candidate-changed-something",
          `${repository.candidate.slice(0, 12)}… is identical to the launch baseline. There is no implementation to verify.`,
        )
      : pass(
          "scope.inside-launch-allowlist",
          `${changed.length} changed file(s), every one under ${allowedRoot}.`,
        ),
    definitionSha256 === launch.manifest.sourceBinding.definitionSha256
      ? pass("truth.definition-unchanged", `client-website.json still hashes to ${definitionSha256.slice(0, 12)}…`)
      : fail(
          "truth.definition-unchanged",
          `client-website.json now hashes to ${definitionSha256.slice(0, 12)}…, not the ${launch.manifest.sourceBinding.definitionSha256.slice(0, 12)}… this launch was cut from.`,
          "BUSINESS_TRUTH_DRIFT",
        ),
  ];
  return { changed, checks };
}

/* ---------------------------------------------------------------- identity */

function identityChecks(
  current: CurrentClientInput,
  launch: LoadedLaunch,
  binding: ExactBinding,
): CheckResult[] {
  const checks: CheckResult[] = [];
  const mismatches = Object.entries(launch.manifest.client).filter(
    ([key, value]) => (current as unknown as Record<string, unknown>)[key] !== value,
  );
  checks.push(
    mismatches.length === 0
      ? pass(
          "identity.client-continuity",
          `${current.clientId}, configuration ${current.configurationId}@${current.configurationVersion}, deployment ${current.deploymentId}, experience ${current.experienceId}@${current.experienceVersion} — unchanged.`,
        )
      : fail(
          "identity.client-continuity",
          `${mismatches.map(([key, value]) => `${key} was ${String(value)}, is now ${String((current as unknown as Record<string, unknown>)[key])}`).join("; ")}.`,
          "IDENTITY_MISMATCH",
        ),
  );

  const runtimeDrift = Object.entries(launch.manifest.productionTarget.runtime).filter(
    ([key, value]) => current.runtime[key as keyof typeof current.runtime] !== value,
  );
  checks.push(
    runtimeDrift.length === 0
      ? pass(
          "runtime.posture-unchanged",
          `clientJavaScript ${current.runtime.clientJavaScript}, motion ${current.runtime.motion}, reducedMotion ${current.runtime.reducedMotion}.`,
        )
      : fail(
          "runtime.posture-unchanged",
          `${runtimeDrift.map(([key, value]) => `${key} was ${value}, is now ${String(current.runtime[key as keyof typeof current.runtime])}`).join("; ")}. A launch that approved no runtime change cannot ship one.`,
          "DEPENDENCY_DRIFT",
        ),
  );

  checks.push(
    current.publicDependencies.length === 0
      ? pass("runtime.no-public-dependency", "The experience declares no public dependency.")
      : pass(
          "runtime.public-dependencies",
          current.publicDependencies.map((dependency) => `${dependency.name}@${dependency.version}`).join(", "),
        ),
  );

  checks.push(
    binding.sourceSetId === launch.manifest.sourceBinding.sourceSetId
      ? fail(
          "source.candidate-differs-from-launch",
          "The candidate's source set is identical to the launch baseline's. Nothing in the experience changed.",
        )
      : pass(
          "source.candidate-differs-from-launch",
          `source set ${binding.sourceSetId.slice(0, 12)}… (was ${launch.manifest.sourceBinding.sourceSetId.slice(0, 12)}…).`,
        ),
  );
  return checks;
}

/* ----------------------------------------------------------------- handoff */

/**
 * The delivery after implementation.
 *
 * Two things are checked that could not be checked at launch. The Translation
 * delta must now be filled, because the question it answers — what changed while
 * translating the approved slice into the existing substrate, and why the intent
 * still holds — has an answer only once the work exists. And everything else in
 * the handoff must be byte-identical to the copy the launch pack froze: a
 * Production delta edited after the agent started is a record of what was built
 * rather than what was approved, and the difference between those two is
 * exactly what a ship gate exists to catch.
 */
async function handoffChecks(
  workspace: LoadedWorkspaceForVerify,
  launch: LoadedLaunch,
): Promise<CheckResult[]> {
  const checks: CheckResult[] = [];
  const envelope = loadEnvelope(
    await readFile(
      join(repositoryRoot, "docs/creative/signature-capability-envelope.json"),
      "utf8",
    ),
  );
  const problems = validateArtifacts(workspace.documents, envelope) as {
    file: string;
    message: string;
    code?: string;
  }[];
  checks.push(
    problems.length === 0
      ? pass("delivery.validates", `${workspace.documents.length} artifact(s) pass creative:validate.`)
      : fail(
          "delivery.validates",
          problems.map((problem) => `${problem.file} ${problem.message}`).join(" | "),
          problems.find((problem) => problem.code !== undefined)?.code ?? "DELIVERY_INCOMPLETE",
        ),
  );

  const handoff = workspace.documents.find((document) => document.kind === "production-handoff");
  if (handoff === undefined) {
    checks.push(fail("handoff.present", "The delivery no longer holds a production handoff.", "DELIVERY_INCOMPLETE"));
    return checks;
  }

  const postProduction = launch.manifest.handoff.postProductionSections;
  const unfilled = postProduction.filter((section) => {
    const content = sectionBody(handoff.body, section);
    return content === null || isUnfilled(stripScaffolding(content));
  });
  checks.push(
    unfilled.length === 0
      ? pass(
          "handoff.translation-delta",
          `${postProduction.join(", ")} filled: production recorded what it changed while translating the approved slice.`,
        )
      : fail(
          "handoff.translation-delta",
          `${unfilled.join(", ")} still empty. Production must record what changed while translating the slice into the existing substrate, and why the intent still holds.`,
          "TRANSLATION_DELTA_MISSING",
        ),
  );

  const frozen = await readFile(join(launch.root, launch.manifest.handoff.path), "utf8");
  const drifted = comparePreProductionContent(frozen, handoff.text, postProduction);
  checks.push(
    drifted.length === 0
      ? pass(
          "handoff.approved-intent-unchanged",
          "Everything the gate approved is byte-identical to the copy the launch pack froze.",
        )
      : fail(
          "handoff.approved-intent-unchanged",
          `${drifted.join(", ")} changed after the launch was cut. A handoff edited during implementation records what was built, not what was approved.`,
          "DELIVERY_INCOMPLETE",
        ),
  );
  return checks;
}

/** Which parts of the handoff differ, ignoring the post-production sections. */
function comparePreProductionContent(
  frozen: string,
  current: string,
  postProduction: readonly string[],
): string[] {
  const drifted: string[] = [];
  const left = parseFrontMatter(frozen) as { frontMatter: Record<string, unknown>; body: string };
  const right = parseFrontMatter(current) as { frontMatter: Record<string, unknown>; body: string };
  if (JSON.stringify(left.frontMatter) !== JSON.stringify(right.frontMatter)) {
    drifted.push("front matter");
  }
  for (const section of ARTIFACTS["production-handoff"].sections as string[]) {
    if (postProduction.includes(section)) continue;
    if ((sectionBody(left.body, section) ?? "") !== (sectionBody(right.body, section) ?? "")) {
      drifted.push(`"## ${section}"`);
    }
  }
  return drifted;
}

/* ---------------------------------------------------------------- assembly */

interface Assembly {
  readonly binding: ExactBinding;
  readonly directory: string;
  readonly verifier: CommandResult;
}

/**
 * The ordinary P1 assembly path, not a premium fork.
 *
 * The candidate has to produce a standalone artifact the same way every other
 * client does, and that artifact's own handoff verifier has to pass — the same
 * script a client is told to run on delivered bytes. Anything weaker would be
 * this command deciding the artifact is fine on its own authority.
 *
 * It assembles into a temporary directory beside the report output and leaves
 * it there: the artifact is evidence, and deleting it would mean the report
 * asserts an assembly happened rather than pointing at its result.
 */
async function assembleCandidate(current: CurrentClientInput): Promise<Assembly> {
  const { assembleClientSourceArtifact } = await import(
    "../../apps/managed-web/src/generation/index"
  );
  const temporary = await mkdtemp(join(tmpdir(), "premium-candidate-artifact-"));
  const directory = join(temporary, "artifact");
  const revision = await runCommand("git", ["rev-parse", "--short", "HEAD"], repositoryRoot);
  try {
    await assembleClientSourceArtifact({
      definition: current.definition,
      publicDirectory: join(current.inputDirectory, "public"),
      inputDirectory: current.inputDirectory,
      outputDirectory: directory,
      factoryRevision: revision.exitCode === 0 ? revision.output.trim() : "unknown",
    });
    const artifact = await loadArtifact(directory);
    const binding = await bindClientToArtifact({ current, artifact });
    return { binding, directory, verifier: binding.verifier };
  } finally {
    await rm(temporary, { force: true, recursive: true });
  }
}

/* ---------------------------------------------------------------- evidence */

interface EvidenceState {
  readonly checks: readonly CheckResult[];
  readonly copied: readonly { path: string; bytes: Buffer }[];
  readonly index: Record<string, unknown>;
}

/**
 * What production observed, checked for coverage rather than for beauty.
 *
 * Absent evidence fails. That is the whole design: a reviewer looking at a
 * report with no mobile captures must see a failing check, not a silent gap
 * that reads as approval. Captures are hash-verified against the manifest and
 * copied into the report, so the report a human reviews later still contains
 * the images the decision was made against.
 */
async function loadCandidateEvidence(
  path: string | undefined,
  binding: ExactBinding,
  repository: CandidatePosition,
  routeIds: readonly string[],
): Promise<EvidenceState> {
  if (path === undefined) {
    return {
      checks: [
        fail(
          "evidence.supplied",
          "No candidate evidence manifest was given. Missing evidence is a failure, not an assumption: capture the required widths and states and pass --evidence.",
        ),
        fail("evidence.viewport-coverage", "No evidence to cover 1440, 834, 390 or 320.", "MOBILE_EVIDENCE_MISSING"),
        fail("evidence.reduced-motion", "No designed reduced-motion state was recorded.", "REDUCED_MOTION_MISSING"),
        fail("evidence.accessibility", "No accessibility results were recorded."),
        fail("evidence.runtime", "No console, network, overflow or isolation results were recorded."),
      ],
      copied: [],
      index: { supplied: false },
    };
  }

  const file = await resolveExistingFile(path, "candidate evidence manifest");
  const record = (await readJsonFile(file, "candidate evidence manifest")) as {
    artifactId: string;
    sourceSetId: string;
    candidateRevision: string;
    captures: { path: string; sha256: string; route: string; state: string; viewportWidth: number; motion: string }[];
    accessibility?: { engine: string; state: string; result: string; proof: string }[];
    runtime?: { check: string; scope: string; result: string; proof: string }[];
  };
  const problems = validateRecord("candidate-evidence", record);
  if (problems.length > 0) {
    throw refuse(
      "CONTRACT_INVALID",
      [`${basename(file)} is not a complete candidate evidence manifest:`, ...problems.map((problem) => `  ${problem}`)].join("\n"),
      { problems },
    );
  }

  const checks: CheckResult[] = [];
  /*
   * Binding is on the source set and the candidate revision, not on the
   * artifact id.
   *
   * P1 assembly is not byte-reproducible: the generated Pagefind index carries
   * run-varying filenames and content, so two assemblies of identical source at
   * the same Factory revision produce different artifact ids. Requiring the
   * artifact id to match would therefore fail honest evidence and teach an
   * operator to recapture until it passed -- which is exactly how a real
   * "captures of a previous build" failure would stop being noticed.
   *
   * The source set and the revision are what production actually wrote, and
   * they are stable. The artifact id is still recorded, as provenance of the
   * build that was captured.
   */
  const bound =
    record.sourceSetId === binding.sourceSetId &&
    record.candidateRevision === repository.candidate;
  checks.push(
    bound
      ? pass(
          "evidence.bound-to-candidate",
          `${record.captures.length} capture(s) of source set ${record.sourceSetId.slice(0, 12)}… at ${record.candidateRevision.slice(0, 12)}…, captured from artifact ${record.artifactId.slice(0, 12)}….`,
        )
      : fail(
          "evidence.bound-to-candidate",
          `The evidence names source set ${record.sourceSetId.slice(0, 12)}… at revision ${record.candidateRevision.slice(0, 12)}…; this candidate is source set ${binding.sourceSetId.slice(0, 12)}… at ${repository.candidate.slice(0, 12)}…. Captures of a previous build are the most convincing way to review a change that never happened.`,
          "BASELINE_UNBOUND",
        ),
  );

  const evidenceRoot = resolve(file, "..");
  const copied: { path: string; bytes: Buffer }[] = [];
  const missing: string[] = [];
  const tampered: string[] = [];
  for (const capture of record.captures) {
    const absolute = join(evidenceRoot, ...capture.path.split("/"));
    const bytes = await readFile(absolute).catch(() => undefined);
    if (bytes === undefined) {
      missing.push(capture.path);
      continue;
    }
    if (sha256(bytes) !== capture.sha256) {
      tampered.push(capture.path);
      continue;
    }
    copied.push({ path: capture.path, bytes });
  }
  checks.push(
    missing.length === 0 && tampered.length === 0
      ? pass("evidence.captures-present", `${copied.length} capture(s) found and hash-verified.`)
      : fail(
          "evidence.captures-present",
          [
            ...missing.map((capture) => `missing ${capture}`),
            ...tampered.map((capture) => `${capture} does not match its recorded hash`),
          ].join("; "),
        ),
  );

  const verified = record.captures.filter((capture) =>
    copied.some((entry) => entry.path === capture.path),
  );
  const byRoute = new Map<string, Set<number>>();
  for (const capture of verified) {
    const widths = byRoute.get(capture.route) ?? new Set<number>();
    widths.add(capture.viewportWidth);
    byRoute.set(capture.route, widths);
  }
  /* Coverage is measured against the routes the experience manifest declares,
   * not against the routes someone happened to capture. A delivery evidenced at
   * four widths on one route and nowhere else is the exact gap this check
   * exists to find. */
  const uncovered = routeIds
    .map((route) => ({
      route,
      missing: REQUIRED_VIEWPORT_WIDTHS.filter(
        (width) => !(byRoute.get(route)?.has(width) ?? false),
      ),
    }))
    .filter((entry) => entry.missing.length > 0);
  checks.push(
    uncovered.length === 0
      ? pass(
          "evidence.viewport-coverage",
          `${routeIds.length} declared route(s) captured at ${REQUIRED_VIEWPORT_WIDTHS.join(", ")}.`,
        )
      : fail(
          "evidence.viewport-coverage",
          uncovered
            .map((entry) =>
              byRoute.has(entry.route)
                ? `${entry.route} missing ${entry.missing.join(", ")}px`
                : `${entry.route} was not captured at all`,
            )
            .join("; "),
          "MOBILE_EVIDENCE_MISSING",
        ),
  );

  const reduced = verified.filter((capture) => capture.motion === "REDUCED");
  checks.push(
    reduced.length === 0
      ? fail(
          "evidence.reduced-motion",
          "No capture records prefers-reduced-motion. The reduced state is a designed state, and a delivery that has not been looked at with motion off has not been finished.",
          "REDUCED_MOTION_MISSING",
        )
      : pass(
          "evidence.reduced-motion",
          `${reduced.length} reduced-motion capture(s) across ${new Set(reduced.map((capture) => capture.route)).size} route(s).`,
        ),
  );

  for (const [id, entries, label] of [
    ["evidence.accessibility", record.accessibility ?? [], "accessibility"],
    ["evidence.runtime", record.runtime ?? [], "runtime"],
  ] as const) {
    const failures = (entries as { result: string; proof: string }[]).filter(
      (entry) => entry.result === "FAIL",
    );
    checks.push(
      entries.length === 0
        ? fail(id, `No ${label} results were recorded.`)
        : failures.length === 0
          ? pass(id, `${entries.length} ${label} result(s), all passing.`)
          : fail(id, failures.map((entry) => entry.proof).join("; ")),
    );
  }

  return {
    checks,
    copied,
    index: {
      supplied: true,
      manifest: basename(file),
      captures: verified.length,
      routes: [...byRoute.keys()].sort(compareText),
      widths: [...new Set(verified.map((capture) => capture.viewportWidth))].sort((a, b) => b - a),
      reducedMotionCaptures: reduced.length,
      accessibility: record.accessibility ?? [],
      runtime: record.runtime ?? [],
    },
  };
}

/* ----------------------------------------------------------- standing gates */

interface LogEntry {
  readonly id: string;
  readonly text: string;
}

/**
 * The repository's own standing gates, run rather than restated.
 *
 * A small explicit runner: each gate is a root script the production repository
 * already defines, and the result is its exit status plus a log this report
 * points at. A gate the repository does not define is NOT_APPLICABLE with the
 * reason — a client input in a bare repository has no standing gates, and
 * pretending otherwise would report a pass nothing produced.
 */
async function runStandingGates(
  root: string,
  label: string,
  workspace: LoadedWorkspaceForVerify,
  logs: LogEntry[],
): Promise<CheckResult[]> {
  const packageJson = await readPackageJson(root);
  const scripts = packageJson?.scripts ?? {};

  const gates: { id: string; script: string; argv: readonly string[] }[] = [
    { id: "gate.creative-test", script: "creative:test", argv: [] },
    { id: "gate.creative-validate", script: "creative:validate", argv: [workspace.delivery] },
    { id: "gate.check", script: "check", argv: [] },
  ];

  const results: CheckResult[] = [];
  for (const gate of gates) {
    if (scripts[gate.script] === undefined) {
      results.push(
        skip(
          gate.id,
          packageJson === undefined
            ? `${label} has no package.json, so it defines no "${gate.script}" gate.`
            : `${label} defines no "${gate.script}" script.`,
        ),
      );
      continue;
    }
    const outcome = await runCommand("pnpm", ["run", gate.script, ...gate.argv], root);
    logs.push({ id: gate.id, text: `$ ${outcome.command}\n\n${outcome.output}` });
    results.push(
      outcome.exitCode === 0
        ? pass(
            gate.id,
            `pnpm run ${gate.script} exited 0 in ${outcome.durationMs} ms. See logs/${gate.id}.log.`,
          )
        : fail(
            gate.id,
            `pnpm run ${gate.script} exited ${outcome.exitCode} after ${outcome.durationMs} ms. See logs/${gate.id}.log.`,
            "OBJECTIVE_VALIDATION_FAILED",
          ),
    );
  }
  return results;
}

/**
 * The production repository's own package.json, or nothing.
 *
 * An absent file means the repository defines no standing gates. Malformed JSON
 * is a different thing entirely and is not quietly read as "absent", because
 * that would report a skipped gate where the truth is a broken repository.
 */
async function readPackageJson(
  root: string,
): Promise<{ scripts?: Record<string, string> } | undefined> {
  const text = await readFile(join(root, "package.json"), "utf8").catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text) as { scripts?: Record<string, string> };
  } catch (error) {
    throw refuse(
      "CONTRACT_INVALID",
      `package.json in the production repository is not valid JSON: ${(error as Error).message}`,
      {},
    );
  }
}

/* ------------------------------------------------------------------ report */

function buildReport(input: {
  reportId: string;
  result: "PASS" | "FAIL";
  launch: LoadedLaunch;
  workspace: LoadedWorkspaceForVerify;
  repository: CandidatePosition;
  current: CurrentClientInput;
  assembly: Assembly;
  diff: DiffScope;
  evidence: EvidenceState;
  checks: readonly CheckResult[];
  logs: readonly LogEntry[];
}) {
  const { launch, assembly, repository } = input;
  return {
    schemaVersion: 1 as const,
    kind: "PREMIUM_OBJECTIVE_VALIDATION" as const,
    reportId: input.reportId,
    launchId: launch.manifest.launchId,
    workspaceId: launch.manifest.workspaceId,
    candidateRevision: repository.candidate,
    result: input.result,
    humanCreativeDecision: "REQUIRED_SEPARATELY" as const,
    createdBy: { command: "creative:verify" as const },
    repository: {
      branch: repository.branch,
      baselineRevision: repository.baseline,
    },
    client: {
      clientId: input.current.clientId,
      configurationId: input.current.configurationId,
      deploymentId: input.current.deploymentId,
      experienceId: input.current.experienceId,
      experienceVersion: input.current.experienceVersion,
    },
    identities: {
      oldArtifactId: launch.manifest.sourceBinding.artifactId,
      oldSourceSetId: launch.manifest.sourceBinding.sourceSetId,
      definitionSha256: launch.manifest.sourceBinding.definitionSha256,
      newArtifactId: assembly.binding.artifactId,
      newSourceSetId: assembly.binding.sourceSetId,
      newGeneratedSnapshotSha256: assembly.binding.generatedSnapshotSha256,
      factoryRevision: assembly.binding.factoryRevision,
    },
    diffScope: {
      allowedRoot: launch.manifest.productionTarget.experienceRoot,
      changedFileCount: input.diff.changed.length,
      changed: input.diff.changed.map((entry) => ({ status: entry.status, path: entry.path })),
    },
    runtimeDelta: {
      clientJavaScript: input.current.runtime.clientJavaScript,
      motion: input.current.runtime.motion,
      reducedMotion: input.current.runtime.reducedMotion,
      publicDependencies: input.current.publicDependencies.map(
        (dependency) => `${dependency.name}@${dependency.version}`,
      ),
      approvedDependencyChanges: [],
    },
    checks: input.checks.map((check) => ({
      id: check.id,
      status: check.status,
      proof: check.proof,
      ...(check.code === undefined ? {} : { code: check.code }),
    })),
    evidenceIndex: input.evidence.index,
    evidence: input.evidence.copied.map((capture) => ({
      path: `evidence/${capture.path}`,
      sha256: sha256(capture.bytes),
      kind: "CANDIDATE_CAPTURE",
    })),
    logs: input.logs.map((log) => ({ id: log.id, path: `logs/${log.id}.log` })),
    unresolvedFailures: input.checks
      .filter((check) => check.status === "FAIL")
      .map((check) => ({ id: check.id, proof: check.proof })),
  };
}

function renderReport(
  report: ReturnType<typeof buildReport>,
  reportSha256: string,
  launch: LoadedLaunch,
): string {
  const row = (check: (typeof report.checks)[number]) =>
    `| ${check.status === "PASS" ? "PASS" : check.status === "FAIL" ? "**FAIL**" : "n/a"} | \`${check.id}\` | ${check.proof.replaceAll("|", "\\|")} |`;

  return `# Objective validation report

**Result: ${report.result}.** This report records what was measured. It does not
say whether the work should ship, and there is no field in it in which such a
decision could be recorded.

| | |
|---|---|
| Report | \`${report.reportId}\` |
| Report SHA-256 | \`${reportSha256}\` |
| Launch | \`${report.launchId}\` |
| Client | \`${report.client.clientId}\` |
| Branch | \`${report.repository.branch}\` |
| Baseline → candidate | \`${report.repository.baselineRevision}\` → \`${report.candidateRevision}\` |

## Identity delta

| | Before | After |
|---|---|---|
| Artifact | \`${report.identities.oldArtifactId}\` | \`${report.identities.newArtifactId}\` |
| Source set | \`${report.identities.oldSourceSetId}\` | \`${report.identities.newSourceSetId}\` |
| Business truth | \`${report.identities.definitionSha256}\` | unchanged |

## Scope

${report.diffScope.changedFileCount} changed file(s), all under \`${report.diffScope.allowedRoot}\`.

${report.diffScope.changed.map((entry) => `- \`${entry.status}\` \`${entry.path}\``).join("\n")}

## Checks

| | Check | What was observed |
|---|---|---|
${report.checks.map(row).join("\n")}

## Evidence

${
  report.evidence.length === 0
    ? "_No captures were supplied. Every evidence check above records that as a failure._"
    : `${report.evidence.length} capture(s) copied into \`evidence/\` and hash-verified against the manifest they came with.`
}

## Runtime

- client JavaScript: \`${report.runtimeDelta.clientJavaScript}\`
- motion: \`${report.runtimeDelta.motion}\`
- reduced motion: \`${report.runtimeDelta.reducedMotion}\`
- public dependencies: ${report.runtimeDelta.publicDependencies.length === 0 ? "none" : report.runtimeDelta.publicDependencies.map((dependency) => `\`${dependency}\``).join(", ")}
- dependency changes approved by this launch: none

## Unresolved objective failures

${
  report.unresolvedFailures.length === 0
    ? "_None._"
    : report.unresolvedFailures.map((failure) => `- \`${failure.id}\` — ${failure.proof}`).join("\n")
}

## What happens next

A named human reviews the work itself and this report, then decides in
\`final-creative-gate.md\`. The gate approving the *direction* was
${launch.manifest.handoff.sliceGateDecision} by ${launch.manifest.handoff.gateDecidedBy};
this is the separate decision about whether the built result ships.

\`humanCreativeDecision: ${report.humanCreativeDecision}\`
`;
}

/**
 * The ship gate, emitted blank.
 *
 * From the repository's own template, with only the fields a machine can know
 * filled in: the client, the candidate, and the report this decision must be
 * made against. `decision` and `decided_by` stay empty, and the validator
 * refuses a non-human decider, so the one thing automation cannot do here it
 * also cannot accidentally do.
 */
async function renderFinalGate(input: {
  clientId: string;
  candidateRevision: string;
  reportSha256: string;
  artifactId: string;
}): Promise<string> {
  const template = await readFile(
    join(repositoryRoot, "docs/creative/templates/final-creative-gate.md"),
    "utf8",
  );
  return template
    .replace("client: <client-id>", `client: ${input.clientId}`)
    .replace("candidate_commit:", `candidate_commit: ${input.candidateRevision}`)
    .replace(
      "validation_report: # relative path to objective-validation-report.json",
      "validation_report: objective-validation-report.json",
    )
    .replace(
      "validation_report_sha256: # its SHA-256, as creative:verify printed it",
      `validation_report_sha256: ${input.reportSha256}`,
    )
    .replace(
      "source_artifact_id: # the artifact this candidate was built from",
      `source_artifact_id: ${input.artifactId}`,
    );
}

function verifyReadme(
  report: ReturnType<typeof buildReport>,
  reportSha256: string,
  result: string,
): string {
  return `# Objective validation output

Published by \`pnpm creative:verify\` for candidate \`${report.candidateRevision}\`.

**Result: ${result}.**

| Path | What it is |
|---|---|
| \`OBJECTIVE_VALIDATION_REPORT.md\` | The readable report. Start here. |
| \`objective-validation-report.json\` | The same content, machine-readable. SHA-256 \`${reportSha256}\`. |
| \`final-creative-gate.md\` | The blank ship gate. The only writable file here. |
| \`evidence/\` | Captures copied from the evidence manifest, hash-verified. |
| \`logs/\` | Output of every standing gate this run executed. |
| \`integrity.sha256\` | \`sha256sum -c integrity.sha256\` proves this output is intact. |

## The decision this output does not make

Nothing here says the work is good, finished, or worth shipping. A machine can
say the delta stayed inside its boundary, that the candidate still assembles,
and that the required evidence exists. Whether the result is the client's site
is a judgement, and it is made by a named human in \`final-creative-gate.md\`.

An agent may not sign that file. \`creative:validate\` refuses a non-human
decider on it, for the same reason it refuses one on the Creative Gate.
`;
}

/** A repository-relative path when the target is inside it, absolute otherwise. */
function displayPath(target: string): string {
  const relativePath = relative(repositoryRoot, target);
  return relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)
    ? target
    : relativePath;
}
