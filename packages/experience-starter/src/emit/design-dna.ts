import type { ResolvedDesign } from "../decisions.js";

/**
 * Emits the client's Design DNA record.
 *
 * This is the creative provenance artifact the Platform already contracts: it
 * states intent and constraint, and deliberately encodes no JSX, CSS,
 * breakpoints or tokens. Here it is written from the same brief the source was
 * generated from, so the record and the implementation cannot drift apart on
 * day one.
 */
export function emitDesignDna(design: ResolvedDesign): string {
  const { brief, type, space, media, breakpoints, colour } = design;

  const compositionPrinciples: Readonly<Record<string, string>> = {
    SPLIT_STATEMENT:
      "Home opens on the proposition beside the photograph, so identity, offer and both next steps hold the first screen.",
    IMAGE_LED:
      "Home opens on the photograph at full measure, with the proposition set beneath it on an offset column and the method stated as a compact band of facts.",
    ALTERNATING_ROWS:
      "Services alternate full-measure entries, the plate side flipping each row.",
    STAGGERED_COLUMNS:
      "Services are staged as three columns at different depths, the photograph above the title.",
    READING_COLUMN_RAIL:
      "A service is argued on a reading column with the customer's own questions on a rail beside it.",
    MEDIA_INTERRUPT:
      "A service is interrupted once by a full-width photograph before the practical detail resumes.",
    EDITORIAL_RECORDS:
      "Projects read as wide editorial records with their meta beside the plate, alternating side.",
    STAGGERED_INDEX:
      "Projects read as a numbered index at two depths, every second entry stepping in and to the side.",
    DOCUMENT:
      "A record reads as a document: hero, disclosure, facts band, then the story beats.",
    STAGGERED_BEATS:
      "A record reads as staggered beats, copy and photograph trading sides, the facts landing mid-narrative.",
    PROSE_PORTRAIT:
      "About opens on the story with a portrait beside it, then the method as a numbered sequence.",
    METHOD_LED:
      "About opens on the method as a numbered ladder, because how the work is run is what is being decided.",
    PANEL_SPLIT:
      "Contact sets one panel beside the practical detail and the direct channels.",
    STACKED_DIRECT:
      "Contact states the direct channels first across the full measure, with the form on a reading column beneath.",
  };

  return `${JSON.stringify(
    {
      schemaVersion: 1,
      designDnaId: brief.experienceId,
      designDnaVersion: brief.experienceVersion,
      creativeThesis: brief.creative.thesis,
      perceptionTargets: [...brief.creative.perceptionTargets],
      antiTargets: [...brief.creative.antiTargets],
      typography: {
        intent: `${familyIntent(brief.typography.displayFamily)} for display and ${familyIntent(
          brief.typography.textFamily,
        )} for text, worked at weight ${brief.typography.displayWeight} on a ${brief.typography.scaleRatio} modular scale.`,
        principles: [
          `Display type is set at weight ${brief.typography.displayWeight} with ${type.displayTracking} tracking and ${type.displayLeading} leading, so large type reads as a decision rather than as volume.`,
          `Every display size is a clamp that reaches its maximum at a 1440px viewport, so a heading and a paragraph do not compress at the same rate and a phone is not a shrunken desktop.`,
          `Prose holds a ${type.measure} measure and display type holds a separate 20ch measure, so a two-word heading cannot run the full width of the shell.`,
          `Labels are ${brief.typography.label.case === "UPPER" ? "uppercase" : "sentence case"} at ${type.label.size} with ${type.label.tracking} tracking, standing apart from both headings and body without becoming decoration.`,
        ],
      },
      colour: {
        intent: `A ${ground(brief.colour.ground)} ground with a ${brief.colour.contrast === "CRISP" ? "crisp" : "soft"} neutral scale; accent, surface and ink come from the validated client brand.`,
        principles: [
          "Palette tokens are bound from profile.brand at runtime; the stylesheet hard-codes no client colour.",
          `The neutral scale was derived and then proved: every derived ink clears WCAG AA against both the ground and the configured brand surface (worst measured ratio ${worstRatio(colour)}:1).`,
          "The accent is reserved for actions, active navigation, focus and step numbering; it never becomes decoration.",
        ],
      },
      composition: {
        intent: `A ${space.shell} measured shell on a single shared content edge, with asymmetric relationships varied per route so the site does not read as one repeated template.`,
        principles: [
          "One inline inset is shared by the shell and every full-bleed section, so the left edge of the page is a single line rather than four.",
          "A column beside a labelled heading is offset by exactly one label height, so the two share a first baseline instead of merely being top-aligned.",
          ...routeGrammarPrinciples(brief, compositionPrinciples),
        ].slice(0, 12),
      },
      imagery: {
        intent: `Photography at ${brief.media.scale.toLowerCase()} scale, framed deliberately and captioned honestly.`,
        principles: [
          `Every plate declares its own ratio (${media.ratios.wide} wide, ${media.ratios.tall} tall, ${media.ratios.panorama} panoramic); the Platform focal point drives the crop so subjects survive the frame.`,
          `A wide crop becomes ${media.mobileRatios.panorama} on a phone rather than collapsing into a strip.`,
          "Every photograph carries a caption stating what it is and what it is not.",
        ],
      },
      interaction: {
        intent:
          "Ordinary professional craft only: visible focus, generous targets, honest states.",
        principles: [
          "Focus is always visible and uses the client accent.",
          "Interactive targets are at least 44px high, and primary actions 48px.",
          "A NOT_CONFIGURED action states the truth in place rather than rendering a dead control.",
        ],
      },
      motion: {
        intent: motionIntent(brief.motion),
        principles: motionPrinciples(brief.motion),
        reducedMotionIntent:
          "Reduced motion is an intentional state, not a degraded one. One custom property collapses every transition, and anything that would have arrived is simply already present. No information is carried by motion, so nothing is lost.",
      },
      responsive: {
        intent: "Mobile is recomposed rather than stacked.",
        principles: [
          `Two-column compositions unstack at ${breakpoints.wide} and navigation collapses at ${breakpoints.mid}, so the two changes never land on the same width and read as one lurch.`,
          "Where a column order would put the photograph before the offer, the order is reversed rather than inherited.",
          "Media ratios change by breakpoint, and the display measure is released once a heading owns the full column.",
          "At the 320px tier the header wraps to two rows rather than dropping the primary action.",
        ],
      },
      signatureIntent: {
        name: "None for this delivery",
        purpose:
          "This is a standard generated P1 assembly. No client-local Signature is authored; the site earns its character from composition, restraint and honest media treatment.",
      },
    },
    null,
    2,
  )}\n`;
}

function routeGrammarPrinciples(
  brief: ResolvedDesign["brief"],
  principles: Readonly<Record<string, string>>,
): readonly string[] {
  return Object.values(brief.composition)
    .map((grammar) => principles[grammar])
    .filter((value): value is string => value !== undefined);
}

function familyIntent(family: string): string {
  switch (family) {
    case "GEOMETRIC_SANS":
      return "a geometric sans";
    case "GROTESQUE_SANS":
      return "a grotesque sans";
    case "TRANSITIONAL_SERIF":
      return "a transitional serif";
    case "MODERN_SERIF":
      return "a modern serif";
    default:
      return "a humanist sans";
  }
}

function ground(value: string): string {
  return value.toLowerCase().replaceAll("_", " ");
}

function worstRatio(colour: ResolvedDesign["colour"]): number {
  return Math.min(...colour.contrastReport.map(({ ratio }) => ratio));
}

function motionIntent(motion: ResolvedDesign["brief"]["motion"]): string {
  switch (motion) {
    case "NONE":
      return "No motion. The site is static by decision, not by omission.";
    case "ENTRANCE":
      return "Microinteraction plus one restrained entrance. No library, no choreography, no scroll spectacle.";
    default:
      return "Microinteraction only. No library, no choreography, no entrance.";
  }
}

function motionPrinciples(
  motion: ResolvedDesign["brief"]["motion"],
): readonly string[] {
  const base = [
    "Hover and focus transitions are short and functional, and every one reads its duration from a single custom property.",
    "No motion is required to understand any content.",
  ];
  if (motion === "NONE") {
    return ["Nothing transitions and nothing animates.", ...base.slice(1)];
  }
  if (motion === "ENTRANCE") {
    return [
      ...base,
      "One entrance helper marks an element visible on first intersection and disconnects; there is no scroll listener, no animation frame loop and no per-frame React state.",
      "Anything already on screen is never hidden, and nothing hides before hydration, so a reader without JavaScript sees the finished page.",
    ];
  }
  return [...base, "Nothing animates on scroll."];
}
