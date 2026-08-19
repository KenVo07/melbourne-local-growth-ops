/**
 * The Creative Delivery System's artifact model.
 *
 * Every creative artifact is one Markdown file with a YAML front-matter block.
 * The front-matter carries what a machine can honestly check — identity, links,
 * declared techniques, provenance classes, decisions, dates. The prose carries
 * the creative content.
 *
 * That split is deliberate and it is the reason this system can be validated at
 * all: taste is not machine-checkable, and a schema that pretended otherwise
 * would be the "giant creative schema" the acceptance model fails on. What is
 * checked here is presence, traceability, provenance and internal consistency.
 *
 * Where a design decision already has a home in the Factory — the starter brief,
 * the experience manifest, design DNA — the artifact names that home and the
 * value lives there. No design values are duplicated into front-matter.
 */

/** Provenance classes. Only one of these may substantiate a factual claim. */
export const PROVENANCE_CLASSES = Object.freeze([
  "REAL_CLIENT_EVIDENCE",
  "AI_ASSISTED_REAL",
  "AI_GENERATED_CREATIVE",
  "LICENSED_STOCK",
  "REFERENCE_ONLY",
]);

/**
 * The only provenance class permitted to substantiate completed work, team,
 * premises, measured results or certifications. Everything else may carry
 * atmosphere and nothing else.
 */
export const EVIDENCE_CLASS = "REAL_CLIENT_EVIDENCE";

/** Values in a media plan's "Substantiates" column that assert no fact. */
export const NON_SUBSTANTIATING = Object.freeze(["none", "atmosphere", "-", "—"]);

export const GATE_DECISIONS = Object.freeze([
  "PASS",
  "PASS_WITH_NAMED_FIXES",
  "FAIL",
]);

export const PROMOTION_DECISIONS = Object.freeze([
  "CLIENT_LOCAL_SIGNATURE",
  "REUSABLE_CREATIVE_RESOURCE",
  "FACTORY_CANDIDATE",
  "REJECTED",
]);

/** Coarse source dispositions for the approved design-to-production delta. */
export const PRODUCTION_DISPOSITIONS = Object.freeze([
  "KEEP",
  "EVOLVE",
  "REWRITE",
  "NEW_SIGNATURE",
]);

/**
 * The only two places approved production work may live: a Platform capability
 * that is reused rather than rebuilt, or a path inside this client's own
 * experience tree. Anything else is P1, Core, another client, or a provider
 * runtime, and none of those is a premium delivery's business.
 */
export const P1_REUSE_HOME = "P1_REUSE";
export const CLIENT_EXPERIENCE_HOME = /^experience\/[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

/**
 * Phrases that mean "reproduce the picture" rather than "build the intent".
 *
 * A handoff exists so a production agent rebuilds a thesis rather than tracing
 * a screenshot; a rationale that says "match the design" has recorded no
 * reason, and the next reviewer cannot tell whether the built page is right.
 */
export const TRACING_LANGUAGE = Object.freeze([
  "match design",
  "match the design",
  "match the mock",
  "match the prototype",
  "match the screenshot",
  "as per the design",
  "as per the mock",
  "as in the export",
  "pixel perfect",
  "pixel-perfect",
  "1:1 with",
  "copy the design",
  "copy the prototype",
  "same as figma",
  "same as the canvas",
]);

/** A Signature Slice must cover at least these four moments. */
export const REQUIRED_SLICE_COVERAGE = Object.freeze([
  "navigation",
  "opening",
  "proof",
  "conversion",
]);

/**
 * Identities that must never appear as a Creative Gate's decider. The gate is
 * the one place the acceptance model reserves for human judgement, so an agent
 * signing it is a system failure rather than a formatting mistake.
 */
export const NON_HUMAN_DECIDERS = Object.freeze([
  "claude",
  "claude code",
  "opus",
  "sonnet",
  "haiku",
  "gpt",
  "codex",
  "agent",
  "awos",
  "ai",
  "assistant",
  "model",
  "bot",
]);

/**
 * Artifact definitions.
 *
 * `required` — front-matter keys that must be present and non-empty.
 * `lists` — keys that must parse as a list, with a minimum length.
 * `enums` — keys constrained to a fixed value set.
 * `links` — keys naming another artifact file, with the kind it must resolve to.
 * `sections` — prose headings that must exist and carry content.
 */
export const ARTIFACTS = Object.freeze({
  "creative-intent": {
    title: "Creative Intent",
    purpose:
      "The upstream human argument a delivery is built from: business truth, who is deciding what, and what the site must never become.",
    required: ["client", "status"],
    enums: { status: ["DRAFT", "READY_FOR_TERRITORIES"] },
    lists: { anti_targets: 1, perception_targets: 1 },
    links: {},
    sections: [
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
    ],
  },
  "creative-territory": {
    title: "Creative Territory",
    purpose:
      "One materially different creative direction. States intent and rationale in prose; names where design values live rather than restating them.",
    required: ["client", "territory", "thesis"],
    lists: { materially_different_from: 1 },
    links: { intent: "creative-intent" },
    sections: [
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
    ],
  },
  "signature-slice": {
    title: "Signature Slice",
    purpose:
      "The prototyped proof of one selected territory, covering navigation, opening, a substantial proof sequence and conversion.",
    required: ["client", "selected_territory"],
    lists: { covers: 4, techniques: 1, prototype_fakes: 1 },
    links: { territory: "creative-territory" },
    sections: [
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
    /*
     * Two sections the premium bridge refuses by name rather than as a generic
     * unfilled section. Mobile recomposition and the designed reduced-motion
     * state are the two the Creative Gate is most often signed without, and an
     * operator reading "MOBILE_EVIDENCE_MISSING" knows immediately what to do.
     */
    sectionCodes: {
      Mobile: "MOBILE_EVIDENCE_MISSING",
      "Reduced motion": "REDUCED_MOTION_MISSING",
    },
  },
  "creative-gate": {
    title: "Creative Gate",
    purpose:
      "The founder's recorded creative decision. The system can prove a gate happened; it never claims to have passed one.",
    required: ["client", "decision", "decided_by", "decided_on", "candidate_commit"],
    enums: { decision: GATE_DECISIONS },
    lists: {},
    links: { candidate: "signature-slice" },
    sections: ["Decision", "Named fixes", "Evidence reviewed"],
  },
  "production-handoff": {
    title: "Production Handoff",
    purpose:
      "What a production agent needs so it builds the intent rather than copying a picture.",
    required: [
      "client",
      "selected_territory",
      "prototype_tool",
      "workspace_manifest",
      "source_artifact_id",
      "source_set_id",
    ],
    lists: {
      prototype_artifacts: 1,
      techniques: 1,
      p1_capabilities_reused: 1,
      prototype_fakes: 1,
    },
    /*
     * Not in `lists`, because a PASS gate legitimately names no fixes. It is
     * required only when the gate this handoff descends from is
     * PASS_WITH_NAMED_FIXES, which the validator checks across the two.
     */
    conditionalLists: { named_fixes: "gate:PASS_WITH_NAMED_FIXES" },
    links: { gate: "creative-gate", slice: "signature-slice" },
    sections: [
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
    /*
     * Sections the scaffold renders and the artifact must carry, but which a
     * delivery cannot fill before the work exists. `creative:validate` does not
     * require content in them, `creative:launch` requires the heading to be
     * present, and `creative:verify` requires it filled. Requiring the
     * Translation delta at gate time would only teach operators to write
     * "pending" in it.
     */
    postProductionSections: ["Translation delta"],
    productionDeltaTable: {
      heading: "Production delta",
      columns: ["Disposition", "Scope", "Intent", "Why", "Production home"],
    },
  },
  "final-creative-gate": {
    title: "Final Creative Ship Gate",
    purpose:
      "The named human decision after objective implementation validation.",
    required: [
      "client",
      "decision",
      "decided_by",
      "decided_on",
      "candidate_commit",
      "validation_report",
      "validation_report_sha256",
      "source_artifact_id",
    ],
    enums: { decision: GATE_DECISIONS },
    lists: {},
    links: {},
    sections: [
      "Decision",
      "Named fixes",
      "Objective evidence reviewed",
      "Creative evidence reviewed",
    ],
  },
  "media-plan": {
    title: "Media Plan",
    purpose:
      "Every asset a delivery uses, with its provenance class and what it is allowed to substantiate.",
    required: ["client"],
    lists: {},
    links: {},
    sections: ["Assets", "Approval"],
    /** Parsed from the Assets table rather than front-matter. */
    assetTable: {
      heading: "Assets",
      columns: ["Asset", "Provenance class", "Substantiates", "Approved by"],
    },
  },
  "promotion-ledger": {
    title: "Promotion Ledger",
    purpose:
      "Every bespoke mechanic and where it lives. Defaults to client-local; promotion requires repeated evidence, never impressiveness.",
    required: [],
    lists: {},
    links: {},
    sections: ["Ledger", "Promotion rule"],
    ledgerTable: {
      heading: "Ledger",
      columns: [
        "Mechanic",
        "Clients observed",
        "Invariant substrate",
        "Current home",
        "Decision",
        "Reason",
      ],
    },
  },
});

/** Promotion to a Factory candidate requires this many distinct deliveries. */
export const FACTORY_CANDIDATE_MIN_CLIENTS = 2;
