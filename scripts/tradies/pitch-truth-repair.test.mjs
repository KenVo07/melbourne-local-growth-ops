import assert from "node:assert/strict";
import { test } from "node:test";
import { assertPitchCopySafe, validateRecord } from "./intake-contracts.mjs";
import { composeDefinition, readinessReport } from "./delivery-core.mjs";
import { starterBriefTemplate } from "./brief-template.mjs";
import { deliveryPackage } from "./fixtures/northgate-roofing.mjs";

const { saleHandoff, businessRead, clientIntake, mediaInventory, creativeConfiguration } = deliveryPackage;
const pitchArchitecture = Object.freeze({
  schemaVersion: 1,
  kind: "PITCH_ARCHITECTURE",
  clientId: saleHandoff.clientId,
  mode: "NONPRODUCTION_PITCH",
  proposedOn: "2026-09-06",
  proposedBy: "Proportion pitch reviewer",
  businessName: clientIntake.businessName,
  story: "Proposed private-pitch narrative; not an owner-confirmed business story.",
  serviceGroups: clientIntake.serviceGroups,
  services: clientIntake.services.map((service) => ({ ...service })),
  serviceAreas: [...clientIntake.serviceAreas],
  process: [...clientIntake.process],
  credentials: [],
  projects: [],
  faqs: [...clientIntake.faqs],
  commercial: [...clientIntake.commercial],
  contact: { ...clientIntake.contact, enquiryEmail: "ronan@proportion.systems", ownership: "PROPORTION_CONTROLLED" },
  sourceRefs: ["business-read.json", "sale-handoff.json"],
  claimPolicy: {
    authority: "PROPOSED_PITCH_ARCHITECTURE",
    publication: "PRIVATE_PITCH_ONLY",
    clientPreviewAcceptanceRequired: true,
    prohibitedClaims: ["LICENCE_OR_REGISTRATION", "INSURANCE", "UNVERIFIED_COMPLETED_PROJECT", "UNVERIFIED_TESTIMONIAL"],
  },
});

const pitchCreativeConfiguration = Object.freeze({
  ...creativeConfiguration,
  clientApproval: { approved: false, scope: "REPRESENTATION_AND_DIRECTION" },
  agencyPitchApproval: {
    approved: true,
    approvedBy: "Morgan Founder",
    approvedOn: "2026-09-06",
    scope: "PRIVATE_PITCH_DIRECTION",
  },
});

function pitchRecords(overrides = {}) {
  return { saleHandoff, businessRead, pitchArchitecture, mediaInventory, creativeConfiguration: pitchCreativeConfiguration, ...overrides };
}

test("[PITCH-FACTORY-01] pitch architecture validates without becoming client intake", () => {
  assert.deepEqual(validateRecord("pitch-architecture", pitchArchitecture), []);
  const report = readinessReport(pitchRecords());
  assert.equal(report.p1Ready, true);
  assert.equal(report.present.clientIntake, false);
  assert.equal(report.present.pitchArchitecture, true);
});

test("[PITCH-FACTORY-02] compose ledger preserves pitch provenance and never upgrades it to client fact", () => {
  const composed = composeDefinition(pitchRecords());
  const pitchEntries = composed.truthLedger.entries.filter((entry) => entry.source === "pitch-architecture.json");
  assert.deepEqual(
    new Set(pitchEntries.map((entry) => entry.field)),
    new Set([
      ...pitchArchitecture.services.map((service) => `profile.services.${service.serviceId}`),
      "profile.story",
      "profile.serviceAreas",
      "profile.process",
      "profile.faqs",
      "profile.contact",
    ]),
  );
  assert.ok(pitchEntries.every((entry) => entry.truthClass === "PROPOSED_PITCH_ARCHITECTURE"));
  assert.equal(pitchEntries.some((entry) => entry.truthClass === "VERIFIED_CLIENT_FACT"), false);
  assert.ok(composed.truthLedger.composedFrom.includes("pitch-architecture.json"));
  assert.equal(composed.truthLedger.composedFrom.includes("client-intake.json"), false);
  assert.equal(composed.definition.projects.projects.length, 0);
  const trust = composed.definition.profile.sections.find((section) => section.sectionId === "trust");
  assert.ok(trust);
  assert.deepEqual(trust.items, ["No credential claim is included in this private pitch"]);
  assert.equal(composed.definition.configuration.deploymentId, `${saleHandoff.clientId}-private-pitch`);
  assert.equal(composed.definition.configuration.display.tagline, "Private nonproduction pitch — proposed structure, not owner-confirmed business facts.");
  const brandEntry = composed.truthLedger.entries.find((entry) => entry.field === "profile.brand");
  assert.ok(brandEntry);
  assert.doesNotMatch(brandEntry.note, /approved by the client/i);
  const connector = composed.definition.configuration.connectors[0];
  assert.ok(connector);
  assert.equal(connector.accountOwner, "AGENCY");
  assert.equal(connector.portability, "AGENCY_MANAGED");
});

test("[PITCH-FACTORY-03] normal client intake path remains verified-client truth", () => {
  const composed = composeDefinition(deliveryPackage);
  const serviceEntries = composed.truthLedger.entries.filter((entry) => String(entry.field).startsWith("profile.services."));
  assert.ok(serviceEntries.length > 0);
  assert.ok(serviceEntries.every((entry) => entry.truthClass === "VERIFIED_CLIENT_FACT" && entry.source === "client-intake.json"));
  const connector = composed.definition.configuration.connectors[0];
  if (connector !== undefined) {
    assert.equal(connector.accountOwner, "CLIENT");
    assert.equal(connector.portability, "CLIENT_OWNED");
  }
});

test("[PITCH-FACTORY-04] ambiguous dual structural authority fails closed", () => {
  assert.throws(
    () => composeDefinition({ ...pitchRecords(), clientIntake }),
    (error) => error?.code === "CONTRACT_INVALID",
  );
  assert.throws(
    () => readinessReport({ ...pitchRecords(), clientIntake }),
    (error) => error?.code === "CONTRACT_INVALID",
  );
});

test("[PITCH-FACTORY-05] pitch cannot carry credentials, completed jobs, or another client identity", () => {
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, credentials: [{ label: "Licence" }] }).some((problem) => problem.includes("credentials must be empty")));
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, projects: [{ projectId: "invented" }] }).some((problem) => problem.includes("projects must be empty")));
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, testimonials: [{ quote: "Invented praise" }] }).some((problem) => problem.includes("testimonials")));
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, clientApproval: { approved: true } }).some((problem) => problem.includes("clientApproval")));
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, story: "Licensed and insured roofers with REC 12345." }).some((problem) => problem.includes("claim language")));
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, story: "We do not cut corners; we completed 500 jobs last year." }).some((problem) => problem.includes("claim language")));
  for (const claim of [
    "Our team has completed 500 jobs across Melbourne.",
    "Rated 5 stars by local homeowners.",
    "Read our customer reviews.",
    "Electrical registration no. 12345.",
    "Covered by public liability insurance.",
  ]) {
    assert.ok(
      validateRecord("pitch-architecture", { ...pitchArchitecture, story: claim }).some((problem) => problem.includes("claim language")),
      `expected prohibited pitch claim to be rejected: ${claim}`,
    );
  }
  assert.ok(validateRecord("pitch-architecture", { ...pitchArchitecture, completedJobs: [{ title: "Invented job" }] }).some((problem) => problem.includes("completedJobs")));
  assert.ok(validateRecord("pitch-architecture", {
    ...pitchArchitecture,
    serviceGroups: [{ groupId: "core", title: "Licensed and insured specialists" }],
  }).some((problem) => problem.includes("claim language")));
  assert.ok(validateRecord("pitch-architecture", {
    ...pitchArchitecture,
    contact: { ...pitchArchitecture.contact, enquiryEmail: "owner@example.test" },
  }).some((problem) => problem.includes("Proportion-controlled")));
  assert.ok(validateRecord("pitch-architecture", {
    ...pitchArchitecture,
    contact: { ...pitchArchitecture.contact, ownership: "CLIENT_OWNED" },
  }).some((problem) => problem.includes("PROPORTION_CONTROLLED")));
  assert.ok(validateRecord("pitch-architecture", {
    ...pitchArchitecture,
    services: pitchArchitecture.services.map((service, index) => index === 0 ? { ...service, groupId: "missing-group" } : service),
  }).some((problem) => problem.includes("not a declared service group")));
  assert.ok(validateRecord("pitch-architecture", {
    ...pitchArchitecture,
    serviceGroups: pitchArchitecture.serviceGroups.map((group, index) => index === 0 ? { ...group, title: "" } : group),
  }).some((problem) => problem.includes("title must be a non-empty string")));
  assert.throws(
    () => readinessReport(pitchRecords({ pitchArchitecture: { ...pitchArchitecture, clientId: "someone-else" } })),
    (error) => error?.code === "IDENTITY_MISMATCH",
  );
});

test("[PITCH-FACTORY-07] pitch P1 copy cannot reintroduce prohibited claims after structural validation", () => {
  for (const claim of [
    "We do not cut corners; we completed 500 jobs last year.",
    "Our team has completed 500 jobs across Melbourne.",
    "Rated 5 stars by local homeowners.",
    "Read our customer reviews.",
    "Electrical registration no. 12345.",
    "Covered by public liability insurance.",
  ]) {
    assert.throws(
      () => assertPitchCopySafe({ copy: { homeLede: claim } }),
      (error) => error?.code === "CONTRACT_INVALID",
      `expected prohibited pitch copy to be rejected: ${claim}`,
    );
  }
  assert.doesNotThrow(() => assertPitchCopySafe({ copy: { homeLede: "No credential claim is included in this private pitch." } }));
});

test("[PITCH-FACTORY-08] pitch starter derivation cannot synthesize prohibited completed-work or credential copy", () => {
  const composed = composeDefinition(pitchRecords());
  const brief = starterBriefTemplate(
    pitchCreativeConfiguration,
    composed.definition,
    mediaInventory,
  );
  assert.doesNotThrow(() => assertPitchCopySafe(brief));
  assert.equal(brief.copy.homeProjectsHeading, "Visual direction");
  assert.equal(brief.copy.projectsEyebrow, "Proposed examples");
  assert.equal(brief.copy.claimsEyebrow, "Claims pending confirmation");
  assert.equal(brief.copy.footerStatement, "Private nonproduction pitch — proposed structure, not owner-confirmed business facts.");
  assert.match(brief.media.provenanceCaption, /private visual direction/i);
  assert.match(brief.mediaPlan.homeHero.alt, /private visual direction/i);
});

test("[PITCH-FACTORY-06] private pitch approval is agency-owned and cannot synthesize client approval", () => {
  const withoutAgencyApproval = {
    ...pitchCreativeConfiguration,
    agencyPitchApproval: undefined,
  };
  const report = readinessReport(pitchRecords({ creativeConfiguration: withoutAgencyApproval }));
  assert.equal(report.p1Ready, false);
  assert.ok(report.blocking.some((item) => item.code === "PITCH_DIRECTION_UNAPPROVED" && item.owner === "AGENCY"));
  assert.throws(
    () => composeDefinition(pitchRecords({ creativeConfiguration: withoutAgencyApproval })),
    (error) => error?.code === "CONTRACT_INVALID",
  );
  assert.throws(
    () => composeDefinition(pitchRecords({ creativeConfiguration: { ...pitchCreativeConfiguration, clientApproval: { approved: true, scope: "REPRESENTATION_AND_DIRECTION" } } })),
    (error) => error?.code === "CONTRACT_INVALID",
  );
});
