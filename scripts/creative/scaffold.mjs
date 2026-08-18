/**
 * Scaffolds a ready-to-fill creative delivery from the artifact model.
 *
 *   pnpm creative:new <client-id> <directory>
 *   pnpm creative:new --templates          # regenerate docs/creative/templates
 *
 * The templates are generated rather than hand-written on purpose. A hand-written
 * template drifts from the validator the first time a required section is added,
 * and the operator discovers the drift as a failure on work they have already
 * done. Generating both from `artifact-model.mjs` makes that impossible.
 *
 * Every field ships empty. Nothing here carries a default aesthetic, an example
 * value in place, or a previous delivery's vocabulary — that is the guard against
 * the creative pack quietly propagating one house style.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { ARTIFACTS, PROVENANCE_CLASSES } from "./artifact-model.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

/** Guidance shown under a heading, keyed by artifact kind then heading. */
const PROMPTS = {
  "creative-intent": {
    "Customer truth":
      "Who arrives, mid-what decision, holding what alternative? Rank what they need to resolve, in order.",
    "Business truth":
      "What is genuinely distinctive or strategically important here? Not the marketing claim — the true one.",
    "Desired perception":
      "After 30 seconds, the visitor should perceive: …",
    "Primary conversion":
      "The one action this site exists to produce. Name it, and name what makes it feel safe to take.",
    "Creative thesis seed":
      "A concise non-visual idea that can generate visual and motion decisions. If it only describes a look, it is not a thesis.",
    "Productive tension":
      "Two true things in tension — technical and human, monumental and quiet, precise and tactile.",
    "What should remain quiet":
      "What must not compete. A site where everything is loud has no hierarchy.",
    "What may become Signature material":
      "Where the strongest idea could live. Not a mechanic yet — a candidate.",
    "Anti-targets":
      "What would count as a failure rather than a matter of taste. Be specific enough to lose an argument with.",
    "References":
      "Qualities, never layouts. Fill one row per reference.\n\n| Reference | Quality admired | Applicability | Deliberate delta | Must not copy |\n|---|---|---|---|---|\n|  |  |  |  |  |",
  },
  "creative-territory": {
    Thesis: "The central creative idea, in one or two sentences.",
    "Why this belongs to the client":
      "Tie the thesis to the business truth. A territory that would suit any client in this trade is not a territory.",
    Typography:
      "Typographic character and what it is doing for the argument. Values live in the starter brief, not here.",
    "Spatial and composition logic":
      "How space is organised and why. What governs alignment, rhythm and density.",
    "Media and art direction":
      "What imagery is, what it must never be, and how it is treated.",
    "Movement and interaction character":
      "How the site behaves — character and rules, not milliseconds or curves.",
    "Signature idea":
      "One high-value client-specific behaviour or composition, and why this rather than a generic reveal.",
    "P1 inheritance": "What stays exactly as the Factory delivers it, and why that is right.",
    "Intentional rewrite": "What is deliberately bespoke, and what that buys.",
    "Mobile translation":
      "How the idea recomposes small. If it only stacks, the idea is desktop-only.",
    "Conversion continuity": "How the primary conversion survives the art direction.",
    "Performance and accessibility risks": "Where this direction could cost, and the intended mitigation.",
    "Reference delta": "What is deliberately different from every reference used.",
    "Why this is materially different":
      "Against each other territory. Same layout with a different palette is not a difference.",
  },
  "signature-slice": {
    "Creative thesis expressed": "How the built slice makes the thesis legible.",
    "Real content and media inputs": "The actual client content and approved media used. Name them.",
    "Spatial narrative": "How the slice moves the reader from arrival to action.",
    "Interaction and movement sequence": "Intent and relationships, not timings.",
    Desktop: "What the slice does at full width.",
    Mobile: "What it does small — recomposed, not merely stacked.",
    "Reduced motion": "The designed state, not a degraded one. Meaning must survive intact.",
    "Production feasibility": "What makes this buildable inside the source policy.",
    "P1 capabilities reused": "What the Factory already provides that this slice uses unchanged.",
    "Client-local Signature work": "What is genuinely bespoke and stays client-local.",
    "Prototype shortcuts that must not reach production":
      "Everything the prototype fakes, approximates or hardcodes. A slice that fakes nothing is a slice nobody checked.",
  },
  "creative-gate": {
    Decision: "PASS / PASS WITH NAMED FIXES / FAIL, and the reasoning in the founder's own words.",
    "Named fixes":
      "Acceptance conditions, not suggestions. Each one checkable.",
    "Evidence reviewed": "Exactly what was looked at — screens, recordings, viewports, states.",
  },
  "production-handoff": {
    "Creative intent carried forward": "The business truth and anti-targets a production agent must not lose.",
    "Signature thesis": "What the Signature means, so it is rebuilt rather than traced.",
    "Production delta":
      "One row per meaningful source disposition. Explain why it changes and where production owns it; do not trace screenshots into selectors.",
    "Behaviour and movement intent": "What should feel how, and what relationships must hold.",
    "Responsive intent": "How the idea is meant to recompose, not a breakpoint table.",
    "Media provenance": "Which assets, which provenance class, what each may substantiate.",
    "Production constraints": "Budgets and boundaries this build must respect.",
    "P1 capabilities to reuse": "What must not be rebuilt bespoke.",
    "Client-local bespoke work": "What is expected to be new client-local source.",
    "Translation delta":
      "What changed while translating the approved slice into the existing P1 Experience substrate, and why the intent still holds.",
    "Performance, accessibility and reduced motion": "The expectations acceptance will be measured against.",
    "What the prototype fakes": "Everything production must not inherit from the prototype.",
    "Acceptance evidence": "What must exist before this is called done.",
  },
  "final-creative-gate": {
    Decision:
      "PASS / PASS WITH NAMED FIXES / FAIL, made by the named human after objective validation.",
    "Named fixes": "Blocking acceptance conditions, each checkable.",
    "Objective evidence reviewed":
      "The immutable validation report and candidate revision reviewed for this decision.",
    "Creative evidence reviewed":
      "The viewports, interactions and states the decider personally reviewed.",
  },
  "media-plan": {
    Assets: `One row per asset. Only REAL_CLIENT_EVIDENCE may substantiate completed work, team, premises, measured results or certifications; everything else carries atmosphere only. Write "atmosphere" or "none" when an asset asserts no fact.\n\nProvenance classes: ${PROVENANCE_CLASSES.join(" · ")}`,
    Approval: "Who approved this media set, when, and against what evidence.",
  },
  "promotion-ledger": {
    Ledger:
      "One row per bespoke mechanic. Default is CLIENT_LOCAL_SIGNATURE. FACTORY_CANDIDATE needs at least two named deliveries and a stated invariant substrate.",
    "Promotion rule":
      "Do not promote impressive work. Promote repeated invariant mechanics whose reuse lowers recurring delivery cost without constraining creative expression or imposing a global runtime tax.",
  },
};

/**
 * Visible table skeletons. These stay rendered because the operator fills them
 * in place; the surrounding guidance does not.
 */
const SKELETONS = {
  "creative-intent": {
    References:
      "| Reference | Quality admired | Applicability | Deliberate delta | Must not copy |\n|---|---|---|---|---|\n|  |  |  |  |  |",
  },
  "production-handoff": {
    "Production delta":
      "| Disposition | Scope | Intent | Why | Production home |\n|---|---|---|---|---|\n| KEEP |  |  |  | P1_REUSE |",
  },
  "media-plan": {
    Assets:
      "| Asset | Provenance class | Substantiates | Approved by |\n|---|---|---|---|\n|  |  |  |  |",
  },
  "promotion-ledger": {
    Ledger:
      "| Mechanic | Clients observed | Invariant substrate | Current home | Decision | Reason |\n|---|---|---|---|---|---|\n|  |  |  |  | CLIENT_LOCAL_SIGNATURE |  |",
  },
};

/** Front-matter scaffolding per kind, in the order an operator fills it. */
function frontMatterFor(kind, client) {
  const definition = ARTIFACTS[kind];
  const lines = [`kind: ${kind}`];
  /* Keys with their own hint below are skipped here so each appears once. */
  const hinted = new Set([
    "workspace_manifest",
    "source_artifact_id",
    "source_set_id",
    "validation_report",
    "validation_report_sha256",
  ]);
  for (const key of definition.required) {
    if (hinted.has(key)) continue;
    if (key === "client") lines.push(`client: ${client}`);
    else if (key === "decided_on") lines.push(`decided_on: # YYYY-MM-DD`);
    else lines.push(`${key}:${enumHint(definition, key)}`);
  }
  for (const key of Object.keys(definition.lists ?? {})) {
    lines.push(`${key}:`, `  - `);
  }
  for (const key of Object.keys(definition.links ?? {})) {
    lines.push(`${key}: # filename of the ${definition.links[key]} this derives from`);
  }
  for (const key of Object.keys(definition.conditionalLists ?? {})) {
    lines.push(
      `${key}: # required when the gate is PASS_WITH_NAMED_FIXES; one entry per fix`,
      `  - `,
    );
  }
  if (kind === "production-handoff") {
    lines.push(
      `workspace_manifest: # relative path to the workspace's premium-workspace.json`,
      `source_artifact_id: # sourceBinding.artifactId from that manifest`,
      `source_set_id: # sourceBinding.sourceSetId from that manifest`,
    );
  }
  if (kind === "final-creative-gate") {
    lines.push(
      `validation_report: # relative path to objective-validation-report.json`,
      `validation_report_sha256: # its SHA-256, as creative:verify printed it`,
      `source_artifact_id: # the artifact this candidate was built from`,
    );
  }
  if (kind === "creative-territory") {
    lines.push(
      `starter_brief: # path to the starter brief holding this territory's design values`,
      `bespoke: false # set true for a fully hand-authored client experience`,
    );
  }
  if (kind === "signature-slice") {
    lines.push(
      `# techniques must be ids the capability envelope marks PERMITTED:`,
      `#   docs/creative/signature-capability-envelope.md`,
    );
  }
  return lines.join("\n");
}

function enumHint(definition, key) {
  const values = definition.enums?.[key];
  return values === undefined ? "" : ` # ${values.join(" | ")}`;
}

export function renderCreativeArtifact(kind, client) {
  const definition = ARTIFACTS[kind];
  const prompts = PROMPTS[kind] ?? {};
  const skeletons = SKELETONS[kind] ?? {};
  /*
   * Guidance is emitted as an HTML comment: invisible in rendered Markdown, and
   * treated as no content by the validator. So a section an operator has read
   * but not written still fails validation, which is the point -- prose left as
   * instructions is the most common way an artifact looks finished and is not.
   */
  const body = [
    ...(definition.sections ?? []),
    ...(definition.postProductionSections ?? []),
  ]
    .map((heading) => {
      const guidance = prompts[heading];
      const skeleton = skeletons[heading];
      const parts = [`## ${heading}`, ""];
      if (guidance !== undefined) parts.push(`<!-- ${guidance} -->`, "");
      if (skeleton !== undefined) parts.push(skeleton, "");
      return parts.join("\n");
    })
    .join("\n");
  return [
    "---",
    frontMatterFor(kind, client),
    "---",
    "",
    `# ${definition.title}`,
    "",
    `> ${definition.purpose}`,
    ">",
    "> Replace every prompt below with real content. Run `pnpm creative:validate`",
    "> on this directory when you think it is complete.",
    "",
    body,
  ].join("\n");
}

/** Territories are the one artifact produced in triplicate. */
const FILENAMES = {
  "creative-intent": ["creative-intent.md"],
  "creative-territory": [
    "territory-1.md",
    "territory-2.md",
    "territory-3.md",
  ],
  "signature-slice": ["signature-slice.md"],
  "creative-gate": ["creative-gate.md"],
  "production-handoff": ["production-handoff.md"],
  "media-plan": ["media-plan.md"],
  "promotion-ledger": ["promotion-ledger.md"],
};

/*
 * The post-verification ship gate. It is a template an operator reads and the
 * form `creative:verify` emits, and it is deliberately not in `FILENAMES`: a
 * blank ship gate sitting in a delivery from day one invites someone to sign it
 * before the objective evidence it decides on exists.
 */
const TEMPLATE_ONLY_FILENAMES = {
  "final-creative-gate": ["final-creative-gate.md"],
};

export async function emitCreativeArtifacts(directory, client, kinds = FILENAMES) {
  await mkdir(directory, { recursive: true });
  const written = [];
  for (const [kind, names] of Object.entries(kinds)) {
    for (const name of names) {
      const path = join(directory, name);
      await writeFile(path, renderCreativeArtifact(kind, client), "utf8");
      written.push(name);
    }
  }
  return written;
}

export async function runScaffoldCli(args = process.argv.slice(2)) {
  if (args.includes("--templates")) {
    const directory = resolve(repositoryRoot, "docs/creative/templates");
    const written = await emitCreativeArtifacts(directory, "<client-id>", {
      ...FILENAMES,
      ...TEMPLATE_ONLY_FILENAMES,
    });
    process.stdout.write(
      `Regenerated ${written.length} template(s) in docs/creative/templates:\n  ${written.join("\n  ")}\n`,
    );
    return;
  }

  const [client, target] = args.filter((value) => !value.startsWith("--"));
  if (client === undefined || target === undefined) {
    process.stdout.write(
      "usage: pnpm creative:new <client-id> <directory>\n       pnpm creative:new --templates\n",
    );
    process.exitCode = 1;
    return;
  }

  const directory = resolve(target);
  const written = await emitCreativeArtifacts(directory, client);
  process.stdout.write(
    `Scaffolded a creative delivery for "${client}" in ${directory}:\n  ${written.join("\n  ")}\n\nFill every prompt, then run:\n  pnpm creative:validate ${target}\n`,
  );
}

/*
 * The CLI runs only when this file is the process entry point. The premium
 * bridge imports the builders above so a prepared workspace carries exactly the
 * same context and scaffold as the commands produce, and an import that wrote to
 * stdout or set an exit code could not be used that way.
 */
if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  await runScaffoldCli();
}
