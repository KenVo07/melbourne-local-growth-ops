import type { StarterBrief } from "./brief.js";

/**
 * A minimal but complete CONTRACTOR build package and brief, used by the tests.
 *
 * Deliberately not CONDUCTOR and not STONE & LINE: a starter that only works on
 * the two clients it was developed against is not a starter.
 */
export const testDefinition = {
  schemaVersion: 2,
  profile: {
    schemaVersion: 1,
    profile: "CONTRACTOR",
    archetype: "SERVICE_LED",
    brand: {
      eyebrow: "Test",
      accentColor: "#3b4a52",
      accentContrastColor: "#ffffff",
      surfaceColor: "#dfe2e1",
      textColor: "#161a1c",
    },
    sections: [
      {
        type: "SERVICES",
        sectionId: "services",
        heading: "Services",
        items: [
          { serviceId: "first-service", title: "First", description: "One." },
          { serviceId: "second-service", title: "Second", description: "Two." },
        ],
      },
    ],
  },
  pageGraph: {
    schemaVersion: 1,
    homePageId: "home",
    pages: [
      { pageId: "home", path: "/", kind: "HOME", experienceRouteId: "home" },
      {
        pageId: "services",
        path: "/services",
        kind: "SERVICES_INDEX",
        experienceRouteId: "services-index",
      },
      {
        pageId: "service-first",
        path: "/services/first-service",
        kind: "SERVICE_DETAIL",
        experienceRouteId: "service-detail",
      },
      {
        pageId: "about",
        path: "/about",
        kind: "ABOUT",
        experienceRouteId: "about",
      },
      {
        pageId: "contact",
        path: "/contact",
        kind: "CONTACT",
        experienceRouteId: "contact",
      },
    ],
    navigation: { primary: [], utility: [], footer: [] },
  },
  assets: [
    { assetId: "hero", kind: "IMAGE", sourcePath: "assets/hero.jpg" },
    { assetId: "portrait", kind: "IMAGE", sourcePath: "assets/portrait.jpg" },
    { assetId: "first", kind: "IMAGE", sourcePath: "assets/first.jpg" },
    { assetId: "second", kind: "IMAGE", sourcePath: "assets/second.jpg" },
  ],
} as const;

const copy = {
  homeEyebrow: "Eyebrow",
  homeHeadline: "A headline with an operative phrase in it.",
  homeHeadlineEmphasis: "operative phrase",
  homeLede: "A lede.",
  homePrimaryAction: "Primary",
  homeSecondaryAction: "Secondary",
  homeServicesHeading: "Services heading",
  homeProjectsHeading: "Projects heading",
  servicesEyebrow: "Services",
  servicesLede: "Services lede.",
  serviceMoreLabel: "More",
  questionsEyebrow: "Questions",
  evidenceEyebrow: "Evidence",
  projectsEyebrow: "Projects",
  projectsLede: "Projects lede.",
  relatedRecordLabel: "Related",
  aboutEyebrow: "About",
  aboutLede: "About lede.",
  methodEyebrow: "Method",
  methodLede: "Method lede.",
  claimsEyebrow: "Claims",
  contactEyebrow: "Contact",
  contactHeading: "Contact heading",
  checklistEyebrow: "Checklist",
  contactChecklist: ["One.", "Two."],
  channelsEyebrow: "Channels",
  policiesEyebrow: "Terms",
  faqEyebrow: "FAQ",
  nextStepEyebrow: "Next step",
  nextStepHeading: "Next step heading.",
  nextStepBody: "Next step body.",
  footerStatement: "Footer statement.",
  footerEnquiries: "Footer enquiries.",
  notFoundLabel: "Not found",
  notFoundHeading: "Not found heading.",
  notFoundBody: "Not found body.",
};

const narratives = [
  {
    serviceId: "first-service",
    body: "First body.",
    questions: ["Q1?"],
    media: { assetId: "first", alt: "First alt.", focal: { x: 0.5, y: 0.5 } },
  },
  {
    serviceId: "second-service",
    body: "Second body.",
    questions: ["Q2?"],
    media: { assetId: "second", alt: "Second alt.", focal: { x: 0.5, y: 0.5 } },
  },
];

const mediaPlan = {
  homeHero: { assetId: "hero", alt: "Hero alt.", focal: { x: 0.5, y: 0.5 } },
  about: { assetId: "portrait", alt: "Portrait alt.", focal: { x: 0.5, y: 0.5 } },
};

/** A quiet, tight, sans-set, motionless brief. */
export const quietBrief: StarterBrief = {
  schemaVersion: 1,
  experienceId: "quiet-client",
  experienceVersion: "1.0.0",
  namespace: "qc",
  creative: {
    thesis: "Quiet.",
    perceptionTargets: ["quiet"],
    antiTargets: ["loud"],
  },
  typography: {
    displayFamily: "HUMANIST_SANS",
    textFamily: "HUMANIST_SANS",
    displayWeight: 400,
    displayTracking: -0.025,
    displayLeading: 1.08,
    scaleRatio: 1.2,
    baseSize: 1,
    bodyLeading: 1.6,
    measure: 32,
    emphasis: "WEIGHT",
    label: { case: "UPPER", tracking: 0.14, weight: 500, size: 0.75 },
  },
  space: {
    unit: 0.5,
    shell: 72,
    density: "COMPACT",
    gutter: 6,
    inset: 4,
  },
  colour: { ground: "COOL_STONE", contrast: "SOFT" },
  media: {
    scale: "RESTRAINED",
    caption: "BELOW",
    radius: 0,
    provenanceCaption: "Representative stock.",
  },
  composition: {
    home: "SPLIT_STATEMENT",
    servicesIndex: "ALTERNATING_ROWS",
    serviceDetail: "READING_COLUMN_RAIL",
    projectsIndex: "EDITORIAL_RECORDS",
    projectDetail: "DOCUMENT",
    about: "PROSE_PORTRAIT",
    contact: "PANEL_SPLIT",
  },
  motion: "MICRO",
  navigation: { collapseAt: 48, wordmark: "UPPER", menuLabel: "Menu" },
  copy,
  mediaPlan,
  serviceNarratives: narratives,
};

/** A loud, expansive, serif-set, moving brief on the *same* client. */
export const loudBrief: StarterBrief = {
  ...quietBrief,
  experienceId: "loud-client",
  namespace: "ld",
  creative: {
    thesis: "Loud.",
    perceptionTargets: ["editorial"],
    antiTargets: ["timid"],
  },
  typography: {
    displayFamily: "MODERN_SERIF",
    textFamily: "GROTESQUE_SANS",
    displayWeight: 700,
    displayTracking: 0.02,
    displayLeading: 1.3,
    scaleRatio: 1.6,
    baseSize: 1.125,
    bodyLeading: 1.75,
    measure: 44,
    emphasis: "ACCENT",
    label: { case: "SENTENCE", tracking: 0, weight: 700, size: 0.9375 },
  },
  space: {
    unit: 0.75,
    shell: 96,
    density: "EXPANSIVE",
    gutter: 12,
    inset: 8,
  },
  colour: { ground: "NEUTRAL_LIGHT", contrast: "CRISP" },
  media: {
    scale: "DOMINANT",
    caption: "MARGIN",
    radius: 1,
    provenanceCaption: "Representative stock.",
  },
  composition: {
    home: "IMAGE_LED",
    servicesIndex: "STAGGERED_COLUMNS",
    serviceDetail: "MEDIA_INTERRUPT",
    projectsIndex: "STAGGERED_INDEX",
    projectDetail: "STAGGERED_BEATS",
    about: "METHOD_LED",
    contact: "STACKED_DIRECT",
  },
  motion: "ENTRANCE",
  navigation: { collapseAt: 60, wordmark: "AS_WRITTEN", menuLabel: "Navigate" },
};
