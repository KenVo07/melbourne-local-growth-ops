import assert from "node:assert/strict";
import { test } from "node:test";

import {
  PROVENANCE_CLAIM_CAPABILITY,
  assertRecord,
  isNonHumanDecider,
  validateRecord,
} from "./intake-contracts.mjs";
import {
  composeDefinition,
  deriveShotList,
  readinessReport,
  recommendCreativeConfiguration,
} from "./delivery-core.mjs";
import { starterBriefTemplate, unansweredCopy } from "./brief-template.mjs";
import { deliveryPackage } from "./fixtures/northgate-roofing.mjs";

/**
 * The Tradies delivery layer.
 *
 * Every negative case here is a mistake a real delivery would otherwise make
 * quietly: a generated photograph standing behind a named job, a claim nobody
 * sighted printed as a fact, a project published with nothing to prove it, an
 * agent approving a representation made on a business's behalf.
 */

const { saleHandoff, businessRead, clientIntake, mediaInventory, creativeConfiguration } =
  deliveryPackage;

function withAssets(assets) {
  return { ...mediaInventory, assets };
}

const baseAsset = Object.freeze({
  assetId: "job-01",
  sourcePath: "assets/job-01.jpg",
  alt: "A completed job.",
  mediaType: "image/jpeg",
  subject: "COMPLETED_WORK",
  audit: "PROOF_GRADE",
  provenance: "CLIENT_JOB_PHOTOGRAPH",
  lane: "SUPPLIED",
  width: 2000,
  height: 1500,
  focalPoint: { x: 0.5, y: 0.5 },
  substantiates: { kind: "SPECIFIC_JOB", reference: "thornbury-terrace-reroof" },
  approvedForPublication: true,
  approvedBy: "Dana Okafor",
});

/* ------------------------------------------------------------------ records */

test("every fixture record satisfies its contract", () => {
  for (const [kind, record] of [
    ["sale-handoff", saleHandoff],
    ["business-read", businessRead],
    ["client-intake", clientIntake],
    ["media-inventory", mediaInventory],
    ["creative-configuration", creativeConfiguration],
  ]) {
    assert.deepEqual(validateRecord(kind, record), [], `${kind} should be valid`);
  }
});

test("an empty commitments list is an answer, and a missing one is not", () => {
  const { commitments, ...withoutCommitments } = saleHandoff;
  assert.ok(commitments.length > 0);
  const problems = validateRecord("sale-handoff", withoutCommitments);
  assert.ok(problems.some((problem) => problem.includes("commitments")));
  assert.deepEqual(
    validateRecord("sale-handoff", { ...saleHandoff, commitments: [] }),
    [],
  );
});

test("research can never be classified as something the client stated", () => {
  const problems = validateRecord("business-read", {
    ...businessRead,
    observations: [
      {
        observationId: "leak",
        sourceId: "gbp",
        statement: "They are good at finding leaks.",
        classification: "VERIFIED_CLIENT_FACT",
      },
    ],
  });
  assert.ok(
    problems.some((problem) => problem.includes("Research is never a client fact")),
    problems.join("; "),
  );
});

test("an observation must name a source that exists", () => {
  const problems = validateRecord("business-read", {
    ...businessRead,
    observations: [
      {
        observationId: "orphan",
        sourceId: "nowhere",
        statement: "Something.",
        classification: "VERIFIED_PUBLIC_FACT",
      },
    ],
  });
  assert.ok(problems.some((problem) => problem.includes('"nowhere" is not a declared source')));
});

test("a credential carries how it was evidenced and the wording that was approved", () => {
  const problems = validateRecord("client-intake", {
    ...clientIntake,
    credentials: [{ label: "Licence", evidence: "MAYBE", approvedWording: "" }],
  });
  assert.ok(problems.some((problem) => problem.includes("evidence must be SIGHTED or STATED")));
  assert.ok(problems.some((problem) => problem.includes("approvedWording")));
});

test("a phone number that would not dial is refused at intake", () => {
  const problems = validateRecord("client-intake", {
    ...clientIntake,
    contact: { ...clientIntake.contact, phone: "03 9445 0000" },
  });
  assert.ok(problems.some((problem) => problem.includes("international number")));
});

/* ------------------------------------------------------------ media claims */

test("a generated image may not stand behind a named job", () => {
  const problems = validateRecord(
    "media-inventory",
    withAssets([
      {
        ...baseAsset,
        provenance: "GENERATED_SUPPORTING_MEDIA",
        lane: "AI_GENERATED_SUPPORTING",
      },
    ]),
  );
  assert.ok(
    problems.some((problem) =>
      problem.includes("GENERATED_SUPPORTING_MEDIA may substantiate NONE, not SPECIFIC_JOB"),
    ),
    problems.join("; "),
  );
});

test("a materially recomposed asset carries atmosphere, not a job claim", () => {
  const assets = [
    { ...baseAsset, assetId: "real", substantiates: { kind: "NONE", reference: null } },
    {
      ...baseAsset,
      assetId: "recomposed",
      provenance: "RECOMPOSED_CLIENT_ASSET",
      lane: "AI_RECOMPOSED",
      sourceAssetId: "real",
    },
  ];
  const problems = validateRecord("media-inventory", withAssets(assets));
  assert.ok(
    problems.some((problem) => problem.includes("may substantiate ATMOSPHERE, NONE")),
    problems.join("; "),
  );
});

test("a corrected asset inherits its source's claim and must name that source", () => {
  const orphan = validateRecord(
    "media-inventory",
    withAssets([
      { ...baseAsset, provenance: "ENHANCED_CLIENT_ASSET", lane: "AI_ENHANCED" },
    ]),
  );
  assert.ok(orphan.some((problem) => problem.includes("sourceAssetId must name the real asset")));

  const paired = validateRecord(
    "media-inventory",
    withAssets([
      { ...baseAsset, assetId: "real", substantiates: { kind: "NONE", reference: null } },
      {
        ...baseAsset,
        assetId: "corrected",
        provenance: "ENHANCED_CLIENT_ASSET",
        lane: "AI_ENHANCED",
        sourceAssetId: "real",
      },
    ]),
  );
  assert.deepEqual(paired, []);
});

test("a production lane cannot produce a provenance it does not produce", () => {
  const problems = validateRecord(
    "media-inventory",
    withAssets([{ ...baseAsset, lane: "COMMISSIONED" }]),
  );
  assert.ok(
    problems.some((problem) => problem.includes("lane COMMISSIONED cannot produce provenance")),
    problems.join("; "),
  );
});

test("every provenance class has a declared claim capability", () => {
  for (const [provenance, capability] of Object.entries(PROVENANCE_CLAIM_CAPABILITY)) {
    assert.ok(capability.includes("NONE"), `${provenance} must be able to claim nothing`);
  }
  assert.deepEqual(PROVENANCE_CLAIM_CAPABILITY.GENERATED_SUPPORTING_MEDIA, ["NONE"]);
  assert.deepEqual(PROVENANCE_CLAIM_CAPABILITY.STOCK_OR_REFERENCE, ["NONE"]);
});

test("an agent cannot approve a photograph for publication", () => {
  const problems = validateRecord(
    "media-inventory",
    withAssets([{ ...baseAsset, approvedBy: "Claude" }]),
  );
  assert.ok(problems.some((problem) => problem.includes("is not a person")));
  assert.ok(isNonHumanDecider("automation"));
  assert.ok(isNonHumanDecider("the ai assistant"));
  assert.ok(!isNonHumanDecider("Dana Okafor"));
});

test("a published photograph must describe what it shows", () => {
  const problems = validateRecord(
    "media-inventory",
    withAssets([{ ...baseAsset, alt: "" }]),
  );
  assert.ok(problems.some((problem) => problem.includes("must describe what a published photograph shows")));
});

test("an agent cannot approve a creative direction", () => {
  const problems = validateRecord("creative-configuration", {
    ...creativeConfiguration,
    clientApproval: { ...creativeConfiguration.clientApproval, approvedBy: "assistant" },
  });
  assert.ok(problems.some((problem) => problem.includes("is not a person")));
});

test("client approval has exactly one scope, and it is not the pixels", () => {
  const problems = validateRecord("creative-configuration", {
    ...creativeConfiguration,
    clientApproval: { ...creativeConfiguration.clientApproval, scope: "LAYOUT" },
  });
  assert.ok(problems.some((problem) => problem.includes("REPRESENTATION_AND_DIRECTION")));
});

/* --------------------------------------------------------------- readiness */

test("readiness names an owner for every gap", () => {
  const report = readinessReport(deliveryPackage);
  assert.equal(report.clientId, "northgate-roofing");
  assert.ok(report.p1Ready);
  for (const gap of report.gaps) {
    assert.ok(["CLIENT", "AGENCY", "PROPORTION_DERIVES"].includes(gap.owner), gap.owner);
    assert.ok(gap.detail.length > 20, "a gap should say enough to act on");
  }
});

test("an unsighted credential is the agency's problem, not the client's", () => {
  const report = readinessReport(deliveryPackage);
  const gap = report.gaps.find(({ code }) => code === "CREDENTIAL_UNSIGHTED");
  assert.ok(gap);
  assert.equal(gap.owner, "AGENCY");
});

test("an unstated service boundary is reported and never blocks", () => {
  const thin = {
    ...clientIntake,
    services: clientIntake.services.map((service) => ({ ...service, excludes: [] })),
  };
  const report = readinessReport({ ...deliveryPackage, clientIntake: thin });
  assert.ok(report.gaps.some(({ code }) => code === "SERVICE_BOUNDARY_UNSTATED"));
  assert.ok(report.p1Ready, "a missing boundary weakens the site; it does not stop it");
});

test("reference material approved for publication blocks", () => {
  const report = readinessReport({
    ...deliveryPackage,
    mediaInventory: withAssets([
      { ...baseAsset, audit: "REFERENCE_ONLY", provenance: "STOCK_OR_REFERENCE", substantiates: { kind: "NONE", reference: null } },
    ]),
  });
  assert.ok(report.gaps.some(({ code }) => code === "REFERENCE_ASSET_APPROVED"));
  assert.ok(!report.p1Ready);
});

test("a direction that asks for media the client does not have is reported", () => {
  const report = readinessReport({
    ...deliveryPackage,
    creativeConfiguration: { ...creativeConfiguration, imageTreatment: "DOMINANT" },
    mediaInventory: withAssets([baseAsset]),
  });
  assert.ok(report.gaps.some(({ code }) => code === "MEDIA_REALITY_CONTRADICTED"));
});

test("records naming different clients are refused", () => {
  assert.throws(
    () =>
      readinessReport({
        ...deliveryPackage,
        clientIntake: { ...clientIntake, clientId: "someone-else" },
      }),
    (error) => error.code === "IDENTITY_MISMATCH",
  );
});

/* --------------------------------------------------------------- shot gaps */

test("a shot requirement says what it would prove, not that the photos are bad", () => {
  const list = deriveShotList(deliveryPackage);
  assert.ok(list.requirements.length > 0);
  for (const requirement of list.requirements) {
    assert.ok(requirement.count >= 1);
    assert.ok(requirement.framing.length > 20, requirement.code);
    assert.ok(requirement.substantiates.length > 20, requirement.code);
    assert.ok(
      !/better|nicer|good photo/i.test(requirement.framing),
      "a shot list is a job, not feedback",
    );
  }
});

test("a service with no work behind it is asked for evidence by name", () => {
  /* The fixture covers all ten services, so add one nothing has been done under. */
  const withNewService = {
    ...clientIntake,
    services: [
      ...clientIntake.services,
      {
        ...clientIntake.services[0],
        serviceId: "solar-mounting",
        title: "Solar mounting and penetrations",
        featured: false,
      },
    ],
  };
  const list = deriveShotList({ ...deliveryPackage, clientIntake: withNewService });
  const requirement = list.requirements.find(
    ({ code }) => code === "SERVICE_EVIDENCE:solar-mounting",
  );
  assert.ok(requirement, list.requirements.map(({ code }) => code).join(", "));
  assert.match(requirement.substantiates, /Solar mounting and penetrations/);
});

test("the creative direction changes how many frames each job needs", () => {
  const restrained = deriveShotList({
    ...deliveryPackage,
    creativeConfiguration: { ...creativeConfiguration, imageTreatment: "RESTRAINED" },
  });
  const dominant = deriveShotList({
    ...deliveryPackage,
    creativeConfiguration: { ...creativeConfiguration, imageTreatment: "DOMINANT" },
  });
  assert.ok(dominant.totalFrames > restrained.totalFrames);
});

test("a client with strong complete media is asked for little", () => {
  const complete = {
    ...clientIntake,
    projects: clientIntake.projects.slice(0, 1),
    services: clientIntake.services.slice(0, 1),
  };
  const assets = [
    { ...baseAsset, assetId: "a", substantiates: { kind: "SPECIFIC_JOB", reference: complete.projects[0].projectId } },
    { ...baseAsset, assetId: "b", substantiates: { kind: "SPECIFIC_JOB", reference: complete.projects[0].projectId } },
    { ...baseAsset, assetId: "c", subject: "TEAM", provenance: "CLIENT_PREMISES_OR_TEAM", substantiates: { kind: "BUSINESS_ITSELF", reference: null } },
    { ...baseAsset, assetId: "d", subject: "VEHICLE", provenance: "CLIENT_PREMISES_OR_TEAM", substantiates: { kind: "BUSINESS_ITSELF", reference: null } },
    { ...baseAsset, assetId: "e", subject: "MATERIAL_DETAIL", substantiates: { kind: "ATMOSPHERE", reference: null } },
    { ...baseAsset, assetId: "f", subject: "MATERIAL_DETAIL", substantiates: { kind: "ATMOSPHERE", reference: null } },
    { ...baseAsset, assetId: "g", subject: "BEFORE_STATE", substantiates: { kind: "SPECIFIC_JOB", reference: complete.projects[0].projectId } },
  ];
  const list = deriveShotList({
    ...deliveryPackage,
    clientIntake: complete,
    mediaInventory: withAssets(assets),
  });
  assert.equal(list.requirements.length, 0, JSON.stringify(list.requirements));
});

/* ----------------------------------------------------------- recommendation */

test("media reality decides the image treatment, not taste", () => {
  const thin = recommendCreativeConfiguration({
    businessRead,
    clientIntake,
    mediaInventory: withAssets([baseAsset]),
  });
  assert.equal(thin.imageTreatment, "RESTRAINED");

  const rich = recommendCreativeConfiguration({
    businessRead,
    clientIntake,
    mediaInventory: withAssets(
      Array.from({ length: 14 }, (_unused, index) => ({
        ...baseAsset,
        assetId: `asset-${index}`,
        audit: "SALES_GRADE",
        substantiates: { kind: "NONE", reference: null },
      })),
    ),
  });
  assert.equal(rich.imageTreatment, "DOMINANT");
});

test("a recommendation is a draft, never a decision", () => {
  const draft = recommendCreativeConfiguration(deliveryPackage);
  assert.equal(draft.derivedBy, "");
  assert.equal(draft.clientApproval.approved, false);
  assert.equal(draft.clientApproval.scope, "REPRESENTATION_AND_DIRECTION");
  assert.ok(Object.keys(draft.rationale).length > 0, "a proposal shows its reasoning");
});

/* --------------------------------------------------------------- composing */

test("a project with nothing to prove it is not published", () => {
  const composed = composeDefinition(deliveryPackage);
  const published = new Set(composed.definition.projects.projects.map(({ projectId }) => projectId));
  assert.ok(!published.has("brunswick-skylights"));
  assert.ok(
    composed.warnings.some((warning) => warning.includes("brunswick-skylights")),
    "and the operator is told why",
  );
});

test("a published project's hero can carry a specific-job claim", () => {
  const composed = composeDefinition(deliveryPackage);
  const byId = new Map(mediaInventory.assets.map((asset) => [asset.assetId, asset]));
  for (const project of composed.definition.projects.projects) {
    const hero = byId.get(project.hero.assetId);
    assert.ok(hero, project.projectId);
    assert.equal(hero.substantiates.kind, "SPECIFIC_JOB");
    assert.equal(hero.substantiates.reference, project.projectId);
    assert.ok(
      PROVENANCE_CLAIM_CAPABILITY[hero.provenance].includes("SPECIFIC_JOB"),
      `${hero.assetId} provenance ${hero.provenance}`,
    );
  }
});

test("the truth ledger separates what the client said from what we inferred", () => {
  const composed = composeDefinition(deliveryPackage);
  const classes = new Set(composed.truthLedger.entries.map(({ truthClass }) => truthClass));
  assert.ok(classes.has("VERIFIED_CLIENT_FACT"));
  assert.ok(classes.has("CLIENT_CLAIM"));
  assert.ok(classes.has("VERIFIED_PUBLIC_FACT"));
  assert.ok(classes.has("INFERRED_OPPORTUNITY"));

  const claim = composed.truthLedger.entries.find(({ truthClass }) => truthClass === "CLIENT_CLAIM");
  assert.match(claim.note, /not independently verified/i);

  const brand = composed.truthLedger.entries.find(({ field }) => field === "profile.brand");
  assert.equal(brand.truthClass, "INFERRED_OPPORTUNITY");
});

test("an unpublishable phone number becomes a stated absence, not a broken link", () => {
  const composed = composeDefinition({
    ...deliveryPackage,
    clientIntake: {
      ...clientIntake,
      contact: { ...clientIntake.contact, phone: undefined },
    },
  });
  const actions = composed.definition.profile.sections.find(({ type }) => type === "ACTIONS");
  assert.equal(actions.actions[0].state, "NOT_CONFIGURED");
  assert.ok(actions.actions[0].message.includes("international"));
});

test("a service with nothing to say gets no route", () => {
  const quiet = {
    ...clientIntake,
    services: [
      {
        ...clientIntake.services[0],
        narrative: undefined,
        covers: [],
        excludes: [],
        suitedTo: [],
        whenToCall: [],
        customerProvides: [],
        stages: [],
        commercial: [],
        questions: [],
      },
      ...clientIntake.services.slice(1),
    ],
  };
  const composed = composeDefinition({ ...deliveryPackage, clientIntake: quiet });
  const routed = composed.definition.pageGraph.pages
    .filter(({ kind }) => kind === "SERVICE_DETAIL")
    .map(({ content }) => content.serviceId);
  assert.ok(!routed.includes(clientIntake.services[0].serviceId));
  const listed = composed.definition.profile.sections
    .find(({ type }) => type === "SERVICES")
    .items.map(({ serviceId }) => serviceId);
  assert.ok(listed.includes(clientIntake.services[0].serviceId), "it stays a row on the index");
});

test("service groups survive composition and every group has members", () => {
  const composed = composeDefinition(deliveryPackage);
  const services = composed.definition.profile.sections.find(({ type }) => type === "SERVICES");
  assert.equal(services.groups.length, 3);
  for (const group of services.groups) {
    assert.ok(
      services.items.some((item) => item.groupId === group.groupId),
      `${group.groupId} has no members`,
    );
  }
});

test("a business with no credentials makes no credential claim", () => {
  const composed = composeDefinition({
    ...deliveryPackage,
    clientIntake: { ...clientIntake, credentials: [] },
  });
  const trust = composed.definition.profile.sections.find(({ type }) => type === "TRUST_SIGNALS");
  assert.ok(trust.disclaimer.includes("No licence, registration or insurance claim is made"));
});

/* ------------------------------------------------------------------- brief */

test("the brief derives every design decision and refuses to write the copy", () => {
  const composed = composeDefinition(deliveryPackage);
  const brief = starterBriefTemplate(creativeConfiguration, composed.definition, mediaInventory);
  assert.equal(brief.colour.ground, creativeConfiguration.ground);
  assert.equal(brief.typography.displayFamily, creativeConfiguration.typography.displayFamily);
  assert.equal(brief.media.scale, creativeConfiguration.imageTreatment);
  assert.equal(brief.space.density, creativeConfiguration.density);

  const unanswered = unansweredCopy(brief);
  assert.ok(unanswered.length >= 8, unanswered.join("; "));
  assert.ok(unanswered.some((field) => field.startsWith("copy.homeHeadline")));
  /* Chrome and restatement are derived and must not be TODO. */
  assert.ok(!unanswered.some((field) => field.startsWith("copy.servicesEyebrow")));
  assert.ok(!unanswered.some((field) => field.startsWith("copy.faqEyebrow")));
});

test("a mixed-provenance set cannot claim one provenance line", () => {
  const composed = composeDefinition(deliveryPackage);
  const brief = starterBriefTemplate(creativeConfiguration, composed.definition, mediaInventory);
  assert.ok(
    unansweredCopy(brief).some((field) => field.startsWith("media.provenanceCaption")),
    "the fixture publishes a generated texture, so one line cannot be true of all of it",
  );
});

test("the enquiry checklist restates what the services actually ask for", () => {
  const composed = composeDefinition(deliveryPackage);
  const brief = starterBriefTemplate(creativeConfiguration, composed.definition, mediaInventory);
  const asked = clientIntake.services.flatMap((service) => service.customerProvides);
  for (const item of brief.copy.contactChecklist) {
    assert.ok(asked.includes(item), `"${item}" was not asked for by any service`);
  }
});

test("assertRecord throws a named refusal rather than a bare error", () => {
  assert.throws(
    () => assertRecord("sale-handoff", { schemaVersion: 1 }),
    (error) => error.code === "CONTRACT_INVALID" && Array.isArray(error.detail.problems),
  );
});
