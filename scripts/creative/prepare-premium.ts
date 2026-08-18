/**
 * `pnpm creative:prepare` — the first of the three premium commands.
 *
 * It answers one question and then packages the answer: is this client input,
 * this assembled P1 artifact and this generated snapshot the same production
 * substrate? If they are, it publishes a workspace a human and a replaceable
 * creative environment can work from without receiving the repository, and
 * without a second editable copy of the site existing anywhere.
 *
 * What the workspace is:
 *   - `source/`   the exact current experience source, read-only baseline;
 *   - `context/`  a public projection of the client's own validated definition;
 *   - `delivery/` the nine WEB-01D artifacts, empty, for a human to fill;
 *   - `media/`    the approved client assets, unclassified until the media plan;
 *   - `provider/` what may leave the local boundary, and what a human must
 *                 declare before any of it does.
 *
 * What it is not: a build artifact, a second production tree, a business
 * record, or anything a provider is required for. The live
 * `<input>/experience/**` remains the only editable production source.
 *
 * The command performs no network activity of any kind. It does not log in to,
 * upload to, sync with or invoke any provider; that stays a human action taken
 * against a manifest this command generates.
 */
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import {
  inventoryDirectory,
  makeReadOnly,
  publishAtomically,
  readJsonFile,
  resolveExistingFile,
  writeChecksumSidecar,
  writeInto,
  writeJsonInto,
} from "./atomic-output.mjs";
import { packageCreativeContext } from "./package-context.mjs";
import {
  assertContract,
  canonicalJson,
  compareText,
  DESIGN_MODE_SELECTORS,
  refuse,
  REQUIRED_DELIVERY_ARTIFACTS,
  sha256,
} from "./premium-contracts.mjs";
import { heading, runCommandMain, step, type CommandSpec } from "./premium-cli";
import { emitCreativeArtifacts } from "./scaffold.mjs";
import {
  baselineCoverage,
  bindBaselineEvidence,
  deriveWorkspaceId,
} from "./source-binding-core.mjs";
import {
  bindClientToArtifact,
  inspectCurrentClientInput,
  loadArtifact,
  repositoryRoot,
  runCommand,
  type CurrentClientInput,
  type ExactBinding,
} from "./source-binding";

const SPEC: CommandSpec = {
  command: "creative:prepare",
  summary:
    "Prepare a source-bound premium creative workspace from a client input package and its assembled P1 artifact.",
  flags: [
    {
      name: "--input",
      required: true,
      value: "<client-build-package>",
      description: "Client input directory holding client-website.json, experience/ and public/.",
    },
    {
      name: "--artifact",
      required: true,
      value: "<assembled-artifact-root>",
      description: "Directory holding client-artifact.json and source/, as written by assemble:client.",
    },
    {
      name: "--output",
      required: true,
      value: "<empty-directory>",
      description: "Where to publish the workspace. Must be absent or empty; never overwritten.",
    },
    {
      name: "--baseline-manifest",
      required: false,
      value: "<baseline-evidence.json>",
      description: "Optional P1 captures. Usable only when bound to this artifact and source set.",
    },
    {
      name: "--design-mode",
      required: false,
      value: "A|B|C|AUTO",
      description: "Creative environment routing. Defaults to AUTO, which recommends and never configures.",
    },
  ],
  notes: [
    "Performs no network activity. No provider is logged into, uploaded to or invoked.",
    "See docs/creative/premium-workflow.md for the three-command path.",
  ],
};

/** The only tree a human edits inside a workspace; everything else is hashed. */
const EDITABLE_ROOT = "delivery/";

/* Files an upload inventory may never carry, checked by name as a second line
 * after the structural allowlist that actually decides membership. The client
 * artifact descriptor and the generated snapshot are here because both record
 * connector selections, required environment variable names and recipient
 * configuration: they belong in the local workspace for identity, and nowhere
 * near a design provider. */
const NEVER_UPLOADED = new Set([
  "source/client-artifact.json",
  "integrity.sha256",
  "premium-workspace.json",
]);

const SECRET_SHAPED = [
  /(^|\/)\.env/i,
  /(^|\/)\.git(\/|$)/,
  /\.(pem|key|p12|pfx|keystore)$/i,
  /(^|[-_./])(secret|secrets|credential|credentials|token|password|apikey|api-key)([-_./]|$)/i,
  /(^|\/)id_(rsa|ed25519|ecdsa)/i,
  /(^|\/)node_modules(\/|$)/,
];

await runCommandMain(SPEC, async (flags) => {
  const designMode = (flags["design-mode"] ?? "AUTO").toUpperCase();
  if (!DESIGN_MODE_SELECTORS.includes(designMode)) {
    throw refuse(
      "ARGUMENTS_INVALID",
      `--design-mode must be one of ${DESIGN_MODE_SELECTORS.join(", ")}; got "${designMode}".`,
      { designMode },
    );
  }

  heading("Binding the client input to its assembled artifact");
  const current = await inspectCurrentClientInput(flags.input);
  step(`client ${current.clientId} · experience ${current.experienceId}@${current.experienceVersion}`);
  step(`${current.source.length} authored source file(s) inspected by the live source policy`);

  const artifact = await loadArtifact(flags.artifact);
  step(`artifact ${artifact.descriptor.artifactId.slice(0, 12)}… at Factory revision ${artifact.descriptor.factoryRevision}`);

  const binding = await bindClientToArtifact({ current, artifact });
  step(`handoff integrity verified by the artifact's own script (${binding.verifier.durationMs} ms)`);
  step(`source set ${binding.sourceSetId.slice(0, 12)}… matches the artifact exactly`);

  const orchestratorSourceRevision = await currentRepositoryRevision();
  const workspaceId = deriveWorkspaceId({ ...binding, orchestratorSourceRevision });

  const baseline = await loadBaselineEvidence(flags["baseline-manifest"], binding);
  if (baseline.status === "BOUND") {
    step(`baseline evidence bound: ${baseline.manifest.captures.length} capture(s) at ${baseline.coverage.widths.join(", ")}px`);
  } else if (baseline.status === "UNBOUND_REFUSED") {
    step(`baseline evidence refused as unusable: ${baseline.reason}`);
  }

  const mode = decideDesignMode(designMode);

  heading("Publishing the workspace");
  const { target } = await publishAtomically(flags.output, async (staging) => {
    await writeSourceBaseline(staging, current, artifact);
    await writeContext(staging, current);
    await writeDelivery(staging, current);
    const media = await writeMedia(staging, current);
    await writeBaseline(staging, baseline);
    await writeReadme(staging, workspaceId, current, binding, mode);

    /* Two inventory passes. The first hashes the material the upload
     * inventory describes; the second covers the inventory itself, so the
     * manifest's integrity record is complete. Neither covers the manifest or
     * its sidecar, because a file cannot contain its own hash. */
    const beforeProvider = await inventoryDirectory(staging, []);
    await writeProvider(staging, current, workspaceId, mode, beforeProvider, baseline);

    const files = await inventoryDirectory(staging, [
      "premium-workspace.json",
      "integrity.sha256",
    ]);
    const allowlist = files
      .map(({ path }) => path)
      .filter((path) => !path.startsWith(EDITABLE_ROOT))
      .sort(compareText);

    const manifest = buildManifest({
      workspaceId,
      orchestratorSourceRevision,
      current,
      binding,
      media,
      mode,
      baseline,
      allowlist,
      files,
    });
    assertContract("premium-workspace", manifest);
    const manifestBytes = await writeJsonInto(staging, "premium-workspace.json", manifest);

    await writeChecksumSidecar(staging, "integrity.sha256", [
      { path: "premium-workspace.json", sha256: sha256(manifestBytes) },
      ...files,
    ]);

    const failures = await makeReadOnly(staging, [EDITABLE_ROOT]);
    if (failures.length > 0) {
      step(`read-only permissions unavailable on ${failures.length} file(s); hashes remain authoritative`);
    }
    return manifest;
  });

  heading(`Premium workspace published: ${target}`);
  process.stdout.write(
    [
      `  workspace   ${workspaceId}`,
      `  artifact    ${binding.artifactId}`,
      `  source set  ${binding.sourceSetId}`,
      `  design mode ${mode.recommended} — ${mode.rationale}`,
      "",
      "Next, the human work this command cannot do:",
      "  1. explore three materially different territories and prototype one Signature Slice;",
      "  2. fill delivery/*.md, then run: pnpm creative:validate <workspace>/delivery",
      "  3. record a named-human Creative Gate decision;",
      "  4. run: pnpm creative:launch --workspace <workspace> --input <same input> --output <new dir>",
      "",
      "Before uploading anything to a creative provider, complete",
      `  ${join(displayPath(target), "provider/PROVIDER_PREFLIGHT.md")}`,
      "This command uploaded nothing and contacted no provider.",
      "",
    ].join("\n"),
  );
});

/* ------------------------------------------------------------------ writers */

/**
 * The read-only baseline.
 *
 * Experience bytes are copied from the live input and the descriptor from the
 * artifact. Both sides were already proved identical, so this is a choice about
 * provenance: each file comes from the place that owns it.
 *
 * The generated public snapshot is deliberately *not* copied, only hashed into
 * the manifest. It carries the validated configuration, and that includes
 * connector `secretReferenceId` values and lead-form `recipientAddresses` — the
 * exact internal data a premium workspace must not hold, since a workspace is
 * the thing an operator hands to a creative environment. Nothing needs the
 * copy: `creative:launch` regenerates the snapshot from the live input and
 * compares it to `sourceBinding.generatedSnapshotSha256`, which is a stronger
 * check than re-reading a file the workspace itself carries.
 *
 * The artifact descriptor stays. It records connector ids and the *name* of a
 * required environment variable, never a secret, a secret reference or a
 * recipient, and the workspace's identity chain is unreadable without it.
 */
async function writeSourceBaseline(
  staging: string,
  current: CurrentClientInput,
  artifact: Awaited<ReturnType<typeof loadArtifact>>,
): Promise<void> {
  await copyInto(
    join(artifact.root, "client-artifact.json"),
    join(staging, "source", "client-artifact.json"),
  );
  for (const entry of current.source) {
    await copyInto(
      join(current.inputDirectory, "experience", ...entry.path.split("/")),
      join(staging, "source", "experience", ...entry.path.split("/")),
    );
  }
}

/**
 * The public projection, generated by `creative:package`'s own builders rather
 * than by a second renderer here, so a workspace and a standalone package say
 * exactly the same thing about the same client.
 */
async function writeContext(staging: string, current: CurrentClientInput): Promise<void> {
  await packageCreativeContext(current.inputDirectory, join(staging, "context"));
  await copyInto(
    join(repositoryRoot, "docs/creative/signature-capability-envelope.json"),
    join(staging, "context", "signature-capability-envelope.json"),
  );
  await writeInto(staging, "context/PLATFORM_CONTRACT.md", platformContract(current));
}

/** The nine WEB-01D artifacts, from the scaffold that the validator generates. */
async function writeDelivery(staging: string, current: CurrentClientInput): Promise<void> {
  const written = await emitCreativeArtifacts(join(staging, "delivery"), current.clientId);
  const unexpected = written.filter((name) => !REQUIRED_DELIVERY_ARTIFACTS.includes(name));
  const missing = REQUIRED_DELIVERY_ARTIFACTS.filter((name) => !written.includes(name));
  if (unexpected.length > 0 || missing.length > 0) {
    throw refuse(
      "CONTRACT_INVALID",
      `The creative scaffold produced ${written.length} artifact(s); the workspace contract expects exactly the nine WEB-01D artifacts. Unexpected: ${unexpected.join(", ") || "none"}. Missing: ${missing.join(", ") || "none"}.`,
      { written },
    );
  }
}

interface MediaSummary {
  readonly assetCount: number;
  readonly inventory: readonly {
    readonly assetId: string;
    readonly path: string;
    readonly sha256: string;
    readonly size: number;
    readonly mediaType: string;
    readonly width: number | null;
    readonly height: number | null;
    readonly provenance: "UNCLASSIFIED";
  }[];
}

/**
 * Approved client media, copied from the client's own public directory and from
 * nowhere else.
 *
 * Provenance is recorded as UNCLASSIFIED because the client definition does not
 * carry it. Classifying it is the media plan's job and a human's decision, and
 * defaulting it to something reassuring here is precisely how generated imagery
 * ends up substantiating a claim.
 */
async function writeMedia(staging: string, current: CurrentClientInput): Promise<MediaSummary> {
  const inventory = [];
  for (const asset of current.snapshot.assetManifest.assets) {
    const from = join(current.inputDirectory, "public", ...asset.sourcePath.split("/"));
    const relativePath = `media/approved/${asset.sourcePath}`;
    const bytes = await readFile(from);
    await writeInto(staging, relativePath, bytes);
    inventory.push({
      assetId: asset.assetId,
      path: relativePath,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      mediaType: asset.mediaType,
      width: asset.width ?? null,
      height: asset.height ?? null,
      provenance: "UNCLASSIFIED" as const,
    });
  }
  await writeJsonInto(staging, "media/media-inventory.json", {
    schemaVersion: 1,
    kind: "PREMIUM_WORKSPACE_MEDIA_INVENTORY",
    clientId: current.clientId,
    note: "Provenance is UNCLASSIFIED because the client definition does not carry it. Classify every asset in delivery/media-plan.md before any of it substantiates a claim.",
    assets: inventory,
  });
  return { assetCount: inventory.length, inventory };
}

type BaselineState =
  | { readonly status: "MISSING" }
  | { readonly status: "UNBOUND_REFUSED"; readonly reason: string; readonly manifestPath: string }
  | {
      readonly status: "BOUND";
      readonly manifestPath: string;
      readonly manifest: {
        readonly artifactId: string;
        readonly sourceSetId: string;
        readonly captures: readonly { readonly path: string; readonly sha256: string; readonly viewportWidth: number; readonly motion: string }[];
      };
      readonly coverage: { readonly widths: readonly number[]; readonly reducedMotion: boolean };
    };

async function writeBaseline(staging: string, baseline: BaselineState): Promise<void> {
  if (baseline.status !== "BOUND") return;
  await writeJsonInto(staging, "evidence/baseline-evidence.json", baseline.manifest);
  const root = dirname(baseline.manifestPath);
  for (const capture of baseline.manifest.captures) {
    await copyInto(
      join(root, ...capture.path.split("/")),
      join(staging, "evidence", "baseline", ...capture.path.split("/")),
    );
  }
}

/**
 * The upload allowlist, generated from what the workspace actually contains.
 *
 * Positive and structural: a file is uploadable because its path is under a
 * root whose whole purpose is to be shareable, not because a scanner failed to
 * find anything alarming in it. The name-shape check that follows is a second
 * line, and the cross-client check proves the source set listed here is exactly
 * the source set the artifact bound.
 */
async function writeProvider(
  staging: string,
  current: CurrentClientInput,
  workspaceId: string,
  mode: DesignModeDecision,
  files: readonly { readonly path: string; readonly sha256: string; readonly size: number }[],
  baseline: BaselineState,
): Promise<void> {
  const classified = files
    .map((file) => ({ ...file, classification: classifyForUpload(file.path, baseline) }))
    .filter((file) => file.classification !== undefined)
    .map(({ path, sha256: digest, size, classification }) => ({
      path,
      sha256: digest,
      size,
      classification: classification as string,
    }))
    .sort((left, right) => compareText(left.path, right.path));

  for (const file of classified) {
    if (NEVER_UPLOADED.has(file.path)) {
      throw refuse(
        "UPLOAD_SECRET_OR_PRIVATE_DATA",
        `${file.path} records connector, deployment or integrity metadata and may never be uploaded.`,
        { path: file.path },
      );
    }
    if (SECRET_SHAPED.some((pattern) => pattern.test(file.path))) {
      throw refuse(
        "UPLOAD_SECRET_OR_PRIVATE_DATA",
        `${file.path} is shaped like a credential or private store and may never be uploaded.`,
        { path: file.path },
      );
    }
  }

  const uploadedSource = classified
    .filter((file) => file.classification === "CLIENT_SOURCE")
    .map((file) => file.path.slice("source/experience/".length))
    .sort(compareText);
  const boundSource = current.source.map(({ path }) => path).sort(compareText);
  if (canonicalJson(uploadedSource) !== canonicalJson(boundSource)) {
    throw refuse(
      "CROSS_CLIENT_LEAKAGE",
      `The upload inventory's source set is not this client's bound source set. Inventory: ${uploadedSource.join(", ")}. Bound: ${boundSource.join(", ")}.`,
      { uploadedSource, boundSource },
    );
  }

  const inventory = {
    schemaVersion: 1,
    kind: "CREATIVE_PROVIDER_UPLOAD_INVENTORY",
    workspaceId,
    clientId: current.clientId,
    designMode: mode.recommended,
    uploadPerformed: false,
    note: "This command performed no upload. A named human completes PROVIDER_PREFLIGHT.md and uploads exactly these files, or none.",
    totalBytes: classified.reduce((total, file) => total + file.size, 0),
    files: classified,
  };
  assertContract("provider-upload-inventory", inventory);
  await writeJsonInto(staging, "provider/upload-inventory.json", inventory);
  await writeJsonInto(
    staging,
    "provider/provider-preflight.template.json",
    preflightTemplate(workspaceId, current, mode),
  );
  await writeInto(staging, "provider/PROVIDER_PREFLIGHT.md", preflightGuide(mode, inventory));
  await writeInto(staging, "provider/OPERATOR_PROMPTS.md", operatorPrompts(current, mode));
}

function classifyForUpload(path: string, baseline: BaselineState): string | undefined {
  if (NEVER_UPLOADED.has(path)) return undefined;
  if (path.startsWith("source/experience/")) return "CLIENT_SOURCE";
  if (path.startsWith("context/")) return "PUBLIC_CONTEXT";
  if (path.startsWith("media/approved/")) return "APPROVED_MEDIA";
  if (path === "media/media-inventory.json") return "PUBLIC_CONTEXT";
  if (path.startsWith("evidence/baseline/")) {
    return baseline.status === "BOUND" ? "P1_EVIDENCE" : undefined;
  }
  if (path === "evidence/baseline-evidence.json") {
    return baseline.status === "BOUND" ? "P1_EVIDENCE" : undefined;
  }
  if (path.startsWith("delivery/")) return "INSTRUCTIONS";
  if (path === "README.md") return "INSTRUCTIONS";
  return undefined;
}

/* ------------------------------------------------------------- design mode */

interface DesignModeDecision {
  readonly recommended: "A" | "B" | "C";
  readonly rationale: string;
  readonly providerPreflightRequired: boolean;
}

/**
 * Recommends, never configures.
 *
 * AUTO cannot reach Mode A. Mode A requires a real client-scoped design system
 * with a known owner and a human attestation, and this command has no evidence
 * of one — a provider organisation happening to publish an inherited system is
 * exactly the thing that must not be read as agreement. An operator may select
 * A explicitly; `creative:launch` then requires the attestation that makes it
 * true, and refuses without it.
 */
function decideDesignMode(selector: string): DesignModeDecision {
  if (selector === "A") {
    return {
      recommended: "A",
      rationale:
        "Selected by the operator. Launch will refuse unless provider evidence attests a CLIENT_SCOPED design system owned by this brand.",
      providerPreflightRequired: true,
    };
  }
  if (selector === "C") {
    return {
      recommended: "C",
      rationale:
        "Selected by the operator for a bounded canvas or prototype. A bounded canvas proves a technique; it is not the complete territory and Slice exploration.",
      providerPreflightRequired: true,
    };
  }
  return {
    recommended: "B",
    rationale:
      selector === "AUTO"
        ? "No client-scoped design system was supplied and the source is generated client-local TypeScript, so the exact source baseline plus public context is the correct bridge."
        : "Selected by the operator. The exact source baseline plus public context is the bridge.",
    providerPreflightRequired: true,
  };
}

/* --------------------------------------------------------- baseline binding */

async function loadBaselineEvidence(
  manifestPath: string | undefined,
  binding: ExactBinding,
): Promise<BaselineState> {
  if (manifestPath === undefined) return { status: "MISSING" };
  const resolved = await resolveExistingFile(manifestPath, "baseline evidence manifest");
  const manifest = (await readJsonFile(resolved, "baseline evidence manifest")) as {
    artifactId: string;
    sourceSetId: string;
    captures: { path: string; sha256: string; viewportWidth: number; motion: string }[];
  };
  assertContract("baseline-evidence", manifest);

  const bound = bindBaselineEvidence(manifest, binding);
  if (bound.status !== "BOUND") {
    return { status: "UNBOUND_REFUSED", reason: bound.reason, manifestPath: resolved };
  }

  /* A manifest that names the right artifact but the wrong bytes is the same
   * failure wearing a better disguise, so every capture is rehashed. */
  const root = dirname(resolved);
  for (const capture of manifest.captures) {
    const file = await resolveExistingFile(
      join(root, ...capture.path.split("/")),
      `baseline capture ${capture.path}`,
    );
    if (sha256(await readFile(file)) !== capture.sha256) {
      throw refuse(
        "BASELINE_UNBOUND",
        `Baseline capture ${capture.path} does not match the hash its manifest records.`,
        { capture: capture.path },
      );
    }
  }
  return {
    status: "BOUND",
    manifestPath: resolved,
    manifest,
    coverage: baselineCoverage(manifest.captures),
  };
}

/* ------------------------------------------------------------------ manifest */

function buildManifest(input: {
  workspaceId: string;
  orchestratorSourceRevision: string;
  current: CurrentClientInput;
  binding: ExactBinding;
  media: MediaSummary;
  mode: DesignModeDecision;
  baseline: BaselineState;
  allowlist: readonly string[];
  files: readonly { path: string; sha256: string; size: number }[];
}) {
  const { current, binding, baseline } = input;
  return {
    schemaVersion: 1 as const,
    kind: "PREMIUM_CREATIVE_WORKSPACE" as const,
    workspaceId: input.workspaceId,
    createdBy: {
      command: "creative:prepare" as const,
      orchestratorSourceRevision: input.orchestratorSourceRevision,
    },
    client: {
      clientId: current.clientId,
      configurationId: current.configurationId,
      configurationVersion: current.configurationVersion,
      deploymentId: current.deploymentId,
      experienceId: current.experienceId,
      experienceVersion: current.experienceVersion,
    },
    sourceBinding: {
      artifactId: binding.artifactId,
      factoryRevision: binding.factoryRevision,
      artifactDescriptorSha256: binding.artifactDescriptorSha256,
      definitionSha256: binding.definitionSha256,
      generatedSnapshotSha256: binding.generatedSnapshotSha256,
      sourceSetId: binding.sourceSetId,
      experienceRoot: "source/experience" as const,
      entrypoint: current.entrypoint,
      designDnaPath: current.designDnaPath,
      runtime: current.runtime,
      publicDependencies: current.publicDependencies,
      routeIds: current.routeIds,
      signatureIds: current.signatureIds,
      files: binding.files,
    },
    context: {
      creativeContextJson: "context/creative-context.json",
      creativeContextMarkdown: "context/CREATIVE_CONTEXT.md",
      capabilityEnvelopeJson: "context/signature-capability-envelope.json",
      capabilityEnvelopeMarkdown: "context/signature-capability-envelope.md",
      platformContractMarkdown: "context/PLATFORM_CONTRACT.md",
    },
    delivery: {
      root: "delivery" as const,
      requiredArtifacts: [...REQUIRED_DELIVERY_ARTIFACTS],
    },
    media: {
      root: "media/approved",
      inventory: "media/media-inventory.json",
      assetCount: input.media.assetCount,
      provenance: "UNCLASSIFIED_UNTIL_MEDIA_PLAN",
    },
    designMode: input.mode,
    provider: {
      uploadInventory: "provider/upload-inventory.json",
      preflightTemplate: "provider/provider-preflight.template.json",
      preflightGuide: "provider/PROVIDER_PREFLIGHT.md",
      uploadPerformed: false as const,
    },
    evidence:
      baseline.status === "BOUND"
        ? {
            status: "BOUND" as const,
            baselineManifest: "evidence/baseline-evidence.json",
            artifactId: baseline.manifest.artifactId,
            sourceSetId: baseline.manifest.sourceSetId,
            widths: baseline.coverage.widths,
            reducedMotion: baseline.coverage.reducedMotion,
          }
        : baseline.status === "UNBOUND_REFUSED"
          ? { status: "UNBOUND_REFUSED" as const, reason: baseline.reason }
          : { status: "MISSING" as const },
    integrity: {
      allowlist: [...input.allowlist],
      files: input.files.map(({ path, sha256: digest, size }) => ({
        path,
        sha256: digest,
        size,
      })),
    },
  };
}

/* -------------------------------------------------------------- generated docs */

function platformContract(current: CurrentClientInput): string {
  return `# Platform contract — what client-local source may do

Generated by \`pnpm creative:prepare\` from this client's live experience
manifest and the Factory's own source policy. It is a boundary description, not
a style guide.

## The experience this workspace describes

| | |
|---|---|
| Client | \`${current.clientId}\` |
| Experience | \`${current.experienceId}\` v${current.experienceVersion} |
| Entrypoint | \`${current.entrypoint}\` |
| Design DNA | \`${current.designDnaPath}\` |
| Routes | ${current.routeIds.map((id) => `\`${id}\``).join(", ")} |
| Signatures | ${current.signatureIds.length === 0 ? "none declared" : current.signatureIds.map((id) => `\`${id}\``).join(", ")} |
| Client JavaScript | \`${current.runtime.clientJavaScript}\` |
| Motion | \`${current.runtime.motion}\` |
| Reduced motion | \`${current.runtime.reducedMotion}\` |
| Public dependencies | ${current.publicDependencies.length === 0 ? "none" : current.publicDependencies.map((dependency) => `\`${dependency.name}@${dependency.version}\``).join(", ")} |

## What the Platform provides, and client source must not rebuild

Authored routes receive a \`platform\` prop. Rebuilding any of these bespoke is
a production-handoff finding, not a creative choice:

- \`Link\` — routing between validated pages.
- \`Image\` — a validated client media *reference*, resolved by the Kernel. Client
  source never names a file path or a URL, and always states \`sizes\`.
- \`Region\` — a declared composition region.
- \`Action\` — one external action the validated profile already declares.
- \`Search\` — Foundation Search, when the client has it enabled.
- \`Disclosure\` — responsive disclosure: the same content rendered twice with
  exactly one live. Design, breakpoint and motion stay client-local.
- \`Main\` — the \`<main>\` landmark the skip link targets. Exactly one per route.
- \`SkipLink\` — the first focusable element of a route.

Routes also receive validated \`site\`, \`page\`, \`pageGraph\`, \`profile\`,
\`projects\`, optional \`project\` and resolved \`media\`. Every string a route
renders comes from there or from the client's own definition. Inventing copy in
source is a business-truth change and a stop condition.

## What the source policy refuses

\`apps/managed-web/src/generation/client-experience-source-policy.ts\` inspects
this source at build time and fails closed. The refusals that most often
surprise a prototype:

- **no runtime network of any kind** — no \`fetch\`, \`XMLHttpRequest\`,
  \`WebSocket\`, \`EventSource\`, \`navigator.sendBeacon\`;
- no dynamic import, \`eval\`, \`Function\`, or other execution primitive;
- no \`process\` or environment access;
- no browser storage or cookie access;
- no \`dangerouslySetInnerHTML\` or raw markup injection;
- no remote CSS resource, remote font, or \`url()\` reaching outside validated
  client media;
- no undeclared dependency: a package reaches a client artifact only when the
  manifest declares its exact version *and* repository governance has approved
  it. The approved list is currently empty.

Only \`.ts\`, \`.tsx\`, \`.css\` and \`.json\` files are inspected, and only under
this client's fixed \`experience/\` root. Symlinks and path escape are refused.

The measured matrix of what a Signature may do — with the exact refusal code
for everything it may not — is \`context/signature-capability-envelope.md\`
beside this file.

## Where production happens

The production target is the same client's live \`experience/\` tree, not the
copy in \`source/experience/\` here. This workspace's copy is a hashed read-only
baseline: it exists so a creative environment and a production agent can read
exactly what shipped, and \`creative:launch\` refuses if it has changed.
`;
}

function preflightTemplate(
  workspaceId: string,
  current: CurrentClientInput,
  mode: DesignModeDecision,
) {
  return {
    schemaVersion: 1,
    kind: "CREATIVE_PROVIDER_EVIDENCE",
    provider: "",
    projectLabel: "",
    designMode: mode.recommended,
    binding: {
      workspaceId,
      artifactId: "",
      sourceSetId: "",
      slice: "signature-slice.md",
      gate: "creative-gate.md",
    },
    designSystemAttestation: {
      status: "",
      designSystemId: "",
      brandScope: "",
      attestedBy: "",
      attestedOn: "",
    },
    dataHandlingApproval: {
      approvedBy: "",
      approvedOn: "",
      retentionUnderstood: false,
    },
    items: [
      {
        label: "",
        purpose: "",
        content: "",
        sha256: "",
        carriesNoNewBusinessFact: false,
      },
    ],
    _note: `Fill this before uploading anything for ${current.clientId}, and pass the completed file to creative:launch --vendor-evidence. Remove this note.`,
  };
}

function preflightGuide(
  mode: DesignModeDecision,
  inventory: { files: readonly { path: string; classification: string }[]; totalBytes: number },
): string {
  const byClass = new Map<string, number>();
  for (const file of inventory.files) {
    byClass.set(file.classification, (byClass.get(file.classification) ?? 0) + 1);
  }
  return `# Provider preflight — what a human must decide before any upload

\`creative:prepare\` uploaded nothing. It cannot: no command in this bridge logs
in to, uploads to, syncs with or invokes a creative provider. What it produced
is the exact set of files that *may* leave this machine, and the questions a
named human answers before any of them do.

## The upload set

Design mode **${mode.recommended}** — ${mode.rationale}

| Classification | Files |
|---|---|
${[...byClass.entries()]
  .sort(([left], [right]) => (left < right ? -1 : 1))
  .map(([classification, count]) => `| \`${classification}\` | ${count} |`)
  .join("\n")}

${inventory.files.length} files, ${inventory.totalBytes} bytes, listed exactly in
\`upload-inventory.json\` with a SHA-256 each. Nothing outside that list is
approved, and the list contains no \`.env\`, credential, connector binding,
recipient address, deployment configuration, repository history, build output or
other client's material by construction rather than by scanning.

## What you must declare

Copy \`provider-preflight.template.json\`, fill it, and pass it to
\`creative:launch --vendor-evidence\`. Launch refuses without it once a provider
was used.

1. **Provider and project.** Which service, which project or organisation.
2. **Inherited design system.** Does the provider context inherit one?
   - \`NONE\` — no inherited system. Safe.
   - \`CLIENT_SCOPED\` — an inherited system that belongs to *this* brand. Name
     its id and brand scope.
   - \`FOREIGN_OR_UNKNOWN_BLOCKED\` — anything else. **Blocking.** Disable it,
     switch context, or use an isolated project. Do not proceed and accept the
     aesthetic gravity of another client's system.
3. **Data handling.** Who approved this material leaving the local boundary,
   on what date, and do they understand the provider's retention, sharing and
   residency posture. Retention must be explicitly understood.
4. **Binding.** The workspace id, artifact id and source-set id this evidence
   belongs to. Evidence that does not name them cannot be used at launch.
5. **Per item.** What each export, URL or capture is for, whether it carries
   code, visual, motion or commentary, and confirmation that it introduces no
   business fact the client definition does not already carry.

## What provider output is, and is not

It is evidence and transport. It is not production authority, not client truth,
not a dependency decision and not a gate. The production agent implements the
approved intent against this client's live \`experience/\` source; a canvas
export is something it reads, never something it copies.
`;
}

function operatorPrompts(current: CurrentClientInput, mode: DesignModeDecision): string {
  return `# Operator prompts — ${current.clientId}

Tool-independent. Nothing here names a provider, and replacing the creative
environment changes only where you paste these.

## What to give the environment

Everything in \`provider/upload-inventory.json\`, and nothing else:

- \`context/CREATIVE_CONTEXT.md\` — this client's real copy, routes, projects,
  media and the claims it may not make;
- \`context/PLATFORM_CONTRACT.md\` — what client-local source may and may not do;
- \`context/signature-capability-envelope.md\` — the measured technique matrix;
- \`source/experience/**\` — the exact source the site currently ships;
- \`media/approved/**\` — the client's real assets;
- \`delivery/*.md\` — the empty artifacts you are going to fill.

## Prompt 1 — orientation

> Here is a live client website's exact current source, its validated business
> content, its platform boundary and its capability envelope. Read all of it
> before proposing anything. Tell me what the current site is *doing* — its
> spatial logic, its typographic argument, its motion character, and where it is
> merely competent rather than distinctive. Do not propose a redesign yet.

## Prompt 2 — three territories

> Propose three materially different creative territories for this client. Each
> needs a thesis that could generate visual and motion decisions, not a
> description of a look. Say for each what it keeps from the current
> implementation and why, what it deliberately rewrites and what that buys, and
> how it recomposes at 390px rather than stacking. Same layout with a different
> palette is not a second territory.

## Prompt 3 — the Signature Slice

> Take territory <n>. Build one vertical slice covering navigation, the opening,
> a substantial proof sequence and conversion, using this client's real copy and
> approved media. Show me desktop, 390px and the designed reduced-motion state.
> List every shortcut the prototype takes that production must not inherit.

## Prompt 4 — production delta

> For the approved slice, produce the disposition of each part of the current
> source: KEEP, EVOLVE, REWRITE or NEW_SIGNATURE. For each, name the scope, the
> intent, the reason, and whether production home is P1_REUSE or a path under
> \`experience/\`. Explain the reasons. Do not produce a selector-by-selector
> tracing recipe.

## Constraints to restate in whichever environment you use

- ${mode.recommended === "A" ? "Mode A: an inherited design system is in play. It must be this brand's, attested by a named human." : mode.recommended === "C" ? "Mode C: this is a bounded canvas proving a technique. It is not the full territory and Slice exploration." : "Mode B: the environment receives exact client source and public context, and nothing else."}
- A Signature cannot fetch anything at runtime.
- Only \`REAL_CLIENT_EVIDENCE\` may substantiate work, team, premises, results or
  certifications. Everything else carries atmosphere only.
- No new business fact, route, dependency, font or asset. If the direction needs
  one, that is a stop and a re-preparation, not an improvisation.
- The human decisions — which territory, whether the Slice passes, whether the
  built site ships — are not the environment's to make.
`;
}

function workspaceReadme(
  workspaceId: string,
  current: CurrentClientInput,
  binding: ExactBinding,
  mode: DesignModeDecision,
): string {
  return `# Premium creative workspace — ${current.clientId}

Generated by \`pnpm creative:prepare\`. Read in this order.

| Read | For |
|---|---|
| \`context/CREATIVE_CONTEXT.md\` | The client's real business content, routes, projects and media. |
| \`context/PLATFORM_CONTRACT.md\` | What client-local source may and may not do. |
| \`context/signature-capability-envelope.md\` | The measured matrix of permitted techniques. |
| \`source/experience/**\` | The exact source this site currently ships. |
| \`media/media-inventory.json\` | Every approved asset, provenance unclassified. |
| \`delivery/*.md\` | The nine artifacts you fill. |
| \`provider/PROVIDER_PREFLIGHT.md\` | What a human must decide before any upload. |

## Identity

| | |
|---|---|
| Workspace | \`${workspaceId}\` |
| Client | \`${current.clientId}\` · configuration ${current.configurationId} v${current.configurationVersion} |
| Experience | \`${current.experienceId}\` v${current.experienceVersion} |
| Artifact | \`${binding.artifactId}\` at Factory revision \`${binding.factoryRevision}\` |
| Source set | \`${binding.sourceSetId}\` |
| Design mode | ${mode.recommended} |

\`premium-workspace.json\` carries the full record and \`integrity.sha256\` lets
you check it with \`sha256sum -c integrity.sha256\`.

## What is editable

Only \`delivery/\`. Everything else is a hashed read-only baseline, and
\`creative:launch\` refuses if it has changed.

**The production target is not in this workspace.** It is the same client's live
\`experience/\` tree in the input package this was prepared from. A workspace copy
edited in place is a second website that nothing ships.

## The rest of the path

\`\`\`
  explore territories, prototype a Signature Slice   ← human
  fill delivery/*.md
  pnpm creative:validate <this workspace>/delivery
  record a named-human Creative Gate                 ← human
  pnpm creative:launch  --workspace <this> --input <same input> --output <new dir>
  a fresh production agent implements against the live experience/ tree
  pnpm creative:verify  --workspace <this> --launch <launch dir> --input <same input> --output <new dir>
  sign the final creative gate                       ← human
\`\`\`

Nothing in this workspace was uploaded anywhere. No provider was contacted.
`;
}

async function writeReadme(
  staging: string,
  workspaceId: string,
  current: CurrentClientInput,
  binding: ExactBinding,
  mode: DesignModeDecision,
): Promise<void> {
  await writeInto(staging, "README.md", workspaceReadme(workspaceId, current, binding, mode));
}

/* --------------------------------------------------------------------- misc */

/** A repository-relative path when the target is inside it, absolute otherwise. */
function displayPath(target: string): string {
  const relativePath = relative(process.cwd(), target);
  return relativePath === "" || relativePath.startsWith("..") ? target : relativePath;
}

async function copyInto(from: string, to: string): Promise<void> {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}

async function currentRepositoryRevision(): Promise<string> {
  const result = await runCommand("git", ["rev-parse", "HEAD"], repositoryRoot);
  if (result.exitCode !== 0) {
    throw refuse(
      "INPUT_NOT_FOUND",
      "Could not read the repository revision this workspace is prepared from. Run the command inside the repository checkout.",
      { output: result.output.trim() },
    );
  }
  return result.output.trim();
}

