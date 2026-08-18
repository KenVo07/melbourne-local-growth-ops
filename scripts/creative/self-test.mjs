/**
 * Proves the validator's rules actually fire.
 *
 * A validator nobody has tested is a validator that passes everything, and this
 * one is the only automated defence behind media truth and the human Creative
 * Gate. Each case below is a minimal in-memory delivery that should trip exactly
 * one rule, plus one complete delivery that must pass cleanly.
 *
 * Run with: pnpm creative:validate:self-test
 */
import { validateArtifacts } from "./validate-core.mjs";

/** A document builder that starts from something already valid. */
function intent(overrides = {}) {
  return {
    name: "creative-intent.md",
    kind: "creative-intent",
    frontMatter: {
      kind: "creative-intent",
      client: "probe-client",
      status: "READY_FOR_TERRITORIES",
      anti_targets: ["generic trade template"],
      perception_targets: ["precise"],
      ...overrides,
    },
    body: sections([
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
  };
}

function territory(id, others, overrides = {}) {
  return {
    name: `territory-${id}.md`,
    kind: "creative-territory",
    frontMatter: {
      kind: "creative-territory",
      client: "probe-client",
      territory: id,
      thesis: `Thesis ${id}`,
      intent: "creative-intent.md",
      starter_brief: "briefs/probe.json",
      materially_different_from: others,
      ...overrides,
    },
    body: sections([
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
  };
}

function slice(overrides = {}) {
  return {
    name: "signature-slice.md",
    kind: "signature-slice",
    frontMatter: {
      kind: "signature-slice",
      client: "probe-client",
      selected_territory: "alpha",
      territory: "territory-alpha.md",
      covers: ["navigation", "opening", "proof", "conversion"],
      techniques: ["css-scroll-driven-animation", "intersection-observer"],
      prototype_fakes: ["placeholder project photography"],
      ...overrides,
    },
    body: sections([
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
    ]),
  };
}

function gate(overrides = {}, bodyOverrides = {}) {
  return {
    name: "creative-gate.md",
    kind: "creative-gate",
    frontMatter: {
      kind: "creative-gate",
      client: "probe-client",
      decision: "PASS_WITH_NAMED_FIXES",
      decided_by: "Khoa Vo",
      decided_on: "2026-08-19",
      candidate_commit: "abc1234",
      candidate: "signature-slice.md",
      ...overrides,
    },
    body: sections(["Decision", "Named fixes", "Evidence reviewed"], {
      "Named fixes": "- Raise the 390px conversion above the fold",
      ...bodyOverrides,
    }),
  };
}

const PROBE_HASH = "a".repeat(64);

/** One complete Production delta row, as an operator would fill it. */
function deltaRow(overrides = {}) {
  return {
    Disposition: "EVOLVE",
    Scope: "experience/routes/HomeRoute.tsx opening sequence",
    Intent: "Replace the static hero with the drawn-ground opening",
    Why: "The thesis is that the ground is surveyed before it is built on, and a static hero states nothing about that",
    "Production home": "experience/routes/HomeRoute.tsx",
    ...overrides,
  };
}

function deltaTable(rows) {
  const columns = ["Disposition", "Scope", "Intent", "Why", "Production home"];
  return [
    `| ${columns.join(" | ")} |`,
    `|${columns.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${columns.map((column) => row[column] ?? "").join(" | ")} |`),
  ].join("\n");
}

function handoff(overrides = {}, deltaRows = [deltaRow()]) {
  return {
    name: "production-handoff.md",
    kind: "production-handoff",
    frontMatter: {
      kind: "production-handoff",
      client: "probe-client",
      selected_territory: "alpha",
      prototype_tool: "Claude Design",
      prototype_artifacts: ["exports/slice-desktop.png"],
      techniques: ["css-scroll-driven-animation"],
      p1_capabilities_reused: ["Platform Image focal behaviour"],
      prototype_fakes: ["placeholder project photography"],
      gate: "creative-gate.md",
      slice: "signature-slice.md",
      named_fixes: ["Raise the 390px conversion above the fold"],
      workspace_manifest: "../premium-workspace.json",
      source_artifact_id: PROBE_HASH,
      source_set_id: "b".repeat(64),
      ...overrides,
    },
    body: sections(
      [
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
      ],
      { "Production delta": deltaTable(deltaRows) },
    ),
  };
}

function finalGate(overrides = {}, bodyOverrides = {}) {
  return {
    name: "final-creative-gate.md",
    kind: "final-creative-gate",
    frontMatter: {
      kind: "final-creative-gate",
      client: "probe-client",
      decision: "PASS",
      decided_by: "Khoa Vo",
      decided_on: "2026-08-19",
      candidate_commit: "abc1234",
      validation_report: "objective-validation-report.json",
      validation_report_sha256: PROBE_HASH,
      source_artifact_id: "c".repeat(64),
      ...overrides,
    },
    body: sections(
      [
        "Decision",
        "Named fixes",
        "Objective evidence reviewed",
        "Creative evidence reviewed",
      ],
      bodyOverrides,
    ),
  };
}

function mediaPlan(assetRows, overrides = {}) {
  const rows = assetRows
    .map((row) => `| ${row.join(" | ")} |`)
    .join("\n");
  return {
    name: "media-plan.md",
    kind: "media-plan",
    frontMatter: { kind: "media-plan", client: "probe-client", ...overrides },
    body: [
      "## Assets",
      "",
      "| Asset | Provenance class | Substantiates | Approved by |",
      "|---|---|---|---|",
      rows,
      "",
      "## Approval",
      "",
      "Approved by the founder on 2026-08-19.",
      "",
    ].join("\n"),
  };
}

function ledger(rows) {
  return {
    name: "promotion-ledger.md",
    kind: "promotion-ledger",
    frontMatter: { kind: "promotion-ledger", client: "probe-client" },
    body: [
      "## Ledger",
      "",
      "| Mechanic | Clients observed | Invariant substrate | Current home | Decision | Reason |",
      "|---|---|---|---|---|---|",
      ...rows.map((row) => `| ${row.join(" | ")} |`),
      "",
      "## Promotion rule",
      "",
      "Promote repeated invariant mechanics, never impressive ones.",
      "",
    ].join("\n"),
  };
}

function sections(headings, overrides = {}) {
  return headings
    .map((heading) => `## ${heading}\n\n${overrides[heading] ?? `Filled content for ${heading}.`}\n`)
    .join("\n");
}

/** A complete, internally consistent delivery that must validate cleanly. */
function completeDelivery() {
  return [
    intent(),
    territory("alpha", ["beta", "gamma"]),
    territory("beta", ["alpha", "gamma"]),
    territory("gamma", ["alpha", "beta"]),
    slice(),
    gate(),
    handoff(),
    mediaPlan([
      ["hero", "REAL_CLIENT_EVIDENCE", "completed switchboard work", "Khoa Vo"],
      ["texture", "AI_GENERATED_CREATIVE", "atmosphere", "Khoa Vo"],
    ]),
    ledger([
      ["conductor", "northline", "-", "client-local", "CLIENT_LOCAL_SIGNATURE", "one delivery"],
    ]),
  ];
}

const cases = [
  {
    name: "a complete delivery passes",
    documents: completeDelivery(),
    expect: null,
  },
  {
    name: "an unfilled required field is caught",
    documents: [intent({ client: "[ ]" })],
    expect: 'missing "client"',
  },
  {
    name: "a missing prose section is caught",
    documents: [
      { ...intent(), body: intent().body.replace("## Business truth", "## Something else") },
    ],
    expect: '"## Business truth"',
  },
  {
    name: "two territories instead of three is caught",
    documents: [intent(), territory("alpha", ["beta"]), territory("beta", ["alpha"])],
    expect: "exactly 3 materially different",
  },
  {
    name: "a territory that does not differentiate itself is caught",
    documents: [
      intent(),
      territory("alpha", ["beta"]),
      territory("beta", ["alpha", "gamma"]),
      territory("gamma", ["alpha", "beta"]),
    ],
    expect: "materially_different_from",
  },
  {
    name: "a territory restating design values instead of naming their home is caught",
    documents: [
      intent(),
      territory("alpha", ["beta", "gamma"], { starter_brief: "", bespoke: "false" }),
      territory("beta", ["alpha", "gamma"]),
      territory("gamma", ["alpha", "beta"]),
    ],
    expect: 'name a "starter_brief"',
  },
  {
    name: "a slice missing one of the four moments is caught",
    documents: [slice({ covers: ["navigation", "opening", "proof"] })],
    expect: "does not cover conversion",
  },
  {
    name: "a slice promising a refused technique is caught",
    documents: [slice({ techniques: ["fetch-runtime-data"] })],
    expect: "the source policy refuses",
  },
  {
    name: "a slice promising an unprobed technique is caught",
    documents: [slice({ techniques: ["webgpu-compute"] })],
    expect: "capability envelope does not cover",
  },
  {
    name: "a slice with no declared prototype fakes is caught",
    documents: [slice({ prototype_fakes: [] })],
    expect: "prototype_fakes",
  },
  {
    name: "an agent signing the creative gate is caught",
    documents: [gate({ decided_by: "Claude Code" })],
    expect: "reserved for a named human",
  },
  {
    name: "a PASS with no reviewed evidence is caught",
    documents: [gate({ decision: "PASS" }, { "Evidence reviewed": "[ ]" })],
    expect: 'records a PASS with "## Evidence reviewed" empty',
  },
  {
    name: "PASS_WITH_NAMED_FIXES naming no fixes is caught",
    documents: [gate({}, { "Named fixes": "[ ]" })],
    expect: "names no fixes",
  },
  {
    name: "a handoff descending from a failed gate is caught",
    documents: [gate({ decision: "FAIL" }), handoff()],
    expect: "gate that FAILED",
  },
  {
    name: "generated media substantiating real work is caught",
    documents: [
      mediaPlan([["team", "AI_GENERATED_CREATIVE", "our qualified team", "Khoa Vo"]]),
    ],
    expect: "Only REAL_CLIENT_EVIDENCE",
  },
  {
    name: "stock media substantiating a certification is caught",
    documents: [
      mediaPlan([["cert", "LICENSED_STOCK", "A-grade electrical licence", "Khoa Vo"]]),
    ],
    expect: "Only REAL_CLIENT_EVIDENCE",
  },
  {
    name: "an unknown provenance class is caught",
    documents: [mediaPlan([["hero", "PROBABLY_FINE", "atmosphere", "Khoa Vo"]])],
    expect: "it must be one of",
  },
  {
    name: "an asset that does not say what it substantiates is caught",
    documents: [mediaPlan([["hero", "AI_GENERATED_CREATIVE", "", "Khoa Vo"]])],
    expect: "does not say what it substantiates",
  },
  {
    name: "an asset with no human approver is caught",
    documents: [mediaPlan([["hero", "AI_GENERATED_CREATIVE", "atmosphere", ""]])],
    expect: "no named human approver",
  },
  {
    name: "promotion to Factory on a single delivery is caught",
    documents: [
      ledger([["conductor", "northline", "scroll progress", "client-local", "FACTORY_CANDIDATE", "impressive"]]),
    ],
    expect: "at least 2 named deliveries",
  },
  {
    name: "promotion to Factory with no invariant substrate is caught",
    documents: [
      ledger([["conductor", "northline, stone-line", "[ ]", "client-local", "FACTORY_CANDIDATE", "impressive"]]),
    ],
    expect: "no stated invariant substrate",
  },
  {
    /*
     * A scaffolded artifact leaves every field unanswered, which the parser
     * yields as an empty list rather than a string. The validator has to report
     * that as a missing field, not crash on it -- the first thing any operator
     * does is validate a half-filled delivery.
     */
    name: "an entirely unanswered artifact reports rather than crashes",
    documents: [
      {
        name: "creative-gate.md",
        kind: "creative-gate",
        frontMatter: { kind: "creative-gate", decision: [], decided_by: [], candidate: [] },
        body: "",
      },
    ],
    expect: 'missing "decision"',
  },
  {
    name: "an unknown promotion decision is caught",
    documents: [
      ledger([["conductor", "northline", "-", "client-local", "PROMOTE_IT", "why not"]]),
    ],
    expect: "it must be one of",
  },

  // ---- The premium bridge's source binding and production delta ----------
  {
    name: "a handoff that is not bound to a prepared source set is caught",
    documents: [handoff({ source_artifact_id: "not-a-hash" })],
    expect: "is not a SHA-256",
  },
  {
    name: "a handoff naming a workspace on one machine is caught",
    documents: [handoff({ workspace_manifest: "/home/operator/work/premium-workspace.json" })],
    expect: "names one machine",
  },
  {
    name: "an empty production delta is caught",
    documents: [handoff({}, [])],
    expect: "no rows",
  },
  {
    name: "a production delta row with no reason is caught",
    documents: [handoff({}, [deltaRow({ Why: "" })])],
    expect: "trace the picture instead",
  },
  {
    name: "a reason that says to reproduce the picture is caught",
    documents: [handoff({}, [deltaRow({ Why: "Match the design exactly" })])],
    expect: "instruction to reproduce a picture",
  },
  {
    name: "a reason too short to be one is caught",
    documents: [handoff({}, [deltaRow({ Why: "it is better" })])],
    expect: "too short to be one",
  },
  {
    name: "a production delta row with no intent is caught",
    documents: [handoff({}, [deltaRow({ Intent: "" })])],
    expect: "does not say what changes",
  },
  {
    name: "an unknown disposition is caught",
    documents: [handoff({}, [deltaRow({ Disposition: "REFRESH" })])],
    expect: "it must be one of KEEP, EVOLVE, REWRITE, NEW_SIGNATURE",
  },
  {
    name: "production work sent into Core is caught",
    documents: [
      handoff({}, [deltaRow({ "Production home": "packages/site-core/src/render.ts" })]),
    ],
    expect: "P1, Core, root configuration, another client",
  },
  {
    name: "production work sent to an absolute path is caught",
    documents: [
      handoff({}, [deltaRow({ "Production home": "/srv/other-client/experience/Home.tsx" })]),
    ],
    expect: "Production home is P1_REUSE",
  },
  {
    name: "production work sent outside this client's experience tree is caught",
    documents: [
      handoff({}, [deltaRow({ "Production home": "experience/../../other-client/Home.tsx" })]),
    ],
    expect: "Production home is P1_REUSE",
  },
  {
    name: "a new Signature with no client-local ledger entry is caught",
    documents: [
      handoff({}, [deltaRow({ Disposition: "NEW_SIGNATURE" })]),
      ledger([["conductor", "northline, stone-line", "scroll progress", "core", "FACTORY_CANDIDATE", "repeated"]]),
    ],
    expect: "starts client-local",
  },
  {
    name: "named fixes left behind in the gate are caught",
    documents: [gate(), handoff({ named_fixes: [] })],
    expect: "Every acceptance condition must reach production",
  },
  {
    name: "a handoff carrying fewer fixes than the gate named is caught",
    documents: [
      gate({}, { "Named fixes": "- Raise the 390px conversion\n- Restore focus visibility on the disclosure" }),
      handoff({ named_fixes: ["Raise the 390px conversion"] }),
    ],
    expect: "carries 1 of the 2 named fix(es)",
  },

  // ---- The post-verification ship gate is the same human act -------------
  {
    name: "an agent signing the ship gate is caught",
    documents: [finalGate({ decided_by: "Opus 5" })],
    expect: "reserved for a named human",
  },
  {
    name: "a ship gate PASS with no objective evidence reviewed is caught",
    documents: [finalGate({}, { "Objective evidence reviewed": "[ ]" })],
    expect: 'records a PASS with "## Objective evidence reviewed" empty',
  },
  {
    name: "a ship gate PASS with no creative evidence reviewed is caught",
    documents: [finalGate({}, { "Creative evidence reviewed": "[ ]" })],
    expect: 'records a PASS with "## Creative evidence reviewed" empty',
  },
  {
    name: "a ship gate that does not name the exact report it decided on is caught",
    documents: [finalGate({ validation_report_sha256: "reviewed-the-latest-one" })],
    expect: "must name the exact report",
  },
  {
    name: "a ship gate with no decision is caught",
    documents: [finalGate({ decision: [] })],
    expect: 'missing "decision"',
  },
];

export function runSelfTest(envelope) {
  const failures = [];
  for (const testCase of cases) {
    const problems = validateArtifacts(testCase.documents, envelope);
    const messages = problems.map(({ file, message }) => `${file} ${message}`);

    if (testCase.expect === null) {
      if (problems.length > 0) {
        failures.push(
          `"${testCase.name}" should have passed but reported: ${messages.join(" | ")}`,
        );
      }
      continue;
    }
    if (!messages.some((message) => message.includes(testCase.expect))) {
      failures.push(
        `"${testCase.name}" did not report ${JSON.stringify(testCase.expect)}. Got: ${messages.join(" | ") || "(nothing)"}`,
      );
    }
  }
  return failures;
}

export const selfTestCaseCount = cases.length;
