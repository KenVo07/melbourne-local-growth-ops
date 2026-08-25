/**
 * The Tradies delivery engine.
 *
 * Four pure transformations, in the order an operator meets them:
 *
 *   readiness   — what is present, what is missing, and **who owns each gap**
 *   shot gap    — the exact photographs still needed, derived from the site
 *                 being built rather than from a universal checklist
 *   recommend   — a creative configuration proposed from positioning, audience
 *                 and media reality, for a human to edit and a client to approve
 *   compose     — intake + research + media → one validated `client-website.json`
 *                 and a truth ledger saying where every published fact came from
 *
 * Nothing here reads the filesystem or the network. The CLI does the reading and
 * the writing; this file does the deciding, so every rule is testable against an
 * in-memory fixture.
 */
import {
  PUBLISHABLE_AS_FACT,
  assertSameClient,
  refuse,
} from "./intake-contracts.mjs";

/* ------------------------------------------------------------------------ */
/* Readiness                                                                 */
/* ------------------------------------------------------------------------ */

/** Who has to act to close a gap. The operator never guesses this. */
export const GAP_OWNERS = Object.freeze(["CLIENT", "AGENCY", "PROPORTION_DERIVES"]);

function gap(owner, code, detail) {
  return Object.freeze({ owner, code, detail });
}

/**
 * What is present, what is missing, and who closes it.
 *
 * The output is deliberately shaped for a person to act on rather than for a
 * machine to gate on: gaps carry an owner, because "the site is not ready" is
 * useless and "the client still owes you three service boundaries, and you still
 * owe them a shot list" is a morning's work.
 *
 * `p1Ready` is the only boolean, and it is true when the Factory has everything
 * it needs — not when the delivery is perfect.
 */
export function readinessReport(records) {
  const { saleHandoff, businessRead, clientIntake, mediaInventory, creativeConfiguration } = records;
  const clientId = assertSameClient({
    "sale-handoff": saleHandoff,
    "business-read": businessRead,
    "client-intake": clientIntake,
    "media-inventory": mediaInventory,
    "creative-configuration": creativeConfiguration,
  });

  const gaps = [];
  const present = {
    saleHandoff: saleHandoff !== undefined,
    businessRead: businessRead !== undefined,
    clientIntake: clientIntake !== undefined,
    mediaInventory: mediaInventory !== undefined,
    creativeConfiguration: creativeConfiguration !== undefined,
  };

  if (!present.saleHandoff) {
    gaps.push(gap("AGENCY", "SALE_HANDOFF_MISSING", "No closed-sale record. Delivery scope is unknown."));
  }
  if (!present.businessRead) {
    gaps.push(gap("AGENCY", "BUSINESS_READ_MISSING", "Nobody has read the business yet. This is the first step, before anything is asked of the client."));
  }
  if (!present.clientIntake) {
    gaps.push(gap("CLIENT", "CLIENT_INTAKE_MISSING", "The client has not answered the factual questions."));
  }
  if (!present.mediaInventory) {
    gaps.push(gap("CLIENT", "MEDIA_DUMP_MISSING", "The client has not sent their material. Ask for everything they have, uncurated."));
  }
  if (!present.creativeConfiguration) {
    gaps.push(gap("AGENCY", "CREATIVE_CONFIGURATION_MISSING", "No creative direction has been derived. Run the recommendation, edit it, then take it to the client."));
  }

  if (clientIntake !== undefined) {
    for (const service of clientIntake.services) {
      if (service.covers.length === 0) {
        gaps.push(gap("CLIENT", "SERVICE_SCOPE_UNKNOWN", `"${service.title}": what the service covers is unanswered.`));
      }
      if (service.excludes.length === 0) {
        /*
         * The boundary is the answer most often skipped and the one that
         * qualifies hardest, so it is reported even though it never blocks. A
         * client with genuinely no exclusions says so by writing one.
         */
        gaps.push(gap("CLIENT", "SERVICE_BOUNDARY_UNSTATED", `"${service.title}": what the service does not cover is unanswered. This is the question that saves both parties a wasted site visit.`));
      }
    }
    if (clientIntake.credentials.length === 0) {
      gaps.push(gap("CLIENT", "CREDENTIALS_UNSTATED", "No licences, registrations or insurances recorded. If the business genuinely holds none, record that; if it does, the wording must be approved."));
    }
    for (const credential of clientIntake.credentials) {
      if (credential.evidence === "STATED") {
        gaps.push(gap("AGENCY", "CREDENTIAL_UNSIGHTED", `"${credential.label}" is a client claim nobody has sighted. Sight the certificate or keep the approved wording as a claim.`));
      }
    }
    if (clientIntake.projects.length === 0) {
      gaps.push(gap("CLIENT", "NO_WORK_EXAMPLES", "No past jobs recorded. A trade site can ship without them, and it will lean entirely on credentials."));
    }
  }

  if (mediaInventory !== undefined) {
    const publishable = mediaInventory.assets.filter((asset) => asset.approvedForPublication);
    if (publishable.length === 0) {
      gaps.push(gap("AGENCY", "NO_APPROVED_MEDIA", "No asset is approved for publication. Audit the dump and approve what can be used."));
    }
    const unaudited = mediaInventory.assets.filter(
      (asset) => asset.audit === "REFERENCE_ONLY" && asset.approvedForPublication,
    );
    for (const asset of unaudited) {
      gaps.push(gap("AGENCY", "REFERENCE_ASSET_APPROVED", `"${asset.assetId}" is REFERENCE_ONLY but approved for publication. Reference material is never published.`));
    }
  }

  if (creativeConfiguration !== undefined && creativeConfiguration.clientApproval.approved !== true) {
    gaps.push(gap("CLIENT", "DIRECTION_UNAPPROVED", "The client has not approved the representation and direction."));
  }

  /*
   * Media reality is an input to the design, not a disappointment discovered at
   * production. A photographic grammar over a set whose best assets need work
   * is a decision that should be reversed at configuration time.
   */
  if (creativeConfiguration !== undefined && mediaInventory !== undefined) {
    const strong = mediaInventory.assets.filter(
      (asset) =>
        asset.approvedForPublication &&
        (asset.audit === "SALES_GRADE" || asset.audit === "PROOF_GRADE"),
    ).length;
    if (creativeConfiguration.imageTreatment === "DOMINANT" && strong < 6) {
      gaps.push(gap("AGENCY", "MEDIA_REALITY_CONTRADICTED", `The direction asks for DOMINANT imagery and the audit has ${strong} strong approved assets. Either commission the shots or choose a grammar the material can carry.`));
    }
  }

  const blocking = gaps.filter(({ code }) => BLOCKING_GAPS.includes(code));
  return Object.freeze({
    clientId,
    present: Object.freeze(present),
    gaps: Object.freeze(gaps),
    blocking: Object.freeze(blocking),
    p1Ready: blocking.length === 0,
  });
}

/**
 * The gaps that stop the Factory, as distinct from the gaps that make the site
 * weaker.
 *
 * Kept deliberately short. A readiness check that blocks on everything it would
 * like is a check an operator learns to ignore.
 */
export const BLOCKING_GAPS = Object.freeze([
  "SALE_HANDOFF_MISSING",
  "CLIENT_INTAKE_MISSING",
  "MEDIA_DUMP_MISSING",
  "CREATIVE_CONFIGURATION_MISSING",
  "NO_APPROVED_MEDIA",
  "REFERENCE_ASSET_APPROVED",
]);

/* ------------------------------------------------------------------------ */
/* Shot gap                                                                  */
/* ------------------------------------------------------------------------ */

/**
 * The photographs still missing, derived from the site being built.
 *
 * Not a universal checklist. Each requirement is generated because a specific
 * page or a specific claim has nothing to stand on, and each carries the subject,
 * the framing and **what claim it would substantiate** — so a person can execute
 * it and the agency can tell when it has been closed.
 *
 * The output is a shot list. "Better photos of your work" is not a shot list.
 */
export function deriveShotList({ clientIntake, mediaInventory, creativeConfiguration }) {
  if (clientIntake === undefined || mediaInventory === undefined) {
    throw refuse(
      "CONTRACT_INVALID",
      "A shot list is derived from the intake and the media audit together. Both are required.",
    );
  }
  const usable = mediaInventory.assets.filter(
    (asset) => asset.audit !== "REFERENCE_ONLY",
  );
  const bySubject = (subject) => usable.filter((asset) => asset.subject === subject);
  const proofFor = (projectId) =>
    usable.filter(
      (asset) =>
        asset.substantiates?.kind === "SPECIFIC_JOB" &&
        asset.substantiates.reference === projectId,
    );

  const treatment = creativeConfiguration?.imageTreatment ?? "BALANCED";
  /*
   * A restrained grammar needs fewer frames per record and a dominant one needs
   * more. This is the one place the creative direction changes what is asked
   * for, which is the point: the shot list is derived from the site, and the
   * direction is part of the site.
   */
  const perProject = treatment === "DOMINANT" ? 3 : treatment === "RESTRAINED" ? 1 : 2;

  const requirements = [];
  const need = (code, count, subject, framing, substantiates) =>
    requirements.push(
      Object.freeze({ code, count, subject, framing, substantiates }),
    );

  const heroCandidates = usable.filter(
    (asset) => asset.subject === "COMPLETED_WORK" && asset.width >= asset.height,
  );
  if (heroCandidates.length === 0) {
    need(
      "HOME_HERO",
      1,
      "A completed job",
      "Landscape, wide enough to show the whole result and its setting, in even overcast light",
      "The home page's opening claim that this business finishes work to this standard",
    );
  }

  if (bySubject("TEAM").length === 0) {
    need(
      "TEAM_ON_SITE",
      1,
      "The person or crew who does the work, on a real site",
      "Waist-up or wider, working rather than posed, faces visible",
      "That there is a real business with real people behind the phone number",
    );
  }

  if (bySubject("VEHICLE").length === 0 && bySubject("SIGNAGE").length === 0) {
    need(
      "VEHICLE_OR_SIGNAGE",
      1,
      "The work vehicle or the business signage",
      "Three-quarter view, livery legible",
      "That the business a customer sees in the street is the business on the site",
    );
  }

  if (bySubject("MATERIAL_DETAIL").length < 2) {
    need(
      "WORKMANSHIP_DETAIL",
      2 - bySubject("MATERIAL_DETAIL").length,
      "Close work: a joint, a termination, a finished edge",
      "Close, square to the surface, sharp, in daylight",
      "That the standard claimed in the copy is visible in the work",
    );
  }

  for (const project of clientIntake.projects) {
    const have = proofFor(project.projectId).length;
    if (have < perProject) {
      need(
        `PROJECT_EVIDENCE:${project.projectId}`,
        perProject - have,
        `The completed job "${project.title}"`,
        "One wide frame showing the whole result, the rest closer on what was actually done",
        `That this business completed this job${project.locationLabel === undefined ? "" : ` in ${project.locationLabel}`}`,
      );
    }
    const before = usable.filter(
      (asset) =>
        asset.subject === "BEFORE_STATE" &&
        asset.substantiates?.reference === project.projectId,
    ).length;
    if (project.featured === true && before === 0) {
      need(
        `PROJECT_BEFORE:${project.projectId}`,
        1,
        `The before state of "${project.title}"`,
        "From the same position and roughly the same focal length as the finished frame",
        "The difference the work made, which is the argument a before frame exists to make",
      );
    }
  }

  for (const service of clientIntake.services) {
    const evidence = clientIntake.projects.filter((project) =>
      project.serviceIds.includes(service.serviceId),
    ).length;
    if (evidence === 0) {
      need(
        `SERVICE_EVIDENCE:${service.serviceId}`,
        1,
        `Work of the kind sold as "${service.title}"`,
        "One frame that reads unambiguously as this service and not as a neighbouring one",
        `That this business actually performs "${service.title}", which nothing currently shows`,
      );
    }
  }

  return Object.freeze({
    clientId: clientIntake.clientId,
    derivedFrom: Object.freeze({
      services: clientIntake.services.length,
      projects: clientIntake.projects.length,
      usableAssets: usable.length,
      imageTreatment: treatment,
    }),
    requirements: Object.freeze(requirements),
    totalFrames: requirements.reduce((sum, { count }) => sum + count, 0),
  });
}

/* ------------------------------------------------------------------------ */
/* Creative recommendation                                                   */
/* ------------------------------------------------------------------------ */

/**
 * A creative configuration proposed from what is known, for a human to edit.
 *
 * The client is never asked "what colours do you want". They are asked factual
 * questions and for their material; this reads both, plus the agency's business
 * read, and proposes a direction. What comes back is a **draft**: `derivedBy`
 * is empty and `clientApproval.approved` is false, so a recommendation cannot be
 * mistaken for a decision.
 */
export function recommendCreativeConfiguration({ businessRead, clientIntake, mediaInventory }) {
  if (businessRead === undefined || clientIntake === undefined || mediaInventory === undefined) {
    throw refuse(
      "CONTRACT_INVALID",
      "A creative recommendation is derived from the business read, the intake and the media audit together. All three are required.",
    );
  }
  const approved = mediaInventory.assets.filter((asset) => asset.approvedForPublication);
  const strong = approved.filter(
    (asset) => asset.audit === "SALES_GRADE" || asset.audit === "PROOF_GRADE",
  ).length;
  const proof = approved.filter((asset) => asset.audit === "PROOF_GRADE").length;

  /*
   * Media reality decides the image treatment, not taste. A site whose best
   * material needs work is given a grammar that does not depend on a
   * photograph carrying a full-bleed composition.
   */
  const imageTreatment = strong >= 12 ? "DOMINANT" : strong >= 5 ? "BALANCED" : "RESTRAINED";

  /*
   * Trust strategy decides where the argument is carried. A business with
   * credentials and no photographs argues from credentials; one with a
   * portfolio and no paperwork argues from the work.
   */
  const proofEmphasis =
    clientIntake.credentials.length > 0 && proof >= 4
      ? "BOTH"
      : proof >= 4
        ? "WORK"
        : "CREDENTIALS";

  const hasExistingBrand =
    businessRead.brandReality === "STRONG_EXISTING" ||
    businessRead.brandReality === "PARTIAL";

  return Object.freeze({
    schemaVersion: 1,
    kind: "CREATIVE_CONFIGURATION",
    clientId: clientIntake.clientId,
    derivedOn: businessRead.readOn,
    derivedBy: "",
    perceptionTargets: [...businessRead.positioning.desiredPerception],
    antiTargets: [...businessRead.positioning.antiPerception],
    brandConstraints: {
      hasExistingBrand,
      lockedColours: [],
      lockedTypefaces: [],
    },
    palette: {
      direction: hasExistingBrand
        ? "Carry the existing identity forward; the site is not the place to relaunch a brand the customer already recognises on a van."
        : "Build a plain, high-contrast identity from the trade's own material. Nothing decorative competes with the work.",
      accentColor: "#8a3324",
      accentContrastColor: "#ffffff",
      surfaceColor: "#ffffff",
      textColor: "#1a1a1a",
    },
    ground: "NEUTRAL_LIGHT",
    typography: {
      character:
        "Plain, sturdy, unfussy. A trade customer is reading to decide, not to admire the typesetting.",
      displayFamily: "GROTESQUE_SANS",
      textFamily: "HUMANIST_SANS",
    },
    density: "MEASURED",
    imageTreatment,
    temperament:
      "Direct and unhurried. The site should read like the business answering the phone properly.",
    motionAppetite: "MICRO",
    proofEmphasis,
    signatureOpportunity: {
      present: false,
      material: "",
      note: "A signature is designed for this client's material or omitted. Nothing here yet argues for one.",
    },
    clientApproval: {
      approved: false,
      scope: "REPRESENTATION_AND_DIRECTION",
    },
    /** Why each derived value is what it is, so a human edits with the reasoning visible. */
    rationale: Object.freeze({
      imageTreatment: `${strong} approved asset(s) are SALES_GRADE or better.`,
      proofEmphasis: `${proof} PROOF_GRADE asset(s), ${clientIntake.credentials.length} credential(s).`,
      brand: `Business read recorded brand reality as ${businessRead.brandReality}.`,
      trustStrategy: businessRead.trustStrategy,
    }),
  });
}

/* ------------------------------------------------------------------------ */
/* Compose                                                                   */
/* ------------------------------------------------------------------------ */

export function slugify(input) {
  const slug = String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "item" : slug;
}

function truncate(text, limit) {
  const trimmed = String(text).trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, limit - 1).trimEnd()}…`;
}

function ledgerEntry(field, truthClass, source, note) {
  return Object.freeze({ field, truthClass, source, note });
}

/**
 * Intake + research + media → one validated client definition, plus a ledger
 * saying where every published fact came from.
 *
 * This is the step that removes duplicate truth entry. Before it, a service's
 * scope was typed into the intake and then typed again into the creative brief,
 * and the two drifted. Afterwards there is one authored source for each fact and
 * one derived artifact, and the ledger names the class of every one.
 *
 * The output is *not* validated here — validating it needs site-core, which this
 * dependency-free layer deliberately does not import. The CLI validates it, so a
 * definition that does not pass the Factory's own contracts never reaches disk.
 */
export function composeDefinition(records) {
  const { saleHandoff, businessRead, clientIntake, mediaInventory, creativeConfiguration } = records;
  for (const [name, record] of Object.entries({
    saleHandoff,
    clientIntake,
    mediaInventory,
    creativeConfiguration,
  })) {
    if (record === undefined) {
      throw refuse("CONTRACT_INVALID", `composeDefinition requires ${name}.`);
    }
  }
  const clientId = assertSameClient({
    "sale-handoff": saleHandoff,
    "business-read": businessRead,
    "client-intake": clientIntake,
    "media-inventory": mediaInventory,
    "creative-configuration": creativeConfiguration,
  });

  const ledger = [];
  const warnings = [];

  const publishable = mediaInventory.assets.filter(
    (asset) => asset.approvedForPublication && asset.audit !== "REFERENCE_ONLY",
  );
  const assetById = new Map(publishable.map((asset) => [asset.assetId, asset]));

  /* ---- profile ---------------------------------------------------------- */

  const services = clientIntake.services.map((service) => {
    const decision = {
      suitedTo: [...service.suitedTo],
      covers: [...service.covers],
      excludes: [...service.excludes],
      whenToCall: [...service.whenToCall],
      customerProvides: [...service.customerProvides],
      stages: (service.stages ?? []).map((stage) => ({
        title: stage.title,
        description: stage.description,
      })),
      commercial: (service.commercial ?? []).map((fact) => ({
        label: fact.label,
        value: fact.value,
        ...(fact.qualifier === undefined ? {} : { qualifier: fact.qualifier }),
      })),
      questions: (service.questions ?? []).map((item) => ({
        question: item.question,
        answer: item.answer,
      })),
      nextActionId: "enquire",
    };
    ledger.push(
      ledgerEntry(
        `profile.services.${service.serviceId}`,
        "VERIFIED_CLIENT_FACT",
        "client-intake.json",
        "Service scope, boundary and process as the client stated them.",
      ),
    );
    return {
      serviceId: service.serviceId,
      title: truncate(service.title, 200),
      description: truncate(service.summary, 2_000),
      ...(service.narrative === undefined ? {} : { narrative: service.narrative }),
      decision,
      ...(service.groupId === undefined ? {} : { groupId: service.groupId }),
      featured: service.featured === true,
    };
  });

  const groups = clientIntake.serviceGroups.map((group) => ({
    groupId: group.groupId,
    title: truncate(group.title, 200),
    ...(group.description === undefined ? {} : { description: group.description }),
  }));

  const credentials = clientIntake.credentials.map((credential) => {
    ledger.push(
      ledgerEntry(
        `profile.trust.${slugify(credential.label)}`,
        credential.evidence === "SIGHTED" ? "VERIFIED_CLIENT_FACT" : "CLIENT_CLAIM",
        "client-intake.json",
        credential.evidence === "SIGHTED"
          ? "Certificate sighted by the agency."
          : "Stated by the client and published in wording the client approved. Not independently verified.",
      ),
    );
    return truncate(credential.approvedWording, 200);
  });

  const sections = [
    {
      type: "SERVICES",
      sectionId: "services",
      heading: "What we do",
      items: services,
      groups,
    },
    {
      type: "TRUST_SIGNALS",
      sectionId: "trust",
      heading: "Licences and cover",
      items: credentials.length > 0 ? credentials : ["Credentials confirmed with the business before launch"],
      ...(credentials.length > 0
        ? {}
        : {
            disclaimer:
              "No licence, registration or insurance claim is made on this page. Confirm and approve exact wording with the business before publishing one.",
          }),
    },
    {
      type: "PROCESS",
      sectionId: "process",
      heading: "How a job runs",
      items:
        clientIntake.process.length > 0
          ? clientIntake.process.map((step) => ({
              title: truncate(step.title, 200),
              description: truncate(step.description, 2_000),
            }))
          : [
              {
                title: "Get in touch",
                description: `Contact the business and describe the job. ${QUOTE_MODEL_SENTENCE[clientIntake.contact.quoteModel]}`,
              },
            ],
    },
    {
      type: "FAQ",
      sectionId: "faq",
      heading: "Questions we get asked",
      items:
        clientIntake.faqs.length > 0
          ? clientIntake.faqs.map((item) => ({
              question: truncate(item.question, 200),
              answer: truncate(item.answer, 2_000),
            }))
          : [
              {
                question: "Which areas do you cover?",
                answer: `${clientIntake.serviceAreas.join(", ")}.`,
              },
            ],
    },
    {
      type: "STORY",
      sectionId: "story",
      heading: "About the business",
      body: truncate(clientIntake.story, 2_000),
    },
    {
      type: "CONTACT",
      sectionId: "contact",
      heading: "Ask about your job",
      body: `Describe the job and where it is, and the business will come back to you. ${QUOTE_MODEL_SENTENCE[clientIntake.contact.quoteModel]} Please do not send payment details or identity documents through this form.`,
    },
    {
      type: "ACTIONS",
      sectionId: "actions",
      heading: "Direct contact",
      actions: [buildEnquiryAction(clientIntake)],
    },
  ];

  ledger.push(
    ledgerEntry("profile.story", "VERIFIED_CLIENT_FACT", "client-intake.json", "The business's own account of itself."),
    ledgerEntry("profile.serviceAreas", "VERIFIED_CLIENT_FACT", "client-intake.json", "Areas the client stated they work in."),
    ledgerEntry("profile.brand", "INFERRED_OPPORTUNITY", "creative-configuration.json", "The agency's proposed identity, approved by the client as representation and direction — not a fact about the business."),
  );

  const profile = {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: truncate(clientIntake.tagline ?? clientIntake.businessName, 200),
      accentColor: creativeConfiguration.palette.accentColor,
      accentContrastColor: creativeConfiguration.palette.accentContrastColor,
      surfaceColor: creativeConfiguration.palette.surfaceColor,
      textColor: creativeConfiguration.palette.textColor,
    },
    sections,
  };

  /* ---- projects --------------------------------------------------------- */

  const projects = [];
  for (const source of clientIntake.projects) {
    const evidence = publishable.filter(
      (asset) =>
        asset.substantiates?.kind === "SPECIFIC_JOB" &&
        asset.substantiates.reference === source.projectId,
    );
    if (evidence.length === 0) {
      warnings.push(
        `Project "${source.projectId}" has no publishable asset that may substantiate a specific-job claim, so it is not published. Close it with the shot list, or drop the record.`,
      );
      continue;
    }
    const [hero, ...gallery] = evidence;
    ledger.push(
      ledgerEntry(
        `projects.${source.projectId}`,
        "VERIFIED_CLIENT_FACT",
        "client-intake.json + media-inventory.json",
        `Job stated by the client; ${evidence.length} asset(s) whose provenance may carry a specific-job claim.`,
      ),
    );
    projects.push({
      schemaVersion: 1,
      projectId: source.projectId,
      slug: slugify(source.slug ?? source.title),
      title: truncate(source.title, 200),
      summary: truncate(source.summary ?? source.title, 4_000),
      truthMode: "VERIFIED_CLIENT",
      serviceIds: [...source.serviceIds],
      ...(source.locationLabel === undefined ? {} : { locationLabel: truncate(source.locationLabel, 200) }),
      featured: source.featured === true,
      ...(source.completedYear === undefined ? {} : { completedYear: source.completedYear }),
      hero: mediaReference(hero, "PROJECT"),
      gallery: gallery.map((asset) => mediaReference(asset, "GALLERY")),
      facts: buildProjectFacts(source),
      story: buildProjectStory(source),
      relatedProjectIds: [],
    });
  }

  /* ---- page graph ------------------------------------------------------- */

  const pageGraph = buildPageGraph({ clientIntake, services, projects, saleHandoff });

  /* ---- configuration and assembly -------------------------------------- */

  const definition = {
    schemaVersion: 2,
    configuration: buildConfiguration({ clientId, clientIntake, saleHandoff }),
    profile,
    pageGraph,
    projects: { schemaVersion: 1, projects },
    clientExperience: {
      schemaVersion: 1,
      kind: "AUTHORED_CLIENT_EXPERIENCE",
      manifestPath: "experience/manifest.json",
    },
    template: { templateId: "contractor", templateVersion: "1.0.0" },
    modules: buildModuleReferences(saleHandoff),
    assets: publishable.map((asset) => ({
      assetId: asset.assetId,
      kind: "IMAGE",
      sourcePath: asset.sourcePath,
      mediaType: asset.mediaType ?? "image/jpeg",
      width: asset.width,
      height: asset.height,
    })),
    foundationSearch: { schemaVersion: 2, mode: "AUTO" },
  };

  /* Research that never became a published fact, recorded so it stays visible. */
  for (const observation of businessRead?.observations ?? []) {
    ledger.push(
      ledgerEntry(
        `research.${observation.observationId}`,
        observation.classification,
        "business-read.json",
        PUBLISHABLE_AS_FACT.includes(observation.classification)
          ? "Observable in a named public source on a named date. Not published unless a section quotes it."
          : "The agency's judgement. Input to the creative direction; never publishable as a fact.",
      ),
    );
  }

  const unused = mediaInventory.assets.filter(
    (asset) => !assetById.has(asset.assetId),
  );
  if (unused.length > 0) {
    warnings.push(
      `${unused.length} asset(s) were received but are not published: unapproved, or REFERENCE_ONLY.`,
    );
  }

  return Object.freeze({
    definition,
    truthLedger: Object.freeze({
      schemaVersion: 1,
      kind: "TRUTH_LEDGER",
      clientId,
      composedFrom: Object.freeze([
        "sale-handoff.json",
        ...(businessRead === undefined ? [] : ["business-read.json"]),
        "client-intake.json",
        "media-inventory.json",
        "creative-configuration.json",
      ]),
      entries: Object.freeze(ledger),
    }),
    warnings: Object.freeze(warnings),
  });
}

const QUOTE_MODEL_SENTENCE = Object.freeze({
  SITE_VISIT_THEN_QUOTE: "Jobs are quoted in writing after a site visit.",
  PHONE_ESTIMATE: "An indicative estimate is given over the phone and confirmed on site.",
  FIXED_PRICE_LIST: "Common jobs are priced from a fixed list.",
  HOURLY_RATE: "Work is charged at an hourly rate, confirmed before starting.",
  OTHER: "Pricing is confirmed with the business before any work starts.",
});

function buildEnquiryAction(clientIntake) {
  const phone = clientIntake.contact.phone;
  if (typeof phone === "string" && /^\+[1-9][0-9]{7,14}$/.test(phone)) {
    return {
      actionId: "enquire",
      kind: "PHONE",
      state: "CONFIGURED",
      label: "Call the office",
      href: `tel:${phone}`,
    };
  }
  /*
   * A phone number that is not in international form is not published as one.
   * The site says so plainly rather than printing a link that fails on a phone,
   * which is the single most expensive silent defect a trade site can ship.
   */
  return {
    actionId: "enquire",
    kind: "PHONE",
    state: "NOT_CONFIGURED",
    label: "Phone contact not yet configured",
    message:
      "No verified phone number in international format has been supplied for this business. Add one to the intake before launch.",
  };
}

function mediaReference(asset, role) {
  return {
    assetId: asset.assetId,
    role,
    decorative: false,
    alt: asset.alt ?? `Work by this business: ${asset.subject.toLowerCase().replace(/_/g, " ")}.`,
    presentation: {
      aspect: asset.width >= asset.height ? "LANDSCAPE" : "PORTRAIT",
      fit: "COVER",
      focalPoint: { x: asset.focalPoint.x, y: asset.focalPoint.y },
    },
  };
}

function buildProjectFacts(source) {
  const facts = [];
  if (source.locationLabel !== undefined) {
    facts.push({ label: "Where", value: truncate(source.locationLabel, 200) });
  }
  if (source.completedYear !== undefined) {
    facts.push({ label: "Completed", value: String(source.completedYear) });
  }
  for (const fact of source.facts ?? []) {
    facts.push({ label: truncate(fact.label, 200), value: truncate(fact.value, 200) });
  }
  return facts;
}

function buildProjectStory(source) {
  const blocks = [];
  if (typeof source.brief === "string" && source.brief.trim() !== "") {
    blocks.push({ blockId: "brief", type: "BRIEF", heading: "The job", body: truncate(source.brief, 4_000) });
  }
  if (typeof source.approach === "string" && source.approach.trim() !== "") {
    blocks.push({ blockId: "approach", type: "APPROACH", heading: "What we did", body: truncate(source.approach, 4_000) });
  }
  if (typeof source.outcome === "string" && source.outcome.trim() !== "") {
    blocks.push({ blockId: "outcome", type: "OUTCOME", heading: "The result", body: truncate(source.outcome, 4_000) });
  }
  if (blocks.length === 0) {
    /*
     * A project record must carry at least one story block. Rather than invent
     * prose, the summary the client already wrote becomes the brief — the same
     * words in the same voice, not a new claim.
     */
    blocks.push({
      blockId: "brief",
      type: "BRIEF",
      heading: "The job",
      body: truncate(source.summary ?? source.title, 4_000),
    });
  }
  return blocks;
}

function page(pageId, path, kind, experienceRouteId, title, description, content, parentPageId) {
  return {
    pageId,
    path,
    kind,
    experienceRouteId,
    title: truncate(title, 200),
    metadata: { title: truncate(title, 200), description: truncate(description, 2_000) },
    content,
    anchors: [],
    ...(parentPageId === undefined ? {} : { parentPageId }),
    relatedPageIds: [],
    search: { include: true },
  };
}

function buildPageGraph({ clientIntake, services, projects, saleHandoff }) {
  const business = clientIntake.businessName;
  const areas = clientIntake.serviceAreas.join(", ");
  const pages = [
    page("home", "/", "HOME", "home", "Home", `${business}. ${clientIntake.services.map(({ title }) => title).slice(0, 3).join(", ")}. ${areas}.`, {
      kind: "PROFILE_SECTIONS",
      sectionIds: ["services", "trust", "process", "story"],
    }),
    page("services", "/services", "SERVICES_INDEX", "services-index", "Services", `Everything ${business} does, and what each job covers.`, { kind: "SERVICES_INDEX" }),
  ];

  /*
   * A service earns a route when it can answer at least two of the customer's
   * decision questions. Below that it stays a row on the index — a page holding
   * one sentence teaches a reader not to follow the next link.
   */
  const routed = services.filter((service) => decisionAnswers(service) >= 2);
  for (const service of routed) {
    pages.push(
      page(
        `service-${service.serviceId}`,
        `/services/${slugify(service.serviceId)}`,
        "SERVICE_DETAIL",
        "service-detail",
        service.title,
        service.description,
        { kind: "SERVICE", serviceId: service.serviceId },
        /*
         * The parent relation is what the header's second level reads. Setting
         * it here means the navigation and the site are the same list, so a
         * service cannot exist on the site and be missing from the menu.
         */
        "services",
      ),
    );
  }

  if (projects.length > 0) {
    pages.push(
      page("projects", "/projects", "PROJECTS_INDEX", "projects-index", "Work", `Jobs ${business} has completed.`, { kind: "PROJECTS_INDEX" }),
    );
    for (const project of projects) {
      pages.push(
        page(
          `project-${project.projectId}`,
          `/projects/${project.slug}`,
          "PROJECT_DETAIL",
          "project-detail",
          project.title,
          project.summary,
          { kind: "PROJECT", projectId: project.projectId },
          "projects",
        ),
      );
    }
  }

  pages.push(
    page("about", "/about", "ABOUT", "about", "About", `Who ${business} is and how they work.`, {
      kind: "PROFILE_SECTIONS",
      sectionIds: ["story", "trust", "process"],
    }),
    page("contact", "/contact", "CONTACT", "contact", "Contact", `Ask ${business} about your job.`, {
      kind: "PROFILE_SECTIONS",
      sectionIds: ["contact", "actions", "faq"],
    }),
  );

  const primary = [
    { navigationId: "nav-services", label: "Services", target: { kind: "ROUTE", pageId: "services" } },
    ...(projects.length > 0
      ? [{ navigationId: "nav-projects", label: "Work", target: { kind: "ROUTE", pageId: "projects" } }]
      : []),
    { navigationId: "nav-about", label: "About", target: { kind: "ROUTE", pageId: "about" } },
    { navigationId: "nav-contact", label: "Contact", target: { kind: "ROUTE", pageId: "contact" } },
  ];

  return {
    schemaVersion: 1,
    homePageId: "home",
    pages,
    navigation: {
      primary,
      utility: [],
      footer: [
        { navigationId: "foot-home", label: "Home", target: { kind: "ROUTE", pageId: "home" } },
        ...primary.map((item) => ({
          navigationId: item.navigationId.replace("nav-", "foot-"),
          label: item.label,
          target: item.target,
        })),
      ],
      primaryAction: {
        navigationId: "action-primary",
        label: saleHandoff.primaryActionLabel ?? "Ask about your job",
        target: { kind: "ROUTE", pageId: "contact" },
      },
    },
  };
}

/** How many kinds of decision answer a composed service carries. */
export function decisionAnswers(service) {
  const decision = service.decision ?? {};
  return [
    service.narrative !== undefined,
    (decision.suitedTo ?? []).length > 0,
    (decision.covers ?? []).length > 0,
    (decision.excludes ?? []).length > 0,
    (decision.whenToCall ?? []).length > 0,
    (decision.stages ?? []).length > 0,
    (decision.customerProvides ?? []).length > 0,
    (decision.commercial ?? []).length > 0,
    (decision.questions ?? []).length > 0,
  ].filter(Boolean).length;
}

function buildConfiguration({ clientId, clientIntake, saleHandoff }) {
  const wantsForm = saleHandoff.includedCapabilities.includes("CONTACT_FORM");
  const modules = [];
  const connectors = [];
  if (wantsForm) {
    modules.push({
      schemaVersion: 1,
      moduleId: "lead-primary",
      connectorId: "email-primary",
      type: "LEAD_FORM",
      fields: ["NAME", "EMAIL", "PHONE", "MESSAGE"],
    });
    connectors.push({
      schemaVersion: 1,
      connectorId: "email-primary",
      accountOwner: "CLIENT",
      portability: "CLIENT_OWNED",
      type: "EMAIL_DELIVERY",
      provider: "RESEND",
      fromAddress: `website@${domainOf(saleHandoff)}`,
      recipientAddresses: [clientIntake.contact.enquiryEmail],
      secretReferenceId: `resend-${clientId}`,
    });
  }
  return {
    schemaVersion: 1,
    configurationId: `${clientId}-website`,
    configurationVersion: 1,
    clientId,
    entitlementId: `${clientId}-website-entitlement`,
    deploymentId: `${clientId}-production`,
    display: {
      businessName: clientIntake.businessName,
      ...(clientIntake.tagline === undefined ? {} : { tagline: clientIntake.tagline }),
      locationIds: [`${clientId}-primary`],
    },
    domains: [{ hostname: domainOf(saleHandoff), canonical: true }],
    modules,
    connectors,
    configuredInfrastructure: [],
  };
}

function domainOf(saleHandoff) {
  return String(saleHandoff.domain.name).replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

function buildModuleReferences(saleHandoff) {
  const references = [];
  if (saleHandoff.includedCapabilities.includes("CONTACT_FORM")) {
    references.push({ type: "LEAD_FORM", moduleVersion: "1.0.0" });
  }
  return references;
}
