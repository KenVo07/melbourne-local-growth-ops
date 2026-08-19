/**
 * `pnpm creative:launch` — the second of the three premium commands.
 *
 * It is the boundary between exploration and production source. Everything
 * before it is reversible: a workspace can be deleted, a territory abandoned, a
 * provider export thrown away. Everything after it modifies the client's live
 * `experience/` tree. So this command's job is to refuse, and to freeze exactly
 * what a fresh production agent needs when it does not.
 *
 * What it freezes:
 *   - `inputs/`   the human's own creative artifacts, byte-for-byte;
 *   - `production-launch.json` the identities, the target, and the boundary;
 *   - `PRODUCTION_AGENT_PROMPT.md` the brief, generated from those identities;
 *   - `evidence-index.json` what evidence exists now and what production owes;
 *   - `integrity.sha256` so the agent can prove the pack it read is the pack
 *     that was published.
 *
 * What it does not do: invoke an agent, upload anything, contact a provider,
 * touch the client input, or write one byte of production source. The launch
 * pack is read-only and disposable; the repository is the only thing that
 * changes afterwards, and only by a human or an agent a human started.
 */
import { readdir, readFile } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative } from "node:path";

import { ARTIFACTS, NON_HUMAN_DECIDERS } from "./artifact-model.mjs";
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
  sha256,
  validateRecord,
} from "./premium-contracts.mjs";
import { heading, runCommandMain, step, type CommandSpec } from "./premium-cli";
import { deriveLaunchId } from "./source-binding-core.mjs";
import {
  bindClientToArtifact,
  inspectCurrentClientInput,
  loadArtifact,
  repositoryRoot,
  runCommand,
  type CurrentClientInput,
  type ExactBinding,
} from "./source-binding";
import {
  isUnfilled,
  loadEnvelope,
  parseFrontMatter,
  sectionBody,
  validateArtifacts,
} from "./validate-core.mjs";

const SPEC: CommandSpec = {
  command: "creative:launch",
  summary:
    "Freeze an approved creative delivery and the current source identity into a launch pack a fresh production agent can execute.",
  flags: [
    {
      name: "--workspace",
      required: true,
      value: "<prepared-workspace>",
      description: "The workspace creative:prepare published, with delivery/*.md filled and gated.",
    },
    {
      name: "--input",
      required: true,
      value: "<client-build-package>",
      description: "The same client input the workspace was prepared from. Re-checked, not trusted.",
    },
    {
      name: "--artifact",
      required: true,
      value: "<assembled-artifact-root>",
      description: "The same assembled artifact. Its own handoff verifier is run again.",
    },
    {
      name: "--output",
      required: true,
      value: "<empty-directory>",
      description: "Where to publish the launch pack. Must be absent or empty; never overwritten.",
    },
    {
      name: "--vendor-evidence",
      required: false,
      value: "<provider-evidence.json>",
      description: "Optional provider evidence manifest. Required for design Mode A.",
    },
  ],
  notes: [
    "Requires a clean Git worktree: the launch baseline must be a revision production can return to.",
    "Uploads nothing, contacts no provider and starts no agent. It publishes a pack a human hands on.",
  ],
};

/**
 * The change boundary a production agent inherits.
 *
 * Written here rather than assembled from the handoff, because the boundary is
 * a property of the architecture and not of one creative direction. A handoff
 * that wanted a wider boundary would be asking for a different decision than
 * the one this command is allowed to make.
 */
const PROHIBITED_CHANGES = Object.freeze([
  "P1 Factory packages and the managed-web runtime.",
  "Root dependency, lockfile, tooling or CI configuration.",
  "Any other client's input package, experience source or media.",
  "client-website.json — the business truth. It is an input, never an output.",
  "Routes, connectors, recipient addresses, secrets, entitlements or deployment configuration.",
  "Shared or global design system resources. Signature work stays client-local.",
  "Provider runtime, SDK or embed code of any kind.",
  "New remote fonts, remote CSS, network requests, storage, eval or server/API code.",
  "Promotion of a client-local mechanic into Core.",
]);

const STOP_CONDITIONS = Object.freeze([
  "The live experience source no longer matches the launch baseline before your first edit.",
  "The handoff needs a business fact client-website.json does not carry.",
  "The direction needs an asset the media plan does not approve, or one whose provenance cannot substantiate the claim it is making.",
  "The direction needs a dependency or runtime posture this launch did not approve.",
  "A provider export carries hidden network, storage or server behaviour.",
  "A mechanic appears to require a change to P1, Core or another client.",
  "The source policy cannot express the concept safely.",
  "The branch or baseline revision is not the one this pack names.",
  "You find a genuine P1 defect.",
]);

/* Stopping means recording the exact contradiction and the smallest next
 * decision. It never means widening the boundary to make the work fit. */
const STOP_PROTOCOL =
  "Stop, record the exact contradiction and the smallest next decision, and hand it back. Do not work around the boundary.";

await runCommandMain(SPEC, async (flags) => {
  heading("Re-checking the workspace against live source");
  const workspace = await loadWorkspace(flags.workspace);
  step(`workspace ${workspace.manifest.workspaceId.slice(0, 12)}… integrity intact (${workspace.immutableCount} immutable file(s))`);

  const current = await inspectCurrentClientInput(flags.input);
  const artifact = await loadArtifact(flags.artifact);
  const binding = await bindClientToArtifact({
    current,
    artifact,
    expectedWorkspace: {
      artifactId: workspace.manifest.sourceBinding.artifactId,
      sourceSetId: workspace.manifest.sourceBinding.sourceSetId,
      definitionSha256: workspace.manifest.sourceBinding.definitionSha256,
      generatedSnapshotSha256: workspace.manifest.sourceBinding.generatedSnapshotSha256,
    },
  });
  step(`artifact handoff verifier re-run and passed (${binding.verifier.durationMs} ms)`);
  step(`live source set ${binding.sourceSetId.slice(0, 12)}… still matches the prepared baseline`);
  await assertWorkspaceBaselineMatchesLive(workspace, current);
  step("frozen workspace baseline still matches the live experience byte for byte");

  heading("Reading the human decision");
  const delivery = await loadDelivery(workspace.root);
  await assertDeliveryValidates(delivery);
  const selection = selectDecision(delivery, workspace);
  step(`gate ${selection.gate.name}: ${selection.decision} by ${selection.decidedBy}`);
  step(`territory "${selection.selectedTerritory}" via ${selection.slice.name}`);
  step(`handoff ${selection.handoff.name} bound to this workspace's artifact and source set`);

  const provider = await loadProviderEvidence(
    flags["vendor-evidence"],
    workspace,
    binding,
    selection,
  );
  step(provider.summary);

  heading("Recording the repository baseline");
  const repository = await requireCleanWorktree(current);
  step(`${displayPath(repository.root)} on ${repository.branch} at ${repository.sourceRevision.slice(0, 12)}…, worktree clean`);

  const launchId = deriveLaunchId({
    workspaceId: workspace.manifest.workspaceId,
    sourceSetId: binding.sourceSetId,
    handoffSha256: selection.handoffSha256,
    gateSha256: selection.gateSha256,
    baselineRevision: repository.sourceRevision,
  });

  heading("Publishing the launch pack");
  const { target } = await publishAtomically(flags.output, async (staging) => {
    for (const document of delivery.documents) {
      await writeInto(staging, `inputs/${document.name}`, document.text);
    }
    if (provider.record !== undefined) {
      await writeJsonInto(staging, "inputs/provider-evidence-manifest.json", provider.record);
    }
    await writeJsonInto(
      staging,
      "evidence-index.json",
      buildEvidenceIndex(workspace, provider, launchId),
    );
    await writeInto(
      staging,
      "PRODUCTION_AGENT_PROMPT.md",
      productionAgentPrompt({
        launchId,
        workspace,
        current,
        binding,
        repository,
        selection,
        provider,
        delivery,
      }),
    );
    await writeInto(
      staging,
      "README.md",
      launchReadme({ launchId, workspace, selection, delivery, provider, repository }),
    );

    const files = await inventoryDirectory(staging, [
      "production-launch.json",
      "integrity.sha256",
    ]);
    const manifest = buildLaunchManifest({
      launchId,
      workspace,
      current,
      binding,
      repository,
      selection,
      provider,
      delivery,
      files,
    });
    assertContract("production-launch", manifest);
    const manifestBytes = await writeJsonInto(staging, "production-launch.json", manifest);
    await writeChecksumSidecar(staging, "integrity.sha256", [
      { path: "production-launch.json", sha256: sha256(manifestBytes) },
      ...files,
    ]);

    /* Nothing in a launch pack is editable. A launch pack an operator can
     * correct in place is a launch pack whose hashes prove nothing. */
    const failures = await makeReadOnly(staging, []);
    if (failures.length > 0) {
      step(`read-only permissions unavailable on ${failures.length} file(s); hashes remain authoritative`);
    }
    return manifest;
  });

  heading(`Production launch pack published: ${target}`);
  process.stdout.write(
    [
      `  launch      ${launchId}`,
      `  workspace   ${workspace.manifest.workspaceId}`,
      `  artifact    ${binding.artifactId}`,
      `  source set  ${binding.sourceSetId}`,
      `  baseline    ${repository.branch} @ ${repository.sourceRevision}`,
      `  target      ${productionTargetRoot(current, repository)}`,
      "",
      "Next:",
      `  1. hand a production agent ${join(displayPath(target), "PRODUCTION_AGENT_PROMPT.md")};`,
      "  2. the agent implements the approved delta in the live experience/ tree and commits;",
      "  3. run: pnpm creative:verify --launch <this pack> --input <same input> --candidate <revision> --output <new dir>",
      "",
      "No agent was started, no provider was contacted and no production source was changed.",
      "",
    ].join("\n"),
  );
});

/* --------------------------------------------------------------- workspace */

interface LoadedWorkspace {
  readonly root: string;
  readonly manifest: WorkspaceManifest;
  readonly immutableCount: number;
}

/* The subset of the workspace manifest this command reads. The contract
 * validator is the authority on its shape; this is a reading convenience. */
interface WorkspaceManifest {
  readonly workspaceId: string;
  readonly client: { readonly clientId: string; readonly experienceId: string };
  readonly sourceBinding: {
    readonly artifactId: string;
    readonly sourceSetId: string;
    readonly definitionSha256: string;
    readonly generatedSnapshotSha256: string;
    readonly files: readonly { readonly path: string; readonly sha256: string }[];
  };
  readonly designMode: { readonly recommended: string; readonly rationale: string };
  readonly evidence: Record<string, unknown>;
  readonly integrity: {
    readonly allowlist: readonly string[];
    readonly files: readonly { readonly path: string; readonly sha256: string; readonly size: number }[];
  };
}

/**
 * Loads the workspace and proves it is the one that was published.
 *
 * Two checks, in the order that makes a failure legible. The manifest must
 * satisfy its own contract, or nothing read from it means anything. Then every
 * file on the immutable allowlist must still hash to what the manifest
 * recorded — the source baseline, the public context, the media, the provider
 * inventory. `delivery/` is deliberately excluded: it is the one tree a human
 * is meant to have changed, and changing it is the entire point of the step
 * between prepare and launch.
 */
async function loadWorkspace(path: string): Promise<LoadedWorkspace> {
  const root = await resolveExistingDirectory(path, "prepared workspace");
  const manifestPath = await resolveExistingFile(
    join(root, "premium-workspace.json"),
    "premium-workspace.json",
  );
  const manifest = (await readJsonFile(manifestPath, "premium-workspace.json")) as WorkspaceManifest;
  assertContract("premium-workspace", manifest);

  const sidecar = await readFile(join(root, "integrity.sha256"), "utf8").catch(() => "");
  const recordedManifestHash = sidecar
    .split("\n")
    .find((line) => line.endsWith("  premium-workspace.json"))
    ?.slice(0, 64);
  if (recordedManifestHash !== (await hashFile(manifestPath))) {
    throw refuse(
      "WORKSPACE_TAMPERED",
      "premium-workspace.json does not match the hash integrity.sha256 recorded for it. The manifest was edited after publication; prepare a new workspace.",
      { workspace: root },
    );
  }

  const immutable = manifest.integrity.files.filter((file) =>
    manifest.integrity.allowlist.includes(file.path),
  );
  const result = await verifyInventory(root, immutable);
  if (!result.intact) {
    throw refuse(
      "WORKSPACE_TAMPERED",
      [
        "The workspace's immutable files no longer match the manifest.",
        ...result.missing.map((file) => `  missing  ${file}`),
        ...result.changed.map((file) => `  changed  ${file}`),
        "",
        "Only delivery/*.md is editable. Prepare a new workspace from the current source rather than launching from an edited baseline.",
      ].join("\n"),
      { missing: result.missing, changed: result.changed },
    );
  }
  return { root, manifest, immutableCount: immutable.length };
}

/**
 * The frozen baseline against the live tree, path by path.
 *
 * The binding already proved live source equals the artifact, and prepare
 * proved the artifact equals the baseline it copied. This closes the triangle
 * directly, so a report can state the baseline the agent will read is the
 * source the agent will edit rather than inferring it through two hops.
 */
async function assertWorkspaceBaselineMatchesLive(
  workspace: LoadedWorkspace,
  current: CurrentClientInput,
): Promise<void> {
  const live = new Map<string, string>(current.source.map((file) => [file.path, file.sha256]));
  const drifted: string[] = [];
  for (const file of workspace.manifest.sourceBinding.files) {
    if (live.get(file.path) !== file.sha256) drifted.push(file.path);
  }
  for (const path of live.keys()) {
    if (!workspace.manifest.sourceBinding.files.some((file) => file.path === path)) {
      drifted.push(path);
    }
  }
  if (drifted.length > 0) {
    throw refuse(
      "WORKSPACE_STALE",
      `The live experience no longer matches the workspace baseline: ${[...new Set(drifted)].sort(compareText).join(", ")}. Prepare a new workspace from the current source.`,
      { paths: [...new Set(drifted)].sort(compareText) },
    );
  }
}

/* ---------------------------------------------------------------- delivery */

interface DeliveryDocument {
  readonly name: string;
  readonly kind: string;
  readonly frontMatter: Record<string, unknown>;
  readonly body: string;
  readonly text: string;
  readonly sha256: string;
}

interface LoadedDelivery {
  readonly root: string;
  readonly documents: readonly DeliveryDocument[];
}

/** Reads `delivery/` exactly as `creative:validate` reads a delivery directory. */
async function loadDelivery(workspaceRoot: string): Promise<LoadedDelivery> {
  const root = join(workspaceRoot, "delivery");
  const entries = await readdir(root, { withFileTypes: true }).catch(() => {
    throw refuse(
      "INPUT_NOT_FOUND",
      `${root} does not exist. A launch needs the nine creative artifacts the workspace scaffolded.`,
      { root },
    );
  });
  const documents: DeliveryDocument[] = [];
  const skipped: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || extname(entry.name) !== ".md") continue;
    const text = await readFile(join(root, entry.name), "utf8");
    const { frontMatter, body } = parseFrontMatter(text);
    if (frontMatter === null || frontMatter.kind === undefined) {
      skipped.push(entry.name);
      continue;
    }
    if (ARTIFACTS[frontMatter.kind as string] === undefined) {
      skipped.push(`${entry.name} (unknown kind "${String(frontMatter.kind)}")`);
      continue;
    }
    documents.push({
      name: entry.name,
      kind: String(frontMatter.kind),
      frontMatter: frontMatter as Record<string, unknown>,
      body,
      text,
      sha256: sha256(text),
    });
  }
  if (skipped.length > 0) {
    throw refuse(
      "DELIVERY_INCOMPLETE",
      `${skipped.join(", ")} in ${root} ${skipped.length === 1 ? "is" : "are"} not a recognised creative artifact. A launch pack carries the delivery whole; remove the file or give it a valid "kind".`,
      { skipped },
    );
  }
  documents.sort((left, right) => compareText(left.name, right.name));
  return { root, documents };
}

/**
 * Runs the delivery through `creative:validate`'s own rules, and reports the
 * result as a refusal.
 *
 * The premium bridge does not restate those rules. It reads the codes the
 * shared validator now attaches, so that "the gate was signed by an agent"
 * refuses as HUMAN_GATE_REQUIRED here and prints as a sentence there, from one
 * implementation. A problem the validator did not name a code for is still
 * blocking; it just refuses under the general code, because a delivery that
 * cannot pass validation has no approved direction in it to launch.
 */
async function assertDeliveryValidates(delivery: LoadedDelivery): Promise<void> {
  const envelope = loadEnvelope(
    await readFile(
      join(repositoryRoot, "docs/creative/signature-capability-envelope.json"),
      "utf8",
    ),
  );
  const problems = validateArtifacts(delivery.documents, envelope) as {
    file: string;
    message: string;
    code?: string;
  }[];
  if (problems.length === 0) return;
  const named = problems.find((problem) => problem.code !== undefined);
  throw refuse(
    named?.code ?? "DELIVERY_INCOMPLETE",
    [
      `The creative delivery has ${problems.length} problem${problems.length === 1 ? "" : "s"}:`,
      ...problems.map((problem) => `  ${problem.file} ${problem.message}`),
      "",
      `Fix them in ${displayPath(delivery.root)} and re-run "pnpm creative:validate" there before launching.`,
    ].join("\n"),
    { problems: problems.map(({ file, message, code }) => ({ file, message, code })) },
  );
}

interface Decision {
  readonly handoff: DeliveryDocument;
  readonly gate: DeliveryDocument;
  readonly slice: DeliveryDocument;
  readonly decision: string;
  readonly decidedBy: string;
  readonly selectedTerritory: string;
  readonly handoffSha256: string;
  readonly gateSha256: string;
  readonly namedFixes: readonly string[];
}

/**
 * Finds the one approved direction in the delivery, and proves it is this
 * client's, this workspace's and a human's.
 *
 * `creative:validate` already proved the delivery is internally consistent.
 * What it cannot know is which source the delivery was written against, so the
 * checks that only make sense at a boundary live here: the handoff's recorded
 * artifact and source set must be the ones about to be modified, and every
 * artifact must name this client and no other.
 */
function selectDecision(delivery: LoadedDelivery, workspace: LoadedWorkspace): Decision {
  const handoffs = delivery.documents.filter(({ kind }) => kind === "production-handoff");
  if (handoffs.length !== 1) {
    throw refuse(
      "DELIVERY_INCOMPLETE",
      `The delivery holds ${handoffs.length} production handoffs. A launch carries exactly one approved direction into production.`,
      { count: handoffs.length },
    );
  }
  const handoff = handoffs[0];

  const clientId = workspace.manifest.client.clientId;
  const foreign = delivery.documents.filter(
    (document) =>
      typeof document.frontMatter.client === "string" &&
      document.frontMatter.client !== clientId,
  );
  if (foreign.length > 0) {
    throw refuse(
      "CROSS_CLIENT_LEAKAGE",
      `${foreign.map((document) => `${document.name} names client "${String(document.frontMatter.client)}"`).join("; ")}, but this workspace is ${clientId}. A delivery belongs to one client.`,
      { clientId, foreign: foreign.map((document) => document.name) },
    );
  }

  const gate = findLinked(delivery, handoff, "gate", "creative-gate");
  const slice = findLinked(delivery, handoff, "slice", "signature-slice");

  const decision = String(gate.frontMatter.decision ?? "").trim();
  const decidedBy = String(gate.frontMatter.decided_by ?? "").trim();
  if (decision === "FAIL") {
    throw refuse(
      "GATE_FAILED",
      `${gate.name} records FAIL. A failed direction does not go to production; explore again rather than launching it.`,
      { gate: gate.name },
    );
  }
  if (decision !== "PASS" && decision !== "PASS_WITH_NAMED_FIXES") {
    throw refuse(
      "HUMAN_GATE_REQUIRED",
      `${gate.name} records decision "${decision === "" ? "(blank)" : decision}". A launch needs a named human's PASS or PASS_WITH_NAMED_FIXES.`,
      { gate: gate.name, decision },
    );
  }
  if (decidedBy === "" || isUnfilled(decidedBy)) {
    throw refuse(
      "HUMAN_GATE_REQUIRED",
      `${gate.name} records no decider. A gate is a named human's act; write who made it in "decided_by".`,
      { gate: gate.name },
    );
  }

  const expected: Record<string, string> = {
    source_artifact_id: workspace.manifest.sourceBinding.artifactId,
    source_set_id: workspace.manifest.sourceBinding.sourceSetId,
  };
  for (const [key, value] of Object.entries(expected)) {
    const recorded = String(handoff.frontMatter[key] ?? "").trim();
    if (recorded !== value) {
      throw refuse(
        "ARTIFACT_MISMATCH",
        `${handoff.name} records ${key} "${recorded === "" ? "(blank)" : recorded}", but this workspace's is ${value}. The handoff was written against different source; copy the ids from premium-workspace.json's sourceBinding.`,
        { key, recorded, expected: value },
      );
    }
  }

  /*
   * The post-production sections must exist before launch and be filled after
   * it. Requiring the Translation delta to be filled now would only teach
   * operators to write "pending" in it; requiring the heading now means the
   * agent has somewhere to write the answer, and `creative:verify` is the thing
   * that reads it.
   */
  for (const section of ARTIFACTS["production-handoff"].postProductionSections ?? []) {
    if (sectionBody(handoff.body, section) === null) {
      throw refuse(
        "TRANSLATION_DELTA_MISSING",
        `${handoff.name} has no "## ${section}" section. Production writes it after implementing; the heading has to be there to write into.`,
        { section },
      );
    }
  }

  const namedFixes = ((handoff.frontMatter.named_fixes ?? []) as unknown[])
    .filter((fix) => !isUnfilled(fix))
    .map((fix) => String(fix));

  return {
    handoff,
    gate,
    slice,
    decision,
    decidedBy,
    selectedTerritory: String(handoff.frontMatter.selected_territory ?? "").trim(),
    handoffSha256: handoff.sha256,
    gateSha256: gate.sha256,
    namedFixes,
  };
}

function findLinked(
  delivery: LoadedDelivery,
  from: DeliveryDocument,
  key: string,
  kind: string,
): DeliveryDocument {
  const target = String(from.frontMatter[key] ?? "").trim();
  const found = delivery.documents.find(
    (document) => document.name === target || document.name === `${target}.md`,
  );
  if (found === undefined || found.kind !== kind) {
    throw refuse(
      "DELIVERY_INCOMPLETE",
      `${from.name} names "${target}" as its ${kind}, which this delivery does not hold.`,
      { key, target },
    );
  }
  return found;
}

/* ---------------------------------------------------------------- provider */

interface ProviderState {
  readonly record?: Record<string, unknown>;
  readonly path?: string;
  readonly summary: string;
}

/**
 * Provider evidence, when there is any, bound to this exact workspace.
 *
 * A creative provider is optional in this architecture and non-authoritative in
 * all of it: an export is evidence of a conversation, never a decision. What is
 * checked is therefore not quality but attachment — that the export names this
 * workspace, this artifact, this source set and this slice, and that a named
 * human said what was allowed to leave the local boundary before it left.
 *
 * Mode A is the one case where absence is itself a refusal. Mode A means the
 * work was done inside a design system that belongs to this client, and an
 * unattested design system is an unknown one, which is the case the attestation
 * vocabulary already blocks by name.
 */
async function loadProviderEvidence(
  path: string | undefined,
  workspace: LoadedWorkspace,
  binding: ExactBinding,
  selection: Decision,
): Promise<ProviderState> {
  const mode = workspace.manifest.designMode.recommended;
  if (path === undefined) {
    if (mode === "A") {
      throw refuse(
        "FOREIGN_DESIGN_SYSTEM",
        "This workspace was prepared in design Mode A, which claims a design system owned by this client, and no provider evidence attests one. Supply --vendor-evidence with a CLIENT_SCOPED attestation, or prepare in Mode B and work from the exact source baseline.",
        { designMode: mode },
      );
    }
    return { summary: `no provider evidence supplied; design Mode ${mode} does not require one` };
  }

  const file = await resolveExistingFile(path, "provider evidence manifest");
  const record = (await readJsonFile(file, "provider evidence manifest")) as Record<
    string,
    unknown
  >;
  const problems = validateRecord("provider-evidence", record);
  if (problems.length > 0) {
    throw refuse(
      "CONTRACT_INVALID",
      [`${basename(file)} is not a complete provider evidence manifest:`, ...problems.map((problem) => `  ${problem}`)].join("\n"),
      { problems },
    );
  }

  const bindingRecord = record.binding as Record<string, string>;
  const expected: Record<string, string> = {
    workspaceId: workspace.manifest.workspaceId,
    artifactId: binding.artifactId,
    sourceSetId: binding.sourceSetId,
  };
  for (const [key, value] of Object.entries(expected)) {
    if (bindingRecord[key] !== value) {
      throw refuse(
        "VENDOR_EVIDENCE_UNBOUND",
        `The provider evidence names ${key} ${bindingRecord[key]}; this launch is ${value}. Evidence from a different substrate cannot support this decision.`,
        { key, recorded: bindingRecord[key], expected: value },
      );
    }
  }
  for (const [key, document] of [
    ["slice", selection.slice],
    ["gate", selection.gate],
  ] as const) {
    const named = String(bindingRecord[key] ?? "").trim();
    if (named !== document.name && named !== document.name.replace(/\.md$/, "")) {
      throw refuse(
        "VENDOR_EVIDENCE_UNBOUND",
        `The provider evidence names ${key} "${named}"; this launch carries ${document.name}. Bind the export to the work it was produced for.`,
        { key, recorded: named, expected: document.name },
      );
    }
  }

  const attestation = record.designSystemAttestation as Record<string, string>;
  if (attestation.status === "FOREIGN_OR_UNKNOWN_BLOCKED") {
    throw refuse(
      "FOREIGN_DESIGN_SYSTEM",
      `${attestation.attestedBy} attested that the provider context inherits a design system that is not this client's. That aesthetic does not enter production; redo the exploration in a client-scoped or empty context.`,
      { status: attestation.status },
    );
  }
  if (mode === "A" && attestation.status !== "CLIENT_SCOPED") {
    throw refuse(
      "FOREIGN_DESIGN_SYSTEM",
      `Design Mode A requires a CLIENT_SCOPED design system attestation; this evidence attests "${attestation.status}".`,
      { designMode: mode, status: attestation.status },
    );
  }

  const approval = record.dataHandlingApproval as Record<string, unknown>;
  const approvedBy = String(approval.approvedBy ?? "").trim();
  if (approvedBy === "" || isUnfilled(approvedBy) || isNonHuman(approvedBy)) {
    throw refuse(
      "DATA_HANDLING_UNAPPROVED",
      `dataHandlingApproval.approvedBy is "${approvedBy === "" ? "(blank)" : approvedBy}". A named human decides what leaves the local boundary; an agent cannot approve its own upload.`,
      { approvedBy },
    );
  }

  const items = (record.items ?? []) as { label: string }[];
  return {
    record,
    path: file,
    summary: `provider evidence from ${String(record.provider)} bound to this workspace: ${items.length} item(s), design system ${attestation.status}, data handling approved by ${approvedBy}`,
  };
}

/* The same list that decides who may sign a Creative Gate. An identity that
 * cannot pass its own creative work cannot approve its own upload either. */
function isNonHuman(name: string): boolean {
  const lowered = name.trim().toLowerCase();
  return (NON_HUMAN_DECIDERS as readonly string[]).some(
    (identity) => lowered === identity || lowered.includes(identity),
  );
}

/* -------------------------------------------------------------- repository */

interface RepositoryBaseline {
  readonly root: string;
  readonly branch: string;
  readonly sourceRevision: string;
  readonly worktreeClean: true;
}

/**
 * The baseline a candidate is later diffed against.
 *
 * Deliberately the repository that *contains the client input*, not the one
 * this tooling happens to live in. The production target is that input's
 * `experience/` tree, so that repository is the one whose diff `creative:verify`
 * computes and the one whose history production has to return to. In this
 * repository they are the same directory; keeping them the same by accident is
 * how a launch ends up recording a baseline nothing was built against.
 *
 * A dirty worktree is refused rather than recorded, because the value of a
 * baseline is that the candidate diff is exactly what production changed.
 * Uncommitted work at launch time is indistinguishable, later, from the
 * agent's own.
 */
async function requireCleanWorktree(
  current: CurrentClientInput,
): Promise<RepositoryBaseline> {
  const toplevel = await runCommand(
    "git",
    ["rev-parse", "--show-toplevel"],
    current.inputDirectory,
  );
  if (toplevel.exitCode !== 0 || toplevel.output.trim() === "") {
    throw refuse(
      "WORKTREE_DIRTY",
      `${displayPath(current.inputDirectory)} is not inside a Git repository. Production edits this client's experience tree in place, so the launch needs a baseline revision it can be diffed against.`,
      { input: current.inputDirectory },
    );
  }
  const root = toplevel.output.trim();

  const status = await runCommand("git", ["status", "--porcelain"], root);
  if (status.exitCode !== 0) {
    throw refuse(
      "WORKTREE_DIRTY",
      `git status failed in ${root} (exit ${status.exitCode}): ${status.output.trim()}`,
      { exitCode: status.exitCode },
    );
  }
  const dirty = status.output.split("\n").filter((line) => line.trim() !== "");
  if (dirty.length > 0) {
    throw refuse(
      "WORKTREE_DIRTY",
      [
        `The worktree at ${displayPath(root)} has ${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"}:`,
        ...dirty.slice(0, 20).map((line) => `  ${line}`),
        ...(dirty.length > 20 ? [`  … and ${dirty.length - 20} more`] : []),
        "",
        "Commit or stash them first. The launch baseline has to be a revision the candidate can be diffed against.",
      ].join("\n"),
      { changes: dirty.length },
    );
  }

  const branch = await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
  const revision = await runCommand("git", ["rev-parse", "HEAD"], root);
  if (branch.exitCode !== 0 || revision.exitCode !== 0 || revision.output.trim().length < 7) {
    throw refuse(
      "WORKTREE_DIRTY",
      `${displayPath(root)} has no readable branch or HEAD revision to use as a launch baseline. Make at least one commit before launching.`,
      {},
    );
  }
  return {
    root,
    branch: branch.output.trim(),
    sourceRevision: revision.output.trim(),
    worktreeClean: true,
  };
}

/* ---------------------------------------------------------------- manifest */

/**
 * A portable label for the client input.
 *
 * Repository-relative when the input lives inside the repository, which is the
 * ordinary case and the most useful thing a fresh agent can be told. Otherwise
 * the directory name alone: a launch manifest records a location, never the
 * machine it was produced on, and an absolute path is refused by the contract
 * rather than trimmed here.
 */
function portableInputLabel(
  current: CurrentClientInput,
  repository: RepositoryBaseline,
): string {
  return locateInput(current, repository).label;
}

function locateInput(
  current: CurrentClientInput,
  repository: RepositoryBaseline,
): { readonly label: string; readonly insideRepository: boolean } {
  const relativePath = relative(repository.root, current.inputDirectory);
  if (relativePath !== "" && !relativePath.startsWith("..") && !isAbsolute(relativePath)) {
    return { label: relativePath.split(/[\\/]/).join("/"), insideRepository: true };
  }
  return { label: basename(current.inputDirectory), insideRepository: false };
}

function productionTargetRoot(
  current: CurrentClientInput,
  repository: RepositoryBaseline,
): string {
  return `${portableInputLabel(current, repository)}/experience`;
}

function buildLaunchManifest(input: {
  launchId: string;
  workspace: LoadedWorkspace;
  current: CurrentClientInput;
  binding: ExactBinding;
  repository: RepositoryBaseline;
  selection: Decision;
  provider: ProviderState;
  delivery: LoadedDelivery;
  files: readonly { path: string; sha256: string; size: number }[];
}) {
  const { workspace, current, binding, selection } = input;
  const location = locateInput(current, input.repository);
  const inputLabel = location.label;
  return {
    schemaVersion: 1 as const,
    kind: "PREMIUM_PRODUCTION_LAUNCH" as const,
    launchId: input.launchId,
    workspaceId: workspace.manifest.workspaceId,
    createdBy: { command: "creative:launch" as const },
    sourceBinding: {
      artifactId: binding.artifactId,
      sourceSetId: binding.sourceSetId,
      definitionSha256: binding.definitionSha256,
      generatedSnapshotSha256: binding.generatedSnapshotSha256,
      factoryRevision: binding.factoryRevision,
    },
    repositoryBaseline: {
      branch: input.repository.branch,
      sourceRevision: input.repository.sourceRevision,
      worktreeClean: true as const,
    },
    client: {
      clientId: current.clientId,
      configurationId: current.configurationId,
      configurationVersion: current.configurationVersion,
      deploymentId: current.deploymentId,
      experienceId: current.experienceId,
      experienceVersion: current.experienceVersion,
    },
    productionTarget: {
      inputLabel,
      inputInsideRepository: location.insideRepository,
      experienceRoot: `${inputLabel}/experience`,
      entrypoint: current.entrypoint,
      designDnaPath: current.designDnaPath,
      runtime: current.runtime,
    },
    handoff: {
      path: `inputs/${selection.handoff.name}`,
      sha256: selection.handoffSha256,
      sliceGateDecision: selection.decision,
      selectedTerritory: selection.selectedTerritory,
      gateDecidedBy: selection.decidedBy,
      gatePath: `inputs/${selection.gate.name}`,
      gateSha256: selection.gateSha256,
      slicePath: `inputs/${selection.slice.name}`,
      namedFixes: [...selection.namedFixes],
      postProductionSections: [
        ...(ARTIFACTS["production-handoff"].postProductionSections ?? []),
      ],
    },
    readOrder: readOrder(input.delivery, input.provider),
    allowedChanges: [
      `${inputLabel}/experience/** — the same client's authored experience source, and nothing else under ${inputLabel}.`,
      "Client-local tests colocated with that experience, where the repository convention already places them.",
      'The production handoff\'s "## Translation delta" section, written after implementing.',
      "A promotion-ledger row for any new client-local mechanic, recorded as client-local.",
      "Evidence written into the output directory creative:verify is given.",
    ],
    prohibitedChanges: [...PROHIBITED_CHANGES],
    approvedDependencyChanges: [],
    requiredValidation: [
      "pnpm creative:test",
      "pnpm creative:validate <workspace>/delivery",
      "pnpm check",
      "pnpm --filter @melbourne-local-growth-ops/managed-web test:e2e",
      "Ordinary client artifact assembly, then the new artifact's source/scripts/verify-handoff.mjs.",
    ],
    stopConditions: [...STOP_CONDITIONS],
    provider:
      input.provider.record === undefined
        ? { evidenceSupplied: false as const, authority: "NON_AUTHORITATIVE" as const }
        : {
            evidenceSupplied: true as const,
            authority: "NON_AUTHORITATIVE" as const,
            provider: String(input.provider.record.provider),
            path: "inputs/provider-evidence-manifest.json",
            designSystemAttestation: (input.provider.record.designSystemAttestation as Record<string, string>)
              .status,
          },
    designMode: {
      recommended: workspace.manifest.designMode.recommended,
      rationale: workspace.manifest.designMode.rationale,
    },
    humanCreativeDecision: "REQUIRED_SEPARATELY" as const,
    integrity: {
      allowlist: input.files.map(({ path }) => path).sort(compareText),
      files: input.files.map(({ path, sha256: digest, size }) => ({ path, sha256: digest, size })),
    },
  };
}

/** The order a fresh agent should read the pack in: intent before mechanism. */
function readOrder(delivery: LoadedDelivery, provider: ProviderState): string[] {
  const order = [
    "README.md",
    "production-launch.json",
    "inputs/creative-intent.md",
  ];
  for (const document of delivery.documents) {
    if (document.kind === "creative-territory") order.push(`inputs/${document.name}`);
  }
  for (const kind of ["signature-slice", "creative-gate", "production-handoff", "media-plan", "promotion-ledger"]) {
    for (const document of delivery.documents) {
      if (document.kind === kind) order.push(`inputs/${document.name}`);
    }
  }
  if (provider.record !== undefined) order.push("inputs/provider-evidence-manifest.json");
  order.push("evidence-index.json");
  return [...new Set(order)];
}

/**
 * What evidence exists, and what production still owes.
 *
 * Both halves in one file, because the failure this prevents is a reviewer
 * finding captures in a directory and assuming they cover the required matrix.
 * The required half is stated as a contract, not a suggestion: `creative:verify`
 * reads the same widths and the same reduced-motion requirement.
 */
function buildEvidenceIndex(
  workspace: LoadedWorkspace,
  provider: ProviderState,
  launchId: string,
) {
  return {
    schemaVersion: 1,
    kind: "PREMIUM_LAUNCH_EVIDENCE_INDEX",
    launchId,
    baseline: workspace.manifest.evidence,
    providerEvidence:
      provider.record === undefined
        ? { supplied: false, authority: "NON_AUTHORITATIVE" }
        : {
            supplied: true,
            authority: "NON_AUTHORITATIVE",
            items: (provider.record.items ?? []) as unknown[],
          },
    requiredFromProduction: {
      viewportWidths: [1440, 834, 390, 320],
      states: [
        "opening state of every route",
        "meaningful scrolled and interactive states",
        "navigation open, disclosures and overlays where present",
        "form success and error where present",
        "390px temporal evidence for the Signature",
      ],
      reducedMotion:
        "The same significant states with prefers-reduced-motion: reduce. A designed state, not a disabled one; nothing may become unreachable.",
      accessibility: [
        "automated accessibility results per engine and significant state",
        "keyboard traversal of the conversion path",
        "visible focus on every interactive control",
      ],
      runtime: [
        "no console error or unhandled rejection",
        "no unexpected network request",
        "no horizontal overflow at any required width",
        "unrelated clients do not inherit the Signature's runtime cost",
      ],
    },
  };
}

/* -------------------------------------------------------------- generated docs */

function productionAgentPrompt(input: {
  launchId: string;
  workspace: LoadedWorkspace;
  current: CurrentClientInput;
  binding: ExactBinding;
  repository: RepositoryBaseline;
  selection: Decision;
  provider: ProviderState;
  delivery: LoadedDelivery;
}): string {
  const { current, selection, repository } = input;
  const target = productionTargetRoot(current, repository);
  const fixes =
    selection.namedFixes.length === 0
      ? ["_The gate named no fixes._"]
      : selection.namedFixes.map((fix) => `- ${fix}`);

  return `# Production implementation: ${current.clientId}

You are a fresh production implementer. You have no authority to revisit the
architecture, redesign the business, or decide whether this direction is good.
A named human already decided that. Your job is to build the intent it records
in the client's live experience source.

## The locked target

| | |
|---|---|
| Repository branch | \`${repository.branch}\` |
| Baseline revision | \`${repository.sourceRevision}\` |
| Client | \`${current.clientId}\` — experience \`${current.experienceId}\`@\`${current.experienceVersion}\` |
| Production source root | \`${target}\` |
| Entrypoint | \`${current.entrypoint}\` |
| Launch id | \`${input.launchId}\` |
| Source set | \`${input.binding.sourceSetId}\` |
| Artifact | \`${input.binding.artifactId}\` |

\`${target}\` is the only tree you edit. It is the same live source the artifact
was assembled from, not a copy: there is no second website in this system, and
the workspace's \`source/\` is a read-only baseline you read and diff against.

## Read in this order

${readOrder(input.delivery, input.provider)
  .map((path, index) => `${index + 1}. \`${path}\``)
  .join("\n")}

Then read the current live \`${target}\` and diff it against the workspace
baseline, so you know what exists before you change it.

## Before you edit anything

Verify the pack you are reading is the pack that was published:

\`\`\`sh
sha256sum -c integrity.sha256
\`\`\`

If a hash does not match: ${STOP_PROTOCOL.charAt(0).toLowerCase()}${STOP_PROTOCOL.slice(1)}

## The decision you are implementing

- Territory: **${selection.selectedTerritory}**
- Slice gate: **${selection.decision}**, decided by **${selection.decidedBy}** in \`inputs/${selection.gate.name}\`
- Handoff: \`inputs/${selection.handoff.name}\`

### Named fixes that must be in the result

${fixes.join("\n")}

Each one is an acceptance condition, not a suggestion. The ship gate checks them.

## How to build it

1. Build the **intent**, not the picture. Every Production delta row carries a
   WHY. When the WHY and the prototype disagree, the WHY wins.
2. Reuse the P1 substrate: routing, metadata, the Page Graph, Platform
   primitives, media mechanics, forms, the accessibility substrate and the
   reduced-motion foundations. Rebuilding one of these bespoke is a defect, not
   a Signature.
3. Keep Signature work client-local. It earns promotion by being needed twice,
   never by being impressive once.
4. Treat any provider export — code, screenshot, canvas, video — as evidence of
   a conversation. It is never authoritative. Do not paste its code, and do not
   inherit its shortcuts.
5. Keep mobile recomposition and the designed reduced-motion state first-class
   while you build. They are not a pass at the end; a layout that only stacks
   at 390px is a failure of the idea, not of the breakpoint.
6. Run the source-policy, type and focused test checks repeatedly rather than
   once at the end.
7. Commit coherent changes as you go. Do not merge, rebase, reset shared
   history, push, change PR state, deploy or update any external system.

## What you may change

- \`${target}/**\` — this client's authored experience source.
- Client-local tests colocated with that experience where the repository
  convention already places them.
- The \`## Translation delta\` section of the workspace's own
  \`delivery/production-handoff.md\`, written after you implement: what you
  changed while translating the approved slice into the existing substrate, and
  why the intent still holds. Change nothing else in that file — \`creative:verify\`
  compares every other section to the copy this pack froze.
- A promotion-ledger row for any new client-local mechanic.

## What you may not change

${PROHIBITED_CHANGES.map((line) => `- ${line}`).join("\n")}

There is no approved dependency or runtime-posture change in this launch. If the
direction needs one, that is a stop condition, not a decision you make.

## Stop conditions

${STOP_CONDITIONS.map((line) => `- ${line}`).join("\n")}

${STOP_PROTOCOL}

## When you are done

Run the validation this launch requires:

\`\`\`sh
pnpm creative:test
pnpm creative:validate <workspace>/delivery
pnpm check
pnpm --filter @melbourne-local-growth-ops/managed-web test:e2e
\`\`\`

Then capture evidence at 1440, 834, 390 and 320 pixels for every route, in the
opening and meaningful interactive states, plus the same significant states
under \`prefers-reduced-motion: reduce\`. \`evidence-index.json\` states the full
requirement.

Report back with the candidate revision. \`creative:verify\` reads it, proves the
delta stayed inside this boundary, and produces the objective report a named
human makes the ship decision against. You do not make that decision, and there
is no field anywhere in this system in which you could record one.
`;
}

function launchReadme(input: {
  launchId: string;
  workspace: LoadedWorkspace;
  selection: Decision;
  delivery: LoadedDelivery;
  provider: ProviderState;
  repository: RepositoryBaseline;
}): string {
  return `# Production launch pack

Frozen by \`pnpm creative:launch\`. Every file here is read-only and hashed. If
you need to change something in it, you need a new launch, because the point of
this pack is that the agent's brief and the reviewer's record are the same
bytes.

| | |
|---|---|
| Launch | \`${input.launchId}\` |
| Workspace | \`${input.workspace.manifest.workspaceId}\` |
| Client | \`${input.workspace.manifest.client.clientId}\` |
| Baseline | \`${input.repository.branch}\` @ \`${input.repository.sourceRevision}\` |
| Gate | ${input.selection.decision} by ${input.selection.decidedBy} |
| Territory | ${input.selection.selectedTerritory} |

## What is here

| Path | What it is |
|---|---|
| \`PRODUCTION_AGENT_PROMPT.md\` | The brief. Hand this to the production agent. |
| \`production-launch.json\` | Identities, target, boundary and integrity inventory. |
| \`inputs/\` | The human's creative artifacts, byte-for-byte as they were gated. |
| \`evidence-index.json\` | Evidence that exists now, and evidence production owes. |
| \`integrity.sha256\` | \`sha256sum -c integrity.sha256\` proves the pack is intact. |

## What this pack is not

It is not a website, a copy of the source, or a build. It carries no editable
production source: the only editable production source is the client's live
\`experience/\` tree, which \`production-launch.json\` names.

It is not an approval of quality either. It records that a named human approved
a **direction**. The ship decision is made later, by a named human, against the
objective report \`creative:verify\` produces — and against the work itself.

## Next

1. Hand \`PRODUCTION_AGENT_PROMPT.md\` to a production agent.
2. The agent implements in the live experience tree and commits.
3. Run \`pnpm creative:verify\` with this pack and the candidate revision.
`;
}

/** A repository-relative path when the target is inside it, absolute otherwise. */
function displayPath(target: string): string {
  const relativePath = relative(repositoryRoot, target);
  return relativePath === "" || relativePath.startsWith("..") ? target : relativePath;
}
