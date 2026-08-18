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
    body: sections(["Decision", "Named fixes", "Evidence reviewed"], bodyOverrides),
  };
}

function handoff(overrides = {}) {
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
      ...overrides,
    },
    body: sections([
      "Creative intent carried forward",
      "Signature thesis",
      "Behaviour and movement intent",
      "Responsive intent",
      "Media provenance",
      "Production constraints",
      "P1 capabilities to reuse",
      "Client-local bespoke work",
      "Performance, accessibility and reduced motion",
      "What the prototype fakes",
      "Acceptance evidence",
    ]),
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
    expect: "no evidence reviewed",
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
    name: "an unknown promotion decision is caught",
    documents: [
      ledger([["conductor", "northline", "-", "client-local", "PROMOTE_IT", "why not"]]),
    ],
    expect: "it must be one of",
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
