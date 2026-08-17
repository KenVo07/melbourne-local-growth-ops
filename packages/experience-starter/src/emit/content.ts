import type { StarterBrief, StarterMediaPlacement } from "../brief.js";

/**
 * Emits the one module that holds this client's editorial copy and its
 * site-level media assignments.
 *
 * It exists so an operator finishing a generated site edits prose in one obvious
 * place instead of hunting through seven route files. Everything here is
 * ordinary exported data — no indirection, no schema, no framework.
 */
export function emitSiteContent(brief: StarterBrief): string {
  const { copy, mediaPlan, media, serviceNarratives } = brief;
  return `import type { RuntimeMediaFocalPoint } from "@proportion/client-experience";

/**
 * ${titleCase(brief.experienceId)} — site copy and media assignments.
 *
 * Generated as a starting point and now owned by this client. Editing a string
 * here changes the site; nothing reads this file but the routes beside it.
 */

/** The provenance line every photograph on this site carries. */
export const PROVENANCE = ${quote(media.provenanceCaption)};

export interface SitePhotograph {
  readonly assetId: string;
  readonly alt: string;
  readonly focal: RuntimeMediaFocalPoint;
  readonly mobileFocal?: RuntimeMediaFocalPoint | undefined;
}

export const SITE_MEDIA = {
  homeHero: ${photograph(mediaPlan.homeHero)},${
    mediaPlan.homeSecondary === undefined
      ? ""
      : `
  homeSecondary: ${photograph(mediaPlan.homeSecondary)},`
  }
  about: ${photograph(mediaPlan.about)},
} as const satisfies Record<string, SitePhotograph>;

/**
 * Per-service narrative and imagery, keyed by the stable service ID the client
 * definition declares — never by title or slug.
 */
export interface ServiceNarrative {
  readonly body: string;
  readonly questions: readonly string[];
  readonly photograph: SitePhotograph;
}

export const SERVICE_NARRATIVE: Record<string, ServiceNarrative | undefined> = {
${serviceNarratives
  .map(
    (narrative) => `  ${quote(narrative.serviceId)}: {
    body: ${quote(narrative.body)},
    questions: [
${narrative.questions.map((question) => `      ${quote(question)},`).join("\n")}
    ],
    photograph: ${photograph(narrative.media, 4)},
  },`,
  )
  .join("\n")}
};

export const COPY = {
${Object.entries(copy)
  .map(([key, value]) =>
    Array.isArray(value)
      ? `  ${key}: [
${value.map((entry) => `    ${quote(String(entry))},`).join("\n")}
  ],`
      : `  ${key}: ${quote(String(value))},`,
  )
  .join("\n")}
} as const;
`;
}

function photograph(placement: StarterMediaPlacement, indent = 2): string {
  const pad = " ".repeat(indent + 2);
  const close = " ".repeat(indent);
  return `{
${pad}assetId: ${quote(placement.assetId)},
${pad}alt: ${quote(placement.alt)},
${pad}focal: { x: ${placement.focal.x}, y: ${placement.focal.y} },${
    placement.mobileFocal === undefined
      ? ""
      : `
${pad}mobileFocal: { x: ${placement.mobileFocal.x}, y: ${placement.mobileFocal.y} },`
  }
${close}}`;
}

export function quote(value: string): string {
  return JSON.stringify(value);
}

export function titleCase(value: string): string {
  return value
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
