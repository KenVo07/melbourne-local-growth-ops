/**
 * The starter brief, pre-answered as far as honesty allows.
 *
 * Every *design* decision in a P1 brief is already recorded in the approved
 * creative configuration, so restating it by hand is transcription with a
 * chance of divergence. This derives all of it, plus the navigational chrome
 * and every string that is a verbatim restatement of client truth.
 *
 * What it will not do is write the client's copy. Eight fields are genuinely new
 * prose — a headline is a claim, and a generated claim is a claim nobody made —
 * so they are emitted as `TODO — …` and `tradie p1` refuses a brief that still
 * carries one. A placeholder that can reach production is worse than a blank.
 */

const TODO = "TODO — ";

/** The copy fields that need a person, and what each one is for. */
const EDITORIAL = Object.freeze({
  homeHeadline: "the one sentence this business would say if it had one sentence",
  homeHeadlineEmphasis: "the phrase inside the headline that carries the emphasis, or delete this field",
  homeLede: "two or three sentences under the headline; what they do and who for",
  servicesLede: "what a reader should understand before scanning the service list",
  projectsLede: "what the work shown here is meant to demonstrate",
  nextStepBody: "the sentence beside the closing call to action",
  footerStatement: "the closing line in the footer; not a slogan unless they have one",
  notFoundBody: "what to say to someone who has followed a broken link",
});

const DENSITY_SPACE = Object.freeze({
  COMPACT: { unit: 0.5, shell: 72, gutter: 4, inset: 3, bodyLeading: 1.5 },
  MEASURED: { unit: 0.5, shell: 78, gutter: 6, inset: 4, bodyLeading: 1.6 },
  EXPANSIVE: { unit: 0.625, shell: 86, gutter: 8, inset: 5, bodyLeading: 1.7 },
});

const MOTION_FROM_APPETITE = Object.freeze({
  STILL: "NONE",
  MICRO: "MICRO",
  ENTRANCE: "ENTRANCE",
  CHOREOGRAPHED: "ENTRANCE",
});

const INTERACTION_FROM_APPETITE = Object.freeze({
  STILL: { tempo: "MEASURED", attack: "IMMEDIATE", travel: 0, overshoot: 0, pointerFeedback: "NONE", entrance: "NONE", mediaExploration: "EDITORIAL_ONLY", reducedMotion: "INSTANT" },
  MICRO: { tempo: "BRISK", attack: "EASED", travel: 0.25, overshoot: 0, pointerFeedback: "ESSENTIAL", entrance: "NONE", mediaExploration: "EDITORIAL_ONLY", reducedMotion: "INSTANT" },
  ENTRANCE: { tempo: "MEASURED", attack: "EASED", travel: 0.45, overshoot: 0.1, pointerFeedback: "ESSENTIAL", entrance: "KEY_MOMENTS", mediaExploration: "WHEN_PLURAL", reducedMotion: "BRIEF_FADE" },
  CHOREOGRAPHED: { tempo: "UNHURRIED", attack: "SETTLED", travel: 0.6, overshoot: 0.2, pointerFeedback: "GENEROUS", entrance: "EVERY_SECTION", mediaExploration: "PREFERRED", reducedMotion: "BRIEF_FADE" },
});

/** Provenance classes whose published assets are all photographs of real work. */
const REAL_WORK_PROVENANCE = Object.freeze([
  "CLIENT_JOB_PHOTOGRAPH",
  "CLIENT_PREMISES_OR_TEAM",
  "COMMISSIONED_PHOTOGRAPH",
  "ENHANCED_CLIENT_ASSET",
]);

export function starterBriefTemplate(creative, definition, mediaInventory) {
  const space = DENSITY_SPACE[creative.density] ?? DENSITY_SPACE.MEASURED;
  const published = new Set(definition.assets.map(({ assetId }) => assetId));
  const assets = (mediaInventory?.assets ?? []).filter((asset) =>
    published.has(asset.assetId),
  );
  const businessName = definition.configuration.display.businessName;

  const hero = pick(assets, (asset) =>
    asset.subject === "COMPLETED_WORK" && asset.width >= asset.height,
  ) ?? assets[0];
  const about =
    pick(assets, (asset) => asset.subject === "TEAM") ??
    pick(assets, (asset) => asset.subject === "PREMISES") ??
    pick(assets, (asset) => asset.subject === "VEHICLE") ??
    hero;

  /*
   * One provenance line for the whole site is only honest when every published
   * photograph shares one provenance. Where the set is mixed, the line has to be
   * written by a person who knows what it can truthfully say.
   */
  const allRealWork =
    assets.length > 0 &&
    assets.every((asset) => REAL_WORK_PROVENANCE.includes(asset.provenance));

  const services = definition.profile.sections
    .filter((section) => section.type === "SERVICES")
    .flatMap((section) => section.items);

  return {
    schemaVersion: 1,
    experienceId: definition.configuration.clientId,
    experienceVersion: "1.0.0",
    namespace: namespaceFor(definition.configuration.clientId),
    creative: {
      thesis: creative.temperament,
      perceptionTargets: [...creative.perceptionTargets],
      antiTargets: [...creative.antiTargets],
    },
    typography: {
      displayFamily: creative.typography.displayFamily,
      textFamily: creative.typography.textFamily,
      displayWeight: creative.density === "EXPANSIVE" ? 400 : 600,
      displayTracking: -0.02,
      displayLeading: 1.05,
      scaleRatio: creative.density === "COMPACT" ? 1.25 : 1.33,
      baseSize: 1.0625,
      bodyLeading: space.bodyLeading,
      measure: creative.density === "EXPANSIVE" ? 40 : 34,
      emphasis: "WEIGHT",
      label: { case: "UPPER", tracking: 0.12, weight: 600, size: 0.8125 },
    },
    space: {
      unit: space.unit,
      shell: space.shell,
      density: creative.density,
      gutter: space.gutter,
      inset: space.inset,
    },
    colour: { ground: creative.ground, contrast: "CRISP" },
    media: {
      scale: creative.imageTreatment,
      caption: "BELOW",
      radius: 0.25,
      provenanceCaption: allRealWork
        ? `Photographs of work completed by ${businessName}.`
        : `${TODO}one line that is true of every photograph published on this site. The set is mixed, so it cannot claim they are all completed work.`,
    },
    composition: {
      home: creative.imageTreatment === "DOMINANT" ? "IMAGE_LED" : "SPLIT_STATEMENT",
      servicesIndex: services.length > 6 ? "STAGGERED_COLUMNS" : "ALTERNATING_ROWS",
      serviceDetail: "READING_COLUMN_RAIL",
      projectsIndex: "EDITORIAL_RECORDS",
      projectDetail: "DOCUMENT",
      about: "PROSE_PORTRAIT",
      contact: "PANEL_SPLIT",
    },
    motion: MOTION_FROM_APPETITE[creative.motionAppetite] ?? "MICRO",
    interaction: {
      ...(INTERACTION_FROM_APPETITE[creative.motionAppetite] ?? INTERACTION_FROM_APPETITE.MICRO),
      disclosure: services.length > 6 ? "WHEN_LONG" : "ALWAYS_VISIBLE",
    },
    navigation: { collapseAt: 60, wordmark: "AS_WRITTEN", menuLabel: "Menu" },
    copy: {
      /* Editorial — a person writes these. */
      ...Object.fromEntries(
        Object.entries(EDITORIAL).map(([field, guidance]) => [field, `${TODO}${guidance}`]),
      ),
      /* Chrome and restatement — derived, and safe to derive. */
      homeEyebrow: businessName,
      homePrimaryAction: "Ask about your job",
      homeSecondaryAction: "See the work",
      homeServicesHeading: "What we do",
      homeProjectsHeading: "Work",
      servicesEyebrow: "Services",
      serviceMoreLabel: "What this covers",
      questionsEyebrow: "Questions we get asked",
      evidenceEyebrow: "Where we have done this",
      projectsEyebrow: "Completed work",
      relatedRecordLabel: "Another job",
      aboutEyebrow: "About",
      aboutLede: firstSentence(sectionBody(definition, "STORY")),
      methodEyebrow: "How a job runs",
      methodLede: "The same steps on every job, so nothing about the process is a surprise.",
      claimsEyebrow: "Licences and cover",
      contactEyebrow: "Contact",
      contactHeading: "Tell us about the job",
      checklistEyebrow: "Useful to include",
      contactChecklist: enquiryChecklist(services),
      channelsEyebrow: "Direct contact",
      faqEyebrow: "Questions",
      nextStepEyebrow: "Next step",
      nextStepHeading: "Tell us about the job",
      footerEnquiries: `Enquiries: ${definition.configuration.connectors?.[0]?.recipientAddresses?.[0] ?? "add a contact address to the intake"}`,
      notFoundLabel: "404",
      notFoundHeading: "That page is not here",
    },
    mediaPlan: {
      homeHero: placement(hero, `Work completed by ${businessName}.`),
      about: placement(about, `${businessName} at work.`),
    },
    serviceNarratives: [],
  };
}

/** Copy fields still holding a placeholder. A TODO is not copy. */
export function unansweredCopy(brief) {
  const copy = brief?.copy;
  if (copy === null || typeof copy !== "object") return ["copy is missing"];
  const unanswered = [];
  for (const [field, value] of Object.entries(copy)) {
    if (typeof value === "string" && value.startsWith(TODO)) {
      unanswered.push(`copy.${field}: ${value.slice(TODO.length)}`);
    }
  }
  const provenance = brief?.media?.provenanceCaption;
  if (typeof provenance === "string" && provenance.startsWith(TODO)) {
    unanswered.push(`media.provenanceCaption: ${provenance.slice(TODO.length)}`);
  }
  return unanswered;
}

function placement(asset, fallbackAlt) {
  if (asset === undefined) {
    return { assetId: "missing-asset", alt: fallbackAlt, focal: { x: 0.5, y: 0.5 } };
  }
  return {
    assetId: asset.assetId,
    alt: asset.alt ?? fallbackAlt,
    focal: { x: asset.focalPoint.x, y: asset.focalPoint.y },
  };
}

function pick(assets, predicate) {
  return assets.find(predicate);
}

function sectionBody(definition, type) {
  const section = definition.profile.sections.find((entry) => entry.type === type);
  return typeof section?.body === "string" ? section.body : "";
}

function firstSentence(text) {
  const trimmed = String(text).trim();
  if (trimmed === "") return "About the business.";
  const stop = trimmed.search(/[.!?](\s|$)/);
  return stop === -1 ? trimmed.slice(0, 200) : trimmed.slice(0, stop + 1);
}

/**
 * What a customer should include in an enquiry, taken from what the services
 * themselves say they need. Real truth, restated — not invented advice.
 */
function enquiryChecklist(services) {
  const asked = services
    .flatMap((service) => service.decision?.customerProvides ?? [])
    .map((item) => String(item).trim())
    .filter((item) => item !== "");
  const unique = [...new Set(asked)].slice(0, 4);
  return unique.length > 0
    ? unique
    : ["What the job is", "Where it is", "When you need it done"];
}

function namespaceFor(clientId) {
  const letters = clientId.replace(/[^a-z]/g, "");
  return (letters.slice(0, 2) + (letters.slice(-1) || "x")).slice(0, 4) || "site";
}
